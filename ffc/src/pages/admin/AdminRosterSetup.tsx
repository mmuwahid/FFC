/**
 * Admin Roster Setup — /admin/roster-setup  (Issue #20 rewrite)
 *
 * Three-phase workflow:
 *   1. Pool  — manage Unassigned / Waitlist / Removed; team slots locked
 *   2. Teams — roster locked; tap chips to auto-assign W→B→W→B
 *   3. Saved — read-only; Edit re-enters Teams phase
 *
 * Pool player statuses:
 *   unassigned — within cap, available for team assignment
 *   waitlist   — over cap; admin must manually promote to unassigned
 *   removed    — × once on unassigned/waitlist; × again deletes completely
 *
 * Team slot tracks originalStatus so removing from a slot returns the
 * player to the correct section.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/AppContext'
import type { Database } from '../../lib/database.types'

type PlayerPosition = Database['public']['Enums']['player_position']
type TeamColor = Database['public']['Enums']['team_color']
type MatchFormat = Database['public']['Enums']['match_format']
type PlayerStatus = 'unassigned' | 'waitlist' | 'removed'
type Phase = 'pool' | 'team' | 'saved'

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
  status: PlayerStatus
}

interface RegisteredPlayer {
  id: string
  display_name: string
  primary_position: PlayerPosition | null
}

type TeamSlot =
  | { kind: 'empty' }
  | { kind: 'filled'; player: PoolPlayer; originalStatus: PlayerStatus }

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

  const [phase, setPhase] = useState<Phase>('pool')
  const [nextTeam, setNextTeam] = useState<TeamColor>('white')

  const [pool, setPool] = useState<PoolPlayer[]>([])
  const [white, setWhite] = useState<TeamSlot[]>([])
  const [black, setBlack] = useState<TeamSlot[]>([])
  const [draftMatch, setDraftMatch] = useState<DraftMatch | null>(null)
  const [format, setFormat] = useState<MatchFormat>('7v7')

  // Add guest sheet
  const [guestSheet, setGuestSheet] = useState(false)
  const [guestName, setGuestName] = useState('')
  const [guestBusy, setGuestBusy] = useState(false)

  // Add player sheet
  const [playerSheet, setPlayerSheet] = useState(false)
  const [allPlayers, setAllPlayers] = useState<RegisteredPlayer[]>([])
  const [playerSearch, setPlayerSearch] = useState('')
  const [playerBusy, setPlayerBusy] = useState<string | null>(null)

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
    setPhase('pool')
    setNextTeam('white')

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

      // Assign statuses: first cap profiles = unassigned, rest = waitlist
      const profilePlayers: PoolPlayer[] = (voteRows ?? []).map((v, i) => {
        const p = v.profiles as unknown as { id: string; display_name: string; primary_position: PlayerPosition | null } | null
        return {
          id: p?.id ?? v.profile_id ?? '',
          display_name: p?.display_name ?? '—',
          primary_position: p?.primary_position ?? null,
          isGuest: false,
          status: (i < cap ? 'unassigned' : 'waitlist') as PlayerStatus,
        }
      })

      const guestPlayers: PoolPlayer[] = (guestRows ?? []).map((g) => ({
        id: g.id,
        display_name: g.display_name,
        primary_position: null,
        isGuest: true,
        guestId: g.id,
        status: 'unassigned' as PlayerStatus,
      }))

      const allCommitted = [...profilePlayers, ...guestPlayers]
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
            player = allCommitted.find(p => p.id === mp.profile_id && !p.isGuest)
            if (player) assignedProfileIds.add(mp.profile_id)
          } else if (mp.guest_id) {
            player = allCommitted.find(p => p.isGuest && p.guestId === mp.guest_id)
            if (player) assignedGuestIds.add(mp.guest_id!)
          }
          if (!player) continue
          const originalStatus = player.status
          if (mp.team === 'white' && wi < half) {
            whiteSlots[wi++] = { kind: 'filled', player, originalStatus }
          } else if (mp.team === 'black' && bi < half) {
            blackSlots[bi++] = { kind: 'filled', player, originalStatus }
          }
        }

        setWhite(whiteSlots)
        setBlack(blackSlots)
        setPool(allCommitted.filter(p =>
          !(p.isGuest ? assignedGuestIds.has(p.guestId!) : assignedProfileIds.has(p.id))
        ))
        setPhase('saved')
      } else {
        setDraftMatch(null)
        setWhite(emptyWhite)
        setBlack(emptyBlack)
        setPool(allCommitted)
        setPhase('pool')
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

  // ── Pool chip actions ─────────────────────────────────────────────────────
  function deleteFromPool(player: PoolPlayer) {
    if (player.status === 'removed') {
      setPool(prev => prev.filter(p => p.id !== player.id))
    } else {
      setPool(prev => prev.map(p => p.id === player.id ? { ...p, status: 'removed' as PlayerStatus } : p))
    }
  }

  function promoteToUnassigned(player: PoolPlayer) {
    setPool(prev => prev.map(p => p.id === player.id ? { ...p, status: 'unassigned' as PlayerStatus } : p))
  }

  // ── Phase transitions ─────────────────────────────────────────────────────
  function lockRoster() {
    const wc = white.filter(s => s.kind === 'filled').length
    const bc = black.filter(s => s.kind === 'filled').length
    setNextTeam(wc <= bc ? 'white' : 'black')
    setPhase('team')
  }

  function unlockRoster() {
    setPhase('pool')
  }

  function editRoster() {
    const wc = white.filter(s => s.kind === 'filled').length
    const bc = black.filter(s => s.kind === 'filled').length
    setNextTeam(wc <= bc ? 'white' : 'black')
    setPhase('team')
  }

  // ── Auto-assign chip to next alternating slot ─────────────────────────────
  function tapChip(player: PoolPlayer) {
    const tryOrder: TeamColor[] = nextTeam === 'white' ? ['white', 'black'] : ['black', 'white']
    for (const team of tryOrder) {
      const slots = team === 'white' ? white : black
      const emptyIdx = slots.findIndex(s => s.kind === 'empty')
      if (emptyIdx === -1) continue
      const setSlots = team === 'white' ? setWhite : setBlack
      const originalStatus = player.status
      setSlots(prev => {
        const next = [...prev]
        next[emptyIdx] = { kind: 'filled', player, originalStatus }
        return next
      })
      setPool(prev => prev.filter(p => p.id !== player.id))
      setNextTeam(team === 'white' ? 'black' : 'white')
      return
    }
  }

  // ── Remove from slot → restore original status, recalculate next team ─────
  function removeFromSlot(team: TeamColor, idx: number) {
    const slots = team === 'white' ? white : black
    const slot = slots[idx]
    if (slot.kind !== 'filled') return
    const { player, originalStatus } = slot
    const setSlots = team === 'white' ? setWhite : setBlack
    setSlots(prev => {
      const next = [...prev]
      next[idx] = { kind: 'empty' }
      return next
    })
    setPool(prev => [...prev, { ...player, status: originalStatus }])
    // The team that just lost a player is now behind — make it the next target
    setNextTeam(team)
  }

  // ── Add guest ─────────────────────────────────────────────────────────────
  async function handleAddGuest() {
    if (!selectedMdId || !guestName.trim()) return
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
        status: 'unassigned',
      }
      setPool(prev => [...prev, newGuest])
      setGuestSheet(false)
      setGuestName('')
      showToast(`${newGuest.display_name} added to pool`)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to add guest')
    } finally {
      setGuestBusy(false)
    }
  }

  // ── Add registered player ─────────────────────────────────────────────────
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
        status: 'unassigned',
      }
      setPool(prev => [...prev, newPlayer])
      showToast(`${p.display_name} added`)
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
      } else {
        const { error: err } = await supabase.rpc('create_match_draft', {
          p_matchday_id: selectedMdId,
          p_white_roster: whiteProfiles,
          p_black_roster: blackProfiles,
          p_white_guests: whiteGuests,
          p_black_guests: blackGuests,
        })
        if (err) throw err
      }
      showToast('Roster saved')

      // S058 follow-up: when admin saves a COMPLETE roster (all 14 slots
      // filled for 7v7, or 10 for 5v5) and the matchday isn't yet locked,
      // auto-lock the matchday so the Poll screen flips to its existing
      // post-lock UX (State 6 / 7 / 8 — players see "you're in/out" status,
      // cancel-vote with late-cancel penalty/ban warning, no further voting).
      const md = matchdays.find(m => m.id === selectedMdId)
      const totalAssigned =
        white.filter(s => s.kind === 'filled').length +
        black.filter(s => s.kind === 'filled').length
      const isComplete = totalAssigned === rosterCap(format)
      if (md && !md.roster_locked_at && isComplete) {
        const { error: lockErr } = await supabase.rpc('lock_roster', { p_matchday_id: selectedMdId })
        if (lockErr && !/already_locked/i.test(lockErr.message)) {
          // Save succeeded but lock failed — surface as a non-blocking warning
          // (admin can retry the lock from AdminMatches → "Lock roster").
          setError('Saved, but lock failed: ' + lockErr.message)
        } else {
          // Optimistic local update — no full re-fetch of matchdays needed.
          setMatchdays(prev => prev.map(m =>
            m.id === selectedMdId ? { ...m, roster_locked_at: new Date().toISOString() } : m
          ))
          showToast('Roster locked — Poll screen will now show locked state')
        }
      }

      // Reload to get updated draftMatch.id (if newly created)
      if (md) await loadRoster(selectedMdId, md.effective_format)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const half = halfCap(format)
  const cap = rosterCap(format)
  const unassigned = pool.filter(p => p.status === 'unassigned')
  const waitlisted = pool.filter(p => p.status === 'waitlist')
  const removedPlayers = pool.filter(p => p.status === 'removed')
  const totalAssigned = white.filter(s => s.kind === 'filled').length + black.filter(s => s.kind === 'filled').length
  const isReady = totalAssigned === cap
  const selectedMd = matchdays.find(m => m.id === selectedMdId)
  const isReadOnly = draftMatch?.hasResult ?? false

  // confirmedIds: all profile IDs currently in pool or in slots (any status)
  const confirmedIds = new Set<string>([
    ...pool.filter(p => !p.isGuest).map(p => p.id),
    ...white.flatMap(s => s.kind === 'filled' && !s.player.isGuest ? [s.player.id] : []),
    ...black.flatMap(s => s.kind === 'filled' && !s.player.isGuest ? [s.player.id] : []),
  ])
  const filteredPlayers = allPlayers.filter(p =>
    !confirmedIds.has(p.id) &&
    p.display_name.toLowerCase().includes(playerSearch.toLowerCase())
  )

  // Next empty slot index per team (for active-slot highlight)
  const nextWhiteIdx = white.findIndex(s => s.kind === 'empty')
  const nextBlackIdx = black.findIndex(s => s.kind === 'empty')
  const nextHint = nextTeam === 'white'
    ? (nextWhiteIdx >= 0 ? `→ next: White #${nextWhiteIdx + 1}` : (nextBlackIdx >= 0 ? `→ next: Black #${nextBlackIdx + 1}` : null))
    : (nextBlackIdx >= 0 ? `→ next: Black #${nextBlackIdx + 1}` : (nextWhiteIdx >= 0 ? `→ next: White #${nextWhiteIdx + 1}` : null))

  // ── Guard ─────────────────────────────────────────────────────────────────
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

  // ── Slot renderer (filled + empty variants) ───────────────────────────────
  function renderSlotFilled(slot: { kind: 'filled'; player: PoolPlayer; originalStatus: PlayerStatus }, idx: number, team: TeamColor, editable: boolean) {
    return (
      <div key={idx} className="rs-slot rs-slot--filled">
        <span className="rs-slot-num">{idx + 1}</span>
        <span className="rs-slot-name-group">
          <span className="rs-slot-name">{slot.player.display_name}</span>
          {editable && (
            <button
              type="button"
              className="rs-slot-remove"
              onClick={() => removeFromSlot(team, idx)}
              aria-label={`Remove ${slot.player.display_name}`}
            >×</button>
          )}
        </span>
        {slot.player.primary_position && (
          <span className={`rs-slot-pos${slot.player.primary_position === 'GK' ? ' rs-slot-pos--gk' : ''}`}>
            {slot.player.primary_position}
          </span>
        )}
        {slot.player.isGuest && <span className="rs-slot-guest-badge">G</span>}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="rs-screen">

      {/* Top bar */}
      <div className="rs-topbar">
        <button className="rs-back" type="button" onClick={() => navigate('/admin')}>‹</button>
        <span className="rs-title">Roster Setup</span>
        {phase === 'saved' && !isReadOnly && (
          <span className="rs-badge rs-badge--saved">SAVED</span>
        )}
        {isReadOnly && (
          <span className="rs-badge rs-badge--locked">LOCKED</span>
        )}
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

      {!loading && selectedMd && (
        <>
          {/* Phase indicator */}
          {!isReadOnly && (
            <div className="rs-phase-bar">
              {(['pool', 'team', 'saved'] as Phase[]).map((step, i) => {
                const label = ['Pool', 'Teams', 'Save'][i]
                const phases: Phase[] = ['pool', 'team', 'saved']
                const stepIdx = phases.indexOf(step)
                const currentIdx = phases.indexOf(phase)
                const isDone = stepIdx < currentIdx
                const isActive = stepIdx === currentIdx
                return (
                  <span key={step} style={{ display: 'contents' }}>
                    <div className={`rs-phase-step${isDone ? ' rs-phase-step--done' : isActive ? ' rs-phase-step--active' : ''}`}>
                      <div className="rs-phase-dot">{isDone ? '✓' : stepIdx + 1}</div>
                      <span>{label}</span>
                    </div>
                    {i < 2 && <div className="rs-phase-divider" />}
                  </span>
                )
              })}
            </div>
          )}

          {isReadOnly && (
            <div className="rs-banner rs-banner--danger">
              This match has a result recorded. Roster is locked.
            </div>
          )}

          {/* ═══════════════ POOL PHASE ═══════════════ */}
          {!isReadOnly && phase === 'pool' && (
            <>
              {/* Unassigned */}
              <div className="rs-pool-section">
                <div className="rs-section-head">
                  <span className="rs-section-title">Unassigned ({unassigned.length})</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="rs-add-player-btn"
                      onClick={() => { setGuestSheet(true); setGuestName('') }}
                    >+ Add guest</button>
                    <button
                      type="button"
                      className="rs-add-player-btn"
                      onClick={() => { setPlayerSheet(true); setPlayerSearch('') }}
                    >+ Add player</button>
                  </div>
                </div>
                <div className="rs-pool-chips">
                  {unassigned.map(p => (
                    <div key={p.id} className="rs-chip">
                      {p.primary_position && (
                        <span className={`rs-chip-pos${p.primary_position === 'GK' ? ' rs-chip-pos--gk' : ''}`}>
                          {p.primary_position}
                        </span>
                      )}
                      {p.isGuest && <span className="rs-chip-guest">G</span>}
                      {p.display_name}
                      <button
                        type="button"
                        className="rs-chip-action rs-chip-action--remove"
                        onClick={() => deleteFromPool(p)}
                        aria-label={`Remove ${p.display_name}`}
                      >×</button>
                    </div>
                  ))}
                  {unassigned.length === 0 && (
                    <span className="rs-pool-empty">No unassigned players</span>
                  )}
                </div>
              </div>

              {/* Waitlist */}
              {waitlisted.length > 0 && (
                <>
                  <hr className="rs-pool-divider" />
                  <div className="rs-pool-section">
                    <div className="rs-section-head">
                      <span className="rs-section-title rs-section-title--waitlist">Waitlist ({waitlisted.length})</span>
                    </div>
                    <div className="rs-pool-chips">
                      {waitlisted.map(p => (
                        <div key={p.id} className="rs-chip rs-chip--waitlist">
                          {p.primary_position && (
                            <span className={`rs-chip-pos${p.primary_position === 'GK' ? ' rs-chip-pos--gk' : ''}`}>
                              {p.primary_position}
                            </span>
                          )}
                          {p.display_name}
                          <button
                            type="button"
                            className="rs-chip-action rs-chip-action--promote"
                            onClick={() => promoteToUnassigned(p)}
                            aria-label={`Promote ${p.display_name} to unassigned`}
                            title="Move to Unassigned"
                          >↑</button>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Removed */}
              {removedPlayers.length > 0 && (
                <>
                  <hr className="rs-pool-divider" />
                  <div className="rs-pool-section">
                    <div className="rs-section-head">
                      <span className="rs-section-title rs-section-title--removed">Removed ({removedPlayers.length})</span>
                    </div>
                    <div className="rs-pool-chips">
                      {removedPlayers.map(p => (
                        <div key={p.id} className="rs-chip rs-chip--removed">
                          {p.primary_position && (
                            <span className={`rs-chip-pos${p.primary_position === 'GK' ? ' rs-chip-pos--gk' : ''}`}>
                              {p.primary_position}
                            </span>
                          )}
                          {p.display_name}
                          <button
                            type="button"
                            className="rs-chip-action rs-chip-action--remove"
                            onClick={() => deleteFromPool(p)}
                            aria-label={`Delete ${p.display_name} completely`}
                            title="Remove completely"
                          >×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Lock button */}
              <div className="rs-lock-bar">
                <button
                  type="button"
                  className="rs-lock-btn rs-lock-btn--lock"
                  onClick={lockRoster}
                  disabled={unassigned.length === 0}
                >
                  🔒 Lock Roster — Start Team Assignment
                </button>
              </div>

              {/* Teams: greyed / locked */}
              <div className="rs-teams-header">
                <span className="rs-teams-label">Teams — locked</span>
              </div>
              <div className="rs-teams">
                {(['white', 'black'] as TeamColor[]).map(team => {
                  const slots = team === 'white' ? white : black
                  return (
                    <div key={team} className="rs-team">
                      <div className="rs-team-header">
                        <span className={`rs-team-name rs-team-name--${team}`}>
                          {team === 'white' ? 'White' : 'Black'}
                        </span>
                        <span className="rs-team-count">0 / {half}</span>
                      </div>
                      {slots.map((_, idx) => (
                        <div key={idx} className="rs-slot rs-slot--locked">
                          <span className="rs-slot-num">{idx + 1}</span>
                          <span className="rs-slot-empty">locked</span>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* ═══════════════ TEAM PHASE ═══════════════ */}
          {!isReadOnly && phase === 'team' && (
            <>
              {/* Lock status + Unlock */}
              <div className="rs-lock-status-bar">
                <span className="rs-lock-status-label">🔒 Roster Locked</span>
                <button type="button" className="rs-unlock-btn" onClick={unlockRoster}>
                  Unlock
                </button>
              </div>

              {/* Unassigned chips (selectable) */}
              <div className="rs-pool-section">
                <div className="rs-section-head">
                  <span className="rs-section-title">Unassigned ({unassigned.length})</span>
                  {nextHint && unassigned.length > 0 && (
                    <span className="rs-auto-hint">{nextHint}</span>
                  )}
                </div>
                <div className="rs-pool-chips">
                  {unassigned.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      className="rs-chip rs-chip--selectable"
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
                  {unassigned.length === 0 && (
                    <span className="rs-pool-empty">All players assigned ✓</span>
                  )}
                </div>
              </div>

              {/* Teams: interactive */}
              <div className="rs-teams-header">
                <span className="rs-teams-label">Teams</span>
              </div>
              <div className="rs-teams">
                {(['white', 'black'] as TeamColor[]).map(team => {
                  const slots = team === 'white' ? white : black
                  const count = slots.filter(s => s.kind === 'filled').length
                  const isFull = count === half
                  const firstEmptyIdx = slots.findIndex(s => s.kind === 'empty')
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
                        if (slot.kind === 'filled') {
                          return renderSlotFilled(slot, idx, team, true)
                        }
                        const isNext = nextTeam === team && idx === firstEmptyIdx
                        return (
                          <div key={idx} className={`rs-slot${isNext ? ' rs-slot--active' : ''}`}>
                            <span className="rs-slot-num">{idx + 1}</span>
                            <span className="rs-slot-empty">{isNext ? '← next' : '—'}</span>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>

              {/* Submit bar */}
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
            </>
          )}

          {/* ═══════════════ SAVED / READ-ONLY ═══════════════ */}
          {(isReadOnly || phase === 'saved') && (
            <>
              {!isReadOnly && (
                <div className="rs-banner rs-banner--info">
                  Roster saved. Tap Edit to make changes.
                </div>
              )}

              <div className="rs-teams-header">
                <span className="rs-teams-label">Confirmed Roster</span>
              </div>
              <div className="rs-teams">
                {(['white', 'black'] as TeamColor[]).map(team => {
                  const slots = team === 'white' ? white : black
                  const count = slots.filter(s => s.kind === 'filled').length
                  const isFull = count === half
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
                        if (slot.kind === 'filled') {
                          return renderSlotFilled(slot, idx, team, false)
                        }
                        return (
                          <div key={idx} className="rs-slot rs-slot--filled" style={{ opacity: 0.3 }}>
                            <span className="rs-slot-num">{idx + 1}</span>
                            <span className="rs-slot-empty">—</span>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>

              {!isReadOnly && (
                <div className="rs-submit-bar">
                  <div className="rs-progress">
                    <span>{totalAssigned} / {cap} assigned</span>
                    <span className="rs-progress-ready">✓ Saved</span>
                  </div>
                  <div className="rs-progress-bar">
                    <div className="rs-progress-fill rs-progress-fill--full" style={{ width: '100%' }} />
                  </div>
                  <div className="rs-btn-row">
                    <button type="button" className="rs-btn rs-btn--secondary" onClick={editRoster}>
                      Edit
                    </button>
                    <button type="button" className="rs-btn rs-btn--primary-active" disabled>
                      Saved ✓
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Add guest sheet */}
      {guestSheet && (
        <div
          className="rs-sheet-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) { setGuestSheet(false); setGuestName('') } }}
        >
          <div className="rs-sheet">
            <div className="rs-sheet-handle" />
            <div className="rs-sheet-title">Add Guest</div>
            <div className="rs-sheet-subtitle">Added to unassigned pool — stats can be added later</div>
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
                onClick={() => { setGuestSheet(false); setGuestName('') }}
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
            <div className="rs-sheet-subtitle">Marks them as Yes — added to unassigned pool</div>
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
