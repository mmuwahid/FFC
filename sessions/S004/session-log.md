# Session S004 — Section 2 Data Model complete + Section 1 approved

**Date:** 19/APR/2026
**PC:** Home
**Duration:** one working session continuing directly from S003 close.
**Prior session:** S003 — Parts 1–3 DDL approved; admin/super-admin/archive/WhatsApp scope added.

---

## Summary
Closed out Section 2 (Data Model). **Parts 4 and 5 (5A views, 5B RPCs, 5C RLS) all approved.** Full Section 2 written into the Phase 1 design spec (spec grew from 324 → ~1150 lines). Self-review surfaced four real issues that were fixed inline. User reviewed and applied four late refinements (cron schedule revision, late-cancel penalty revision, captain formula simplification, Section 1 formal approval). Masterplan bump to V2.4 queued for S005.

## What got done

### Part 4 — Operational tables (approved)
- `notifications` — fan-out-on-write event log per recipient. Unread index, read-state tracking, push dispatch columns.
- `player_bans` — schema only; enforcement deferred to Phase 2. Valid-range and revoke-consistency CHECK constraints.
- `push_subscriptions` — Web Push endpoints; `disabled_at` on 410 Gone instead of deletion.
- `app_settings` — super-admin-writable key/value JSON store. Four seeded keys: whatsapp_group_link, whatsapp_share_templates (4 template strings), match_settings, season_settings.
- `scheduled_reminders` — `pg_cron`-driven; admin-editable cron expressions; 5 seeded rows (Mon 17:00 roll-call, Tue 21:00 nudge, Wed 20:00 +1 unlock, Wed 22:00 team selection, Thu 12:00 fallback).

### Part 5A — Views (approved)
- `v_match_commitments` — UNION of active poll_votes and match_guests for 14-slot ordering.
- `v_season_standings` — leaderboard with W/D/L/goals/yellows/reds/MOTM + late-cancel-points. Guests excluded (not in match_players with profile_id).
- `v_player_last5` — per-season last 5 match W/D/L letters for the form strip.
- `v_captain_eligibility` — rewritten twice: first with fabricated 5 criteria (flagged in self-review), then per user's S004 formula — three per-player criteria (≥5 matches, ≥60% attendance, ≥4 matchday cooldown), thresholds read from `app_settings.match_settings`.

### Part 5B — SECURITY DEFINER functions (approved, expanded)
Eleven RPCs total (9 initial + 2 captain-pick helpers added at session close):
1. `submit_ref_entry` (anon-callable, token-gated)
2. `create_match_draft` (admin; team-entry; inserts draft matches + match_players)
3. `approve_match_entry` (admin; UPDATEs existing draft — self-review fix)
4. `reject_match_entry` (admin; re-arms ref token)
5. `approve_signup` (admin; new-or-claim-existing)
6. `reject_signup` (admin; triggers polite-rejection email)
7. `promote_admin` / `demote_admin` (super_admin)
8. `archive_season` (admin; enforces end-before-archive)
9. `fire_scheduled_reminder` (pg_cron only)
10. `suggest_captain_pairs` (admin; formula-based, returns 5 ranked pairs)
11. `pick_captains_random` (admin; early-season randomizer from locked-14)

### Part 5C — RLS policies (approved)
- Matrix for 16 tables × 3 effective roles documented.
- Hard anon boundary via `REVOKE ALL ON ALL TABLES FROM anon`; anon surface is `submit_ref_entry` only.
- `profiles.role` frozen via WITH CHECK on own-update; role changes ONLY through `promote_admin`/`demote_admin`.
- Admins can toggle/edit scheduled_reminders but cannot create or delete (super-admin-only).
- STABLE SECURITY DEFINER helpers (`current_user_role`, `current_profile_id`, `is_admin`, `is_super_admin`) avoid recursive RLS on profiles.

### Spec self-review — four issues fixed inline
1. **Column-name drift** between Section 3 (written S002, tentative names) and Section 2 DDL (final). Added authoritative reconciliation table. Renames: `poll_votes.voted_at → committed_at`, `match_guests.inviter_user_id → inviter_id`, `match_guests.guest_display_name → display_name`. Guest goal-counter clarified to live on `match_players` (rows with `guest_id` set).
2. **Missing `create_match_draft` RPC.** S003 locked "draft at team-entry, flipped on ref approval" but `approve_match_entry` was written as INSERT — would violate `matches_one_per_matchday UNIQUE`. Split into CREATE (draft) + UPDATE (approve). RPC count went from 8 → 9.
3. **Missing Postgres extensions** — `pgcrypto` (ref-token sha256) and `pg_cron` (scheduled reminders). Added `CREATE EXTENSION IF NOT EXISTS` to migration 0001 preamble notes.
4. **Decisions Locked section** was bare — expanded to list 13 locked decisions across S003 + S004 instead of pointing to the masterplan only.

### User-driven refinements at session close
1. **Section 1 (Architecture & Stack)** — formally approved (heading flipped from APPROVAL PENDING → APPROVED, 19/APR/2026, S004).
2. **Cron schedule revised** (5 seeded rows now):
   - Mon 17:00 — roll-call poll opens (was 20:00).
   - Tue 21:00 — nudge non-voters (unchanged).
   - Wed 20:00 — +1 slots unlock if not full (was 20:15).
   - Wed 22:00 — complete team selection tonight (NEW).
   - Thu 12:00 — last-chance fallback before kickoff (was 15:00).
3. **Late-cancel penalties revised:**
   - Before roster lock → 0.
   - After lock, outside 24h → −1 point.
   - Within 24h → −1 point + 7-day `player_bans` row (enforcement Phase 2).
   - Replaced prior −1/−2 split. Penalty CTE in `v_season_standings` updated with commented rationale.
4. **Captain formula simplified** from V2.0 five-criterion to S004 three-criterion:
   - Kept: min matches (≥5), attendance (≥60%), cooldown (≥4 matchdays).
   - Dropped: red/yellow card gates, positive points, "knows every member", "played last 2".
   - Kept as pair-level app logic: White = weaker captain.
   - Added: early-season randomizer (`pick_captains_random`) auto-promoted to primary action when season has <5 approved matchdays.
   - Pair balance (±5 positions) not enforced — surfaced as open decision #6 for future revisit.

## Architectural decisions locked in S004
- **9.** Part 4 operational tables approved as posted.
- **10.** Views remain non-materialized (regular views) — performance is fine at FFC scale.
- **11.** RPC count = 11 final; split team-entry (create_match_draft) from approval (approve_match_entry).
- **12.** RLS matrix per table per role frozen; anon = RPC-only; role column frozen against self-update.
- **13.** Section 1 Architecture & Stack formally approved (previously APPROVAL PENDING since S001).

## Files modified
- `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` — Section 1 heading flipped to APPROVED; Section 2 written from scratch (Parts 1–5 full DDL) replacing prior placeholder; Decisions Locked expanded; Open Decisions updated. Grew from 324 → ~1150 lines.
- `sessions/S004/session-log.md` — this file.
- `tasks/todo.md` — will be updated as final closure step.
- `sessions/INDEX.md` — will be updated.
- `CLAUDE.md` — latest session block will be bumped to S004.

## Memory
No new memories saved. Existing two auto-load in S005:
- `feedback_browser_companion_usage.md` (Visual Companion for genuine visuals only)
- `user_date_format.md` (DD/MMM/YYYY)

## Open decisions remaining (revised after S004)
1. "Repeat dropout" threshold (Phase 2+).
2. Snake-draft vs simple alternating (Phase 2).
3. Best Goalie mechanism.
4. Phase 2 admin override window.
5. Share PNG style (Section 5).
6. **NEW:** Pair-balance rule (dropped in S004; revisit if pairings feel unbalanced in practice).

## Handoff notes for S005
- **Resume at masterplan V2.4.** Document the S004 refinements (simplified captain formula, revised penalties, 5-row reminder seed, 2 new captain-pick RPCs, Section 1 approval). V2.3 remains preserved.
- **Then Section 3 (Screens & Navigation).** Write full nav (bottom nav, route list, info architecture), the admin-dashboard family (players, matches, seasons, admins, schedule — 5 screens), the captain-helper screen (Section 3.1 — reconcile text with new 3-criterion formula + randomizer UX), and the remaining Phase 1 screen inventory.
- **After Section 3:** Section 4 (Key Flows — cross-cutting sequences), Section 5 (Notifications + Share PNG), Section 6 (Open Decisions handoff).
- **Mockup-first rule applies from Section 3 onward** — every screen gets an HTML mockup in `mockups/` before any code.
- No git repo yet. Still OneDrive sync.
