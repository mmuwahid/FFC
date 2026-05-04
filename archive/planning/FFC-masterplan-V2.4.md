# FFC Masterplan V2.4
**Date:** 19/APR/2026
**Session:** S004 (Phase 1 design, home PC) — captured at S005 start.
**Status:** Phase 1 design in progress. **Section 1 APPROVED. Section 2 Data Model APPROVED (full production DDL, all 5 parts).** Section 3 sub-sections 3.1–3.6 carry over from S002; full nav + remaining screens pending. Sections 4, 5, 6 pending.

---

## Revision history

### V2.4 (19/APR/2026, S004)
- **Section 1 (Architecture & Stack) formally approved.** Previously APPROVAL PENDING since S001.
- **Section 2 (Data Model) approved and written into the Phase 1 design spec** — all five parts: types + base entities, match data, poll + ref workflow, operational tables, views + SECURITY DEFINER functions + RLS policies.
- **Captain selection formula simplified** from the V2.0 5-criterion formula to a 3-criterion per-player formula + early-season randomizer + pair-level White=weaker rule (see §4 below).
- **Late-cancel penalty rules finalised** — 0 / −1 / −1 + 7-day ban by cancellation timing (see §6 below).
- **Scheduled reminder cron seed expanded** from 4 to 5 rows and times revised (see §7 below).
- **Two new captain-pick RPCs added** — `suggest_captain_pairs` (formula-based, returns ranked pairs) and `pick_captains_random` (early-season or admin "surprise me"). RPC count: 11 total.
- **matches lifecycle clarified** — `create_match_draft` inserts draft `matches` + `match_players` at admin team-entry; `approve_match_entry` only ever UPDATEs the existing draft. Enforced by `matches_one_per_matchday UNIQUE`.
- **Decisions Locked in spec** expanded from "see masterplan" stub to 13 enumerated items (8 from S003 + 5 from S004).
- **Open decision: pair-balance rule** (V2.0 criterion 4, ±5 league positions) surfaced — dropped in S004 simplification; revisit if pairings feel unbalanced in practice.

### V2.3 (2026-04-19, S003)
*(preserved — see `FFC-masterplan-V2.3.md`)*

### V2.2 (2026-04-19, S002 — batch 3)
Poll vote-order and waitlist priority via `voted_at` / `committed_at`. All 5 V2.1 assumptions confirmed.

### V2.1 (2026-04-19, S002 — batch 2)
Per-season last-5 strip. Multi-season + roster policy. Self-signup + admin approval + claim existing profile. Ref entry link + admin approval queue. +1 guest mechanic. Phase 4 nice-to-haves confirmed.

### V2.0 (2026-04-19, S002 — batch 1)
Initial captain selection formula (superseded by V2.4). Last-5 form indicator. Brand palette + logo + editorial crest direction.

### V1.0 (2026-04-17, S001)
Initial masterplan.

---

## 1. Concept
*(unchanged from V2.2)* — Mobile-first PWA for a 40+ player weekly 7v7 friends league. Replaces the current Excel + WhatsApp poll workflow with automated poll + vote-order + waitlist + +1 slots, captain-driven team draft (Phase 2), ref-driven match entry with admin approval queue, leaderboard with last-5 form indicator, seasons with end-of-season awards, WhatsApp-shareable result cards, and discipline/lateness rules enforcement (Phase 2).

## 2. Brand
*(unchanged from V2.0 — see V2.0 doc for full palette and logo reference)*

---

## 3. Decisions locked (cumulative)

**From V2.0–V2.3:** *(see prior doc versions)*.

**New in V2.4 (all from S004):**
- Section 1 Architecture & Stack approved.
- Section 2 Data Model approved (full production DDL).
- Captain formula simplified to 3 per-player criteria + randomizer + pair rule.
- Late-cancel penalty rules finalised.
- Scheduled reminder seed expanded to 5 rows with revised times.
- matches-lifecycle split into `create_match_draft` + `approve_match_entry`.

---

## 4. Captain Selection Formula (REVISED in V2.4 — supersedes V2.0)

Per-player eligibility requires **all three** booleans to be true. Thresholds are tunable at runtime via `app_settings.match_settings`:

| # | Criterion | Default threshold | Settings key |
|---|---|---|---|
| 1 | Minimum matches played this season | ≥ 5 | `captain_min_matches_this_season` |
| 2 | Attendance rate (yes-votes / total-votes) | ≥ 60 % | `captain_min_attendance_rate` |
| 3 | Cooldown: matchdays since last captained | ≥ 4 | `captain_cooldown_matchdays` |

**Removed from the V2.0 formula:**
- Red / yellow card gates — not gating criteria in V2.4.
- Positive-points gate — removed.
- "Knows the group" (played with every member) — removed.
- "Played in last 2 matchdays" — removed.
- Pair-balance ±5 league positions — removed (surfaced as open decision).

**Kept from V2.0:**
- **White = weaker captain pair rule.** When the admin picks two captains, the lower-ranked of the two (higher league-table position number) is assigned **White** and picks first. Enforced in application logic at pair-selection time, not in the view.

**Early-season randomizer fallback:**
- If the current season has fewer than `captain_min_matches_this_season` (default 5) **approved matchdays**, the admin Who-Can-Captain screen leads with a primary action **"Pick two captains randomly"** backed by RPC `pick_captains_random(matchday_id)`.
- That RPC picks uniformly at random from the locked-14 roster (ignores eligibility), and randomly assigns White/Black.
- Once ≥ 5 matchdays are played, the formula-driven helper (`suggest_captain_pairs`) leads, and the randomizer remains as a secondary "surprise me" option.

**Phase 1 scope:** the helper screen is **advisory only** — the admin makes the final pick regardless of what the suggestions say.

**Phase 2 scope:** automatic captain-pick on roster lock using the formula, with async draft initiation.

---

## 5. Teams, Draft, Match Result Entry
*(unchanged from V2.3)* — manual team entry in Phase 1. Ref entry via signed short-lived token. Single-user admin approval.

---

## 6. Scoring, Last-5 Form Indicator, Discipline & Punctuality (REVISED in V2.4)

**Scoring (unchanged from V2.0):** 3 pts win / 1 pt draw / 0 pts loss.

**Last-5 form indicator (unchanged from V2.1):** per-season, Option B letter-in-circle (W / D / L).

**Late-cancel penalties (REVISED in V2.4):**

| Cancellation timing | Point penalty | Additional action |
|---|---|---|
| Before `matchdays.roster_locked_at` | 0 | None — cancelling early is free. |
| After roster lock, outside 24h of kickoff | −1 point | None. |
| Within 24h of kickoff | −1 point | Insert a `player_bans` row: `starts_at = cancellation time`, `ends_at = starts_at + 7 days`, reason = `'late_cancel_within_24h'`. |

**Ban enforcement is Phase 2.** Phase 1 creates the `player_bans` row (data preserved), but `poll_votes` inserts do not yet check for active bans. Phase 2 will add the enforcement trigger.

**Previous V2.0–V2.3 rule (`-1` outside / `-2` within 24h) is superseded.**

**Settings keys** (`app_settings.match_settings`):
- `late_cancel_penalty_after_lock: -1`
- `late_cancel_penalty_within_24h: -1`
- `late_cancel_ban_days_within_24h: 7`

**Discipline cards, repeat-dropout:** unchanged from V2.1 — Phase 2+ scope.

---

## 7. WhatsApp Integration & Scheduled Reminders (REVISED in V2.4)

**Share on match results:** unchanged — auto-PNG → native share sheet, admin picks the WhatsApp group.

**Scheduled poll-link auto-post:** same Option A mechanism as V2.3 — cron fires → push notification to admins → admin taps → native share sheet opens with pre-filled template → admin picks the group.

**Seeded `scheduled_reminders` rows (5 total, Asia/Dubai, revised from V2.3's 4 rows):**

| Kind | Cron | Local time | Channels | Audience | Purpose |
|---|---|---|---|---|---|
| `poll_open_broadcast` | `0 17 * * 1` | Mon 17:00 | push, whatsapp_share | admins | Roll-call poll opens; admin shares to group. |
| `poll_cutoff_warning` | `0 21 * * 2` | Tue 21:00 | push | active_players | Nudge non-voters; poll closes tomorrow night. |
| `plus_one_unlock_broadcast` | `0 20 * * 3` | Wed 20:00 | push, whatsapp_share | admins | +1 slots unlock if roster < 14. |
| `teams_post_reminder` | `0 22 * * 3` | Wed 22:00 | push | admins | Complete team selection tonight; Thursday is hard fallback. |
| `teams_post_reminder` | `0 12 * * 4` | Thu 12:00 | push | admins | Fallback — last chance before kickoff (~8h away). |

All rows are DB-editable — admins adjust `cron_expression` and `enabled` without a redeploy. Super-admin-only to create or delete.

---

## 8. Push Notifications (unchanged from V2.3)
13 triggers total — unchanged count. `weekly_poll_reminder_sent` (trigger #11) is now the NEW fan-out path sourced from the Monday 17:00 seeded reminder.

---

## 9. Phases
*(unchanged structure — Phase 1 scope expanded in V2.3; V2.4 does not change Phase 1 scope)*.

**Phase 1 — Core Weekly Cycle:** self-signup + admin approval; seasons with carry-forward and archive; poll with vote-order + lock + waitlist + +1 slots; captain helper (advisory, with randomizer fallback); ref entry link + approval queue; leaderboard + last-5 + player profile; share PNG; admin dashboards; super-admin tier; scheduled reminders with semi-manual WhatsApp auto-post.

**Phase 2 — Draft & Discipline:** automatic captain-pick + async draft; ban enforcement on `poll_votes` insert; full discipline & lateness automation.

**Phase 3 — Seasons & Awards:** matchday counter, auto season-close, awards page, winners wall, WhatsApp Cloud API re-evaluation.

**Phase 4 — Extras:** H2H, deep form guide, payment tracking, badges, injury list.

---

## 10. Open decisions (revised after S004)
- ~~Captain selection formula~~ — **RESOLVED** in S002, **SIMPLIFIED** in S004.
- ~~Late-cancel point penalty exact number~~ — **RESOLVED** in S004.

Remaining:
1. "Repeat dropout" threshold (Phase 2+).
2. Snake-draft vs simple alternating order (Phase 2).
3. Best Goalie mechanism.
4. Phase 2 admin override window after auto-captain-pick.
5. Share PNG style — reuse 3.2 last-5 circle treatment? (Section 5.)
6. **NEW:** Pair-balance rule (V2.0 criterion 4, ±5 positions) — dropped in S004; revisit if pairings feel unbalanced in practice.

---

## 11. Next steps
- S005 (this session): open Section 3 (Screens & Navigation) — full nav + admin-dashboard family + captain-helper reconciliation + remaining Phase 1 screen inventory + mockup list.
- S006+: Section 4 (Key Flows), Section 5 (Notifications & Share PNG), Section 6 (Open Decisions handoff).
- After Section 6: spec self-review, user approval, then Phase 1 implementation plan via `superpowers:write-plan`.
