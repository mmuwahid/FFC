# S039 — Signup/login redirect-race fix + forgot-password + Phase 2 design

**Date:** 26/APR/2026
**PC:** Home (`User`)
**Topic:** Two scope items, neither related. (1) Signup/login redirect-race bug surfaced by Barhoom's first end-to-end run after S038 fix — pending row read `approved` on refresh but role was still null, dropping the user back to Stage 2 ghost-picker; also forgot-password was a dead stub. (2) Phase 2 brainstorming closed — masterplan V3.0 written + design spec + ref-console mockup. Build-order locked: Track 2B (Live Match Console) FIRST, Track 2A (Poll→Lock→Captain automation) second.
**Outcome:** Complete. 2 commits pushed; no migration; no acceptance pass yet (deferred — slice 2B-A immediately followed in S040).

## What landed

### Part 1 — Signup/login redirect-race fix (commit `677b1ed`)

Barhoom (and any post-approval user on refresh) hit a race: HomeRoute → /signup, Signup's stage-derivation `useEffect` fired before AppContext's profile fetch completed. `pending_signups.resolution = 'approved'` was visible but `role` was still null, so stage logic chose Stage 2 (ghost-picker) instead of Stage 3 (waiting/transitioning) or "redirect to /poll".

- **`Signup.tsx`** — stage-derivation `useEffect` now waits for `profileLoading === false` before running. Once role is detected, `navigate('/poll')` (was a dead `if (role) return` that did nothing). Stage 3 polls every 5s for `profile.role`; on detection, fires `window.location.replace('/')` — full reload so AppContext re-initialises with the right role from scratch (cheaper than wiring re-fetch through the existing context).
- **`Login.tsx`** — forgot-password button was a stub. Wired to `supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset-password' })`. Requires email field filled (warn banner if blank). Success state shows green ✓ banner. `BannerKind` extended with `'success'` variant.
- **`ResetPassword.tsx`** (new) — handles Supabase recovery-link callback at `/reset-password`. Validates password match + min length, calls `supabase.auth.updateUser({ password })`, shows confirmation, navigates to `/` after 2s.
- **`router.tsx`** — `/reset-password` route added under `PublicLayout`.

Build clean. No migration.

### Part 2 — Phase 2 design (commit `1d3f78e`)

Brainstorm closed with user. Two-track scope locked.

- **Track 2A — Poll → Lock → Captain automation (bundle):** Web Push delivery wired end-to-end (push_subscriptions table + `notify-dispatch` Edge Function + service-worker handler + VAPID lifecycle); vote-reminder schedule (T-24h / T-3h / T-15m) via `pg_cron` + idempotent partial index; auto-lock at deadline with `roster_locked` notifications; captain auto-pick on lock via existing `suggest_captain_pairs` (one-tap admin override).
- **Track 2B — Live Match Console:** admin generates a ref-link (URL-token with 6h TTL); ref opens it on phone, enters live events (goal/own_goal/yellow/red/halftime/fulltime/pause/resume) with minute + actor; admin sees pending entry, approves to promote events into permanent match log + match record. Timing data (kickoff_at, halftime_at, second_half_kickoff_at, fulltime_at, total_stoppage_seconds) flows through the same approve path.

**Build-order decision:** Track 2B FIRST. Rationale: concrete single-screen flow (ref entry + admin approve), soak-tests on real Thursday matchdays as soon as it ships, doesn't depend on push infra. Track 2A is more cross-cutting (cron + push + edge function + SW) and benefits from waiting until 2B has surfaced any matchday-data drift.

Three artefacts committed: `planning/FFC-masterplan-V3.0.md`, `docs/superpowers/specs/2026-04-26-ffc-phase2-design.md`, `mockups/3-21-ref-console.html`.

## Verification

- Forgot-password flow tested locally — email arrives, recovery link routes to `/reset-password`, password update succeeds, redirects to `/login`.
- Signup race fix verified by simulating slow profile fetch — Stage 3 now holds steady until role is detected.
- No live acceptance for Phase 2 design (it's design-only — code lands in S040+).

## Patterns / lessons (additive)

- **Stage-derivation `useEffect` must wait for ALL upstream loading flags.** When a page derives its UI state from multiple async sources (session, role, pending_signups), every loading flag must be `false` before stage logic runs. Otherwise the first-paint state is computed from a partial snapshot and you get false-positive stages.
- **`window.location.replace('/')` for "re-init the whole app" transitions.** When a critical context value (auth role) needs to flip and the cleanest path is a full re-fetch, prefer `window.location.replace('/')` over wiring a context-refresh API through the React tree. Cost is one extra HTTP roundtrip; benefit is a fresh, race-free start.
- **Build-order locked at design close, not at masterplan write.** When a multi-track plan goes into the spec, leave the build-order as a separate decision the user signs off explicitly. The intuition that "track A is the bigger value" doesn't always survive contact with cross-cutting infra cost.

## Commits

| SHA | Message |
|---|---|
| `677b1ed` | fix(signup,login): post-approval redirect race + forgot-password + reset page |
| `1d3f78e` | docs(phase2): masterplan V3.0 + design spec + ref-console mockup |

## Next session: S040

- **Slice 2B-A** — Phase 2 Track 2B foundation. Migration 0028 (event-log tables + 5 timing cols + extended ref-entry/approve RPCs + admin token-regen RPC). Backend-only — no UI. Slice 2B-B opens UI work.
