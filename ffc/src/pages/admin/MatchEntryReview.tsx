// ffc/src/pages/admin/MatchEntryReview.tsx
//
// §B.4 — Admin Match-Entry Review screen at /admin/match-entries/:id.
//
// Slice 2B-F scope:
//   - Loads pending_match_entries row + per-player aggregates + event log + matchday header
//   - Renders read-only player grid + chronological event log with per-row drop affordance
//   - Match-level inline editable fields: score_white, score_black, motm_user_id, motm_guest_id, notes
//   - APPROVE → approve_match_entry({ p_pending_id, p_edits })
//   - REJECT  → reject_match_entry({ p_pending_id, p_reason })
//   - DROP single event → admin_drop_pending_match_event({ p_event_id }) (migration 0032)
//
// Deferred (NOT in this slice):
//   - Per-player aggregate edit-before-approve (post-approval edit_match_players covers it)
//   - Realtime subscription on pending_match_entries (needs ALTER PUBLICATION first)

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'
import '../../styles/match-entry-review.css'

type TeamColor = Database['public']['Enums']['team_color']
type MatchEventType = Database['public']['Enums']['match_event_type']
type MatchResult = Database['public']['Enums']['match_result']

type PendingEntryRow = Database['public']['Tables']['pending_match_entries']['Row']
type PendingPlayerRow = Database['public']['Tables']['pending_match_entry_players']['Row']
type PendingEventRow = Database['public']['Tables']['pending_match_events']['Row']

interface PlayerLite {
  id: string
  display_name: string
}
interface GuestLite {
  id: string
  display_name: string
}

interface ScreenData {
  entry: PendingEntryRow
  players: PendingPlayerRow[]
  events: PendingEventRow[]
  matchday: {
    id: string
    kickoff_at: string
    format: 'cancelled' | '7v7' | '5v5' | null
  }
  profilesById: Map<string, PlayerLite>
  guestsById: Map<string, GuestLite>
}

// ─── Helpers ───────────────────────────────────────────────────

function timeOnly(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
}

function formatMSS(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatMatchMinute(minute: number, second: number, _regulationHalf: number): string {
  // Regulation: 0..(regHalf-1) → "M'", regHalf..regHalf*2-1 → "M'"
  // Stoppage 1st half: minute >= regHalf and < regHalf*2 → reads as "regHalf+N'"
  // We can't tell stoppage from regulation 2nd-half from minute alone, so we
  // rely on a simple rule: if minute in [regHalf, regHalf*2), it's
  // 2nd-half regulation. If >= regHalf*2, 2nd-half stoppage.
  // 1st-half stoppage events are stored with minute = regHalf, regHalf+1, etc.
  // BUT they were captured during 1st half. The pending_match_events table has
  // no 'half' column; we infer from event order vs the halftime/fulltime events.
  // For now, render as plain "M'M:SS" — refining stoppage notation is a polish
  // item. Match-second precision is preserved for sort stability.
  if (second === 0) return `${minute}'`
  return `${minute}'${String(second).padStart(2, '0')}`
}

function eventDescription(
  e: PendingEventRow,
  profiles: Map<string, PlayerLite>,
  guests: Map<string, GuestLite>,
): string {
  const teamLabel = e.team ? e.team.toUpperCase() : ''
  const participantName = e.profile_id
    ? (profiles.get(e.profile_id)?.display_name ?? '—')
    : e.guest_id
      ? (guests.get(e.guest_id)?.display_name ?? '—')
      : ''
  switch (e.event_type) {
    case 'goal':       return `${teamLabel} · Goal · ${participantName}`
    case 'own_goal':   return `${teamLabel} · Own goal · ${participantName}`
    case 'yellow_card': return `${teamLabel} · Yellow · ${participantName}`
    case 'red_card':    return `${teamLabel} · Red · ${participantName}`
    case 'pause':      return 'Pause'
    case 'resume':     return 'Resume'
    case 'halftime':   return 'Half-time'
    case 'fulltime':   return 'Full-time'
  }
}

function isSystemEvent(t: MatchEventType): boolean {
  return t === 'pause' || t === 'resume' || t === 'halftime' || t === 'fulltime'
}

function deriveResult(scoreWhite: number, scoreBlack: number): MatchResult {
  if (scoreWhite > scoreBlack) return 'win_white'
  if (scoreBlack > scoreWhite) return 'win_black'
  return 'draw'
}

interface TeamGoalRow { team: TeamColor | null; goals: number }
function validateScoreMatchesGoals(
  scoreWhite: number,
  scoreBlack: number,
  rows: TeamGoalRow[],
): { ok: boolean; messages: string[] } {
  let whiteSum = 0
  let blackSum = 0
  for (const r of rows) {
    if (r.team === 'white') whiteSum += r.goals
    else if (r.team === 'black') blackSum += r.goals
  }
  const messages: string[] = []
  if (whiteSum !== scoreWhite) messages.push(`White scoreline ${scoreWhite} vs player goals ${whiteSum}`)
  if (blackSum !== scoreBlack) messages.push(`Black scoreline ${scoreBlack} vs player goals ${blackSum}`)
  return { ok: messages.length === 0, messages }
}

// ─── Component ─────────────────────────────────────────────────

export function MatchEntryReview() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<ScreenData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Match-level inline edits (only set when user changes from pending value).
  const [editScoreWhite, setEditScoreWhite] = useState<number | null>(null)
  const [editScoreBlack, setEditScoreBlack] = useState<number | null>(null)

  const loadAll = useCallback(async (entryId: string) => {
    setLoading(true)
    setError(null)
    try {
      const [entryRes, playersRes, eventsRes] = await Promise.all([
        supabase.from('pending_match_entries').select('*').eq('id', entryId).single(),
        supabase.from('pending_match_entry_players').select('*').eq('pending_entry_id', entryId),
        supabase.from('pending_match_events').select('*').eq('pending_entry_id', entryId).order('ordinal', { ascending: true }),
      ])
      if (entryRes.error) throw entryRes.error
      if (playersRes.error) throw playersRes.error
      if (eventsRes.error) throw eventsRes.error

      const entry = entryRes.data
      const players = playersRes.data ?? []
      const events = eventsRes.data ?? []

      const mdRes = await supabase.from('matchdays').select('id, kickoff_at, format').eq('id', entry.matchday_id).single()
      if (mdRes.error) throw mdRes.error

      // Resolve display names for profiles + guests referenced in players + events.
      const profileIds = new Set<string>()
      const guestIds = new Set<string>()
      for (const p of players) { if (p.profile_id) profileIds.add(p.profile_id); if (p.guest_id) guestIds.add(p.guest_id) }
      for (const e of events) { if (e.profile_id) profileIds.add(e.profile_id); if (e.guest_id) guestIds.add(e.guest_id) }
      // MOTM also needs lookups.
      // (Pending entry doesn't store MOTM at row level — it's on the player row via is_motm.)

      const [profilesRes, guestsRes] = await Promise.all([
        profileIds.size > 0
          ? supabase.from('profiles').select('id, display_name').in('id', [...profileIds])
          : Promise.resolve({ data: [], error: null }),
        guestIds.size > 0
          ? supabase.from('match_guests').select('id, display_name').in('id', [...guestIds])
          : Promise.resolve({ data: [], error: null }),
      ])
      if (profilesRes.error) throw profilesRes.error
      if (guestsRes.error) throw guestsRes.error

      const profilesById = new Map<string, PlayerLite>()
      for (const p of (profilesRes.data ?? []) as PlayerLite[]) profilesById.set(p.id, p)
      const guestsById = new Map<string, GuestLite>()
      for (const g of (guestsRes.data ?? []) as GuestLite[]) guestsById.set(g.id, g)

      setData({
        entry,
        players,
        events,
        matchday: { id: mdRes.data.id, kickoff_at: mdRes.data.kickoff_at, format: mdRes.data.format },
        profilesById,
        guestsById,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!id) return
    void loadAll(id)
  }, [id, loadAll])

  // Effective scores after inline edits, used for both display + validation.
  const effectiveScoreWhite = editScoreWhite ?? data?.entry.score_white ?? 0
  const effectiveScoreBlack = editScoreBlack ?? data?.entry.score_black ?? 0

  const validation = useMemo(() => {
    if (!data) return { ok: true, messages: [] as string[] }
    return validateScoreMatchesGoals(
      effectiveScoreWhite,
      effectiveScoreBlack,
      data.players.map((p) => ({ team: p.team, goals: p.goals })),
    )
  }, [data, effectiveScoreWhite, effectiveScoreBlack])

  const regulationHalf = data?.matchday.format === '5v5' ? 25 : 35

  if (loading) {
    return (
      <section className="mer-screen">
        <button type="button" className="mer-back" onClick={() => navigate('/admin/matches')}>← Admin · Matches</button>
        <div className="mer-card"><div className="mer-skel" style={{ height: 80 }} /></div>
        <div className="mer-card"><div className="mer-skel" style={{ height: 120 }} /></div>
      </section>
    )
  }

  if (error || !data) {
    return (
      <section className="mer-screen">
        <button type="button" className="mer-back" onClick={() => navigate('/admin/matches')}>← Admin · Matches</button>
        <div className="auth-banner auth-banner--danger" role="alert" style={{ margin: '16px 0' }}>
          {error ?? 'Entry not found'}
        </div>
      </section>
    )
  }

  const { entry, players, events, matchday, profilesById, guestsById } = data
  const whitePlayers = players.filter((p) => p.team === 'white')
  const blackPlayers = players.filter((p) => p.team === 'black')
  const motmPlayer = players.find((p) => p.is_motm)
  const motmName = motmPlayer
    ? (motmPlayer.profile_id ? profilesById.get(motmPlayer.profile_id)?.display_name : guestsById.get(motmPlayer.guest_id ?? '')?.display_name) ?? '—'
    : null

  const winningSide = effectiveScoreWhite > effectiveScoreBlack ? 'white' : effectiveScoreBlack > effectiveScoreWhite ? 'black' : 'draw'

  return (
    <section className="mer-screen">
      <button type="button" className="mer-back" onClick={() => navigate('/admin/matches')}>← Admin · Matches</button>

      <header className="mer-header">
        <h1>Match-entry review</h1>
        <span className="mer-header-sub">{dateLabel(matchday.kickoff_at)} · {matchday.format ?? '7v7'} · submitted {timeOnly(entry.submitted_at)}</span>
      </header>

      {!validation.ok && (
        <div className="mer-warn-banner" role="alert">
          <strong>Score vs player goals mismatch</strong>
          {validation.messages.map((m, i) => <span key={i}>{m}</span>)}
        </div>
      )}

      {/* Final score + inline edit */}
      <div className="mer-card">
        <h2 className="mer-section-label">Final score</h2>
        <div className="mer-score-row">
          <div className={`mer-score-side${winningSide === 'white' ? ' mer-score-side--winner' : ''}`}>
            <span className="mer-score-team">WHITE</span>
            <input
              type="number"
              min={0}
              className="mer-score-input"
              value={effectiveScoreWhite}
              onChange={(e) => setEditScoreWhite(Math.max(0, parseInt(e.target.value || '0', 10)))}
            />
          </div>
          <span className="mer-score-dash">–</span>
          <div className={`mer-score-side${winningSide === 'black' ? ' mer-score-side--winner' : ''}`}>
            <span className="mer-score-team">BLACK</span>
            <input
              type="number"
              min={0}
              className="mer-score-input"
              value={effectiveScoreBlack}
              onChange={(e) => setEditScoreBlack(Math.max(0, parseInt(e.target.value || '0', 10)))}
            />
          </div>
        </div>
      </div>

      {/* Timing summary */}
      <div className="mer-card">
        <h2 className="mer-section-label">Timing</h2>
        <dl className="mer-timing-grid">
          <div className="mer-timing-row"><dt>Kickoff</dt><dd>{timeOnly(entry.kickoff_at)}</dd></div>
          <div className="mer-timing-row"><dt>Half-time</dt><dd>{timeOnly(entry.halftime_at)}</dd></div>
          <div className="mer-timing-row"><dt>Full-time</dt><dd>{timeOnly(entry.fulltime_at)}</dd></div>
          <div className="mer-timing-row"><dt>1st-half stoppage</dt><dd>{formatMSS(entry.stoppage_h1_seconds)}</dd></div>
          <div className="mer-timing-row"><dt>2nd-half stoppage</dt><dd>{formatMSS(entry.stoppage_h2_seconds)}</dd></div>
          <div className="mer-timing-row"><dt>Result</dt><dd>{(() => { const r = deriveResult(effectiveScoreWhite, effectiveScoreBlack); return r === 'win_white' ? 'WHITE' : r === 'win_black' ? 'BLACK' : 'DRAW' })()}</dd></div>
        </dl>
      </div>

      {/* MOTM */}
      <div className="mer-card">
        <h2 className="mer-section-label">Man of the Match</h2>
        <div className="mer-motm-row">
          {motmName ? <span className="mer-motm-name">{motmName}</span> : <span className="mer-motm-empty">— none —</span>}
          {/* Change/Set deferred — uses sheet wired in Task 4 */}
        </div>
      </div>

      {/* Per-player grid (read-only in 2B-F) */}
      <div className="mer-card">
        <h2 className="mer-section-label">Player aggregates</h2>
        <div className="mer-team-block mer-team-head--white">
          <div className="mer-team-head"><span className="mer-team-name">{whitePlayers.length} on roster</span></div>
          {whitePlayers.map((p) => (
            <PlayerRow key={p.id} row={p} profiles={profilesById} guests={guestsById} />
          ))}
        </div>
        <div className="mer-team-block mer-team-head--black">
          <div className="mer-team-head"><span className="mer-team-name">{blackPlayers.length} on roster</span></div>
          {blackPlayers.map((p) => (
            <PlayerRow key={p.id} row={p} profiles={profilesById} guests={guestsById} />
          ))}
        </div>
      </div>

      {/* Event log */}
      <div className="mer-card">
        <h2 className="mer-section-label">Event log · {events.length}</h2>
        {events.length === 0 ? (
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>No events recorded.</span>
        ) : (
          <ul className="mer-events-list">
            {events.map((e) => (
              <li key={e.id} className={`mer-event-row${isSystemEvent(e.event_type) ? ' mer-event-row--system' : ''}`}>
                <span className="mer-event-min">{formatMatchMinute(e.match_minute, e.match_second, regulationHalf)}</span>
                <span className="mer-event-desc">{eventDescription(e, profilesById, guestsById)}</span>
                <button
                  type="button"
                  className="mer-event-drop"
                  disabled
                  aria-label="Drop event (wired in Task 4)"
                  title="Drop"
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Notes (read-only in this Task; editable in Task 4 sheet) */}
      {entry.notes && (
        <div className="mer-card">
          <h2 className="mer-section-label">Ref notes</h2>
          <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{entry.notes}</p>
        </div>
      )}

      {/* Action row stub — wired in Task 4 */}
      <div className="mer-actions">
        <button type="button" className="mer-action-btn mer-action-btn--reject" disabled>Reject</button>
        <button type="button" className="mer-action-btn mer-action-btn--approve" disabled>Approve</button>
      </div>
    </section>
  )
}

// ─── PlayerRow sub-component ───────────────────────────────────

function PlayerRow({
  row, profiles, guests,
}: {
  row: PendingPlayerRow
  profiles: Map<string, PlayerLite>
  guests: Map<string, GuestLite>
}) {
  const name = row.profile_id
    ? (profiles.get(row.profile_id)?.display_name ?? '—')
    : (guests.get(row.guest_id ?? '')?.display_name ?? '—')
  return (
    <div className="mer-player-row">
      <span className="mer-player-name">{name}</span>
      <span className="mer-player-stat" title="Goals">⚽ {row.goals}</span>
      <span className="mer-player-stat" title="Yellows">🟨 {row.yellow_cards}</span>
      <span className="mer-player-stat" title="Reds">🟥 {row.red_cards}</span>
      <span className={`mer-player-stat${row.is_motm ? ' mer-player-stat--motm' : ''}`} title="MOTM">{row.is_motm ? '⭐' : ''}</span>
    </div>
  )
}
