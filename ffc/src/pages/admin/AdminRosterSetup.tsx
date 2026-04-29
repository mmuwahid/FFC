/**
 * Admin Roster Setup — /admin/roster-setup
 * Issue #11: allows admin to view and correct the team rosters for a matchday
 * after the captain pick draft has run. Also serves as the fallback path when
 * no captain draft has happened (admin assigns from scratch).
 *
 * Interaction model (option B):
 *   1. Tap an empty slot → it becomes the "active target"
 *   2. Tap a pool chip → player fills the active slot
 *   3. Tap × on a filled slot → player returns to pool, slot becomes empty
 *   4. "+ Add guest" → opens name sheet (name only)
 *   5. "+ Add player" → opens search sheet, calls admin_add_commitment, adds to pool
 *
 * RPCs used:
 *   create_match_draft         — if no draft match exists yet
 *   admin_update_match_draft   — if a draft match already exists
 *   admin_add_guest            — create a match_guest (name only)
 *   admin_add_commitment       — mark a registered player as confirmed
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/AppContext'
import type { Database } from '../../lib/database.types'

type PlayerPosition = Database['public']['Enums']['player_position']
type TeamColor = Database['public']['Enums']['team_color']
type MatchFormat = Database['public']['Enums']['match_format']

interface MatchdayOption {
  id: string
  kickoff_at: string
  roster_locked_at: string | null
  effective_format: MatchFormat
}

interface PoolPlayer {
  id: string
  display_name: string
  primary_position: PlayerPosition | null
  isGuest: boolean
  guestId?: string
}

interface RegisteredPlayer {
  id: string
  display_name: string
  primary_position: PlayerPosition | null
}

type TeamSlot =
  | { kind: 'empty' }
  | { kind: 'filled'; player: PoolPlayer }

type ActiveTarget = { team: TeamColor; slotIndex: number } | null

interface DraftMatch {
  id: string
  hasResult: boolean
}

function fmtDatetime(iso: string): string {
  const d = new Date(iso)
  const day = String(d.getDate()).padStart(2, '0')
  const mon = d.toLocaleString('en-GB', { month: 'short' }).toUpperCase()
  const yr = d.getFullYear()
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  const dow = d.toLocaleString('en-GB', { weekday: 'short' }).toUpperCase()
  return `${dow} · ${day}/${mon}/${yr} · ${h12}:${m}${ampm}`
}

function rosterCap(format: MatchFormat): number {
  return format === '7v7' ? 14 : 10
}

function halfCap(format: MatchFormat): number {
  return format === '7v7' ? 7 : 5
}

export function AdminRosterSetup() {
  const navigate = useNavigate()
  const { role } = useApp()
  const isAdmin = role === 'admin' || role === 'super_admin'

  const [matchdays, setMatchdays] = useState<MatchdayOption[]>([])
  const [selectedMdId, setSelectedMdId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Roster state
  const [pool, setPool] = useState<PoolPlayer[]>([])
  const [white, setWhite] = useState<TeamSlot[]>([])
  const [black, setBlack] = useState<TeamSlot[]>([])
  const [activeTarget, setActiveTarget] = useState<ActiveTarget>(null)
  const [draftMatch, setDraftMatch] = useState<DraftMatch | null>(null)
  const [format, setFormat] = useState<MatchFormat>('7v7')
  // Tracks all profile IDs currently in the pool or in a slot (confirmed)
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set())

  // Add guest sheet
  const [guestSheet, setGuestSheet] = useState<{ team: TeamColor } | null>(null)
  const [guestName, setGuestName] = useState('')
  const [guestBusy, setGuestBusy] = useState(false)

  // Add player sheet
  const [playerSheet, setPlayerSheet] = useState(false)
  const [allPlayers, setAllPlayers] = useState<RegisteredPlayer[]>([])
  const [playerSearch, setPlayerSearch] = useState('')
  const [playerBusy, setPlayerBusy] = useState<string | null>(null) // profile_id being added

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }

  // ── Load matchday list ────────────────────────────────────────────────────
  useEffect(() => {
    async function loadMatchdays() {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('matchdays')
        .select('id, kickoff_at, roster_locked_at, format, season_id, seasons:season_id(default_format)')
        .order('kickoff_at', { ascending: false })
        .limit(20)
      if (err) { setError(err.message); setLoading(false); return }

      const opts: MatchdayOption[] = (data ?? []).map((md) => {
        const seasonDefault = (md.seasons as unknown as { default_format: MatchFormat } | null)?.default_format ?? '7v7'
        return {
          id: md.id,
          kickoff_at: md.kickoff_at,
          roster_locked_at: md.roster_locked_at,
          effective_format: (md.format ?? seasonDefault) as MatchFormat,
        }
      })
      setMatchdays(opts)
      const defaultMd = opts.find(m => m.roster_locked_at) ?? opts[0] ?? null
      setSelectedMdId(defaultMd?.id ?? null)
      setLoading(false)
    }
    loadMatchdays()
  }, [])

  // ── Load all active registered players (for Add Player sheet) ────────────
  useEffect(() => {
    async function loadPlayers() {
      const { data } = await supabase
        .from('profiles')
        .select('id, display_name, primary_position')
        .in('role', ['player', 'admin', 'super_admin'])
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('display_name', { ascending: true })
      setAllPlayers((data ?? []) as RegisteredPlayer[])
    }
    loadPlayers()
  }, [])

  // ── Load roster for selected matchday ────────────────────────────────────
  const loadRoster = useCallback(async (mdId: string, fmt: MatchFormat) => {
    setLoading(true)
    setError(null)
    setActiveTarget(null)

    const cap = rosterCap(fmt)
    const half = halfCap(fmt)

    try {
      const { data: voteRows, error: voteErr } = await supabase
        .from('poll_votes')
        .select('profile_id, committed_at, profiles:profile_id(id, display_name, primary_position)')
        .eq('matchday_id', mdId)
        .eq('choice', 'yes')
        .is('cancelled_at', null)
        .order('committed_at', { ascending: true })
        .limit(cap)
      if (voteErr) throw voteErr

      const { data: guestRows, error: guestErr } = await supabase
        .from('match_guests')
        .select('id, display_name')
        .eq('matchday_id', mdId)
        .is('cancelled_at', null)
      if (guestErr) throw guestErr

      const { data: matchRow, error: matchErr } = await supabase
        .from('matches')
        .select('id, result')
        .eq('matchday_id', mdId)
        .maybeSingle()
      if (matchErr) throw matchErr

      const allProfiles: PoolPlayer[] = (voteRows ?? []).map((v) => {
        const p = v.profiles as unknown as { id: string; display_name: string; primary_position: PlayerPosition | null } | null
        return {
          id: p?.id ?? v.profile_id ?? '',
          display_name: p?.display_name ?? '—',
          primary_position: p?.primary_position ?? null,
          isGuest: false,
        }
      })

      const allGuests: PoolPlayer[] = (guestRows ?? []).map((g) => ({
        id: g.id,
        display_name: g.display_name,
        primary_position: null,
        isGuest: true,
        guestId: g.id,
      }))

      // Track which profile IDs are confirmed for this matchday
      const confirmedSet = new Set(allProfiles.map(p => p.id))
      setConfirmedIds(confirmedSet)

      const emptyWhite: TeamSlot[] = Array.from({ length: half }, () => ({ kind: 'empty' as const }))
      const emptyBlack: TeamSlot[] = Array.from({ length: half }, () => ({ kind: 'empty' as const }))

      if (matchRow) {
        setDraftMatch({ id: matchRow.id, hasResult: matchRow.result !== null })

        const { data: mpRows, error: mpErr } = await supabase
          .from('match_players')
          .select('profile_id, guest_id, team')
          .eq('match_id', matchRow.id)
        if (mpErr) throw mpErr

        const assignedProfileIds = new Set<string>()
        const assignedGuestIds = new Set<string>()

        const whiteSlots: TeamSlot[] = [...emptyWhite]
        const blackSlots: TeamSlot[] = [...emptyBlack]
        let wi = 0; let bi = 0

        for (const mp of mpRows ?? []) {
          let player: PoolPlayer | undefined
          if (mp.profile_id) {
            player = allProfiles.find(p => p.id === mp.profile_id)
            if (player) assignedProfileIds.add(mp.profile_id)
          } else if (mp.guest_id) {
            player = allGuests.find(g => g.guestId === mp.guest_id)
            if (player) assignedGuestIds.add(mp.guest_id)
          }
          if (!player) continue
          if (mp.team === 'white' && wi < half) { whiteSlots[wi++] = { kind: 'filled', player }; continue }
          if (mp.team === 'black' && bi < half) { blackSlots[bi++] = { kind: 'filled', player } }
        }

        setWhite(whiteSlots)
        setBlack(blackSlots)
        setPool([
          ...allProfiles.filter(p => !assignedProfileIds.has(p.id)),
          ...allGuests.filter(g => !assignedGuestIds.has(g.guestId!)),
        ])
      } else {
        setDraftMatch(null)
        setWhite(emptyWhite)
        setBlack(emptyBlack)
        setPool([...allProfiles, ...allGuests])
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedMdId) return
    const md = matchdays.find(m => m.id === selectedMdId)
    if (!md) return
    setFormat(md.effective_format)
    loadRoster(selectedMdId, md.effective_format)
  }, [selectedMdId, matchdays, loadRoster])

  // ── Slot tap ──────────────────────────────────────────────────────────────
  function tapSlot(team: TeamColor, idx: number) {
    const slots = team === 'white' ? white : black
    if (slots[idx].kind === 'filled') return
    setActiveTarget(prev =>
      prev?.team === team && prev?.slotIndex === idx ? null : { team, slotIndex: idx }
    )
  }

  // ── Chip tap: assign to active target ─────────────────────────────────────
  function tapChip(player: PoolPlayer) {
    if (!activeTarget) return
    const { team, slotIndex } = activeTarget
    const setSlots = team === 'white' ? setWhite : setBlack
    setSlots(prev => {
      const next = [...prev]
      next[slotIndex] = { kind: 'filled', player }
      return next
    })
    setPool(prev => prev.filter(p => p.id !== player.id))
    const slots = team === 'white' ? white : black
    let nextIdx: number | null = null
    for (let i = slotIndex + 1; i < slots.length; i++) {
      if (slots[i].kind === 'empty') { nextIdx = i; break }
    }
    setActiveTarget(nextIdx !== null ? { team, slotIndex: nextIdx } : null)
  }

  // ── Remove from slot → return to pool ────────────────────────────────────
  function removeSlot(team: TeamColor, idx: number) {
    const slots = team === 'white' ? white : black
    const slot = slots[idx]
    if (slot.kind !== 'filled') return
    const player = slot.player
    const setSlots = team === 'white' ? setWhite : setBlack
    setSlots(prev => {
      const next = [...prev]
      next[idx] = { kind: 'empty' }
      return next
    })
    setPool(prev => [...prev, player])
    setActiveTarget({ team, slotIndex: idx })
  }

  // ── Add guest ─────────────────────────────────────────────────────────────
  async function handleAddGuest() {
    if (!selectedMdId || !guestSheet || !guestName.trim()) return
    setGuestBusy(true)
    try {
      const { data: guestId, error: err } = await supabase.rpc(
        'admin_add_guest' as never,
        { p_matchday_id: selectedMdId, p_display_name: guestName.trim() } as never
      ) as { data: string | null; error: unknown }
      if (err) throw err
      if (!guestId) throw new Error('No guest ID returned')
      const newGuest: PoolPlayer = {
        id: guestId as string,
        display_name: guestName.trim(),
        primary_position: null,
        isGuest: true,
        guestId: guestId as string,
      }
      const targetTeam = guestSheet.team
      const slots = targetTeam === 'white' ? white : black
      const firstEmpty = slots.findIndex(s => s.kind === 'empty')
      if (firstEmpty >= 0) {
        const setSlots = targetTeam === 'white' ? setWhite : setBlack
        setSlots(prev => {
          const next = [...prev]
          next[firstEmpty] = { kind: 'filled', player: newGuest }
          return next
        })
      } else {
        setPool(prev => [...prev, newGuest])
      }
      setGuestSheet(null)
      setGuestName('')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to add guest')
    } finally {
      setGuestBusy(false)
    }
  }

  // ── Add registered player (admin_add_commitment) ──────────────────────────
  async function handleAddPlayer(p: RegisteredPlayer) {
    if (!selectedMdId) return
    setPlayerBusy(p.id)
    try {
      const { error: err } = await supabase.rpc(
        'admin_add_commitment' as never,
        { p_matchday_id: selectedMdId, p_profile_id: p.id } as never
      ) as { error: unknown }
      if (err) throw err

      const newPlayer: PoolPlayer = {
        id: p.id,
        display_name: p.display_name,
        primary_position: p.primary_position,
        isGuest: false,
      }
      setConfirmedIds(prev => new Set([...prev, p.id]))
      setPool(prev => [...prev, newPlayer])
      showToast(`${p.display_name} added to confirmed`)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to add player')
    } finally {
      setPlayerBusy(null)
    }
  }

  // ── Submit roster ─────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!selectedMdId) return
    const whiteProfiles = white.flatMap(s => s.kind === 'filled' && !s.player.isGuest ? [s.player.id] : [])
    const blackProfiles = black.flatMap(s => s.kind === 'filled' && !s.player.isGuest ? [s.player.id] : [])
    const whiteGuests = white.flatMap(s => s.kind === 'filled' && s.player.isGuest ? [s.player.guestId!] : [])
    const blackGuests = black.flatMap(s => s.kind === 'filled' && s.player.isGuest ? [s.player.guestId!] : [])

    setBusy(true)
    setError(null)
    try {
      if (draftMatch) {
        const { error: err } = await supabase.rpc(
          'admin_update_match_draft' as never,
          {
            p_match_id: draftMatch.id,
            p_white_roster: whiteProfiles,
            p_black_roster: blackProfiles,
            p_white_guests: whiteGuests.length > 0 ? whiteGuests : null,
            p_black_guests: blackGuests.length > 0 ? blackGuests : null,
          } as never
        )
        if (err) throw err
        showToast('Roster updated')
      } else {
        const { error: err } = await supabase.rpc('create_match_draft', {
          p_matchday_id: selectedMdId,
          p_white_roster: whiteProfiles,
          p_black_roster: blackProfiles,
          p_white_guests: whiteGuests,
          p_black_guests: blackGuests,
        })
        if (err) throw err
        showToast('Roster confirmed')
      }
      const md = matchdays.find(m => m.id === selectedMdId)
      if (md) await loadRoster(selectedMdId, md.effective_format)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const half = halfCap(format)
  const cap = rosterCap(format)
  const totalAssigned = white.filter(s => s.kind === 'filled').length + black.filter(s => s.kind === 'filled').length
  const isReady = totalAssigned === cap
  const selectedMd = matchdays.find(m => m.id === selectedMdId)

  const filteredPlayers = allPlayers.filter(p =>
    !confirmedIds.has(p.id) &&
    p.display_name.toLowerCase().includes(playerSearch.toLowerCase())
  )

  // ── Render ────────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="rs-screen">
        <div className="rs-topbar">
          <button className="rs-back" type="button" onClick={() => navigate('/admin')}>‹</button>
          <span className="rs-title">Roster Setup</span>
        </div>
        <div className="rs-empty-state"><p>Admin only</p></div>
      </div>
    )
  }

  return (
    <div className="rs-screen">

      {/* Top bar */}
      <div className="rs-topbar">
        <button className="rs-back" type="button" onClick={() => navigate('/admin')}>‹</button>
        <span className="rs-title">Roster Setup</span>
        {draftMatch && <span className="rs-draft-badge">DRAFT</span>}
      </div>

      {/* Matchday selector */}
      <div className="rs-matchday-bar">
        <label className="rs-matchday-label" htmlFor="rs-md-select">Matchday</label>
        <select
          id="rs-md-select"
          className="rs-matchday-select"
          value={selectedMdId ?? ''}
          onChange={e => setSelectedMdId(e.target.value || null)}
        >
          {matchdays.map(md => (
            <option key={md.id} value={md.id}>{fmtDatetime(md.kickoff_at)}</option>
          ))}
        </select>
      </div>

      {loading && <div className="rs-loading">Loading…</div>}
      {error && <div className="rs-error">{error}</div>}

      {!loading && draftMatch && !draftMatch.hasResult && (
        <div className="rs-banner rs-banner--warn">
          Captain pick draft saved — tap × on a player to move them, or add/remove as needed.
        </div>
      )}
      {!loading && draftMatch?.hasResult && (
        <div className="rs-banner rs-banner--danger">
          This match already has a result recorded. Roster editing is locked.
        </div>
      )}

      {!loading && selectedMd && (
        <>
          {/* Pool */}
          <div className="rs-pool">
            <div className="rs-section-head">
              <span className="rs-section-title">
                {pool.length > 0 ? `Unassigned (${pool.length})` : 'All players assigned'}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {activeTarget && (
                  <span className="rs-target-hint">
                    → {activeTarget.team} #{activeTarget.slotIndex + 1}
                  </span>
                )}
                {!draftMatch?.hasResult && (
                  <button
                    type="button"
                    className="rs-add-player-btn"
                    onClick={() => { setPlayerSheet(true); setPlayerSearch('') }}
                  >
                    + Add player
                  </button>
                )}
              </div>
            </div>
            <div className="rs-pool-chips">
              {pool.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className={`rs-chip${activeTarget ? ' rs-chip--selectable' : ''}`}
                  onClick={() => tapChip(p)}
                >
                  {p.primary_position && (
                    <span className={`rs-chip-pos${p.primary_position === 'GK' ? ' rs-chip-pos--gk' : ''}`}>
                      {p.primary_position}
                    </span>
                  )}
                  {p.isGuest && <span className="rs-chip-guest">G</span>}
                  {p.display_name}
                </button>
              ))}
              {pool.length === 0 && <span className="rs-pool-empty">—</span>}
            </div>
          </div>

          {/* Teams */}
          <div className="rs-teams">
            {(['white', 'black'] as TeamColor[]).map(team => {
              const slots = team === 'white' ? white : black
              const count = slots.filter(s => s.kind === 'filled').length
              const isFull = count === half
              const hasEmptySlot = slots.some(s => s.kind === 'empty')
              return (
                <div key={team} className="rs-team">
                  <div className="rs-team-header">
                    <span className={`rs-team-name rs-team-name--${team}`}>
                      {team === 'white' ? 'White' : 'Black'}
                    </span>
                    <span className={`rs-team-count${isFull ? ' rs-team-count--full' : ''}`}>
                      {count} / {half}{isFull ? ' ✓' : ''}
                    </span>
                  </div>
                  {slots.map((slot, idx) => {
                    const isActive = activeTarget?.team === team && activeTarget.slotIndex === idx
                    if (slot.kind === 'filled') {
                      return (
                        <div key={idx} className="rs-slot rs-slot--filled">
                          <span className="rs-slot-num">{idx + 1}</span>
                          <span className="rs-slot-name">{slot.player.display_name}</span>
                          {slot.player.primary_position && (
                            <span className={`rs-slot-pos${slot.player.primary_position === 'GK' ? ' rs-slot-pos--gk' : ''}`}>
                              {slot.player.primary_position}
                            </span>
                          )}
                          {slot.player.isGuest && <span className="rs-slot-guest-badge">GUEST</span>}
                          {!draftMatch?.hasResult && (
                            <button
                              type="button"
                              className="rs-slot-remove"
                              onClick={() => removeSlot(team, idx)}
                              aria-label={`Remove ${slot.player.display_name}`}
                            >×</button>
                          )}
                        </div>
                      )
                    }
                    return (
                      <button
                        key={idx}
                        type="button"
                        className={`rs-slot${isActive ? ' rs-slot--active' : ''}`}
                        onClick={() => tapSlot(team, idx)}
                        aria-label={`Empty slot ${idx + 1} in ${team} team`}
                      >
                        <span className="rs-slot-num">{idx + 1}</span>
                        <span className="rs-slot-empty">
                          {isActive ? '← tap a player' : 'tap to target'}
                        </span>
                      </button>
                    )
                  })}
                  {!draftMatch?.hasResult && !isFull && !hasEmptySlot && (
                    <button
                      type="button"
                      className="rs-slot rs-slot--add"
                      onClick={() => { setGuestSheet({ team }); setGuestName('') }}
                    >
                      <span>+ Add guest</span>
                    </button>
                  )}
                  {!draftMatch?.hasResult && isFull && (
                    <button
                      type="button"
                      className="rs-guest-link"
                      onClick={() => { setGuestSheet({ team }); setGuestName('') }}
                    >
                      + Add guest
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Submit bar */}
          {!draftMatch?.hasResult && (
            <div className="rs-submit-bar">
              <div className="rs-progress">
                <span>{totalAssigned} / {cap} assigned</span>
                {isReady
                  ? <span className="rs-progress-ready">✓ Ready</span>
                  : <span>{Math.round((totalAssigned / cap) * 100)}%</span>
                }
              </div>
              <div className="rs-progress-bar">
                <div
                  className={`rs-progress-fill${isReady ? ' rs-progress-fill--full' : ''}`}
                  style={{ width: `${(totalAssigned / cap) * 100}%` }}
                />
              </div>
              <button
                type="button"
                className={`rs-btn${isReady ? ' rs-btn--primary-active' : ' rs-btn--primary'}`}
                disabled={!isReady || busy}
                onClick={handleSubmit}
              >
                {busy ? 'Saving…' : draftMatch ? 'Update Roster' : 'Confirm Roster'}
              </button>
            </div>
          )}
        </>
      )}

      {/* Add guest sheet */}
      {guestSheet && (
        <div
          className="rs-sheet-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) { setGuestSheet(null); setGuestName('') } }}
        >
          <div className="rs-sheet">
            <div className="rs-sheet-handle" />
            <div className="rs-sheet-title">Add Guest to {guestSheet.team === 'white' ? 'White' : 'Black'}</div>
            <div className="rs-sheet-subtitle">Guest name only — stats can be added later</div>
            <input
              className="rs-sheet-input"
              type="text"
              placeholder="Guest name (e.g. Younis)"
              value={guestName}
              onChange={e => setGuestName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddGuest() }}
              autoFocus
              maxLength={40}
            />
            <div className="rs-sheet-btns">
              <button
                type="button"
                className="rs-sheet-btn rs-sheet-btn--cancel"
                onClick={() => { setGuestSheet(null); setGuestName('') }}
              >Cancel</button>
              <button
                type="button"
                className="rs-sheet-btn rs-sheet-btn--add"
                disabled={!guestName.trim() || guestBusy}
                onClick={handleAddGuest}
              >
                {guestBusy ? 'Adding…' : 'Add Guest'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add player sheet */}
      {playerSheet && (
        <div
          className="rs-sheet-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) { setPlayerSheet(false); setPlayerSearch('') } }}
        >
          <div className="rs-sheet rs-sheet--tall">
            <div className="rs-sheet-handle" />
            <div className="rs-sheet-title">Add Player to Confirmed</div>
            <div className="rs-sheet-subtitle">Marks them as Yes — they'll appear in the pool above</div>
            <input
              className="rs-sheet-input"
              type="text"
              placeholder="Search players…"
              value={playerSearch}
              onChange={e => setPlayerSearch(e.target.value)}
              autoFocus
            />
            <div className="rs-player-list">
              {filteredPlayers.length === 0 && (
                <div className="rs-player-empty">
                  {playerSearch ? 'No match' : 'All registered players already confirmed'}
                </div>
              )}
              {filteredPlayers.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className="rs-player-row"
                  disabled={playerBusy === p.id}
                  onClick={() => handleAddPlayer(p)}
                >
                  <span className="rs-player-name">{p.display_name}</span>
                  {p.primary_position && (
                    <span className={`rs-chip-pos${p.primary_position === 'GK' ? ' rs-chip-pos--gk' : ''}`}>
                      {p.primary_position}
                    </span>
                  )}
                  <span className="rs-player-add">
                    {playerBusy === p.id ? '…' : '+'}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="rs-sheet-btn rs-sheet-btn--cancel"
              onClick={() => { setPlayerSheet(false); setPlayerSearch('') }}
            >Done</button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="rs-toast">{toast}</div>}
    </div>
  )
}
