// ffc/src/lib/pushSubscribe.ts
// Phase 2 Slice 2A-B Task 4 — push subscription client wiring (S050).
//
// Owns the lifecycle for Web Push subscriptions:
//   • subscribeAndPersist  — request endpoint from PushManager + upsert push_subscriptions row
//   • unsubscribeAndDelete — drop the local PushSubscription + delete the row
//
// Caller (Settings master toggle) is responsible for the surrounding flow:
//   - iOS-non-standalone gate (use isIosNonStandalone() to decide whether to show the install prompt instead)
//   - Notification.requestPermission()
//   - Updating profiles.push_prefs.master after subscribe/unsubscribe succeeds
//
// Why this lives client-side: VAPID public key is exposed to the browser (it's the
// applicationServerKey passed to PushManager.subscribe). Server holds the matching
// private key for signing fan-out from notify-dispatch. See migrations 0034–0036.

import { supabase } from './supabase'

export type PushOpResult =
  | { ok: true }
  | { ok: false; reason: string }

// ===== utilities ============================================================

/**
 * W3C URL-safe base64 → Uint8Array. PushManager.subscribe needs the raw key bytes.
 * VAPID public keys arrive base64url-encoded ("-_"), browsers want standard padding.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalised)
  // Allocate a fresh ArrayBuffer (not ArrayBufferLike) so PushManager.subscribe
  // accepts it as applicationServerKey under TS lib.dom strict typings.
  const buffer = new ArrayBuffer(raw.length)
  const out = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/**
 * iOS Safari only honours Web Push when the PWA is installed (Add to Home Screen).
 * Returns true if the UA is iPhone/iPad/iPod AND the page is NOT running in
 * standalone mode — i.e. we should block the master toggle and show the install prompt.
 *
 * Three signals (any one false → not-iOS-non-standalone):
 *   1. UA contains iPhone/iPad/iPod (or iPad masquerading as Mac with touch)
 *   2. matchMedia('(display-mode: standalone)') returns false
 *   3. legacy navigator.standalone (iOS Safari only) is not true
 */
export function isIosNonStandalone(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  const ua = navigator.userAgent
  // iPad on iPadOS 13+ reports MacIntel + touch instead of iPad in UA.
  const isiPadMasquerade =
    ua.includes('Macintosh') && navigator.maxTouchPoints > 1
  const isIOS = /iPhone|iPad|iPod/.test(ua) || isiPadMasquerade
  if (!isIOS) return false
  const mqStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches
  // navigator.standalone is iOS-Safari-specific and not in the standard typings.
  const legacyStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  return !mqStandalone && !legacyStandalone
}

// ===== subscription lifecycle ==============================================

async function getReadySwReg(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.ready
  } catch {
    return null
  }
}

/**
 * Subscribe the browser via PushManager and persist endpoint+keys to push_subscriptions.
 * Idempotent: if a PushSubscription already exists for this browser, reuses it.
 * Caller must have already obtained Notification.permission === 'granted'.
 */
export async function subscribeAndPersist(profileId: string): Promise<PushOpResult> {
  if (typeof window === 'undefined' || !('PushManager' in window)) {
    return { ok: false, reason: 'Push not supported by this browser.' }
  }
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!vapidKey) {
    return { ok: false, reason: 'VAPID public key not configured.' }
  }
  const swReg = await getReadySwReg()
  if (!swReg) {
    return { ok: false, reason: 'Service worker not ready.' }
  }

  let sub: PushSubscription | null
  try {
    sub = await swReg.pushManager.getSubscription()
    if (!sub) {
      sub = await swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      })
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Subscribe failed.' }
  }

  // Extract p256dh + auth keys from the JSON form of the subscription.
  // toJSON returns a plain object with base64url-encoded keys.
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  const endpoint = json.endpoint ?? sub.endpoint
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!endpoint || !p256dh || !auth) {
    return { ok: false, reason: 'Subscription missing endpoint or keys.' }
  }

  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        profile_id: profileId,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'profile_id,endpoint' },
    )
  if (error) {
    return { ok: false, reason: error.message }
  }
  return { ok: true }
}

/**
 * Unsubscribe the browser from PushManager AND delete the matching row.
 * Best-effort: if the local subscription is already gone we still try to clean up the row.
 */
export async function unsubscribeAndDelete(profileId: string): Promise<PushOpResult> {
  const swReg = await getReadySwReg()
  let endpoint: string | null = null
  if (swReg) {
    try {
      const sub = await swReg.pushManager.getSubscription()
      if (sub) {
        endpoint = sub.endpoint
        try {
          await sub.unsubscribe()
        } catch {
          // Ignore — we still want to drop the server row.
        }
      }
    } catch {
      // Ignore — proceed with row delete.
    }
  }

  const query = supabase.from('push_subscriptions').delete().eq('profile_id', profileId)
  const { error } = endpoint ? await query.eq('endpoint', endpoint) : await query
  if (error) {
    return { ok: false, reason: error.message }
  }
  return { ok: true }
}
