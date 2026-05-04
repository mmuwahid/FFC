


**S062 agenda — #38 remaining HIGH + remaining skeleton screens + live-verification:**

1. ~~**Phase 3 payment tracker** (V3.0:147)~~ — **VERIFIED SHIPPED in S060** (skeleton state). Full pipeline live-verification deferred to Thursday matchday (item 2).

2. **S058–S059–S060 live verification** — admin/auth-gated paths unreachable from preview, only confirmable on a real Thursday matchday:
   - [ ] **S060 payment tracker pipeline (mig 0055)** — admin approves next match → `payment_windows` row appears + 14 `match_payment_records` created · `/payments` shows summary strip + cards sorted by `outstanding_aed DESC` + open banner · tap player → ledger sheet opens · admin "Mark paid ✓" works · marking all paid auto-closes window · manual `🔒 Close M# window` works · `↩ Override — reopen window` works · realtime updates propagate to other open clients.
   - [ ] **S059 ref-link mint** — Apr 30 cleared up; admin generates ref link, ref opens `/ref/<token>`, KICK OFF console runs live timer + goal/card capture, SUBMIT → admin gets push, admin reviews → approves → leaderboard updates.
   - [ ] **S059 slot_index ordering** — re-save Apr 30 once; Poll team list order matches Roster Setup exactly; new matches saved post-S059 inherit correct order automatically.
   - [ ] **S059 captain pill** — when admin sets a captain via CaptainHelper, Poll renders gold filled "C" badge before the name (was inline gold "(C)" text before).
   - [ ] **S059 topbar Delete** — Roster Setup 🗑 button reachable from Pool/Teams/Saved phases; type-DELETE confirm; admin_delete_matchday cascades through unapproved drafts.
   - [ ] **#22 layout** — bottom-nav doesn't bob during Leaderboard/Matches load · dynamic island doesn't bleed on Settings/Rules · back buttons work on AdminMatches/AdminPlayers · AdminSeasons rows align cleanly · Payments page renders with proper styling (regression fix).
   - [ ] **#25 PNG hero** — open Profile → tap recent match → PNG hero loads at top of MatchDetailSheet · loading shimmer renders · failure path (no PNG yet) hides hero gracefully.
   - [ ] **#25 friendlies in Matches tab** — confirm friendly matches now appear in Matches tab with yellow `FRIENDLY` chip · leaderboard standings unaffected.
   - [ ] **#23 notification scope** — admin approves a match → only the 14 players in that match get `match_entry_approved` (was: ALL active profiles).
   - [ ] **#23 matchday_created** — admin creates a matchday → other admins (NOT the creator) get `📅 Matchday created` notification.
   - [ ] **#23 ranking_changed** — admin approves a match → players whose leaderboard rank changed get `📈` notification with payload `{old_rank, new_rank, points}` · first match of season is silent (no prior snapshot).
   - [ ] **#21 4-button admin grid** — past approved match card shows `👥 Edit roster` + `🗑 Delete match` next to existing Edit result / Formation / Pick captains.
   - [ ] **#21 Edit roster post-match** — opens sheet showing current 14 players · per-team cap chips show 7/7 · search-filtered add picker works · save calls `admin_edit_match_roster` · roster updates · re-snapshot fires ranking_changed for shifted players.
   - [ ] **#21 Delete match** — opens sheet with type-DELETE confirm · destructive button armed only when "DELETE" typed · calls `admin_delete_match` · match disappears · matchday row preserved · payment records cleared · ranking_changed fires for shifted players.
   - [ ] **#21 search on roster-add picker** — typing filters live · clears on selection · "No matches" empty state when query has no hits.

3. **Phase 2 close: V3.0:122 8-box acceptance on a real Thursday matchday** (still pending from S052/S053/S054/S055/S057).
   - [ ] No vote-chasing in WhatsApp — push reminders alone cover non-voters.
   - [ ] Roster locks itself at the deadline; confirmed/waitlist players get `roster_locked` push.
   - [ ] Captain pair auto-set on lock; admin gets `captain_auto_picked` push with override deeplink.
   - [ ] Confirmed player drops post-lock → admins + captains see CaptainDropoutBanner appear realtime.
   - [ ] Ref runs entire match on console (no paper).
   - [ ] Goals / cards / MOTM time-stamped at moment of capture.
   - [ ] After full-time, ref taps SUBMIT → admin gets push within 30 seconds.
   - [ ] Admin opens review screen, taps APPROVE → leaderboard updates without manual entry.

4. **#38 audit follow-ups** (recommended split into discrete issues vs. single design-system pass):
   - [x] **CRITICAL** — Topbar touch targets bumped to 44×44 (S060 `fb0b542`).
   - [x] **HIGH** — Border-radius tokens `--radius-sm/md/lg/pill` defined in `:root` (S062 `b65da7a`). No bulk replacement — new CSS uses tokens going forward.
   - [x] **HIGH** — Global `:focus-visible` ring shipped (S062 `b65da7a`).
   - [x] **HIGH** — Awards screen shimmer skeleton replacing plain loading text (S062 `b65da7a`).
   - [x] **HIGH** — Skeleton-row coverage complete (S062 `229d5e8`): Settings, Payments, AdminPlayers, AdminMatches, AdminSeasons all shipped with shared `.app-skel-block` shimmer base. Poll + Profile + Leaderboard + Matches + Awards already had screen-specific skeletons. AdminHome / Rules / Auth screens don't load data.
   - [x] **POLISH** (S062 closeout — 7 commits b65da7a..abbffa0):
     - [x] Typography scale tokens `--text-xs/sm/md/lg/xl/2xl` (10/11/13/15/18/22) in `:root`.
     - [x] Border-radius scale tokens `--radius-sm/md/lg/pill` in `:root`.
     - [x] 4pt spacing grid tokens `--space-1` through `--space-10` in `:root`. (Tokens defined; bulk replacement of existing hardcoded values intentionally skipped — visual regression risk vs no UX benefit. New CSS uses tokens going forward.)
     - [x] Brand-colour tokens `--team-white-accent` / `--team-black-accent`; `.po-row--team-*` migrated.
     - [x] Hover/active feedback on cards: global `button:active` opacity dip + `:active scale(0.985)` on `.mt-card`, `.aw-hero`, `.aw-wall-cell--link`.
     - [x] State-flip transitions: `app-state-fadein` (220ms) on `.po-status` (Poll vote-state remounts) + season-picker list containers (`.lb-list`, `.mt-list`, `.py-list`, `.as-list`, `.admin-md-list`, `.aw-heroes`).
     - [x] Tab-switch transitions: `.admin-seg` 150ms transitions on background/color/box-shadow.
     - [x] Padding-top unification: Settings 18px → 16px to match Rules pattern (both suppress AppTopBar, both now on 4pt grid).
     - [x] `prefers-reduced-motion: reduce` global safeguard collapses all animation/transition durations.

5. **Optional / follow-up:**
   - [ ] **Tap-to-increment Scorer Picker sheet** (mockup tile B from S058) — only if user finds per-row goals input tedious for high-scoring matches.
   - [ ] **Manual slot reorder UI** in AdminRosterSetup (drag/swap on locked rosters) — S059 added the slot_index column but no UI to reorder once saved; only re-save replaces.
   - [ ] **Audit existing CSS grid tables** for column-order-vs-JSX-order mismatches per S059 #30 lesson (Leaderboard had this latent since launch — likely other grid tables in the app have similar issues that haven't surfaced yet).
   - [ ] **Audit any new `match_players` SELECT** before merge for the FK ambiguity bug (S058 #25 + S059 #36 both bit on the same `profile:profiles(...)` ambiguous embed).

**Backburner:**
- **Awards backfill RPC** — admin-triggered `backfill_season_awards()` to populate `season_awards` for ended seasons predating mig 0047.
- **Awards push notification** — when `seasons.ended_at` flips, push admins + winners ("Season N awards are in!").
- **Resend custom sender domain** — verify a domain in Resend, set `NOTIFY_FROM` env on `notify-signup-outcome` EF.
- **Phase 3 backlog (post-S059):** ~~payment tracker~~ (S060 active) · multi-season comparison stats · player analytics · H2H comparison · player badges / achievements · injury / unavailable list. Mockups in `mockups/` first per Rule #1.
- **Player analytics + H2H** (V3.0:145–146) — first attempt rejected in S053; re-attempt with different style direction if user wants.

## Completed in S060 (30/APR/2026, Work PC)

**2 implementation commits (`b962291` + `fb0b542`) + 1 docs commit. 1 migration applied (0064). Live DB: 63 → 64.**

- [x] **Phase 3 payment tracker (V3.0:147)** — verified shipped (skeleton state) at `/payments`. Backend complete since S056 mig 0055 (10 RPCs + 2 triggers + realtime publication); frontend complete since S056+S058 (Payments.tsx 264L + PaymentLedgerSheet.tsx 269L + CSS restored verbatim). DOM-eval at dev preview confirmed: header / season pill / 3-box summary strip / banner-hidden / `No matches played this season yet.` empty state. RPC `get_season_payment_summary` POST → 200. Empty because Game 31 was approved before mig 0055; spec §11 explicitly accepts no historic backfill. Full pipeline live-verification deferred to Thursday matchday.
- [x] **PR #39 triage** — atomosh `feature/fix-login` was 69 commits behind main, mergeStateStatus DIRTY. Net diff −19,315/+1,639 would have erased S053–S059 (16 migrations + Awards.tsx + Payments.tsx + PaymentLedgerSheet.tsx + shareMatchCard.ts + render-match-card EF + 7 plan/spec docs). Root cause: PR #9 squash-merged 29/APR 11:22Z; atomosh kept pushing to same branch from old base `d8c8938`; six PRs landed on main during next 36h, branch never pulled any. Posted comprehensive triage comment at PR #39 with impact tables, commit-by-commit timeline, and 9 workflow rules (never reuse branch after squash-merge / sync daily / delete merged branches / trust mergeStateStatus / etc). Decision: don't merge; awaiting atomosh response.
- [x] **Slop-mockup correction cycle (#41)** — first mockup invented a fresh match-card design instead of using live `matches.css` ruleset. User rejected hard. Located canonical CSS at `ffc/src/styles/matches.css` (separate from `index.css` — cross-file rule sets are a recurring trap). Rebuilt with live CSS copied verbatim + only new classes added. Approved.
- [x] **Lesson captured 3 places** — sharpened lessons.md Critical Rule #6 from "Match existing app styling" to "Mockup matches live state verbatim, additions only" with explicit `grep -rn` instruction; added S060 patterns section (verbatim-mockup, screenshots-as-ground-truth, inline-SVG-for-emoji); created auto-memory `feedback_mockup_no_redesign.md` + index pointer.
- [x] **Issue #41 `b962291`** — Migration 0064 adds `matches.ref_name TEXT NULL` + `pending_match_entries.ref_name TEXT NULL` + `pending_match_entry_players.is_no_show BOOL NOT NULL DEFAULT false`; `submit_ref_entry` reads ref_name + is_no_show from payload; `approve_match_entry` carries both through to live tables. Frontend: `useMatchSession.ts` extended (refName + injuredIds Set + toggleInjured + persisted state forward-compat hydration); RefEntry pre-match required ref-name input gated ≥2 chars; RefEntry review new "🩹 Injured Players" section per team with toggle button; SubmitPlayer + SubmitPayload + buildSubmitPayload extended; Matches.tsx ref_name in query + gold REF pill in banner middle + 🤕 → 🩹 swap in ParticipantBadge. CSS: `.mt-card-ref-pill` + `.mt-stat-icon--injury` in matches.css; full ref-name + injuries section CSS in ref-entry.css. `tsc -b` EXIT 0; mockup `mockups/match-card-fifa.html` shipped as part of commit. **Live verification** owed Thursday matchday (admin/auth-gated paths).
- [x] **Issue #38 CRITICAL `fb0b542`** — `.app-topbar-bell` + `.app-topbar-avatar` 36×36 → 44×44 per Apple HIG; bell font-size 18→20; avatar initials 13→15; avatar radius 12→14. Single CSS file commit. Verified live via `preview_inspect` (both at 44×44).

### S060 patterns / lessons (additive)

- **Verbatim live-CSS copy + diff-only additions for mockups of existing/approved screens.** First #41 mockup invented a fresh design (gold WINNER text, gold-bordered VS pill, uniform splitc halves) instead of locating `ffc/src/styles/matches.css`. User rejected immediately. Right rule: `grep -rn "\.<root-class>" ffc/src/styles/ ffc/src/index.css` first; cross-file rule sets are common (e.g. `.mt-screen` in index.css, `.mt-card`/`.splitc-*` in matches.css — checking only one CSS file misses half).
- **Stylized-object emoji renders inconsistently across platforms.** `⚽` U+26BD is blue/white on Windows Segoe UI Emoji but black/white on iOS/Android. CSS-emoji is reliable for symbol shapes (🟨🟥), unreliable for stylized objects (⚽🏆). Inline SVG via `<symbol id>` + `<use href>` is the reliable cross-platform path.
- **User-attached screenshots are ground truth, not the codebase reading.** When user pastes a screenshot of the live app + says "follow this exactly", that screenshot is the spec. Verify mockup matches it element-by-element (background asymmetry, exact pill colours, label positions, ribbon styling) before claiming completion.
- **Squash-merge + branch reuse is a high-cost anti-pattern.** PR #9 squash-merged → atomosh's local `feature/fix-login` orphaned but reused for new work → 36h later branch is unmergeable. Workflow rules now codified in PR #39 comment + lessons.md.
- **Migration + CREATE OR REPLACE pair shipped in single .sql file** (mig 0064 alters tables + rewrites both `submit_ref_entry` and `approve_match_entry`) keeps the schema/DML/DDL change atomic; rollback is one file; reviewer sees the full data-flow path in one place.
- **`Set<string>` in React state for selection toggles + persist as `Array.from(set)` in localStorage** — cleaner than per-item booleans, JSON-serializable on hydrate, supports `O(1)` `.has()` checks in render path.
- **PR triage as a public comment with workflow rules** rather than a quiet close — the lesson lives where future PRs in the same shape will be referenced from, and the contributor sees concrete rules instead of just a rejection.

## Completed in S059 (30/APR/2026, Work PC)

### Post-original-close: 9-issue GitHub sweep (3 commits, no migrations)

After original S059 close (`e960df2` + docs `69768aa`) user confirmed Apr 30 + May 7 fixes worked end-to-end and asked to triage GitHub issues. 5 open at start; 4 more (#35-#38) opened mid-sweep as testing surfaced fresh bugs.

- [x] **Phase E `f9ea2d4` — 5-issue batch (#30 #31 #32 #33 #34).** WhatsApp share button now surfaces every result kind via coloured toast (was silently dropping desktop-fallback). Sign-out duplicate removed from Settings. AdminPlayers default tab `pending` → `active`. Leaderboard last-5 column had two bugs: grid-template column-order didn't match JSX cell-order (Pts was template-10th but JSX-3rd, so Last-5 cell rendered at 44px — bug since launch); D pill was cream-translucent rather than grey. Reordered template, made Last-5 `minmax(140px, 1fr)`, recoloured D pill `#8a8e96`. Match cards now show yellow/red cards + injuries inline with goals via new `ParticipantBadge` component.
- [x] **Phase F `4e07a72` — Poll locked-row layout (#35) + EditRoster auto-populate (#36).** Poll: when locked, `.po-rank` cell omitted from JSX but grid template still 4 columns → timestamp ended up in wide 1fr slot, name squeezed into 32px slot. Added `.po-row--locked` modifier with 3-column grid. EditRosterPostSheet: same PostgREST FK ambiguity bug Matches.tsx scorers had in S058 (`profile:profiles(...)` ambiguous when match_players has 3 FKs to profiles). Disambiguated via `!match_players_profile_id_fkey`, added slot_index ordering, added error console-log.
- [x] **Phase G `1dd1f27` — match-card alignment + cleanup (#37).** Cards were 14px inset from screen edges (`.mt-list { padding: 0 14px }` while `.mt-screen` had no horizontal padding). Dropped list padding, dropped `.mt-card` 440px max-width cap. Per user follow-up: removed MOTM footer strip (scorer list already shows MOTM inline as gold ⭐ + name in gold) and HAT pill (`×N` suffix conveys hat-trick).
- [x] **Phase H — UI audit issue (#38).** Treated as research/audit ask not single-fix bug. Posted comprehensive audit comment with categorised findings (CRITICAL / HIGH / POLISH); mapped 9 already-fixed items to today's commits. Closed #38 — audit IS the deliverable. CRITICAL + HIGH items queued in NEXT SESSION agenda above.
- [x] **Verification:** all sweep fixes verified via DOM-eval at dev preview before each push (button widths, grid templates, presence/absence of expected elements, sheet overlays, console errors). `tsc -b` EXIT 0 across all 3 sweep commits.
- [x] **GitHub:** 9 issues closed via `gh issue close` with detailed delivery comments.

### S059 sweep patterns / lessons (additive — see also lessons.md)

- **Grid template column-order MUST match JSX cell-order; CSS doesn't auto-reflow on mismatch.** Latent in Leaderboard since launch; surfaced when Last-5 fell to the narrow 44px Pts slot.
- **Conditional JSX rendering of a grid cell breaks the column count.** If `{cond && <X />}` removes a child, must adjust `grid-template-columns` via a class.
- **PostgREST embed-ambiguity is a recurring class of bug.** `match_players → profiles` ambiguity bit S058 #25 AND S059 #36; always use `!match_players_profile_id_fkey` explicitly.
- **For browser features that vary across platforms (Web Share API), always wire result handling to user-visible feedback.** Silent download fallback on desktop Chrome looked like "nothing happened" until #34's toast.
- **Issue body can override what the title implies.** #30 title was "color code wins/draws/losses"; body revealed the real bug was column clipping. Read body in full before scoping.
- **DOM eval at the dev preview is faster than re-deploying** for verification of DOM-observable fixes. Used throughout the sweep.
- **An audit-style issue is its own deliverable; don't spawn 10 sub-issues mechanically.** #38 closed with comprehensive comment as the output; user can break out items if/when prioritized.

### Original S059 close: Live ref access flow + Poll team-split fix + matchday delete + slot_index

**3 commits, 3 migrations applied (0061, 0062, 0063) + retroactively recorded 0060. Live DB: 58 → 63. Final HEAD: `e960df2`.**

See `sessions/S059/session-log.md` for full per-phase narrative.

- [x] **Phase B `2c10cb7` — delete-matchday RPC + UI + relaxed delete-match gate.** Migration 0061 `admin_delete_matchday(p_matchday_id)` SECURITY DEFINER (is_admin guard, audit BEFORE delete, cascades through poll_votes/ref_tokens/pending_match_entries/draft_sessions+draft_picks/formations/match_guests; refuses if matches row exists per RESTRICT FK). AdminRosterSetup gains Delete button on Saved-state footer next to Edit + type-DELETE confirm sheet. AdminMatches Delete-match button gate relaxed from `{approved && md.match}` to `{md.match}` (was approved-only — RPC supported any match row but UI gate was wrong). CSS `.rs-btn--danger` + `.rs-sheet-btn--danger`. Migration filename collision (stray `0060_seasons_games_seeded.sql` already on remote from `bb13127` games_seeded polish but not in local history) resolved via `npx supabase migration repair --status applied 0060 --linked` then renaming new file to `0061`.
- [x] **Phase C `2a955ac` — Poll team-split scrambled fix + admin_delete_matchday v2.** Issue: Apr 30 Poll showed WHITE 6 / BLACK 8 with players on completely different teams vs Roster Setup's 7/7. Root cause: `Poll.tsx:274-277` match_players query missing `.eq('match_id', …)` — returning every row across every match each player had been in, then `mpMap.set(profile_id, …)` overwrote randomly. Same bug guest-side. Fix: scoped both queries + defensive skip if no draft match. Migration 0062 updates `admin_delete_matchday` body via CREATE OR REPLACE — now cascades through UNAPPROVED draft matches (saving roster via create_match_draft inserts an unapproved match row; original 0061 refused unconditionally → user's "Delete" silently errored on May 7); only refuses if `approved_at IS NOT NULL`.
- [x] **Phase D `e960df2` — slot_index column + Poll polish + topbar Delete.** First slot-order fix attempted client-side sort by `created_at, id` — failed because `create_match_draft` does FOREACH … INSERT in single transaction (every row shares transaction-start `now()`; uuid `id` tiebreaker random). Migration 0063 adds `match_players.slot_index integer` (per-team 1-based) + backfills via `ROW_NUMBER() OVER (PARTITION BY match_id, team ORDER BY created_at, id)` + new index `(match_id, team, slot_index)` + CREATE OR REPLACE updates to `create_match_draft` / `admin_update_match_draft` (FOREACH counters) / `admin_edit_match_roster` (WITH ORDINALITY + window function for jsonb-array path). Frontend: Poll.tsx reads slot_index, sorts whiteList/blackList by new comparator, hides rank chip when locked. Captain marker restyled as gold filled pill (was tiny inline gold text). AdminRosterSetup.loadRoster orders by `(team, slot_index)`. New `.rs-topbar-delete` 🗑 button reachable from Pool/Teams/Saved phases.
- [x] **Verification:** `tsc -b` EXIT 0 across all 3 phases. Preview server confirmed: Poll WHITE 7 / BLACK 7 with player names in slot order, ranks hidden (0 `.po-rank` elements), captain pill style applied; AdminRosterSetup topbar 🗑 renders correctly; no console errors.

### S059 patterns / lessons (additive)

- **For per-row order in PG, never rely on `created_at` to disambiguate within a transaction.** All FOREACH INSERTs in one transaction share `now()` (transaction start). If you need stable insertion order, add an explicit `slot_index integer` column written by the RPC at insert time. Tried client-side sort first; failed; came back and added the column. Generalises beyond match_players — anywhere bulk INSERT order matters for display.
- **For destructive admin RPCs, ask "what does the user expect this to delete" not "what does the FK graph let me delete".** Default to cascade-through-children for non-load-bearing children (drafts, votes, tokens). Only refuse on children that represent committed history (approved matches, payment records). Original 0061 refused on any matches row — wrong mental model — fixed in 0062.
- **Always grep for sibling usages when fixing a Supabase query bug.** When fixing the missing `match_id` filter in Poll.tsx, ran `grep -rn "from('match_players')"` and confirmed FormationPlanner / MatchDetailSheet / AdminMatches / AdminRosterSetup / CaptainHelper / Profile already scoped correctly. Confirms the bug is local rather than systemic.
- **`migration repair --status applied <version>` to record a remote migration applied without local tracking.** `db push` errored on duplicate version key; repair recorded it without re-running. Less destructive than dropping/re-applying.
- **`CREATE OR REPLACE FUNCTION` to re-issue an RPC body in a follow-up migration.** Args unchanged → no DROP needed → keeps upgrade path linear without breaking GRANT EXECUTE state. Used 4× this session (0062 + 3× in 0063).
- **`WITH ORDINALITY` + `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ord)` for slot_index in jsonb-array RPCs.** Single-statement insert, no procedural counter. Clean SQL idiom matching how FOREACH counters work in plpgsql peers.
- **Verify hypothesis with DOM eval before coding the fix.** Phase A debug: tapped Review/approve in user's screenshot → opened EditResultSheet not MatchEntryReview → that 1 fact reframed the entire diagnosis (it's a `matches` row, not a `pending_match_entries` row). UI-state evidence trumps schema reading.

## Completed in S058 (30/APR/2026, Work PC)

### All 4 outstanding GitHub issues closed (#22 #25 #23 #21)

**5 commits, 4 migrations. Live DB: 55 → 58. Final HEAD: S058 close docs commit (TBD on push).**

See `sessions/S058/session-log.md` for full per-phase narrative.

- [x] **Phase A `d366629` — issue #22 UI audit + Payments CSS regression restore.** Skeleton row min-heights locked (Leaderboard + Matches). Settings + Rules safe-area-top padding (suppress AppTopBar so screen pads itself). Back buttons added on AdminMatches + AdminPlayers. AdminSeasons topbar 3-col grid alignment via shared `min-height: 44px`. **Bonus regression fix:** PR #28 squash-merge had silently deleted 357 lines of Payments page CSS that S056 added — restored verbatim from commit `9b5fcbb`.
- [x] **Phase B `51c64dd` — issue #25 hybrid PNG hero + matches-tab show friendlies.** Migration 0056 opens `get_match_card_payload` to any authenticated user. New `getMatchCardUrl()` helper with 14-min session cache. MatchDetailSheet renders PNG hero above existing W/D/L chip + rosters when match is approved. Live-DB diagnosis showed user's "matches tab empty" was likely a friendly match seen in Profile (no filter) but excluded from Matches tab; dropped client-side `is_friendly` filter, friendlies now render with yellow `FRIENDLY` chip in card banner.
- [x] **Phase C `d878b36` — issue #23 full notification pipeline coverage.** (1) BUG: `approve_match_entry` was inserting per-active-profile (200+ rows / approval); migration 0057 scopes to match's 14 players. (2) GAP: matchday creation was silent; migration 0057 adds `matchday_created` enum value + `notify_matchday_created()` AFTER INSERT trigger on matchdays (notifies admins except creator). (3) GAP: leaderboard rank changes had no event source (view, not table); migration 0058 adds `ranking_changed` enum + `player_rank_snapshots` table + `snapshot_and_diff_ranks(season_id)` function + `approve_match_entry` calls it. Frontend wiring in `notificationDeeplinks.ts` + `sw.ts` + NotificationsPanel icon mapping.
- [x] **Phase D `47553ff` — issue #21 admin match management redesign (mockup-first).** Mockup `mockups/admin-matches-v2.html` (4 phone tiles) shipped + approved with one iteration (added tap-to-increment scorer picker after user feedback). Migration 0059: `admin_delete_match` (audit BEFORE + explicit clear of payment FKs that don't cascade + hard-delete + post-snapshot) and `admin_edit_match_roster` (replace strategy + per-team cap validation + post-snapshot). MatchdayCard gains `👥 Edit roster` + `🗑 Delete match` buttons on approved cards. DeleteMatchSheet (type-DELETE confirm) + EditRosterPostSheet (parallel load, per-team caps, search-filtered picker). ResultEntrySheet add-player picker gets sticky search input. **Deferred to S059:** dedicated Scorer Picker sheet (per-row goals input handles multi-goal adequately for now).
- [x] **GitHub:** all 4 issues closed via `gh issue close` with detailed delivery comments.
- [x] **Verification:** `tsc -b` EXIT 0 + `vite build` clean across all 4 phases. PWA precache ended at 12 entries / 1696.25 KiB (+34 KiB total session). Migrations verified live.

### S058 patterns / lessons (additive)

- **Squash-merge of long-lived branches can silently delete unrelated changes.** PR #28's squash deleted 357 lines of S056 Payments CSS. Pattern: before merging any squash that touches a high-traffic file, grep diff stat for unexpected deletions.
- **Plan-mode AskUserQuestion for multi-decision sessions.** Resolving 3 scoping forks up-front via one round-trip → plan approved without revision; same pattern as S055 #15.
- **Mockup-first delivers; don't skip even when implementation seems obvious.** Issue #21 user caught "what if he scored more than 1 goal" via mockup review before any code shipped.
- **CASCADE vs NO ACTION FK cleanup before DELETE.** Query `pg_constraint` for child tables; anything `confdeltype='a'` needs explicit DELETE before the parent. Used in `admin_delete_match` for payment_records + payment_windows.
- **`ALTER TYPE … ADD VALUE` must be in its own BEGIN/COMMIT block.** PG requires the new enum value committed before use. Followed S043/S045 split-block pattern in 0057 + 0058.
- **Re-snapshot ranks after any leaderboard-shifting admin action.** `admin_delete_match`, `admin_edit_match_roster`, `approve_match_entry` all call `snapshot_and_diff_ranks(season_id)`. The view recomputes on read; the snapshot table needs manual maintenance to avoid drifting baselines that fire incorrect future notifications.
- **Live-DB diagnosis before assuming a frontend bug.** Issue #25b — DB query showed data was fine; user's report was likely friendly-match in Profile vs filtered Matches tab. Diagnosing prevents over-engineering.
- **Restore deleted CSS verbatim from a known-good commit.** Don't rewrite, don't refactor — `git show <hash>:path | sed -n 'N,Mp' >> target` with banner comment. Rewriting introduces drift.

**S057 agenda — live verification, Atomo issues triage, payment tracker mockup:**

00. ~~**Push S056 commits + close issues #16/#17/#19, comment on #18+#20**~~ — **DONE (S057 session start)**
   - [x] PRs #28 (roster-setup-v2) + #29 (datetime-confirm) merged. `tsc -b` EXIT 0.
   - [x] Issues #16, #17 closed via `gh issue close` with S056 delivery notes.
   - [x] Issues #19, #20 auto-closed by PR merges.

00a. **Atomo new issues triage (#21–#27):**
   - [x] **#27 (Admin match management)** — `isPast` guard added: "Enter result" only renders when kickoff timestamp has passed. `275ede8`.
   - [x] **#24a (Avatar initial overflow)** — `.pf-avatar-wrap img.pf-avatar { display: block }` — now only `<img>` gets `display:block`; the `<span>` initials variant keeps `display:grid; place-items:center`. `275ede8`.
   - [x] **#24b (Profile header dynamic island)** — `.pf-nav` padding-top now `calc(var(--safe-top, 0px) + 10px)`. `275ede8`.
   - [x] **#26 winner tap** — Avatar photo on awards hero card is now a `<button>` that navigates to the winner's profile (same onClick as name); larger tap target on mobile. `f135a66`.
   - [ ] **#22 (UI footer alignment)** — Full CSS/layout audit: bottom nav shifts on load, dynamic island bleed on non-profile screens, season management row misalignment. Deferred to S058.
   - [x] **#24c (Career goals formula mismatch)** — Fixed `717ab34`: career stats now aggregate from `v_season_standings` across all seasons (same source as leaderboard). Issue #24 closed.
   - [x] **#26 awards data (cumulative)** — View `v_season_award_winners_live` confirmed correct. "Only last game" = only 1 match approved in live DB. Issue #26 closed with explanation.
   - [ ] **#25 (Recent matches)** — (a) matches tab empty despite logged matches. (b) player-profile recent-match card format should match WhatsApp share card. Deferred to S058.
   - [ ] **#23 (Push notification)** — notifications not appearing. Trace pipeline end-to-end. Deferred to S058.
   - [ ] **#21 (Edit result + roster flow redesign)** — mockup first per CLAUDE.md rule #1. Deferred to S058.

0d. **S056 live verification:**
   - [ ] **#16 (AdminPlayers)** — active player row shows faint ✏ on the right; tapping anywhere on the row still opens the edit sheet; tapping 🚫 still opens ban sheet (no double-action regression).
   - [ ] **#17 (Roster pool position pills)** — pills are colour-coded: GK light blue, DEF periwinkle, CDM teal, W orange, ST rose. Visible on both pool and waitlist chips. Same colours render after waitlist→pool promote.
   - [ ] **#18 partial — chip × inside boundary** — pool chip × button now renders INSIDE the chip outline (not floating outside as a separate red circle). Tapping × still removes; loading state while RPC in flight still works.
   - [ ] **#18 partial — no auto-promote on cancel** — tapping × on a pool chip when waitlist is non-empty: chip disappears, but waitlist stays unchanged. Admin must tap the waitlist chip to promote.
   - [ ] **#18 partial — cap overflow on add** — when total = pool + assigned >= cap, "+ Add player" routes new player to waitlist (toast says "added to waitlist (roster full)"); when total < cap, routes to pool as before.
   - [ ] **#19 (CreateMatchdaySheet)** — change kickoff date → poll opens auto-jumps to kickoff−3d 09:00 local; poll closes auto-jumps to kickoff−1d 21:00 local (both visible in the inputs). Pick a Wed or Fri date → amber "Not a Thursday — double-check the date." banner appears below the sheet header. Pick Thursday → banner hidden.

0c. **Issue #15 live verification (S055 deliverable, NOTE: auto-promote no longer present per S056 #18 fix):**
   - [ ] Pool × button → tapping × on a chip in the "Unassigned" pool list calls the right RPC (admin_cancel_commitment for registered, admin_cancel_guest for guests); chip disappears; toast confirms.
   - [ ] ~~Auto-promote on cancel~~ **REMOVED in S056 #18 fix** — admin must manually tap a waitlist chip to promote.
   - [ ] Waitlist visible — when yes-voters > roster_cap (14 for 7v7 / 10 for 5v5), a "Waitlist (N)" section renders below the pool with muted dashed-border chips.
   - [ ] Waitlist tap-to-promote — tapping a waitlist chip moves them into the pool (UI-only, no RPC needed); toast confirms.
   - [ ] Hybrid auto-fill — with no active target, tapping a pool chip fills slots alternating White → Black → White → Black; with active target, fills that specific slot (S054 behavior preserved).
   - [ ] Result-locked refusal — once a match has a result recorded, both new RPCs raise '42501' so admin can't retroactively cancel commitments.



0. **Phase 3 share PNG live verification (S054 deliverable):**
   - [ ] Admin approves a real match → success state shows Share button.
   - [ ] Tap Share → `render-match-card` EF generates PNG matching mockup 3-26.
   - [ ] Web Share sheet opens on mobile (or PNG downloads on desktop).
   - [ ] Re-share path on MatchDetailSheet admin footer works.

0a. **S054 issue-fix verification:**
   - [ ] **#8 Leaderboard restructure** — column order Rank → Player → Pts → MP → W → D → L → GF → Win% → Last 5; avatar gone from Player cell; W cell green / D muted / L red.
   - [ ] **#12 auth-loading splash** — cold-reopen on logged-in account no longer flashes login screen; instead shows centred FFC crest with subtle pulse until profile loads.
   - [ ] **#12 Poll skeleton** — switching to Poll tab with existing vote no longer flashes the Yes/Maybe/No prompt before resolving to the existing vote.

0b. **Atomo's S054 PR verification:**
   - [ ] **PR #13 Roster Setup** — `/admin/roster-setup` loads, defaults to most recent locked matchday; tap-to-assign pool→slot works; +Add guest sheet works; Confirm Roster activates only at exactly 7+7 (or 5+5); edit-mode banner appears on re-entry; Update Roster respects `admin_update_match_draft` (blocked once result recorded).
   - [ ] **PR #14 Add Player** — "+ Add player" button opens searchable list of registered players not yet confirmed; tapping calls `admin_add_commitment` and adds them to the pool; idempotent on duplicates; rejected/banned players are blocked.

1. **Phase 2 close: V3.0:122 8-box acceptance on a real Thursday matchday** (still pending from S052/S053).
   - [ ] No vote-chasing in WhatsApp — push reminders alone cover non-voters.
   - [ ] Roster locks itself at the deadline; confirmed/waitlist players get `roster_locked` push.
   - [ ] Captain pair auto-set on lock; admin gets `captain_auto_picked` push with override deeplink.
   - [ ] Confirmed player drops post-lock → admins + captains see CaptainDropoutBanner appear realtime.
   - [ ] Ref runs entire match on console (no paper).
   - [ ] Goals / cards / MOTM time-stamped at moment of capture.
   - [ ] After full-time, ref taps SUBMIT → admin gets push within 30 seconds.
   - [ ] Admin opens review screen, taps APPROVE → leaderboard updates without manual entry.

2. **Awards page live verification (S053 deliverable):**
   - [ ] `/awards` route loads from Leaderboard's new gold trophy icon-btn (third in controls row after Filter + Sort).
   - [ ] Active season → "PROVISIONAL · Active" badge + 3 hero cards reading from `v_season_award_winners_live`.
   - [ ] Hero name tap → navigates to `/profile?profile_id=...&season_id=...`.
   - [ ] Runner-up sub-line tap → navigates to runner-up's profile.
   - [ ] Season pill dropdown → switching seasons changes data source (view for active, snapshot table for ended).
   - [ ] Once a season ends naturally → trigger fires → `season_awards` table gets 3 rows → "FINAL · Ended" badge appears + Wall of Fame includes that season.
   - [ ] Wall of Fame empty state ("First season — Wall of Fame begins after this season ends") renders correctly until S11 ends.
   - [ ] Empty active season ("No matches played yet this season — awards will appear once results are in") will be visible until first match approved.
   - [ ] Soft-deleted past winner renders as muted "Deleted player" in Wall of Fame cell (when applicable).

3. **GitHub issue #1 (deferred from S052)** — Leaderboard player abbreviation. User explicitly wants pills (position + MOTM star) to STAY. Re-open only if portrait readability still feels poor.

4. **Issue #18 — remaining 3 complex sub-asks** (still deferred, #20 shipped via PR #28):
   - [ ] HTML mockup in `mockups/` showing: lock-before-team-select gate (must lock pool before any slot is tappable), player return-to-origin on slot remove (back to correct section not auto-clear), dirty-nav guard (block back-button if unsaved changes). *(Removed-players category was delivered in PR #28.)*
   - [ ] User review → finalise → spec → plan → implement.

4a. **Atomo issues fix-pack (quick wins — no mockup needed):**
   - [ ] **#22** — bottom nav fixed, dynamic island safe-area, season management alignment, back buttons on drill-down screens.
   - [ ] **#24** — avatar initial overflow, dynamic island on profile header, career goals formula vs leaderboard source.
   - [ ] **#26** — awards cumulative data fix (`v_season_award_winners_live`), winner name tap → profile navigation.
   - [ ] **#27** — block result entry for future-date matches (date guard in admin result UI).

4b. **Atomo issues requiring investigation:**
   - [ ] **#25** — diagnose why matches tab shows no history despite logged matches; align player-profile recent-match card to share-card format.
   - [ ] **#23** — trace notification pipeline (match creation → result add → ranking change); verify bell panel shows all notifications with timestamps + clear action.

4c. **Issue #21 (edit result + roster flow redesign)** — mockup-first per CLAUDE.md rule #1:
   - [ ] HTML mockup: Edit Roster button at match-list level (outside result sheet), scorer drop-down with search bar, delete-match button.
   - [ ] User review → finalise → implement.

5. **Phase 3 payment tracker** (V3.0:147 — full slice on top of S056 spec at `docs/superpowers/specs/2026-04-29-payment-tracker-design.md`):
   - [ ] HTML mockup in `mockups/` for the 3-screen flow (season overview → admin drilldown → player ledger). Use Option B compact card layout + Option C inline status icons (✓/⏳/✗). Reject any return of outline pills.
   - [ ] User review → finalise → migration (3 tables: `match_fees`, `match_payments`, `payment_ledger_view`) + RPCs + RLS + screens.

6. **Carry-over verification** — push subscribe (Chrome desktop + iPhone PWA installed), Resend signup-outcome email, captain reroll live test on a real matchday.

**Backburner:**
- **Awards backfill RPC** — admin-triggered `backfill_season_awards()` to populate `season_awards` for ended seasons predating mig 0047. Wall of Fame stays empty until then OR until S11 ends naturally.
- **Awards push notification** — when `seasons.ended_at` flips, push admins + winners ("Season N awards are in!"). Easy follow-up using the S048 two-bearer pattern.
- **Resend custom sender domain** — verify a domain in Resend, set `NOTIFY_FROM` env on `notify-signup-outcome` EF (default is `onboarding@resend.dev`).
- **Phase 3 backlog (post-S054 update)** — multi-season comparison stats · player analytics · H2H comparison · **payment tracker** (NEW) · **player badges / achievements** (NEW) · **injury / unavailable list** (NEW). Per CLAUDE.md operating rule #1, mockups go in `mockups/` first.
- **Player analytics + H2H** (V3.0:145–146) — first attempt rejected in S053 (mockups didn't land). Re-attempt with different style direction if user wants.
- **Dropped from backlog (S054 close):** ~~photo-OCR fallback~~ · ~~match highlights / video clips~~ · ~~win streaks / deep form guide~~ — out of scope.

## Completed in S056 (29/APR/2026, Home PC) — across 2 parallel agent streams

### Payment tracker end-to-end (spec → plan → migration → screens) + GitHub issue fix-pack

**7 commits across 2 streams, 1 migration applied + pushed. Live DB: 54 → 55. `main` pushed clean to `9b5fcbb`.**

- [x] **Payment tracker design spec** (`07c9dfe`) — V3.0:147 Phase 3 feature. Brainstorm in `.superpowers/brainstorm/624-1777475717/` locked: AED 60/match fixed (per-match override allowed), post-game collection (only players who actually played owe), bank transfer OR cash, every authenticated user sees season overview + own ledger (other-player detail admin-only), 3-screen flow (overview → admin drilldown → player ledger), Option B compact card + **Option C inline status icons** (✓ green / ⏳ amber / ✗ red — user rejected outline pills as "ugly + don't match rest of app"). Spec at `docs/superpowers/specs/2026-04-29-payment-tracker-design.md` (338 lines, 10 sections — DDL draft for `match_fees` + `match_payments` + `payment_ledger_view`, RPC list, RLS outline, screen UX, audit-log integration, edge cases). Mockup + implementation deferred to S057.
- [x] **Issue fix-pack #16/#17/#18-partial/#19** (`e2a8a33`):
  - **#16 (AdminPlayers active row edit hint)** — added faint `✏` pencil span (`.admin-edit-hint`, opacity 0.35, margin-left auto) inside the active-row button so the tap-to-edit affordance is visible alongside 🚫.
  - **#17 (Roster pool position pills colour-coded)** — added 4 new `.rs-chip-pos--{def,cdm,w,st}` variants with distinct light tints (periwinkle / teal / orange / rose) for readability on dark chip background. Pool + waitlist chips both use `\`rs-chip-pos--${pos.toLowerCase()}\``.
  - **#18 partial (3 of 7)** — × button moved INSIDE chip boundary (restructured to span > rs-chip-body button + rs-chip-remove button); `handleCancelPoolChip` no longer auto-promotes first waitlister (admin manually taps to promote); `handleAddPlayer` routes to waitlist when `total >= cap`.
  - **#19 (CreateMatchdaySheet)** — `useEffect([kickoff])` auto-derives poll opens (kickoff−3d 09:00 local) + poll closes (kickoff−1d 21:00 local); `isThursday` IIFE drives an amber `.admin-warn-banner` ("Not a Thursday — double-check the date.") when kickoff is not a Thursday.
- [x] **Verification** — `tsc -b` EXIT 0. No `vite build` (admin auth-gated routes unreachable from preview).
- [x] **Mockup-required deferred to S057:** issues #18 + #20 complex sub-asks — removed-players parking category, lock-before-team-select gate, player return-to-origin on slot remove, dirty-nav guard.

### S056 patterns / lessons (additive)

- **Whole-row-as-button needs an explicit affordance.** A `<button>` styled to look like a row hides its action — discoverability requires a small icon (✏ pencil) even when the entire surface is clickable. Affordance ≠ functionality.
- **Five colour-coded categories cannot share one accent.** When `--accent` was the colour for ALL non-GK position pills, the label text was the only differentiator. Use distinct colours scaled for the surface (light tints on dark chip ≠ saturated `--pos-*` solid fills used by leaderboard rank pills).
- **Chip-with-delete pattern: outer span = visual chip, two transparent buttons inside.** Nesting `<button>` inside `<button>` is invalid HTML. Canonical structure: `<span class="chip">{button.body action=A}{button.remove action=B}</span>` — span gets border/bg/radius, body is `padding:0;background:none;border:none`, remove sits inside chip's flex row at the right edge.
- **Auto-derive dependent inputs via `useEffect([primary])`.** Initial-mount-only derivation in `useState(() => ...)` silently breaks when the user changes the primary. If Y is a deterministic function of X, wire `useEffect([X], () => setY(f(X)))` and keep Y editable for override.
- **Local datetime-local parsing trick:** `new Date('YYYY-MM-DD')` parses as **UTC**; `new Date('YYYY-MM-DDTHH:MM')` parses as **local**. Append `T12:00` to a date-only string to get day-of-week in local TZ across DST and ±14h boundaries.
- **Local date arithmetic: `new Date(y, m-1, d-n)` directly yields a local-time anchor.** Round-trip through `.toISOString()` + `toLocalInput()` to feed back into a `datetime-local` input. Don't `setDate(d - n)` on a UTC-parsed Date — that's the tz-shift bug the codebase already has.
- **Auto-mode + explicit "stop delegate" mid-session** = drop subagent / advisor calls for the rest of the session and ship direct. The earlier triage decision still stands.
- **Issue triage: ship-now vs mockup-required.** A multi-item issue with 7 sub-asks is rarely all the same shape — separate trivial CSS/logic fixes (ship now) from UX redesigns (mockup first per CLAUDE.md rule #1) and atomic-fix-pack-commit them with all the issue numbers in the message.

---

## Completed in S055 (29/APR/2026, Work PC)

### Phase 3 backlog refresh + issue #15 roster setup refinements

**2 commits, 1 migration. Live DB: 53 → 54. Pushed clean fast-forward `049b225..ffbdc46`.**

- [x] **Cold-start audit caught payment tracker silent drop.** User asked "what's pending across the whole project?" — grepped V1.0 → V3.0 masterplans for `payment|fee|dues|treasury|venmo|...`. Last seen V1.0–V2.4 under "Phase 4 — Extras" alongside H2H, badges, injury. V2.5 consolidation dropped Phase 4 entirely; V3.0:139–146 backlog never restored payment (player analytics + H2H were restored S050; payment + badges + injury were not). Surfaced this as part of a complete pending-items audit before user could ship a pivot.
- [x] **Phase 3 backlog refresh** (`5a8e113`) — User-confirmed scope: drop photo-OCR fallback / match highlights / win-streak deep form (last-5 strip in Phase 1 covers the form question; OCR not needed once console proven reliable); add payment tracker / player badges / injury list (all originally Phase 4 — Extras). `planning/FFC-masterplan-V3.0.md` Phase 3 section: marked already-shipped items (awards S053, share PNG S054, signup email S051) with [SHIPPED S###] tags; added 3 restored items with provenance lines; new "Dropped from backlog (29/APR/2026, S054 close)" subsection with strikethrough. `tasks/todo.md` Backburner block matched. Doc-only.
- [x] **Issue #15 — Atomo's roster setup refinements** (`ffbdc46`). 3 asks resolved via single AskUserQuestion round-trip:
  - **Pool × button** = delete from unassigned pool (not from a slot — slot × already exists for that). Two new SECURITY DEFINER RPCs in mig 0054: `admin_cancel_commitment(p_matchday_id, p_profile_id)` soft-cancels active poll_votes row; `admin_cancel_guest(p_guest_id)` soft-cancels match_guests row. Both: idempotent, refuse if matchday match has recorded result, audit BEFORE destructive UPDATE, two-layer admin guard (S047). Auto-promotes first waitlister into freed pool slot (UI-only).
  - **Waitlist visible** — drop `.limit(cap)` on poll_votes loader; partition `allProfiles.slice(0, cap)` → pool-eligible / `.slice(cap)` → waitlist; render new `.rs-waitlist` section below pool when non-empty. Tap-to-promote = UI-only state move (player is already a yes-voter, just past the cap rank).
  - **Hybrid auto-fill** — `tapChip` rewritten as Path A (explicit target preserved = S054 behavior) / Path B (no target → `targetTeam = whiteCount <= blackCount ? 'white' : 'black'`, fall through to other team if first choice full, toast "Both teams full" if both full).
- [x] **Migration 0054 applied to live DB.** Both `pg_get_function_identity_arguments` signatures verified. Types regen 2283 → 2308 lines.
- [x] **Verification.** `tsc -b` EXIT 0; `vite build` clean (PWA precache 12 entries / 1661.62 KiB; +25 KiB from feature additions, count unchanged). Functional verification deferred to live admin session per S056 plan (auth-gated, unreachable from preview).
- [x] **GitHub** issue #15 auto-closed by `Closes #15` commit trailer; shipping note posted as comment.

### S055 patterns / lessons (additive)

- **Plan mode + AskUserQuestion BEFORE writing code on multi-ambiguity tasks.** Issue #15 had 3 distinct ambiguities; resolving them up-front via single round-trip meant plan was approved without revision and implementation hit on first pass. Don't write code before clarifying.
- **Mid-flight scope-shift sequencing.** When user dropped backlog updates while I was finalising the issue plan: finished the plan first → ExitPlanMode → did the smaller doc-only commit before the larger feature commit. Two clean commits, no entanglement, no half-finished state.
- **State updater functions must be pure.** First version of `handleCancelPoolChip` mutated a closure variable inside `setWaitlist(prev => ...)`. Caught self-review before commit; fix reads state directly at handler top, passes value into both updaters. Generalises: never use a `setX(prev => ...)` callback for side-effecting computation, even if it works in practice.
- **Edit `old_string` reproduces existing content verbatim — re-read surrounding lines IMMEDIATELY before composing the call.** Memory-reconstruction across more than 1 line is a coin flip. First V3.0 masterplan edit attempt failed because I retyped a multi-clause H2H bullet and introduced a duplicated phrase. Use Read on the target lines before every multi-line Edit.
- **Issue close via `Closes #N` commit trailer** auto-closes the issue on push. If you want a comment with implementation specifics, post it via `gh issue comment` after-the-fact (`gh issue close --comment` errors with "already closed").
- **Audit-before-destructive in admin RPCs is now reflexive** (S034 → S049 → S054 → S055 — 4 sessions in a row). Pattern is durable.

## Completed in S054 (29/APR/2026, Work PC)

### Phase 3 share PNG — V3.0:140 shipped end-to-end

**22 commits total this session. Live DB: 47 → 53. All pushed clean fast-forward to `main`. Final HEAD `d289aee`.**

- [x] **Atomo's PR #9 merged.** `unlock_roster` RPC (admin ability to re-open a locked formation). Migration renumbered 0047 → 0048 to avoid collision with S053's `0047_phase3_awards`. Types regenerated (Task 4 below).
- [x] **Migration 0049 `match_card_payload_rpc`** — `get_match_card_payload(uuid) returns jsonb` SECURITY DEFINER + is_admin guard. Returns season name, match_number/total_matches, kickoff label, scores, per-team scorer lists (own-goal scorer listed under THEIR OWN team with own_goals counter), MOTM. Plus private `match-cards` storage bucket (image/png, 512 KB, RLS service-role-write).
- [x] **Edge Function `render-match-card`** — Satori + Resvg WASM pipeline generating 1080×1080 PNG. Fonts (Inter 600 + Playfair Display 700) fetched from jsDelivr at module init in WOFF format (WOFF2 NOT supported by Satori v0.10 — proactive catch before manual test). FFC crest inlined as base64 SVG (Supabase EF CLI silently drops binary assets in subdirs — proactive catch via remote smoke test). Match-id-keyed cache in `match-cards` bucket. Admin-only auth via JWT verify + `is_admin()` RPC guard. Deployed at v5.
- [x] **Frontend `lib/shareMatchCard.ts`** — `navigator.share({ files })` with PNG download fallback, EF invoke wrapper. Discriminated `ShareResult` union (shared / cancelled / downloaded / error).
- [x] **Wired** into MatchEntryReview success state (primary share CTA replacing the pre-existing `navigate('/admin/matches')`) + MatchDetailSheet admin footer (re-share path; gated on `isAdmin && main.approved_at`).
- [x] **Mockup workflow:** A/B style-compare `3-25` → final mockup `3-26` (with element picks: A's centred crest + serif gold title, B's TEAM WHITE/BLACK split scoreboard with vertical gold-gradient divider, B's tight sans scorer grid, B's gold-pill MOTM, no footer). User added match-number prominence and dropped venue mid-review. OG attribution bug caught (own-goal scorer goes under THEIR OWN team, not the team that benefitted) — spec § 3 + plan Task 4 SQL corrected before implementation.

### Atomo PR #13 merged — Admin Roster Setup screen + 2 RPCs

- [x] **Renumbered 0049/0050 → 0051/0052** to avoid collision with the in-flight S054 share-PNG migration. Force-pushed after rebase, squash-merged at `cbdecac`.
- [x] **CSS conflict resolved** in `index.css` — both sides additive at end of file; kept both blocks.
- [x] **Applied 0051 + 0052 to live DB.** Verified `admin_add_guest` and `admin_update_match_draft` RPCs exist. Types regenerated at `98e54e8`.

### Atomo PR #14 merged — admin_add_commitment

- [x] **First clean PR of the day** — no conflicts, correctly numbered 0053. Squash-merged at `71d2a2c`.
- [x] **Applied 0053 to live DB.** `admin_add_commitment` RPC verified. Types regenerated at `d289aee`.

### Issue fixes

- [x] **#8 Leaderboard restructure** (`930cec7`) — Avatar disc removed from Player cell (component preserved for other surfaces); Pts moves to col 3 right after Player; Last 5 stays last; W/D/L cells coloured success-green / muted-cream / danger-red. Grid min-width unchanged at 604px.
- [x] **#12 Login + Poll flicker** (`1ba7e71`) — diagnosed as two independent races: AppContext multi-effect race (session resolved before profile, routing guards bounced to `/login` for one render) and React 18's non-batching of state updates inside Promise continuations (Poll's `loadAll` setX calls between awaits caused intermediate renders showing the vote prompt). Fixed by deferring `setLoading(false)` until profile is also settled (with branded splash render) and by wrapping Poll's `loadAll` in a single `dataLoading` flag. Audited Leaderboard / Matches / Profile / CaptainHelper — all clean.
- [x] **#10 Unlock Roster** + **#11 Admin Roster Setup UI** — closed as duplicates of PR #9 + PR #13.
- [x] **Two durable lessons captured**: Supabase EF CLI drops binary assets silently; Satori WOFF2 not supported.
- [x] **Build clean**: `tsc -b` EXIT 0 (zero errors, zero warnings after removing stale `@ts-expect-error`); `vite build` 12 precache entries / 1636 KiB.

## Completed in S053 (29/APR/2026, Work PC)

### Phase 3 awards page — first ship

**9 commits, 1 migration. Live DB: 46 → 47. Pushed clean fast-forward `d8c8938..27576f7`.**

- [x] **Pivot from analytics + H2H.** Original plan was V3.0:145–146 player analytics + H2H comparison; user approved scope, spec, and brainstorming flow but rejected both mockups (Profile single + compare; Leaderboard select-mode states). Reverted both commits via `git reset --hard HEAD~2` (local-only, not pushed). Pivoted to V3.0:139 awards page on user's pick.
- [x] **Awards-page brainstorming.** Style A/B preview file shipped first (`mockups/3-23-phase3-awards-style-compare.html`) — celebration vs stats. User picked "mix elements from both" with per-element specifics: A's serif gold "Season N Awards" header + A's big trophy + serif gold winner name + photo avatar hero cards + B's tabular Wall of Fame grid. Entry → trophy icon-btn on Leaderboard's controls row. Tie-break = leaderboard cascade. Hybrid data: live view for active, snapshot table for ended.
- [x] **Mockup approved.** `mockups/3-24-phase3-awards.html` — initial version had a styled-mockup Leaderboard frame; user asked the Leaderboard frame to match the LIVE format (`lb-head` sticky header, `lb-controls-row`, `lb-icon-btn` 38×38 SVG buttons, `lb-table-grid` columns, `lb-row--gold/silver/bronze` medal tints). Re-read live `Leaderboard.tsx` + CSS, replaced frame B accordingly. Approved.
- [x] **Spec.** `docs/superpowers/specs/2026-04-29-phase3-awards-design.md` — 10 sections, 400 lines. Awards points formula `wins*3 + draws` (NO late-cancel term) intentionally diverges from leaderboard `points`.
- [x] **Plan.** `docs/superpowers/plans/2026-04-29-phase3-awards.md` — 7 tasks, 1298 lines. Schema verified up-front against existing migrations.
- [x] **Task 1 (`9116216`)** — migration `0047_phase3_awards.sql`. New `season_awards` snapshot table + `v_season_award_winners_live` view (4 CTEs + 3-way UNION ALL with self-join for runner-up — cleaner than spec's correlated-subquery draft) + `snapshot_season_awards_trigger` function (SECURITY DEFINER + search_path=public + NULL→NOT NULL guard + ON CONFLICT DO NOTHING idempotency) + AFTER UPDATE OF ended_at trigger. Spot-checks: view returned 0 rows (live DB has 0 approved matches yet — vacuous); transactional rollback test confirmed trigger fires + idempotent. Spec ✅, code review ✅.
- [x] **Task 2 (`446aa40`)** — Supabase types regen, 2213 → 2283 lines.
- [x] **Task 3 (`f256f09`)** — Awards skeleton + route. Implementer found routes live in `ffc/src/router.tsx` (createBrowserRouter object literals), NOT App.tsx — adapted correctly. `noUnusedLocals: true` AND `noUnusedParameters: true` in tsconfig forced dropping many imports/types/setters in the skeleton; documented what Tasks 4/5 must re-add in a comment block.
- [x] **Task 4 (`bb687d2`)** — hero cards + season picker + CSS. Re-added `supabase` + `AwardKind` + `WinnerRow` + `ProfileLite` + state setters. Wrote data-fetch `useEffect` with cancellation pattern, `HERO_META` lookup table + `renderHero` helper. ~150 lines of CSS scoped to `.aw-screen`. Folded in all 3 Task 3 cleanup recs (drop the cast, drop the doc comment, gate badge behind `!loading`).
- [x] **Task 5 (`57d5395`)** — Wall of Fame. `WallOfFameRow` interface + `wallOfFame` state + single `season_awards` query joined to `profiles` via `profile:profiles!winner_profile_id(...)` syntax + client-side group-by-season + sort by `seasonsById.get(id)?.ended_at` desc (cleaner than plan's draft). Tabular grid renders ENDED seasons only.
- [x] **Task 6 (`27576f7`)** — Leaderboard trophy entry. `TrophyIcon` SVG mirrors `FilterIcon`/`SortIcon` pattern. New `.lb-icon-btn--awards` gold-tinted variant with subtle 12px glow box-shadow.
- [x] **Task 7** — final verify + push. `tsc -b` + `vite build` clean across all 6 implementation commits. PWA precache 12 entries / 1632.21 KiB final (+12 KiB for entire awards feature). Pushed clean fast-forward.
- [x] **Subagent rate-limit pivot.** Hit Anthropic 12pm Asia/Dubai reset midway through Task 4. Continued in-session — `tsc -b` + `vite build` were the actual quality gates.

### S053 patterns / lessons (additive)

- **Subagent rate-limit doesn't stop the session.** When dispatch caps trip mid-execution, `tsc -b` + `vite build` after every step replicate the subagent quality gate. Don't pause mid-flow waiting for limits to reset.
- **`router.tsx` ≠ `App.tsx`.** FFC routes are configured as `createBrowserRouter` object literals in `ffc/src/router.tsx`. Plans saying "modify App.tsx" should be auto-corrected when the implementer discovers the actual structure. Worth pinning.
- **`tsconfig.app.json` strictness in skeleton commits.** FFC has `noUnusedLocals: true` AND `noUnusedParameters: true`. Skeleton commits that "pre-declare state for future tasks" won't compile. Pattern: drop unused symbols + comment-block document what later tasks re-add + delete comment when symbols come back.
- **Discarded mockup without specifics.** Don't probe what failed; offer a clean pivot menu instead. The cost of a wrong second guess often exceeds the cost of switching tracks entirely.
- **A/B style preview as low-cost de-risk.** When style-feel matters and the spec is silent, ship A/B thumbnails first. User picks elements from each; the second mockup lands.
- **CTE-based view > correlated subqueries** for "rank-and-pick-N" patterns. Compute each rank table once, then `LEFT JOIN ranks ON rn = 2` for runner-up info. Cleaner AND faster than the spec's correlated-subselect draft.
- **Awards points ≠ Leaderboard points by design.** Awards use `wins*3 + draws`; leaderboard `points` includes `late_cancel_points`. Generalises: when a derived metric should diverge for product reasons, document the divergence inline at the view declaration AND in the spec's risk table.
- **Snapshot trigger on NULL → NOT NULL transition.** `IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL THEN RETURN NEW;` ensures it ONLY fires on the desired transition. ON CONFLICT DO NOTHING makes re-fire idempotent. Reusable for any "fire-once-on-state-change" workflow against a nullable timestamp.
- **Live view + snapshot table split for "frozen on close" features.** Active state queries the view (recomputes every load); ended state queries the table (immutable history). Frontend chooses based on `targetSeason.ended_at == null`. Clean read-write separation without an RPC.
- **Defensive `as` cast in skeletons is a code smell.** When you find yourself adding `(x as Type).field` to keep an unused interface "alive" against `noUnusedLocals`, you should either (a) drop the interface temporarily or (b) keep the symbol that genuinely needs it. Don't fight the linter with casts.
- **Clean revert via `git reset --hard HEAD~N`** when commits are local-only-and-not-pushed. Verify with `git status -sb` showing local-ahead-of-origin first. Recoverable through reflog if needed.

## Completed in S052 (28/APR/2026, Work PC)

### GitHub issue fix-pack — issues #2 / #3 / #4 / #5 / #6 / #7 closed (#1 deferred per user)

**1 migration (0046). Live DB: 45 → 46. 1 commit (hash filled on push).**

- [x] **Triage.** User pointed at 7 open GitHub issues on `mmuwahid/FFC`. After clarifying questions, user asked to keep position + MOTM pills (deferring issue #1) but still wanted issue #3's portrait re-fit done — implication being a column-width fix, not a pill-removal. Plus 2 unrelated polish items: rename leaderboard "P" → "MP", restore Last 5 W/L/D green/red/cream colours.
- [x] **Issue #3 — Leaderboard portrait fits.** `lb-table-grid` `grid-template-columns` rank `44px → 36px`, player `minmax(180px, 1.5fr) → 160px` fixed, MP `36px → 40px`. `min-width: 760px → 604px`. Sticky-2 `left: 44px → 36px` to match the new rank col. Pills + MOTM stays inside the 160px player cell (which is what the user explicitly wanted).
- [x] **Polish — Last 5 colours + MP rename.** Bumped specificity on `.lb-cell--last5 .lb-last5-pill--{W,L,D}` (was bare `.lb-last5-pill--X`) so the colours survive any later cell-level resets. Header text `P` → `MP`.
- [x] **Issue #2 — Poll No/Maybe visual feedback.** Status-card branch checked `myVote.choice === 'yes'` only; voting No or Maybe fell through to the "Will you play Thursday?" prompt → looked like the click did nothing. Added two new state cards: `.po-status--no` (red border-left) with "Change my mind" cancel button; `.po-status--maybe` (amber border-left) with "Confirm Yes" / "Switch to No" actions. Existing `cast_poll_vote` RPC already accepts `cancel`, no SQL change.
- [x] **Issue #5 — Matches stale-on-tab-return.** Existing single-fetch effect didn't refresh on revisit. Extracted the matches+matchday loader into a `useCallback`; added (a) realtime sub on `matches` + `match_players` mirroring Leaderboard's pattern, (b) `visibilitychange` + `focus` listeners that re-fetch on every tab return. Both effects guard on `activeSeasonId`.
- [x] **Issue #6 — Admin platform scroll-to-top.** `useEffect(() => { window.scrollTo(0,0); document.getElementById('root')?.scrollTo?.(0,0) }, [])` on `AdminHome` mount. Both window + #root because `#root` is the actual scroll container per the layout shell.
- [x] **Issue #4 — Settings restructure + drawer Install + Admin moved out.** Extended `IosInstallPrompt.tsx` into a tabbed iOS / Android `InstallPrompt` (auto-detects platform via UA, default `initialTab='auto'`); kept `IosInstallPrompt` named export as a back-compat alias for the existing Settings push-gate caller. `AppDrawer.tsx` got two new rows: 🛠 Admin platform (admin-only, navigates `/admin`) + 📲 Install app (everyone, opens the modal). RoleLayout passes `isAdmin` + `onInstallClick` + renders the `<InstallPrompt>` portal at layout level. Settings.tsx: new `‹ Back` chip at top, Account section moved to bottom (after League Rules) and merged email + Sign out + Delete account into one row (`.st-account-row`), removed the `🛠 Admin platform` row entirely (lives in drawer now). Removed unused `isAdmin` + `pendingEntriesCount` state in Settings.
- [x] **Issue #7 — admin_delete_player RPC + EditSheet delete button.** Migration `0046_admin_delete_player_rpc.sql`: `admin_delete_player(p_profile_id uuid)` SECURITY DEFINER + `is_admin()` body guard + REVOKE PUBLIC + GRANT EXECUTE TO authenticated. Refuses self-target (use `delete_my_account`), already-deleted targets, and `super_admin` targets. Audits BEFORE the destructive UPDATE (mirrors S034 / S049 pattern). Same anonymisation as `delete_my_account` (display_name → 'Deleted player', clears avatar/auth/email, soft-delete via `deleted_at`). `AdminPlayers.tsx` EditSheet now has a "Delete player" button under the Save row (super_admin profiles hidden). New `DeletePlayerSheet` mirrors the type-DELETE confirm pattern from Settings; on success closes sheet + reloads list.
- [x] **Verification.** `tsc -b` EXIT 0 after type regen (live DB types refreshed, 2189 → 2213 lines). `vite build` EXIT 0; PWA precache 12 entries / 1619.63 KiB; `dist/sw.mjs` 17.18 kB / 5.81 kB gzip. Migration applied via `npx supabase db push --linked`. Live screen verification deferred to S053 since auth-gated routes can't run in preview.
- [x] **Cross-PC sync caught at commit time.** Session-start system snapshot showed stale "M CLAUDE.md / sessions/INDEX.md / tasks/lessons.md / tasks/todo.md" entries from a prior S051 close on home PC; `git update-index --refresh` cleared the stale flags after the local HEAD already advanced to `608d1dc`. Important to internalise as the canonical "git status looks dirty but isn't" symptom — fix is `git update-index --refresh` not stash.

### S052 patterns / lessons (additive)

- **`git update-index --refresh` is the right move when stale-mtime files appear modified but `git diff` is empty.** Touching working-tree files via OneDrive sync (or any external tool) updates mtimes without changing content. Git's stat cache then reports them as "modified" until you refresh the index. Showed up at commit time today — saved a wrong "stash to fix cross-PC lag" diagnosis.
- **Bumped-specificity (`.parent .child--variant`) is a cheap "the colours just stopped showing up" fix.** Before reaching for `!important`, qualify the selector with one extra ancestor — buys a specificity tier without ownership churn. The Last 5 pills already had correct colour rules; bumping `.lb-cell--last5 .lb-last5-pill--W/L/D` makes them survive any future cell-level reset added in a different sub-section.
- **Width-based "fits on portrait" fix > pill-removal.** The natural fix to "player col eats all space" is to remove pills, but the user explicitly wants pills. Switching `minmax(180px, 1.5fr)` → fixed `160px` removes the elastic 1.5fr expansion that was consuming the available horizontal space — pills stay, numbers become visible. Generalises: when a flex/grid layout mis-allocates space, the cause is usually an unconstrained `fr` / `auto` / `1fr min-content` term, not the cells themselves.
- **Status-card "no visible change after click" bug pattern.** When a UI commits state that flips a discriminated-union back to a state visually identical to the pre-click state, users perceive the click as a no-op. The fix is to add explicit "you chose X" states for every legal choice, not to lean on the same prompt + side data. Reuse anywhere users can pick from a multi-option control: every legal choice deserves its own visual confirmation.
- **`visibilitychange + focus` is a 5-line stale-data antidote for SPA tabs.** When a tab's data dependency is implicit ("I'll see fresh data on next mount") but mount triggers don't fire on navigation between persistent route children, the cheap fix is to subscribe to `document.visibilitychange` + `window.focus` and re-trigger your loader. Combine with realtime subs to cover both scenarios (tab-return AND mid-screen mutation).
- **Back-compat alias for the IosInstallPrompt rename.** The component grew tabs → became a multi-platform InstallPrompt, but Settings.tsx still consumes `IosInstallPrompt` as the iOS-gate. Exporting `IosInstallPrompt = (p) => <InstallPrompt {...p} initialTab="ios" />` from the same file kept the existing call site untouched while giving the drawer a generic component to point at. Pattern: when refactoring a component into a more general shape, keep the original name as a thin wrapper.



1. **Phase 2 close: V3.0:122 8-box acceptance on a real Thursday matchday.**
   - [ ] No vote-chasing in WhatsApp — push reminders alone cover non-voters (vote-reminders cron firing at T-24h / T-3h / T-15m before `poll_closes_at`).
   - [ ] Roster locks itself at the deadline (`auto-lock-matchdays` cron); confirmed/waitlist players get `roster_locked` push.
   - [ ] Captain pair auto-set on lock (`auto_pick_captains_on_lock`); admin gets `captain_auto_picked` push with one-tap override deeplink → CaptainHelper shows gold "Auto-picked at lock" banner; manual override clears the pill.
   - [ ] Confirmed player drops post-lock → admins + captains see CaptainDropoutBanner appear realtime → "Promote from waitlist" or "Roll for new captain" button works.
   - [ ] Ref runs entire match on console (no paper).
   - [ ] Goals / cards / MOTM time-stamped at moment of capture.
   - [ ] After full-time, ref taps SUBMIT → admin gets push within 30 seconds.
   - [ ] Admin opens review screen, taps APPROVE → leaderboard updates without manual entry.

2. **Carry-over from S051 (everything built but not yet exercised on real production with auth-gated screens):**
   - Bell + notifications panel realtime (S049)
   - Top-bar avatar drawer (S049)
   - 3-tab bottom nav (S049)
   - Leaderboard expanded columns + landscape orientation (S049)
   - Delete-account flow end-to-end (S049 soft-delete + S051 mig 0041 hard-purge of auth.users + push_subscriptions cleanup)
   - Resend signup-outcome email (approve/reject any pending_signups → applicant receives branded email; pre-flight done — `RESEND_API_KEY` set)
   - iPhone Safari non-standalone iOS-gate → IosInstallPrompt opens, master stays OFF
   - iPhone PWA installed → push subscribe + delivery
   - Chrome desktop → push subscribe + INSERT notification → push within 2s
   - Captain reroll live test on a real matchday (accumulates from S037)

3. **Optional polish if Thursday hasn't landed:**
   - **Resend custom sender domain** — verify a domain in Resend, set `NOTIFY_FROM` env on `notify-signup-outcome` EF (default is `onboarding@resend.dev`).
   - **Phase 3 mockup-first work** — V3.0:139–148 backlog. Highest-impact items: player analytics page + H2H comparison (re-added by user this session). Per CLAUDE.md operating rule #1, build mockups in `mockups/` first before implementing.

**Carry-over backlog (still in flight):**
- **Live device acceptance for 2B-B/C/D/E/F chain** on a real Thursday matchday (accumulates from S041). End-to-end ref console → ref entry → admin review → approve flow. Now also exercises new top-bar / drawer / notifications panel + auto-pick + dropout banner.

**Backburner:** *(empty — everything from S050 backburner shipped this session)*

## Completed in S051 (28/APR/2026, Work PC)

### Phase 2A close — push client + auth purge + Resend + SVG + auto-lock + auto-pick + vote reminders

**3 commits, 5 migrations. Live DB: 40 → 45. `main` clean.**

- [x] **V3.0 backlog re-add.** Player analytics + H2H comparison restored to Phase 3 backlog (V3.0:139–148) after user flagged they'd dropped during V2.5 consolidation.
- [x] **Quick-win 1 — Phase 2A push client (Tasks 4 + 5)** in commit `7d82b6a`. New `lib/pushSubscribe.ts` (~165 LOC: `urlBase64ToUint8Array` allocates fresh `ArrayBuffer` to satisfy `Uint8Array<ArrayBuffer>` strict typing for PushManager.subscribe; `isIosNonStandalone` UA + display-mode + legacy navigator.standalone triple-check incl. iPad-MacIntel-with-touch; `subscribeAndPersist` idempotent upsert on `(profile_id, endpoint)`; `unsubscribeAndDelete` best-effort). New `components/IosInstallPrompt.tsx` (~50 LOC) 3-step modal portal + scoped CSS with `safe-area-inset-bottom` padding. `Settings.tsx` `handleMasterToggle`: iOS-gate → permission → subscribe/unsubscribe → patchProfile flow with `masterBusy`/`Error`/`iosInstallOpen` state. Existing prompt-tile button now routes through the same handler. Typed `VITE_VAPID_PUBLIC_KEY` in `env.d.ts`.
- [x] **Quick-win 2 — auth.users hard-purge** (mig 0041 + EF `purge-deleted-auth-user`). Migration patches `delete_my_account` to stash `auth_user_id` in audit payload BEFORE nulling. New `purge_auth_user_trigger()` AFTER UPDATE OF `deleted_at` ON `profiles` fires only on NULL → NOT NULL transition with non-null OLD.auth_user_id; calls EF via pg_net with two-bearer auth (Vault `service_role_key` + `dispatch_shared_secret`, mirroring S048 mig 0035). EF validates `X-Dispatch-Secret`, calls `auth.admin.deleteUser` (404 = idempotent success), best-effort prunes `push_subscriptions` for the deleted profile.
- [x] **Quick-win 3 — Resend signup-outcome scaffold** (mig 0042 + EF `notify-signup-outcome`). Trigger AFTER UPDATE OF `resolution` ON `pending_signups` on the `pending → approved/rejected` transition; same two-bearer auth. EF builds branded HTML for both outcomes (escaped `<>` in display_name + reason; approved → `https://ffc-gilt.vercel.app/login`; rejected → includes `rejection_reason`); POSTs to Resend HTTP API (`fetch`, no npm dep). `RESEND_API_KEY` set as Supabase project secret via `npx supabase secrets set` (verified via `supabase secrets list`).
- [x] **Quick-win 4 — Vector FFC crest SVG** in commit `227f0f7`. Probed environment: no `pdftocairo`/`pdf2svg`/`inkscape`/`potrace`/`gs`/ImageMagick installed. `pip install pymupdf`; `python -c "import fitz; doc=fitz.open(...); print(page.get_drawings())"` confirmed the PDF was pure vector (26 paths + 0 raster images). `page.get_svg_image(matrix=fitz.Identity)` extracted a faithful ~11.5 KB SVG (37 lines) preserving brand tokens `#ebe7e0` cream + `#b0a48a` gold. Copied to `ffc/public/`. Swapped 5 in-app `<img>` references PNG → SVG: Login + Signup + ResetPassword (×2) + Matches splitc-logo (×2). PWA manifest icons + sw.ts push notification icons stay PNG (browser/OS spec compliance).
- [x] **Phase 2A-D + 2A-E** (mig 0043 + 0044 fix). 3 enum values added (`captain_auto_picked` / `captain_assigned` / `you_are_in`); `is_captain_of(matchday)` STABLE SECURITY DEFINER helper; `promote_from_waitlist(uuid)` 1-arg overload alongside existing S012 `(uuid, uuid)` admin overload (different arity → no PG conflict; captain-or-admin gated; finds next waitlisted yes-voter at position `roster_cap + 1` by `committed_at`); `auto_lock_matchday(matchday)` (idempotent, partitioned `roster_locked` notifications via ROW_NUMBER, conditionally calls auto-pick); `auto_pick_captains_on_lock(matchday)` (top `suggest_captain_pairs` + INLINE `match_players` UPDATE, audit `payload.auto_picked = true` for UI detection, notifies both captains + admins). **Migration 0044 fix**: caught at design review that `set_matchday_captains` requires `is_admin()` which fails in cron context (`current_profile_id()` is NULL); inlined the captain UPDATE inside auto_pick to bypass the guard. `notify_dropout_after_lock_trigger()` AFTER UPDATE OF `cancelled_at` ON `poll_votes` — fires `dropout_after_lock` to admins + captains with `payload.was_captain` derivation. `app_settings.auto_pick_captains` default `{"enabled": true}`. pg_cron `auto-lock-matchdays` `* * * * *` against `poll_closes_at <= now() AND roster_locked_at IS NULL`. New `CaptainDropoutBanner.tsx` (~210 LOC realtime sub on `notifications` filtered to current user, client-filters to dropout_after_lock + matchday match, two flavours via `payload.was_captain`, marks notifications read on action). CaptainHelper integration: banner above mode toggle + `autoPickedAt` audit-log fetch (queries most recent `set_matchday_captains` audit on `match.id`; if `payload_jsonb->>'auto_picked' === true` → set state; re-runs on `match?.id` change OR `saving` toggle so manual override clears the gold pill) + announcer banner.
- [x] **Phase 2A-F vote reminders** in commit `7a47dfd` (mig 0045). `vote_reminder` enum value; unique partial index `vote_reminder_unique_idx` for cron-retry idempotency; 3 `app_settings` rows (each window flippable independently); `enqueue_vote_reminders()` SECURITY DEFINER returning insert count, with 3 CTEs (`windows` cross-joins matchdays with 3 trigger labels, `active_windows` filters by trigger_at within 10-min lookback + app_settings flag, `non_voters` joins active non-rejected non-soft-deleted profiles whose push_prefs.master + .vote_reminder both true via COALESCE default, LEFT JOIN poll_votes filtered to non-cancelled, picks pv.id IS NULL); pg_cron `vote-reminders` `*/5 * * * *`. Targeting interpretation: spec said "WHERE vote IS NULL" but `poll_votes.choice` is NOT NULL — chose non-yes-voters only (people who said no/maybe are engaged enough). Settings.tsx PushPrefs gains `vote_reminder` toggle.
- [x] **Verification.** `tsc -b` EXIT 0 + `vite build` EXIT 0 after each commit. PWA precache 11 → 12 entries (+SVG asset) → ~1612 KiB. Live DB push: 5 migrations applied successfully. Both pg_cron jobs verified live: `auto-lock-matchdays` (`* * * * *`) + `vote-reminders` (`*/5 * * * *`). Both EFs deployed: `purge-deleted-auth-user` + `notify-signup-outcome`.

### S051 patterns / lessons (additive)

- **Two-bearer pattern reused 3× this session** (mig 0041 + 0042 + 0043 cron infrastructure). S048's notify-dispatch design (Vault `service_role_key` + `dispatch_shared_secret` + matching env vars on the EF + `Authorization: Bearer <jwt>` for the gateway + `X-Dispatch-Secret` for caller-auth) is now a 30-line **template** for any trigger-driven Edge Function. Centralising the pattern in S048 paid off heavily.
- **PyMuPDF for PDF → SVG when source is genuine vector.** `page.get_drawings()` count + `page.get_images()` zero-count is the **probe**. When both indicators say "vector source", `page.get_svg_image()` is a faithful 1:1 conversion — no auto-tracer needed. Avoids the "complex laurel-wreath logo by hand" trap.
- **Idempotent unique partial index for cron retry idempotency.** `CREATE UNIQUE INDEX … (cols) WHERE kind = 'X'` + `INSERT … ON CONFLICT DO NOTHING` lets a 5-min cron with 10-min lookback overlap itself without inserting duplicates. The index encodes the dedupe rule alongside the data instead of in helper code.
- **`current_profile_id()` is NULL inside pg_cron.** Cron runs as the postgres superuser, no auth.uid context. Helpers that depend on `current_profile_id()` (`is_admin`, `is_captain_of`, etc.) all return null/false in cron context. RPCs called from cron should never go through admin-guarded functions; either inline the work or write service-role-callable variants.
- **Audit `payload.auto_picked` flag as UI detector.** Simpler than a dedicated column on matchdays/matches. Latest-entry-wins semantics + re-running the effect on `saving` toggle keeps the UI in sync — auto-pick pill auto-clears when admin overrides via the manual flow.
- **Probe-before-trace.** `which pdftocairo pdf2svg inkscape potrace gs magick` before assuming a tool exists. When all probes fail, a 30-second `pip install pymupdf` pivot beat hand-tracing. **Generalises:** when a "trivial-but-blocked" task arrives, the first step is environment probe, not writing code that assumes a tool exists.
- **Allocate `ArrayBuffer` explicitly when typing-strict TS demands `Uint8Array<ArrayBuffer>`.** Default `new Uint8Array(n)` returns the looser `ArrayBufferLike` (which can be `SharedArrayBuffer`); lib.dom strict typings on PushManager.subscribe.applicationServerKey reject it.
- **Spec-vs-schema drift caught 3× this session** — spec referenced `lock_at` (column doesn't exist; used `poll_closes_at`), `white_captain_id`/`black_captain_id` columns on matchdays (don't exist; derived via `match_players.is_captain`), `poll_votes.vote IS NULL` (column is `choice`, NOT NULL). Generalises CLAUDE.md operating rule #7: verify spec column/function/enum names against `database.types.ts` BEFORE writing the SQL.

## Completed in S050 (28/APR/2026, Work PC)

### Context-file trim — archive history + distill lessons

**Docs-only session. 1 commit `88f73f9`. No migration, no app code, no Vercel artifact change.**

- [x] **Audit + diagnosis.** Measured 4 context files at 498 KB total (CLAUDE.md 69 KB / todo.md 206 KB / lessons.md 69 KB / INDEX.md 154 KB). Worst offender: CLAUDE.md L3 = 58,114 chars on a single line, growing a narrative blob per session from S028 onward. Presented Option A (aggressive) / B (conservative) / C (diagnose-only); user picked A.
- [x] **Trim CLAUDE.md (69 KB → 12 KB, 83% reduction).** Replaced L3 mega-paragraph with fresh `## Current state (S049 close, 28/APR/2026)` block. Dropped outdated `## Current state (S020 close)` + `### Next session (S021)` sections. Re-wrote `## Live operational gotchas (durable)` section from scratch with 17 cross-session-applicable rules. Added `## Per-screen brand tokens` section listing the 12 in-app screens sharing the brand palette. Operating Rules grew 12 → 13 (added `tsc -b` strict-build before push, generalised Rule 7 to cover function signatures + enum values + view projection too).
- [x] **Archive todo.md history (206 KB → 15 KB, 93% reduction).** `tail -n +88` extracted S001–S048 "Completed in" history blocks to `tasks/_archive/todo-history-pre-s049.md`. `head -n 87` kept NEXT SESSION + S049 close-out. Appended footer pointing to archive + per-session logs.
- [x] **Strip INDEX.md archaeology (154 KB → 125 KB, 19% reduction).** Extracted all `^| S0` rows via awk, sorted by session number, reconstructed file = header + 49 sorted rows + live S050 pointer. Dropped all 22 `### Prior next-session pointer (kept for archaeology)` stubs. Smallest reduction by % because the bulk is in the row prose itself (which is the canonical session-by-session record we want to keep).
- [x] **Distill lessons.md (69 KB → 17 KB, 76% reduction).** Copied original to `tasks/_archive/lessons-pre-distill.md` (151 lines preserved verbatim). Wrote new file from scratch: 23 inherited PadelHub Critical Rules at top, then 60-odd FFC-specific lessons grouped into 9 domain sections (mockup safe-area / Windows+OneDrive / schema verification / TS+RPC typing / auth+signup / Vercel deploy / React+UI / realtime+Edge / process). Each rule a one-liner tagged with originating session(s).
- [x] **Verification + commit.** Final byte counts: 167,818 total (down from 498,362). 66% reduction. History fully preserved in `tasks/_archive/`. Git: 4 modified files + 1 new dir staged → committed `88f73f9` with detailed body breakdown → pushed clean fast-forward `05b9b4d..88f73f9`.

### S050 patterns / lessons (additive)

- **Aggressive history archiving + concise rule-distillation > slow accumulation.** Each session naturally appends "Completed in" blocks + paragraph-blob lessons; left alone, this grew context size 5× over ~30 sessions. The fix is structural — archive the historical blocks, distill rules to one-liners — not editorial. Triggering condition for re-running this audit: any context file crossing 30 KB or 1,000 lines.
- **Profile context-file bloat by file size FIRST, then by load frequency.** CLAUDE.md is sent every prompt; INDEX.md is read once on session-start. Same byte saving in CLAUDE.md is worth ~5× the same saving in a per-session-load file. Audit highest-ROI first.
- **Three-option (A/B/C) cleanup proposal before touching anything.** Mass-edit operations on durable files (lessons, planning docs, indexes) deserve a "what gets dropped" preview — same shape as a destructive-action confirm sheet in the app. User picked in one message.
- **Archive-don't-delete preserves prose for future grep without bloating live context.** `tasks/_archive/` keeps the originals accessible. Reusable any time durable docs grow past their useful-context size.
- **Per-domain grouping for lessons > chronological listing.** Future-me / fresh subagent wants "what's the rule for schema verification" — chronological listing forces a linear read; grouped sections are scan-friendly.
- **For files with row patterns, programmatic reconstruction beats Edit chains.** INDEX.md had 22 stubs interspersed with 49 rows. `awk + sort + Bash heredoc` rewrite was cleaner than sequential Edit calls.

## Completed in S049 (28/APR/2026, Work PC)

### Bottom-nav restructure + top-bar/drawer + leaderboard expansion + delete account live

**3 migrations this slice (0038 + 0039 + 0040). Live DB now at 40 migrations. 1 consolidated commit `b711fbf` on `main`.**

- [x] **User pivoted off the S048 plan** at session open. Original S049 was Phase 2A Tasks 4–6 (push client wiring); user asked instead for a 5-task UI restructure spanning bottom nav + top-bar + drawer + notifications panel + leaderboard expansion + delete-account activation. Plan written inline (no plan file), then user said "execute, don't ask permissions".
- [x] **Task 3 — Profile avatar overflow fix** (`ffc/src/index.css:1712`). Added `overflow: hidden` to `.pf-avatar` so the initials letter is clipped to the 22px border-radius. Camera badge stays unclipped because it's positioned on `.pf-avatar-wrap` (parent), not on the avatar itself. Also wired `window.dispatchEvent(new Event('ffc:profile-changed'))` after avatar upload + removal in `Profile.tsx` and after display-name save in `Settings.tsx`. RoleLayout listens and refetches the top-bar avatar.
- [x] **Task 1 — Shell primitives** (top-bar + drawer + 3-tab bottom nav). Bottom nav reduced 5 → 3 tabs: 🗳️ Poll · 🏆 Leaderboard · 📅 Matches (Home label dropped, 📊 swapped to 🏆). Profile + Settings tabs removed; both now reachable via the new avatar drawer. New `ffc/src/components/AppTopBar.tsx` (~75 LOC, crest left + bell + 32×32 avatar pill right). New `ffc/src/components/AppDrawer.tsx` (~120 LOC, right slide-in portal with ESC + backdrop close + body scroll-lock). Top-bar suppressed via `useLocation` pathname check on `/profile`, `/profile/:id`, `/settings`, `/settings/*`. `RoleLayout.tsx` rewritten end-to-end: fetches profile data once, refetches on `ffc:profile-changed` event, fetches initial unread count, subscribes to realtime INSERT on `notifications` filtered by `recipient_id`. AppContext untouched (Rule #8 plain-object Context preserved).
- [x] **Task 2 — Notifications panel + migration 0038**. Migration `0038_notifications_realtime.sql` idempotent ALTER PUBLICATION add (S048 pattern). New `ffc/src/components/NotificationsPanel.tsx` (~180 LOC) — top slide-down portal listing 50 most recent rows, optimistic `read_at = now()` UPDATE on tap + deeplink, "Mark all read" header link. New `ffc/src/lib/notificationDeeplinks.ts` (~55 LOC) — typed mirror of sw.ts deeplink map covering all 19 `notification_kind` enum values + payload-key overrides for `dropout_after_lock` (matchday_id), `match_entry_approved` (match_id), `formation_shared` (match_id). Bell badge red pill `#e63349` with 99+ overflow cap and pluralised aria-label.
- [x] **Task 5 — Leaderboard expansion + landscape orientation**. Replaced flex-row layout with CSS-grid table inside `.lb-table-wrap` (overflow-x: auto). Columns now Rank · Player (avatar + name + position pills + motms) · P · W · D · L · GF · Win% · Last 5 · Pts. Win % computed client-side: `mp > 0 ? Math.round((wins / mp) * 100) : 0` where `mp = wins + draws + losses` (denominator includes draws). Last 5 promoted from inline `.lb-last5` overlay strip to a proper column with W/L/D pills (green/red/grey). Sticky rank + player columns via `position: sticky; left: 0|44px` with opaque `var(--bg)`. Landscape orientation override scoped via a `body.is-leaderboard-landscape` class toggled by a `matchMedia('(orientation: landscape)')` listener that mounts/unmounts with the screen. CSS overrides `#root max-width: none` only while that class is present. No migration needed — `v_season_standings` + `v_player_last5` already exposed everything required.
- [x] **Task 4 — Delete account live (migrations 0039 + 0040)**. Migration `0039_profiles_soft_delete.sql` adds `profiles.deleted_at timestamptz` + partial active index `profiles_active_idx (id) WHERE deleted_at IS NULL`. Refreshes `v_season_standings` via `CREATE OR REPLACE` with identical column signature plus an added `AND pr.deleted_at IS NULL` predicate on the JOIN to profiles. `v_captain_eligibility` (the dependent view) stays compatible. Migration `0040_delete_my_account_rpc.sql` ships `delete_my_account()` SECURITY DEFINER + search_path locked + REVOKE EXECUTE FROM PUBLIC + GRANT EXECUTE TO authenticated. Audits BEFORE the destructive update (mirrors S034 `delete_season` pattern). Sets `display_name = 'Deleted player'`, `avatar_url = NULL`, `auth_user_id = NULL`, `email = NULL`, `is_active = false`, `deleted_at = now()`. `Settings.tsx` — pill renamed (no more "coming soon"); now solid red border + red text via new `.st-btn-delete--active` class. Tap opens a portal confirm sheet with consequence copy + type-DELETE input + Cancel/Delete actions; on success → sign out → `navigate('/login', { replace: true })`. `auth.users` row stays in place — re-signup works because `auth_user_id` is cleared (OAuth flow lands user in ghost-claim picker on next login).
- [x] **Verification.** Live DB push: 3 migrations applied successfully (one expected NOTICE on `IF NOT EXISTS` index). Types regenerated 2185 → 2189 lines. `tsc -b` EXIT 0 (one fix iteration: `iconForKind` referenced `match_result_posted` which doesn't exist in `notification_kind` enum — corrected to actual enum values). `vite build` EXIT 0; PWA precache 11 entries / ~1590 KiB; `dist/sw.mjs` 17.04 kB / 5.77 kB gzip. Dev server boot clean; index.css fully parsed; all 5 new CSS sections present in `document.styleSheets`; no console errors at /login. Live verification (auth-gated screens) deferred to S050 since preview sandbox can't run real auth.
- [x] **Single consolidated commit.** Initially staged for `fix(s049): avatar` solo commit but `git add` captured the full file state of index.css (which had all subsequent CSS additions). Reset --soft and committed as one feat(s049) slice with task-by-task breakdown in the commit body.

### S049 patterns / lessons (additive)

- **Custom DOM events for cross-screen state refresh** — `window.dispatchEvent(new Event('ffc:profile-changed'))` from Profile + Settings, RoleLayout listens + refetches. Avoids touching AppContext (load-bearing for routing logic + Rule #8 plain-object Context, no useMemo cascade). Lightweight pattern when one screen needs to nudge another.
- **Sticky-cols + grid + min-width + overflow-x: auto** for tables that exceed mobile viewport without being a real `<table>`. Sticky offsets must equal cumulative widths of preceding sticky cells (rank 44px → player `left: 44px`). CSS grid per-row preserves the existing button-per-row click structure. `position: sticky; left: 0` with opaque `var(--bg)` background is the durable pattern.
- **`body.is-X` orientation class scoped to a single screen** — `useEffect` with `matchMedia` listener, sets/clears the class on mount/unmount/orientation-change, cleanup removes it on unmount. Avoids `:has()` complexity, has broad browser support, lets one screen break out of global `#root max-width` without affecting others.
- **`CREATE OR REPLACE VIEW` with identical column signature when dependents exist** — adding a `WHERE pr.deleted_at IS NULL` predicate to `v_season_standings` while keeping the column list/order/types unchanged means `v_captain_eligibility` (the dependent view) doesn't need rebuilding. REPLACE only requires column-signature compatibility, not body equivalence — the body can change freely as long as the SELECT shape matches.
- **Audit BEFORE destructive update for self-delete RPCs** — same as S034's `delete_season`. The audit log entry needs to survive even if the soft-delete partially fails or rolls back. Postmortem trail matters more than transactional purity for an irreversible-feeling user action.
- **Single consolidated commit for entangled multi-task slice** — when 3+ tasks edit overlapping files (here `index.css` + `Settings.tsx` are touched by 3 tasks each), one feat(s049) commit with task-by-task breakdown in the body reads better than artificially split commits. `git add` captures full file state, not the slice of edits; trying to split via `git add -p` adds friction without benefit when the tasks all ship together.
- **`iconForKind` mapping must use the actual `notification_kind` enum, not the `push_prefs` keys from Settings.tsx** — caught by `tsc -b` at end-of-task. The `push_prefs` object uses keys like `match_result_posted` which don't exist in the `notification_kind` enum (which has `match_entry_submitted` / `match_entry_approved` / `match_entry_rejected`). The two namespaces look similar but only partially overlap. **Lesson generalises**: when wiring two type-namespace surfaces (UI prefs vs DB enums), check the actual enum values via `database.types.ts` before hand-typing.

---

**Older session blocks (S001 → S048) archived to [`tasks/_archive/todo-history-pre-s049.md`](_archive/todo-history-pre-s049.md).** Per-session details also live in `sessions/S###/session-log.md`.
