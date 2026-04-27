// supabase/functions/notify-dispatch/index.ts
// Phase 2 Slice 2A-C — receives notification row from notify_dispatch_trigger,
// fans out Web Push via web-push lib to every push_subscription of recipient.
// 410/404 prune dead subscriptions; other errors log only (polling fallback
// in slice 2A-D will retry undelivered rows).
//
// Auth model (S048): the Supabase Functions gateway requires a bearer JWT
// (legacy anon or service_role) just to reach this code, so the trigger
// MUST send Authorization: Bearer <legacy-service_role-jwt>. That JWT is
// stored in Vault as 'service_role_key' and read by the trigger.
//
// Once we're in the function, we authenticate the CALLER independently of
// the gateway via a shared secret in X-Dispatch-Secret. The shared secret
// is in Vault as 'dispatch_shared_secret' (read by trigger) and in this
// function's env as DISPATCH_SHARED_SECRET. This decouples function-level
// auth from Supabase's two-key system (legacy JWT vs new sb_secret_*).

import { createClient } from '@supabase/supabase-js'
import webPush from 'web-push'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
// Note: Supabase auto-injects SUPABASE_SERVICE_ROLE_KEY as the new-style
// sb_secret_* key, which the supabase-js client does not accept for
// service-role connections. We use a separately-configured env var
// LEGACY_SERVICE_ROLE_JWT (legacy JWT format, set by hand) for createClient.
const LEGACY_SERVICE_ROLE_JWT = Deno.env.get('LEGACY_SERVICE_ROLE_JWT')!
const DISPATCH_SHARED_SECRET = Deno.env.get('DISPATCH_SHARED_SECRET')!
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:m.muwahid@gmail.com'

webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

const sb = createClient(SUPABASE_URL, LEGACY_SERVICE_ROLE_JWT, {
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
  // Auth check: caller must present DISPATCH_SHARED_SECRET in X-Dispatch-Secret.
  // The Supabase gateway has already validated the bearer JWT before we run.
  const dispatchSecret = req.headers.get('x-dispatch-secret') ?? ''
  if (dispatchSecret !== DISPATCH_SHARED_SECRET) {
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
