# Phase 3 — Awards Page (Ballon d'Or · Golden Boot · Most MOTM · Wall of Fame)

**Date:** 2026-04-29
**Session:** S053
**Source:** V3.0:139 backlog (season-end awards page restored to Phase 3 scope)
**Status:** Mockup approved (`mockups/3-24-phase3-awards.html`, commit `82ae899`); design spec finalised; ready for implementation plan.

## Goal

Add a dedicated `/awards` screen surfacing 3 season awards (Ballon d'Or = top points; Golden Boot = top goals; Most MOTM = top MOTMs) plus a tabular Wall of Fame archiving ended-season winners. Entry is a new gold trophy icon-button in the Leaderboard controls row, sitting next to the existing Filter and Sort buttons.

## Non-goals

- No new bottom-nav tab — entry is via the trophy button on Leaderboard, plus deeplink (`/awards?season_id=…`).
- No admin-curated overrides — winners are computed from existing match data with deterministic tie-break.
- No new awards beyond the three above (no Worst Discipline, no Wall of Shame, no Best Defender etc.). Future awards can be added once the data layer exists.
- No edits to existing seasons-end admin flow — the snapshot trigger fires on the existing `seasons.ended_at` UPDATE.
- No PNG/share generator (separate Phase 3 backlog item, V3.0:140).
- No data backfill script for past seasons by default — covered as an optional admin RPC under "Risks & decisions" below.

---

## 1. Information architecture & routing

### New route

| Route | Query params | Meaning |
|---|---|---|
| `/awards` | (none) | Default → active season |
| `/awards?season_id=<uuid>` | `season_id` | Explicit season; works for active or ended |

### Entry points

- **Primary:** Trophy icon-button in `Leaderboard.lb-controls-row`, third position after Filter + Sort. Gold tint (`rgba(229, 186, 91, 0.06)` background, `rgba(229, 186, 91, 0.4)` border, `var(--gold)` color), subtle glow. Tap → `navigate('/awards?season_id=<currently-selected-leaderboard-season>')` so the awards page lands on whichever season the user was viewing.
- **Deeplink:** any `/awards?season_id=<id>` URL is shareable; pasted in a chat opens straight to that season's awards.

### Back nav

- Browser back from Awards → returns to whichever screen launched it (Leaderboard typically). No special handling.
- "‹ Back" chip top-left of Awards page is a `navigate(-1)` shortcut (matches existing Profile back-chip pattern).

---

## 2. Page layout

Stack top → bottom:

1. **Back chip** — `‹ Back` (gold, 14 px, top-left)
2. **Title** — `Season N Awards` (Fraunces serif, gold-bright `#f7d878`, 26 px, centered, subtle text-shadow)
3. **Sub** — `PROVISIONAL` for active season, `FINAL` for ended; small uppercase letter-spaced. Adjacent badge: gold-tinted `Active` chip during the season, neutral `Ended` after.
4. **Season pill** — centered, opens dropdown listing all seasons (active first, then ended-by-recency, then archived). Same dropdown style as Leaderboard's `lb-season-chip` (`lb-dropdown` reuse).
5. **Hero cards** (3 stacked) — Ballon d'Or, Golden Boot, Most MOTM. Each card:
   - Soft gold-glow surface (`linear-gradient(135deg, rgba(229,186,91,0.16) 0%, transparent 100%)`, 1.5 px gold border, 18 px radius).
   - Big trophy emoji (44 px, drop-shadow gold)
   - Award title (10 px, gold, uppercase, letter-spaced)
   - Winner name (Fraunces serif, gold-bright, 22 px) — tappable, navigates to `/profile?profile_id=<winner-id>&season_id=<viewed-season>`
   - Metric line (e.g., `**31 pts** · 9W 3D 2L · 64% win` for Ballon d'Or; `**21 goals** · 1.5 per match` for Golden Boot; `**5 MOTMs** · in 12 matches` for Most MOTM).
   - Runner-up sub (e.g., `2nd: Saif (22 pts)`) — small, muted, also tappable for runner-up's profile.
   - Photo avatar (60 px, gold border + glow) on the right side of the card.
6. **Wall of Fame** — section divider line + serif subtitle `— Wall of Fame —` (uppercase, letter-spaced).
   - Tabular grid: `Season | 🏆 Ballon | ⚽ Boot | ⭐ MOTM`. Headers in muted, season cells in gold, winner cells in cream (tappable → that player's profile filtered to that season).
   - Lists ENDED seasons only (active season is already covered by the hero cards above), most recent first.

### Empty / edge states

| State | Treatment |
|---|---|
| Active season has 0 matches yet | All 3 hero cards render with greyed trophy + name = `—` + meta = `No matches played yet`. Wall of Fame still shows past seasons normally. |
| Wall of Fame empty (FFC's first season) | Wall of Fame section shows a centered "First season — Wall of Fame begins after Season N ends" placeholder. |
| Tied winner per existing leaderboard cascade | Single deterministic winner. Tie-break order: most wins → fewest cards (yellows + reds) → alphabetical by display_name. (Matches `v_season_standings` ordering — see §4.) |
| All 3 awards same player | Three hero cards, same winner, same avatar. Acceptable — celebration emphasises dominance. |
| Soft-deleted player as a past Wall of Fame winner | Cell renders "Deleted player" in muted color, no tap target. Snapshot data preserves the player's past achievement immutably even if profile is later deleted. |

---

## 3. Active vs ended season behavior

Both states use the **same screen template**, with two differences:

| Aspect | Active season | Ended season |
|---|---|---|
| Subtitle badge | `PROVISIONAL` + gold `Active` chip | `FINAL` + neutral `Ended` chip |
| Data source for hero cards | `v_season_award_winners_live` view (live computation) | `season_awards` snapshot table (frozen at season-end) |
| Wall of Fame inclusion | Excluded (already shown above as hero cards) | Excluded (covered as hero cards on the awards page for that season) — but included once a *newer* season becomes active and the user views the newer season's page |

**Frontend rule:** if `selected_season.ended_at IS NULL` → fetch from view; else → fetch from snapshot table. View and table return the same column shape, so the frontend uses the same mapping.

---

## 4. DB layer — migration `0047_phase3_awards.sql`

### Schema verification (per CLAUDE.md operating rule #7) — confirmed against existing migrations

- `match_players.profile_id` (NOT `user_id`) — confirmed via `0006_views.sql:23`
- `matches.motm_user_id` (uuid) — confirmed via `0006_views.sql:32`
- `matches.approved_at`, `matches.season_id`, `matches.result` — confirmed
- `seasons.ended_at` (timestamptz, nullable) — confirmed via `0002_base_entities.sql:60-83`
- `seasons.starts_on`, `seasons.archived_at` — confirmed
- `profiles.id`, `profiles.display_name`, `profiles.deleted_at` (added by mig 0039) — confirmed
- `match_result` enum: `win_white | win_black | draw` — confirmed via `0001_enums.sql`

### New table — `season_awards`

```sql
CREATE TABLE season_awards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id       uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  award_kind      text NOT NULL CHECK (award_kind IN ('ballon_dor', 'golden_boot', 'most_motm')),
  winner_profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  runner_up_profile_id uuid REFERENCES profiles(id) ON DELETE RESTRICT,
  metric_value    numeric NOT NULL,                -- pts for ballon_dor, goals for golden_boot, motm count for most_motm
  runner_up_metric numeric,                         -- nullable when no runner-up exists
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,  -- e.g. {"win_pct": 64, "wins": 9, ...} for downstream display
  frozen_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, award_kind)
);

CREATE INDEX season_awards_season_idx ON season_awards (season_id);
GRANT SELECT ON season_awards TO authenticated;
```

`text` enum vs Postgres ENUM: chosen `text` + CHECK to keep migration footprint small and avoid dropping/adding enum values for future awards. CHECK constraint enforces the same invariant.

`ON DELETE RESTRICT` for `winner_profile_id` so soft-deleted players (`deleted_at`) keep their snapshot — true profile DELETE would be blocked, which is the right safety. (FFC currently soft-deletes only.)

### New view — `v_season_award_winners_live`

Computes the 3 winners per season on demand. Returns one row per (season_id, award_kind). Used for ACTIVE seasons.

```sql
CREATE OR REPLACE VIEW v_season_award_winners_live AS
WITH base AS (
  -- Same per-player-per-season aggregation as v_season_standings, kept inline
  -- to avoid coupling the view's tie-break to v_season_standings' projection
  SELECT
    m.season_id,
    mp.profile_id,
    pr.display_name,
    COUNT(*) FILTER (WHERE m.result = 'win_white' AND mp.team = 'white')
      + COUNT(*) FILTER (WHERE m.result = 'win_black' AND mp.team = 'black') AS wins,
    COUNT(*) FILTER (WHERE m.result = 'draw') AS draws,
    COUNT(*) FILTER (WHERE m.result = 'win_white' AND mp.team = 'black')
      + COUNT(*) FILTER (WHERE m.result = 'win_black' AND mp.team = 'white') AS losses,
    COALESCE(SUM(mp.goals), 0) AS goals,
    COALESCE(SUM(mp.yellow_cards), 0) AS yellows,
    COALESCE(SUM(mp.red_cards), 0) AS reds,
    COUNT(*) FILTER (WHERE m.motm_user_id = mp.profile_id) AS motms,
    COUNT(*) AS matches_played
  FROM matches m
  JOIN match_players mp ON mp.match_id = m.id
  JOIN profiles pr ON pr.id = mp.profile_id
  WHERE m.approved_at IS NOT NULL
    AND mp.profile_id IS NOT NULL
    AND pr.deleted_at IS NULL
  GROUP BY m.season_id, mp.profile_id, pr.display_name
),
scored AS (
  SELECT *, (wins * 3 + draws) AS points,                  -- Phase 3 awards ignore late-cancel penalties (different from leaderboard)
                                                           -- Rationale: awards celebrate match performance, not commitment hygiene
         (yellows + reds) AS total_cards
  FROM base
),
ballon_ranked AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY season_id
    ORDER BY points DESC, wins DESC, total_cards ASC, display_name ASC
  ) AS rn FROM scored
),
boot_ranked AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY season_id
    ORDER BY goals DESC, wins DESC, total_cards ASC, display_name ASC
  ) AS rn FROM scored
),
motm_ranked AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY season_id
    ORDER BY motms DESC, wins DESC, total_cards ASC, display_name ASC
  ) AS rn FROM scored
)
SELECT season_id, 'ballon_dor'::text AS award_kind,
       (SELECT profile_id FROM ballon_ranked b2 WHERE b2.season_id = b.season_id AND b2.rn = 1) AS winner_profile_id,
       (SELECT profile_id FROM ballon_ranked b2 WHERE b2.season_id = b.season_id AND b2.rn = 2) AS runner_up_profile_id,
       points::numeric AS metric_value,
       (SELECT points FROM ballon_ranked b2 WHERE b2.season_id = b.season_id AND b2.rn = 2)::numeric AS runner_up_metric,
       jsonb_build_object('wins', wins, 'draws', draws, 'losses', losses, 'matches_played', matches_played,
                          'win_pct', CASE WHEN matches_played > 0 THEN ROUND((wins::numeric / matches_played) * 100) ELSE 0 END) AS meta
FROM ballon_ranked b WHERE rn = 1
UNION ALL
SELECT season_id, 'golden_boot'::text AS award_kind,
       (SELECT profile_id FROM boot_ranked b2 WHERE b2.season_id = b.season_id AND b2.rn = 1) AS winner_profile_id,
       (SELECT profile_id FROM boot_ranked b2 WHERE b2.season_id = b.season_id AND b2.rn = 2) AS runner_up_profile_id,
       goals::numeric AS metric_value,
       (SELECT goals FROM boot_ranked b2 WHERE b2.season_id = b.season_id AND b2.rn = 2)::numeric AS runner_up_metric,
       jsonb_build_object('matches_played', matches_played,
                          'goals_per_match', CASE WHEN matches_played > 0 THEN ROUND(goals::numeric / matches_played, 2) ELSE 0 END) AS meta
FROM boot_ranked b WHERE rn = 1
UNION ALL
SELECT season_id, 'most_motm'::text AS award_kind,
       (SELECT profile_id FROM motm_ranked m2 WHERE m2.season_id = m.season_id AND m2.rn = 1) AS winner_profile_id,
       (SELECT profile_id FROM motm_ranked m2 WHERE m2.season_id = m.season_id AND m2.rn = 2) AS runner_up_profile_id,
       motms::numeric AS metric_value,
       (SELECT motms FROM motm_ranked m2 WHERE m2.season_id = m.season_id AND m2.rn = 2)::numeric AS runner_up_metric,
       jsonb_build_object('matches_played', matches_played) AS meta
FROM motm_ranked m WHERE rn = 1;

GRANT SELECT ON v_season_award_winners_live TO authenticated;
```

**Tie-break cascade** (applied identically to all 3 awards): `<award metric> DESC, wins DESC, total_cards ASC, display_name ASC`. Per user's pick during brainstorming. Single deterministic winner.

**Late-cancel penalties** intentionally excluded from the awards points formula (`wins*3 + draws` — no `late_cancel_points` term) — awards celebrate on-pitch performance, not roster discipline. Documented in spec; deliberately diverges from leaderboard's `points` column.

### New trigger function — `snapshot_season_awards_trigger`

```sql
CREATE OR REPLACE FUNCTION snapshot_season_awards_trigger() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only fire on transition: ended_at NULL → NOT NULL
  IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO season_awards (season_id, award_kind, winner_profile_id, runner_up_profile_id, metric_value, runner_up_metric, meta)
  SELECT season_id, award_kind, winner_profile_id, runner_up_profile_id, metric_value, runner_up_metric, meta
  FROM v_season_award_winners_live
  WHERE season_id = NEW.id
  ON CONFLICT (season_id, award_kind) DO NOTHING;
  -- ON CONFLICT DO NOTHING for idempotency — re-firing on a season already snapshotted is a no-op

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS season_awards_snapshot ON seasons;
CREATE TRIGGER season_awards_snapshot
  AFTER UPDATE OF ended_at ON seasons
  FOR EACH ROW
  EXECUTE FUNCTION snapshot_season_awards_trigger();
```

Three rows inserted per snapshot (one per award_kind). If a season has 0 matches at end-time, the view returns 0 rows and the INSERT … SELECT inserts 0 rows — that season simply gets no awards (no error). Wall of Fame skips empty rows naturally because `season_awards` has none for that season.

### Frontend queries

```ts
// Active season — read live view
const { data } = await supabase
  .from('v_season_award_winners_live')
  .select('award_kind, winner_profile_id, runner_up_profile_id, metric_value, runner_up_metric, meta')
  .eq('season_id', seasonId)

// Ended season — read snapshot table
const { data } = await supabase
  .from('season_awards')
  .select('award_kind, winner_profile_id, runner_up_profile_id, metric_value, runner_up_metric, meta, frozen_at')
  .eq('season_id', seasonId)

// Wall of Fame — read all snapshots, oldest-first then reverse client-side, OR direct DESC order
const { data } = await supabase
  .from('season_awards')
  .select('season_id, award_kind, winner_profile_id, profile:profiles!winner_profile_id(display_name), seasons!inner(name, starts_on, ended_at)')
  .order('seasons(ended_at)', { ascending: false })
```

For Wall of Fame display, frontend pivots the long-form rows into a row-per-season grid client-side (group by `season_id`, then assemble columns by `award_kind`). 3 rows per season in DB → 1 row per season on screen.

---

## 5. Frontend changes

### New screen — `ffc/src/pages/Awards.tsx` (~280 LOC)

- Single component, no sub-components beyond what already exists.
- State: `seasonId` (from URL), `season` (loaded), `liveOrSnapshot` (live for active, snapshot for ended), `wallOfFame` (always loaded).
- Loads in three parallel `Promise.all` queries: season metadata, current-season winners (view OR table), Wall of Fame.
- Season pill reuses `lb-dropdown` styling already shipped — add scoped `aw-` selectors but reference common `lb-dropdown` patterns where possible.
- All hero-name cells and Wall of Fame name cells are `<button onClick={() => navigate(...)}>` for proper tap accessibility.

### Routing — `ffc/src/App.tsx`

- Add `<Route path="/awards" element={<Awards />} />` inside the `RoleLayout`-wrapped `<Routes>` block (alongside Profile, Settings, Leaderboard).

### Leaderboard entry — `ffc/src/pages/Leaderboard.tsx`

- Add `TrophyIcon` SVG (matches `FilterIcon` / `SortIcon` pattern in same file)
- Add a third `<div className="lb-icon-wrap">` after the Sort wrap, containing a `<button>` with `className="lb-icon-btn lb-icon-btn--awards"` and `onClick={() => navigate('/awards?season_id=' + selectedSeasonId)}`.

### CSS — `ffc/src/index.css`

- New section `/* §3.24 Awards page (S053) */` adding `.aw-screen`, `.aw-h1`, `.aw-sub`, `.aw-season-pill-row`, `.aw-hero`, `.aw-hero-trophy`, `.aw-hero-name`, `.aw-hero-meta`, `.aw-hero-avatar`, `.aw-wall-section`, `.aw-wall-table-wrap`, `.aw-wall-row`, `.aw-wall-header`, `.aw-wall-season`, `.aw-wall-cell`, `.aw-wall-empty`. Approx 130 lines.
- Extend Leaderboard CSS: `.lb-icon-btn--awards` (gold-tinted variant) ~6 lines.

---

## 6. Verification plan

### DB spot-checks (before committing migration)

```sql
-- 1. View returns 3 rows per season with non-null winners
SELECT season_id, COUNT(*) FROM v_season_award_winners_live
GROUP BY season_id;
-- Expect: every season with ≥ 1 approved match has count = 3

-- 2. Ballon d'Or winner matches Leaderboard #1 (sanity)
SELECT vsa.winner_profile_id AS award_winner, vss.profile_id AS leaderboard_first
FROM v_season_award_winners_live vsa
JOIN (SELECT * FROM v_season_standings WHERE season_id = '<active-season>' ORDER BY points DESC, wins DESC LIMIT 1) vss
  ON vsa.season_id = '<active-season>'
WHERE vsa.award_kind = 'ballon_dor';
-- May differ if late-cancel penalties affect ordering — by design, awards ignore late_cancel_points

-- 3. Snapshot trigger fires on season-end
BEGIN;
UPDATE seasons SET ended_at = now() WHERE id = '<test-season-id>';
SELECT * FROM season_awards WHERE season_id = '<test-season-id>';
ROLLBACK;
-- Expect: 3 rows in season_awards (one per award_kind)

-- 4. Idempotency on re-fire
UPDATE seasons SET ended_at = ended_at + interval '1 second' WHERE id = '<already-ended>';
-- Expect: ON CONFLICT DO NOTHING — no error, no duplicate rows
```

### Live verification (auth-gated, post-deploy)

- [ ] `/leaderboard` shows new Trophy icon-btn after Filter + Sort, gold tint, glow
- [ ] Tap Trophy → navigates to `/awards?season_id=<current-leaderboard-season>`
- [ ] Awards page renders for active season: serif gold "Season N Awards" + "PROVISIONAL · Active" subtitle
- [ ] 3 hero cards render (Ballon d'Or / Golden Boot / Most MOTM) with correct winners + runner-ups + metrics
- [ ] Tap hero name → navigates to `/profile?profile_id=<winner-id>&season_id=<viewed>`
- [ ] Season pill opens dropdown listing all seasons; selecting changes the page content
- [ ] Picking an ended season: subtitle becomes "FINAL · Ended" + data sourced from `season_awards` table
- [ ] Wall of Fame shows ended seasons in tabular grid, most recent first
- [ ] Empty active season (0 matches): hero cards show greyed placeholder
- [ ] First-ever-season case: Wall of Fame shows placeholder
- [ ] Browser back returns to Leaderboard

### Build verification (commit gate)

- `node ./node_modules/typescript/bin/tsc -b` EXIT 0 (matches Vercel CI strict-build)
- `vite build` EXIT 0; PWA precache count incremented
- Migration applied via `npx supabase db push --linked`
- Types regen via `npx supabase gen types typescript --linked 2>/dev/null > ffc/src/lib/database.types.ts`

---

## 7. File-level change manifest

| File | Change | Approx LOC |
|---|---|---|
| `supabase/migrations/0047_phase3_awards.sql` | new | ~140 |
| `ffc/src/lib/database.types.ts` | regen (auto) | +20 (table + view types) |
| `ffc/src/pages/Awards.tsx` | new | ~280 |
| `ffc/src/pages/Leaderboard.tsx` | extend — TrophyIcon SVG + 3rd lb-icon-wrap | +25 |
| `ffc/src/App.tsx` | new route | +2 |
| `ffc/src/index.css` | new awards CSS section + lb-icon-btn--awards variant | +140 |

Total: 1 migration · 5 file diffs · ~600 net new LOC.

---

## 8. Risks & decisions

| Risk / decision | Resolution |
|---|---|
| Past seasons (S1–S10) won't be in `season_awards` table | Optional admin-triggered backfill RPC `backfill_season_awards()` — iterates ended seasons + INSERT … SELECT from view. Listed as a follow-up in §10, **not in initial ship**. Wall of Fame will be empty until a season ends naturally OR backfill runs. |
| Late-cancel penalties (in `v_season_standings.points`) vs awards points formula | Awards intentionally use `wins*3 + draws` (no `late_cancel_points`). Documented in spec + view comment. Awards aren't a duplicate of the leaderboard; they reward match performance, not commitment hygiene. |
| MOTM winner with 1 MOTM (low confidence) | Acceptable — the data is what it is. UI doesn't try to hide "weak" awards. |
| Tied winner | Single deterministic winner via tie-break cascade. `wins DESC, total_cards ASC, display_name ASC` after the primary metric. No co-winners. |
| Past winner soft-deleted | Snapshot row immutable (FK `ON DELETE RESTRICT`). Wall of Fame cell renders "Deleted player" muted. |
| Re-snapshotting a season after admin reverses `ended_at` | `ON CONFLICT DO NOTHING` makes re-fire a no-op. If admin DELETEs the snapshot rows + re-ends the season, fresh snapshot is taken (acceptable — admin action implies intent). |
| Awards row-level RLS | View inherits from underlying tables (already permissive for `authenticated` SELECT). Snapshot table — explicit `GRANT SELECT TO authenticated`. No INSERT/UPDATE/DELETE granted to `authenticated`; only the SECURITY DEFINER trigger writes. |
| `match_players.profile_id` confusion | Verified column name is `profile_id`, NOT `user_id`. Earlier scratch had this wrong. Fixed in this spec. (FFC convention is mixed: `match_players.profile_id`, `matches.motm_user_id` — different historical decisions.) |
| Performance on `v_season_award_winners_live` window-functions | FFC scale: 11 seasons × ~50 matches × ~14 player-rows = ~7700 base rows worst-case. Three ROW_NUMBER passes + correlated sub-selects → < 100 ms. Acceptable. |

---

## 9. Acceptance criteria

- [ ] Migration `0047_phase3_awards.sql` applies cleanly (`db push --linked` exit 0)
- [ ] Live DB has new `season_awards` table + `v_season_award_winners_live` view + `season_awards_snapshot` trigger
- [ ] `tsc -b` EXIT 0 + `vite build` EXIT 0 + types regenerated cleanly
- [ ] `/awards` route reachable from Leaderboard's new trophy icon-btn
- [ ] Active season shows hero cards from view; ended season shows hero cards from snapshot
- [ ] Wall of Fame lists ended seasons in tabular grid
- [ ] Hero name cells + Wall of Fame name cells navigate to correct profile + season
- [ ] Season pill switches between any season including archived ones
- [ ] Empty-season placeholder + first-season Wall of Fame placeholder both render correctly

---

## 10. Out-of-scope (Phase 3 follow-ups)

- Backfill RPC for past seasons (S1–S10) — admin-triggered manual fill
- WhatsApp share PNG of awards page (V3.0:140)
- Additional awards (Best Defender, Worst Discipline, etc.) — table CHECK constraint extends without schema change
- Player-comparison overlay or H2H — separately rejected this session
- Awards notification (push when season ends → "Season N awards are in!") — easy follow-up
