# Session 059 — Live ref access flow + Poll team fix + matchday delete + 9-issue sweep

**Date:** 30/APR/2026
**PC:** Work (UNHOEC03)
**Tip on close:** `1dd1f27` (6 implementation commits + S059-docs commit; this re-log extends the original S059 close which was at `e960df2` to also cover the issue sweep that followed in the same session)
**Live DB:** 58 → 63 migrations (added 0061, 0062, 0063; retroactively recorded 0060 `seasons_games_seeded` which was already on remote but missing from local history)
**Open GitHub issues:** 9 → 0 (#30 #31 #32 #33 #34 #35 #36 #37 #38 all closed)

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

---

## Post-original-close: 9-issue GitHub sweep

After the original S059 close (commit `e960df2` + docs commit `69768aa`) the user confirmed Apr 30 + May 7 fixes worked end-to-end and asked to triage GitHub open issues. 5 issues at start of sweep (#30 #31 #32 #33 #34); 4 more (#35 #36 #37 #38) opened by user mid-sweep as testing surfaced fresh bugs.

## Phase E — `f9ea2d4` — issues #30 #31 #32 #33 #34 batch (6 files, +196/−69)

- **#34 WhatsApp share button silent failure.** Root cause: `MatchDetailSheet`'s share button onClick discarded `shareMatchCard()`'s `ShareResult`. On desktop browsers `navigator.canShare({files})` returns false → falls through to `a.click()` silent download → button reverts → user perceives "nothing happened". Same UX for `kind: 'error'`. Fix: wired result kinds to a coloured toast inside the sheet — green ✓ Shared / amber ⬇ Image downloaded — open WhatsApp and attach… / red Couldn't share: <message> / silent on cancelled. New `.md-share-toast` + tone modifiers in `index.css`.
- **#31 Sign-out duplication.** Removed Sign-out button + `handleSignOut` handler from `Settings.tsx` (account section now shows email + Delete-account only). Avatar drawer remains the single source of truth.
- **#32 AdminPlayers default tab.** Flipped `useState<Tab>('pending')` → `useState<Tab>('active')`. Active is the regular roster, common drill-down from AdminHome.
- **#30 Leaderboard last-5 column.** Two bugs:
  1. **Grid template column-order didn't match JSX cell-order.** JSX renders rank → player → Pts → MP → W → D → L → GF → Win% → Last 5; CSS template was 36 + 160 + 40 + 32 + 32 + 32 + 36 + 52 + 140 + 44 with Pts as the LAST column (44px) and Last-5 as the 9th (140px). Children fill grid cells in document order, so Pts (3rd JSX) landed in the 40px MP slot and Last-5 (10th JSX) landed in the 44px Pts slot. Pills (5 × 22 + 4 gap = 110px) clipped at 44px. Reordered template to match JSX, made Last-5 `minmax(140px, 1fr)` so it expands when extra horizontal space is available.
  2. **Draw pill colour.** Was `rgba(242, 234, 214, 0.55)` cream-translucent; user requested grey. Set to `#8a8e96`.
  3. Added `overflow: visible` on `.lb-cell--last5` so pills can't be clipped by the cell's inherited `overflow: hidden`.
- **#33 Match history — cards + injuries.** Extended `match_players` SELECT in `Matches.tsx` to also pull `yellow_cards`, `red_cards`, `is_no_show`. Renamed `ScorerRow` → `ParticipantRow`, `groupScorers` → `groupParticipants` — returns one row per player with any disciplinary stat. New `ParticipantBadge` component renders combined ⚽×N + 🟨[×N] + 🟥 + 🤕 markers in a single row per player. Sort: scorers (goals desc) → card holders → no-shows; alphabetised within each tier. Added `.mt-stat-icon` styles in `styles/matches.css`.

Verification: `tsc -b` EXIT 0; preview verified Matches cards render + Leaderboard Last-5 cell width was now 140px (was 44px).

## Phase F — `4e07a72` — issues #35 #36 (3 files, +26/−4)

User reported these after Phase E deployed.

- **#35 Poll locked-row layout overlap.** When the roster is locked the `.po-rank` cell is omitted from JSX (S059 Phase D added `{!locked && <span className="po-rank">...}`). But the CSS grid template still declared 4 columns `26px 32px 1fr auto`. With 3 children in document order: avatar → 26px slot, name-block → 32px slot, timestamp → 1fr slot. Timestamp ended up in the wide column with name squeezed into the avatar slot — visual overlap. Fix: added `.po-row--locked` modifier class with 3-column grid `32px 1fr auto`, conditionally applied via `${locked ? 'po-row--locked' : ''}`. Verified at 375px viewport: avatar 32 / name 193 / ts 47 — timestamp anchored right with no overlap.
- **#36 EditRosterPostSheet empty roster.** Same PostgREST FK ambiguity bug Matches.tsx scorers had in S058. `match_players` has THREE FKs to `profiles` (`profile_id`, `substituted_in_by`, `updated_by`); a bare `profile:profiles(display_name)` embed errors silently and the parent SELECT returns no rows. Disambiguated to `profile:profiles!match_players_profile_id_fkey(display_name)`. Also added `.order('team').order('slot_index', { nullsFirst: false })` so the loaded roster matches Roster Setup order, plus error console-log so future ambiguity / RLS regressions don't masquerade as empty sheets.

## Phase G — `1dd1f27` — issue #37 + MOTM/HAT cleanup (3 files, +14/−10)

User asked to also remove the MOTM footer strip + HAT pill in the same patch.

- **#37 Match-card alignment.** Card was inset 14px from `.mt-screen` edges relative to the season header. Root cause: `.mt-list { padding: 0 14px }` while `.mt-screen` had no horizontal padding. Dropped the list padding so cards align flush left/right with the header. Also dropped the `.mt-card { max-width: 440px }` cap so cards fill the full column on wider viewports. Verified at 375px: card x=16 right=359 matches screen x=16 right=359 (343px wide).
- **MOTM footer strip removed.** `<div className="mt-motm-strip">⭐ MOTM · {name}</div>` deleted from `Matches.tsx`. Scorer list already shows MOTM inline (gold ⭐ + name in gold) — strip duplicated the same fact. Variable `motmName` removed too.
- **HAT pill deleted** from `ParticipantBadge`. The `×N` suffix already conveys a hat-trick; the pink `HAT` pill was clutter per user feedback.

## Phase H — issue #38 UI audit (no commit; tracking comment)

User pasted a senior-engineer UI/UX audit prompt as an issue. Treated as research/audit ask rather than a single-fix bug. Ran a focused DOM-eval pass across screens + compiled findings against the user's framework.

**Findings posted as the issue's tracking comment:**
- 9 already-fixed items mapped back to today's commits (#30-#37 + S059 Poll team-split).
- 1 CRITICAL: `.app-topbar-bell` and `.app-topbar-avatar` measured 36×36 in dev preview (Apple HIG ≥ 44×44).
- 3 HIGH PRIORITY: inconsistent border-radius scale (`10px`, `12px`, `0px` mixed across components); no `:focus-visible` ring; skeleton-row pattern only on Leaderboard + Matches.
- 6 POLISH: no transitions on state flips, no hover/active feedback on cards, typography scale not codified, fixed brand colours partially un-tokenised, cross-screen padding-top inconsistency, spacing system not on a strict 4pt grid.

Recommendation in the comment: items 1-4 break out as discrete issues if/when prioritised; items 5-10 better tackled as a single "design-system pass" sprint. Closed #38 — audit IS the deliverable.

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

### Docs Commit — `69768aa` (5 files, +267/−11)
- S059 close docs (session log, INDEX, todo, lessons, CLAUDE.md status).

### Commit 4 — `f9ea2d4` (6 files, +196/−69) — Phase E sweep
- `ffc/src/components/MatchDetailSheet.tsx` — `shareToast` state + result-aware UX wiring (#34).
- `ffc/src/index.css` — `.md-share-toast` + tone modifiers (#34); `.lb-table-grid` columns reordered + Last-5 minmax + D pill colour fix + `.lb-cell--last5 { overflow: visible }` (#30).
- `ffc/src/pages/Settings.tsx` — Removed Sign-out button + `handleSignOut` (#31).
- `ffc/src/pages/admin/AdminPlayers.tsx` — Default tab `pending` → `active` (#32).
- `ffc/src/pages/Matches.tsx` — `ScorerRow` → `ParticipantRow`, `groupScorers` → `groupParticipants`, new `ParticipantBadge` component, query select adds yellow/red/is_no_show (#33).
- `ffc/src/styles/matches.css` — `.mt-stat-icon` markers (#33).

### Commit 5 — `4e07a72` (3 files, +26/−4) — Phase F sweep
- `ffc/src/pages/Poll.tsx` — `.po-row--locked` class threaded into the row className (#35).
- `ffc/src/index.css` — `.po-row.po-row--locked { grid-template-columns: 32px 1fr auto }` (#35).
- `ffc/src/pages/admin/AdminMatches.tsx` — `match_players` SELECT disambiguated via `!match_players_profile_id_fkey`, ORDER BY slot_index, error console-log (#36).

### Commit 6 — `1dd1f27` (3 files, +14/−10) — Phase G sweep
- `ffc/src/index.css` — `.mt-list { padding: 0 }` (was `0 14px`) (#37).
- `ffc/src/styles/matches.css` — `.mt-card` max-width cap removed (#37).
- `ffc/src/pages/Matches.tsx` — MOTM footer strip removed; HAT pill removed from `ParticipantBadge` (#37 follow-ups).

---

## Key Decisions

- **Topbar Delete instead of per-phase footer Delete** — single affordance reachable from Pool/Teams/Saved is cleaner than 3 separate footer buttons. Keeps Saved-phase footer Delete too for parallel discoverability.
- **`admin_delete_matchday` cascades through UNAPPROVED drafts but refuses on APPROVED matches.** Mental-model split: approved match → delete the result first via Admin → Matches (more explicit, has its own type-DELETE confirm). Draft → just nuke it.
- **`slot_index` as DB column rather than client-side sort key.** Tried client-side sort by `created_at, id`; failed because all bulk-insert rows share `now()`. DB column is the only reliable option going forward.
- **`CREATE OR REPLACE FUNCTION` in 3 places (create_match_draft, admin_update_match_draft, admin_edit_match_roster) instead of new wrapper.** Each RPC's signature unchanged, body re-issued — Postgres allows OR REPLACE freely as long as args match. No GRANT re-issue needed.
- **Backfill via ROW_NUMBER OVER (...) ORDER BY created_at, id** even though we know it's arbitrary for rows sharing created_at. Better than NULL — gives Apr 30 a deterministic (if random) order until user re-saves. Idempotent if re-run since `WHERE slot_index IS NULL`.
- **Issue sweep ordered easiest-first to ship visible wins fast.** Phase E batched 5 independent issues into one commit (kept commit history grouped, easier to revert if needed). #34 was actually the highest user-impact (broken share button) — fixed first within the batch.
- **Audit issue (#38) closed with the audit itself as the deliverable** rather than spawning 10 sub-issues. User can decide to break out items 1-4 (CRITICAL + HIGH PRIORITY) into discrete tracked issues; items 5-10 (POLISH) better as a single design-system pass.
- **MOTM footer strip + HAT pill deletions accepted in same commit as the alignment fix (#37).** User asked for both as follow-ups while #37 was in flight; bundling kept the diff cohesive ("match-card cleanup" rather than 3 separate trivial PRs).

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

### Sweep-phase patterns (E/F/G/H)

- [30/APR/2026] **Grid template column-order MUST match JSX cell-order; CSS doesn't auto-reflow on mismatch.** Leaderboard #30 had `grid-template-columns` declaring Pts last but JSX placed Pts 3rd — children fill cells in document order, so the template's column widths landed against the wrong content. Bug had been present since launch but each cell got SOME workable width (Pts=44, Win%=52) until the very narrow Pts slot fell to Last-5 which actually needed 140+. **How to apply:** when defining a grid table, write the JSX cell sequence as a comment above `grid-template-columns`. Audit any existing grid table once.
- [30/APR/2026] **Conditional JSX rendering of a grid cell breaks the column count.** Poll #35: hiding `.po-rank` when locked left the grid template at 4 columns but only 3 children rendered, all packed left. Fix is a modifier class with a different `grid-template-columns` declaration. **General rule:** if you remove a grid child via `{cond && <X />}`, you MUST also adjust grid-template-columns via a class or `display: contents` placeholder.
- [30/APR/2026] **PostgREST embed-ambiguity is a recurring class of bug, not a one-off.** Same `match_players → profiles` ambiguity bit Matches.tsx scorers in S058 and bit EditRosterPostSheet in S059 #36. **General rule:** any `match_players` SELECT with a profile embed MUST use `!match_players_profile_id_fkey` explicitly. Audit any new query before merge.
- [30/APR/2026] **For browser features that vary across platforms (Web Share API), always wire result handling to user-visible feedback.** `navigator.canShare({files})` returns false on desktop Chrome → silent download fallback. Without surfacing the fallback, the user thinks the action failed. **How to apply:** every `navigator.share` call should branch on success / fallback / error / cancel and emit user-visible state for at least the first three.
- [30/APR/2026] **Issue body can override what the title implies.** #30 title was "color code wins/draws/losses"; reading body revealed colours were already mostly correct (W green / L red present; D was cream not grey) and the real bug was column-width clipping. **General rule:** read issue body in full before scoping; titles are headlines, not specifications.
- [30/APR/2026] **DOM eval at the dev preview is a faster verification loop than re-deploying.** Verified all 9 issue fixes via `preview_eval` queries (button widths, grid template, presence of `.mt-motm-strip` / `.mt-hat-badge`, sheet overlay, etc) before pushing each commit. Saved several Vercel deploy cycles. **How to apply:** for any DOM-observable fix, add a 1-liner DOM eval as the verification step.
- [30/APR/2026] **An audit-style issue is its own deliverable; don't spawn 10 sub-issues mechanically.** #38 asked for a comprehensive audit. Posting findings as a single comment with categorisation (CRITICAL / HIGH / POLISH) lets the user decide which to break out — vs. flooding the issue tracker with 10 small items. **How to apply:** for any "review and report" ask, the report IS the deliverable.

## Next Actions

- [x] User confirmed Apr 30 + May 7 fixes worked end-to-end (mid-session).
- [ ] **Apr 30 live verification** on actual Thursday matchday — ref link mint, KICK OFF console, live timer, goal/card timestamps, SUBMIT → admin review. Plus all 9 issue-sweep deliverables.
- [ ] **#38 audit follow-up — break out CRITICAL + HIGH PRIORITY items** as discrete issues if/when prioritized: (1) topbar touch targets 36→44px, (2) border-radius scale tokenisation, (3) global focus-visible ring, (4) skeleton-row coverage on Poll/Profile/Settings/Admin*.
- [ ] **#38 design-system pass** — single sprint to address polish-tier items: state-flip transitions, hover/active feedback, typography scale, brand-colour tokenisation, padding-top unification, 4pt spacing grid enforcement.
- [ ] **S060 cold-start** — sync per Cross-PC protocol; tip on close `1dd1f27`; live DB at 63 migrations; 0 open GitHub issues; user agenda for S060 is Phase 3 payment tracker.

---

## Commits and Deploy

- **Commit 1:** `2c10cb7` — feat(admin): delete-matchday RPC + UI; allow delete-match on unapproved
- **Commit 2:** `2a955ac` — fix: Poll team-split scrambled + delete-matchday refusing draft matches
- **Commit 3:** `e960df2` — feat: slot_index for stable team-list order + Poll polish + topbar Delete
- **Docs commit:** `69768aa` — docs(s059): session log + INDEX + todo + lessons + CLAUDE.md status (original S059 close)
- **Commit 4:** `f9ea2d4` — fix: 5 open issues sweep (#30 #31 #32 #33 #34)
- **Commit 5:** `4e07a72` — fix: Poll locked-row layout (#35) + EditRoster auto-populate (#36)
- **Commit 6:** `1dd1f27` — fix(#37): match-card alignment + remove duplicate MOTM strip + HAT pill
- **Audit comment:** issue #38 closed with structured audit findings (no commit)
- **Live:** https://ffc-gilt.vercel.app
- **Migrations applied this session:** 0061, 0062, 0063 (+ retroactively recorded 0060)
- **GitHub issues closed:** #30 #31 #32 #33 #34 #35 #36 #37 #38 (9 total)

---
_Session logged: 30/APR/2026 | Logged by: Claude (session-log skill) | Session059 (re-logged after issue sweep)_
