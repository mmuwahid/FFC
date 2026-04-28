// ffc/src/components/CaptainDropoutBanner.tsx
// Phase 2A-D Captain Helper banner (S050).
//
// Subscribes to realtime INSERTs on `notifications` for the current user and
// surfaces dropout_after_lock notifications scoped to a single matchday.
// Two flavours based on payload.was_captain:
//   * regular dropout  → [PROMOTE FROM WAITLIST]
//   * captain dropout  → [ROLL FOR NEW CAPTAIN] (via existing S037 request_reroll)
//
// pre-req: notifications is in supabase_realtime publication (S048 mig 0038).

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface DropoutEntry {
  id: string
  matchday_id: string
  cancelled_profile_id: string
  was_captain: boolean
  created_at: string
}

interface CaptainDropoutBannerProps {
  matchdayId: string
  currentUserId: string
  onPromoted?: () => void
  onRerollRequested?: () => void
}

function timeAgo(iso: string): string {
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60) return `${sec}s ago`
  const mins = Math.round(sec / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  return `${hrs}h ago`
}

export function CaptainDropoutBanner({
  matchdayId,
  currentUserId,
  onPromoted,
  onRerollRequested,
}: CaptainDropoutBannerProps) {
  // Stack so multiple dropouts queue rather than clobber each other.
  const [pending, setPending] = useState<DropoutEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  // Initial fetch — most recent unread dropout_after_lock notifications for this matchday.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('notifications')
        .select('id, kind, payload, created_at, read_at')
        .eq('recipient_id', currentUserId)
        .eq('kind', 'dropout_after_lock')
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(20)
      if (cancelled || !data) return
      const matched: DropoutEntry[] = []
      for (const r of data) {
        const p = isObject(r.payload) ? r.payload : null
        const md = p && typeof p['matchday_id'] === 'string' ? (p['matchday_id'] as string) : null
        const cancelledId =
          p && typeof p['cancelled_profile_id'] === 'string'
            ? (p['cancelled_profile_id'] as string)
            : null
        if (md !== matchdayId || !cancelledId) continue
        matched.push({
          id: r.id,
          matchday_id: md,
          cancelled_profile_id: cancelledId,
          was_captain: !!(p && p['was_captain']),
          created_at: r.created_at,
        })
      }
      setPending(matched)
    })()
    return () => {
      cancelled = true
    }
  }, [currentUserId, matchdayId])

  // Realtime: append new dropout_after_lock rows for this user + this matchday.
  useEffect(() => {
    const channel = supabase
      .channel(`captain-dropout-${matchdayId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${currentUserId}` },
        (payload) => {
          const r = payload.new as Record<string, unknown>
          if (r.kind !== 'dropout_after_lock') return
          const p = isObject(r.payload) ? r.payload : null
          const md = p && typeof p['matchday_id'] === 'string' ? (p['matchday_id'] as string) : null
          const cancelledId =
            p && typeof p['cancelled_profile_id'] === 'string'
              ? (p['cancelled_profile_id'] as string)
              : null
          if (md !== matchdayId || !cancelledId) return
          setPending((prev) => [
            {
              id: r.id as string,
              matchday_id: md,
              cancelled_profile_id: cancelledId,
              was_captain: !!(p && p['was_captain']),
              created_at: r.created_at as string,
            },
            ...prev,
          ])
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [currentUserId, matchdayId])

  // Names lookup for cancelled profiles.
  const [nameById, setNameById] = useState<Record<string, string>>({})
  useEffect(() => {
    const ids = Array.from(new Set(pending.map((d) => d.cancelled_profile_id)))
      .filter((id) => !nameById[id])
    if (ids.length === 0) return
    ;(async () => {
      const { data } = await supabase.from('profiles').select('id, display_name').in('id', ids)
      if (!data) return
      const next = { ...nameById }
      for (const row of data) next[row.id] = row.display_name
      setNameById(next)
    })()
  }, [pending, nameById])

  const visible = pending.filter((d) => !dismissed.has(d.id))
  const head = visible[0]

  const handlePromote = useCallback(async () => {
    if (!head || busy) return
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('promote_from_waitlist', {
      p_matchday_id: head.matchday_id,
    })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    // Mark this dropout notification read so it doesn't reappear on refresh.
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', head.id)
    if (data) {
      const promotedName = await fetchName(data as string)
      setToast(promotedName ? `${promotedName} promoted.` : 'Promoted from waitlist.')
    } else {
      setToast('Waitlist is empty — no one to promote.')
    }
    setDismissed((s) => new Set([...s, head.id]))
    onPromoted?.()
    setTimeout(() => setToast(null), 4000)
  }, [head, busy, onPromoted])

  const handleReroll = useCallback(async () => {
    if (!head || busy) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('request_reroll', {
      p_matchday_id: head.matchday_id,
    })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', head.id)
    setToast('Reroll started.')
    setDismissed((s) => new Set([...s, head.id]))
    onRerollRequested?.()
    setTimeout(() => setToast(null), 4000)
  }, [head, busy, onRerollRequested])

  if (!head) {
    return toast ? <div className="cdb-toast">{toast}</div> : null
  }

  const dropoutName = nameById[head.cancelled_profile_id] ?? 'A player'

  return (
    <div className="cdb-banner" role="alert">
      <div className="cdb-row">
        <span className="cdb-icon" aria-hidden>
          ⚠
        </span>
        <span className="cdb-text">
          <strong>{dropoutName}</strong>
          {head.was_captain ? ' (was captain)' : ''} cancelled · {timeAgo(head.created_at)}
        </span>
      </div>
      {error && <div className="cdb-error">{error}</div>}
      <div className="cdb-actions">
        {head.was_captain ? (
          <button
            type="button"
            className="cdb-btn cdb-btn-primary"
            onClick={() => void handleReroll()}
            disabled={busy}
          >
            {busy ? 'Working…' : 'Roll for new captain'}
          </button>
        ) : (
          <button
            type="button"
            className="cdb-btn cdb-btn-primary"
            onClick={() => void handlePromote()}
            disabled={busy}
          >
            {busy ? 'Working…' : 'Promote from waitlist'}
          </button>
        )}
        <button
          type="button"
          className="cdb-btn cdb-btn-ghost"
          onClick={() => setDismissed((s) => new Set([...s, head.id]))}
          disabled={busy}
        >
          Dismiss
        </button>
      </div>
      {visible.length > 1 && (
        <div className="cdb-stack-hint">{visible.length - 1} more pending</div>
      )}
      {toast && <div className="cdb-toast">{toast}</div>}
    </div>
  )
}

async function fetchName(id: string): Promise<string | null> {
  const { data } = await supabase.from('profiles').select('display_name').eq('id', id).maybeSingle()
  return data?.display_name ?? null
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}
