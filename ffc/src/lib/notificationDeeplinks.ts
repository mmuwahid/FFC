import type { Database } from './database.types'

type NotificationKind = Database['public']['Enums']['notification_kind']
type Json = Database['public']['Tables']['notifications']['Row']['payload']

/* S049 — central in-app deeplink mapping for notifications.
 *
 * sw.ts has its own copy of this map for service-worker push handling
 * (it can't import from the app bundle since service workers compile
 * separately under tsconfig.sw.json). When you change a kind here,
 * mirror it in src/sw.ts:DEFAULT_DEEPLINK / deeplinkFor() too.
 */

const DEFAULT_BY_KIND: Partial<Record<NotificationKind, string>> = {
  poll_open: '/poll',
  poll_reminder: '/poll',
  vote_reminder: '/poll',
  roster_locked: '/poll',
  teams_posted: '/poll',
  plus_one_unlocked: '/poll',
  plus_one_slot_taken: '/poll',
  match_entry_submitted: '/admin',
  match_entry_approved: '/matches',
  match_entry_rejected: '/poll',
  signup_approved: '/poll',
  signup_rejected: '/login',
  admin_promoted: '/admin',
  season_archived: '/leaderboard',
  draft_reroll_started: '/poll',
  reroll_triggered_by_opponent: '/poll',
  captain_dropout_needs_replacement: '/poll',
  captain_auto_picked: '/poll',     // overridden by payload deeplink in payload-key block
  captain_assigned: '/poll',
  you_are_in: '/poll',
  formation_reminder: '/poll',
  formation_shared: '/poll',
  // S058 #23
  matchday_created: '/admin/matches',
  ranking_changed: '/leaderboard',
  dropout_after_lock: '/poll', // listed for completeness; payload override below
}

export function deeplinkForNotification(kind: NotificationKind, payload: Json): string {
  const p = isObject(payload) ? payload : null
  // Explicit deeplink in payload wins.
  const explicit = p && typeof p['deeplink'] === 'string' ? (p['deeplink'] as string) : null
  if (explicit) return explicit
  // Kind-specific overrides that need a payload id.
  if (kind === 'dropout_after_lock' && p && typeof p['matchday_id'] === 'string') {
    return `/matchday/${p['matchday_id']}/captains`
  }
  if (kind === 'captain_auto_picked' && p && typeof p['matchday_id'] === 'string') {
    return `/matchday/${p['matchday_id']}/captains`
  }
  if (kind === 'captain_assigned' && p && typeof p['matchday_id'] === 'string') {
    // Captain lands on Captain Helper to confirm + plan formation.
    return `/matchday/${p['matchday_id']}/captains`
  }
  if (kind === 'match_entry_approved' && p && typeof p['match_id'] === 'string') {
    return `/match/${p['match_id']}`
  }
  if (kind === 'formation_shared' && p && typeof p['match_id'] === 'string') {
    return `/match/${p['match_id']}/formation`
  }
  return DEFAULT_BY_KIND[kind] ?? '/'
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}
