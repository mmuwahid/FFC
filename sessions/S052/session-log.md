# Session Log — 2026-04-28 — Session052 — GitHub-issue fix-pack (issues #2 / #3 / #4 / #5 / #6 / #7 closed)

**Project:** FFC
**Type:** Build
**Phase:** Phase 2A + 2B already code-complete (S051). This session = fix-pack against the open GitHub issue list, no Phase progression.
**Duration:** Single working block, plan → execute → verify → close.
**Commits:** 1 commit (hash filled at push) = `feat(s052): close GitHub issues #2 / #3 / #4 / #5 / #6 / #7`

---

## What Was Done

### Triage
- User asked to check the open GitHub issues at `mmuwahid/FFC`, plan, execute, then close them.
- 7 open issues found: #1 Leaderboard pills · #2 Poll No/Maybe broken · #3 Leaderboard portrait col fit · #4 Settings restructure + drawer Install + Admin moved · #5 Matches stale on tab return · #6 Admin platform scrolled to bottom · #7 Player edit/delete from AdminPlayers.
- Three clarifying questions raised + answered before writing the plan:
  1. **Issue #1 abbreviation**: user picked "Leaderboard pills" then later said keep them — net: defer #1.
  2. **Issue #7 delete semantics**: soft-delete via new admin RPC.
  3. **Issue #4 install instructions**: tabbed iOS / Android modal reusing existing IosInstallPrompt.
- After plan presented, user added two follow-ups:
  - "Leave issue 1 for now and do all the rest. As issue one solution I do not want to remove the pills."
  - "Bring back W/D/L green/grey/red colours that were lost." + "rename P to MP."
  - Then: "No for issue 3 do it now. I want that feature." → fix #3 without removing pills.

### Issue #3 — Leaderboard portrait re-fit (without removing pills)
- Diagnosed `grid-template-columns: ... minmax(180px, 1.5fr) ...` for player col was the cause: the 1.5fr expansion ate all available horizontal space on a 360px viewport, leaving nothing visible after the sticky player cell.
- Switched player col to fixed `160px`. Rank col `44px → 36px` to gain a touch more visible width. MP col `36px → 40px` so the new "MP" label fits cleanly. `min-width: 760px → 604px`. Sticky-2 `left` updated `44px → 36px` to match the new rank col.
- Pills (position + MOTM star) stay inside the 160px player cell as the user wanted.

### Polish — Last 5 colour restoration + P → MP rename
- Bumped Last 5 pill specificity from bare `.lb-last5-pill--X` (0,1,0) → `.lb-cell--last5 .lb-last5-pill--{W,L,D}` (0,2,0) and re-asserted `color` on each variant. The CSS rules were already in place but the user reported the colours weren't showing — bumping specificity is the safest fix before reaching for `!important`.
- Header label `P` → `MP` to match the user's mental model ("matches played").

### Issue #2 — Poll No/Maybe visual feedback
- Root cause: `Poll.tsx` status card only had a "you're confirmed" branch when `myVote.choice === 'yes'`. Voting No or Maybe fell through to the same "Will you play Thursday?" prompt → click felt like a no-op.
- Added two new state cards:
  - `.po-status--no` red border-left with "Voted NO" header + "Change my mind" cancel button.
  - `.po-status--maybe` amber border-left with "Voted MAYBE" header + side-by-side "Confirm Yes" / "Switch to No" buttons.
- Used the existing `cast_poll_vote('cancel')` path for "Change my mind" — no SQL change.

### Issue #5 — Matches stale-on-tab-return
- Symptom: navigating to /matches showed "No matches yet" until a hard refresh, even on subsequent visits.
- Refactored `Matches.tsx` to extract the loader into a `useCallback`, then added:
  - Realtime sub on `matches` + `match_players` (mirrors Leaderboard's pattern).
  - `visibilitychange` + `focus` event listeners that re-fetch on tab return.
- Both effects guard on `activeSeasonId`. Cleanup on unmount.

### Issue #6 — Admin platform scroll-to-top
- `AdminHome.tsx` mount effect: `window.scrollTo(0, 0); document.getElementById('root')?.scrollTo?.(0, 0)`.
- Both window AND `#root` because `#root` is the actual scroll container per the layout shell.

### Issue #4 — Settings restructure + drawer Install + Admin moved out
- **InstallPrompt refactor**: extended `IosInstallPrompt.tsx` into a tabbed iOS / Android `InstallPrompt` component. UA-based platform auto-detect (`initialTab='auto'` is default; falls back to iOS for desktop UAs). Kept `IosInstallPrompt` as a back-compat alias `<InstallPrompt {...p} initialTab="ios"/>` so the existing Settings push-gate caller doesn't need touching.
- **AppDrawer**: two new rows
  - 🛠 Admin platform (admin-only, `isAdmin` prop; navigates `/admin`)
  - 📲 Install app (everyone, calls `onInstallClick`).
- **RoleLayout**: passes `isAdmin` + `onInstallClick` to AppDrawer + renders `<InstallPrompt>` portal at layout level (so the modal is owned by the layout, not the drawer).
- **Settings.tsx**:
  - New `‹ Back` chip at top using `navigate(-1)`.
  - Account section moved to the bottom (after League Rules).
  - Account row condensed: email · Sign out · Delete account on a single `.st-account-row` flex line.
  - Removed the `🛠 Admin platform` row entirely (lives in drawer now).
  - Cleaned up unused `isAdmin` + `pendingEntriesCount` state + the pending-count fetch effect.

### Issue #7 — admin_delete_player RPC + EditSheet delete button
- Migration `0046_admin_delete_player_rpc.sql`:
  - `admin_delete_player(p_profile_id uuid)` SECURITY DEFINER + `is_admin()` body guard + REVOKE PUBLIC + GRANT EXECUTE TO authenticated.
  - Refuses self-target (use `delete_my_account`), already-deleted targets, `super_admin` targets.
  - Audits BEFORE the destructive UPDATE (mirrors S034 / S049 pattern; payload includes `prior_role`).
  - Same anonymisation as `delete_my_account`: clears `display_name → 'Deleted player'`, `avatar_url`, `auth_user_id`, `email`; sets `is_active = false`, `deleted_at = now()`.
- `AdminPlayers.tsx`:
  - New `DeletePlayerSheet` component mirroring the Settings type-DELETE confirm pattern.
  - EditSheet footer adds a separated "Delete player" red-outline button (super_admin profiles hidden).
  - Sheet state + open helper plumbed through `Sheet` discriminated union.
- New `.admin-edit-delete-row` CSS rule for the hairline separator.

### Verification
- `tsc -b` EXIT 0 after type regen (live DB types: 2189 → 2213 lines).
- `vite build` EXIT 0; PWA precache 12 entries / 1619.63 KiB; `dist/sw.mjs` 17.18 kB / 5.81 kB gzip.
- Migration applied via `npx supabase db push --linked` (only 0046 was pending; 0041–0045 already on live DB from S051).
- Auth-gated route screen-tests deferred to S053 — preview can't run real auth.

### Cross-PC sync gotcha — caught at commit time
- Session-start system snapshot showed `M CLAUDE.md`, `M sessions/INDEX.md`, `M tasks/lessons.md`, `M tasks/todo.md`, and an `??` for `sessions/S051/`. Initial diagnosis was cross-PC OneDrive lag from a prior S051 close on home PC.
- Investigation: `git log` showed HEAD already at `608d1dc docs(s051): close-out`, and `git diff <file>` returned empty for all four — meaning working tree == index == HEAD. The "M" entries were stat-cache lag, not real modifications.
- Fix: `git update-index --refresh` cleared every stale flag. Status cleanly showed only my 11 modified files + 1 new migration.
- This is a NEW pattern worth internalising — symptom looks like cross-PC lag (which would call for `git stash + pull --ff-only`) but the right answer is a stat-cache refresh.

---

## What Changed in the Repo

```
ffc/src/components/AppDrawer.tsx         +21    new admin + install rows + props
ffc/src/components/IosInstallPrompt.tsx  full   refactored to tabbed multi-platform InstallPrompt + IosInstallPrompt alias
ffc/src/index.css                        +60    .st-back · .st-account-row · .iip-tabs · .admin-edit-delete-row · po-status--no/maybe · last5 specificity bump · grid template
ffc/src/layouts/RoleLayout.tsx           +6     wires isAdmin + onInstallClick + InstallPrompt portal
ffc/src/lib/database.types.ts            +24    regenerated for admin_delete_player
ffc/src/pages/Leaderboard.tsx            +1     P → MP header
ffc/src/pages/Matches.tsx                +50    useCallback loader + realtime sub + visibilitychange/focus listeners
ffc/src/pages/Poll.tsx                   +28    new No/Maybe state cards
ffc/src/pages/Settings.tsx               -45    drop admin row + pending-count fetch + back chip + account row merge
ffc/src/pages/admin/AdminHome.tsx        +9     scroll-to-top mount effect
ffc/src/pages/admin/AdminPlayers.tsx     +75    delete sheet + EditSheet delete button
supabase/migrations/0046_admin_delete_player_rpc.sql  new
```

---

## Patterns / lessons (additive)

- **`git update-index --refresh` is the right move when stale-mtime files appear modified but `git diff` is empty.** Touching working-tree files via OneDrive sync (or any external tool) updates mtimes without changing content. Git's stat cache then reports them as "modified" until you refresh the index. **Symptom**: `git status` shows files as M but `git diff <file>` is empty for all of them. Saved a wrong "stash to fix cross-PC lag" diagnosis today.
- **Bumped-specificity (`.parent .child--variant`) is a cheap "the colours just stopped showing up" fix.** Before reaching for `!important`, qualify the selector with one extra ancestor — buys a specificity tier without ownership churn.
- **Width-based "fits on portrait" fix > pill-removal.** When a flex/grid layout mis-allocates space, the cause is usually an unconstrained `fr` / `auto` / `1fr min-content` term, not the cells themselves. Switching `minmax(180px, 1.5fr)` → fixed `160px` removes the elastic expansion that was consuming available space.
- **Status-card "no visible change after click" bug pattern.** When a UI commits state that flips a discriminated-union back to a state visually identical to the pre-click state, users perceive the click as a no-op. The fix is to add explicit "you chose X" states for every legal choice.
- **`visibilitychange + focus` is a 5-line stale-data antidote for SPA tabs.** Combine with realtime subs to cover both tab-return AND mid-screen mutation.
- **Back-compat alias for the IosInstallPrompt rename.** The component grew tabs → became multi-platform InstallPrompt, but Settings still consumes `IosInstallPrompt`. Exporting the original name as a thin wrapper (`<InstallPrompt initialTab="ios"/>`) kept the existing call site untouched.

---

## Out of Scope (still deferred)
- Live device acceptance for the entire S049 + S051 + S052 stack. Needs a real Thursday matchday.
- Issue #1 — Leaderboard pill removal — explicitly deferred per user.
- Resend custom sender domain (S051 backburner).
- Phase 3 mockups (V3.0:139–148 backlog).
