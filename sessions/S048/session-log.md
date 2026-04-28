# Session S048 — Phase 2 Slice 2A Foundation: Push Backend (Tasks 1–3)

**Date:** 27 / APR / 2026
**PC:** Work PC (UNHOEC03)
**Outcome:** Partial complete. Tasks 1–3 of 7 shipped end-to-end (DB foundation + Edge Function + service worker source). Tasks 4–6 (client-side subscribe wiring + iOS install gate + Settings master-toggle + multi-device acceptance) carried over to S049.
**Migrations on live DB:** 36 (0001 → 0036). 0034 / 0035 / 0036 added this session.
**Live URL:** https://ffc-gilt.vercel.app
**Commits:** `30d8935` (plan) · `ffc4079` (Task 1) · `a308600` (Task 2 v1) · `9ee8b7c` (Task 2 auth fix + 0035/0036) · `eba2aa0` (Task 3) · close-out (this commit)

---

## What shipped

### Brainstorm + plan (commit `30d8935`)

S048 opened on the carry-over agenda from S047's todo: live device acceptance (blocked on real Thursday), captain reroll on MD31 (blocked on live conditions), and Phase 2A push delivery foundation (greenfield, fully unblocked). User picked Phase 2A.

Brainstorm session locked four scope decisions before any code:

1. **Scope width:** end-to-end push (button → phone) — bundle slices 2A-A + 2A-B + 2A-C in one S048. Migration + Edge Function + client subscribe + iOS gate + service worker. Defer pg_cron polling fallback + auto-lock + auto-pick to slice 2A-D.
2. **Trigger mechanism:** pg_net AFTER INSERT trigger only. Polling fallback deferred to 2A-D where pg_cron is needed anyway for auto-lock.
3. **iOS gating:** detect non-standalone Safari + show "install first" modal with screenshots. Master pill stays OFF until install + retry.
4. **Service-role secret path:** Vault. Trigger fetches the JWT via `vault.decrypted_secrets` at call time; never hardcoded in migration SQL.

Plan written: `docs/superpowers/plans/2026-04-27-phase2-slice-2A-A-B-C.md` (946 lines, 7 tasks + pre-flight checklist + risks + acceptance criteria). Self-review pass caught 4 inline issues: pg_net schema path correction (migrations target `net.http_post` not `extensions.http_post`), Settings.tsx pattern alignment with existing `patchProfile` flow, explicit `workbox-precaching` install step, best-effort 410 path for slice acceptance.

### Pre-flight (manual, user-driven)

User completed five manual bootstrap steps before any task could start:
1. **VAPID keypair generated locally** via `npx web-push generate-vapid-keys`. (After one false-start: user accidentally pasted public key in the Key field instead of Value, then lost the keys, regenerated cleanly.)
2. **`VITE_VAPID_PUBLIC_KEY` set in Vercel** for Production / Preview / Development scopes (non-Sensitive — Sensitive flag blocks Development environment).
3. **VAPID secrets set in Supabase Edge Function secrets:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:m.muwahid@gmail.com`.
4. **Vault secret `service_role_key` created** via dashboard SQL editor with `vault.create_secret(...)`. (Initial paste contained a stray `PA` prefix from copy artifact — caught later by Task 2 implementer; fixed by re-pasting the legacy JWT.)
5. **pg_net availability sanity check:** empty result (extension not yet installed; Task 1 migration installs it).

### Task 1 — Migration 0034 push foundation (commit `ffc4079`)

**Schema-drift discovery + reconcile.** The implementer subagent flagged that `public.push_subscriptions` already existed on the live DB (0 rows, never tracked in migration history) with a different shape than the plan: extra `disabled_at` + `disabled_reason` columns, single combined `cmd=ALL` RLS policy, endpoint-only UNIQUE, partial profile index. Likely created out-of-band via dashboard SQL editor in some earlier exploration. Three reconcile options surfaced (drop+recreate, adapt plan to soft-disable design, ALTER-table surgical). User picked **drop+recreate per approved plan** — 0 rows means zero data loss, keeps us aligned with plan + Task 2 design (DELETE on 410/404 vs UPDATE soft-disable).

**Migration 0034 contents:**
- `DROP TABLE IF EXISTS push_subscriptions CASCADE` at start (approved deviation, documented in migration header)
- `CREATE EXTENSION IF NOT EXISTS pg_net` (creates schema `net`)
- `push_subscriptions` table with 8 columns per spec: id (PK), profile_id (FK profiles ON DELETE CASCADE), endpoint, p256dh, auth, user_agent (NULL), created_at, last_seen_at + UNIQUE (profile_id, endpoint)
- `push_subscriptions_profile_idx` on (profile_id) — plain (not partial)
- RLS enabled + 3 split policies: SELECT/INSERT/DELETE own row only via `current_profile_id()`. No UPDATE policy (rows are insert-or-delete only by design).
- `notifications.delivered_at timestamptz` ADD COLUMN IF NOT EXISTS + partial index `notifications_undelivered_idx WHERE delivered_at IS NULL`
- `ALTER PUBLICATION supabase_realtime ADD TABLE pending_match_entries` wrapped in idempotent DO block
- `notify_dispatch_trigger()` SECURITY DEFINER function — search_path `public, net, extensions, vault`. Reads service_role JWT from `vault.decrypted_secrets`. POSTs to `https://hylarwwsedjxwavuwjrn.supabase.co/functions/v1/notify-dispatch` via `net.http_post(url, body, headers)`. RAISE NOTICE-only error handling so dispatch failures never block the underlying notification insert.
- `REVOKE EXECUTE ... FROM PUBLIC` on the trigger fn (S047 Layer-2 pattern)
- `notifications_dispatch_after_insert AFTER INSERT FOR EACH ROW` trigger
- BEGIN/COMMIT atomicity wrapper

**Verification:** all 5 verification queries returned expected results (push_sub_count=0, delivered_at column present, publication has pending_match_entries, function exists, trigger exists, 3 RLS policies). Types regen 2183 → 2185 lines. tsc -b EXIT 0.

**Code review notes (non-blocking, accepted):**
- Fan-out scale: AFTER INSERT FOR EACH ROW means N inserts → N net.http_post calls. Fine for FFC scale but a multi-league deployment would need statement-level batching. Track for slice 2A-D vote-reminder design.
- Hardcoded project URL on line 80 — acceptable for FFC's single-project deployment, would need parameterisation for fork portability.
- Silent dispatch failures don't surface — `notifications_undelivered_idx` is the right hook for a future polling reconciliation job.

### Task 2 — notify-dispatch Edge Function with auth-model fix (commits `a308600` + `9ee8b7c`)

**Initial implementation (`a308600`).** Created `supabase/functions/notify-dispatch/index.ts` (~120 LOC) per plan: receives notification row from trigger, fans out via `web-push@3.6.7`, marks `delivered_at`, prunes 410/404 dead subscriptions. `deno.json` import map for npm packages. Auth check: `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` env var match.

**Verification revealed three production blockers** (escalated by the implementer with DONE_WITH_CONCERNS):

1. **Vault secret had stray `PA` prefix** from paste artifact (length 221 vs expected 219). Fixed by user via `vault.update_secret(id, '<clean-legacy-jwt>')` in dashboard SQL editor.

2. **Supabase auth-key model mismatch.** `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` inside the Edge Function returns the **new-style** `sb_secret_*` key (length 41), not the legacy JWT. Confirmed via diagnostic: SHA-256 prefix `91dbb07db94b1456` from inside the function matched the new-style secret shown in Supabase API Keys dashboard. But the Supabase Functions **gateway** (the layer that authenticates the bearer before our code runs) only accepts legacy JWT bearers — `sb_secret_*` returns `UNAUTHORIZED_INVALID_JWT_FORMAT`. Trigger could never send a single bearer that satisfied both surfaces.

3. **`service_role` lacked DML grants** on `push_subscriptions` and `notifications`. Migration 0012's DEFAULT PRIVILEGES granted DML to `authenticated` only. Even with a working bearer, the Edge Function's `supabase-js` client got `42501 permission denied for table push_subscriptions` on the sub query.

**Fix path (commit `9ee8b7c`):** two-bearer auth model + dedicated env var for the JS client + grants.

- **Migration 0035 `0035_phase2a_dispatch_shared_secret.sql`** — `CREATE OR REPLACE` on `notify_dispatch_trigger()` to send BOTH headers: `Authorization: Bearer <legacy-jwt>` (gateway-acceptable) AND `X-Dispatch-Secret: <shared-secret>` (function-level caller auth). Trigger now reads two Vault secrets: `service_role_key` (legacy JWT) and new `dispatch_shared_secret`.
- **Migration 0036 `0036_phase2a_service_role_grants.sql`** — explicit `GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO service_role` + `GRANT SELECT, UPDATE ON notifications TO service_role`.
- **Edge Function update.** Replaced `SERVICE_ROLE_KEY` env-check with `DISPATCH_SHARED_SECRET` env-check on `X-Dispatch-Secret` header. Added new env var `LEGACY_SERVICE_ROLE_JWT` (set by hand by user) used by `createClient(SUPABASE_URL, LEGACY_SERVICE_ROLE_JWT, ...)` because `supabase-js` does not bypass RLS when given the new-style `sb_secret_*` key, only legacy JWT.

**End-to-end verification (after fix):**
- Direct curl: no auth → gateway 401; with bearer-only → function 401; with bearer + dispatch-secret → 200 `{"dispatched":0,"failed":0,"deleted_invalid":0}`.
- Trigger-fired path: real `INSERT INTO public.notifications (...)` → `net._http_response` shows status_code=200 with same payload. Whole pipeline operational.
- Test notifications cleaned up (`DELETE` on the 3 test rows post-verification).

**Vault state at slice close:** two named secrets — `service_role_key` (legacy JWT, 219 chars, for gateway) + `dispatch_shared_secret` (43 chars URL-safe base64, for function caller-auth).

**Edge Function env state:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `DISPATCH_SHARED_SECRET`, `LEGACY_SERVICE_ROLE_JWT`. The auto-injected `SUPABASE_SERVICE_ROLE_KEY` is no longer used.

### Task 3 — vite-plugin-pwa strategy switch + sw.ts (commit `eba2aa0`)

**Switched PWA from `generateSW` to `injectManifest`** so we can ship custom service-worker code with `push` and `notificationclick` handlers while preserving Workbox precaching.

- `ffc/vite.config.ts`: `strategies: 'generateSW'` → `'injectManifest'` + `srcDir: 'src'` + `filename: 'sw.ts'` + `injectManifest: { swSrc, swDest, globPatterns }` block. Removed orphaned `workbox` block and `buildId`/`cacheId` (cache invalidation now via workbox revision-keyed manifest + `cleanupOutdatedCaches()`).
- **New `ffc/src/sw.ts`** (~80 LOC). `precacheAndRoute(self.__WB_MANIFEST)` (replaced at build time with revisioned manifest array) + `cleanupOutdatedCaches()`. Install/activate handlers with `skipWaiting()` + `clients.claim()` for fast updates. `PushPayload` interface. `DEFAULT_DEEPLINK` map covering 7 notification kinds. `deeplinkFor(data)` helper: explicit deeplink wins → dropout_after_lock with matchday_id → `/matchday/:id/captains` → result_posted/motm_announced with match_id → `/match/:id` → DEFAULT_DEEPLINK lookup → `/` fallback. `push` handler builds notification with icon/badge/tag + data.url; `event.waitUntil(showNotification(...))` so the worker doesn't terminate mid-render. `notificationclick` handler: focus existing client + navigate, else openWindow.
- **New tsconfig isolation.** `ffc/tsconfig.app.json` adds `exclude: ["src/sw.ts"]` (so the app build doesn't pull in WebWorker types). New `ffc/tsconfig.sw.json` with `lib: ["ES2023", "WebWorker"]` + `types: ["vite-plugin-pwa/client"]`. Root `tsconfig.json` references the new SW config alongside existing app + node configs.
- **`workbox-precaching@^7.4.0`** added to devDependencies (`generateSW` bundles it internally; `injectManifest` requires explicit import).

**Build verification:** `tsc -b` EXIT 0; `vite build` EXIT 0; `dist/sw.js` 17.04 kB / 5.77 kB gzip; PWA precache 11 entries / 1565.30 KiB. `grep -c "self.__WB_MANIFEST" dist/sw.js` = 0 (build-time injection working). `grep "precacheAndRoute" dist/sw.js` confirms function call in bundle.

**Code review notes (non-blocking):**
- `notificationclick` first-client logic could hijack an unrelated tab on multi-tab setups. Acceptable for FFC's small private league.
- `globPatterns` excludes `.woff2`/`.txt` — fine today (no such assets in `public/`), but a hidden landmine for future contributors.
- `DEFAULT_DEEPLINK['dropout_after_lock'] = '/matchday'` — without matchday_id, falls through to `/matchday` which 404s. Defensive sender-side validation is the real fix; consider switching client-side fallback to `/poll`. Tracked for slice 2A-D.

### Carry-over to S049

Tasks 4 (pushSubscribe lib + IosInstallPrompt component), 5 (Settings master-toggle wiring), and 6 (multi-device E2E acceptance on prod) were not started in S048 due to time and the auth-fix detour. Plan file remains the single source of truth for those tasks. Pre-flight is fully complete — S049 can dispatch Task 4 implementer without any user setup.

---

## Files modified or created

### Commit `30d8935` — plan (1 file)
- `docs/superpowers/plans/2026-04-27-phase2-slice-2A-A-B-C.md` — 946-line slice plan

### Commit `ffc4079` — Task 1 (2 files)
- `supabase/migrations/0034_phase2a_push_foundation.sql` — push_subscriptions table + delivered_at + publication-add + pg_net trigger
- `ffc/src/lib/database.types.ts` — types regen for push_subscriptions + notifications.delivered_at

### Commit `a308600` — Task 2 v1 (2 files)
- `supabase/functions/notify-dispatch/deno.json` — npm import map
- `supabase/functions/notify-dispatch/index.ts` — Deno Edge Function with web-push fan-out

### Commit `9ee8b7c` — Task 2 auth fix (3 files)
- `supabase/migrations/0035_phase2a_dispatch_shared_secret.sql` — trigger sends two headers
- `supabase/migrations/0036_phase2a_service_role_grants.sql` — DML grants on push_subscriptions + notifications
- `supabase/functions/notify-dispatch/index.ts` — DISPATCH_SHARED_SECRET + LEGACY_SERVICE_ROLE_JWT wiring; diagnostic block removed before commit

### Commit `eba2aa0` — Task 3 (7 files)
- `ffc/vite.config.ts` — strategy switch to injectManifest
- `ffc/src/sw.ts` (NEW) — service worker source with push + notificationclick handlers
- `ffc/tsconfig.json` — composite reference adds tsconfig.sw.json
- `ffc/tsconfig.app.json` — exclude src/sw.ts
- `ffc/tsconfig.sw.json` (NEW) — WebWorker lib + vite-plugin-pwa/client types
- `ffc/package.json` — workbox-precaching@^7.4.0 in devDependencies
- `ffc/package-lock.json` — lockfile sync

### Close-out commit (this commit, 4 files)
- `tasks/todo.md` — S048 → S049 prep
- `sessions/INDEX.md` — S048 entry + next-session pointer
- `sessions/S048/session-log.md` (this file)
- `CLAUDE.md` — status line + new patterns added

---

## Key decisions

- **Scope: end-to-end push backend (button → phone)** — bundle slices 2A-A + 2A-B + 2A-C. Defer polling fallback / auto-lock / auto-pick to 2A-D.
- **Trigger: pg_net only** for S048; pg_cron polling fallback delayed to 2A-D where it's needed for auto-lock anyway.
- **iOS: install-first modal** when master toggled ON on non-standalone Safari (planned for Task 4; not yet wired).
- **Vault > `ALTER DATABASE SET`** for service-role JWT storage — keeps secrets out of migration SQL.
- **Drop and recreate `push_subscriptions`** when out-of-band schema drift was discovered. 0 rows live, zero data loss.
- **Two-bearer auth model** instead of trying to make one bearer work for both gateway and function. Decoupled function-level caller-auth from Supabase's two-key system.
- **Dedicated `LEGACY_SERVICE_ROLE_JWT` env var** instead of using the auto-injected `SUPABASE_SERVICE_ROLE_KEY` (which is `sb_secret_*` and not RLS-bypassing).
- **Explicit grants on new tables** for service_role — don't assume migration 0012 covers it.
- **`tsconfig.sw.json` separate from `tsconfig.app.json`** — clean composite-build pattern (same as existing `tsconfig.node.json`); WebWorker lib vs DOM lib.

---

## Open issues / blockers

- **Live device acceptance for 2B-B/C/D/E/F chain** still blocked on real Thursday matchday — accumulating from S041.
- **Captain reroll live test** on MD31 still blocked on live conditions.
- **Tasks 4–6 of slice 2A-A/B/C** remain to be executed in S049. Plan is unchanged; pre-flight is done.

---

## Next actions

- [ ] **S049 — Tasks 4 + 5 + 6 of slice 2A.** Plan task descriptions are in `docs/superpowers/plans/2026-04-27-phase2-slice-2A-A-B-C.md`. Pre-flight is complete. End state: real device receives a push from a manually-inserted notifications row.
- [ ] **Live device acceptance** for 2B-B/C/D/E/F chain (carry-over).
- [ ] **Captain reroll live test** on MD31 (carry-over).

---

## Lessons learned

### Patterns validated this session

- **Subagent over-applying system reminders** — when the malware-warning system reminder fires on every file read, a subagent can interpret it as a blanket refusal instruction and decline the work entirely. Fix: in the implementer prompt, explicitly clarify that those reminders are an automated guard against malware (not a stop signal for legitimate user-authorized engineering on the user's own project), and to note "source code, not malware" briefly and proceed. Include this disclaimer in any future implementer dispatch where heavy file reading is expected.

- **Dashboard paste artifacts** can silently inject prefix/suffix bytes (the Vault secret got a `PA` prefix from a clipboard mishap). Defensive verification step after every secret create/update: `SELECT length(decrypted_secret), substring(decrypted_secret, 1, 5)` to confirm the shape before assuming it'll work. Cheap belt-and-braces.

- **Supabase auth-key dual model trap.** `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` inside an Edge Function returns the new-style `sb_secret_*` key. The Supabase Functions gateway (in front of the function) only accepts legacy JWT bearers. Worse, `supabase-js` accepts both as bearer tokens at construction but only the legacy JWT actually bypasses RLS. **Two consequences:** (a) any function-level auth check that compares `Authorization: Bearer ...` to `SUPABASE_SERVICE_ROLE_KEY` env will fail because the inbound bearer must be legacy JWT (gateway constraint) but the env is `sb_secret_*`. (b) `createClient(SUPABASE_URL, SERVICE_ROLE_KEY, ...)` with the auto-injected env value silently fails RLS-bypass — you get permission-denied errors despite passing a "service role" key. Fix: store the legacy JWT in a separate env var (e.g. `LEGACY_SERVICE_ROLE_JWT`) set by hand, use that for `createClient`, and use a custom shared-secret in a custom header for caller-auth so you don't rely on Supabase's key system at all.

- **Migration 0012 DEFAULT PRIVILEGES does NOT cover service_role.** New tables created in `public` get DML grants for `authenticated` but not for `service_role`. If an Edge Function (or any service-role caller) needs to read/write the new table, emit explicit `GRANT ... TO service_role` in the same migration that creates the table. Caught in S048 only because the Edge Function failed at runtime; CLAUDE.md previously documented "rely on 0012's DEFAULT PRIVILEGES" — that note should be amended.

- **Two-bearer model for Supabase Edge Functions.** When the gateway's bearer requirement (legacy JWT only) conflicts with what your function-internal env actually contains (`sb_secret_*`), decouple: send `Authorization: Bearer <legacy-jwt>` (satisfies gateway) AND `X-<custom>-Secret: <shared-secret>` (your function checks against a separately-stored env var). Function knows nothing about Supabase's two-key system and can't drift if Supabase changes their key model.

- **`net.http_post` body accepts `jsonb` directly** — no need for `::text` cast. Plan's `body := jsonb_build_object(...)::text` was conservative; the simpler form works and is cleaner.

- **`tsconfig.sw.json` as a sibling of `tsconfig.app.json` and `tsconfig.node.json`** is the right pattern for service-worker source isolation in a Vite project. WebWorker-lib SW code can't share the DOM-lib app config; the composite-build pattern makes both build cleanly with one `tsc -b` invocation. Cost: ~30 lines of compiler-options duplication; benefit: clean separation, incremental builds, no cross-include surprises.

- **`vite-plugin-pwa` strategy switch from `generateSW` to `injectManifest`** is mostly mechanical: keep `manifest`, `registerType`, `devOptions`; add `srcDir`, `filename`, `injectManifest` block; remove `workbox` block (generateSW-only); install `workbox-precaching` explicitly. The workbox revision-keyed cache keys do all the heavy lifting; `cacheId`/`buildId` aren't needed.

- **Diagnostic-via-extra-endpoint pattern** for Edge Functions when MCP log access is unavailable: temporarily add an `if (req.headers.get('x-diag') === '<token>') return JSON with limited fingerprints of the env value`. Use `crypto.subtle.digest('SHA-256', ...)` to expose only an 8-byte prefix that lets you compare-without-revealing. Remove the diagnostic before final commit.

- **Plan + brainstorm gates pay off when the live state surprises.** The schema-drift discovery on `push_subscriptions` would have been a far bigger detour without the explicit "pause and ask the user" subagent escalation. Saved a destructive ALTER-table mess. The auth-model surprise (Task 2) similarly resolved cleanly because the implementer escalated DONE_WITH_CONCERNS rather than masking the issue.

---

## Migrations on live DB at close

**36 (0001 → 0036).** S048 added 0034 (push foundation), 0035 (dispatch shared secret + trigger update), 0036 (service_role grants).

## Live URL

https://ffc-gilt.vercel.app — backend changes are live; client-side push subscribe wiring (Tasks 4–5) ships in S049.

---

_Session logged: 2026-04-27 | Logged by: Claude (S048) | FFC Phase 2 Slice 2A foundation_
