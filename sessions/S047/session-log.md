# Session S047 — Slice 2B-F Carry-Over + S043 Defense-in-Depth + Admin Nav Badge

**Date:** 27 / APR / 2026
**PC:** Work PC (UNHOEC03)
**Outcome:** Complete. 3 feature commits + 1 close-out commit (this commit) on `main`.
**Migrations on live DB:** 33 (0001 → 0033). Migration 0033 added this session.
**Live URL:** https://ffc-gilt.vercel.app

S047 picked up three S046-deferred items in one short session: (1) Task 1 — MOTM picker + Notes textarea wired into the new MatchEntryReview screen; (2) Task 4 — defense-in-depth REVOKE EXECUTE FROM PUBLIC on every admin SECURITY DEFINER RPC, the second-layer follow-up to S043's NULL-safety hotfix; (3) Task 5 — admin nav badge on the Settings → Admin platform row showing the pending-match-entries count. Tasks 2 (live device acceptance for the 2B-B/C/D/E/F chain) and 3 (captain reroll on MD31) remain blocked on a real Thursday matchday — they accumulate on the carry-over list.

## What shipped

### Task 1 — MOTM picker + Notes editor in MatchEntryReview

The S046 close-out had landed `MatchEntryReview.tsx` with `_setEditMotm` and `_setEditNotes` placeholders — read paths through `handleApprove`'s `p_edits` builder were wired, but the setters were dead-stubbed (`void _setEditNotes; void _setEditMotm`). S047 promotes both to real setters and adds two new bottom-sheet variants (`motm`, `notes`) to the `Sheet` discriminated union.

Both sheets are local-state-only: `MotmSheet` mutates `editMotm` and closes; `NotesSheet` mutates `editNotes` and closes. No RPC call at sheet-confirm time. The diff is sent in `p_edits` on Approve via the existing `handleApprove` builder.

**`editMotm` semantics (documented inline in the file):**
- `null` — no edit, fall back to the pending row's `is_motm` flag
- `{ profile_id: 'x', guest_id: null }` — set MOTM to that profile
- `{ profile_id: null, guest_id: 'g' }` — set MOTM to that guest
- `{ profile_id: null, guest_id: null }` — explicit clear (handleApprove sends both fields as null to the RPC)

**`editNotes` semantics:** `null` = no edit, `''` = explicit clear, string = update.

Computed values added post-guard: `effectiveMotm` / `effectiveMotmName` / `effectiveNotes` resolve overrides against pending data so the cards reflect either the user's local change or the original pending row. `effectiveMotmName` looks up the resolved profile or guest in the existing display-name maps.

UI changes:
- MOTM card: gains a Change/Set affordance (label flips by current state). Sheet shows a combined-roster picker grouped by team (WHITE / BLACK), gold-tinted active state, "Clear MOTM" only when `current` resolves to non-null.
- Notes card: now always rendered (was conditional on `entry.notes`). Shows truncated single-line preview when populated, "— none —" italic when empty. Add/Edit affordance flips by state. Sheet contains a `<textarea maxLength={500}>` with rows={5} + char counter (X / 500); save button labels itself "Save" or "Clear" depending on whether trimmed text is empty against existing content.

Did not extract a shared `MotmPicker` component between the ref-side (`RefEntryPickers.tsx`) and admin-side (this file). The two data shapes differ enough — `RefMatchdayPayload` is captain-friendly with positions; admin-side uses `PendingPlayerRow[]` + lookup maps — that normalising would cost more than the duplication. Both files now ~660 LOC each, well under the 800-LOC guardrail.

CSS additions in `match-entry-review.css`:
- `.mer-notes-preview` — single-line truncate with text-overflow ellipsis
- `.mer-motm-list` / `.mer-motm-team` / `.mer-motm-team-label` — combined-roster picker scaffold
- `.mer-motm-pick` / `.mer-motm-pick--active` — pick rows with gold-tinted active state

Commit: `8fba2dd` (244 insertions / 17 deletions across 2 files).

### Task 4 — Migration 0033: REVOKE EXECUTE FROM PUBLIC on admin RPCs

S043 patched `is_admin()` / `is_super_admin()` to return strict booleans via `COALESCE(..., false)`, closing the NULL-3VL bypass inside function bodies. Migration 0033 adds the second layer: anon callers don't reach the function body at all because PostgREST denies the EXECUTE call up-front.

**Background.** Postgres grants EXECUTE to PUBLIC by default on every CREATE FUNCTION. The explicit `GRANT EXECUTE ... TO authenticated` in earlier FFC migrations coexisted with that PUBLIC grant rather than replacing it. After 0033, anon-key callers get `42501 permission denied for function ...` at the PostgREST gate — the function body never runs.

**Audit.** Queried live `pg_proc` for every SECURITY DEFINER function in `public` whose body calls `is_admin(` or `is_super_admin(`. Result: 35 functions. Two non-issues to flag:
- `accept_substitute` references `is_admin()` but as a captain-OR-admin gate (`IF NOT EXISTS (... is_captain ...) AND NOT is_admin() THEN RAISE`). Captains are authenticated users, so `REVOKE FROM PUBLIC + GRANT TO authenticated` preserves their access while shutting out anon. Included in scope.
- `request_reroll` was a false-positive in the LIKE search — its body doesn't actually reference `is_admin()`. Excluded.

**Out of scope (deliberately untouched):**
- `submit_ref_entry(text, jsonb)` — anon-callable; auth via ref token
- `get_ref_matchday(text)` — anon-callable; auth via ref token
- `cast_poll_vote`, `invite_guest`, `edit_match_players` (the non-admin variant), and other authenticated-only RPCs that don't reference `is_admin`

**Signature drift caught.** First draft of the migration was hand-typed from S046's audit list and got several signatures wrong (`ban_player` evolved from 0008's 2-arg form to 0016's 3-arg form; `admin_submit_match_result` had its argument order changed at some point; etc.). Caught by re-reading `pg_proc.pg_get_function_identity_arguments(oid)` directly and regenerating the migration body from the live signatures. The S024 schema-drift lesson generalises again: query the live schema before writing any DDL that references a function signature.

**Verification.** ACL before: `{=X/postgres,postgres=X/postgres,authenticated=X/postgres}` (the leading `=X` is the PUBLIC grant). ACL after: `{postgres=X/postgres,authenticated=X/postgres}` — PUBLIC grant gone. Anon-key curl regression test:

| RPC | Before S043 | After S043 (NULL fix) | After 0033 (this slice) |
|----|----|----|----|
| `regenerate_ref_token` | `22023 Matchday not found` (bypass) | `42501 Admin role required` (body raise) | `42501 permission denied for function regenerate_ref_token` (PostgREST gate) |
| `reject_signup` | `22023 Pending signup not found` (bypass) | `42501 Admin role required` (body raise) | `42501 permission denied for function reject_signup` (PostgREST gate) |
| `admin_drop_pending_match_event` | n/a (didn't exist) | `42501 Admin role required` (body raise) | `42501 permission denied for function admin_drop_pending_match_event` (PostgREST gate) |
| `get_ref_matchday` (anon-allowed) | `22023 Invalid or expired ref token` | `22023 Invalid or expired ref token` | `22023 Invalid or expired ref token` (untouched) |

Both layers active now. Defense-in-depth complete.

Commit: `992d1bc` (116 LOC of REVOKE + GRANT statements, idempotent / safe to re-run).

### Task 5 — Admin nav badge on Settings → Admin platform row

User chose placement after a 3-option chip prompt: badge sits on the existing red 🛠 Admin platform row in Settings (the one introduced in S034). Spiritual heir to the old conditional 5th admin nav tab, scoped narrowly to the screen that already has the admin entry.

**Settings.tsx additions:**
- New `pendingEntriesCount` state (default 0).
- New admin-only `useEffect` gated by `isAdmin` (admin / super_admin). On mount, runs a cheap `count: 'exact', head: true` query against `pending_match_entries WHERE status='pending'`. Cleanup flag prevents stale `setState` if the user navigates away mid-fetch.
- The Admin platform row label is now wrapped in `.st-admin-link-label` (flex container) with the count rendered as a `.st-admin-badge` pill when `pendingEntriesCount > 0`. `aria-label` reads `"N pending match ${count === 1 ? 'entry' : 'entries'} awaiting review"` for screen readers.

**index.css additions:**
- `.st-admin-link-label` — flex row alignment so the badge sits next to the icon+title without breaking the chevron
- `.st-admin-badge` — danger-tinted pill (`#e63349`) with cream digit, 22px high, `min-width: 22px` so single-digit counts don't look like a stray pixel; subtle 2px ring (`box-shadow`) to lift it off the red parent row background; `font-variant-numeric: tabular-nums` for clean digit alignment

No realtime subscription. The count only matters when the admin is actively triaging, and Settings is rarely open. Realtime on `pending_match_entries` is deferred until that table goes through `ALTER PUBLICATION supabase_realtime ADD TABLE` (Phase 2A backlog).

Commit: `d56eea8` (57 insertions / 2 deletions across 2 files).

### Build verification (each task)

`tsc -b` EXIT 0 + `vite build` EXIT 0 after each commit. PWA precache 11 entries, ~1565 KiB total / 752.78 KB main JS / 131.32 KB CSS at the close. ESLint clean on changed files; two pre-existing errors in `Settings.tsx` (lines 120 and 214) confirmed via `git blame` — out of scope.

Dev server (`preview_start ffc-dev`) mounted cleanly after each push. Settings sits behind admin auth so end-to-end Settings-badge testing on dev is a hand-off; production deploy is the verification surface.

## Patterns / lessons

(Additive — not duplicated from past sessions.)

- **Two-layer defense for SECURITY DEFINER RPCs.** Layer 1: helper-function NULL safety (S043 — `COALESCE(...,false)`). Layer 2: REVOKE EXECUTE FROM PUBLIC at the PostgREST gate (this slice). Either layer alone shuts out anon, but both together survive future helper bugs and accidental signature regressions. The ACL transition `{=X/postgres,...} → {postgres=X/postgres,...}` is the durable one-line check in `pg_proc.proacl::text` that proves Layer 2 is active.

- **Generate migration DDL from `pg_proc`, not from migration history.** Hand-typing function signatures from S008/S016/S028/etc. headers drifted on `ban_player` (2-arg → 3-arg) and `admin_submit_match_result` (arg-order changes). The fix: query `pg_proc.pg_get_function_identity_arguments(oid)` and emit the SQL programmatically. Saves a "function does not exist" fail at apply time. The S024 schema-drift lesson generalises beyond column names to function signatures.

- **`accept_substitute` is captain-OR-admin, not admin-only.** Easy false positive in the "calls `is_admin()`" search. The body shape is `IF NOT EXISTS (captain check) AND NOT is_admin() THEN RAISE` — meaning admins are an alternate path. Both captains and admins are `authenticated`, so `REVOKE FROM PUBLIC + GRANT TO authenticated` preserves the captain path correctly. Worth the second-pass body inspection on RPCs that look gate-mixed.

- **`request_reroll` was a false positive in the body-LIKE search.** The function references "draft session" and other admin-flavoured concepts but doesn't actually call `is_admin()`. Don't trust a `prosrc LIKE '%is_admin%'` filter as the audit's final answer — confirm by reading the body. Captain check is sufficient for that RPC.

- **Local-state-only sheets > round-tripping setters through RPC at confirm time.** The MOTM picker and Notes editor in MatchEntryReview write to local state on confirm and let `handleApprove` send the diff. Pros: instant UX, no network on every cancel-able edit, single transaction at Approve. Cons: state lost on reload — but that's also true of the inline score-edit inputs already present in the screen, so the policy is consistent.

- **`editMotm` 4-state semantics via discriminated `null`.** `null` = no edit, `{x, null}` = set profile, `{null, x}` = set guest, `{null, null}` = explicit clear. The fourth state distinguishes "user actively cleared MOTM" from "user didn't touch it" — matters because `handleApprove` should only send fields the user actually touched. Worth the 5-line comment block.

- **`min-width: 22px` on a count badge.** Without it, single-digit counts (the common case) collapse to a narrow oval; double-digit counts widen organically. With it, the badge looks the same shape regardless of count length. Standard mobile-design rule but easy to forget when the badge is rare.

- **Screen-reader copy for count badges:** `"N pending match ${count === 1 ? 'entry' : 'entries'} awaiting review"`. The pluralisation matters; "1 pending match entries" reads broken. Cheap to do right.

- **Two-track session pattern (carry-over + targeted-from-todo).** S047 ran one S046-carry-over (Task 1 MOTM/Notes) and two from the standing todo (Task 4 defense-in-depth, Task 5 nav badge). This works well for short sessions where blocked items (live device tests, real-Thursday-only verifications) accumulate but other agenda items are independent. Carry-over items get a "Task 1" label that links them to the originating slice; new items get standalone task numbers. Future close-outs should preserve this distinction.

## Out of scope (deferred / blocked)

- **Live device acceptance for slices 2B-B/C/D/E/F chain** — accumulates from S041 onwards. End-to-end test: admin mints ref link → phone → KICK OFF → events → END MATCH → review → SUBMIT → admin opens new MatchEntryReview screen → APPROVE → leaderboard updates. Blocked on a real Thursday matchday.
- **Captain reroll live test on MD31** — accumulates from S037. Blocked on live conditions.
- **Realtime subscription on `pending_match_entries`** for the AdminMatches CTA + Settings badge — needs `ALTER PUBLICATION supabase_realtime ADD TABLE pending_match_entries` first. Phase 2A backlog item.
- **Per-player aggregate edit-before-approve in MatchEntryReview** — S046 deferral still holds. Post-approval `edit_match_players` covers the use case for now.
- **Transactional email on signup approve/reject** — backburner. Resend Edge Function (`notify-signup-outcome`) triggered by database webhook on `pending_signups.resolution`. No urgency.

## Files changed in this slice

- `ffc/src/pages/admin/MatchEntryReview.tsx` (extended — 660 LOC final, was 640)
- `ffc/src/styles/match-entry-review.css` (extended — adds .mer-notes-preview + .mer-motm-list/team/pick block)
- `supabase/migrations/0033_admin_rpc_revoke_public.sql` (new — 116 LOC)
- `ffc/src/pages/Settings.tsx` (extended — admin-only useEffect + badge render block)
- `ffc/src/index.css` (.st-admin-link-label + .st-admin-badge — 21 new lines after .st-admin-link)
- `tasks/todo.md` (close-out section + S048 prep)
- `sessions/S047/session-log.md` (this file)
- `sessions/INDEX.md` (S047 row + S048 next pointer)
- `CLAUDE.md` (status header — S047 narrative + migration count → 33)

## Commits and Deploy

- **Commit 1 — `8fba2dd`** — `feat(s047,task1): wire MOTM picker + Notes editor in MatchEntryReview` — Task 1 carry-over from slice 2B-F
- **Commit 2 — `992d1bc`** — `fix(s047,security): migration 0033 — REVOKE EXECUTE FROM PUBLIC on admin RPCs` — Task 4 defense-in-depth
- **Commit 3 — `d56eea8`** — `feat(s047,task5): admin nav badge — pending match entries count on Settings row` — Task 5
- **Commit 4 — close-out** (this commit) — todo + INDEX + this session log + CLAUDE.md status

**Deploys.** Vercel auto-deployed each push:
- `dpl_HygWzKwHU6CfS73fB4sWWkTBA27p` — Task 1 — READY (build ~18 s, region iad1)
- `dpl_7eVCoucpMY4iVULP7XfqJFPc5cdZ` — Task 4 (migration only, no UI delta) — READY
- `dpl_56KHfcWPXH29PKeJ8MQxBEEjyL3h` — Task 5 — READY (build ~19 s)

Live: https://ffc-gilt.vercel.app

---

_Session logged: 2026-04-27 | Logged by: Claude (session-log skill) | Session S047_
