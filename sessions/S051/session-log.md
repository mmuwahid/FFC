# Session Log — 2026-04-28 — Session051 — Phase 2A close (push client + auth purge + Resend + SVG + auto-lock + auto-pick + vote reminders)

**Project:** FFC
**Type:** Build
**Phase:** Phase 2A close-out (every code-level Track 2A piece now landed; live acceptance still owed)
**Duration:** Deep (single working block, multi-stage)
**Commits:** `7d82b6a` (push client + auth purge + Resend scaffold) · `227f0f7` (2A-D + 2A-E + SVG) · `7a47dfd` (2A-F vote reminders)

---

## What Was Done

### Backlog re-add (V3.0 masterplan edit)
- User flagged that player analytics + H2H comparison were in early plans (V1.0 → V2.4 "Phase 4 — Extras") but dropped during V2.5 consolidation.
- Restored both items to V3.0 Phase 3 backlog at `planning/FFC-masterplan-V3.0.md:139–148` with provenance note dating the restore (28/APR/2026, S051 prep).
- Distinct from existing "Multi-season comparison stats" which stays as a separate item.

### Quick-win 1 — Phase 2A push client (Tasks 4 + 5)
- Closed S049's biggest carry-over item.
- New `ffc/src/lib/pushSubscribe.ts` (~165 LOC):
  - `urlBase64ToUint8Array(base64)` — W3C URL-safe base64 → `Uint8Array<ArrayBuffer>`. Allocates a fresh `ArrayBuffer` (not `ArrayBufferLike`) inside the helper because PushManager.subscribe's `applicationServerKey` typing under strict lib.dom rejects `Uint8Array<ArrayBufferLike>`.
  - `isIosNonStandalone()` — UA + display-mode + legacy `navigator.standalone` triple-check, also handles iPad-as-MacIntel-with-touch.
  - `subscribeAndPersist(profileId)` — idempotent (reuses existing `PushSubscription` if present); upserts `push_subscriptions` row via `onConflict: 'profile_id,endpoint'`.
  - `unsubscribeAndDelete(profileId)` — best-effort: tries `sub.unsubscribe()` first, then deletes the matching row by endpoint (or all rows for the profile if no local subscription).
- New `ffc/src/components/IosInstallPrompt.tsx` (~50 LOC) — 3-step modal portal with safe-area-bottom padding.
- `ffc/src/index.css` — appended ~115 LOC scoped `.iip-*` styles.
- `ffc/src/pages/Settings.tsx` — new `handleMasterToggle(val)`:
  - On ON: iOS-gate (`isIosNonStandalone()` → opens prompt + leaves master OFF) → permission gate (`Notification.requestPermission()` if `default`) → `subscribeAndPersist` → `patchProfile` master:true.
  - On OFF: `unsubscribeAndDelete` → `patchProfile` master:false.
  - State: `masterBusy`, `masterError`, `iosInstallOpen`. Existing prompt-tile button now routes through the same handler.
- `ffc/src/lib/env.d.ts` — typed `VITE_VAPID_PUBLIC_KEY` (already set in Vercel env from S048).

### Quick-win 2 — auth.users hard-purge (S049 delete-account follow-up)
- Migration `0041_auth_purge_trigger.sql`:
  - Patches `delete_my_account()` to capture `auth_user_id` BEFORE the destructive UPDATE and stash it in the audit_log payload `{at, auth_user_id}` (durable evidence trail).
  - New `purge_auth_user_trigger()` SECURITY DEFINER + `search_path = public, net, extensions, vault` mirroring the `notify_dispatch_trigger` two-bearer pattern from S048 mig 0035.
  - AFTER UPDATE OF `deleted_at` ON `profiles` trigger: fires only on the NULL → NOT NULL transition AND when OLD.auth_user_id was non-null. pg_net POSTs `{auth_user_id, profile_id}` to the EF with `Authorization: Bearer <legacy-jwt>` + `X-Dispatch-Secret: <shared-secret>`. Errors swallowed via NOTICE so soft-delete still commits.
- Edge Function `supabase/functions/purge-deleted-auth-user/` (index.ts ~85 LOC + deno.json):
  - Validates `X-Dispatch-Secret` header before any work.
  - Calls `auth.admin.deleteUser(auth_user_id)` (treats 404 as idempotent success).
  - Best-effort prunes `push_subscriptions` for the deleted profile so notify-dispatch stops fanning out to dead devices.
  - Reuses `LEGACY_SERVICE_ROLE_JWT` + `DISPATCH_SHARED_SECRET` env from S048 — no new pre-flight.

### Quick-win 3 — Resend signup-outcome email
- Migration `0042_notify_signup_outcome_trigger.sql`:
  - `notify_signup_outcome_trigger()` AFTER UPDATE OF `resolution` ON `pending_signups`. Fires only on the `pending → approved/rejected` transition. Same two-bearer auth as 0041.
  - Body posts `{pending_signup_id, email, display_name, resolution, rejection_reason}` to the EF.
- Edge Function `supabase/functions/notify-signup-outcome/` (index.ts ~95 LOC + deno.json — empty `imports` since the EF uses `fetch` to Resend's HTTP API, no npm dep):
  - Validates `X-Dispatch-Secret`.
  - Builds branded HTML for the two outcomes (escaped `<>` in display_name + reason). Approved copy points to `https://ffc-gilt.vercel.app/login`. Rejected copy includes `rejection_reason` if present.
  - POSTs to `https://api.resend.com/emails` with Bearer `RESEND_API_KEY`. Default sender `FFC <onboarding@resend.dev>` (Resend free tier), overridable via `NOTIFY_FROM` env.
- Set `RESEND_API_KEY=re_innkLSv8_...` as Supabase project secret via `npx supabase secrets set`. Verified via `supabase secrets list` (digest shown).

### Quick-win 4 — Vector FFC crest SVG
- User flagged the crest was PNG-only (low-priority backburner from S050).
- Probed the system: no `pdftocairo` / `pdf2svg` / `inkscape` / `potrace` / `gs` / ImageMagick installed.
- `pip install pymupdf` (PyMuPDF) — Python 3.13 picked it up cleanly.
- `python -c "import fitz; doc=fitz.open('shared/FF_LOGO_FINAL.pdf'); page=doc[0]; print(page.get_drawings())"` — confirmed the PDF holds **26 vector drawings + 0 raster images**. Pure vector source, ideal for direct extraction.
- `page.get_svg_image(matrix=fitz.Identity)` — wrote `shared/ffc-logo.svg` (~11.5 KB, 37 lines, brand colours `#ebe7e0` cream + `#b0a48a` gold preserved).
- Copied to `ffc/public/ffc-logo.svg` so Vite serves it.
- Swapped 5 in-app `<img>` references PNG → SVG: `Login.tsx` · `Signup.tsx` · `ResetPassword.tsx` (×2) · `Matches.tsx` (×2 splitc-logo). PWA manifest icons + `sw.ts` push notification icons stay PNG (browser/OS spec compliance for those surfaces).

### Phase 2A-D — auto-lock + dropout-after-lock banner
- Migration `0043_phase2a_auto_lock_and_captain_pick.sql`:
  - `notification_kind` extended with `captain_auto_picked`, `captain_assigned`, `you_are_in`. Three new values; required `COMMIT` between `ALTER TYPE ADD VALUE` and any function that references them.
  - `is_captain_of(matchday_id)` STABLE SECURITY DEFINER helper (joins `match_players` ⨝ `matches` on `is_captain = true` for `current_profile_id()`). Used by the new `promote_from_waitlist` overload's auth gate.
  - `promote_from_waitlist(uuid)` — 1-arg overload alongside the existing S012 `(uuid, uuid)` admin version. Different arity = no PG conflict. Captain-or-admin gated. Finds next waitlisted yes-voter by `committed_at` order at position `roster_cap + 1`. Fires `you_are_in` notification. Returns promoted `profile_id` or NULL when waitlist empty.
  - `auto_lock_matchday(matchday_id)` — service-role-callable from pg_cron. Idempotent (early-return if `roster_locked_at` already set). UPDATE matchdays + insert `roster_locked` notifications partitioned by `committed_at` ROW_NUMBER into confirmed (≤ cap) vs waitlist (> cap), then conditionally calls `auto_pick_captains_on_lock` based on `app_settings.auto_pick_captains.enabled`. Logs via `log_admin_action`.
  - `notify_dropout_after_lock_trigger()` — AFTER UPDATE OF `cancelled_at` ON `poll_votes`. Detects post-lock cancellations + captain status (via `match_players.is_captain` derivation). Inserts `dropout_after_lock` notifications to admins + captains with payload `{matchday_id, cancelled_profile_id, was_captain, deeplink}`.
  - `app_settings` row `auto_pick_captains` defaults `{"enabled": true}`.
  - pg_cron job `auto-lock-matchdays` scheduled `* * * * *` against `matchdays WHERE poll_closes_at <= now() AND roster_locked_at IS NULL`. Idempotent setup via `cron.unschedule` + `cron.schedule` in DO block.

- New `ffc/src/components/CaptainDropoutBanner.tsx` (~210 LOC):
  - Initial fetch: 20 most recent unread `dropout_after_lock` notifications for current user, client-filtered to current matchday.
  - Realtime subscription on `notifications` filtered by `recipient_id=eq.${currentUserId}`, client-filters incoming to dropout_after_lock kind + matchday match. Stack supports multiple pending dropouts.
  - Names lookup batched via `IN (ids)` query.
  - Two flavours via `payload.was_captain`: regular dropout → `[Promote from waitlist]` calls `promote_from_waitlist` RPC; captain dropout → `[Roll for new captain]` calls `request_reroll` RPC (existing S037).
  - Marks notifications read on action so they don't reappear after refresh.
- `ffc/src/pages/admin/CaptainHelper.tsx` integrated banner above the mode toggle. Added `profileId` from `useApp()`.

### Phase 2A-E — auto-pick captains on lock + admin override pill
- `auto_pick_captains_on_lock(matchday_id)` shipped in mig 0043 — initially called `set_matchday_captains` to do the captain UPDATE.
- **Caught at design review (would have failed live):** `set_matchday_captains` requires `is_admin()`, and pg_cron runs without `auth.uid` → `current_profile_id()` returns NULL → `is_admin()` returns false → captain-set raises `42501 Admin role required`.
- Migration `0044_auto_pick_inline_captain_update.sql` — fix:
  - Inlines the `match_players` UPDATE inside `auto_pick_captains_on_lock` (bypasses the admin gate; runs as SECURITY DEFINER without going through the admin-guarded RPC).
  - Audits with `action = 'set_matchday_captains'` and `payload.auto_picked = true` so the UI can detect.
  - Notifies both captains via `captain_assigned` (with `team` payload) + admins via `captain_auto_picked` with override deeplink `/matchday/:id/captains` and `auto_picked: true` flag.
- `CaptainHelper.tsx`:
  - New `autoPickedAt` state + useEffect that queries the most recent `set_matchday_captains` audit for this `match.id`. If `payload_jsonb->>'auto_picked' === true` → set `autoPickedAt`. Re-runs when `match?.id` changes OR when `saving` toggles (manual override clears the pill).
  - New gold "Auto-picked at lock — roll or pick a new pair to override" announcer banner above the mode toggle.
- `ffc/src/lib/notificationDeeplinks.ts` + `ffc/src/sw.ts` — mirrored deeplinks for `captain_auto_picked`, `captain_assigned`, `you_are_in`.
- `ffc/src/index.css` — appended ~115 LOC `.cdb-*` (dropout banner) + `.ch-autopick-banner` styles.

### Phase 2A-F — vote reminders T-24h / T-3h / T-15m
- Scope decision at session entry: this slice carved out of 2A-D scope to keep that commit tight, then shipped as its own slice once 2A-D + 2A-E landed.
- Migration `0045_phase2a_vote_reminders.sql`:
  - `notification_kind` extended with `vote_reminder`.
  - Unique partial index `vote_reminder_unique_idx` on `(recipient_id, kind, payload->>'matchday_id', payload->>'reminder_kind') WHERE kind = 'vote_reminder'` for cron-retry idempotency.
  - 3 `app_settings` rows (`vote_reminder_24h_enabled` / `_3h_enabled` / `_15m_enabled`), all default `{"enabled": true}`. Each window flippable independently.
  - `enqueue_vote_reminders()` SECURITY DEFINER returning `int` (count of new rows inserted):
    - CTE 1 `windows` — cross-joins matchdays whose poll is still open + within 25h with the 3 window labels, computes `trigger_at = poll_closes_at - interval`.
    - CTE 2 `active_windows` — filters to `trigger_at <= now() AND trigger_at > now() - interval '10 minutes'` (10-min lookback so a 5-min cron tick can't miss any boundary) AND the corresponding `app_settings` flag is enabled.
    - CTE 3 `non_voters` — joins active profiles (not rejected, not soft-deleted, push_prefs.master + .vote_reminder both true via COALESCE default) LEFT JOIN poll_votes filtered to non-cancelled, takes rows where pv.id IS NULL.
    - INSERT INTO notifications with `ON CONFLICT DO NOTHING`.
  - pg_cron job `vote-reminders` scheduled `*/5 * * * *`.
- Targeting clarification: spec said "re-target poll_votes WHERE vote IS NULL" but `poll_votes.choice` is NOT NULL — there's no NULL state to filter on. Practical interpretation chosen: only reminds people who haven't cast any non-cancelled vote (no row OR all rows cancelled). People who explicitly said `no` or `maybe` are already engaged.
- `Settings.tsx` — extended `PushPrefs` interface with `vote_reminder`, `DEFAULT_PUSH_PREFS`, `normalisePushPrefs`, and `PUSH_EVENTS` array (label "Vote reminders (24h · 3h · 15m before close)"). Inserted between `poll_reminder` and `roster_locked` rows.
- `ffc/src/lib/notificationDeeplinks.ts` — added `vote_reminder: '/poll'` to the kind-default map. `sw.ts` already had this mapping from S048.

---

## Files Created or Modified

### Commit 1 — `7d82b6a` — push client + auth purge + Resend scaffold (12 files, +888/-18)
- `planning/FFC-masterplan-V3.0.md` — V3.0 backlog re-adds player analytics + H2H comparison
- `ffc/src/lib/env.d.ts` — typed `VITE_VAPID_PUBLIC_KEY`
- `ffc/src/lib/pushSubscribe.ts` NEW (~165 LOC)
- `ffc/src/components/IosInstallPrompt.tsx` NEW (~50 LOC)
- `ffc/src/index.css` — `.iip-*` scoped CSS appended
- `ffc/src/pages/Settings.tsx` — `handleMasterToggle` + state + import
- `supabase/migrations/0041_auth_purge_trigger.sql` NEW (~120 LOC)
- `supabase/migrations/0042_notify_signup_outcome_trigger.sql` NEW (~85 LOC)
- `supabase/functions/purge-deleted-auth-user/index.ts` NEW (~85 LOC)
- `supabase/functions/purge-deleted-auth-user/deno.json` NEW
- `supabase/functions/notify-signup-outcome/index.ts` NEW (~95 LOC)
- `supabase/functions/notify-signup-outcome/deno.json` NEW

### Commit 2 — `227f0f7` — 2A-D + 2A-E + SVG (14 files, +1037/-13)
- `shared/ffc-logo.svg` NEW (extracted from PDF via PyMuPDF)
- `ffc/public/ffc-logo.svg` NEW (copy for Vite serving)
- `ffc/src/pages/Login.tsx` — img src PNG → SVG
- `ffc/src/pages/Signup.tsx` — img src PNG → SVG
- `ffc/src/pages/ResetPassword.tsx` — img src PNG → SVG (×2)
- `ffc/src/pages/Matches.tsx` — splitc-logo PNG → SVG (×2)
- `supabase/migrations/0043_phase2a_auto_lock_and_captain_pick.sql` NEW (~280 LOC)
- `supabase/migrations/0044_auto_pick_inline_captain_update.sql` NEW (~85 LOC) — set_matchday_captains is_admin guard fix
- `ffc/src/components/CaptainDropoutBanner.tsx` NEW (~210 LOC)
- `ffc/src/pages/admin/CaptainHelper.tsx` — banner integration + autoPickedAt audit-log fetch + isPlainObject helper
- `ffc/src/lib/notificationDeeplinks.ts` — captain_auto_picked / captain_assigned / you_are_in
- `ffc/src/sw.ts` — mirrored deeplinks
- `ffc/src/lib/database.types.ts` — regenerated
- `ffc/src/index.css` — `.cdb-*` + `.ch-autopick-banner` CSS

### Commit 3 — `7a47dfd` — 2A-F vote reminders (4 files, +187)
- `supabase/migrations/0045_phase2a_vote_reminders.sql` NEW (~140 LOC)
- `ffc/src/pages/Settings.tsx` — `vote_reminder` push pref + label
- `ffc/src/lib/notificationDeeplinks.ts` — `vote_reminder: '/poll'`
- `ffc/src/lib/database.types.ts` — regenerated

---

## Key Decisions

- **Re-add player analytics + H2H to Phase 3 backlog** — not "Phase 4 Extras" (V3.0 has no Phase 4). Distinct from "Multi-season comparison stats" already on the list.
- **`promote_from_waitlist` collision** — kept existing S012 `(uuid, uuid)` admin overload, added new `(uuid)` captain-callable overload. Different arity = no PG conflict. Lowest regression risk vs. replacing.
- **Vote reminders deferred from 2A-D → carved out as 2A-F** — keeps 2A-D commit scope tight (auto-lock + dropout + auto-pick only), ships reminders as its own self-contained migration once 2A-D + 2A-E shipped.
- **In-app SVG swap scope** — auth screens + Matches splitc only. AppTopBar / RefLayout (32×32 + 192×192 sized PNGs) + PWA manifest icons + sw.ts push notification icons all stay PNG for safety / spec compliance.
- **Default `auto_pick_captains.enabled = true`** — admins who don't want it can flip; default-on means the rare matchday where no admin is around to set captains still gets a pair.
- **Vote reminder targeting: non-yes-voters only** — spec said `WHERE vote IS NULL` but `poll_votes.choice` is NOT NULL. People who said `no`/`maybe` are engaged enough; nagging is counterproductive.
- **EF deploy: project-wide `RESEND_API_KEY` via `secrets set`** — auto-injected to all functions. Only `notify-signup-outcome` reads it; project-wide is fine.

## Open Questions
- Live device acceptance for the entire S049 + S051 stack — needs iPhone PWA install + Chrome desktop session — Mohammed — When real Thursday lands.
- Resend custom sender domain (`NOTIFY_FROM` override) — defaults to `onboarding@resend.dev`. Worth verifying a custom domain in Resend later — Mohammed — When Possible.

## Lessons Learned

### Mistakes
| Date | Mistake | Root Cause | Prevention Rule |
|------|---------|------------|-----------------|
| 2026-04-28 | First draft of `auto_pick_captains_on_lock` called `set_matchday_captains` which has an `is_admin()` guard. Would have failed live: pg_cron runs without `auth.uid` → `current_profile_id()` returns NULL → `is_admin()` false → 42501. | Spec assumed the helper was service-role callable. Caught at design review by tracing the cron context's auth state, not by runtime. | **Before reusing an existing RPC inside a SECURITY DEFINER function called from pg_cron, audit the RPC's auth gates against a NULL `current_profile_id()`. If it requires a profile context, inline the work or write a service-role variant.** |
| 2026-04-28 | First draft of `pushSubscribe.urlBase64ToUint8Array` returned `Uint8Array` constructed inline; tsc rejected it as input to `PushManager.subscribe.applicationServerKey` because lib.dom expects `Uint8Array<ArrayBuffer>` not `Uint8Array<ArrayBufferLike>` (which can be `SharedArrayBuffer`). | Default `new Uint8Array(length)` returns `ArrayBufferLike`-typed under strict TypeScript 5.5+. | **Allocate the underlying `ArrayBuffer` explicitly when constructing typed-array inputs to lib.dom APIs that want `BufferSource`-strict types.** |
| 2026-04-28 | Spec for vote reminders said "re-target poll_votes WHERE vote IS NULL" — but `poll_votes.choice` is NOT NULL and the column is named `choice`, not `vote`. Two errors in a 12-word spec line. | Spec was written before the schema was finalised; never reconciled. | **Verify spec column names against `database.types.ts` before writing the SQL. Generalises CLAUDE.md operating rule #7 to spec-vs-schema drift.** |

### Validated Patterns
- [2026-04-28] **Two-bearer pattern reused 3× this session** (auth purge trigger 0041 + signup outcome trigger 0042 + auto-lock cron infrastructure) — Why: S048's notify-dispatch design (Vault `service_role_key` + `dispatch_shared_secret` + matching env vars on the EF + `Authorization: Bearer <jwt>` for the gateway + `X-Dispatch-Secret` for caller-auth) is now a **template**. Any future trigger-driven Edge Function gets it for free with a 30-line mod. Centralising the pattern in S048 paid off heavily this session.
- [2026-04-28] **PyMuPDF for PDF → SVG when the PDF is genuine vector** — Why: when `page.get_drawings()` returns paths and `page.get_images()` returns 0, `page.get_svg_image()` is a faithful 1:1 conversion, no auto-tracer needed. Avoids the "complex laurel-wreath logo by hand" trap. Generalises: probe a PDF before trying to trace a PNG of it.
- [2026-04-28] **Idempotent unique partial index for cron retry idempotency** — Why: `CREATE UNIQUE INDEX … (cols) WHERE kind = 'vote_reminder'` + `INSERT … ON CONFLICT DO NOTHING` lets a 5-min cron job overlap its own previous tick (10-min lookback for boundary safety) without inserting duplicates. The index encodes the dedupe rule alongside the data instead of in helper code.
- [2026-04-28] **`current_profile_id()` is NULL inside pg_cron** — Why: cron runs as the postgres superuser, no auth.uid context. Helpers that depend on `current_profile_id()` (like `is_admin()`, `is_captain_of()`) all return null/false in cron context. RPCs called from cron should never go through admin-guarded functions; either inline the work or write service-role-callable variants.
- [2026-04-28] **Audit log `payload.auto_picked: true` as the UI's auto-pick detector** — Why: simpler than a dedicated column on matchdays/matches. The UI queries the most recent `set_matchday_captains` audit entry; if `payload_jsonb->>'auto_picked' = 'true'` and no later admin override entry exists (latest entry wins), pill shows. When admin overrides via the manual flow, the new audit entry has no `auto_picked` flag → pill clears. Re-running the effect on `saving` toggle keeps the UI in sync.
- [2026-04-28] **Probe before trace** — checked `which pdftocairo pdf2svg inkscape potrace gs magick` to scope what tools were installed (none of the obvious vector tools were). Found `python` + `pip install pymupdf` was a 30-second pivot. Generalises: when a "trivial-but-blocked" task arrives, the first step is environment probe, not writing code that assumes a tool exists.

## Next Actions
- [ ] **Live device acceptance for entire S049 + S051 stack** — needs real Thursday. Owner: Mohammed.
- [ ] **Resend custom domain** (optional) — verify a domain in Resend, set `NOTIFY_FROM` env on the EF. Defers fine. Owner: Mohammed.
- [ ] **Phase 2 close-out** — when all 8 boxes in V3.0:122 tick on a single Thursday, open Phase 3 planning.

---

## Commits and Deploy
- **Commit 1:** `7d82b6a` — feat(s050): push client wiring + auth-purge EF + signup-outcome email scaffold (commit message used `(s050)` tag preceding the realisation that this is actually S051; the work itself is correctly captured here in S051's log)
- **Commit 2:** `227f0f7` — feat(s050,2): Phase 2A-D + 2A-E auto-lock + auto-pick + dropout banner + SVG crest
- **Commit 3:** `7a47dfd` — feat(s050,2a-f): vote reminders T-24h / T-3h / T-15m
- **Live:** https://ffc-gilt.vercel.app · `main` clean.
- **Migrations on live DB:** 45 (0001 → 0045). Up from 40 at session start.
- **pg_cron jobs live:** `auto-lock-matchdays` (`* * * * *`) · `vote-reminders` (`*/5 * * * *`).
- **EF deploys:** `purge-deleted-auth-user` · `notify-signup-outcome`. Both reuse existing S048 env (`LEGACY_SERVICE_ROLE_JWT` + `DISPATCH_SHARED_SECRET`); `notify-signup-outcome` also reads `RESEND_API_KEY` (set this session via `supabase secrets set`).

---
_Session logged: 2026-04-28 | Logged by: Claude (session-log skill) | Session051_
