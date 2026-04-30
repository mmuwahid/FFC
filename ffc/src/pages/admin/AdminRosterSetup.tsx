/**
 * Admin Roster Setup — /admin/roster
 *
 * Two views:
 *   list   → matchdays from active season, each with roster status + action
 *   editor → drag-and-drop team builder for a selected matchday
 *
 * Supports both fresh rosters (no match yet → calls create_match_draft)
 * and editing existing rosters (match exists → calls admin_replace_match_roster).
 *
 * Drag-and-drop uses pointer events so it works on both desktop and mobile.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/AppContext'
import type { Database } from '../../lib/database.types'

type MatchFormat = Database['public']['Enums']['match_format']
type PollChoice = Database['public']['Enums']['poll_choice']

// ─── Data types ────────────────────────────────────────────────────────────

interface MatchdayItem {
  id: string
  kickoff_at: string
  poll_closes_at: string
  roster_locked_at: string | null
  format: MatchFormat | null
  effective_format: MatchFormat
  season_id: string
  /** null = no match row yet */
  match_id: string | null
  match_approved_at: string | null
  /** count of profile-linked rows in match_players */
  mp_count: number
  /** count of yes-voters (non-cancelled) */
  yes_count: number
}

interface RosterPlayer {
  id: string
  name: string
  position: string | null
}

interface RosterState {
  white: RosterPlayer[]
  black: RosterPlayer[]
  pool: RosterPlayer[]   // yes-voters not yet in teams (draggable)
  removed: RosterPlayer[] // cancelled / no / maybe (read-only display)
}

type Zone = 'white' | 'black' | 'pool'

// ─── Helpers ───────────────────────────────────────────────────────────────

function capFor(fmt: MatchFormat): number {
  return fmt === '5v5' ? 10 : 14
}

function dateLabel(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
}

function dowLabel(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()
}

// ─── Main component ────────────────────────────────────────────────────────

export function AdminRosterSetup() {
  const navigate = useNavigate()
  const { role } = useApp()
  const isAdmin = role === 'admin' || role === 'super_admin'

  const [matchdays, setMatchdays] = useState<MatchdayItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<MatchdayItem | null>(null)

  const loadMatchdays = useCallback(async () => {
    setLoading(true)
    setError(null)

    // Get the active season
    const seasonRes = await supabase
      .from('seasons')
      .select('id, default_format')
      .is('ended_at', null)
      .order('starts_on', { ascending: false })
      .limit(1)
      .single()

    if (seasonRes.error) {
      setError('No active season found.')
      setLoading(false)
      return
    }

    const season = seasonRes.data
    const [mdRes, matchesRes, mpCountRes, voteCountRes] = await Promise.all([
      supabase.from('matchdays').select('*').eq('season_id', season.id).order('kickoff_at', { ascending: false }),
      supabase.from('matches').select('id, matchday_id, approved_at'),
      // aggregate match_players count per match (we'll join client-side)
      supabase.from('match_players').select('match_id, profile_id').not('profile_id', 'is', null),
      // count yes-voters per matchday
      supabase.from('poll_votes').select('matchday_id, id').eq('choice', 'yes').is('cancelled_at', null),
    ])

    if (mdRes.error) { setError(mdRes.error.message); setLoading(false); return }

    const matchByMd = new Map<string, { id: string; approved_at: string | null }>()
    for (const m of matchesRes.data ?? []) matchByMd.set(m.matchday_id, m)

    const mpCountByMatch = new Map<string, number>()
    for (const mp of mpCountRes.data ?? []) {
      mpCountByMatch.set(mp.match_id, (mpCountByMatch.get(mp.match_id) ?? 0) + 1)
    }

    const yesCountByMd = new Map<string, number>()
    for (const v of voteCountRes.data ?? []) {
      yesCountByMd.set(v.matchday_id, (yesCountByMd.get(v.matchday_id) ?? 0) + 1)
    }

    const items: MatchdayItem[] = (mdRes.data ?? []).map((md) => {
      const fmt = (md.format ?? season.default_format ?? '7v7') as MatchFormat
      const match = matchByMd.get(md.id)
      return {
        id: md.id,
        kickoff_at: md.kickoff_at,
        poll_closes_at: md.poll_closes_at,
        roster_locked_at: md.roster_locked_at,
        format: md.format as MatchFormat | null,
        effective_format: fmt,
        season_id: md.season_id,
        match_id: match?.id ?? null,
        match_approved_at: match?.approved_at ?? null,
        mp_count: match ? (mpCountByMatch.get(match.id) ?? 0) : 0,
        yes_count: yesCountByMd.get(md.id) ?? 0,
      }
    })

    setMatchdays(items)
    setLoading(false)
  }, [])

  useEffect(() => { void loadMatchdays() }, [loadMatchdays])

  if (!isAdmin) {
    return (
      <div className="rs-page">
        <div className="as-empty">
          <h3>Admin only</h3>
          <p>This area is restricted to admins and super-admins.</p>
          <button type="button" className="auth-btn auth-btn--approve" onClick={() => navigate('/admin')}>Back</button>
        </div>
      </div>
    )
  }

  if (selected) {
    return (
      <RosterEditor
        md={selected}
        onBack={() => { setSelected(null); void loadMatchdays() }}
        onError={setError}
      />
    )
  }

  return (
    <div className="rs-page">
      <header className="admin-players-top">
        <button type="button" className="ah-back" onClick={() => navigate('/admin')}>‹ Back</button>
        <h1>Roster Setup</h1>
        <div style={{ width: 60 }} />
      </header>

      {error && (
        <div className="auth-banner auth-banner--danger" role="alert" style={{ margin: '0 16px 12px' }}>
          <span className="auth-banner-icon" aria-hidden>!</span>
          <div>{error}</div>
        </div>
      )}

      {loading ? (
        <div className="app-loading">Loading…</div>
      ) : matchdays.length === 0 ? (
        <div className="admin-empty">
          <div className="admin-empty-icon" aria-hidden>∅</div>
          <h4>No matchdays</h4>
          <p>Create matchdays in Matches management first.</p>
        </div>
      ) : (
        <ul className="rs-list">
          {matchdays.map((md) => (
            <MatchdayRosterCard
              key={md.id}
              md={md}
              onSelect={() => setSelected(md)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Matchday list card ────────────────────────────────────────────────────

function MatchdayRosterCard({ md, onSelect }: { md: MatchdayItem; onSelect: () => void }) {
  const cap = capFor(md.effective_format)
  const hasMatch = !!md.match_id
  const locked = !!md.roster_locked_at
  const approved = !!md.match_approved_at

  const statusLabel = approved
    ? 'Final'
    : hasMatch
    ? locked ? `${md.mp_count}/${cap} locked` : `${md.mp_count}/${cap} assigned`
    : md.yes_count > 0
    ? `${md.yes_count} yes-vote${md.yes_count === 1 ? '' : 's'} · no roster yet`
    : 'No votes yet'

  const statusTone = approved ? 'success' : hasMatch ? (locked ? 'accent' : 'warn') : 'muted'
  const btnLabel = hasMatch ? '✎ Edit roster' : md.yes_count > 0 ? '+ Set up roster' : null

  return (
    <li className="rs-card">
      <div className="rs-card-head">
        <div>
          <span className="rs-card-dow">{dowLabel(md.kickoff_at)}</span>
          <span className="rs-card-date"> · {dateLabel(md.kickoff_at)}</span>
        </div>
        <span className={`admin-md-fmt admin-md-fmt--${md.effective_format}`}>{md.effective_format}</span>
      </div>
      <div className={`rs-card-status rs-card-status--${statusTone}`}>{statusLabel}</div>
      {btnLabel && (
        <button type="button" className="auth-btn auth-btn--sheet-cancel rs-card-btn" onClick={onSelect}>
          {btnLabel}
        </button>
      )}
    </li>
  )
}

// ─── Roster Editor ─────────────────────────────────────────────────────────

function RosterEditor({
  md,
  onBack,
  onError,
}: {
  md: MatchdayItem
  onBack: () => void
  onError: (msg: string) => void
}) {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [unlocked, setUnlocked] = useState(!md.roster_locked_at)
  const [roster, setRoster] = useState<RosterState>({ white: [], black: [], pool: [], removed: [] })
  const [toast, setToast] = useState<string | null>(null)

  // Drag state
  const [drag, setDrag] = useState<{ id: string; name: string; ghost: { x: number; y: number } } | null>(null)
  const [overZone, setOverZone] = useState<Zone | null>(null)
  const overZoneRef = useRef<Zone | null>(null)

  // Keep ref in sync with state (closure-safe for pointer handlers)
  useEffect(() => { overZoneRef.current = overZone }, [overZone])

  // ── Load pool + teams ──────────────────────────────────────────────────
  const loadRoster = useCallback(async () => {
    setLoading(true)

    const [votesRes, mpRes] = await Promise.all([
      supabase
        .from('poll_votes')
        .select('id, profile_id, choice, cancelled_at, committed_at')
        .eq('matchday_id', md.id),
      md.match_id
        ? supabase.from('match_players').select('id, profile_id, team').eq('match_id', md.match_id)
        : Promise.resolve({ data: [] as { id: string; profile_id: string | null; team: string }[], error: null }),
    ])

    if (votesRes.error) { onError(votesRes.error.message); setLoading(false); return }

    // Gather all profile IDs we need names for
    const voteProfileIds = (votesRes.data ?? []).map((v) => v.profile_id).filter(Boolean) as string[]
    const mpProfileIds = ((mpRes.data ?? []) as { profile_id: string | null }[])
      .map((r) => r.profile_id)
      .filter(Boolean) as string[]
    const allIds = [...new Set([...voteProfileIds, ...mpProfileIds])]

    const profRes = allIds.length
      ? await supabase.from('profiles').select('id, display_name, primary_position').in('id', allIds)
      : { data: [] as { id: string; display_name: string; primary_position: string | null }[] }

    const nameMap = new Map<string, { name: string; position: string | null }>()
    for (const p of profRes.data ?? []) {
      nameMap.set(p.id, { name: p.display_name, position: p.primary_position })
    }

    const toPlayer = (profileId: string): RosterPlayer => ({
      id: profileId,
      name: nameMap.get(profileId)?.name ?? profileId.slice(0, 8),
      position: nameMap.get(profileId)?.position ?? null,
    })

    // Players currently in teams
    const mpRows = (mpRes.data ?? []) as { id: string; profile_id: string | null; team: string }[]
    const white = mpRows.filter((r) => r.team === 'white' && r.profile_id).map((r) => toPlayer(r.profile_id!))
    const black = mpRows.filter((r) => r.team === 'black' && r.profile_id).map((r) => toPlayer(r.profile_id!))
    const inTeamIds = new Set(mpRows.map((r) => r.profile_id).filter(Boolean))

    // Players from poll votes
    const votes = votesRes.data ?? []
    const pool: RosterPlayer[] = []
    const removed: RosterPlayer[] = []

    for (const v of votes) {
      if (!v.profile_id) continue
      if (inTeamIds.has(v.profile_id)) continue // already in a team
      if (v.cancelled_at) {
        removed.push(toPlayer(v.profile_id))
      } else if ((v.choice as PollChoice) === 'yes') {
        pool.push(toPlayer(v.profile_id))
      } else {
        // no / maybe — show in removed (declined / tentative)
        removed.push(toPlayer(v.profile_id))
      }
    }

    // Sort pool by name for consistency
    pool.sort((a, b) => a.name.localeCompare(b.name))
    removed.sort((a, b) => a.name.localeCompare(b.name))

    setRoster({ white, black, pool, removed })
    setLoading(false)
  }, [md.id, md.match_id])

  useEffect(() => { void loadRoster() }, [loadRoster])

  // ── Pointer-based drag and drop ────────────────────────────────────────
  useEffect(() => {
    if (!drag) return

    const onMove = (e: PointerEvent) => {
      setDrag((prev) => prev ? { ...prev, ghost: { x: e.clientX, y: e.clientY } } : null)
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const zoneEl = el?.closest('[data-drop-zone]')
      const z = (zoneEl?.getAttribute('data-drop-zone') ?? null) as Zone | null
      setOverZone(z)
    }

    const onUp = () => {
      const target = overZoneRef.current
      if (drag && target) {
        const dragId = drag.id
        setRoster((prev) => {
          let player: RosterPlayer | undefined
          let sourceZone: Zone | undefined
          for (const z of ['white', 'black', 'pool'] as Zone[]) {
            const found = prev[z].find((p) => p.id === dragId)
            if (found) { player = found; sourceZone = z; break }
          }
          if (!player || !sourceZone || sourceZone === target) return prev
          return {
            ...prev,
            [sourceZone]: prev[sourceZone].filter((p) => p.id !== dragId),
            [target]: [...prev[target], player],
          }
        })
      }
      setDrag(null)
      setOverZone(null)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
  }, [drag])

  const startDrag = (e: React.PointerEvent, player: RosterPlayer) => {
    e.preventDefault()
    setDrag({ id: player.id, name: player.name, ghost: { x: e.clientX, y: e.clientY } })
  }

  // ── Auto-assign ────────────────────────────────────────────────────────
  const autoAssign = () => {
    setRoster((prev) => {
      if (prev.pool.length === 0) return prev
      const newWhite = [...prev.white]
      const newBlack = [...prev.black]
      // Continue alternating from current counts: if white has more, next goes black
      const startWithBlack = newWhite.length > newBlack.length
      prev.pool.forEach((p, i) => {
        const goBlack = startWithBlack ? i % 2 === 0 : i % 2 === 1
        if (goBlack) newBlack.push(p)
        else newWhite.push(p)
      })
      return { ...prev, white: newWhite, black: newBlack, pool: [] }
    })
  }

  // ── Unlock ─────────────────────────────────────────────────────────────
  const handleUnlock = async () => {
    setBusy(true)
    // @ts-expect-error -- unlock_roster added by migration 0047; regen types after db push
    const { error } = await supabase.rpc('unlock_roster', { p_matchday_id: md.id })
    setBusy(false)
    if (error) { onError(error.message); return }
    setUnlocked(true)
  }

  // ── Save ───────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setBusy(true)
    const whiteIds = roster.white.map((p) => p.id)
    const blackIds = roster.black.map((p) => p.id)

    if (md.match_id) {
      // Existing match — replace roster in place
      // @ts-expect-error -- admin_replace_match_roster added by migration 0048; regen types after db push
      const { error } = await supabase.rpc('admin_replace_match_roster', {
        p_match_id: md.match_id,
        p_white_profile_ids: whiteIds,
        p_black_profile_ids: blackIds,
      })
      setBusy(false)
      if (error) { onError(error.message); return }
      setToast('Roster saved')
      setTimeout(onBack, 800)
    } else {
      // No match yet — create the match draft
      const { error } = await supabase.rpc('create_match_draft', {
        p_matchday_id: md.id,
        p_white_roster: whiteIds,
        p_black_roster: blackIds,
        p_white_guests: [],
        p_black_guests: [],
      })
      setBusy(false)
      if (error) { onError(error.message); return }
      setToast('Roster created')
      setTimeout(onBack, 800)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  const cap = capFor(md.effective_format)

  return (
    <div className="rs-page">
      <header className="rs-editor-header">
        <button type="button" className="ah-back" onClick={onBack} disabled={busy}>‹ Back</button>
        <div className="rs-editor-title">
          <span className="rs-editor-dow">{dowLabel(md.kickoff_at)}</span>
          <span className="rs-editor-date"> {dateLabel(md.kickoff_at)}</span>
        </div>
        <span className={`admin-md-fmt admin-md-fmt--${md.effective_format}`}>{md.effective_format}</span>
      </header>

      {toast && (
        <div className="st-toast" role="alert" onAnimationEnd={() => setToast(null)}>{toast}</div>
      )}

      {loading ? (
        <div className="app-loading">Loading…</div>
      ) : !unlocked ? (
        /* ── Locked gate ── */
        <div className="rs-locked-gate">
          <div className="rs-locked-icon" aria-hidden>🔒</div>
          <p className="rs-locked-msg">Roster is locked. Unlock it to edit team assignments.</p>
          <div className="rs-locked-hint">Note: any pending ref entry must be rejected first.</div>
          <div className="sheet-actions" style={{ justifyContent: 'center' }}>
            <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onBack} disabled={busy}>Cancel</button>
            <button type="button" className="auth-btn auth-btn--approve" onClick={() => { void handleUnlock() }} disabled={busy}>
              {busy ? 'Unlocking…' : '🔓 Unlock & edit'}
            </button>
          </div>
        </div>
      ) : (
        /* ── Editor ── */
        <>
          <div className="rs-toolbar">
            <div className="rs-toolbar-counts">
              <span className="rs-count rs-count--white">⚪ {roster.white.length}</span>
              <span className="rs-count-sep">/</span>
              <span className="rs-count rs-count--black">⚫ {roster.black.length}</span>
              <span className="rs-count-cap">of {cap}</span>
            </div>
            {roster.pool.length > 0 && (
              <button type="button" className="rs-auto-btn" onClick={autoAssign} disabled={busy}>
                ⚡ Auto-assign ({roster.pool.length})
              </button>
            )}
          </div>

          {/* Team columns */}
          <div className="rs-teams">
            <DropZone
              zone="white"
              label="⚪ WHITE"
              players={roster.white}
              isOver={overZone === 'white'}
              draggingId={drag?.id ?? null}
              onDragStart={startDrag}
            />
            <DropZone
              zone="black"
              label="⚫ BLACK"
              players={roster.black}
              isOver={overZone === 'black'}
              draggingId={drag?.id ?? null}
              onDragStart={startDrag}
            />
          </div>

          {/* Pool */}
          <div
            className={`rs-pool${overZone === 'pool' ? ' rs-pool--over' : ''}`}
            data-drop-zone="pool"
          >
            <div className="rs-section-label">
              Unassigned · Pool
              {roster.pool.length > 0 && <span className="rs-section-count">{roster.pool.length}</span>}
            </div>
            {roster.pool.length === 0 ? (
              <p className="rs-section-empty">All yes-voters have been assigned to teams.</p>
            ) : (
              <div className="rs-chips">
                {roster.pool.map((p) => (
                  <PlayerChip
                    key={p.id}
                    player={p}
                    zone="pool"
                    isDragging={drag?.id === p.id}
                    onDragStart={startDrag}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Removed (read-only) */}
          {roster.removed.length > 0 && (
            <div className="rs-removed">
              <div className="rs-section-label">
                Removed / No-show / Maybe
                <span className="rs-section-count">{roster.removed.length}</span>
              </div>
              <div className="rs-chips rs-chips--readonly">
                {roster.removed.map((p) => (
                  <span key={p.id} className="rs-chip rs-chip--removed">{p.name}</span>
                ))}
              </div>
            </div>
          )}

          <div className="sheet-actions rs-save-row">
            <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onBack} disabled={busy}>Cancel</button>
            <button
              type="button"
              className="auth-btn auth-btn--approve"
              onClick={() => { void handleSave() }}
              disabled={busy || (roster.white.length === 0 && roster.black.length === 0)}
            >
              {busy ? 'Saving…' : md.match_id ? 'Save roster' : 'Create roster'}
            </button>
          </div>
        </>
      )}

      {/* Drag ghost */}
      {drag && createPortal(
        <div
          className="rs-ghost"
          style={{ left: drag.ghost.x - 40, top: drag.ghost.y - 14 }}
          aria-hidden
        >
          {drag.name}
        </div>,
        document.body,
      )}
    </div>
  )
}

// ─── Drop zone (team column) ───────────────────────────────────────────────

function DropZone({
  zone,
  label,
  players,
  isOver,
  draggingId,
  onDragStart,
}: {
  zone: Zone
  label: string
  players: RosterPlayer[]
  isOver: boolean
  draggingId: string | null
  onDragStart: (e: React.PointerEvent, player: RosterPlayer) => void
}) {
  return (
    <div
      className={`rs-zone rs-zone--${zone}${isOver ? ' rs-zone--over' : ''}`}
      data-drop-zone={zone}
    >
      <div className="rs-zone-label">{label} <span className="rs-zone-count">({players.length})</span></div>
      {players.length === 0 ? (
        <div className="rs-zone-empty">Drop players here</div>
      ) : (
        <ul className="rs-zone-list">
          {players.map((p) => (
            <li key={p.id}>
              <PlayerChip
                player={p}
                zone={zone}
                isDragging={draggingId === p.id}
                onDragStart={onDragStart}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Player chip ───────────────────────────────────────────────────────────

function PlayerChip({
  player,
  zone,
  isDragging,
  onDragStart,
}: {
  player: RosterPlayer
  zone: Zone
  isDragging: boolean
  onDragStart: (e: React.PointerEvent, player: RosterPlayer) => void
}) {
  return (
    <div
      className={`rs-chip rs-chip--${zone}${isDragging ? ' rs-chip--dragging' : ''}`}
      onPointerDown={(e) => onDragStart(e, player)}
      role="button"
      tabIndex={0}
      aria-label={`${player.name}, drag to assign team`}
      title="Drag to assign team"
    >
      {player.position && (
        <span className="rs-chip-pos">{player.position}</span>
      )}
      <span className="rs-chip-name">{player.name}</span>
      <span className="rs-chip-handle" aria-hidden>⠿</span>
    </div>
  )
}
