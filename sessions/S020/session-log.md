# Session Log — 2026-04-22 — Session020 — Step 3 Acceptance + D6 UX fix + SPA rewrite

**Project:** FFC
**Type:** Build/Fix
**Phase:** Phase 1 Step 3 of V2.8 — Auth flow acceptance (D1–D6)
**Duration:** Deep (~3 hours)
**Commits:** `8f8668e`, `dca48cf`, `0e62ffd` (all pushed to `main`)
**PC:** Home
**Live:** https://ffc-gilt.vercel.app

---

## What Was Done

### Phase 1 — Commit + push S019 work
- Staged 24 files from the S019 worktree (13 modified/deleted + 10 untracked + 1 migration). Pre-commit secret sweep: no tokens in diffs.
- Commit `8f8668e` — `feat(auth): Step 3 — auth flow + GRANT fix + bottom-nav icons + transparent logo` (+3,671 / −256).
- Push to `origin/main` → Vercel auto-deploy `dpl_4jfVSFMBKw7P7bKggqsACyyBcSzS` READY. Live smoke-test: `/` 200 (2,088 B), `/ffc-logo.png` 200 (1.44 MB), `/manifest.webmanifest` 200, `/sw.js` 200.

### D2 retry (email/password path)
- First attempt (with the confirm-email setting still ON) hit the stage-1 silent-stuck bug again — `supabase.auth.signUp()` returns `session: null` when confirmations are on, so `onAuthStateChange` never fires and `Signup.tsx` stays on stage 1. Supabase's 40-second same-email rate-limit fired on retry (red herring, not the actual bug).
- **User disabled "Confirm email"** in Supabase dashboard → Authentication → Sign In / Providers → User Signups.
- Server-side probe via REST `/auth/v1/signup` confirmed fix: probe user got `access_token` immediately + `email_confirmed_at` set at creation. Probe user deleted.
- Deleted the stuck `m.muwahid05@gmail.com` `auth.users` row (id `f560353e…`) so retry starts clean.
- **D2 retry PASSED end-to-end.** Stage 1 → Stage 2 "Who are you?" ("No unclaimed profiles" as expected — 0011 only seeded super_admin) → picked "I'm new to FFC" → display name "Test Player" + note "Claude Code Development Testing Team" → Stage 3 "Waiting for approval".

### Google OAuth end-to-end setup (so Continue with Google works, not just email)
- **Google Cloud Console project** "FFC App" created (ID `ffc-app-494112`, No organization).
- **OAuth consent screen** (branding): app name "FFC", user support email `m.muwahid@gmail.com`, External audience + Testing status, contact `m.muwahid@gmail.com`.
- **120×120 logo variant** generated from `shared/FFC Logo Transparent Background.png` (1,024×1,024, 1.4 MB) via one-shot Python Pillow script (`_wip/ffc-logo-google-120.png`, 16.7 KB). Uploaded to Branding page; transparent canvas padding preserves the crest's square aspect.
- **OAuth 2.0 Web Client** "FFC Web" created. Client ID: `991515683563-ncjuidcn08psinv7oq8jb9kevp4k6g32.apps.googleusercontent.com`. Authorised JavaScript origins: `https://ffc-gilt.vercel.app` + `http://localhost:5174`. Authorised redirect URIs: `https://hylarwwsedjxwavuwjrn.supabase.co/auth/v1/callback`.
- **Test users** allowlisted on Audience page: `m.muwahid@gmail.com` + `m.muwahid05@gmail.com`. Google's "Ineligible accounts not added" modal on duplicate-case adds is a red herring — both were successfully added.
- **Supabase Google provider** enabled with Client ID + Secret pasted. Google OAuth probe via `GET /auth/v1/authorize?provider=google` returned **302 → accounts.google.com/o/oauth2/v2/auth** with the Client ID correctly embedded in the redirect query.
- **Supabase URL Configuration** set: Site URL `https://ffc-gilt.vercel.app` + Redirect URLs allowlist `https://ffc-gilt.vercel.app/**` + `http://localhost:5174/**`.
- **Path B test attempt** — Google consent screen rendered correctly + account picker worked, but redirect back to app landed on "This site can't be reached" (likely pre-URL-Configuration timing). Deferred retest to S021.

### D3 approve + D4 player sign-in + D5 SQL verify
- Super-admin opened `/admin/players` Pending tab (badge showed 1), tapped Test Player row, tapped **Approve**, confirmed in bottom sheet.
- DB verify: `profiles` row `ca3181b2…` created with `role='player'` + `auth_user_id` bound. `pending_signups.resolution` flipped to `'approved'` in the same transaction (`approve_signup` RPC atomicity confirmed).
- D4 retest in fresh Incognito: signed in as `m.muwahid05@gmail.com` / `FFCtest!` → landed on `/poll` → bottom nav showed **4 tabs** (Home · Table · Profile · Settings, NO Admin). Role dispatch works as designed.

### D6 reject path — DB PASS, UX auto-kick was broken, fixed mid-session
- Created second throwaway signup via `m.muwahid+reject@gmail.com` in Incognito → Stage 3 waiting.
- Super-admin tapped **Reject** on `/admin/players`, supplied 10+ char reason "Testing reject path — not a real signup (fine)", confirmed.
- **DB side PASSED**: `profiles` row `7f8bb630…` created with `role='rejected'` + `reject_reason` logged + `auth_user_id` bound. `pending_signups.resolution` flipped to `'rejected'`.
- **UX side BROKEN**: rejected user's incognito window kept showing "Waiting for approval", then refresh bounced them back to signup Stage 1 instead of kicking them to `/login?err=rejected`.
- Diagnosis from `AppContext.tsx` + `router.tsx`: `AppContext`'s profile-lookup effect SET `role='rejected'` on state but had no side-effect to sign them out. HomeRoute's `if (!role) return <PendingApproval />` is falsey for `'rejected'` (truthy string), and `Signup.tsx`'s stage resolver had the same blind spot.
- **Fix shipped as commit `dca48cf`** (2 files, +28/−2):
  - `AppContext.tsx` — added `reject_reason` to the profile select. When `role === 'rejected'`, stash reason in `sessionStorage.ffc_reject_reason`, call `supabase.auth.signOut()`, then `window.location.replace('/login?err=rejected')`. Hard redirect bypasses the `onAuthStateChange` race against `Signup.tsx`'s stage re-evaluation.
  - `Login.tsx` — `?err=rejected` banner useEffect now reads `sessionStorage.ffc_reject_reason` and includes it in the body copy. Clears the key after consumption so a refresh doesn't re-show. Falls back to generic copy if storage blocked (private mode).
- TypeScript compile clean (`node ./node_modules/typescript/bin/tsc -b --noEmit` exit 0). Vercel deploy `dpl_AduHCNq7xAxVJqx9qdTGsatQSitG` READY in ~30s.
- **Local verification via preview_eval on port 5174**: simulated the AppContext kick by setting `sessionStorage.ffc_reject_reason` + `window.location.replace('/login?err=rejected')`. `preview_inspect(.auth-banner)` returned `"!Your signup was not approved. Reason: \"Testing reject path — not a real signup (fine)\". Reach out to an admin if you think this is a mistake."` with class `auth-banner auth-banner--danger`. sessionStorage key consumed (null after banner renders). Query string cleared.
- **Production retest by user PASSED**: signed in as `m.muwahid+reject@gmail.com` → auto-kicked to `/login?err=rejected` → red banner showed the exact reject reason. D6 fully GREEN.

### SPA catch-all rewrite fix (second bug surfaced during D6)
- While troubleshooting the rejected-login screenshot, user pasted a 404 page with ID `bom1::rsw5s-…` (Vercel-edge 404, not the React `NotFound` page).
- Probed all routes: `/login`, `/signup`, `/poll`, `/admin/players`, `/does-not-exist`, `/match/abc` all returned **HTTP 404**. Only `/` worked. The app only "functioned" because navigation started at `/` and React Router handled the rest client-side — any **hard refresh** or **direct-paste URL** 404'd.
- Root cause: Vite scaffold doesn't auto-generate `vercel.json`; Vercel's edge defaults to static-file lookup only. No rewrite rule = no SPA support.
- **Fix shipped as commit `0e62ffd`** (1 file, +6): `ffc/vercel.json` with `{"rewrites":[{"source":"/(.*)","destination":"/"}]}`. Vercel's static-file handling takes precedence over rewrites automatically, so assets still resolve to real files.
- **Smoke-test all paths post-deploy**:
  - `/login` · `/signup` · `/poll` · `/admin/players` · `/xyz-nonexistent` · `/match/abc` → all **HTTP 200** ✅
  - `/sw.js` → 200 (size 1,235 B — real file) ✅
  - `/manifest.webmanifest` → 200 (size 442 B — real file) ✅
  - `/ffc-logo.png` → 200 (size 1,441,023 B — real file) ✅
  - `/login` HTML contains `<title>FFC</title>` + inline splash + manifest link (confirms real index.html served)

---

## Files Created or Modified

### Commit `8f8668e` — 24 files (S019 bundle)
- `CLAUDE.md`, `ffc/src/index.css`, `ffc/src/layouts/RoleLayout.tsx`, `ffc/src/lib/AppContext.tsx`, `ffc/src/pages/Login.tsx`, `ffc/src/pages/Signup.tsx`, `ffc/src/pages/admin/AdminPlayers.tsx`, `ffc/src/router.tsx` — modified
- `ffc/public/ffc-logo.png`, `ffc/src/components/PasswordInput.tsx`, `ffc/src/pages/PendingApproval.tsx`, `mockups/admin-players-pending.html`, `mockups/ffc-logo.png`, `mockups/login.html`, `mockups/signup.html`, `sessions/S019/session-log.md`, `shared/FFC Logo Final.png`, `shared/FFC Logo Transparent Background.png`, `supabase/migrations/0012_grants.sql` — new
- `ffc/src/pages/Welcome.tsx`, `mockups/welcome.html` — deleted
- `sessions/INDEX.md`, `tasks/lessons.md`, `tasks/todo.md` — modified

### Commit `dca48cf` — 2 files
- `ffc/src/lib/AppContext.tsx` — profile select now pulls `reject_reason`. `role === 'rejected'` branch: stash reason in sessionStorage → signOut → hard redirect to `/login?err=rejected`.
- `ffc/src/pages/Login.tsx` — `?err=rejected` useEffect reads sessionStorage key, includes reason in banner body, clears key after consumption, falls back gracefully if storage blocked.

### Commit `0e62ffd` — 1 file
- `ffc/vercel.json` — SPA catch-all rewrite `/(.*) → /`. Assets still served directly via Vercel's static precedence.

### Not in git (configuration on external platforms)
- **Supabase dashboard:** Confirm email OFF. Google OAuth provider enabled with Client ID + Secret. Site URL + Redirect URLs allowlist set.
- **Google Cloud Console:** Project "FFC App" created. OAuth consent screen configured (External / Testing). OAuth 2.0 Web Client "FFC Web" created. Test users allowlisted. Logo uploaded.
- **DB SQL side-quests:** Deleted stuck `m.muwahid05@gmail.com` auth row pre-retry (UUID `f560353e…`). Deleted ephemeral `ffc-probe-delete-me@example.com` probe row post-verification (UUID `38e645e4…`).

### Scratch
- `_wip/ffc-logo-google-120.png` (16.7 KB, 120×120 transparent) — generated from `shared/FFC Logo Transparent Background.png` via Python Pillow one-shot. Uploaded to Google Branding page. Clean weekly.

---

## Key Decisions

- **Email confirmations OFF for Phase 1.** Admin approval is the real gate. Email verification is duplicate work for a 14-player private league. Flip back ON if the league ever opens to strangers.
- **Stay in Google OAuth Testing mode (don't submit for verification).** Up to 100 test users, no re-verification cycle. For a private roster under the cap, Testing is the correct long-term state.
- **Keep `hylarwwsedjxwavuwjrn.supabase.co` on the Google consent screen (don't buy custom Supabase domain).** $25/mo Pro plan to brand the consent URL as `auth.friendsfc.com` is not worth it for a private league. Users see the FFC logo + "FFC" app name on the consent screen (once Google propagates branding) which is enough.
- **D6 fix scope: minimal + bounded.** Auto-signOut on `role='rejected'` + sessionStorage reason pass-through + Login banner enrichment. Did NOT refactor role enum semantics or router guards — single-responsibility patch.
- **SPA rewrite via `/(.*) → /`.** Simple catch-all; let Vercel's static-file precedence handle assets. Avoided the over-engineered regex that tried to enumerate static extensions.
- **Hard redirect (`window.location.replace`) in AppContext instead of React Router `navigate`.** Avoids `onAuthStateChange` race against router state updates when clearing auth. Full page navigation gives the reject flow a clean slate.

---

## Open Questions

- **Google OAuth Path B end-to-end retest on production** — deferred to S021. Config is in place, just not retested after Redirect URLs allowlist was saved. — Owner: Mohammed or Claude, S021
- **Publish Google OAuth app?** Not urgent — private league fits within Testing-mode's 100 user cap. Revisit only if we hit the cap or want to remove the "Google hasn't verified this app" warning. — When possible
- **Logo PWA variants** (32 / 180 / 192 / 512 + SVG master) for `manifest.webmanifest`. Currently the manifest references the 1.44 MB PNG which is fine for dev but heavy for PWA install. — S021 polish
- **Step 4 of V2.8** (next implementation milestone) — check masterplan + plan acceptance. — S021

---

## Lessons Learned

### Mistakes

| Date | Mistake | Root Cause | Prevention Rule |
|------|---------|------------|-----------------|
| 22/APR/2026 (S020) | `Signup.tsx` silently stuck on stage 1 when email confirmations were ON. User clicked Continue → nothing happened. Supabase 40-second same-email rate-limit fired on retry which muddied the diagnosis. | `handleStage1` assumed `supabase.auth.signUp()` always returns a session, but with confirmations ON it returns `{ user, session: null, error: null }`. `onAuthStateChange` never fires → the stage-transition `useEffect` never runs. | **If email confirmations are ON, `signUp()` must handle the `session: null` branch: render an explicit "Check your inbox" state with a resend button. For this project we disabled confirmations instead (Phase 1 uses admin approval as the only gate) but the code path is still latent; add the handler before ever flipping confirmations back on. General rule: inspect the full shape of `auth.signUp` response before deciding the next UX step, don't rely on `onAuthStateChange` as the sole transition trigger.** |
| 22/APR/2026 (S020) | `AppContext.tsx` set `role='rejected'` on state but had no side-effect — rejected users stayed signed in, saw a shell with empty data (RLS blocked everything), and could bounce back into the Signup wizard on refresh. Router's `HomeRoute` was `if (!role) return <PendingApproval />` — `'rejected'` is a truthy string so it slipped past the check. | Treating `role` as purely a display value. No lifecycle trigger for terminal states. Three independent components (`AppContext`, `HomeRoute`, `Signup.tsx`) each had their own implicit "valid role" assumption that didn't agree on how to handle `'rejected'`. | **Terminal roles (`rejected`, future `banned`, `suspended`) must trigger an auto-signOut + hard redirect in the auth context — not just flow through as a display flag. Pattern: when the profile-fetch effect sees a terminal role, stash any user-facing message in sessionStorage, call signOut, then `window.location.replace('/login?err=<code>')`. Hard redirect beats `navigate()` because it bypasses onAuthStateChange races. Don't assume downstream routers/components all know about every role value — centralise the kick in one place.** |
| 22/APR/2026 (S020) | Every non-root URL returned **HTTP 404 from Vercel's edge** (`bom1::…` error ID, not the React `NotFound` page). `/login`, `/signup`, `/poll`, `/admin/players` all 404'd on hard-refresh or direct paste. The app appeared to work because every session started navigation from `/`. Latent since Step 1 deploy; only surfaced when a link was pasted cold during D6. | Vite scaffold doesn't auto-generate `vercel.json`. Vercel edge defaults to static-file lookup + no SPA rewrite. Step 1 acceptance only verified `/` + `/manifest.webmanifest` + `/sw.js`; deep-link paths were never tested post-deploy. | **Any Vite (or other SPA) deployment to Vercel MUST ship `vercel.json` with a catch-all rewrite from day one: `{"rewrites":[{"source":"/(.*)","destination":"/"}]}`. Assets still work because Vercel's static-file handling takes precedence over rewrites. Acceptance test for any SPA deploy MUST include a curl-based probe of at least 3 non-root paths (typically `/login`, `/poll`, `/does-not-exist`) — `/` alone proves nothing about routing.** |

### Validated Patterns

- **[22/APR/2026] (S020) Python Pillow one-shot image resize via `pip install --user Pillow`** — 30-second round trip from 1,024×1,024 PNG → 120×120 transparent square (with aspect-preserving canvas pad). Works on Windows without ImageMagick. Recipe carries forward for the PWA icon variants (32/180/192/512/SVG master) needed later. **Why worth remembering:** image tooling is surprisingly absent on fresh Windows setups (no PIL, no `magick`, no `sharp` by default). Python + Pillow user-install is the least-friction path; don't spend 5 minutes picking a tool.
- **[22/APR/2026] (S020) `preview_eval` + `preview_inspect` for testing redirect-based UX without a real user** — set `sessionStorage.ffc_reject_reason` + `window.location.replace('/login?err=rejected')` in the local dev server, then inspect the resulting `.auth-banner` DOM node for text + className + computed styles. Verified the D6 fix in ~15 seconds without needing to wait for a Vercel deploy or sign in as a rejected user. **Why worth remembering:** any `?err=xxx` query-param banner can be tested this way. Faster than staging a real rejected user, and deterministic (no race against AppContext's fetch).
- **[22/APR/2026] (S020) Hard redirect (`window.location.replace`) instead of React Router `navigate` when clearing auth state** — `navigate('/login?err=rejected')` would race against `onAuthStateChange`'s own re-renders and the Signup/HomeRoute stage-resolver useEffects. A full page reload gives the reject flow a clean slate: new JS bundle run, new AppProvider mount, session is gone, Login reads sessionStorage fresh. **Why worth remembering:** for ANY transition that clears auth state, prefer hard redirect over router navigation — the cost (one bundle reload) is tiny, the correctness win is large. Applies to future `banned`, `suspended`, `session_expired` handling.
- **[22/APR/2026] (S020) Gmail `+tag` alias for acceptance-test throwaway accounts** — `m.muwahid+s020reject@gmail.com` passes Supabase's email validator (unlike `test@example.com` which is rejected) and forwards to the main Gmail inbox. No second email account needed. Supabase + Google OAuth + Google Cloud Test Users all treat the tagged form as the canonical address. **Why worth remembering:** codify as the convention for every acceptance-test email going forward — `m.muwahid+s###<role>@gmail.com` (e.g. `+s020reject`, `+s021admin`). Also works for cleanup: delete these rows liberally, the main inbox keeps the audit trail if anything important lands.
- **[22/APR/2026] (S020) Vercel MCP `list_deployments` to verify deploy status + SHA match** — no `vercel cli` needed; the MCP returns commit SHA, state (READY/ERROR), creation timestamp, and commit message in one call. Confirmed every push → deploy lineage within seconds. **Why worth remembering:** reduces the "did my push trigger a deploy" guessing game. Faster than visiting `vercel.com/dashboard`. First-line diagnostic for any "my changes aren't live" confusion.
- **[22/APR/2026] (S020) Supabase Google OAuth consent screen shows backend domain, not app domain.** The `Sign in to hylarwwsedjxwavuwjrn.supabase.co` wording cannot be cleaned up in Testing mode without a paid custom domain ($25/mo Pro). Uploading a logo to the Google Branding page helps (shows FFC crest in the consent header) but the URL string stays Supabase's. **Why worth remembering:** manage user expectations — this is a platform constraint, not an app bug. Don't spend cycles trying to brand the URL string; the logo + app name is what users anchor on.

---

## Operational gotchas surfaced this session

- **Google Test Users duplicate-case error modal is a red herring.** Adding `m.muwahid@gmail.com` after `M.Muwahid@gmail.com` triggered "Ineligible accounts not added" — but the list under the modal showed both addresses correctly saved. Gmail addresses are case-insensitive at the SMTP level; Google's UI is confusing but the underlying state is right.
- **Supabase default email validator rejects non-Gmail throwaways.** `test@example.com`, `ffc-probe@example.com` all rejected with `email_address_invalid`. Use real Gmail or `+tag` aliases.
- **Vercel static-file precedence over rewrites is automatic** — `/(.*) → /` catch-all does NOT break `/sw.js` / `/manifest.webmanifest` / `/ffc-logo.png` / other files in `public/`. Over-engineered regex to exclude static extensions was unnecessary; simplified to one line.
- **OneDrive Files-On-Demand tip still valid** (from S019): if a local preview serves stale file contents despite edits, re-write the file to force materialisation.

---

## Next Actions (S021)

- [ ] **Retest Google OAuth Path B** end-to-end — Continue with Google → consent → redirect back to app → lands on Stage 2 or `/poll` depending on account state. Should work now that Redirect URLs allowlist is saved.
- [ ] **Logo PWA variants** (32 / 180 / 192 / 512 PNG + SVG master). Wire into `ffc/public/manifest.webmanifest` icons array. Replace the 1.44 MB PNG with sized variants.
- [ ] **Step 4 of V2.8** — check `planning/FFC-masterplan-V2.8.md` §17 sequencing. Likely first real UI slice (Poll screen? Leaderboard?).
- [ ] **Palette re-alignment** — still on backburner from S012. Current red+navy doesn't match brand khaki-gold + cream. Low priority; has user sign-off to keep.
- [ ] **Signup.tsx confirm-email handler** — add "Check your inbox" state for `session: null` branch. Pure latency fix; required before ever flipping confirmations back on.
- [ ] **Supabase `admin_audit_log` column audit** — the D3 verification query failed on `target_table` column name. Confirm actual column names (probably `entity_type` or `resource_type`) and document.

---

## Commits and Deploy

- **Commit `8f8668e`** — `feat(auth): Step 3 — auth flow + GRANT fix + bottom-nav icons + transparent logo` (24 files, +3,671/−256). S019's uncommitted work + mockups + logos + `0012_grants.sql`. Deploy `dpl_4jfVSFMBKw7P7bKggqsACyyBcSzS` READY.
- **Commit `dca48cf`** — `fix(auth): auto-signOut on role=rejected + pass reject_reason to /login banner` (2 files, +28/−2). D6 UX fix. Deploy `dpl_AduHCNq7xAxVJqx9qdTGsatQSitG` READY.
- **Commit `0e62ffd`** — `fix(vercel): SPA catch-all rewrite so deep links don't 404` (1 file, +6). Deploy triggered; all 6 probed paths returned 200 post-deploy.
- **Live:** https://ffc-gilt.vercel.app (auth flow functional end-to-end; deep-link URLs work).

---

## Acceptance summary — Phase 1 Step 3 of V2.8

| Criterion | Result | Notes |
|---|---|---|
| D1 — super_admin signs in → `/poll` with 5-tab admin nav | ✅ PASS | Carried over from S019 |
| D2 — self-signup 3-stage flow reaches Waiting | ✅ PASS | After email-confirm OFF |
| D3 — super_admin approves from `/admin/players` Pending tab | ✅ PASS | `approve_signup` RPC atomic |
| D4 — approved user signs in → `/poll` with 4-tab player nav | ✅ PASS | Admin tab correctly hidden |
| D5 — DB state end-to-end verified | ✅ PASS | `profiles` + `pending_signups` both resolved correctly |
| D6 — reject path: RPC correct + UX auto-kick + banner with reason | ✅ PASS | After `dca48cf` fix + user end-to-end retest |
| Bonus — deep-link URLs don't 404 | ✅ PASS | After `0e62ffd` vercel.json added |

**Phase 1 Step 3 of V2.8: COMPLETE.** Auth flow is production-ready for a private 14-player league. Google OAuth Path B needs one more retest in S021 but the backend config is in place.

---
_Session logged: 2026-04-22 | Logged by: Claude (session-log skill, adapted to FFC S### convention) | Session020_
