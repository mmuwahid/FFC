/**
 * §3.19 Formation Planner — Slices A+B.
 *
 * Per-team tactical board, shared read-only across the team, editable by
 * the team's captain.
 *
 * Slice A (foundation):
 *   • Loads matchday + match_players + profiles/guests + effective_format
 *   • Resolves my role (participant on team WHITE/BLACK, captain Y/N, or outsider)
 *   • Team-coloured header strip
 *   • Pattern chip picker (format-filtered)
 *   • Pitch SVG with tokens positioned from the selected preset
 *   • Save wired to upsert_formation(matchday, team, pattern, layout_jsonb)
 *
 * Slice B (drag-drop + custom mode):
 *   • Per-slot positions held in live state, initialized from selected preset.
 *   • Captain can drag any token with pointer (mouse + touch); first drag
 *     switches the pattern to 'custom'. Named patterns snap back to their
 *     preset coords on re-select.
 *   • Custom chip is activatable; 'Reset to preset' restores last named.
 *   • Save uses the live positions (so custom layouts persist verbatim).
 *
 * Deferred to later slices:
 *   • Rotating-GK toggle + starting-GK picker (UI stubbed, no persistence)
 *   • Realtime subscription on formations for non-captain live view
 *   • share_formation + "last synced" chip + captain's notes persistence
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useApp } from '../lib/AppContext'
import { supabase } from '../lib/supabase'
import {
  CUSTOM_PATTERN,
  type FormationMatchFormat,
  type FormationPositionLabel,
  type FormationPreset,
  type FormationSlot,
  getPreset,
  presetsForFormat,
  rosterSizeForFormat,
} from '../lib/formationPresets'
import type { Database } from '../lib/database.types'

type TeamColor = Database['public']['Enums']['team_color']
type PlayerPosition = Database['public']['Enums']['player_position']

interface RosterEntry {
  kind: 'member' | 'guest'
  id: string // match_players.id
  player_id: string // profile_id OR guest_id
  display_name: string
  primary_position: PlayerPosition | null
  team: TeamColor
  is_captain: boolean
  initials: string
}

interface MatchdayLite {
  id: string
  kickoff_at: string
  venue: string | null
  roster_locked_at: string | null
}

interface MatchLite {
  id: string
  matchday_id: string
}

interface FormationRow {
  id: string
  pattern: string
  layout_jsonb: unknown
  shared_at: string | null
  last_edited_at: string
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '–'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function kickoffLabel(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false })
  return `${date} · kickoff ${time}`
}

function hoursToKickoff(iso: string): string {
  const hours = (new Date(iso).getTime() - Date.now()) / 3_600_000
  if (hours < 0) return 'already played'
  if (hours < 1) return `${Math.round(hours * 60)}m to go`
  if (hours < 48) return `${Math.round(hours)}h to go`
  return `${Math.round(hours / 24)}d to go`
}

export function FormationPlanner() {
  const navigate = useNavigate()
  const { id: matchId } = useParams<{ id: string }>()
  const { profileId } = useApp()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [matchday, setMatchday] = useState<MatchdayLite | null>(null)
  const [, setMatch] = useState<MatchLite | null>(null)
  const [format, setFormat] = useState<FormationMatchFormat>('7v7')
  const [myRoster, setMyRoster] = useState<RosterEntry[]>([])
  const [myRosterEntry, setMyRosterEntry] = useState<RosterEntry | null>(null)
  const [existingFormation, setExistingFormation] = useState<FormationRow | null>(null)

  const [pattern, setPattern] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  // Live per-slot positions (x/y/pos). Initialized from the active preset
  // on pattern change; mutated in place by drag handlers when the captain
  // repositions a token. On drag, `pattern` flips to CUSTOM_PATTERN.
  const [liveSlots, setLiveSlots] = useState<FormationSlot[]>([])
  // Remember the last named (non-custom) pattern so "Reset to preset" can
  // restore it after free-drag edits. Preserved across pattern switches.
  const [lastNamedPattern, setLastNamedPattern] = useState<string>('')
  const pitchRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{ slotIdx: number; pointerId: number } | null>(null)

  const loadAll = useCallback(async () => {
    if (!matchId) return
    setLoading(true)
    setError(null)

    const { data: matchRow, error: matchErr } = await supabase
      .from('matches')
      .select('id, matchday_id')
      .eq('id', matchId)
      .maybeSingle()
    if (matchErr) { setError(matchErr.message); setLoading(false); return }
    if (!matchRow) { setError('Match not found'); setLoading(false); return }
    setMatch(matchRow)

    const { data: mdRow, error: mdErr } = await supabase
      .from('matchdays')
      .select('id, kickoff_at, venue, roster_locked_at')
      .eq('id', matchRow.matchday_id)
      .maybeSingle()
    if (mdErr) { setError(mdErr.message); setLoading(false); return }
    if (!mdRow) { setError('Matchday not found'); setLoading(false); return }
    setMatchday(mdRow)

    const { data: fmt } = await supabase.rpc('effective_format', { p_matchday_id: mdRow.id })
    const effective = (typeof fmt === 'string' ? fmt : '7v7') as FormationMatchFormat
    setFormat(effective)

    // Roster — every match_players row, then hydrate profile/guest names.
    const { data: mpRows, error: mpErr } = await supabase
      .from('match_players')
      .select('id, profile_id, guest_id, team, is_captain')
      .eq('match_id', matchRow.id)
    if (mpErr) { setError(mpErr.message); setLoading(false); return }

    const profileIds = (mpRows ?? []).map((r) => r.profile_id).filter((x): x is string => !!x)
    const guestIds = (mpRows ?? []).map((r) => r.guest_id).filter((x): x is string => !!x)

    const [profRes, guestRes] = await Promise.all([
      profileIds.length
        ? supabase.from('profiles').select('id, display_name, primary_position').in('id', profileIds)
        : Promise.resolve({ data: [] }),
      guestIds.length
        ? supabase.from('match_guests').select('id, display_name, primary_position').in('id', guestIds)
        : Promise.resolve({ data: [] }),
    ])

    const profMap = new Map<string, { display_name: string; primary_position: PlayerPosition | null }>()
    for (const p of profRes.data ?? []) profMap.set(p.id, { display_name: p.display_name, primary_position: p.primary_position })
    const guestMap = new Map<string, { display_name: string; primary_position: PlayerPosition | null }>()
    for (const g of guestRes.data ?? []) guestMap.set(g.id, { display_name: g.display_name, primary_position: g.primary_position })

    const roster: RosterEntry[] = (mpRows ?? []).map((r) => {
      const kind: 'member' | 'guest' = r.profile_id ? 'member' : 'guest'
      const info = kind === 'member' ? profMap.get(r.profile_id!) : guestMap.get(r.guest_id!)
      const display_name = info?.display_name ?? '—'
      return {
        kind,
        id: r.id,
        player_id: (r.profile_id ?? r.guest_id) as string,
        display_name,
        primary_position: info?.primary_position ?? null,
        team: r.team as TeamColor,
        is_captain: r.is_captain,
        initials: initialsOf(display_name),
      }
    })

    // Am I on the roster?
    const mine = profileId ? roster.find((e) => e.kind === 'member' && e.player_id === profileId) ?? null : null
    setMyRosterEntry(mine)
    setMyRoster(mine ? roster.filter((e) => e.team === mine.team) : [])

    // Existing formation for my team (if any).
    if (mine) {
      const { data: fRow } = await supabase
        .from('formations')
        .select('id, pattern, layout_jsonb, shared_at, last_edited_at')
        .eq('matchday_id', mdRow.id)
        .eq('team', mine.team)
        .maybeSingle()
      if (fRow) {
        setExistingFormation(fRow as FormationRow)
        setPattern(fRow.pattern)
        // If the persisted pattern is custom, hydrate liveSlots from the
        // saved layout — the useEffect that syncs from preset short-circuits
        // on custom, so we have to populate it directly here.
        if (fRow.pattern === CUSTOM_PATTERN && Array.isArray(fRow.layout_jsonb)) {
          const saved = (fRow.layout_jsonb as Array<{ x: number; y: number; pos_label: FormationPositionLabel }>).map((row) => ({
            pos: row.pos_label,
            x: row.x,
            y: row.y,
          }))
          setLiveSlots(saved)
        }
      } else {
        setExistingFormation(null)
        setPattern(presetsForFormat(effective)[0]?.pattern ?? '')
      }
    }

    setLoading(false)
  }, [matchId, profileId])

  useEffect(() => { void loadAll() }, [loadAll])

  const presets = useMemo(() => presetsForFormat(format), [format])
  const selectedPreset: FormationPreset | null = useMemo(() => {
    if (pattern === CUSTOM_PATTERN) return null
    return getPreset(pattern, format)
  }, [pattern, format])

  // When the selected named pattern changes (not custom), sync liveSlots to
  // its preset coords and remember it as the "last named" fallback. In
  // custom mode, liveSlots is left alone (captain owns the layout).
  useEffect(() => {
    if (pattern === CUSTOM_PATTERN) return
    const preset = getPreset(pattern, format)
    if (!preset) {
      setLiveSlots([])
      return
    }
    setLiveSlots(preset.slots.map((s) => ({ ...s })))
    setLastNamedPattern(pattern)
  }, [pattern, format])

  // Map roster entries to slot indices. GK slot = first preset slot; we try to
  // pick a roster entry whose primary_position === 'GK'. Remaining slots fill
  // in roster order. The captain row lands on slot 0 only if it's the GK match.
  const slotAssignments = useMemo(() => {
    if (liveSlots.length === 0 || myRoster.length === 0) return [] as (RosterEntry | null)[]
    const roster = [...myRoster]
    const assignments: (RosterEntry | null)[] = Array(liveSlots.length).fill(null)

    const gkIdx = roster.findIndex((r) => r.primary_position === 'GK')
    if (gkIdx >= 0) {
      assignments[0] = roster[gkIdx]
      roster.splice(gkIdx, 1)
    } else if (roster.length) {
      assignments[0] = roster.shift() ?? null
    }

    for (let i = 1; i < liveSlots.length && roster.length; i += 1) {
      assignments[i] = roster.shift() ?? null
    }
    return assignments
  }, [liveSlots, myRoster])

  // Hoisted captain flag — referenced by drag callbacks below AND the
  // later render body (which used to declare its own `isCaptain`).
  const isCaptain = !!myRosterEntry?.is_captain

  // ─── Drag: captain repositions a token ─────────────────────────
  // Coords math: the pitch container is the drop target. Its bounding rect
  // gives pixel-space; we convert pointer (clientX, clientY) → percent of
  // the container, then map into viewBox coords (x 0..100, y 0..150).

  const onTokenPointerDown = useCallback((slotIdx: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isCaptain) return
    if (!pitchRef.current) return
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    dragStateRef.current = { slotIdx, pointerId: e.pointerId }
  }, [isCaptain])

  const onTokenPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current
    if (!state || state.pointerId !== e.pointerId) return
    const rect = pitchRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return
    // viewBox is 100 × 150; container has the same aspect ratio.
    const xPct = Math.max(2, Math.min(98, ((e.clientX - rect.left) / rect.width) * 100))
    const yPct = Math.max(4, Math.min(146, ((e.clientY - rect.top) / rect.height) * 150))
    setLiveSlots((prev) => {
      if (prev.length === 0) return prev
      const next = prev.map((s) => ({ ...s }))
      next[state.slotIdx] = { ...next[state.slotIdx], x: xPct, y: yPct }
      return next
    })
    // Switch to custom mode on first movement. Chip state reflects it.
    if (pattern !== CUSTOM_PATTERN) setPattern(CUSTOM_PATTERN)
  }, [pattern])

  const onTokenPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current
    if (!state || state.pointerId !== e.pointerId) return
    ;(e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId)
    dragStateRef.current = null
  }, [])

  const resetToLastNamed = useCallback(() => {
    if (!lastNamedPattern) return
    setPattern(lastNamedPattern)
  }, [lastNamedPattern])

  const onSave = useCallback(async () => {
    if (!matchday || !myRosterEntry || liveSlots.length === 0) return
    setSaving(true)
    setError(null)
    // Save the LIVE positions so custom drags are preserved verbatim. For
    // named patterns liveSlots === preset.slots, so behaviour is unchanged.
    const layout = liveSlots.map((slot, i) => {
      const entry = slotAssignments[i]
      return {
        slot: i,
        pos_label: slot.pos,
        x: slot.x,
        y: slot.y,
        kind: entry?.kind ?? null,
        player_id: entry?.player_id ?? null,
      }
    })
    const args = {
      p_matchday_id: matchday.id,
      p_team: myRosterEntry.team,
      p_pattern: pattern,
      p_layout_jsonb: layout,
      p_rotation_order: null as unknown as null,
      p_starting_gk_profile_id: null as unknown as null,
    }
    const { error: rpcErr } = await supabase.rpc('upsert_formation', args)
    setSaving(false)
    if (rpcErr) { setError(rpcErr.message); return }
    setSavedAt(new Date().toISOString())
    await loadAll()
  }, [matchday, myRosterEntry, liveSlots, pattern, slotAssignments, loadAll])

  // ─── Render ────────────────────────────────────────────────────

  if (loading) {
    return <div className="fp-shell"><div className="fp-loading">Loading formation…</div></div>
  }
  if (error) {
    return (
      <div className="fp-shell">
        <div className="fp-error">{error}</div>
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={() => navigate(-1)}>Back</button>
      </div>
    )
  }
  if (!matchday) {
    return <div className="fp-shell"><div className="fp-error">Matchday missing</div></div>
  }
  if (!myRosterEntry) {
    return (
      <div className="fp-shell">
        <div className="fp-gate">
          <h2>Formation planner</h2>
          <p>You're not on the roster for this match, so you don't have access to the formation view yet.</p>
          <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={() => navigate(-1)}>Back</button>
        </div>
      </div>
    )
  }

  const team = myRosterEntry.team
  const captainName = myRoster.find((r) => r.is_captain)?.display_name ?? null
  const teamSize = rosterSizeForFormat(format)
  const isCustom = pattern === CUSTOM_PATTERN

  return (
    <div className={`fp-shell fp-shell--${team}`}>
      <header className={`fp-team-strip fp-team-strip--${team}`}>
        <span className="fp-team-orb" aria-hidden>{team === 'white' ? '⚪' : '⚫'}</span>
        <div className="fp-team-txt">
          <div className="fp-team-pre">You're on</div>
          <div className="fp-team-name">{team === 'white' ? 'WHITE team' : 'BLACK team'}</div>
          <div className="fp-team-meta">{kickoffLabel(matchday.kickoff_at)} · {hoursToKickoff(matchday.kickoff_at)}</div>
        </div>
      </header>

      <div className="fp-nav-top">
        <button type="button" className="fp-back" onClick={() => navigate(-1)} aria-label="Back">‹</button>
        <div className="fp-title">
          <span className="fp-title-lead">Formation</span>
          <span className="fp-title-sub">{isCaptain ? 'You are captain' : captainName ? `Captain · ${captainName}` : 'Read-only view'}</span>
        </div>
        <span className="fp-fmt-chip">{format.toUpperCase()}</span>
      </div>

      <div className="fp-pattern-row" role="tablist" aria-label="Formation pattern">
        {presets.map((p) => {
          const active = p.pattern === pattern
          return (
            <button
              key={p.pattern}
              type="button"
              role="tab"
              aria-selected={active}
              className={`fp-chip${active ? ' fp-chip--active' : ''}`}
              disabled={!isCaptain || saving}
              onClick={() => isCaptain && setPattern(p.pattern)}
            >
              <span className="fp-chip-label">{p.label}</span>
              <span className="fp-chip-tag">{p.tag}</span>
            </button>
          )
        })}
        <button
          type="button"
          role="tab"
          aria-selected={isCustom}
          className={`fp-chip fp-chip--custom${isCustom ? ' fp-chip--active' : ''}`}
          disabled={!isCaptain || saving}
          onClick={() => isCaptain && setPattern(CUSTOM_PATTERN)}
          title="Drag tokens freely on the pitch"
        >
          <span className="fp-chip-label">Custom</span>
          <span className="fp-chip-tag">Free drag</span>
        </button>
      </div>

      <div className="fp-pitch-wrap" ref={pitchRef}>
        <svg className="fp-pitch-svg" viewBox="0 0 100 150" preserveAspectRatio="none" aria-hidden>
          <rect className="fp-stripe" x="0" y="0" width="100" height="15" />
          <rect className="fp-stripe" x="0" y="30" width="100" height="15" />
          <rect className="fp-stripe" x="0" y="60" width="100" height="15" />
          <rect className="fp-stripe" x="0" y="90" width="100" height="15" />
          <rect className="fp-stripe" x="0" y="120" width="100" height="15" />
          <rect className="fp-line" x="2" y="2" width="96" height="146" rx="1" />
          <line className="fp-line" x1="2" y1="75" x2="98" y2="75" />
          <circle className="fp-line" cx="50" cy="75" r="10" />
          <circle className="fp-dot" cx="50" cy="75" r="0.9" />
          <rect className="fp-line" x="25" y="2" width="50" height="18" />
          <rect className="fp-line" x="38" y="2" width="24" height="7" />
          <rect className="fp-line" x="25" y="130" width="50" height="18" />
          <rect className="fp-line" x="38" y="141" width="24" height="7" />
          <rect className="fp-goal" x="42" y="0" width="16" height="2" />
          <rect className="fp-goal" x="42" y="148" width="16" height="2" />
        </svg>
        <div className="fp-tokens" aria-label="Formation tokens">
          {liveSlots.map((slot, i) => {
            const entry = slotAssignments[i]
            const isGk = i === 0
            const draggable = isCaptain
            return (
              <div
                key={i}
                className={`fp-tok fp-tok--${team}${isGk ? ' fp-tok--gk' : ''}${entry ? '' : ' fp-tok--empty'}${draggable ? ' fp-tok--draggable' : ''}`}
                style={{ left: `${slot.x}%`, top: `${(slot.y / 150) * 100}%`, touchAction: draggable ? 'none' : undefined }}
                title={entry ? entry.display_name : `Unassigned · ${slot.pos}`}
                onPointerDown={draggable ? onTokenPointerDown(i) : undefined}
                onPointerMove={draggable ? onTokenPointerMove : undefined}
                onPointerUp={draggable ? onTokenPointerUp : undefined}
                onPointerCancel={draggable ? onTokenPointerUp : undefined}
              >
                <span className="fp-tok-init">{entry?.initials ?? '?'}</span>
                <span className="fp-tok-label">{slot.pos}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="fp-roster">
        <div className="fp-roster-head">
          <span className="fp-roster-lbl">{team === 'white' ? 'White' : 'Black'} roster</span>
          <span className="fp-roster-cnt">{myRoster.length} / {teamSize}</span>
        </div>
        <ul className="fp-roster-list">
          {myRoster.map((r) => (
            <li key={r.id} className="fp-roster-item">
              <span className="fp-roster-avatar">{r.initials}</span>
              <span className="fp-roster-name">
                {r.display_name}
                {r.kind === 'guest' && <span className="fp-roster-plus"> (+1)</span>}
                {r.is_captain && <span className="fp-roster-cap"> · C</span>}
              </span>
              {r.primary_position && <span className={`fp-pos-pill fp-pos-pill--${r.primary_position.toLowerCase()}`}>{r.primary_position}</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="fp-footer">
        {existingFormation?.shared_at && (
          <div className="fp-footer-meta">Shared {new Date(existingFormation.shared_at).toLocaleString()}</div>
        )}
        {!existingFormation?.shared_at && existingFormation && (
          <div className="fp-footer-meta">Draft · last edited {new Date(existingFormation.last_edited_at).toLocaleString()}</div>
        )}
        {savedAt && !existingFormation && (
          <div className="fp-footer-meta">Saved {new Date(savedAt).toLocaleString()}</div>
        )}
        {isCaptain && isCustom && lastNamedPattern && (
          <button
            type="button"
            className="auth-btn auth-btn--sheet-cancel fp-reset-btn"
            onClick={resetToLastNamed}
            disabled={saving}
          >
            ↻ Reset to {lastNamedPattern}
          </button>
        )}
        {isCaptain ? (
          <button
            type="button"
            className="auth-btn auth-btn--approve fp-save-btn"
            onClick={() => void onSave()}
            disabled={saving || liveSlots.length === 0}
          >
            {saving ? 'Saving…' : existingFormation ? 'Save changes' : 'Save formation'}
          </button>
        ) : (
          <button type="button" className="auth-btn auth-btn--sheet-cancel fp-save-btn" disabled>
            Captain-only
          </button>
        )}
      </div>
    </div>
  )
}
