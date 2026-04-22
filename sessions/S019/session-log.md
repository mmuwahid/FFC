# Session Log — 2026-04-22 — Session019 — Step 3 of V2.8 — Auth Flow (mockups + code + partial acceptance)

**Project:** FFC
**Type:** Phase 1 implementation — Step 3 of V2.8 sequencing
**Phase:** Auth flow (Welcome dropped · Login · 3-stage Signup · AdminPlayers Pending tab · AppContext profile resolution)
**Duration:** Long (~3 hrs, forced pause at D2 per user availability)
**Commits:** None yet (user closing out before commit; end-of-log commit pending in S020 start)

---

## What Was Done

### Phase A — Mockups (all approved pending transparent PNG)

1. **Welcome mockup (A1) — DROPPED mid-session.** Built initially (160px crest, "Friends, football, Thursdays." headline, dual CTAs), then user consolidated scope: "welcome screen is no longer needed since the login page should be the main welcome screen once you open the app." `mockups/welcome.html` deleted.
2. **Login mockup (A2, `mockups/login.html`)** — approved. Final form: 160×160 centered crest (no title / subtitle per user amendment), email/password inputs, red "Sign in" primary, "Continue with Google" secondary with conic-gradient G glyph, "Forgot password?" link, 4 state tiles (wrong credentials · unconfirmed email · rejected account · loading spinner).
3. **Signup 3-stage mockup (A3, `mockups/signup.html`)** — approved. Stage 1 matches Login's big-crest-no-text treatment. Stage 2 "Who are you?" with scrollable ghost-profile list (avatar + name + position pill) + "I'm new to FFC" dashed-outline button. Stage 3 "Waiting for approval" with hourglass icon, timestamp, sign-out link. Progress dots across all three stages.
4. **AdminPlayers Pending-tab mockup (A4, `mockups/admin-players-pending.html` — NEW, not an edit of the approved 3-17 mockup)** — approved. Queue view with 3 mixed-state rows (new / claim × 2), Approve (green) + Reject (red-outline) inline buttons per row, approve-claim confirmation bottom sheet, + 3 state tiles (approve-new, reject-with-reason textarea ≥10 chars, empty queue).

### Logo rollout (unlocked mid-session)
- User dropped `shared/FFC Logo Final.png` at 09:04 (white background) → copied to `mockups/ffc-logo.png` + `ffc/public/ffc-logo.png`, wired into Login + Signup mockups.
- User spotted white-square bg on dark mode; re-exported `shared/FFC Logo Transparent Background.png` (1.44 MB, 1024×1024) at 09:26 → re-copied both paths. No code changes needed (same filename).

### Phase B — Code (6 files, 2 new components, 1 deletion)
- `ffc/src/lib/AppContext.tsx` — replaced placeholder `useEffect` with real `profiles.select('id, role').eq('auth_user_id', userId).maybeSingle()`. Added `profileId` + `profileLoading` to context. Depend on `userId` (not `session`) to avoid re-fetch on token refresh.
- `ffc/src/router.tsx` — dropped Welcome route; `HomeRoute` now dispatches: no session → `/login`; session + role → `/poll`; session + no role → inline `<PendingApproval />`.
- `ffc/src/pages/Welcome.tsx` — DELETED.
- `ffc/src/pages/PendingApproval.tsx` — NEW. Shown to signed-in users with no profile yet; shows hourglass + sign-out link.
- `ffc/src/pages/Login.tsx` — real form: email/password `signInWithPassword`; `signInWithOAuth('google')`; banner states for wrong credentials / unconfirmed email / rejected account (via `?err=rejected` query param set by AppContext).
- `ffc/src/pages/Signup.tsx` — 3-stage state machine. Stage derivation: no session → 'auth'; session + no role + no pending row → 'who'; session + no role + pending row → 'waiting'. Stage 2 fetches ghosts via `profiles.is('auth_user_id', null).eq('is_active', true)`; insert to `pending_signups` on submit.
- `ffc/src/pages/admin/AdminPlayers.tsx` — 3-tab Pending/Active/Rejected. Pending is fully interactive (approve_signup + reject_signup RPCs, bottom sheet confirmations, 10-char min reject reason). Active/Rejected are read-only lists.
- `ffc/src/index.css` — +~450 lines of auth + admin classes (`.auth-hero`, `.auth-crest`, `.auth-progress`, `.auth-form`, `.auth-input`, `.password-wrap`, `.ghost-row`, `.pos-pill--{gk,def,cdm,w,st}`, `.admin-segments`, `.pending-row`, `.chip-{pending,claim,new,role}`, `.sheet`, `.auth-waiting`).
- `ffc/src/components/PasswordInput.tsx` — NEW. Reusable wrapper with eye-toggle (SVG icons inline, switches type='password'↔'text', aria-pressed). Applied to Login password + Signup password + confirm.
- `ffc/src/layouts/RoleLayout.tsx` — added emoji icons to bottom nav tabs (🏠 Home · 📊 Table · 👤 Profile · ⚙️ Settings · 🛠 Admin).
- TypeScript check: zero errors after fixing one `string | null` → `string | undefined` coercion on the `approve_signup` RPC param.

### Phase C — Super_admin bootstrap
- User created `m.muwahid@gmail.com` in Supabase dashboard → Auth → Users (auto-confirmed, no email verification).
- Auth UUID: `67d8219c-6086-4f23-a2fa-deeb3fcc28bf`. Existing super_admin profile id: `cce905a8-8f42-48c4-bf9e-65a3cb301757`.
- Ran `UPDATE profiles SET auth_user_id = '<uuid>', is_active = true, updated_at = now() WHERE email = 'm.muwahid@gmail.com' AND role = 'super_admin'` via `supabase db query --linked`. Verified bind; 1 row returned.

### Phase D — Acceptance tests (partial)
- **D1 PASS.** Super_admin signs in → lands on `/poll` → 5-tab bottom nav visible (Home · Table · Profile · Settings · Admin). Icons rendering after HMR refresh. No console errors.
- **D2 BLOCKED.** Supabase `signUp({email: 'test.s019@example.com'})` rejects with `"Email address 'test.s019@example.com' is invalid"`. Supabase's default validator is strict about example.com / throwaway domains. User parked here to go; D2–D6 move to S020.

### Critical mid-session bug discovery — missing GRANTs on public schema

- **Symptom:** super_admin signed in successfully (`last_sign_in_at` populated, JWT valid) but AppContext profile fetch silently returned `data: null`, landing the user on PendingApproval despite the DB row being correctly bound.
- **Root cause:** Supabase project was provisioned with "automatic table exposure" OFF. RLS was enabled and the `profiles_select_all` policy granted read to `authenticated`, but the `authenticated` role had **no table-level SELECT privilege**. RLS filters rows on top of GRANTs — without the GRANT, every query returns empty with no error.
- **Fix:** New migration `supabase/migrations/0012_grants.sql` — `GRANT USAGE ON SCHEMA public TO anon, authenticated; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated; ALTER DEFAULT PRIVILEGES ... FOR NEW TABLES`. Applied via `supabase db push`. Verified post-fix: authenticated role now has `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`.
- **Why Step 2 didn't catch this:** our migrations explicitly wrote RLS + policies but never emitted the GRANT statements. Supabase's default setup normally injects these when auto-exposure is on; we turned that off at project provisioning (S015) to keep things explicit. The explicit path was incomplete.

### Infrastructure fixes along the way

- **`.claude/launch.json` mockup preview dir corrected** — was `.superpowers/brainstorm/635-1776592878/content` (old superpowers scratch dir), changed to `mockups`. Server now serves live mockup edits instead of stale snapshots.
- **OneDrive Files-On-Demand cache surprise** — even after fixing launch.json, Python http.server briefly served a stale 3,820-byte stub of welcome.html instead of the 8,801-byte real file. Resolved by re-writing the file (forces materialisation). Also happened once in the reverse direction with `ffc-logo.png`.

---

## Files Created or Modified

**Mockups (approved):**
- `mockups/login.html` — new (16 KB)
- `mockups/signup.html` — new (19 KB)
- `mockups/admin-players-pending.html` — new (18 KB); existing `mockups/3-17-admin-players.html` left untouched
- `mockups/welcome.html` — DELETED (Welcome dropped per user scope simplification)
- `mockups/ffc-logo.png` — new (1.44 MB, transparent PNG from user)

**Shared assets:**
- `shared/FFC Logo Final.png` — new (user asset, white-bg, superseded)
- `shared/FFC Logo Transparent Background.png` — new (user asset, authoritative)

**Code:**
- `ffc/public/ffc-logo.png` — new (transparent PNG, referenced from `<img src="/ffc-logo.png">`)
- `ffc/src/components/PasswordInput.tsx` — new
- `ffc/src/pages/PendingApproval.tsx` — new
- `ffc/src/pages/Welcome.tsx` — DELETED
- `ffc/src/router.tsx` — modified (3-state HomeRoute, Welcome import removed)
- `ffc/src/layouts/RoleLayout.tsx` — modified (emoji icons on bottom nav)
- `ffc/src/lib/AppContext.tsx` — modified (profile fetch + profileLoading + profileId)
- `ffc/src/pages/Login.tsx` — modified (real form + error banners + PasswordInput)
- `ffc/src/pages/Signup.tsx` — modified (3-stage state machine + ghost list + PasswordInput × 2)
- `ffc/src/pages/admin/AdminPlayers.tsx` — modified (Pending tab + sheets + 3-tab switcher)
- `ffc/src/index.css` — modified (+~450 lines of auth/admin classes)

**Database:**
- `supabase/migrations/0012_grants.sql` — new (GRANT fix, applied to live project)
- `profiles.auth_user_id` bound for `m.muwahid@gmail.com` via direct SQL (one-off bootstrap)

**Config:**
- `.claude/launch.json` — modified (Mockup Preview dir → `mockups`)

## Key Decisions

- **Welcome screen dropped.** Login is the app entry. Simpler IA, one less screen to maintain, no change to §3.3 signup flow.
- **Super_admin bootstrap via one-off Supabase signUp + manual SQL bind** (not via the `/signup` flow) — sidesteps the chicken-and-egg where `approve_signup` RPC requires `is_admin()`.
- **Admin-players Pending tab as a new mockup** rather than editing the approved `3-17-admin-players.html` — keeps the prior approval intact, gives S019 a focused review surface.
- **GRANT fix as a new migration (0012)** rather than edits to 0009 — migrations are immutable once applied to prod.
- **Debug logs removed before commit.** Transient logs used to diagnose the GRANT bug did not ship.

## Open Questions / Deferred

- **D2–D6 acceptance tests** (throwaway signup + admin approve + refresh → /poll · reject path · SQL verification). Parked. **Email validator blocker** — Supabase rejects `test.s019@example.com` as invalid; S020 will pick a real-world test email (e.g. user's own secondary address, or `+tag` alias off m.muwahid@gmail.com).
- **Commit + push** — deferred; user closing session. Session starts S020 with `git status` + commit + push in one go.
- **Google OAuth** still unconfigured in Supabase dashboard — "Continue with Google" button will error until user sets up Google Cloud OAuth Client.
- **Brand palette re-alignment** — still on backburner.

## Lessons Learned

### Critical new lesson
- **RLS ≠ GRANT.** Enabling RLS and writing policies alone is insufficient — the PostgREST-exposed role (`authenticated`, `anon`) needs table-level `GRANT` too, or every query silently returns empty rows with no client-side error. Supabase's "automatic table exposure" usually emits these grants for you; when that setting is OFF, migrations must emit them explicitly. Diagnostic: `SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = '<t>' GROUP BY grantee`. Fix pattern lives in `supabase/migrations/0012_grants.sql`.

### Validated patterns
- **Mockup-first discipline still paid off.** User caught three UX amendments during mockup review that would've been painful post-code: (1) Welcome screen doesn't add value; (2) Login crest needs to be big + text-free; (3) Signup Stage 1 should match Login's crest treatment. All caught pre-code.
- **Logo asset handover loop works.** White-bg PNG → user flagged → user re-exported transparent → 2-file copy → zero code changes. Clean handoff.
- **PasswordInput as a tiny shared component.** Three password fields across two pages; the wrapper paid for itself on fields 2 and 3.

### New infrastructure lesson
- **`.claude/launch.json` can drift.** The `Mockup Preview` config pointed at an obsolete superpowers scratch dir that nobody was updating. Always grep for launch-config paths when mockup iteration feels "stuck."

---

## Session Metrics

- **Mockups built + approved:** 3 (Login · Signup 3-stage · AdminPlayers Pending) — 1 dropped (Welcome) — ~53 KB HTML
- **Code files touched:** 11 modified / 2 created / 1 deleted
- **Lines of CSS added:** ~450
- **Migrations:** 1 (0012_grants.sql)
- **Supabase one-off SQL:** 1 (super_admin bind)
- **TypeScript errors introduced:** 1 (caught + fixed)
- **Acceptance tests:** 1 of 6 passed (D1); D2–D6 parked for S020
