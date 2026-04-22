# S021 — 22/APR/2026 · Home PC

**Topic:** OAuth Path B retest · PWA icon variants · Signup confirm-email handler · admin_audit_log docs · cross-PC sync protocol

**Commits shipped (origin/main tip → `a39f56f`):**
1. `ff82978` feat(pwa): real FFC crest icons + manifest (32/180/192/512 + maskable)
2. `0ed3499` docs(claude): mandatory session-start cross-PC sync protocol
3. `a39f56f` feat(signup): handle Confirm-email ON (check-your-inbox stage + resend)

---

## 1 · Cold start — cross-PC sync trap

Session opened on home PC with the OneDrive working tree already populated with S019+S020 changes (OneDrive synced the files from work PC) but the home-PC local `.git/` still at S017 HEAD `f10f138` — because `FFC/.git` pointer still said `gitdir: C:/Users/UNHOEC03/FFC-git` (work-PC path, doesn't exist on home PC).

**Symptoms:** `git status` showed 13 "modified" files + 15 "untracked" — all of them actually the 5 commits on origin/main that were pushed from work PC.

**Fix sequence:**
1. Rewrote `FFC/.git` to `gitdir: C:/Users/User/FFC-git` (home-PC git internals, already present from prior sessions).
2. `git fetch` → confirmed 5 commits behind origin/main.
3. `git stash push --include-untracked -m "home-pc-sync-s021"`.
4. `git pull --ff-only` → fast-forwarded `f10f138 → 5791a77`.
5. `git stash drop` (stash content was byte-identical to the pulled tree).
6. Verified clean via `git status -sb`.

**Durable rule added to CLAUDE.md** (commit `0ed3499`): 5-step session-start sync protocol. Three possible states distinguished — (a) clean, (b) lagging-side with tree matching origin (safe stash-pull-drop), (c) genuine WIP (ask user before touching). Differentiator: `git diff HEAD origin/main --stat` vs `git status` file lists.

---

## 2 · Google OAuth Path B retest (item #1, PASSED)

Pre-flight with curl: OAuth probe returned 302→`accounts.google.com/o/oauth2/v2/auth` with all 6 params correct (client_id `991515683563-...`, redirect_uri `.../supabase.co/auth/v1/callback`, scope `email profile`, response_type `code`, state CSRF token).

Playwright-cli navigated `/login` → clicked "Continue with Google" → landed on Google signin page with FFC's Web Client ID embedded. Further progress blocked by Google's Chromium-automation detection (expected, documented in lessons).

**User click-through on real Chrome:** signed in as `m.muwahid05@gmail.com` → Google consent → redirect back → landed on `/poll` with 4-tab player nav (NO Admin — correct role layout).

**DB verification post-OAuth** (via `npx supabase db query --linked`):

| User | Providers (pre) | Providers (post) | Merge OK |
|------|-----------------|------------------|----------|
| `m.muwahid@gmail.com` (super_admin) | `[email]` | `[email, google]` | (already merged in S020) |
| `m.muwahid05@gmail.com` (player) | `[email]` | `[email, google]` | ✅ new google identity added at 16:06:20 |

**Profile uniqueness sanity:** total=3, unique auth_user_ids=3, bound=3, ghosts=0 — confirms Supabase identity-merge did NOT fork a duplicate profile row.

---

## 3 · Real PWA icon variants (item #2, LIVE)

**Finding:** existing `ffc/public/favicon.svg` (wired into manifest + `<link rel="icon">` + `<link rel="apple-touch-icon">`) was a **purple lightning-bolt** from a Vite/shadcn starter — NOT the FFC crest. Every PWA install, browser tab, and iOS home-screen icon was showing the wrong brand.

**Finding:** `shared/FFC Logo Transparent Background.png` is byte-identical (md5 `4d89450208beab49ba2e775310fb10db`) to `ffc/public/ffc-logo.png` — master in place, just not wired to favicon/manifest endpoints.

**Finding:** "SVG master via Python Pillow" (as planned in todo.md) not feasible — Pillow is raster-only. Scope revised to raster-only PNG variants + single maskable.

**Pillow one-shot** generated 5 variants from 1024×1024 RGBA master:

| File | Size | Purpose |
|------|------|---------|
| `ffc-logo-32.png` | 2195 B | Browser tab favicon |
| `ffc-logo-180.png` | 30461 B | iOS apple-touch-icon |
| `ffc-logo-192.png` | 33955 B | PWA manifest any/192 + splash img |
| `ffc-logo-512.png` | 173555 B | PWA manifest any/512 |
| `ffc-logo-maskable-512.png` | 121050 B | PWA manifest maskable/512 — crest centered in 80% safe zone on `#0e1826` bg |

**Wiring edits:**
- `manifest.webmanifest`: icons array rewritten (any 192 + any 512 + maskable 512).
- `index.html`: `<link rel="icon">` → 32px PNG, `<link rel="apple-touch-icon">` → 180px PNG, inline splash replaced text-gradient "FFC" tile with `<img class=ffc-splash-crest src=/ffc-logo-192.png>` (128×128 with drop-shadow filter).
- `ffc/public/favicon.svg` DELETED (`git rm`).
- `.gitignore`: added `.playwright-cli/`.

**Build + verify:** `tsc -b --noEmit` exit 0 · Vite build 236ms · PWA plugin precache 10 entries (2270 KiB) · `dist/` contains all 5 new PNGs + no SVG · `dist/manifest.webmanifest` = 698 B matches source.

**Live smoke-test (curl against https://ffc-gilt.vercel.app):**
```
200 2195B   /ffc-logo-32.png
200 30461B  /ffc-logo-180.png
200 33955B  /ffc-logo-192.png
200 173555B /ffc-logo-512.png
200 121050B /ffc-logo-maskable-512.png
200 (stale cache) /favicon.svg  ← harmless; no code path references it
```

Manifest + index.html head both verified correct via curl.

---

## 4 · Signup.tsx confirm-email handler (item #3, SHIPPED — latent fix)

**Latent bug:** when Supabase "Confirm email" is ON, `supabase.auth.signUp()` returns `{data:{user, session:null}, error:null}` — no session → `onAuthStateChange` never fires → stage-transition effect never runs → user sees Stage 1 form with no feedback. Currently masked because confirmations are OFF (Phase 1 gate is admin approval), but would re-break if ever flipped ON.

**Implementation:**
1. Widened `Stage` type: `'auth' | 'confirm_email' | 'who' | 'waiting'`. Widened `Banner` kind: added `'success'`.
2. `handleStage1` now destructures `{data, error}` from signUp; if `!data.session` → `setStage('confirm_email')`.
3. Stage-derivation effect: `setStage((prev) => prev === 'confirm_email' ? prev : 'auth')` when no session (preserves stage through re-renders when user is waiting on inbox click).
4. New `handleResendConfirm` using `supabase.auth.resend({ type: 'signup', email })`.
5. New render branch for `stage === 'confirm_email'` — progress dots at stage 1, ⧗ icon + "Check your inbox" title + email highlighted + resend button + "Use a different email" link that bounces back to auth stage.
6. Added `.auth-banner--success` CSS class (green tint).

**Build clean** · live Signup Stage 1 verified via Playwright snapshot — all fields + buttons + links intact, no regression.

---

## 5 · admin_audit_log column audit (item #4, DONE)

**Actual schema** (queried via `information_schema.columns`):

| Column | Type |
|--------|------|
| `id` | uuid |
| `admin_profile_id` | uuid |
| `target_entity` | text |
| `target_id` | uuid |
| `action` | text |
| `payload_jsonb` | jsonb |
| `created_at` | timestamptz |

**S020 D5's broken query** used `target_table` — column doesn't exist; actual name is `target_entity`. Sample rows confirmed 2 entries from S020 (approve_signup + reject_signup for `pending_signups`).

**New file `docs/admin-audit-sql.md`:** schema table, 4 common queries (recent-by-admin, approve/reject-with-signup-join, reject-reasons-only, daily-volume), known-actions table. Pattern codified: any table with non-obvious columns (audit trails, enum-holders, JSONB-shape-varying) gets a same-named `docs/<table-name>-sql.md` at creation.

**Lessons.md row added** (22/APR/2026 S021): "target_entity vs target_table — canonical reference file created, grep that before re-inventing column names. General rule applies to all future non-obvious-schema tables."

---

## 6 · Deferred to S022

- **Step 4 UI slice decision.** Two paths per masterplan §17: (a) Poll full Depth-B §3.7 to close Step 3 acceptance gap, or (b) Leaderboard §3.13 per §3 section order. Recommend planner agent pass before choosing.
- **Vector FFC crest** if user exports SVG master — 5-minute wire-up.

---

## Session metrics

- **Duration:** ~2.5 hours active
- **Commits:** 3 (net +12 files, −1 file, ~200 insertions, ~15 deletions)
- **Live verifications:** 3 rounds of curl smoke-tests after each deploy
- **Lessons added:** 1 row (S021 target_entity gap)
- **Docs added:** 1 file (admin-audit-sql.md)
- **Durable rules added:** 1 (CLAUDE.md session-start sync protocol)
