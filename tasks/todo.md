# FFC Todo

## NEXT SESSION — S051

**Cold-start checklist:**
- **MANDATORY session-start sync** per CLAUDE.md Cross-PC protocol.
- Expected tip: `88f73f9` (S050 close) or later on `main`.
- Migrations on live DB: **40** (unchanged since S049).

**S051 agenda — live device acceptance for the S049 stack + carry-over Phase 2A Tasks 4–6 (deferred from S050 docs-only session):**

1. **Live verification of the S049 UI restructure on production.**
   - Tap bell with no notifications → empty-state copy ("No notifications yet.")
   - INSERT a test notification via SQL editor → bell badge increments live (realtime sub on `notifications`)
   - Tap notification row → marks read (gold dot disappears, weight reduces) + deeplinks per `notificationDeeplinks.ts` resolver
   - "Mark all read" header link clears every unread row at once
   - Tap top-bar avatar → drawer slides in from right with Profile / Settings / Sign out
   - Tap backdrop or ESC → drawer closes; route change closes drawer
   - Bottom nav has 3 tabs only (🗳 Poll · 🏆 Leaderboard · 📅 Matches); admins see no extra tab
   - /profile + /settings + /settings/rules render their own back-button header (no top-bar)
   - Other screens (Poll, Leaderboard, Matches, MatchDetail, FormationPlanner, CaptainHelper, all admin pages) get the top-bar
   - Profile avatar: initials no longer escape the rounded square; camera badge still visible bottom-right
   - Top-bar avatar refreshes immediately after upload + display-name save (custom event)

2. **Leaderboard column scroll + landscape acceptance.**
   - Portrait: table scrolls horizontally; rank + player columns stay sticky on left
   - All new columns visible: P · W · D · L · GF · Win% · Last 5 (W/L/D pills) · Pts
   - Win % matches `wins / (wins+draws+losses)` rounded to integer
   - Last 5 pills: green for W, red for L, grey for D — newest right or left? confirm matches expected ordering from existing `v_player_last5`
   - Rotate iPhone to landscape → leaderboard fills full screen width (max-width override)
   - Rotate back to portrait → screen returns to mobile-capped layout
   - Other screens unaffected by orientation change
   - Top-3 medal tinting still works (gold/silver/bronze)

3. **Delete-account flow end-to-end.**
   - Settings → Delete account pill (red border, no "coming soon" label) → tap
   - Confirm sheet shows consequence copy ("stats stay as Deleted player")
   - Type DELETE in capitals → Delete button activates
   - Tap Delete → RPC fires → success → automatically signs out → /login
   - Verify in DB: `SELECT deleted_at, display_name, avatar_url, auth_user_id, is_active FROM profiles WHERE id = ...`
   - Verify leaderboard: deleted profile no longer appears in /leaderboard rankings
   - Verify match history: matches the deleted player participated in still load with "Deleted player" name
   - Verify re-signup: same email/Google account can sign up again, lands on ghost-claim picker

4. **Phase 2A Tasks 4–6** (carry-over from the original S049 plan):
   - **Task 4 — `pushSubscribe.ts` lib + `IosInstallPrompt.tsx` component.** Create `ffc/src/lib/pushSubscribe.ts` with `urlBase64ToUint8Array(base64)` (W3C URL-safe base64 decoder), `isIosNonStandalone()` (UA + display-mode + legacy navigator.standalone check), `subscribeAndPersist(profileId)` (uses `swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, upserts `push_subscriptions` row), `unsubscribeAndDelete(profileId)`. Both return `{ ok: true } | { ok: false, reason: string }`. Plus `ffc/src/components/IosInstallPrompt.tsx` (3-step modal portal) + scoped CSS.
   - **Task 5 — wire master-toggle in `Settings.tsx`.** Extend existing master pill handler. On ON: iOS-gate → `Notification.requestPermission()` → `subscribeAndPersist(profile.id)` → `patchProfile({ push_prefs: { ...prefs, master: true } })`. On OFF: `unsubscribeAndDelete` → patchProfile master:false. Add `masterBusy`, `masterError`, `iosInstallOpen` state.
   - **Task 6 — multi-device E2E acceptance.** Chrome desktop subscribe → INSERT notification → push within 2s → tap deeplinks. iPhone Safari non-standalone: master ON → install prompt → master stays OFF. iPhone PWA installed: subscribe + push working. Master OFF: row deleted. 410 path best-effort.

**Pre-flight reminder:** all S048 pre-flight (Vault `service_role_key` + `dispatch_shared_secret`, Edge Function env VAPID + DISPATCH_SHARED_SECRET + LEGACY_SERVICE_ROLE_JWT, Vercel `VITE_VAPID_PUBLIC_KEY`) is complete. No additional manual setup needed.

**Carry-over backlog (still in flight):**

- **Live device acceptance for 2B-B/C/D/E/F chain** on a real Thursday matchday (accumulates from S041). End-to-end ref console → ref entry → admin review → approve flow. Now also exercises new top-bar / drawer / notifications panel.
- **Captain reroll live test** on MD31 (accumulates from S037, blocked on live conditions).

**Backburner:**

- **auth.users hard-purge Edge Function** for `delete_my_account` follow-up — current soft-delete leaves the auth row in place. Re-signup works because `auth_user_id` is cleared. Full purge requires `auth.admin.deleteUser()` from a service-role Edge Function (only admin client can call it). Probably name: `purge-deleted-auth-user`. Trigger on `profiles.deleted_at` transition NULL → NOT NULL.
- **Email notification on signup approve/reject** — Supabase Edge Function (`notify-signup-outcome`) triggered by a database webhook on `pending_signups.resolution` change. Email provider: [Resend](https://resend.com) free tier (100 emails/day, no card). Edge Function needs `RESEND_API_KEY` env var.
- **Vector FFC crest SVG** — current crest is PNG only. Low-priority polish.

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
