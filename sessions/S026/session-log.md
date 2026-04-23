# Session Log — S026 — Poll §3.7 Depth-B + Leaderboard Gate + Phase 2 Seed

**Date:** 23/APR/2026
**PC:** Work (UNHOEC03)
**Type:** Build
**Phase:** Phase 1 · Step 4 of V2.8 · Slice 7
**Duration:** Long (single-sitting bundle — 5 scope items + migrations)
**Commits:** `45383bc`
**Live:** https://ffc-gilt.vercel.app (deploy `dpl_4pL9QyCsipwsF6ZVAeXdLWXYEr1a` READY)

---

## What Was Done

### Cold-start
- Work PC `.git` pointer correct (`C:/Users/UNHOEC03/FFC-git`), `main = origin/main` clean at `d1ec173` (S025 close).
- User directive: "jump straight to points 2-6 onward, we will code everything then test at the end." Same pattern as S025 — ship the bundle, single live acceptance pass at end.

### Point 2 · §3.5 guest auto-flag trigger (migration 0017)
- New app_settings row `guest_friendly_thresholds` = `{ "7v7": 4, "5v5": 3 }` (tunable without redeploy).
- New SECURITY DEFINER function `match_guests_friendly_flag_trg()` — stamps `matchdays.friendly_flagged_at = now()` when active guest count reaches threshold for the effective format.
- Trigger `trg_match_guests_friendly_flag` on `match_guests` AFTER INSERT/UPDATE OF cancelled_at — re-entry safe (short-circuits on already-flagged or already-confirmed matchdays).
- Does NOT set `is_friendly` — admin still confirms via §3.18 review card.

### Point 5 · `edit_match_players` RPC (migration 0018)
- Phase 2 seed — admin-only, audited, whitelisted stat patch on already-approved matches.
- Signature: `edit_match_players(p_match_id uuid, p_players jsonb)` where each element has `profile_id XOR guest_id` + any of `goals/yellow_cards/red_cards/is_no_show/is_captain/team`.
- Enforces `is_admin()`, approved-match check, XOR participant identity. Per-row + summary audit logs via `log_admin_action`.
- Skips unknown rows rather than erroring — returns `{updated, skipped, match_id}`.

### Point 3 · Poll RPCs (migration 0019)
- `cast_poll_vote(p_matchday_id uuid, p_choice text)` — idempotent upsert. Re-voting YES after cancel resets `committed_at` (anti-seat-hoarding). Cancel is soft-delete via `cancelled_at`. Raises `FFC_PROFILE_BANNED` for active `player_bans` rows, `FFC_PROFILE_BANNED_OR_REJECTED` for `role='rejected'` / `is_active=false` profiles.
- `invite_guest(matchday_id, display_name, primary, secondary, stamina, accuracy, rating, description)` — confirmed-only callers, validates slot availability against `roster_cap(effective_format(...))`. Positions-differ + description-length checks. Raises `FFC_NO_GUEST_SLOT`, `FFC_INVITER_NOT_CONFIRMED`.

### Point 3 · Poll.tsx Depth-B (765 lines, replaces 9-line stub)
- All 9 states render from one state machine driven by live data:
  - Pre-open (countdown)
  - Open · not voted (Yes/Maybe/No tri-button)
  - Open · voted YES confirmed (spot #N + Cancel)
  - Open · voted YES waitlisted (amber + Cancel)
  - Guest slots open (+1 CTA active when unlocked)
  - Roster locked (danger strip + pre-penalty cancel)
  - Draft in progress (split ⚪/⚫/Available, picking-team header pulses)
  - Teams revealed (two-section ⚪ WHITE · ⚫ BLACK)
  - Penalty sheet (modal reads `app_settings.match_settings`)
- Realtime subscription: `poll_votes` · `match_guests` · `matchdays` · `draft_sessions` · `match_players` → `loadAll()` on any event for this matchday.
- Guest invite sheet: 5 required chip groups (primary pos · stamina · accuracy · rating) + optional secondary pos + 140-char description.
- Member row → `/profile?profile_id=…`; guest row → inline accordion expand for full description.
- Matchday hero · format chip (7v7/5v5) · pending-friendly-review amber flag.

### Point 4 · Leaderboard Depth-B gate
- `loadSeason(seasonId, mode)` extracted as reusable callback (used by realtime + PTR).
- Realtime subscription on `matches` + `match_players` (any change → `refresh` mode load).
- Pull-to-refresh: touch handlers at `scrollTop=0`, easing × 0.5 resistance curve, 70-px arm threshold, "↓ Pull / ↑ Release / ↻ Refreshing" states.
- Skeleton rows (6) with shimmer keyframe replacing the plain "Loading…" text. 150-ms minimum hold to prevent flash.
- `.lb-body { overflow-y: auto }` added so PTR doesn't hijack page scroll.

### Point 5 · UI on Edit Result sheet
- `ResultEditSheet` now has `[✎ Edit player stats]` toggle. Off = events-only view (preserves S025 behavior). On = all rostered players + per-row inline inputs.
- Inline editor per row: goals (int), yellow_cards (0-2), red_cards (0-1), (C) toggle, NS toggle.
- Local patch state `patches: Record<mp.id, PlayerPatch>` + dirty counter displayed.
- Save button: `edit_match_result` first (score/MOTM/notes), then `edit_match_players` with the batched payload if any patches exist.

### Point 6 · §3.18 Phase 5.5 Draft-in-progress card
- New `DraftInfo` type + `draft` field on `MatchdayWithMatch`.
- `loadAll` extended: parallel fetch of `draft_sessions WHERE status='in_progress'` + `draft_picks` count + triggerer profile name.
- `phaseLabel` returns "Phase 5.5 · Draft in progress" (warn tone) when a draft is active, above the `roster_locked` fallback.
- `DraftInProgressCard` component inline on MatchdayCard: pulsing amber dot, pick-count / picker team / started-by captain / elapsed time. `reroll_after_dropout` reason surfaces a red warning row.
- Stuck threshold: 6h elapsed → exposes **Force complete** / **Abandon draft** buttons (disabled — `admin_draft_force_complete` / `admin_draft_abandon` RPCs deferred to Phase 2).

### Build + Deploy
- All 3 migrations applied via `supabase db push --linked --include-all` (no errors; 0016 trigger NOTICE is the drop-if-exists first-run fallback).
- Types regen: 1895 → 1916 lines (new RPC signatures).
- `tsc -b --noEmit` clean. `vite build` clean in 186ms — 72 KB CSS, 629 KB JS, PWA precache 10 entries.
- Single commit `45383bc`: +2047/-74 lines across 8 files.
- Vercel auto-deploy `dpl_4pL9QyCsipwsF6ZVAeXdLWXYEr1a` READY.

### Post-deploy smoke
- Dev server unauthenticated, Poll + Leaderboard routes loaded clean. PostgREST queries fire with correct column sets (verified `matchdays?select=id,kickoff_at,venue,poll_opens_at,poll_closes_at,roster_locked_at,format,friendly_flagged_at,is_friendly`). 401s expected (no session). No 500s, no column-not-found, no enum-mismatch errors.

---

## Files Created or Modified

### Commit 45383bc (8 files, +2047/-74)
- `supabase/migrations/0017_guest_friendly_flag.sql` — **NEW** (app_settings + trigger fn + trigger)
- `supabase/migrations/0018_edit_match_players.sql` — **NEW** (whitelisted stat patch RPC)
- `supabase/migrations/0019_poll_rpcs.sql` — **NEW** (cast_poll_vote + invite_guest)
- `ffc/src/lib/database.types.ts` — regen (+21 lines)
- `ffc/src/pages/Poll.tsx` — stub (9 lines) → Depth-B (765 lines)
- `ffc/src/pages/Leaderboard.tsx` — realtime + PTR + skeleton (+127 lines)
- `ffc/src/pages/admin/AdminMatches.tsx` — edit_match_players UI + Phase 5.5 card (+226 lines)
- `ffc/src/index.css` — po-* + admin-draft-* + admin-mp-* + lb-skel/ptr namespaces (+347 lines)

---

## Key Decisions

- **Bundle all 5 points, single commit** — user opted-in to S025's "ship 90% then test live" pattern over step-by-step walkthroughs. Trade-off: larger blast radius if something breaks; payoff: one deploy cycle, one testing pass.
- **`v_match_commitments` guest mapping via display_name** — the view surface doesn't expose `match_guests.id`; Poll matches on `display_name` to find the corresponding guest row. Acceptable for Phase-1 scale; flag for follow-up if two guests share a name. **Proper fix:** expand the view to carry `match_guests.id` (or commit_id generic).
- **Phase 5.5 override buttons rendered disabled** — kept the UI affordance visible so admins know the shape of the escape hatch, but `admin_draft_force_complete` / `admin_draft_abandon` RPCs are Phase-2 scope (requires careful state-machine reasoning across `draft_sessions` + `match_players.team` + notifications). Not blocking Phase 1 since the captain-draft flow isn't shipped yet.
- **Captain reroll modal punted** — S010 subagent-B spec covers it. Would add another ~150 lines to Poll.tsx and requires `dropout_after_lock` notification flow. Flagged as S027+.
- **`cast_poll_vote` handles 'cancel' as a valid input** despite `poll_choice` enum having only yes/no/maybe — RPC branches on the string value before the enum cast. Cleaner than a separate `cancel_poll_vote` RPC.

---

## Open Questions
- **Friendly-threshold default of 4/3** — user's current FFC practice. Want this documented in §3 or left as an admin-tunable with default? *(Low urgency.)*
- **Poll guest-row tap behavior** — spec says "long-press reveals admin-only Edit guest sheet"; Phase-1 UI uses simple tap for description accordion. Admin edit still lives on §3.18. No change needed, just confirming. *(Resolved — no action.)*

---

## Lessons Learned

### Mistakes
| Date | Mistake | Root Cause | Prevention Rule |
|------|---------|------------|-----------------|
| 2026-04-23 | First draft of `cast_poll_vote` referenced `profiles.banned_until_matchday_id` as if it existed. | Assumed schema from §3 narrative without grepping `information_schema.columns`. The ban is actually a separate `player_bans` table with `starts_at`/`ends_at`/`revoked_at`. | **Before writing any ban check, query `\d profiles` + `\d player_bans` (or equivalent `information_schema` lookups).** Caught pre-migration via column query — would have failed at RPC execution if pushed blind. |
| 2026-04-23 | Initial poll guest-row rendering relied on matching `match_guests.id` from the `v_match_commitments` view, but the view only exposes `guest_display_name`. | View schema narrower than the underlying tables. Spec §3.6 described UNION semantics without calling out that `match_guests.id` is NOT in the projection. | **When a view is "the single source of truth" per a spec, still query `information_schema.columns` on the view — the selected columns may be a subset of what the underlying tables expose.** Phase-1 workaround uses display_name matching (acceptable at scale); long-term fix is extending the view. |

### Validated Patterns
- [2026-04-23] **Migration-first scaffold for multi-point builds** — Writing the 3 SQL migrations + applying them + regenerating types *before* touching any React file meant the new RPC signatures showed up in `Database['public']['Functions']` when I wrote Poll.tsx. TypeScript caught one typo immediately (`p_matchday_id` vs `p_md_id` on my first draft). **Why worth remembering:** Spec-level confidence that RPCs exist + are typed before UI writes starts. Saved one round-trip.
- [2026-04-23] **`loadSeason(mode: 'initial' | 'refresh')` callback pattern** — Extracted the Leaderboard useEffect body into a reusable callback with a mode flag. Realtime subscription + PTR handler + initial mount all share the same query logic. **Why worth remembering:** Cleaner than duplicating queries across 3 code paths; the `mode` flag gates skeleton-clear vs refresh-spinner UX. Same pattern applies to any screen that needs realtime + pull-to-refresh.
- [2026-04-23] **State-machine Poll rendering from live data alone** — No route-level state, no explicit state-tag field on Matchday. All 9 states derive from: `(now vs poll_opens_at/poll_closes_at)` × `(myVote state)` × `(roster_locked_at)` × `(draft.status)` × `(commitments[].team)`. **Why worth remembering:** Eliminates an entire category of "state drift" bugs where a session holds a stale state enum. Realtime + render-derived state = self-correcting UI.
- [2026-04-23] **"Phase 2 seed" commit pattern** — Migration 0018 (`edit_match_players` RPC) + UI wiring in the same session, but only the shallow-risk path (whitelisted column patches, no FK changes). Phase 2 full scope (captain reroll, draft force-complete RPCs) deferred. **Why worth remembering:** Lets Phase 1 ship more-capable admin tooling without committing to Phase-2 state-machine complexity. Low-blast-radius RPCs with audit trails are safe to land ahead of schedule.

---

## Next Actions
- [ ] **Live testing pass** on https://ffc-gilt.vercel.app — user owns, on their schedule. 5 feature areas (see S026 close summary in chat).
- [ ] **Friendly-review end-to-end exercise** (carry from S025 todo) — SQL insert guests → verify trigger fires → confirm via AdminMatches review card → confirm it excludes from `v_season_standings`.
- [ ] **Captain reroll modal** (S010 subagent-B spec) — next major Poll addition once dropout_after_lock notification flow exists.
- [ ] **`admin_draft_force_complete` + `admin_draft_abandon` RPCs** — unblocks Phase 5.5 override buttons.
- [ ] **§3.1-v2 captain-draft picker UI** — multi-session; once shipped, Phase 5.5 card + Poll State 6.5 get real data to exercise.
- [ ] **`v_match_commitments` view extension** — add `match_guests.id` to the guest branch so Poll doesn't have to match by display_name.

---

## Commits and Deploy
- **Commit:** `45383bc` — feat(S026): Poll §3.7 Depth-B + Leaderboard gate + Phase 2 stat-edit seed
- **Migrations live on DB:** 19 (0001 → 0019_poll_rpcs). Was 16 at S025 close.
- **Deploy:** `dpl_4pL9QyCsipwsF6ZVAeXdLWXYEr1a` READY at https://ffc-gilt.vercel.app

---
_Session logged: 2026-04-23 | FFC S026 close_
