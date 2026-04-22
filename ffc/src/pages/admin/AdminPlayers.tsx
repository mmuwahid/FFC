import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

/* §3.17 Admin Players — Pending tab (S019 scope).
 * Active + Rejected tabs are read-only stubs for now; full parity comes later.
 *
 * RPCs used:
 *   approve_signup(p_pending_id, p_claim_profile_id)  — p_claim != null = bind ghost
 *   reject_signup(p_pending_id, p_reason)
 */

type PendingRow = Database['public']['Tables']['pending_signups']['Row']
type ProfileLite = Pick<
  Database['public']['Tables']['profiles']['Row'],
  'id' | 'display_name' | 'role' | 'primary_position'
>
type Tab = 'pending' | 'active' | 'rejected'
type Sheet =
  | { kind: 'approve'; row: PendingRow; ghost: ProfileLite | null }
  | { kind: 'reject'; row: PendingRow }
  | null

export function AdminPlayers() {
  const [tab, setTab] = useState<Tab>('pending')
  const [pending, setPending] = useState<PendingRow[]>([])
  const [active, setActive] = useState<ProfileLite[]>([])
  const [rejected, setRejected] = useState<ProfileLite[]>([])
  const [ghostMap, setGhostMap] = useState<Record<string, ProfileLite>>({})
  const [loading, setLoading] = useState(true)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [sheetBusy, setSheetBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [pendingRes, activeRes, rejectedRes] = await Promise.all([
      supabase
        .from('pending_signups')
        .select('*')
        .eq('resolution', 'pending')
        .order('created_at'),
      supabase
        .from('profiles')
        .select('id, display_name, role, primary_position')
        .eq('is_active', true)
        .neq('role', 'rejected')
        .order('display_name'),
      supabase
        .from('profiles')
        .select('id, display_name, role, primary_position')
        .eq('role', 'rejected')
        .order('display_name'),
    ])
    if (pendingRes.error) setError(pendingRes.error.message)
    setPending(pendingRes.data ?? [])
    setActive(activeRes.data ?? [])
    setRejected(rejectedRes.data ?? [])

    // Resolve claim_profile_hint → ghost profile for the Approve sheet.
    const hintIds = (pendingRes.data ?? [])
      .map((r) => r.claim_profile_hint)
      .filter((x): x is string => !!x)
    if (hintIds.length) {
      const { data: hints } = await supabase
        .from('profiles')
        .select('id, display_name, role, primary_position')
        .in('id', hintIds)
      const map: Record<string, ProfileLite> = {}
      for (const h of hints ?? []) map[h.id] = h
      setGhostMap(map)
    } else {
      setGhostMap({})
    }
    setLoading(false)
  }, [])

  useEffect(() => { void loadAll() }, [loadAll])

  const openApprove = (row: PendingRow) => {
    const ghost = row.claim_profile_hint ? ghostMap[row.claim_profile_hint] ?? null : null
    setSheet({ kind: 'approve', row, ghost })
  }
  const openReject = (row: PendingRow) => {
    setRejectReason('')
    setSheet({ kind: 'reject', row })
  }
  const closeSheet = () => {
    if (sheetBusy) return
    setSheet(null)
  }

  const confirmApprove = async () => {
    if (!sheet || sheet.kind !== 'approve') return
    setSheetBusy(true)
    const { error: rpcError } = await supabase.rpc('approve_signup', {
      p_pending_id: sheet.row.id,
      p_claim_profile_id: sheet.row.claim_profile_hint ?? undefined,
    })
    setSheetBusy(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setSheet(null)
    await loadAll()
  }

  const confirmReject = async () => {
    if (!sheet || sheet.kind !== 'reject') return
    if (rejectReason.trim().length < 10) {
      setError('Reason must be at least 10 characters.')
      return
    }
    setSheetBusy(true)
    const { error: rpcError } = await supabase.rpc('reject_signup', {
      p_pending_id: sheet.row.id,
      p_reason: rejectReason.trim(),
    })
    setSheetBusy(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setSheet(null)
    await loadAll()
  }

  return (
    <section className="admin-players">
      <header className="admin-players-top">
        <h1>Admin · Players</h1>
      </header>

      <div className="admin-segments" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'active'}
          className={`admin-seg${tab === 'active' ? ' admin-seg--active' : ''}`}
          onClick={() => setTab('active')}
        >
          Active <span className="admin-seg-count">{active.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'pending'}
          className={`admin-seg${tab === 'pending' ? ' admin-seg--active' : ''}`}
          onClick={() => setTab('pending')}
        >
          Pending <span className="admin-seg-count">{pending.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'rejected'}
          className={`admin-seg${tab === 'rejected' ? ' admin-seg--active' : ''}`}
          onClick={() => setTab('rejected')}
        >
          Rejected <span className="admin-seg-count">{rejected.length}</span>
        </button>
      </div>

      {error && (
        <div className="auth-banner auth-banner--danger" role="alert" style={{ margin: '0 16px 12px' }}>
          <span className="auth-banner-icon" aria-hidden>!</span>
          <div>{error}</div>
        </div>
      )}

      {loading ? (
        <div className="app-loading">Loading…</div>
      ) : tab === 'pending' ? (
        pending.length === 0 ? (
          <div className="admin-empty">
            <div className="admin-empty-icon" aria-hidden>✓</div>
            <h4>All caught up</h4>
            <p>No pending signups right now.</p>
          </div>
        ) : (
          <ul className="pending-list">
            {pending.map((row) => {
              const ghost = row.claim_profile_hint ? ghostMap[row.claim_profile_hint] : null
              return (
                <li key={row.id} className="pending-row">
                  <div className="pending-row-avatar">
                    {row.display_name.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                  <div className="pending-row-meta">
                    <div className="pending-row-name-row">
                      <span className="pending-row-name">{row.display_name}</span>
                      <span className="chip chip-pending">pending</span>
                      {ghost ? (
                        <span className="chip chip-claim">claim</span>
                      ) : (
                        <span className="chip chip-new">new</span>
                      )}
                    </div>
                    <div className="pending-row-email">{row.email}</div>
                    {ghost ? (
                      <div className="pending-row-claim">
                        Wants to claim: <strong>{ghost.display_name}</strong>
                        {ghost.role !== 'player' && ` (${ghost.role.replace('_', '-')})`}
                      </div>
                    ) : row.message ? (
                      <div className="pending-row-info">"{row.message}"</div>
                    ) : null}
                    <div className="pending-row-actions">
                      <button
                        type="button"
                        className="auth-btn auth-btn--approve"
                        onClick={() => openApprove(row)}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="auth-btn auth-btn--reject-outline"
                        onClick={() => openReject(row)}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )
      ) : tab === 'active' ? (
        <ul className="admin-simple-list">
          {active.map((p) => (
            <li key={p.id} className="admin-simple-row">
              <span className="pending-row-avatar">
                {p.display_name.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase()}
              </span>
              <span className="admin-simple-name">{p.display_name}</span>
              {p.role !== 'player' && <span className="chip chip-role">{p.role.replace('_', '-')}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="admin-simple-list">
          {rejected.length === 0 ? (
            <li className="admin-simple-row admin-simple-row--empty">No rejected signups.</li>
          ) : (
            rejected.map((p) => (
              <li key={p.id} className="admin-simple-row">
                <span className="pending-row-avatar">
                  {p.display_name.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase()}
                </span>
                <span className="admin-simple-name">{p.display_name}</span>
                <span className="chip chip-new">rejected</span>
              </li>
            ))
          )}
        </ul>
      )}

      {/* ───── Bottom sheet ───── */}
      {sheet && (
        <div className="sheet-overlay" role="dialog" aria-modal onClick={closeSheet}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" aria-hidden />
            {sheet.kind === 'approve' ? (
              <>
                <h3>{sheet.ghost ? 'Approve claim?' : 'Approve new player?'}</h3>
                <p>
                  {sheet.ghost ? (
                    <>
                      Bind <strong>{sheet.row.email}</strong> to the existing ghost profile
                      {' '}<strong>{sheet.ghost.display_name}</strong>
                      {sheet.ghost.role !== 'player' && ` (${sheet.ghost.role.replace('_', '-')})`}.
                      This cannot be undone.
                    </>
                  ) : (
                    <>
                      Create a new profile for <strong>{sheet.row.display_name}</strong>
                      {' '}(<code>{sheet.row.email}</code>). They'll appear in the Active tab.
                    </>
                  )}
                </p>
                <div className="sheet-actions">
                  <button
                    type="button"
                    className="auth-btn auth-btn--sheet-cancel"
                    onClick={closeSheet}
                    disabled={sheetBusy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="auth-btn auth-btn--approve"
                    onClick={confirmApprove}
                    disabled={sheetBusy}
                  >
                    {sheetBusy ? 'Approving…' : 'Confirm approve'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3>Reject signup</h3>
                <p>
                  Rejecting <strong>{sheet.row.display_name}</strong>. Reason is logged to the audit trail.
                </p>
                <textarea
                  className="auth-input"
                  rows={3}
                  placeholder="Reason (min. 10 characters)…"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <p className="auth-hint">{rejectReason.trim().length} / 10 chars</p>
                <div className="sheet-actions">
                  <button
                    type="button"
                    className="auth-btn auth-btn--sheet-cancel"
                    onClick={closeSheet}
                    disabled={sheetBusy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="auth-btn auth-btn--reject-filled"
                    onClick={confirmReject}
                    disabled={sheetBusy || rejectReason.trim().length < 10}
                  >
                    {sheetBusy ? 'Rejecting…' : 'Confirm reject'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
