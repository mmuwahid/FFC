import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { deeplinkForNotification } from '../lib/notificationDeeplinks'
import type { Database } from '../lib/database.types'

/* S049 — bell-driven notifications panel. Slides down from the top.
 *
 * Lists the 50 most recent notifications for the signed-in player.
 * Tap a notification → marks read + deeplinks via deeplinkForNotification().
 * "Mark all read" link in the header empties the unread badge.
 *
 * Realtime subscription on `notifications` (added to supabase_realtime in
 * migration 0038) bumps the unread count + prepends new rows live.
 */

type NotificationRow = Database['public']['Tables']['notifications']['Row']
type NotificationKind = Database['public']['Enums']['notification_kind']

interface Props {
  open: boolean
  onClose: () => void
  /** Profile id of the signed-in user; null = signed out / pending. */
  profileId: string | null
  /** Bumped by RoleLayout's realtime subscription whenever a row inserts. */
  refreshKey: number
  /** Called whenever local state has changed (mark read / mark all). */
  onChanged: () => void
}

export function NotificationsPanel({ open, onClose, profileId, refreshKey, onChanged }: Props) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actBusy, setActBusy] = useState(false)

  // Lock scroll + ESC close
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  // Load notifications when panel opens or realtime tick arrives
  useEffect(() => {
    if (!open || !profileId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      const { data, error: err } = await supabase
        .from('notifications')
        .select('*')
        .eq('recipient_id', profileId)
        .order('created_at', { ascending: false })
        .limit(50)
      if (cancelled) return
      if (err) {
        setError("Couldn't load notifications.")
      } else {
        setRows(data ?? [])
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [open, profileId, refreshKey])

  async function handleTap(row: NotificationRow) {
    if (!row.read_at) {
      // Optimistic: mark in-place
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, read_at: new Date().toISOString() } : r))
      const { error: err } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', row.id)
      if (err) {
        // Revert on failure
        setRows(prev => prev.map(r => r.id === row.id ? { ...r, read_at: null } : r))
      } else {
        onChanged()
      }
    }
    onClose()
    const path = deeplinkForNotification(row.kind as NotificationKind, row.payload)
    if (path) navigate(path)
  }

  async function handleMarkAllRead() {
    if (!profileId || actBusy) return
    setActBusy(true)
    const now = new Date().toISOString()
    // Optimistic
    setRows(prev => prev.map(r => r.read_at ? r : { ...r, read_at: now }))
    const { error: err } = await supabase
      .from('notifications')
      .update({ read_at: now })
      .eq('recipient_id', profileId)
      .is('read_at', null)
    setActBusy(false)
    if (!err) onChanged()
  }

  if (!open) return null

  const unreadCount = rows.filter(r => !r.read_at).length

  return createPortal(
    <div className="app-notif-root" role="dialog" aria-modal="true" aria-label="Notifications">
      <button
        type="button"
        className="app-notif-backdrop"
        onClick={onClose}
        aria-label="Close notifications"
      />
      <div className="app-notif-panel">
        <div className="app-notif-header">
          <div className="app-notif-title">Notifications</div>
          {unreadCount > 0 && (
            <button
              type="button"
              className="app-notif-mark-all"
              onClick={handleMarkAllRead}
              disabled={actBusy}
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="app-notif-list">
          {loading && <div className="app-notif-empty">Loading…</div>}
          {error && <div className="app-notif-error">{error}</div>}
          {!loading && !error && rows.length === 0 && (
            <div className="app-notif-empty">No notifications yet.</div>
          )}
          {rows.map(row => (
            <button
              key={row.id}
              type="button"
              className={`app-notif-item ${row.read_at ? 'app-notif-item--read' : 'app-notif-item--unread'}`}
              onClick={() => handleTap(row)}
            >
              <span className="app-notif-item-ico" aria-hidden>{iconForKind(row.kind as NotificationKind)}</span>
              <span className="app-notif-item-body">
                <span className="app-notif-item-title">{row.title}</span>
                <span className="app-notif-item-text">{row.body}</span>
                <span className="app-notif-item-time">{relativeTime(row.created_at)}</span>
              </span>
              {!row.read_at && <span className="app-notif-item-dot" aria-hidden />}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function iconForKind(kind: NotificationKind): string {
  // Mirror the rough categories in src/sw.ts deeplink map; pure presentational.
  switch (kind) {
    case 'poll_open':
    case 'poll_reminder':
      return '🗳️'
    case 'roster_locked':
    case 'teams_posted':
    case 'plus_one_unlocked':
    case 'plus_one_slot_taken':
      return '🔒'
    case 'match_entry_submitted':
    case 'match_entry_approved':
    case 'match_entry_rejected':
      return '⚽'
    case 'signup_approved':
    case 'signup_rejected':
    case 'admin_promoted':
      return '🪪'
    case 'season_archived':
      return '🏁'
    case 'dropout_after_lock':
    case 'captain_dropout_needs_replacement':
      return '⚠️'
    case 'draft_reroll_started':
    case 'reroll_triggered_by_opponent':
      return '🔄'
    case 'formation_reminder':
    case 'formation_shared':
      return '📋'
    default:
      return '🔔'
  }
}

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.max(0, now - then)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}
