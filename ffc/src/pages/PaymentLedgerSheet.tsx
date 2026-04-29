// ffc/src/pages/PaymentLedgerSheet.tsx
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'

interface LedgerRow {
  match_id: string
  match_number: number
  kickoff_at: string
  amount_aed: number
  paid_at: string | null
  window_open: boolean
}

interface Props {
  profileId?: string
  guestId?: string
  displayName: string
  seasonId: string
  isAdmin: boolean
  onClose: () => void
  onPaymentMarked: () => void
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('T')[0].split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d} ${months[parseInt(m, 10) - 1]} ${y}`
}

export default function PaymentLedgerSheet({
  profileId, guestId, displayName, seasonId, isAdmin, onClose, onPaymentMarked,
}: Props) {
  const [rows, setRows]       = useState<LedgerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const args = {
        p_season_id:  seasonId,
        p_profile_id: profileId ?? undefined,
        p_guest_id:   guestId   ?? undefined,
      }
      const { data } = await supabase
        .rpc('get_player_payment_ledger', args)
        .returns<LedgerRow[]>()
      if (!cancelled) {
        setRows(data ?? [])
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [profileId, guestId, seasonId])

  // Realtime subscription for this player's records
  useEffect(() => {
    const channel = supabase
      .channel(`ledger-${profileId ?? guestId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'match_payment_records',
        filter: profileId ? `profile_id=eq.${profileId}` : `guest_id=eq.${guestId}`,
      }, (payload) => {
        const updated = payload.new as { match_id: string; paid_at: string | null }
        setRows(prev => prev.map(r =>
          r.match_id === updated.match_id ? { ...r, paid_at: updated.paid_at } : r
        ))
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'payment_windows',
      }, (payload) => {
        const updated = payload.new as { match_id: string; closed_at: string | null }
        setRows(prev => prev.map(r =>
          r.match_id === updated.match_id ? { ...r, window_open: updated.closed_at == null } : r
        ))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profileId, guestId])

  // Close on ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const totalPaid   = rows.reduce((s, r) => s + (r.paid_at ? r.amount_aed : 0), 0)
  const totalOwed   = rows.reduce((s, r) => s + r.amount_aed, 0)
  const outstanding = totalOwed - totalPaid

  const latestRow = rows[0] ?? null

  async function handleMarkPaid(row: LedgerRow) {
    setBusy(row.match_id)
    setError(null)
    setRows(prev => prev.map(r =>
      r.match_id === row.match_id ? { ...r, paid_at: new Date().toISOString() } : r
    ))
    const { error: rpcErr } = profileId
      ? await supabase.rpc('mark_payment_paid', { p_match_id: row.match_id, p_profile_id: profileId })
      : await supabase.rpc('mark_guest_payment_paid', { p_match_id: row.match_id, p_guest_id: guestId! })
    if (rpcErr) {
      setRows(prev => prev.map(r =>
        r.match_id === row.match_id ? { ...r, paid_at: null } : r
      ))
      setError(rpcErr.message)
    } else {
      onPaymentMarked()
    }
    setBusy(null)
  }

  async function handleCloseWindow(matchId: string) {
    setBusy(matchId)
    setError(null)
    const { error: rpcErr } = await supabase.rpc('close_payment_window', { p_match_id: matchId })
    if (rpcErr) { setError(rpcErr.message) }
    else {
      setRows(prev => prev.map(r =>
        r.match_id === matchId ? { ...r, window_open: false } : r
      ))
    }
    setBusy(null)
  }

  async function handleReopenWindow(matchId: string) {
    setBusy(matchId)
    setError(null)
    const { error: rpcErr } = await supabase.rpc('reopen_payment_window', { p_match_id: matchId })
    if (rpcErr) { setError(rpcErr.message) }
    else {
      setRows(prev => prev.map(r =>
        r.match_id === matchId ? { ...r, window_open: true } : r
      ))
    }
    setBusy(null)
  }

  return createPortal(
    <>
      <button
        type="button"
        className="py-sheet-backdrop"
        onClick={onClose}
        aria-label="Close"
      />
      <div
        className="py-sheet"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${displayName} payment ledger`}
      >
        <div className="py-sheet-handle" />

        <div className="py-sheet-header">
          <span className="py-sheet-name">{displayName}</span>
          <button type="button" className="py-sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Summary strip */}
        <div className="py-sheet-summary">
          <div className="py-sbox">
            <div className="py-sbox-amt py-sbox-amt--paid">{totalPaid}</div>
            <div className="py-sbox-lbl">Paid</div>
          </div>
          <div className="py-sbox">
            <div className="py-sbox-amt py-sbox-amt--owed">{outstanding}</div>
            <div className="py-sbox-lbl">Owed</div>
          </div>
          <div className="py-sbox">
            <div className="py-sbox-amt py-sbox-amt--total">{rows.length}</div>
            <div className="py-sbox-lbl">Matches</div>
          </div>
        </div>

        {/* Match history */}
        <div className="py-ledger">
          {loading ? (
            <div className="py-loading">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-empty">No payment records.</div>
          ) : (
            rows.map(row => {
              const isPaid = row.paid_at != null
              const canMark = isAdmin && !isPaid && row.window_open && busy !== row.match_id
              return (
                <div
                  key={row.match_id}
                  className={`py-ledger-row ${isPaid ? 'py-ledger-row--paid' : 'py-ledger-row--unpaid'}`}
                >
                  <span className={`py-row-icon ${isPaid ? 'py-row-icon--paid' : 'py-row-icon--unpaid'}`}>
                    {isPaid ? '✓' : '✕'}
                  </span>
                  <span className="py-match-badge">M{row.match_number}</span>
                  <div className="py-row-info">
                    <div className="py-row-fee">{row.amount_aed} AED</div>
                    <div className="py-row-date">
                      {fmtDate(row.kickoff_at)} · {row.window_open ? 'Open' : 'Closed'}
                    </div>
                  </div>
                  {canMark && (
                    <button
                      type="button"
                      className="py-mark-btn"
                      onClick={() => handleMarkPaid(row)}
                      disabled={busy !== null}
                    >
                      Mark paid ✓
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Season total */}
        {!loading && rows.length > 0 && (
          <div className="py-total-bar">
            <span className="py-total-lbl">Season balance</span>
            <span className={`py-total-val ${outstanding === 0 ? 'py-total-val--zero' : 'py-total-val--owed'}`}>
              {outstanding === 0 ? '✓ 0 AED' : `−${outstanding} AED`}
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: '0 16px 8px', color: 'var(--danger)', fontSize: '0.7rem' }}>
            {error}
          </div>
        )}

        {/* Admin close/reopen strip — acts on the latest match window */}
        {isAdmin && !loading && latestRow && (
          <div className="py-admin-strip">
            {latestRow.window_open ? (
              <button
                type="button"
                className="py-admin-btn py-admin-btn--close"
                disabled={busy !== null}
                onClick={() => handleCloseWindow(latestRow.match_id)}
              >
                🔒 Close M{latestRow.match_number} window
              </button>
            ) : (
              <button
                type="button"
                className="py-admin-btn py-admin-btn--reopen"
                disabled={busy !== null}
                onClick={() => handleReopenWindow(latestRow.match_id)}
              >
                ↩ Override — reopen window
              </button>
            )}
          </div>
        )}
      </div>
    </>,
    document.body,
  )
}
