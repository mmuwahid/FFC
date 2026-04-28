// supabase/functions/purge-deleted-auth-user/index.ts
// S050 — purges auth.users row + push_subscriptions for a soft-deleted profile.
//
// Trigger: profiles AFTER UPDATE of deleted_at (NULL → NOT NULL) calls this EF
// via pg_net with the OLD.auth_user_id captured before the RPC nulled the
// column. See migration 0041_auth_purge_trigger.sql.
//
// Auth model (mirrors notify-dispatch from S048):
//   * Authorization: Bearer <legacy-jwt>   — required by Supabase Functions gateway
//   * X-Dispatch-Secret: <shared-secret>   — caller auth inside the function
//
// Deletes from auth.users via the admin client (only it can call
// auth.admin.deleteUser). Also opportunistically prunes push_subscriptions for
// the same profile so notify-dispatch stops trying to reach the gone device.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
// Auto-injected SUPABASE_SERVICE_ROLE_KEY is the new sb_secret_* format which
// supabase-js does NOT accept for service-role operations. We use the legacy
// JWT stored in env LEGACY_SERVICE_ROLE_JWT instead. Same as notify-dispatch.
const LEGACY_SERVICE_ROLE_JWT = Deno.env.get('LEGACY_SERVICE_ROLE_JWT')!
const DISPATCH_SHARED_SECRET = Deno.env.get('DISPATCH_SHARED_SECRET')!

const sb = createClient(SUPABASE_URL, LEGACY_SERVICE_ROLE_JWT, {
  auth: { persistSession: false, autoRefreshToken: false },
})

interface PurgeRequest {
  auth_user_id: string
  profile_id: string
}

Deno.serve(async (req) => {
  // Caller auth (gateway already validated the bearer JWT before us).
  const dispatchSecret = req.headers.get('x-dispatch-secret') ?? ''
  if (dispatchSecret !== DISPATCH_SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let payload: PurgeRequest
  try {
    payload = await req.json()
    if (!payload.auth_user_id || !payload.profile_id) {
      throw new Error('missing auth_user_id or profile_id')
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: 'bad request', detail: String(e) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 1. Delete the auth.users row. Idempotent: if it's already gone, treat as success.
  const { error: authErr } = await sb.auth.admin.deleteUser(payload.auth_user_id)
  let authDeleted = !authErr
  if (authErr) {
    // 404 = already deleted; treat as idempotent success.
    const status = (authErr as { status?: number }).status
    if (status === 404) {
      authDeleted = true
    } else {
      console.error('purge-deleted-auth-user: auth.admin.deleteUser failed', {
        auth_user_id: payload.auth_user_id,
        profile_id: payload.profile_id,
        err: authErr,
      })
    }
  }

  // 2. Best-effort prune of push_subscriptions for this profile so that
  //    notify-dispatch stops fanning out to dead devices.
  const { count: pushDeleted, error: pushErr } = await sb
    .from('push_subscriptions')
    .delete({ count: 'exact' })
    .eq('profile_id', payload.profile_id)

  if (pushErr) {
    console.error('purge-deleted-auth-user: push_subscriptions prune failed', {
      profile_id: payload.profile_id,
      err: pushErr,
    })
  }

  return new Response(
    JSON.stringify({
      auth_deleted: authDeleted,
      push_subscriptions_deleted: pushDeleted ?? 0,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})
