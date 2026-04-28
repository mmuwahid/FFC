# Session Log — 2026-04-28 — Session049 — Bottom-nav restructure + top-bar/drawer + leaderboard + delete account

**Project:** FFC
**Type:** Build/Fix
**Phase:** Phase 1 polish + Phase 2 setup (3 migrations on live, 1 commit)
**Duration:** ~Deep (single working block)
**Commits:** `b711fbf` (one consolidated S049 slice on `main`)

---

## What Was Done

### Pivot from S048 plan
- S048 close-out queued S049 to finish Phase 2 Slice 2A Tasks 4–6 (push client wiring + iOS install gate + multi-device E2E).
- User pivoted at session open: full UI restructure across bottom nav + top-bar + drawer + notifications panel + leaderboard expansion + delete-account activation. Five tasks bundled.
- Per-task answers locked via AskUserQuestion: drawer = Profile + Settings + Logout · delete = soft-delete · stats scope = current season + Win % = wins / matches_played · top-bar suppressed only on /profile + /settings/*.
- Plan written inline (no plan file) before any code, then user said "execute" + "don't ask permissions".

### Task 3 — Profile avatar overflow CSS fix (`ffc/src/index.css:1712`)
- Added `overflow: hidden` to `.pf-avatar` so initials letter is clipped to the 22px border-radius.
- Camera badge stays unclipped because it's positioned on `.pf-avatar-wrap` (parent), not on the avatar itself.
- Wired `window.dispatchEvent(new Event('ffc:profile-changed'))` after avatar upload + removal in `Profile.tsx` and after display-name save in `Settings.tsx`. RoleLayout listens and refetches the top-bar avatar.

### Task 1 — Shell primitives: top-bar + drawer + 3-tab bottom nav
- Bottom nav reduced 5 → 3 tabs: 🗳️ Poll · 🏆 Leaderboard · 📅 Matches. "Home" relabelled to "Poll" and 📊 swapped for 🏆 per ask.
- Profile + Settings tabs removed from bottom nav; reachable via the new avatar drawer.
- New `ffc/src/components/AppTopBar.tsx` (~75 LOC) — left = FFC crest + wordmark (existing markup); right = `<NotificationBell>` with unread badge (`99+` cap) + 32×32 avatar pill.
- New `ffc/src/components/AppDrawer.tsx` (~120 LOC) — right slide-in portal via `createPortal`. Three rows: Profile · Settings · Sign out. ESC + backdrop click + route change all close. Scroll-locks `<body>` while open.
- Top-bar suppressed via path check on `/profile`, `/profile/:id`, `/settings`, `/settings/*` — those screens keep their own back-button headers (`.pf-nav` / `.st-nav` / `.lr-nav`).
- `RoleLayout.tsx` rewritten end-to-end: fetches `display_name + avatar_url` from `profiles` once on mount; refetches on the new `ffc:profile-changed` event; fetches initial unread count with `count: 'exact', head: true`; subscribes to realtime `INSERT` on `notifications` filtered by `recipient_id` to bump count + tick the panel.

### Task 2 — Notifications panel + migration 0038
- Migration `0038_notifications_realtime.sql` — idempotent `ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications` guarded via `pg_publication_tables` lookup (S048 pattern).
- New `ffc/src/components/NotificationsPanel.tsx` (~180 LOC) — top slide-down portal listing 50 most recent rows for the signed-in player. Tap a row → optimistic `read_at = now()` UPDATE + deeplink via shared resolver. "Mark all read" header link.
- New `ffc/src/lib/notificationDeeplinks.ts` (~55 LOC) — typed mirror of the deeplink map in `src/sw.ts`. Covers all 19 `notification_kind` enum values + payload-key overrides for `dropout_after_lock` (matchday_id), `match_entry_approved` (match_id), `formation_shared` (match_id).
- Bell badge red pill (`#e63349`) with `99+` overflow cap, accessibility label pluralises "1 unread" vs "N unread".

### Task 5 — Leaderboard expansion + landscape orientation (`ffc/src/pages/Leaderboard.tsx`)
- Replaced flex-row layout with a CSS grid table inside `.lb-table-wrap` (overflow-x: auto).
- Columns now: Rank · Player (avatar + name + position pills) · P · W · D · L · GF · Win% · Last 5 · Pts.
- Win % computed client-side: `mp > 0 ? Math.round((wins / mp) * 100) : 0` where `mp = wins + draws + losses`. Per user: denominator includes draws.
- Last 5 promoted from inline `.lb-last5` overlay strip to a proper column with W/L/D pills (green / red / grey).
- Sticky rank + player columns use `position: sticky; left: 0|44px` and an opaque `var(--bg)` background so they stay anchored on horizontal scroll.
- Landscape orientation override scoped via a `body.is-leaderboard-landscape` class toggled by a `matchMedia('(orientation: landscape)')` listener that mounts/unmounts with the screen. CSS overrides `#root max-width: none` only while that class is present.
- No migration needed for this — `v_season_standings` + `v_player_last5` already exposed everything required.

### Task 4 — Delete account: live (migrations 0039 + 0040)
- Migration `0039_profiles_soft_delete.sql` — adds `profiles.deleted_at timestamptz` + partial active index `profiles_active_idx (id) WHERE deleted_at IS NULL`. Refreshes `v_season_standings` via `CREATE OR REPLACE` with identical column signature plus an added `AND pr.deleted_at IS NULL` predicate on the JOIN to profiles. `v_captain_eligibility` (which depends on the view) stays compatible.
- Migration `0040_delete_my_account_rpc.sql` — `delete_my_account()` SECURITY DEFINER + search_path locked + REVOKE EXECUTE FROM PUBLIC + GRANT EXECUTE TO authenticated. Audits BEFORE the destructive update (mirrors S034 `delete_season` pattern). Sets `display_name = 'Deleted player'`, `avatar_url = NULL`, `auth_user_id = NULL`, `email = NULL`, `is_active = false`, `deleted_at = now()`.
- `Settings.tsx` — pill renamed (no more "coming soon"); now solid red border + red text via new `.st-btn-delete--active` class. Tap opens a portal confirm sheet with consequence copy + type-DELETE input + Cancel/Delete actions; on success → sign out → `navigate('/login', { replace: true })`. `auth.users` row stays in place — re-signup works because `auth_user_id` is cleared (OAuth flow lands user in ghost-claim picker).

### Verification
- Live DB push: 3 migrations applied successfully (one expected NOTICE on `IF NOT EXISTS` index).
- Types regenerated: 2185 → 2189 lines.
- `tsc -b` EXIT 0 (one fix iteration: `iconForKind` referenced `match_result_posted` which doesn't exist in `notification_kind` enum — corrected to actual enum values).
- `vite build` EXIT 0; PWA precache 11 entries / ~1590 KiB; `dist/sw.mjs` 17.04 kB / 5.77 kB gzip (unchanged).
- Dev server boot clean; index.css fully parsed; all 5 new CSS sections present in `document.styleSheets`; no console errors at /login.

---

## Files Created or Modified

### Single commit — `b711fbf` — 13 files, +1552 / -130

**New components**
- `ffc/src/components/AppTopBar.tsx` — top-bar with crest left + bell + avatar pill right (~75 LOC)
- `ffc/src/components/AppDrawer.tsx` — right slide-in portal with Profile/Settings/Sign out (~120 LOC)
- `ffc/src/components/NotificationsPanel.tsx` — top slide-down portal listing 50 notifications (~180 LOC)
- `ffc/src/lib/notificationDeeplinks.ts` — typed deeplink resolver mirroring `src/sw.ts` map (~55 LOC)

**Modified**
- `ffc/src/layouts/RoleLayout.tsx` — full rewrite: profile fetch + unread count + realtime sub + drawer/panel state + 3-tab nav + topbar suppression
- `ffc/src/index.css` — appended ~700 LOC: `.app-topbar-actions/-bell/-avatar`, `.app-drawer-*`, `.app-notif-*`, `.lb-table-wrap/-grid/-cell`, `.lb-last5-pill--{W,L,D}`, `.st-delete-*`, `body.is-leaderboard-landscape #root` override, plus `overflow: hidden` on `.pf-avatar`
- `ffc/src/pages/Leaderboard.tsx` — table-grid render replacement (~90 LOC delta) + matchMedia orientation effect
- `ffc/src/pages/Profile.tsx` — `window.dispatchEvent('ffc:profile-changed')` on avatar upload + removal
- `ffc/src/pages/Settings.tsx` — delete-account state + `confirmDelete` handler + portal sheet JSX + `ffc:profile-changed` on display-name save
- `ffc/src/lib/database.types.ts` — regenerated, 2185 → 2189 lines

**Migrations (3)**
- `supabase/migrations/0038_notifications_realtime.sql` — publication add (idempotent)
- `supabase/migrations/0039_profiles_soft_delete.sql` — deleted_at column + index + view refresh
- `supabase/migrations/0040_delete_my_account_rpc.sql` — RPC with REVOKE PUBLIC + GRANT authenticated

---

## Key Decisions

- **Drawer contents = Profile + Settings + Sign out.** User picked the full menu over inline-Settings + Profile-link or minimal-Settings.
- **Soft-delete over hard-delete.** Mirrors ghost-profile pattern from S037: profile rows preserved as "Deleted player" so match_players / poll_votes / formations FKs remain intact and historical leaderboards stay accurate. `auth.users` row left in place — full purge requires an Edge Function (deferred).
- **Win % denominator includes draws.** Per user clarification: `wins / matches_played` where `matches_played = wins + draws + losses`. Simpler than W / (W+L) and visually consistent with the W/D/L pills column.
- **Top-bar suppressed only on Profile + Settings + Rules.** All other screens (Poll, Leaderboard, Matches, MatchDetail, FormationPlanner, CaptainHelper, all admin pages) get the top-bar. Simplest cut; avoids second-guessing per-screen.
- **No new view for leaderboard stats.** Originally planned migration 0041 for `v_season_standings_extended` adding matches_played + win_pct + last5 jsonb. Skipped — both fields are trivially computed client-side and `v_player_last5` already exposes outcomes. Saves a migration and avoids a third view that depends on `v_season_standings`.
- **Single consolidated commit instead of per-task split.** First attempt staged `index.css` + `Profile.tsx` for a single fix(s049) avatar commit, but `git add` captured all subsequent CSS additions (top-bar + drawer + notifs panel + leaderboard + delete sheet). Reset --soft and committed as one S049 slice with full task breakdown in the commit body.
- **Landscape break-out scoped via body class.** `body.is-leaderboard-landscape #root { max-width: none }` only fires while the leaderboard screen is mounted. matchMedia listener cleans up the class on unmount. Doesn't disturb other screens or auth flows.

---

## Open Questions

- **Live device acceptance for full S049 stack** — top-bar bell + drawer + notifications realtime + leaderboard table scroll + landscape break-out + delete-account flow on real iOS Safari + Chrome desktop. Carry-over to S050.
- **Phase 2 Slice 2A Tasks 4–6** still deferred (the S048 plan that S049 pivoted away from): pushSubscribe lib + IosInstallPrompt + Settings master-toggle wiring + multi-device E2E. Push backend is operational; only client-side subscription wiring is missing.

---

## Lessons Learned

### Validated Patterns
- **Custom DOM events for cross-screen state refresh** — `window.dispatchEvent(new Event('ffc:profile-changed'))` from Profile + Settings + RoleLayout listening + refetching is lightweight enough to skip a context-shape change to AppContext. Why: `AppContext` is load-bearing for routing logic + Rule #8 (plain-object Context, no useMemo cascade); a custom-event refresher avoids touching it for a single-screen-driven concern.
- **Sticky-cols + grid + min-width + overflow-x: auto** — for tables that exceed mobile viewport width without being a real `<table>`. Sticky offsets must equal cumulative widths of preceding sticky cells (rank 44px → player `left: 44px`). Why: a real `<table>` would need restructuring all the row click handlers; CSS grid with `display: grid; grid-template-columns: ...` per row gets the same layout while preserving the existing button-per-row structure.
- **`body.is-X` orientation class scoped to a single screen** — `useEffect` with `matchMedia` listener, sets/clears the class, cleanup removes it on unmount. Why: avoids the `:has()` complexity, has broad browser support, lets one screen break out of the global `#root` max-width without affecting others.
- **`CREATE OR REPLACE VIEW` with identical column signature when dependents exist** — adding a `WHERE pr.deleted_at IS NULL` predicate to `v_season_standings` while keeping the column list/order/types unchanged means `v_captain_eligibility` (the dependent view) doesn't need rebuilding. Why: REPLACE only requires column-signature compatibility, not body equivalence — the body can change freely as long as the SELECT shape matches.
- **Audit BEFORE destructive update for self-delete RPCs** — same as S034's `delete_season`. The audit log entry needs to survive even if the soft-delete partially fails or rolls back. Why: postmortem trail matters more than transactional purity for an irreversible-feeling user action.
- **Single consolidated commit for an entangled multi-task slice** — when multiple tasks edit overlapping files (here `index.css` + `Settings.tsx` are touched by 3 tasks each), a single feat(s049) commit with task breakdown in the body reads better than artificially split commits. Why: `git add` captures full file state, not the slice of edits; trying to split via `git add -p` adds friction without benefit when the tasks all ship together.

---

## Next Actions

- [ ] **S050** — live device acceptance for entire S049 stack (top-bar bell + drawer + notifications realtime + leaderboard horizontal scroll + landscape break-out on iPhone in landscape + delete-account end-to-end flow). User-driven, parallel to other work.
- [ ] **Phase 2 Slice 2A Tasks 4–6** (carry-over from the original S049 plan) — pushSubscribe.ts lib + IosInstallPrompt.tsx component + Settings master-toggle wiring + multi-device E2E.
- [ ] **Carry-over backlog** still in flight: live device acceptance for 2B-B/C/D/E/F chain (real Thursday) + captain reroll on MD31 (live conditions).
- [ ] **Backburner:** transactional email on signup approve/reject (Resend Edge Function `notify-signup-outcome`); auth.users hard-purge Edge Function for delete_my_account follow-up; vector FFC crest SVG.

---

## Commits and Deploy

- **Commit:** `b711fbf` — feat(s049): bottom-nav restructure + top-bar/drawer + leaderboard expansion + delete account
- **Live:** https://ffc-gilt.vercel.app
- **Migrations on live DB:** 40 (0001 → 0040)

---
_Session logged: 2026-04-28 | Logged by: Claude (session-log skill) | Session049_
