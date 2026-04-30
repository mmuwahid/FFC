# Session 059 — Live ref access flow + Poll team-split fix + matchday delete

**Date:** 30/APR/2026
**PC:** Work (UNHOEC03)
**Tip on close:** `e960df2` (3 commits this session)
**Live DB:** 58 → 63 migrations (added 0061, 0062, 0063; retroactively recorded 0060 `seasons_games_seeded` which was already on remote but missing from local history)

---

## What we set out to do

User's opening: *"now that we have a match scheduled for today and the roster is locked. how do i give the ref access to kick off the game with the countdown timer and goals scored live during game to tag timings also. i dont see a way to do it now from the app. we already built the entire workflow and mockup but i dont see it in live app"*

Plan was just to point at the existing S051/S058 ref-link flow. Session expanded into 4 fixes after each step uncovered a deeper bug.

No NEXT-SESSION-S059 agenda items (payment tracker) touched — those are still pending for S060.

---

## Phase A — diagnose ref-link visibility

The ref-link flow exists in `AdminMatches.tsx:718` gated `{locked && (...)}`. User reported tapping "Lock roster" wasn't visible on Apr 30 either. Investigation:

- Apr 30 card showed **"RESULT PENDING APPROVAL"** with `Review / approve` button.
- Per `AdminMatches.tsx:108` `if (md.match) return { text: 'Result pending approval', ... }` — that means ANY `matches` row, approved or not, shows that badge.
- User clicked Review/approve — opened **EditResultSheet** (NOT MatchEntryReview). That confirmed Apr 30 had a `matches` row, NOT a `pending_match_entries` row from a ref submission.
- Root cause: user accidentally entered Apr 23 results against Apr 30's matchday earlier in the day. Apr 23 was already correct; Apr 30 had a stray draft match attached.
- **Gap found:** S058 Delete-match button was gated `{approved && md.match && (...)}` so for an UNAPPROVED match (the Apr 30 case) there was no delete UI. Built `admin_delete_match` already supports both states; only the UI gate was wrong.

---

## Phase B — `2c10cb7` — delete-matchday RPC + UI + relaxed delete-match gate

**5 files changed, +228/−10. Migration 0061 applied to live DB.**

- **Migration `0061_admin_delete_matchday.sql`** — `admin_delete_matchday(p_matchday_id)` SECURITY DEFINER:
  - `is_admin()` body guard + REVOKE FROM PUBLIC + GRANT TO authenticated (CLAUDE.md rule).
  - Refuses if any `matches` row exists for the matchday (FK is RESTRICT — DELETE would error anyway, but we want a clear actionable error).
  - Audit log entry BEFORE destructive op (S034/S049/S054/S055/S058 pattern).
  - `DELETE FROM matchdays` cascades through `poll_votes`, `ref_tokens`, `pending_match_entries`, `draft_sessions` (+`draft_picks`), `formations`, `match_guests`.
  - Migration filename collision: a stray `0060_seasons_games_seeded.sql` existed locally but had been applied to remote (reflected in commit `bb13127` `games_seeded` polish). Resolved by `npx supabase migration repair --status applied 0060 --linked` then renaming new file to `0061`.

- **`AdminRosterSetup.tsx`** — Delete button on Saved-state footer next to Edit:
  - New state: `deleteSheet`, `deleteConfirm`, `deleteBusy`.
  - `handleDeleteMatchday()` calls `admin_delete_matchday`, drops md from local `matchdays`, clears `selectedMdId`, navigates back to `/admin/matches`.
  - Type-DELETE confirm sheet with strict gate (`deleteConfirm.trim().toUpperCase() === 'DELETE'`).

- **`AdminMatches.tsx`** — relaxed delete-match button gate:
  - Was `{approved && md.match && <Edit roster + Delete match>}`.
  - Now: `{approved && md.match && <Edit roster>}` + `{md.match && <Delete match>}` — Delete shows for ANY match row (approved or not). Edit roster stays approved-only since it operates on populated `match_players`.

- **`index.css`** — new `.rs-btn--danger` (red flex-0.35 button) + `.rs-sheet-btn--danger` (filled red) classes.

- **Verification:** `tsc -b` EXIT 0; preview server snapshot confirmed Delete button renders next to Edit on the Saved-state footer; sheet opens with title "Delete matchday?" on click; cancel closes overlay cleanly.

---

## Phase C — `2a955ac` — Poll team-split scrambled bug + admin_delete_matchday v2

User cleared Apr 30 stray match via the new Delete-match button; locked the roster manually; ref link button appeared. Then they noticed **Poll showed WHITE 6 / BLACK 8** vs Roster Setup's WHITE 7 / BLACK 7 with players on completely different teams (Karim Hamdan was WHITE in Roster Setup but BLACK in Poll, etc).

Also reported: tapping Delete on May 7 in Roster Setup didn't remove the matchday — it stayed in the Upcoming list with Edit/Lock options.

**Two distinct root causes:**

### Issue A — Poll team-split bug

`Poll.tsx:274-277` query:
```ts
const { data: mps } = await supabase
  .from('match_players')
  .select('profile_id, guest_id, team, is_captain')
  .in('profile_id', memberIds.length ? memberIds : ['00000000-...'])
```

**No `.eq('match_id', …)` filter.** The query returned every `match_players` row across every match these players had ever been in. Then `mpMap.set(profile_id, …)` overwrote with whichever row PostgREST returned last — randomising team assignments. Same bug for guest-side query at line 281-287.

Audit via `grep -rn "from('match_players')"` confirmed Poll was the only offender — FormationPlanner, MatchDetailSheet, AdminMatches, AdminRosterSetup, CaptainHelper, Profile all already scoped by `match_id`.

Fix: scoped both queries to `matchRow.id`, with defensive skip if no draft match exists.

### Issue B — admin_delete_matchday refusing draft matches

Saving a roster via AdminRosterSetup calls `create_match_draft` which inserts an unapproved `matches` row. Migration 0061's `admin_delete_matchday` refused unconditionally on any matches row → user's "delete" silently errored, matchday stayed.

**Migration `0062_admin_delete_matchday_v2.sql`** — `CREATE OR REPLACE FUNCTION` updates the body:
- Now checks `approved_at` on the attached match.
- If UNAPPROVED: clears `match_payment_records` + `payment_windows` (NO ACTION FKs, defensive even though empty for drafts), then `DELETE FROM matches WHERE id = v_match_id` (cascades match_players + match_events), then deletes the matchday.
- If APPROVED: refuses with `matchday_has_approved_match_use_admin_delete_match` and HINT pointing at Admin → Matches.
- Mental-model alignment: "Delete matchday" now means "nuke everything attached to it" not "refuse if anything is attached".

**Verification:**
- `tsc -b` EXIT 0
- Migration 0062 applied
- Preview HMR'd Poll.tsx; team headers flipped to WHITE 7 / BLACK 7; player-name dump confirmed exact match against Roster Setup (Latif/Karim Hamdan/Firas/Noz/Anas/Ziad/Chaos on white; Abood/Rawad/Moataz/Moe Hamdan/Saz/Arek/Omar on black).

---

## Phase D — `e960df2` — slot_index column + Poll polish + topbar Delete

User next-up feedback after Phase C verification:
1. Numbers next to player names in Poll — those are commitment-order ranks, not required, looks like shirt numbers.
2. Captain should be CLEAR in Poll.
3. Order/list of team members should match Roster Setup exactly.
4. Issue B follow-up: still no Delete option on May 7's POOL phase (button I'd added was Saved-phase only).

### Item 4 first — topbar Delete

Added `🗑` button to `.rs-topbar` (always visible when `selectedMdId && !isReadOnly`). New `.rs-topbar-delete` CSS — red rounded-rect with subtle border. Reachable from Pool / Teams / Saved phases.

### Items 1-3 — Poll team-list polish

First pass tried sorting `match_players` by `created_at, id`. Verification showed order STILL didn't match Roster Setup. Diagnosis: `create_match_draft` does a `FOREACH … LOOP INSERT` in a single transaction. PG's `now()` returns transaction-start time so every row has the same `created_at`. Tiebreaker by `id` (uuid) is random.

**Migration `0063_match_players_slot_index.sql`** — proper fix:
1. `ALTER TABLE match_players ADD COLUMN slot_index integer` (nullable; new rows set it).
2. Backfill via `ROW_NUMBER() OVER (PARTITION BY match_id, team ORDER BY created_at, id)` — best-effort; for rows that share `created_at` (which is most pre-0063 inserts) this falls back to uuid order.
3. `CREATE INDEX match_players_slot_idx ON (match_id, team, slot_index)`.
4. `CREATE OR REPLACE FUNCTION create_match_draft(...)` — sets `slot_index` from per-team 1-based counter as it iterates input arrays.
5. `CREATE OR REPLACE FUNCTION admin_update_match_draft(...)` — same pattern.
6. `CREATE OR REPLACE FUNCTION admin_edit_match_roster(...)` — uses `WITH ORDINALITY` + `ROW_NUMBER() OVER (PARTITION BY elem->>'team' ORDER BY ord)` for jsonb-array path.

Frontend:
- **`Poll.tsx`** — match_players query reads `slot_index`; `mpMap` carries `slot_order: r.slot_index ?? 9999`; new `bySlot` comparator sorts whiteList/blackList by slot_order; `Commitment` interface gains `slot_order?: number`.
- Hide rank chip when locked: `{!locked && <span className="po-rank">{c.rank}</span>}`.
- Captain pill restyled in `index.css` — was `color: gold; font-size: 10.5px;`. Now `inline-flex; min-width: 18px; height: 18px; background: var(--accent); color: #0e1826; font-weight: 800;` — gold filled badge.
- **`AdminRosterSetup.tsx`** — `loadRoster` now `.order('team').order('slot_index', { ascending: true, nullsFirst: false })` so the screen displays in stable order across reloads.

**Caveat surfaced to user:** Apr 30's `slot_index` got assigned arbitrarily by the backfill (all 14 rows had the same created_at). User must hit Edit → Save once on Apr 30 in AdminRosterSetup to refresh slot_index from current array order. Future matches inherit correct ordering automatically because RPC writes slot_index.

**Verification:**
- `tsc -b` EXIT 0
- Migration 0063 applied
- Preview Poll page: ranks hidden (0 `.po-rank` elements), 7/7 split, sort using new column, no console errors
- Preview AdminRosterSetup: `.rs-topbar-delete` renders in Save phase, gate also fires for Pool/Teams by code path

---

## Files Created or Modified

### Commit 1 — `2c10cb7` (5 files, +228/−10)
- `supabase/migrations/0061_admin_delete_matchday.sql` (new) — `admin_delete_matchday` RPC.
- `ffc/src/lib/database.types.ts` — regenerated.
- `ffc/src/pages/admin/AdminRosterSetup.tsx` — Delete button + sheet on Saved-state footer.
- `ffc/src/pages/admin/AdminMatches.tsx` — relaxed Delete-match gate.
- `ffc/src/index.css` — `.rs-btn--danger`, `.rs-sheet-btn--danger`.

### Commit 2 — `2a955ac` (2 files, +147/−11)
- `supabase/migrations/0062_admin_delete_matchday_v2.sql` (new) — cascades through unapproved drafts.
- `ffc/src/pages/Poll.tsx` — added `.eq('match_id', matchIdForRoster)` to both match_players queries.

### Commit 3 — `e960df2` (5 files, +479/−13)
- `supabase/migrations/0063_match_players_slot_index.sql` (new) — column add + backfill + 3 RPC updates.
- `ffc/src/lib/database.types.ts` — regenerated (slot_index field appears in 3 places).
- `ffc/src/pages/Poll.tsx` — slot_index sort, hide rank when locked, slot_order field on Commitment.
- `ffc/src/pages/admin/AdminRosterSetup.tsx` — topbar `🗑` delete button + loadRoster ORDER BY slot_index.
- `ffc/src/index.css` — `.rs-topbar-delete` styles, `.po-captain` restyled as gold pill.

---

## Key Decisions

- **Topbar Delete instead of per-phase footer Delete** — single affordance reachable from Pool/Teams/Saved is cleaner than 3 separate footer buttons. Keeps Saved-phase footer Delete too for parallel discoverability.
- **`admin_delete_matchday` cascades through UNAPPROVED drafts but refuses on APPROVED matches.** Mental-model split: approved match → delete the result first via Admin → Matches (more explicit, has its own type-DELETE confirm). Draft → just nuke it.
- **`slot_index` as DB column rather than client-side sort key.** Tried client-side sort by `created_at, id`; failed because all bulk-insert rows share `now()`. DB column is the only reliable option going forward.
- **`CREATE OR REPLACE FUNCTION` in 3 places (create_match_draft, admin_update_match_draft, admin_edit_match_roster) instead of new wrapper.** Each RPC's signature unchanged, body re-issued — Postgres allows OR REPLACE freely as long as args match. No GRANT re-issue needed.
- **Backfill via ROW_NUMBER OVER (...) ORDER BY created_at, id** even though we know it's arbitrary for rows sharing created_at. Better than NULL — gives Apr 30 a deterministic (if random) order until user re-saves. Idempotent if re-run since `WHERE slot_index IS NULL`.

## Open Questions

- **None.** All 4 user feedback items resolved within session.

## Lessons Learned

### Mistakes

| Date | Mistake | Root Cause | Prevention Rule |
|------|---------|------------|-----------------|
| 30/APR/2026 | First slot-order fix attempted client-side sort by `created_at, id`. Verification showed scrambled order. | `create_match_draft` does FOREACH … INSERT in a single transaction; `now()` returns transaction-start time so every row has the same `created_at`. Tiebreaker by uuid `id` is random. | **For per-row order in PG, never rely on `created_at` to disambiguate within a transaction.** If you need stable insertion order, add an explicit `slot_index integer` column written by the RPC at insert time. |
| 30/APR/2026 | First `admin_delete_matchday` refused unconditionally on any `matches` row. User hit Delete on May 7 (which had a draft match from create_match_draft); RPC errored silently; matchday stayed. | Misread the user's mental model. "Delete matchday" should mean "nuke everything attached to it" not "refuse if anything is attached" — only an APPROVED match should require a separate explicit delete-match step. | **For destructive admin RPCs, ask 'what does the user expect this to delete' not 'what does the FK graph let me delete'.** Default to cascade-through-children for non-load-bearing children (drafts, votes, tokens). Only refuse on children that represent committed history (approved matches, payment records). |

### Validated Patterns

- [30/APR/2026] **Always grep for sibling usages when fixing a Supabase query bug.** When fixing the missing `match_id` filter in Poll.tsx, ran `grep -rn "from('match_players')"` and confirmed FormationPlanner, MatchDetailSheet, AdminMatches, AdminRosterSetup, CaptainHelper, Profile already scoped correctly. Avoided over-fixing. **Why:** confirms the bug is local rather than systemic and prevents speculative refactors.
- [30/APR/2026] **`migration repair --status applied <version>` to record a remote migration that was applied without local tracking.** Stray `0060_seasons_games_seeded.sql` had been applied from a side commit but local history didn't know. `db push` errored on duplicate version key; repair recorded it without re-running. **Why:** less destructive than dropping/re-applying; preserves the actual remote state.
- [30/APR/2026] **`CREATE OR REPLACE FUNCTION` to re-issue an RPC body in a follow-up migration.** Migration 0062 replaced 0061's `admin_delete_matchday` body to allow draft cascades. No DROP needed because args unchanged. **Why:** keeps the upgrade path linear (migrations stack) without breaking GRANT EXECUTE state.
- [30/APR/2026] **`WITH ORDINALITY` + `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ord)` for slot_index in jsonb-array RPCs.** `admin_edit_match_roster` accepts a jsonb array; using `WITH ORDINALITY` exposes the input position as `ord`, then PARTITION BY team gives per-team 1-based slot_index. Single-statement insert, no procedural counter. **Why:** clean SQL idiom that matches how create_match_draft / admin_update_match_draft do it via FOREACH counters.
- [30/APR/2026] **Verify hypothesis with DOM eval before coding the fix.** Phase A debug: tapped Review/approve in user's screenshot → opened EditResultSheet not MatchEntryReview → that 1 fact reframed the entire diagnosis (it's a `matches` row, not a `pending_match_entries` row). **Why:** UI-state evidence trumps schema reading; the schema technically allowed both interpretations, the user's screenshot disambiguated.

## Next Actions

- [ ] **User must Edit → Save Apr 30 roster** in AdminRosterSetup so slot_index gets refreshed from current array order. Future matches inherit correct ordering automatically.
- [ ] **Apr 30 live verification** on actual Thursday matchday — ref link mint, KICK OFF console, live timer, goal/card timestamps, SUBMIT → admin review.
- [ ] **S060 cold-start** — sync per Cross-PC protocol; tip on close `e960df2`; live DB at 63 migrations.

---

## Commits and Deploy

- **Commit 1:** `2c10cb7` — feat(admin): delete-matchday RPC + UI; allow delete-match on unapproved
- **Commit 2:** `2a955ac` — fix: Poll team-split scrambled + delete-matchday refusing draft matches
- **Commit 3:** `e960df2` — feat: slot_index for stable team-list order + Poll polish + topbar Delete
- **Live:** https://ffc-gilt.vercel.app
- **Migrations applied this session:** 0061, 0062, 0063 (+ retroactively recorded 0060)

---
_Session logged: 30/APR/2026 | Logged by: Claude (session-log skill) | Session059_
