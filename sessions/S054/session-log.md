# Session Log — 2026-04-29 — Session054 — Phase 3 share-PNG + PR-merge marathon

**Project:** FFC
**Type:** Phase 3 feature ship + 3 PR merges + 2 issue fixes
**Phase:** Phase 3. V3.0:140 backlog item shipped end-to-end. Phase 2 close still owed (Atomo handling).
**Duration:** Long working block — straight through from morning PR triage to evening close.
**Commits:** 22 commits, range `14e3047..d289aee`. All on `main`. Live DB: 47 → 53 (gap at 0050 from PR #13 renumber).

---

## What Was Done

### PR #9 merge — own-goal / clock / refresh / unlock-roster (Atomo)

- Atomo's PR #9 had been waiting overnight. His comment asked to "merge + run db push for migration 0047".
- Inspected before merging. Caught a **migration number collision**: his `0047_unlock_roster_rpc.sql` clashed with our just-shipped `0047_phase3_awards.sql` (S053 awards).
- Verified live DB state: schema_migrations had `0047 = phase3_awards` (ours). His `0047_unlock_roster_rpc` was NOT applied — his `db push` had silently no-op'd because schema_migrations already had a 0047 row.
- Renumbered his file `0047 → 0048` on his branch (commit `4c8aa2d` on `feature/fix-login`), squash-merged at `14e3047`.
- Pushed `0048_unlock_roster_rpc` to live DB. Function `unlock_roster()` now exists with SECURITY DEFINER + `is_admin()` guard.
- Posted explanatory comment on PR explaining the silent-skip mechanism.

### Phase 3 share-PNG (V3.0:140) — full slice

- User picked WhatsApp share PNG from the V3.0 backlog (V3.0:140). Per CLAUDE.md operating rule #1, started mockup-first.
- Brainstorming locked: admin-only trigger post-approval; scoreboard + scorers + MOTM content; 1080×1080 square; A/B mockup pattern (S053 precedent); Supabase EF + Satori + Resvg + Storage cache.
- **Spec** (`docs/superpowers/specs/2026-04-29-phase3-share-png-design.md`, commit `b6f96e8`) — 11 sections, ~480 lines. Covers user flow, architecture diagram, RPC payload, EF endpoint contract, frontend wiring, auth model (3 layers), failure-mode table, visual design, implementation breakdown, risks.
- **Plan** (`docs/superpowers/plans/2026-04-29-phase3-share-png.md`, commit `126b61c`) — 11 tasks: 3 mockup tasks → spec/plan correction → migration → EF scaffold → EF source → deploy/smoke → frontend helper → 2 wire-ins → final verify.
- **Mockup A/B compare** (`mockups/3-25-phase3-share-png-style-compare.html`, commit `d082023`) — Style A (awards continuity, gold serif) vs Style B (sports broadcast, bold sans). User picked elements from each.
- **Mockup final** (`mockups/3-26-phase3-share-png.html`, commits `cc2297d` + `1eaf5cd`) — hybrid: A's centred crest + serif gold title, B's TEAM WHITE / TEAM BLACK split scoreboard with vertical gold-gradient divider, B's tight sans scorer grid, B's gold-pill MOTM, no footer. After user review, replaced "Block A pitch" venue with "Match 12 of 22" prominence.
- **OG attribution bug caught at mockup review.** Original draft listed own-goal scorer under the team that *benefitted*. User flagged: should be under the scorer's *own* team with `(OG)` marker (standard football reporting). Spec section 3 + plan Task 4 SQL corrected accordingly (commit `9970535`). Aggregation simplified to one CTE, no team flip.
- **Migration 0049** (`bf8f7e0`) — `get_match_card_payload(p_match_id uuid)` SECURITY DEFINER RPC + private `match-cards` storage bucket (image/png, 512 KB, RLS service-role-write). Schema verified up-front: `event_type` is enum `match_event_type` (not `event_type_enum` as plan guessed) — text-literal compare works fine. Added `match_number` (rank of non-friendly matchdays in season) + `total_matches` (`seasons.planned_games` with COUNT fallback). Guest scorers get `(G)` suffix in name. Smoke test confirmed `is_admin()` guard works.
- **EF scaffold** (`24f4a30`) — `supabase/functions/render-match-card/` with `deno.json` (npm: imports for Satori + Resvg + supabase-js + react), `ffc-crest.svg` (copied from `ffc/public/ffc-logo.svg` — actual brand asset name), `fonts/Inter-SemiBold.ttf` (876 KB, variable; weight 600 selected) + `fonts/PlayfairDisplay-Bold.ttf` (294 KB).
- **EF source** (`382e96c`) — `index.ts` (140 LOC, auth-verify + RPC + cache check + Satori render + Resvg PNG + upload + signed URL) + `MatchCard.tsx` (135 LOC, 1080×1080 layout mirroring 3-26).
- **EF deploy fix #1** (`4db1161`) — discovered Supabase EF CLI silently drops binary assets in subdirectories (TTF/SVG/WASM all skipped during `functions deploy`; only `.ts`/`.tsx`/`.json` upload). Switched fonts to runtime fetch from jsDelivr + inlined the crest SVG as base64 data URI. Local files kept for `supabase functions serve` dev.
- **EF deploy fix #2** (`09e4281`) — caught proactively before Task 11 manual test: implementer used `.woff2` URLs but Satori v0.10 doesn't support WOFF2 (no Brotli decompression). Verified Satori README confirms TTF/OTF/WOFF only. Swapped to `.woff` URLs from `@fontsource` jsdelivr. Re-deployed at v5.
- **Frontend helper** (`c353175`) — `ffc/src/lib/shareMatchCard.ts` (~80 LOC). Calls EF, downloads blob, calls `navigator.share({ files })`, falls back to browser-download. Discriminated `ShareResult` union: `shared` / `cancelled` / `downloaded` / `error`.
- **Wire-in: review screen** (`987cd04`) — `MatchEntryReview.tsx` post-approve flow now stays in-place with success state + "📲 Share to WhatsApp" CTA + "Done" secondary, instead of `navigate('/admin/matches')`. New CSS `.mer-success` block.
- **Wire-in: detail sheet** (`91b76b9`) — `MatchDetailSheet.tsx` admin-only footer button (gated on `isAdmin && main.approved_at`). Same `shareMatchCard()` call. New `.md-action-btn--share` CSS variant. Caught: project's hook is `useApp` not `useAppContext` — corrected in implementer.
- **Close-out** (`ccc940d`) — CLAUDE.md current-state bumped to S054, `tasks/lessons.md` got 2 new lessons (Supabase EF binary-asset drop; Satori WOFF2 unsupported), `tasks/todo.md` updated, AdminMatches.tsx had a stale `@ts-expect-error` from PR #9's unlock_roster directive cleaned up (types regenerated in Task 4 made it unused).

### PR #13 merge — Admin Roster Setup (Atomo)

- Atomo's PR #13 opened mid-afternoon: new `/admin/roster-setup` screen (tap-to-assign pool→slot interaction, add-guest-by-name sheet, edit-mode banner) + 2 new RPCs.
- Same migration-collision pattern as PR #9. His branch was based on `14e3047` (PR #9 merge), forked BEFORE today's S054 share-PNG work. His `0049_admin_add_guest_rpc.sql` collided with our `0049_match_card_payload_rpc.sql`; his `0050_admin_update_match_draft_rpc.sql` was one slot off too.
- Renumbered both: `0049 → 0051`, `0050 → 0052` (commit `0a46445` on his branch).
- Rebased his branch onto current `main`. CSS conflict in `index.css` — both sides added blocks at end of file (S054 share-PNG additions on our side, ~445 lines of roster-setup CSS on his). Resolved as additive (kept both blocks).
- Force-pushed PR branch, squash-merged at `cbdecac`.
- Applied 0051 + 0052 to live DB. Both RPCs verified: `admin_add_guest`, `admin_update_match_draft`.
- Regenerated types (`98e54e8`) so AdminRosterSetup.tsx's rpc calls type-check on Vercel build.

### GitHub issue triage — 4 open issues

- **#10 Unlock Roster** — closed as completed (shipped in PR #9 / mig 0048).
- **#11 Admin Roster Setup UI** — closed as completed (shipped in PR #13 / migs 0051+0052).
- **#8 Leaderboard column restructure** (mmuwahid) — actioned. See below.
- **#12 App lag on reopen** (mmuwahid) — actioned. See below.

### Issue #8 — Leaderboard restructure

- User direction: drop avatar column, move Pts to position 3, Last 5 stays last, colour W/D/L.
- Commit `930cec7`: Avatar disc removed from Player cell (component preserved for other surfaces). Column order: Rank → Player → Pts → MP → W → D → L → GF → Win% → Last 5. Added `.lb-cell--w` (success green), `.lb-cell--d` (muted cream), `.lb-cell--l` (danger red) modifier classes — same colour family as the existing Last 5 W/L/D pills. Grid min-width unchanged at 604px so S052's portrait fit isn't regressed.

### Issue #12 — Login + Poll flicker

- Bug: reopening app shows login screen briefly then refreshes; same on Poll tab (vote prompt shows briefly, then resolves to existing vote).
- Diagnosed two independent races:
  1. **Auth race in `AppContext.tsx`** — `setLoading(false)` was called the moment `getSession()` resolved, but the profile-fetch `useEffect` (which sets `role`) is a separate effect that runs ONE render cycle later. Brief window: `loading=false, session≠null, role=null` → routing guards in `HomeRoute` (`router.tsx:46`) and `RoleLayout` (`RoleLayout.tsx:107`) bounced to `/login` for one render → profile resolved → re-rendered.
  2. **React 18 batching trap in `Poll.tsx`** — `loadAll` is an async function with sequential `setMd()`, `setMyVote()`, `setCommitments()` calls. React 18 does NOT batch state updates inside Promise continuations (only synchronous handlers and React-managed event handlers). Each `set` causes a re-render. After `setMd(m)` fired but before `setMyVote(mv)` fired, the component rendered with matchday loaded but vote=null → "Will you play Thursday?" prompt rendered before the user's existing vote was known.
- Fix in commit `1ba7e71`:
  - **AppContext** — `setLoading(false)` now deferred until BOTH session AND profile are settled. Profile-fetch effect signals completion. Branded splash (FFC crest with subtle pulse) renders during loading instead of bouncing through routing guards.
  - **Poll.tsx** — added `dataLoading` boolean wrapping the entire `loadAll`. Skeleton guard is now `if (dataLoading || md === null)` so the skeleton stays mounted across all intermediate setter calls.
- Audited other surfaces (per "double check it's not happening anywhere else"): Leaderboard ✓, Matches ✓, Profile ✓, CaptainHelper ✓ — all use a single proper loading gate.

### PR #14 merge — Admin add commitment (Atomo)

- Atomo's PR #14 — `admin_add_commitment(matchday_id, profile_id)` RPC + "+ Add player" UI for Roster Setup.
- **First clean merge of the day** — `mergeStateStatus: CLEAN`, no conflicts, no migration collision. Atomo correctly picked `0053` (live DB was at 0052).
- Squash-merged at `71d2a2c`. Applied `0053` to live DB. Regenerated types (`d289aee`).

---

## Files Created or Modified

### New files
- `mockups/3-25-phase3-share-png-style-compare.html` — A/B style preview
- `mockups/3-26-phase3-share-png.html` — final approved mockup
- `docs/superpowers/specs/2026-04-29-phase3-share-png-design.md` — spec, ~480 lines
- `docs/superpowers/plans/2026-04-29-phase3-share-png.md` — plan, ~1577 lines
- `supabase/migrations/0049_match_card_payload_rpc.sql` — share-PNG RPC + bucket
- `supabase/migrations/0048_unlock_roster_rpc.sql` — Atomo PR #9 (renumbered from 0047)
- `supabase/migrations/0051_admin_add_guest_rpc.sql` — Atomo PR #13 (renumbered from 0049)
- `supabase/migrations/0052_admin_update_match_draft_rpc.sql` — Atomo PR #13 (renumbered from 0050)
- `supabase/migrations/0053_admin_add_commitment_rpc.sql` — Atomo PR #14
- `supabase/functions/render-match-card/index.ts` — EF entry point
- `supabase/functions/render-match-card/MatchCard.tsx` — Satori component
- `supabase/functions/render-match-card/deno.json`
- `supabase/functions/render-match-card/ffc-crest.svg` (copy of `ffc/public/ffc-logo.svg`)
- `supabase/functions/render-match-card/fonts/{Inter-SemiBold,PlayfairDisplay-Bold}.ttf` (kept for local `functions serve`; not deployed — fetched at runtime instead)
- `ffc/src/lib/shareMatchCard.ts` — frontend share helper
- `ffc/src/pages/admin/AdminRosterSetup.tsx` — Atomo PR #13
- `mockups/admin-roster-setup.html` — Atomo PR #13

### Modified files
- `ffc/src/pages/admin/MatchEntryReview.tsx` — share-PNG success state
- `ffc/src/components/MatchDetailSheet.tsx` — admin share button
- `ffc/src/lib/AppContext.tsx` — auth-loading race fix
- `ffc/src/pages/Poll.tsx` — `dataLoading` wrap fix
- `ffc/src/layouts/RoleLayout.tsx` — splash render
- `ffc/src/router.tsx` — splash render in HomeRoute, plus PR #13's `/admin/roster-setup` route
- `ffc/src/pages/Leaderboard.tsx` — column restructure (#8)
- `ffc/src/pages/admin/AdminHome.tsx` — PR #13's roster-setup card link
- `ffc/src/pages/admin/AdminMatches.tsx` — stale `@ts-expect-error` cleanup
- `ffc/src/index.css` — share-PNG CSS, splash CSS, leaderboard W/D/L colour classes, roster-setup CSS, add-commitment UI CSS
- `ffc/src/lib/database.types.ts` — regenerated 4 times (post-mig 0049, post-mig 0051+0052, post-mig 0053)
- `CLAUDE.md` — current state bumped to S054 close
- `tasks/lessons.md` — added EF binary-asset + Satori WOFF2 lessons
- `tasks/todo.md` — S054 close section, S055 NEXT SESSION

---

## Key Decisions

- **Migration renumbering policy** — when a PR's migrations collide with `main`, renumber on the PR branch before merging. Don't merge with collision and clean up later. Renumbering preserves `git mv` history; pushing the rename leaves a clear paper trail in `schema_migrations`. Now bit us 3× today (PR #9, PR #13 — PR #14 was clean because Atomo picked 0053 correctly after the second incident).
- **Share PNG: Supabase EF over Vercel Edge** — explicit choice during brainstorming. Sticks with existing 3-EF stack (notify-dispatch, purge-deleted-auth-user, notify-signup-outcome) rather than introducing Vercel functions for one feature. Tradeoff: Deno's npm interop for Satori/Resvg has rough edges (binary-asset deploy gap, WOFF2 quirks) — both surfaced today.
- **Share PNG: server-side over client-side `html-to-image`** — masterplan V3.0:140 specified server-side. Confirmed at brainstorming: rendering quality varies wildly by device, fonts often missing on iOS Safari WebView, blurred avatars on Android. Brand-risk too high for a hero feature.
- **OG attribution: scorer's own team with marker** — not the team that benefitted. Standard football reporting convention. User-flagged at mockup review; spec + plan SQL both corrected before implementation. Clean precedent for future "where the data lives vs where it counts" decisions.
- **Show match number prominently** ("Match 12 of 22") — `seasons.planned_games` is admin-set; non-friendly matchday count is a stable rank. Friendly matchdays excluded so league numbering stays sequential.
- **Issue #12 fix: branded splash, not loading text** — when `loading=true` in AppContext, route renders a centred FFC crest with subtle pulse animation (uses brand `--bg`/`--accent` tokens). Reuses the existing visual language; no new copy text.
- **Don't dispatch reviewers for mockup tasks** — the natural reviewer for an HTML mockup is the user opening it in a browser. Spec/code reviewer subagents are tuned for code, would add cycle time without catching anything. Applied this practice during the share-PNG mockup tasks.

---

## Open Questions

- **Live verification of share PNG** — needs a real Thursday matchday (admin approves real match → tap Share → verify PNG renders correctly + WhatsApp share sheet opens). Same for the auth+Poll loading splash. Owner: Mohammed (or Atomo on Phase 2 close session).
- **Awards push notification** — backburner from S053. Cheap follow-up using S048's two-bearer pattern. No urgency.
- **Awards backfill RPC** — Wall of Fame stays empty until S11 ends naturally OR an admin-triggered `backfill_season_awards()` runs. Decision deferred.
- **Resend custom sender domain** — `notify-signup-outcome` defaults to `onboarding@resend.dev`. No urgency unless league members start asking why emails come from `resend.dev`.

---

## Lessons Learned

### Mistakes

| Date | Mistake | Root Cause | Prevention Rule |
|------|---------|------------|-----------------|
| 2026-04-29 | Migration number collision happened 3× today (PR #9, PR #13 with 2 migrations). Atomo's PRs forked from older `main` reused numbers we'd already taken. | Branches forked before our migration landed; `db push` silently no-op'd because schema_migrations already had a row at that version. | **Before adding a migration, run `npx supabase migration list --linked`. Number new file = highest applied + 1. Or rebase onto `main` immediately before adding the migration.** Atomo did this correctly for PR #14 — first clean merge of the day. |
| 2026-04-29 | Initial spec/plan said "bundle TTF fonts in EF folder". Supabase EF CLI silently drops binary assets in subdirectories (only `.ts`/`.tsx`/`.json` upload). Function returned 500 on every cold start before any handler ran. | The Supabase docs don't flag this; deploy succeeds without warning. Caught only at first remote smoke test. | **For Supabase EFs, load binary assets via HTTP fetch at module init from a versioned CDN (jsDelivr / unpkg), or inline as base64 data URIs for small files (<20 KB). Never `Deno.readFile` a binary file in the EF folder.** Local copies stay in repo for `supabase functions serve` dev. |
| 2026-04-29 | First EF font fix used `.woff2` URLs from `@fontsource` jsdelivr. Satori v0.10 doesn't support WOFF2 (no Brotli decompression in its bundled font-decoder). Would have failed silently at first render. | Implementer's comment asserted "Satori accepts WOFF2" without verification. Caught proactively by orchestrator re-reading the Satori README before Task 11 manual test. | **Verify font-format support against Satori README before shipping. Use `.woff` (NOT `.woff2`) URLs from `@fontsource`. Satori supports TTF / OTF / WOFF only.** When a subagent reports DONE_WITH_CONCERNS, read the deviation carefully — "I changed X" is the spot to double-check. |
| 2026-04-29 | Issue #12 root cause was subtle: React 18's batching guarantees DON'T extend to Promise continuations. Sequential `setX()` calls inside an `async` function each cause a re-render. | `loadAll` did `setMd(m); setMyVote(mv); setCommitments(c)` after `await`s — between calls, the UI rendered with partial state. | **Don't rely on React 18 auto-batching across `await` boundaries. For multi-fetch loaders, gate the entire UI on a single `loading` boolean that stays `true` until ALL state setters have run. Set `loading=false` once at the end.** Same trap can hit any screen with multi-step async loads. |

### Validated Patterns

- **A/B style-compare → final mockup → execute** — second time using this pattern (S053 awards, S054 share-PNG). Both shipped on first implementation pass after mockup approval. **Why:** style-feel is risky to spec abstractly; cheap A/B mockups let user pick elements concretely, then the implementation phase follows a fully-specified visual.
- **Skip subagent reviewers for mockup tasks** — HTML mockup natural reviewer is the user. Code-quality / spec-compliance reviewers add cycle time without catching anything on pure layout files. Applied this on all 3 mockup tasks today; saved ~30 min of subagent dispatch overhead.
- **Schema-verify up-front with `\\dT match_event_type`-style probes BEFORE writing the SQL** — caught that `event_type` is `match_event_type` enum (not `event_type_enum` as plan guessed). Text-literal compares worked anyway, but the verification itself is the win — generalises CLAUDE.md rule #7 to cover enum names.
- **Single-CTE aggregation for "rank-and-credit" patterns** — initial spec had a two-CTE expanded→grouped pattern with team-flip logic. Bug fix simplified to one CTE grouping by `(event.team, profile_id, guest_id)` with no team flip. Cleaner AND the OG attribution is correct.
- **Renumber-on-branch + force-push + squash-merge** — for migration-collision conflicts, this is the workflow. Don't try to fix on `main` after merge. `git mv` preserves history; PR squash-merge keeps `main` clean.
- **Branded splash > loading text** — when an auth/data race needs a placeholder, render the existing brand assets (crest + paper-navy + gold) with a subtle pulse animation. Avoids "Loading…" copy that needs translation/styling and avoids the bouncing-routing-guard that the bug surfaced.
- **Defer subagent dispatches for closely-coupled file edits** — Tasks 9 + 10 in the share-PNG plan both modified `index.css`. Ran them sequentially (not parallel) to avoid CSS append conflicts. For Issue #8 + #12 today, files were truly disjoint (Leaderboard vs AppContext/Poll/RoleLayout) — ran in parallel safely.
- **Verify implementer fixes when DONE_WITH_CONCERNS reported** — Task 7 implementer fixed the binary-asset gap with WOFF2 URLs. Caught proactively by reading their concerns + cross-referencing Satori docs. Cost: 5 minutes. Saved: a Task 11 manual test that would have failed.

---

## Next Actions

- [ ] **Live verification on a real Thursday matchday** — share PNG end-to-end (admin approves match → Share button → PNG renders + WhatsApp sheet opens), auth-loading splash on cold reopen, Poll skeleton on tab switch, Leaderboard column reorder, Roster Setup screen, "+ Add player" sheet.
- [ ] **Phase 2 close (V3.0:122 8-box acceptance)** — Atomo handling from his end on a real Thursday.
- [ ] **Phase 3 backlog continued** — V3.0:141 (email signup notif partly covered by S051), V3.0:143 multi-season comparison, V3.0:144 highlights/clips, V3.0:145 player analytics (rejected once — needs different style direction), V3.0:146 H2H (same).
- [ ] **Trim cycle if any context file crosses 30 KB / 1000 lines** — CLAUDE.md, todo.md, lessons.md, INDEX.md all checked OK at S054 close. Re-check next session.

---

## Commits and Deploy

22 commits, range `14e3047..d289aee`. All on `main`, pushed cleanly.

**Mockups + spec + plan:**
- `b6f96e8` docs(s054): Phase 3 share-PNG design spec
- `126b61c` docs(s054): Phase 3 share-PNG implementation plan
- `d082023` mockup(s054): Phase 3 share-PNG A/B style compare (3-25)
- `cc2297d` mockup(s054): Phase 3 share-PNG final mockup (3-26) — element picks + OG fix
- `1eaf5cd` mockup(s054): 3-26 — match number in meta, drop venue
- `9970535` docs(s054): finalise share-PNG spec + plan from approved mockup

**Share-PNG implementation:**
- `bf8f7e0` feat(s054): migration 0049 — match card payload RPC + storage bucket
- `24f4a30` chore(s054): scaffold render-match-card EF folder + assets
- `382e96c` feat(s054): render-match-card EF source — Satori + Resvg pipeline
- `4db1161` fix(s054): render-match-card — fetch fonts/crest via HTTP instead of Deno.readFile
- `09e4281` fix(s054): swap EF fonts WOFF2 → WOFF for Satori compatibility
- `c353175` feat(s054): shareMatchCard frontend helper
- `987cd04` feat(s054): wire share-PNG into MatchEntryReview success state
- `91b76b9` feat(s054): wire share-PNG into MatchDetailSheet admin footer
- `ccc940d` docs(s054): close-out — share-PNG shipped, doc updates

**Atomo PR merges:**
- `14e3047` fix(2b): own-goal score, clock timing, roster refresh + unlock (#9)
- `cbdecac` feat(issue-11): Admin Roster Setup screen + 2 new RPCs (#13)
- `98e54e8` chore(s054): regen types after PR #13 migrations 0051 + 0052
- `71d2a2c` feat(issue-11): admin_add_commitment RPC + Add Player UI (#14)
- `d289aee` chore(s054): regen types after PR #14 mig 0053 (admin_add_commitment)

**Issue fixes:**
- `930cec7` fix(issue-8): Leaderboard column restructure — Pts to col 3, drop avatar, colour W/D/L
- `1ba7e71` fix(issue-12): eliminate login/poll flicker on app reopen

**Live state at session close:**
- `main` at `d289aee`
- Live DB: 53 migrations applied (deliberate gap at 0050 from PR #13's 0049/0050 → 0051/0052 renumber). 0048 / 0049 / 0051 / 0052 / 0053 are this session's adds.
- Edge Functions live: `notify-dispatch` (S048), `purge-deleted-auth-user` (S051), `notify-signup-outcome` (S051), **`render-match-card` (S054, v5)**.
- Vercel: auto-deployed every push throughout session. https://ffc-gilt.vercel.app/

---
_Session logged: 2026-04-29 | Logged by: Claude (session-log skill, FFC convention) | Session054_
