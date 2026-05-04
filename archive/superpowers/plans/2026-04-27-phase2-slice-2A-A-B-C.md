# Phase 2 Slice 2A-A/B/C — Push Notification Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the push delivery layer end-to-end so a `notifications` row inserted in Postgres results in a Web Push notification on the user's phone within ~2 seconds. Bundles slices 2A-A (table + trigger + delivered_at + publication-add), 2A-B (client subscribe/unsubscribe + iOS install gate + service worker push handler), and 2A-C (`notify-dispatch` Edge Function).

**Architecture:**
- New `push_subscriptions` table holds per-device subscription endpoints (Web Push API: `endpoint` + `p256dh` + `auth` keys). RLS-gated to own rows.
- `notifications` table extended with `delivered_at` for delivery tracking + future polling fallback.
- `pg_net` AFTER INSERT trigger on `notifications` POSTs row payload to a Supabase Edge Function `notify-dispatch`. Service-role JWT pulled from Supabase Vault.
- Edge Function fans out via `web-push` npm pkg to every subscription belonging to `recipient_id`. 410/404 endpoint responses delete the dead subscription row. Sets `delivered_at` after fan-out.
- Client: Settings master-toggle ON → iOS install gate → request permission → subscribe via `pushManager` → INSERT row. Master OFF → unsubscribe + DELETE row.
- Service worker: switch vite-plugin-pwa from `generateSW` to `injectManifest`, hand-write `sw.ts` with Workbox precache + `push` handler + `notificationclick` deeplink.

**Tech Stack:** Supabase (Postgres + RLS + pg_net + Vault + Edge Functions) · Deno + npm:web-push@3.6.7 in Edge Function · React 19 + TypeScript 6 + supabase-js · vite-plugin-pwa with `injectManifest` strategy + Workbox precaching · Web Push API (W3C) · VAPID key auth.

**Out of scope (deferred, NOT in this slice):**
- pg_cron polling fallback for missed notifications → slice 2A-D (bundled with auto-lock cron).
- Vote-reminder schedule (T-24h/T-3h/T-15min) → slice 2A-D.
- Auto-lock at deadline + `auto_lock_matchday` RPC → slice 2A-D.
- Captain auto-pick on lock → slice 2A-E.
- `dropout_after_lock` enum value → slice 2A-D.
- Realtime UI subscribers to `pending_match_entries` (the publication-add ships, but no client wiring this slice — see deferred backlog).
- Android device acceptance — user is on iPhone + Chrome desktop only.
- Push payload localisation, sound/vibration tuning, action buttons (e.g. "Vote Yes" inline). Pure default browser notification UI.

---

## Pre-flight (manual, one-time, BEFORE Task 1)

These steps do not produce git commits. They are bootstrap operations the user must run before code lands.

- [ ] **Generate VAPID key pair locally:** `npx web-push generate-vapid-keys`. Output is a JSON-shaped string with `publicKey` and `privateKey` (both URL-safe base64). Save both to a password manager — they are signing keys for push notifications.
- [ ] **Set Vercel env var** `VITE_VAPID_PUBLIC_KEY` to the public key, scope **Production + Preview + Development**. Trigger a redeploy or wait for the next push (env vars apply on next build).
- [ ] **Set Supabase Edge Function secrets** via dashboard or CLI:
  ```
  npx supabase secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT=mailto:m.muwahid@gmail.com
  ```
  Confirm via `npx supabase secrets list`.
- [ ] **Create Vault secret for service-role key.** In Supabase dashboard → Project Settings → API, copy the `service_role` JWT. In dashboard SQL editor:
  ```sql
  SELECT vault.create_secret('<service-role-jwt-here>', 'service_role_key', 'Used by notify_dispatch_trigger to authenticate to notify-dispatch Edge Function');
  ```
  Verify: `SELECT name FROM vault.decrypted_secrets WHERE name = 'service_role_key';` returns one row.
- [ ] **Confirm `pg_net` is allowed on the project's Supabase plan** (Free tier includes it). The migration enables the extension; this is a sanity-check that the dashboard doesn't block it.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/0034_phase2a_push_foundation.sql` | CREATE | `push_subscriptions` table + RLS + `notifications.delivered_at` + `notifications_undelivered_idx` + `ALTER PUBLICATION supabase_realtime ADD TABLE pending_match_entries` + `pg_net` extension + `notify_dispatch_trigger` function + AFTER INSERT trigger. |
| `supabase/functions/notify-dispatch/index.ts` | CREATE | Deno Edge Function. Receives notification row payload, fans out push via web-push to all push_subscriptions of recipient. Marks delivered_at. Deletes dead 410/404 subscriptions. |
| `supabase/functions/notify-dispatch/deno.json` | CREATE | Deno import map for `npm:web-push` + `@supabase/supabase-js`. |
| `ffc/src/lib/database.types.ts` | REGEN | Picks up new `push_subscriptions` table + `notifications.delivered_at`. |
| `ffc/vite.config.ts` | MODIFY | `strategies: 'generateSW'` → `'injectManifest'` + `srcDir: 'src'` + `filename: 'sw.ts'` + `injectManifest` config block. |
| `ffc/src/sw.ts` | CREATE | Service worker source. Workbox precache injection + `push` event handler + `notificationclick` handler with per-kind deeplink map. |
| `ffc/src/lib/pushSubscribe.ts` | CREATE | Helpers: `urlBase64ToUint8Array`, `subscribeAndPersist`, `unsubscribeAndDelete`, `isIosNonStandalone`. Keeps Settings.tsx focused. |
| `ffc/src/components/IosInstallPrompt.tsx` | CREATE | Single-screen modal portal: install instructions for iOS Safari users on first push enable. |
| `ffc/src/styles/ios-install-prompt.css` | CREATE | Brand-token-driven styles for the modal. ~50 LOC. |
| `ffc/src/pages/Settings.tsx` | MODIFY | Master-toggle handler extended: iOS gate → permission → subscribe → INSERT row (ON), or unsubscribe → DELETE row (OFF). Error toast on failure. |
| `ffc/.env.example` | MODIFY | Add `VITE_VAPID_PUBLIC_KEY=<paste-after-generate>` line for documentation. |
| `tasks/todo.md` | MODIFY | S048 close-out section. |
| `sessions/S048/session-log.md` | CREATE | Session log per CLAUDE.md convention. |
| `sessions/INDEX.md` | MODIFY | New entry for S048. |
| `CLAUDE.md` | MODIFY | Status line updates: migration count → 34, push delivery shipped, slice 2A foundation note. |

---

## Task 1: Migration 0034 — Push subscriptions + delivered_at + publication-add + pg_net trigger

**Why:** The persistence + delivery-trigger layer. Table holds endpoints; trigger calls Edge Function; delivered_at flag enables future polling fallback.

**Files:**
- Create: `supabase/migrations/0034_phase2a_push_foundation.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0034_phase2a_push_foundation.sql
-- Phase 2 Slice 2A foundation:
--   * push_subscriptions table (per-device Web Push endpoint storage)
--   * notifications.delivered_at column + partial index for undelivered
--   * pg_net AFTER INSERT trigger calling notify-dispatch Edge Function
--   * ALTER PUBLICATION supabase_realtime ADD TABLE pending_match_entries
--     (enables future client realtime subscribers; no UI wiring yet)
--
-- Pre-flight required: vault.create_secret('<service-role-jwt>', 'service_role_key')
-- has been run via dashboard. The trigger function reads the secret via
-- vault.decrypted_secrets at call time.

BEGIN;

-- === pg_net extension ===========================================
-- pg_net creates schema `net` and exposes net.http_post on Supabase.
-- Idempotent; if already installed in another schema (older projects),
-- the WITH SCHEMA clause is ignored — verify schema before use:
--   SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
--    WHERE e.extname = 'pg_net';
-- If schema differs, update v_url path / search_path in trigger fn.
CREATE EXTENSION IF NOT EXISTS pg_net;

-- === push_subscriptions table ===================================
CREATE TABLE public.push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint        text NOT NULL,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, endpoint)
);

CREATE INDEX push_subscriptions_profile_idx
  ON public.push_subscriptions (profile_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY push_subscriptions_select_own
  ON public.push_subscriptions FOR SELECT
  USING (profile_id = public.current_profile_id());

CREATE POLICY push_subscriptions_insert_own
  ON public.push_subscriptions FOR INSERT
  WITH CHECK (profile_id = public.current_profile_id());

CREATE POLICY push_subscriptions_delete_own
  ON public.push_subscriptions FOR DELETE
  USING (profile_id = public.current_profile_id());

-- Service role bypasses RLS — Edge Function reads/writes/deletes freely.
-- No UPDATE policy: rows are insert-or-delete; last_seen_at touched by
-- service-role from the Edge Function (e.g. on successful push fan-out).

-- === notifications.delivered_at =================================
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

CREATE INDEX IF NOT EXISTS notifications_undelivered_idx
  ON public.notifications (created_at)
  WHERE delivered_at IS NULL;

-- === Realtime publication: pending_match_entries =================
-- Enables future realtime subscribers (AdminMatches CTA + Settings badge).
-- Idempotent guard via DO block: ALTER PUBLICATION ADD TABLE errors if the
-- table is already a member.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pending_match_entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_match_entries;
  END IF;
END$$;

-- === notify_dispatch_trigger function ============================
-- Called AFTER INSERT on notifications. Reads the service-role JWT from
-- Vault, POSTs the new row to the notify-dispatch Edge Function URL.
-- Errors are logged but do not block the insert (RAISE NOTICE only).
CREATE OR REPLACE FUNCTION public.notify_dispatch_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, net, extensions, vault
AS $$
DECLARE
  v_url   text := 'https://hylarwwsedjxwavuwjrn.supabase.co/functions/v1/notify-dispatch';
  v_key   text;
BEGIN
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;

  IF v_key IS NULL THEN
    RAISE NOTICE 'notify_dispatch_trigger: vault secret service_role_key missing; skipping dispatch';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object('record', to_jsonb(NEW))::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_dispatch_trigger error: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_dispatch_trigger() FROM PUBLIC;
-- Trigger functions don't need GRANT EXECUTE; runs as SECURITY DEFINER
-- under the row-inserter's transaction.

DROP TRIGGER IF EXISTS notifications_dispatch_after_insert ON public.notifications;
CREATE TRIGGER notifications_dispatch_after_insert
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_dispatch_trigger();

COMMIT;
```

- [ ] **Step 2: Apply migration**
  ```
  cd "<repo-root>"
  npx supabase db push --linked
  ```
  Expect: `Applying migration 0034_phase2a_push_foundation.sql`. If apply fails because Vault secret isn't created, see pre-flight — the migration's RAISE NOTICE is a safe degradation, but applying without the secret means the trigger silently no-ops.

- [ ] **Step 3: Verify**
  ```
  npx supabase db query --linked --query "
    SELECT count(*) AS push_sub_count FROM public.push_subscriptions;
    SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='notifications' AND column_name='delivered_at';
    SELECT tablename FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND tablename='pending_match_entries';
    SELECT proname FROM pg_proc WHERE proname='notify_dispatch_trigger';
    SELECT tgname FROM pg_trigger WHERE tgname='notifications_dispatch_after_insert';
  "
  ```
  All five queries should return at least one row (or count=0 for the empty table).

- [ ] **Step 4: Regenerate types**
  ```
  npx supabase gen types typescript --linked 2>/dev/null > ffc/src/lib/database.types.ts
  ```
  Sanity-check: `wc -l ffc/src/lib/database.types.ts` should grow by ~30 lines (push_subscriptions Row/Insert/Update/Relationships + delivered_at on notifications).

- [ ] **Step 5: Commit**
  ```
  git add supabase/migrations/0034_phase2a_push_foundation.sql ffc/src/lib/database.types.ts
  git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
    commit -m "feat(s048,2a): migration 0034 push foundation + types regen"
  ```

---

## Task 2: notify-dispatch Edge Function

**Why:** Receives the trigger HTTP POST, fans out Web Push to every subscription belonging to `record.recipient_id`, marks `delivered_at`, prunes dead 410/404 endpoints.

**Files:**
- Create: `supabase/functions/notify-dispatch/index.ts`
- Create: `supabase/functions/notify-dispatch/deno.json`

- [ ] **Step 1: Write deno.json**

```json
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2",
    "web-push": "npm:web-push@3.6.7"
  }
}
```

- [ ] **Step 2: Write index.ts**

```typescript
// supabase/functions/notify-dispatch/index.ts
// Phase 2 Slice 2A-C — receives notification row from notify_dispatch_trigger,
// fans out Web Push via web-push lib to every push_subscription of recipient.
// 410/404 prune dead subscriptions; other errors log only (polling fallback
// in slice 2A-D will retry undelivered rows).

import { createClient } from '@supabase/supabase-js'
import webPush from 'web-push'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:m.muwahid@gmail.com'

webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

interface NotificationRow {
  id: string
  recipient_id: string
  kind: string
  title: string
  body: string
  payload: Record<string, unknown> | null
}

Deno.serve(async (req) => {
  // Auth check: trigger must present service-role bearer.
  const authHdr = req.headers.get('authorization') ?? ''
  if (!authHdr.startsWith('Bearer ') || authHdr.slice(7) !== SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let record: NotificationRow
  try {
    const json = await req.json()
    record = json.record
    if (!record?.id || !record?.recipient_id) {
      throw new Error('missing record.id or record.recipient_id')
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: 'bad request', detail: String(e) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: subs, error: subErr } = await sb
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('profile_id', record.recipient_id)

  if (subErr) {
    console.error('notify-dispatch: failed to load subs', subErr)
    return new Response(JSON.stringify({ error: 'sub query failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const payload = JSON.stringify({
    title: record.title,
    body: record.body,
    kind: record.kind,
    payload: record.payload ?? {},
  })

  let dispatched = 0
  let failed = 0
  let deletedInvalid = 0

  await Promise.allSettled(
    (subs ?? []).map(async (sub) => {
      try {
        await webPush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 3600 }
        )
        dispatched++
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          // Subscription gone → delete the row.
          await sb.from('push_subscriptions').delete().eq('id', sub.id)
          deletedInvalid++
        } else {
          console.error('notify-dispatch: send failed', { sub_id: sub.id, status, err })
          failed++
        }
      }
    })
  )

  // Mark delivered_at if at least one push attempt was made.
  // Polling fallback (slice 2A-D) will retry rows where delivered_at IS NULL.
  if (dispatched > 0 || deletedInvalid > 0) {
    await sb
      .from('notifications')
      .update({ delivered_at: new Date().toISOString() })
      .eq('id', record.id)
  }

  return new Response(
    JSON.stringify({ dispatched, failed, deleted_invalid: deletedInvalid }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
```

- [ ] **Step 3: Deploy**
  ```
  npx supabase functions deploy notify-dispatch
  ```
  Expect: `Function notify-dispatch deployed at https://hylarwwsedjxwavuwjrn.supabase.co/functions/v1/notify-dispatch`.

- [ ] **Step 4: Verify deploy + auth gate**
  ```
  curl -i https://hylarwwsedjxwavuwjrn.supabase.co/functions/v1/notify-dispatch \
    -H "Content-Type: application/json" \
    -d '{}'
  # Expected: 401 unauthorized

  curl -i https://hylarwwsedjxwavuwjrn.supabase.co/functions/v1/notify-dispatch \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
    -d '{"record":{"id":"00000000-0000-0000-0000-000000000000","recipient_id":"00000000-0000-0000-0000-000000000000","kind":"test","title":"x","body":"y","payload":null}}'
  # Expected: 200 {"dispatched":0,"failed":0,"deleted_invalid":0}
  # (No subs for fake recipient → empty fan-out.)
  ```

- [ ] **Step 5: Commit**
  ```
  git add supabase/functions/notify-dispatch/
  git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
    commit -m "feat(s048,2a): notify-dispatch Edge Function with web-push fan-out"
  ```

---

## Task 3: vite-plugin-pwa strategy switch + service worker source

**Why:** `generateSW` cannot inject custom logic. Switch to `injectManifest` so we can hand-write the `push` and `notificationclick` handlers while keeping Workbox precaching for offline / cache-busting.

**Files:**
- Modify: `ffc/vite.config.ts`
- Create: `ffc/src/sw.ts`

- [ ] **Step 1: Confirm current `generateSW` config**

```
grep -n "VitePWA\|strategies\|registerType\|workbox\|injectManifest" ffc/vite.config.ts
```

Capture the current options object — we preserve manifest, registerType, and the dev options block; only the strategy + sources change.

- [ ] **Step 2: Modify `vite.config.ts`**

Switch the VitePWA call:
- Add `srcDir: 'src'`
- Add `filename: 'sw.ts'`
- Replace `strategies: 'generateSW'` with `strategies: 'injectManifest'`
- Add `injectManifest: { swSrc: 'src/sw.ts', swDest: 'dist/sw.js', globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'] }`
- Remove any `workbox` block (it's `generateSW`-only)

Keep `manifest`, `registerType`, `devOptions` (if present).

- [ ] **Step 3: Write `ffc/src/sw.ts`**

```typescript
// ffc/src/sw.ts
// Phase 2 Slice 2A-B — service worker source.
// vite-plugin-pwa with injectManifest strategy precaches the build manifest
// here at build time. We extend with push + notificationclick handlers.

/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

// === Precache (auto-injected by vite-plugin-pwa) ==========
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// === Lifecycle ============================================
self.addEventListener('install', () => {
  // Activate the new SW immediately on update.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// === Push handler =========================================
interface PushPayload {
  title: string
  body: string
  kind: string
  payload?: { deeplink?: string; matchday_id?: string; match_id?: string }
}

const DEFAULT_DEEPLINK: Record<string, string> = {
  poll_open: '/poll',
  vote_reminder: '/poll',
  roster_locked: '/poll',
  teams_posted: '/poll',
  result_posted: '/matches',
  motm_announced: '/matches',
  dropout_after_lock: '/matchday', // appended by handler if matchday_id present
}

function deeplinkFor(data: PushPayload): string {
  // Explicit deeplink wins if present.
  if (data.payload?.deeplink) return data.payload.deeplink
  // dropout_after_lock → /matchday/:id/captains
  if (data.kind === 'dropout_after_lock' && data.payload?.matchday_id) {
    return `/matchday/${data.payload.matchday_id}/captains`
  }
  // motm_announced / result_posted with match_id → /match/:id
  if ((data.kind === 'result_posted' || data.kind === 'motm_announced') && data.payload?.match_id) {
    return `/match/${data.payload.match_id}`
  }
  return DEFAULT_DEEPLINK[data.kind] ?? '/'
}

self.addEventListener('push', (event) => {
  let data: PushPayload
  try {
    data = (event.data?.json() as PushPayload) ?? { title: 'FFC', body: '', kind: 'unknown' }
  } catch {
    data = { title: 'FFC', body: 'You have a new update', kind: 'unknown' }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/ffc-logo-192.png',
      badge: '/ffc-logo-32.png',
      tag: data.kind, // collapses repeated reminders of the same kind
      data: { url: deeplinkFor(data) },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an existing tab on the same origin if present.
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url).catch(() => {})
          return (client as WindowClient).focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
```

- [ ] **Step 4: Install `workbox-precaching` dependency**

```
cd ffc
npm install --save-dev workbox-precaching
```

`generateSW` strategy bundles workbox internally; `injectManifest` requires the user to import precache primitives explicitly. Verify with `node -e "console.log(require('workbox-precaching/package.json').version)"`.

- [ ] **Step 5: Build verification**

```
cd ffc
node ./node_modules/typescript/bin/tsc -b
node ./node_modules/vite/bin/vite.js build
```

Expect: tsc EXIT 0; vite build EXIT 0; output should mention `dist/sw.js` (the compiled SW). The PWA precache count should be similar to the prior generateSW build (~11 entries); workbox-window's `register` should still detect updates. Verify the built SW contains `__WB_MANIFEST` (replaced at build time): `grep "self.__WB_MANIFEST" ffc/dist/sw.js | head -1`.

- [ ] **Step 6: Commit**
  ```
  git add ffc/vite.config.ts ffc/src/sw.ts ffc/package.json ffc/package-lock.json
  git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
    commit -m "feat(s048,2a): switch PWA to injectManifest + sw.ts with push handler"
  ```

---

## Task 4: pushSubscribe lib + IosInstallPrompt component

**Why:** Keep `Settings.tsx` focused. The Web Crypto + iOS detection + supabase-js INSERT/DELETE plumbing is reusable infra; the modal is a new UI surface.

**Files:**
- Create: `ffc/src/lib/pushSubscribe.ts`
- Create: `ffc/src/components/IosInstallPrompt.tsx`
- Create: `ffc/src/styles/ios-install-prompt.css`

- [ ] **Step 1: Write `pushSubscribe.ts`**

```typescript
// ffc/src/lib/pushSubscribe.ts
// Phase 2 Slice 2A-B — Web Push subscription helpers.

import { supabase } from './supabase'

// Decode a URL-safe base64 VAPID public key into Uint8Array (W3C Push spec).
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Std = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64Std)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function isIosNonStandalone(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  const ua = navigator.userAgent
  const isIos = /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream
  if (!isIos) return false
  const matchStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false
  const legacyStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true
  return !(matchStandalone || legacyStandalone)
}

export async function subscribeAndPersist(profileId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!vapidKey) return { ok: false, reason: 'VAPID public key missing in env' }

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'Push not supported on this device' }
  }

  try {
    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    const sub = existing
      ?? (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      }))

    const json = sub.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { ok: false, reason: 'Subscription missing required keys' }
    }

    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          profile_id: profileId,
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          user_agent: navigator.userAgent,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'profile_id,endpoint', ignoreDuplicates: false }
      )

    if (error) return { ok: false, reason: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

export async function unsubscribeAndDelete(profileId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!('serviceWorker' in navigator)) return { ok: true }
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    const endpoint = sub?.endpoint
    if (sub) await sub.unsubscribe()
    if (endpoint) {
      const { error } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('profile_id', profileId)
        .eq('endpoint', endpoint)
      if (error) return { ok: false, reason: error.message }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
```

- [ ] **Step 2: Write `IosInstallPrompt.tsx`**

```tsx
// ffc/src/components/IosInstallPrompt.tsx
// Phase 2 Slice 2A-B — iOS install instructions modal.
// Shown when a user toggles push ON on iOS Safari without standalone install.

import { createPortal } from 'react-dom'
import '../styles/ios-install-prompt.css'

interface Props {
  onDismiss: () => void
}

export function IosInstallPrompt({ onDismiss }: Props) {
  return createPortal(
    <div className="ios-install-overlay" role="dialog" aria-modal="true" aria-labelledby="ios-install-title">
      <div className="ios-install-sheet">
        <button
          type="button"
          className="ios-install-close"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          ×
        </button>
        <h2 id="ios-install-title" className="ios-install-title">Install FFC to enable push</h2>
        <p className="ios-install-intro">
          iOS only delivers push notifications to apps installed on your home screen.
          Two taps and you're set:
        </p>
        <ol className="ios-install-steps">
          <li>
            <strong>Tap the Share button</strong> in Safari's bottom toolbar
            (the square with the up-arrow).
          </li>
          <li>
            <strong>Scroll down + tap "Add to Home Screen"</strong>, then Add.
          </li>
          <li>
            Open FFC from your home screen, return to Settings, and toggle push
            again.
          </li>
        </ol>
        <button type="button" className="ios-install-ok" onClick={onDismiss}>
          Got it
        </button>
      </div>
    </div>,
    document.body
  )
}
```

- [ ] **Step 3: Write `ios-install-prompt.css`**

Brand-token-driven. Scope under `.ios-install-overlay`. Tokens: `--bg`, `--surface`, `--text`, `--text-muted`, `--accent`, `--gold`, `--danger`. Sheet bottom-anchored on mobile, dialog-centered on desktop. Backdrop blur. ~80 LOC. Mirror existing `.sheet*` styles for consistency.

- [ ] **Step 4: Build verification**

```
cd ffc
node ./node_modules/typescript/bin/tsc -b
node ./node_modules/vite/bin/vite.js build
```

EXIT 0 on both.

- [ ] **Step 5: Commit**
  ```
  git add ffc/src/lib/pushSubscribe.ts ffc/src/components/IosInstallPrompt.tsx ffc/src/styles/ios-install-prompt.css
  git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
    commit -m "feat(s048,2a): pushSubscribe lib + IosInstallPrompt component"
  ```

---

## Task 5: Wire master-toggle in Settings.tsx

**Why:** The existing master pill toggle currently only requests permission and writes `push_prefs.master`. Extend it to actually subscribe / unsubscribe + persist + iOS gate.

**Files:**
- Modify: `ffc/src/pages/Settings.tsx`

- [ ] **Step 1: Read existing master-toggle handler**

Identify the function that runs when the master pill changes (around line 290 per earlier grep). Capture its current shape: `Notification.requestPermission()` call + `push_prefs.master` write.

- [ ] **Step 2: Extend the handler**

Pseudo-flow:

```
async function handleMasterToggle(nextOn: boolean) {
  setMasterBusy(true)
  setMasterError(null)
  try {
    if (nextOn) {
      if (isIosNonStandalone()) {
        setIosInstallOpen(true)
        return // Master stays OFF until they install + try again.
      }
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setMasterError('Notifications are blocked. Enable in browser settings.')
        return
      }
      const result = await subscribeAndPersist(profile.id)
      if (!result.ok) {
        setMasterError(`Subscribe failed: ${result.reason}`)
        return
      }
      const nextPrefs = { ...profile.push_prefs, master: true }
      setProfile({ ...profile, push_prefs: nextPrefs })
      await patchProfile({ push_prefs: nextPrefs as unknown as never })
    } else {
      const result = await unsubscribeAndDelete(profile.id)
      if (!result.ok) {
        // Best-effort; even if delete fails, flip the pref OFF locally.
        console.warn('unsubscribe partial failure:', result.reason)
      }
      const nextPrefs = { ...profile.push_prefs, master: false }
      setProfile({ ...profile, push_prefs: nextPrefs })
      await patchProfile({ push_prefs: nextPrefs as unknown as never })
    }
  } finally {
    setMasterBusy(false)
  }
}
```

Add state: `masterBusy`, `masterError`, `iosInstallOpen`. Render `<IosInstallPrompt onDismiss={() => setIosInstallOpen(false)} />` conditionally. Render `masterError` inline below the master pill if non-null.

- [ ] **Step 3: Wire imports**

```typescript
import { isIosNonStandalone, subscribeAndPersist, unsubscribeAndDelete } from '../lib/pushSubscribe'
import { IosInstallPrompt } from '../components/IosInstallPrompt'
```

- [ ] **Step 4: Test locally**

```
cd ffc
node ./node_modules/typescript/bin/tsc -b
```

EXIT 0. Then manual flow on dev server:
1. Start dev: `node ./node_modules/vite/bin/vite.js`
2. Open http://localhost:5174 in Chrome desktop, sign in.
3. Open Settings, toggle master ON. Permission prompt appears, accept. Verify the row appears via Supabase dashboard (Table Editor → push_subscriptions).
4. Toggle OFF. Verify row deletes.

- [ ] **Step 5: Commit**
  ```
  git add ffc/src/pages/Settings.tsx
  git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
    commit -m "feat(s048,2a): wire push subscribe/unsubscribe + iOS gate in Settings master toggle"
  ```

---

## Task 6: End-to-end verification on production

**Why:** Slice acceptance gate. Real device, real push.

- [ ] **Step 1: Push to main + verify Vercel deploy**
  ```
  git push origin main
  ```
  Wait for Vercel deploy to complete (Vercel MCP `list_deployments` to confirm READY). Run a hard-refresh on https://ffc-gilt.vercel.app to pick up the new SW.

- [ ] **Step 2: Chrome desktop subscription**
  - Open prod URL, sign in as super_admin (m.muwahid@gmail.com).
  - DevTools → Application → Service Workers, confirm new SW activated.
  - Settings → toggle master ON.
  - DevTools → Application → Service Workers → Push button, OR run from Supabase dashboard SQL editor:
    ```sql
    INSERT INTO public.notifications (recipient_id, kind, title, body, payload)
    VALUES ('cce905a8-...super-admin-uuid...', 'roster_locked', 'Test push', 'Hello from S048', '{"deeplink":"/poll"}'::jsonb);
    ```
  - Expect: Chrome notification appears within 2s. Tap → opens /poll.
  - Verify Edge Function logs in Supabase dashboard (Functions → notify-dispatch → Logs). Should show 200 with `{dispatched:1}`.

- [ ] **Step 3: iPhone non-standalone (install gate)**
  - Open prod URL in Safari iOS. Sign in.
  - Settings → toggle master ON.
  - Expect: IosInstallPrompt modal renders with the 3-step instructions. Master pill stays OFF.
  - Dismiss. Master remains OFF.

- [ ] **Step 4: iPhone standalone (full install + push)**
  - Tap Share → Add to Home Screen. Open from home screen icon.
  - Sign in. Settings → toggle master ON.
  - Permission prompt appears, accept.
  - Verify row in push_subscriptions (one for desktop endpoint, one for iPhone endpoint).
  - Insert another notification row from SQL editor (or just re-trigger), verify iPhone receives push.
  - Tap notification → app opens at /poll.

- [ ] **Step 5: 410 Gone path (best-effort)**

Faking a stale endpoint reliably is hard — you cannot reconstruct the p256dh/auth pair after `unsubscribe()`. Three options to exercise the prune branch:

  **Option A (preferred):** clear browser site data via DevTools → Application → Storage → Clear site data, then re-trigger a push targeting the OLD recipient_id. The Edge Function will hit a 410 since the SW registration is gone, and the prune branch fires.

  **Option B (acceptable substitute):** observe the natural pruning over time as devices uninstall the PWA or revoke permissions. Check `push_subscriptions` row count after a week.

  **Option C (skip):** mark this step as deferred to slice 2A-D acceptance. The code path is straightforward and tested by `web-push` library upstream; not strictly required for slice 2A close.

If A succeeds: Expect Edge Function logs to show `deleted_invalid: 1` and the row to be gone from the DB.

- [ ] **Step 6: Acceptance pass**

All four criteria met:
- ✅ Real device receives push from manually-inserted notifications row
- ✅ iOS install prompt renders for non-standalone Safari
- ✅ Master OFF removes row + unsubscribes
- ✅ `notifications.delivered_at` populated by Edge Function

---

## Task 7: Close-out

- [ ] **Step 1: Update tasks/todo.md**

Replace the "## NEXT SESSION — S048" block with "## Completed in S048 (27/APR/2026)" summarising shipped scope. Add new "## NEXT SESSION — S049" block at top.

S049 candidate agenda:
- Live device acceptance for 2B-B/C/D/E/F chain (real Thursday) — accumulated from S047/S048.
- Phase 2A continuation: slice 2A-D (auto-lock + dropout_after_lock + Captain Helper banner + pg_cron polling fallback fold-in).
- Realtime subscribers wiring on AdminMatches CTA + Settings badge (publication add already shipped in 0034).
- Push payload polish: per-kind icons, action buttons (e.g. "Vote yes" inline), payload-driven badge counts.

- [ ] **Step 2: Update sessions/INDEX.md** with S048 entry (one paragraph + tip-pointer).

- [ ] **Step 3: Write sessions/S048/session-log.md** per CLAUDE.md convention.

- [ ] **Step 4: Update CLAUDE.md status line** — migration count → 34, mention S048 push delivery foundation shipped, key patterns added.

- [ ] **Step 5: Final commit + push**
  ```
  git add tasks/todo.md sessions/INDEX.md sessions/S048/session-log.md CLAUDE.md
  git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
    commit -m "docs(s048): close-out — session log + INDEX + CLAUDE.md status + todo S049 prep"
  git push origin main
  ```

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Vault secret not created → trigger silently no-ops | Pre-flight checklist + `RAISE NOTICE` in trigger function for grep-able log signal. Verify after migration apply with `SELECT name FROM vault.decrypted_secrets`. |
| `pg_net.http_post` blocked on Free tier | Verify the `net.http_post` function exists post-migration: `SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.proname='http_post' AND n.nspname='net';`. If missing, fall back to a Postgres webhook configured via Supabase dashboard (Database → Webhooks) pointing at Edge Function URL. |
| `injectManifest` switch breaks PWA precache / update flow | Keep workbox-window registration in `main.tsx` unchanged; precacheAndRoute(self.__WB_MANIFEST) reproduces generateSW's precache. Verify build output dist/sw.js contains `__WB_MANIFEST`. Test update flow by deploying twice and confirming the new SW takes over after a refresh. |
| iOS PWA push reliability (historic flakiness) | Out of our control; documented in masterplan risks. We ship the install gate; iOS Safari's push delivery is what it is. Polling fallback in slice 2A-D will catch missed pushes. |
| VAPID key leak | Public key is intentionally exposed (`VITE_*` is shipped to client). Private key is Supabase secret only — not in git, not in client bundle. Document key rotation procedure in next slice if compromise detected. |
| Multiple devices / Chrome profiles | UNIQUE (profile_id, endpoint) lets the same profile have multiple rows (one per device). Edge Function fans out to all. Tested in verification step 4. |
| Service worker cache eats new bundles | `cleanupOutdatedCaches()` in sw.ts; `registerType: 'autoUpdate'` in vite.config (preserved from generateSW config); `self.skipWaiting()` + `clients.claim()` for fast activation. |

---

## Acceptance criteria for slice close

All items in Task 6 ticked:
- [ ] Chrome desktop: subscribe → DB row visible → manual notifications insert → push received within 2s → tap deeplinks correctly
- [ ] iPhone Safari non-standalone: master ON triggers install prompt; master stays OFF; dismiss works
- [ ] iPhone PWA installed: subscribe → DB row visible (separate from desktop row) → push received → tap deeplinks correctly
- [ ] Master OFF: unsubscribe call succeeds + DB row deleted
- [ ] 410 path: best-effort verified (Option A) OR acknowledged as deferred to slice 2A-D acceptance
- [ ] Edge Function logs show clean dispatched / deleted_invalid counts; no 5xx
- [ ] Build clean: `tsc -b` EXIT 0 + `vite build` EXIT 0 throughout
- [ ] All commits pushed to origin/main; Vercel deploy READY

When all 8 boxes tick, slice 2A-A/B/C is closed and slice 2A-D opens.
