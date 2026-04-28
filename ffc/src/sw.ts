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
  captain_auto_picked: '/matchday',
  captain_assigned: '/matchday',
  you_are_in: '/poll',
}

function deeplinkFor(data: PushPayload): string {
  // Explicit deeplink wins if present.
  if (data.payload?.deeplink) return data.payload.deeplink
  // matchday-scoped captain flows + dropout → /matchday/:id/captains
  if (
    (data.kind === 'dropout_after_lock' ||
      data.kind === 'captain_auto_picked' ||
      data.kind === 'captain_assigned') &&
    data.payload?.matchday_id
  ) {
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
