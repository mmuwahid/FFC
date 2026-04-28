import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/AppContext'
import type { Database } from '../../lib/database.types'

/* §3.17 Admin Players — full Depth-B (S025 slice).
 *
 * Tabs:
 *   • Active   — role IN ('player','admin','super_admin'), is_active=true. Tap row → edit sheet.
 *   • Pending  — pending_signups rows (existing approve/reject flow).
 *   • Banned   — profiles with active player_bans row.
 *   • Rejected — role='rejected'. Reinstate button.
 *
 * RPCs:
 *   approve_signup · reject_signup · update_player_profile ·
 *   ban_player · unban_player · reinstate_rejected
 */

type Position = Database['public']['Enums']['player_position']
type UserRole = Database['public']['Enums']['user_role']

type PendingRow = Database['public']['Tables']['pending_signups']['Row']
type ProfileRow = Pick<
  Database['public']['Tables']['profiles']['Row'],
  'id' | 'display_name' | 'email' | 'role' | 'primary_position' | 'secondary_position' | 'is_active' | 'reject_reason'
>
type BanRow = Database['public']['Tables']['player_bans']['Row']

interface ProfileWithBan extends ProfileRow {
  active_ban?: BanRow | null
}

type Tab = 'active' | 'pending' | 'banned' | 'rejected'

type Sheet =
  | { kind: 'approve'; row: PendingRow; ghost: ProfileRow | null }
  | { kind: 'reject'; row: PendingRow }
  | { kind: 'edit'; profile: ProfileRow }
  | { kind: 'ban'; profile: ProfileRow }
  | { kind: 'unban'; profile: ProfileRow }
  | { kind: 'reinstate'; profile: ProfileRow }
  | { kind: 'delete'; profile: ProfileRow }
  | null

const POSITIONS: Position[] = ['GK', 'DEF', 'CDM', 'W', 'ST']
const POS_LABEL: Record<Position, string> = { GK: 'GK', DEF: 'DEF', CDM: 'CDM', W: 'Winger', ST: 'Striker' }

function initials(name: string): string {
  return name.split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

function toISOEnd(daysAhead: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  d.setHours(23, 59, 59, 0)
  return d.toISOString()
}

function dateLabel(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
}

export function AdminPlayers() {
  const { role } = useApp()
  const isSuperAdmin = role === 'super_admin'

  const [tab, setTab] = useState<Tab>('pending')
  const [pending, setPending] = useState<PendingRow[]>([])
  const [active, setActive] = useState<ProfileWithBan[]>([])
  const [banned, setBanned] = useState<ProfileWithBan[]>([])
  const [rejected, setRejected] = useState<ProfileRow[]>([])
  const [ghostMap, setGhostMap] = useState<Record<string, ProfileRow>>({})
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [sheetBusy, setSheetBusy] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    const selectCols = 'id, display_name, email, role, primary_position, secondary_position, is_active, reject_reason'
    const [pendingRes, profilesRes, bansRes] = await Promise.all([
      supabase.from('pending_signups').select('*').eq('resolution', 'pending').order('created_at'),
      supabase.from('profiles').select(selectCols).neq('role', 'rejected').order('display_name'),
      supabase.from('player_bans').select('*').is('revoked_at', null).gt('ends_at', new Date().toISOString()),
    ])
    if (pendingRes.error) setError(pendingRes.error.message)
    if (profilesRes.error) setError(profilesRes.error.message)

    const bans = bansRes.data ?? []
    const banByProfile = new Map<string, BanRow>()
    for (const b of bans) banByProfile.set(b.profile_id, b)

    const profiles = (profilesRes.data ?? []) as ProfileRow[]
    const withBans: ProfileWithBan[] = profiles.map((p) => ({ ...p, active_ban: banByProfile.get(p.id) ?? null }))

    setPending(pendingRes.data ?? [])
    setActive(withBans.filter((p) => !p.active_ban))
    setBanned(withBans.filter((p) => !!p.active_ban))

    const { data: rejectedData } = await supabase
      .from('profiles').select(selectCols).eq('role', 'rejected').order('display_name')
    setRejected((rejectedData ?? []) as ProfileRow[])

    // Resolve claim hints for Pending approval sheet
    const hintIds = (pendingRes.data ?? [])
      .map((r) => r.claim_profile_hint)
      .filter((x): x is string => !!x)
    if (hintIds.length) {
      const { data: hints } = await supabase.from('profiles').select(selectCols).in('id', hintIds)
      const map: Record<string, ProfileRow> = {}
      for (const h of (hints ?? []) as ProfileRow[]) map[h.id] = h
      setGhostMap(map)
    } else {
      setGhostMap({})
    }

    setLoading(false)
  }, [])

  useEffect(() => { void loadAll() }, [loadAll])

  // Client-side filter by search (display_name or email).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return { active, banned, rejected }
    const match = (p: ProfileRow) =>
      p.display_name.toLowerCase().includes(q) || (p.email ?? '').toLowerCase().includes(q)
    return {
      active: active.filter(match),
      banned: banned.filter(match),
      rejected: rejected.filter(match),
    }
  }, [search, active, banned, rejected])

  const openApprove = (row: PendingRow) => {
    const ghost = row.claim_profile_hint ? ghostMap[row.claim_profile_hint] ?? null : null
    setSheet({ kind: 'approve', row, ghost })
  }
  const openReject = (row: PendingRow) => setSheet({ kind: 'reject', row })
  const openEdit = (profile: ProfileRow) => setSheet({ kind: 'edit', profile })
  const openBan = (profile: ProfileRow) => setSheet({ kind: 'ban', profile })
  const openUnban = (profile: ProfileRow) => setSheet({ kind: 'unban', profile })
  const openReinstate = (profile: ProfileRow) => setSheet({ kind: 'reinstate', profile })
  const openDelete = (profile: ProfileRow) => setSheet({ kind: 'delete', profile })
  const closeSheet = () => { if (!sheetBusy) setSheet(null) }

  return (
    <section className="admin-players">
      <header className="admin-players-top">
        <h1>Admin · Players</h1>
      </header>

      <div className="admin-segments" role="tablist">
        {(['active','pending','banned','rejected'] as Tab[]).map((t) => {
          const count =
            t === 'active' ? active.length :
            t === 'pending' ? pending.length :
            t === 'banned' ? banned.length : rejected.length
          return (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`admin-seg${tab === t ? ' admin-seg--active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t[0].toUpperCase() + t.slice(1)}
              <span className="admin-seg-count">{count}</span>
            </button>
          )
        })}
      </div>

      <div className="admin-search-wrap">
        <input
          type="search"
          className="auth-input"
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
        <PendingList
          rows={pending}
          ghostMap={ghostMap}
          onApprove={openApprove}
          onReject={openReject}
        />
      ) : tab === 'active' ? (
        <ActiveList rows={filtered.active} onEdit={openEdit} onBan={openBan} isSuperAdmin={isSuperAdmin} />
      ) : tab === 'banned' ? (
        <BannedList rows={filtered.banned} onUnban={openUnban} />
      ) : (
        <RejectedList rows={filtered.rejected} onReinstate={openReinstate} />
      )}

      {sheet && (
        <div className="sheet-overlay" role="dialog" aria-modal onClick={closeSheet}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" aria-hidden />
            {sheet.kind === 'approve' && (
              <ApproveSheet
                row={sheet.row}
                ghost={sheet.ghost}
                busy={sheetBusy}
                setBusy={setSheetBusy}
                onDone={async () => { setSheet(null); await loadAll() }}
                onError={setError}
                onCancel={closeSheet}
              />
            )}
            {sheet.kind === 'reject' && (
              <RejectSheet
                row={sheet.row}
                busy={sheetBusy}
                setBusy={setSheetBusy}
                onDone={async () => { setSheet(null); await loadAll() }}
                onError={setError}
                onCancel={closeSheet}
              />
            )}
            {sheet.kind === 'edit' && (
              <EditSheet
                profile={sheet.profile}
                isSuperAdmin={isSuperAdmin}
                busy={sheetBusy}
                setBusy={setSheetBusy}
                onDone={async () => { setSheet(null); await loadAll() }}
                onError={setError}
                onCancel={closeSheet}
                onDelete={() => openDelete(sheet.profile)}
              />
            )}
            {sheet.kind === 'delete' && (
              <DeletePlayerSheet
                profile={sheet.profile}
                busy={sheetBusy}
                setBusy={setSheetBusy}
                onDone={async () => { setSheet(null); await loadAll() }}
                onError={setError}
                onCancel={closeSheet}
              />
            )}
            {sheet.kind === 'ban' && (
              <BanSheet
                profile={sheet.profile}
                busy={sheetBusy}
                setBusy={setSheetBusy}
                onDone={async () => { setSheet(null); await loadAll() }}
                onError={setError}
                onCancel={closeSheet}
              />
            )}
            {sheet.kind === 'unban' && (
              <SimpleConfirmSheet
                title={`Unban ${sheet.profile.display_name}?`}
                body="They'll be reactivated and can vote on the next poll."
                confirmLabel="Confirm unban"
                busy={sheetBusy}
                onConfirm={async () => {
                  setSheetBusy(true)
                  const { error: e } = await supabase.rpc('unban_player', { p_profile_id: sheet.profile.id })
                  setSheetBusy(false)
                  if (e) { setError(e.message); return }
                  setSheet(null)
                  await loadAll()
                }}
                onCancel={closeSheet}
              />
            )}
            {sheet.kind === 'reinstate' && (
              <SimpleConfirmSheet
                title={`Reinstate ${sheet.profile.display_name}?`}
                body="Role flips rejected → player, reject_reason is cleared, and the account is reactivated."
                confirmLabel="Confirm reinstate"
                busy={sheetBusy}
                onConfirm={async () => {
                  setSheetBusy(true)
                  const { error: e } = await supabase.rpc('reinstate_rejected', { p_profile_id: sheet.profile.id })
                  setSheetBusy(false)
                  if (e) { setError(e.message); return }
                  setSheet(null)
                  await loadAll()
                }}
                onCancel={closeSheet}
              />
            )}
          </div>
        </div>
      )}
    </section>
  )
}

// ────────────────────────────────────────────────────────────────
// Lists
// ────────────────────────────────────────────────────────────────

function PendingList({
  rows, ghostMap, onApprove, onReject,
}: {
  rows: PendingRow[]
  ghostMap: Record<string, ProfileRow>
  onApprove: (r: PendingRow) => void
  onReject: (r: PendingRow) => void
}) {
  if (rows.length === 0) {
    return (
      <div className="admin-empty">
        <div className="admin-empty-icon" aria-hidden>✓</div>
        <h4>All caught up</h4>
        <p>No pending signups right now.</p>
      </div>
    )
  }
  return (
    <ul className="pending-list">
      {rows.map((row) => {
        const ghost = row.claim_profile_hint ? ghostMap[row.claim_profile_hint] : null
        return (
          <li key={row.id} className="pending-row">
            <div className="pending-row-avatar">{initials(row.display_name)}</div>
            <div className="pending-row-meta">
              <div className="pending-row-name-row">
                <span className="pending-row-name">{row.display_name}</span>
                <span className="chip chip-pending">pending</span>
                {ghost ? <span className="chip chip-claim">claim</span> : <span className="chip chip-new">new</span>}
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
                <button type="button" className="auth-btn auth-btn--approve" onClick={() => onApprove(row)}>Approve</button>
                <button type="button" className="auth-btn auth-btn--reject-outline" onClick={() => onReject(row)}>Reject</button>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function ActiveList({
  rows, onEdit, onBan,
}: {
  rows: ProfileWithBan[]
  onEdit: (p: ProfileRow) => void
  onBan: (p: ProfileRow) => void
  isSuperAdmin: boolean
}) {
  if (rows.length === 0) {
    return <div className="admin-empty"><div className="admin-empty-icon" aria-hidden>∅</div><h4>No active players</h4></div>
  }
  return (
    <ul className="admin-simple-list">
      {rows.map((p) => (
        <li key={p.id} className="admin-row">
          <button type="button" className="admin-row-main" onClick={() => onEdit(p)}>
            <span className="pending-row-avatar">{initials(p.display_name)}</span>
            <div className="admin-simple-body">
              <div className="admin-simple-name-row">
                <span className="admin-simple-name">{p.display_name}</span>
                {p.role !== 'player' && <span className="chip chip-role">{p.role.replace('_', '-')}</span>}
                {!p.is_active && <span className="chip chip-inactive">inactive</span>}
              </div>
              {(p.primary_position || p.secondary_position) && (
                <div className="admin-simple-positions">
                  {p.primary_position && <span className="ap-pos ap-pos-primary">{p.primary_position}</span>}
                  {p.secondary_position && <span className="ap-pos ap-pos-secondary">{p.secondary_position}</span>}
                </div>
              )}
            </div>
          </button>
          <button
            type="button"
            className="admin-row-action"
            title="Ban player"
            onClick={(e) => { e.stopPropagation(); onBan(p) }}
          >
            🚫
          </button>
        </li>
      ))}
    </ul>
  )
}

function BannedList({ rows, onUnban }: { rows: ProfileWithBan[]; onUnban: (p: ProfileRow) => void }) {
  if (rows.length === 0) {
    return <div className="admin-empty"><div className="admin-empty-icon" aria-hidden>🚫</div><h4>No active bans</h4></div>
  }
  return (
    <ul className="admin-simple-list">
      {rows.map((p) => (
        <li key={p.id} className="admin-row">
          <div className="admin-row-main admin-row-main--static">
            <span className="pending-row-avatar">{initials(p.display_name)}</span>
            <div className="admin-simple-body">
              <div className="admin-simple-name-row">
                <span className="admin-simple-name">{p.display_name}</span>
                <span className="chip chip-banned">banned</span>
              </div>
              {p.active_ban && (
                <>
                  <div className="admin-simple-reason">"{p.active_ban.reason}"</div>
                  <div className="admin-simple-ban-meta">Returns: {dateLabel(p.active_ban.ends_at)}</div>
                </>
              )}
            </div>
          </div>
          <button type="button" className="auth-btn auth-btn--approve admin-row-cta" onClick={() => onUnban(p)}>
            Unban
          </button>
        </li>
      ))}
    </ul>
  )
}

function RejectedList({ rows, onReinstate }: { rows: ProfileRow[]; onReinstate: (p: ProfileRow) => void }) {
  if (rows.length === 0) {
    return <div className="admin-empty"><div className="admin-empty-icon" aria-hidden>∅</div><h4>No rejected signups</h4></div>
  }
  return (
    <ul className="admin-simple-list">
      {rows.map((p) => (
        <li key={p.id} className="admin-row">
          <div className="admin-row-main admin-row-main--static">
            <span className="pending-row-avatar">{initials(p.display_name)}</span>
            <div className="admin-simple-body">
              <div className="admin-simple-name-row">
                <span className="admin-simple-name">{p.display_name}</span>
                <span className="chip chip-new">rejected</span>
              </div>
              {p.reject_reason && <div className="admin-simple-reason">"{p.reject_reason}"</div>}
            </div>
          </div>
          <button type="button" className="auth-btn auth-btn--approve admin-row-cta" onClick={() => onReinstate(p)}>
            Reinstate
          </button>
        </li>
      ))}
    </ul>
  )
}

// ────────────────────────────────────────────────────────────────
// Sheets
// ────────────────────────────────────────────────────────────────

interface SheetBaseProps {
  busy: boolean
  setBusy: (b: boolean) => void
  onDone: () => Promise<void> | void
  onError: (msg: string) => void
  onCancel: () => void
}

function ApproveSheet({
  row, ghost, busy, setBusy, onDone, onError, onCancel,
}: SheetBaseProps & { row: PendingRow; ghost: ProfileRow | null }) {
  const confirm = async () => {
    setBusy(true)
    const args = ghost
      ? { p_pending_id: row.id, p_claim_profile_id: ghost.id }
      : { p_pending_id: row.id }
    const { error } = await supabase.rpc('approve_signup', args)
    setBusy(false)
    if (error) { onError(error.message); return }
    await onDone()
  }
  /* S038 sanity check: when a ghost row was pre-seeded with an expected email
   * (e.g. the 4 admin ghosts), surface a match-or-mismatch banner so the admin
   * can verify identity before binding. Case-insensitive comparison. */
  const expectedEmail = ghost?.email?.trim().toLowerCase() ?? null
  const incomingEmail = row.email.trim().toLowerCase()
  const emailMatch = expectedEmail !== null && expectedEmail === incomingEmail
  const emailMismatch = expectedEmail !== null && expectedEmail !== incomingEmail
  return (
    <>
      <h3>{ghost ? 'Approve claim?' : 'Approve new player?'}</h3>
      <p>
        {ghost ? (
          <>Bind <strong>{row.email}</strong> to <strong>{ghost.display_name}</strong>. This cannot be undone.</>
        ) : (
          <>Create a new profile for <strong>{row.display_name}</strong> (<code>{row.email}</code>).</>
        )}
      </p>
      {emailMatch && (
        <div className="auth-banner auth-banner--success" role="status">
          <span className="auth-banner-icon" aria-hidden>✓</span>
          <div>Email matches the seeded address for {ghost!.display_name}.</div>
        </div>
      )}
      {emailMismatch && (
        <div className="auth-banner auth-banner--warn" role="alert">
          <span className="auth-banner-icon" aria-hidden>!</span>
          <div>
            Expected <strong>{ghost!.email}</strong> for {ghost!.display_name}, but request came from <strong>{row.email}</strong>. Verify identity before approving.
          </div>
        </div>
      )}
      <div className="sheet-actions">
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="auth-btn auth-btn--approve" onClick={confirm} disabled={busy}>
          {busy ? 'Approving…' : 'Confirm approve'}
        </button>
      </div>
    </>
  )
}

function RejectSheet({
  row, busy, setBusy, onDone, onError, onCancel,
}: SheetBaseProps & { row: PendingRow }) {
  const [reason, setReason] = useState('')
  const confirm = async () => {
    if (reason.trim().length < 10) { onError('Reason must be at least 10 characters.'); return }
    setBusy(true)
    const { error } = await supabase.rpc('reject_signup', { p_pending_id: row.id, p_reason: reason.trim() })
    setBusy(false)
    if (error) { onError(error.message); return }
    await onDone()
  }
  return (
    <>
      <h3>Reject signup</h3>
      <p>Rejecting <strong>{row.display_name}</strong>. Reason is logged.</p>
      <textarea
        className="auth-input"
        rows={3}
        placeholder="Reason (min. 10 characters)…"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <p className="auth-hint">{reason.trim().length} / 10 chars</p>
      <div className="sheet-actions">
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="auth-btn auth-btn--reject-filled" onClick={confirm} disabled={busy || reason.trim().length < 10}>
          {busy ? 'Rejecting…' : 'Confirm reject'}
        </button>
      </div>
    </>
  )
}

function EditSheet({
  profile, isSuperAdmin, busy, setBusy, onDone, onError, onCancel, onDelete,
}: SheetBaseProps & { profile: ProfileRow; isSuperAdmin: boolean; onDelete: () => void }) {
  const [name, setName] = useState(profile.display_name)
  const [primary, setPrimary] = useState<Position | ''>(profile.primary_position ?? '')
  const [secondary, setSecondary] = useState<Position | ''>(profile.secondary_position ?? '')
  const [isActive, setIsActive] = useState<boolean>(profile.is_active)
  const [newRole, setNewRole] = useState<UserRole>(profile.role as UserRole)

  const invalid = name.trim().length < 2 || (primary && secondary && primary === secondary)
  const dirty =
    name.trim() !== profile.display_name.trim()
    || (primary || null) !== (profile.primary_position ?? null)
    || (secondary || null) !== (profile.secondary_position ?? null)
    || isActive !== profile.is_active
    || newRole !== profile.role

  const save = async () => {
    if (invalid || !dirty) return
    setBusy(true)
    const args: Database['public']['Functions']['update_player_profile']['Args'] = {
      p_profile_id: profile.id,
      p_display_name: name.trim(),
      p_primary_position: (primary || null) as Position,
      p_secondary_position: (secondary || null) as Position,
      p_is_active: isActive,
    }
    if (isSuperAdmin && newRole !== profile.role) {
      args.p_role = newRole
    }
    const { error } = await supabase.rpc('update_player_profile', args)
    setBusy(false)
    if (error) { onError(error.message); return }
    await onDone()
  }

  return (
    <>
      <h3>Edit profile</h3>
      <p className="sheet-sub">Editing as admin · changes are audit-logged.</p>

      <label className="admin-field">
        <span className="admin-field-label">Display name</span>
        <input className="auth-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
      </label>

      <label className="admin-field">
        <span className="admin-field-label">Primary position</span>
        <select className="auth-input" value={primary} onChange={(e) => setPrimary((e.target.value || '') as Position | '')}>
          <option value="">— none —</option>
          {POSITIONS.map((p) => <option key={p} value={p}>{POS_LABEL[p]}</option>)}
        </select>
      </label>

      <label className="admin-field">
        <span className="admin-field-label">Secondary position</span>
        <select
          className="auth-input"
          value={secondary}
          onChange={(e) => setSecondary((e.target.value || '') as Position | '')}
        >
          <option value="">— none —</option>
          {POSITIONS.filter((p) => p !== primary).map((p) => <option key={p} value={p}>{POS_LABEL[p]}</option>)}
        </select>
      </label>

      <label className="admin-field admin-field--row">
        <span className="admin-field-label">Active</span>
        <button
          type="button"
          className={`admin-pill${isActive ? ' admin-pill--on' : ''}`}
          onClick={() => setIsActive((v) => !v)}
          aria-pressed={isActive}
        >
          {isActive ? 'Active' : 'Inactive'}
        </button>
      </label>

      {isSuperAdmin && profile.role !== 'rejected' && (
        <div className="admin-field">
          <span className="admin-field-label">Role</span>
          <div className="admin-chip-row">
            {(['player', 'admin'] as UserRole[]).map((r) => (
              <button
                key={r}
                type="button"
                className={`admin-chip${newRole === r ? ' admin-chip--on' : ''}`}
                onClick={() => setNewRole(r)}
              >
                {r}
              </button>
            ))}
            {profile.role === 'super_admin' && (
              <span className="admin-chip admin-chip--on admin-chip--locked">super-admin</span>
            )}
          </div>
        </div>
      )}

      <div className="sheet-actions">
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button
          type="button"
          className="auth-btn auth-btn--approve"
          onClick={save}
          disabled={busy || !dirty || Boolean(invalid)}
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {/* S051 issue #7 — Delete player. Super-admin profiles cannot be deleted
       * via this RPC (server-side guard); button hidden in that case. */}
      {profile.role !== 'super_admin' && (
        <div className="admin-edit-delete-row">
          <button
            type="button"
            className="auth-btn auth-btn--reject-outline"
            onClick={onDelete}
            disabled={busy}
          >
            Delete player
          </button>
        </div>
      )}
    </>
  )
}

function DeletePlayerSheet({
  profile, busy, setBusy, onDone, onError, onCancel,
}: SheetBaseProps & { profile: ProfileRow }) {
  const [confirmText, setConfirmText] = useState('')
  const ready = confirmText.trim() === 'DELETE'

  const confirm = async () => {
    if (!ready) return
    setBusy(true)
    const { error } = await supabase.rpc('admin_delete_player', { p_profile_id: profile.id })
    setBusy(false)
    if (error) { onError(error.message); return }
    await onDone()
  }

  return (
    <>
      <h3>Delete {profile.display_name}?</h3>
      <p className="sheet-sub">
        Soft-deletes the profile (mirrors player self-delete). Match history and
        leaderboard entries fall off; historical results stay intact as
        <strong> Deleted player</strong>. Cannot be undone.
      </p>
      <p className="auth-hint">Type <strong>DELETE</strong> to confirm:</p>
      <input
        className="auth-input"
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder="DELETE"
        autoCapitalize="characters"
        disabled={busy}
      />
      <div className="sheet-actions">
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button
          type="button"
          className="auth-btn auth-btn--reject-filled"
          onClick={confirm}
          disabled={busy || !ready}
        >
          {busy ? 'Deleting…' : 'Confirm delete'}
        </button>
      </div>
    </>
  )
}

function BanSheet({
  profile, busy, setBusy, onDone, onError, onCancel,
}: SheetBaseProps & { profile: ProfileRow }) {
  const [reason, setReason] = useState('')
  const [days, setDays] = useState(7)

  const confirm = async () => {
    if (reason.trim().length < 10) { onError('Reason must be at least 10 characters.'); return }
    if (days < 1) { onError('Ban length must be at least 1 day.'); return }
    setBusy(true)
    const { error } = await supabase.rpc('ban_player', {
      p_profile_id: profile.id,
      p_reason: reason.trim(),
      p_ends_at: toISOEnd(days),
    })
    setBusy(false)
    if (error) { onError(error.message); return }
    await onDone()
  }

  return (
    <>
      <h3>Ban {profile.display_name}</h3>
      <p className="sheet-sub">They'll be marked inactive and blocked from the poll until the ban ends.</p>

      <label className="admin-field">
        <span className="admin-field-label">Reason</span>
        <textarea
          className="auth-input"
          rows={3}
          placeholder="e.g. Late-cancel × 3 within 24h…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <span className="auth-hint">{reason.trim().length} / 10 chars</span>
      </label>

      <div className="admin-field">
        <span className="admin-field-label">Duration</span>
        <div className="admin-chip-row">
          {[7, 14].map((d) => (
            <button
              key={d}
              type="button"
              className={`admin-chip${days === d ? ' admin-chip--on' : ''}`}
              onClick={() => setDays(d)}
            >
              {d} Days
            </button>
          ))}
          <input
            type="number"
            className="admin-days-input"
            value={days}
            min={1}
            max={365}
            onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
          />
          <span className="auth-hint" style={{ marginLeft: 4 }}>days</span>
        </div>
        <span className="auth-hint">Returns {dateLabel(toISOEnd(days))}</span>
      </div>

      <div className="sheet-actions">
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button
          type="button"
          className="auth-btn auth-btn--reject-filled"
          onClick={confirm}
          disabled={busy || reason.trim().length < 10 || days < 1}
        >
          {busy ? 'Banning…' : 'Confirm ban'}
        </button>
      </div>
    </>
  )
}

function SimpleConfirmSheet({
  title, body, confirmLabel, busy, onConfirm, onCancel,
}: {
  title: string
  body: string
  confirmLabel: string
  busy: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}) {
  return (
    <>
      <h3>{title}</h3>
      <p>{body}</p>
      <div className="sheet-actions">
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="auth-btn auth-btn--approve" onClick={() => { void onConfirm() }} disabled={busy}>
          {busy ? 'Saving…' : confirmLabel}
        </button>
      </div>
    </>
  )
}
