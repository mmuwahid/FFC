# Design Spec: League Rules Screen + Friendly Game System

**Date:** 23/APR/2026
**Session:** S023 brainstorm
**Status:** APPROVED — ready for implementation planning

---

## Overview

Two related features:

1. **League Rules screen** — static in-app reference for all app-enforced rules (scoring, penalties, friendly game threshold). Lives inside Settings.
2. **Friendly game system** — matchdays with too many external guests are auto-flagged and, once admin confirms, fully excluded from season standings, stats, and match history.

A third addition formalised here: **no-show penalty** (distinct from late cancel), also surfaced in the Rules screen.

---

## 1. Data Model Changes

### `matchdays` table — 2 new columns

| Column | Type | Default | Purpose |
|---|---|---|---|
| `friendly_flagged_at` | `TIMESTAMPTZ NULL` | `NULL` | Set automatically when guest count crosses format threshold. `NULL` = never flagged. |
| `is_friendly` | `BOOLEAN NOT NULL` | `false` | Set to `true` by admin confirmation only. |

**State matrix:**

| `friendly_flagged_at` | `is_friendly` | Meaning |
|---|---|---|
| `NULL` | `false` | Normal game |
| `NOT NULL` | `false` | Auto-flagged — awaiting admin decision |
| `NOT NULL` | `true` | Confirmed friendly — fully excluded |

### `match_players` table — 1 new column

| Column | Type | Default | Purpose |
|---|---|---|---|
| `is_no_show` | `BOOLEAN NOT NULL` | `false` | Admin sets this when a rostered player didn't appear. |

### `app_settings` — 2 new keys

Added alongside existing `late_cancel_penalty_after_lock`, `late_cancel_penalty_within_24h`, `late_cancel_ban_days_within_24h`:

| Key | Value |
|---|---|
| `no_show_penalty_points` | `-2` |
| `no_show_ban_days` | `14` |

### Friendly threshold constants (app layer, not DB)

| Format | Guest threshold |
|---|---|
| 7v7 | ≥ 4 guests |
| 5v5 | ≥ 3 guests |

These are enforced in the app layer and displayed statically in the Rules screen. Not stored in `app_settings` — they are structural constraints, not operational tunables.

### `v_season_standings` view

Needs three changes (view must be recreated via migration):

1. **`played` CTE** — add `AND NOT md.is_friendly` to the matchday join so friendly matchdays don't contribute wins/draws/losses/goals/MOTM.
2. **`penalties` CTE** — add `AND NOT md.is_friendly` to the matchday join so late-cancel points from friendly matchdays are also excluded.
3. **New `no_show_penalties` CTE** — `SELECT md.season_id, mp.profile_id, SUM(CASE WHEN mp.is_no_show THEN -2 ELSE 0 END) AS no_show_points FROM match_players mp JOIN matches m ON m.id = mp.match_id JOIN matchdays md ON md.id = m.matchday_id WHERE NOT md.is_friendly GROUP BY md.season_id, mp.profile_id`. Joined in the final SELECT alongside the existing `penalties` CTE. Exposes a `no_show_points` column. The `points` formula becomes `wins*3 + draws + late_cancel_points + no_show_points`.

Note: `player_bans` table already exists in the masterplan (created in `0005_operational.sql`). No new table needed for ban enforcement.

---

## 2. Friendly Game Workflow

### Auto-flag trigger

When a guest is added to a matchday (§3.5 +1 slot flow), the app layer checks:
- Total confirmed guest count for that matchday
- Format threshold (≥ 4 for 7v7, ≥ 3 for 5v5)

If threshold is newly crossed and `friendly_flagged_at IS NULL`, app writes `friendly_flagged_at = now()` to the matchday row.

### Admin visibility (§3.18 Admin Matches screen)

Matchdays where `friendly_flagged_at IS NOT NULL AND is_friendly = false` display an amber **"FRIENDLY?"** badge.

Admin taps the matchday and sees a confirmation card showing:
- Current guest count vs. threshold
- The applicable rule (e.g. "4+ external players in a 7v7")
- Two actions:
  - **Confirm Friendly** → sets `is_friendly = true`
  - **Dismiss** → clears `friendly_flagged_at` (treats as normal game; re-flags automatically if guest count crosses threshold again)

### After confirmation

The matchday is fully excluded from:
- `v_season_standings` (points, stats)
- §3.14 Player profile — Recent Matches list
- §3.15 Match Detail navigation

No deletion of `match_players` rows. The data is retained but all views filter via `is_friendly`. If admin confirms friendly after a match result was already entered, those rows are silently ignored by all stat views.

---

## 3. Rules Screen

### Entry point

A **"League Rules"** row in the Settings page (§3.16) — label + chevron `›`. Tapping navigates to `/settings/rules` (or equivalent slide-in sub-screen).

### Content

Four static sections rendered as cards:

#### Scoring
| Result | Points |
|---|---|
| Win | 3 pts |
| Draw | 1 pt |
| Loss | 0 pts |

#### Late cancellation
| Timing | Penalty |
|---|---|
| Before roster lock | No penalty |
| After lock, outside 24h of kickoff | −1 pt |
| Within 24h of kickoff | −1 pt + 7-day ban |

#### No-show
| Situation | Penalty |
|---|---|
| On the roster, didn't appear | −2 pts + 14-day ban |

#### Friendly games
Displayed as explanatory text:

> If 4 or more external players join a 7v7 matchday, or 3 or more join a 5v5, the match is flagged as a friendly. A friendly game doesn't count toward the season table, player stats, or match history.

### Implementation notes
- Pure static component — no DB query
- Dark theme, consistent with rest of app
- Read-only, no edit controls
- One migration adds the new columns; Rules screen content is hardcoded to match

---

## 4. No-Show Recording + Enforcement

### Where it's set

Admin match result entry screen (§3.18). Each rostered player row gains an optional **"No-show"** toggle. Toggling sets `match_players.is_no_show = true`.

### On save

For each player where `is_no_show = true`:
1. Apply −2 point penalty — `match_players.is_no_show = true` is picked up by the new `no_show_penalties` CTE in `v_season_standings` (see Section 1). No separate write needed beyond setting the flag.
2. Insert `player_bans` row: `starts_at = matchday kickoff time`, `ends_at = starts_at + 14 days`, `reason = 'no_show'`

### Constraints

- A player cannot be both `is_no_show = true` and have played (goals scored, MOTM) — app layer validates before save.
- Ban enforcement remains Phase 2 (consistent with masterplan — `player_bans` rows are created in Phase 1 but `poll_votes` does not check them yet).
- No double-penalty: app layer prevents `is_no_show = true` on a `match_players` row that already has a `late_cancel_points` penalty for the same matchday.

---

## 5. Penalty Rules Summary (complete, post-spec)

| Situation | Points | Ban |
|---|---|---|
| Cancel before roster lock | 0 | None |
| Cancel after lock, outside 24h | −1 | None |
| Cancel within 24h of kickoff | −1 | 7 days |
| No-show | −2 | 14 days |

---

## 6. Out of Scope

- Ban enforcement on `poll_votes` insert (Phase 2)
- DB-stored penalty values in Rules screen (static is sufficient)
- Repeat-dropout threshold (Phase 2+)
- Retroactive re-calculation of historical standings if friendly threshold changes
- Friendly game notification to players (Phase 2)

---

## 7. Migration

One new SQL migration required. Must follow the `0012_grants.sql` DEFAULT PRIVILEGES pattern (RLS alone does not grant access on this project).

```sql
-- Suggested: 0013_friendly_game_and_no_show.sql
ALTER TABLE matchdays
  ADD COLUMN friendly_flagged_at TIMESTAMPTZ,
  ADD COLUMN is_friendly BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE match_players
  ADD COLUMN is_no_show BOOLEAN NOT NULL DEFAULT false;

INSERT INTO app_settings (key, value) VALUES
  ('no_show_penalty_points', '-2'),
  ('no_show_ban_days', '14')
ON CONFLICT (key) DO NOTHING;

-- Recreate v_season_standings to add is_friendly filter + no_show_penalties CTE
DROP VIEW IF EXISTS v_captain_eligibility;  -- depends on v_season_standings
DROP VIEW IF EXISTS v_season_standings;
-- Full CREATE VIEW statements go here (implementation task — see Section 1 for the delta spec)
```

RLS policies: `is_friendly` and `friendly_flagged_at` are admin-write only (same pattern as other admin-controlled matchday columns). `is_no_show` is admin-write only.

---

## 8. Sections of the Masterplan Affected

| Masterplan section | Change |
|---|---|
| §2.2 `matchdays` table | Add `friendly_flagged_at`, `is_friendly` columns |
| §2.3 `match_players` table | Add `is_no_show` column |
| §2.6 `app_settings` keys | Add `no_show_penalty_points`, `no_show_ban_days` |
| §2.8 Views | `v_season_standings` gains `AND NOT is_friendly` filter |
| §3.16 Settings screen | Add "League Rules" row → `/settings/rules` sub-screen |
| §3.18 Admin Matches | Add FRIENDLY? badge + confirm/dismiss flow; add no-show toggle per player row |
| §6 Scoring & Discipline | Add no-show penalty row to the penalty table |
