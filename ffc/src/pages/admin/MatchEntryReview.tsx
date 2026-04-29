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
// S047 Task 1 carry-over: MOTM picker + Notes textarea bottom sheets wired.
//   Both are local-state-only (synchronous setEditMotm / setEditNotes); the
//   diff is sent in p_edits on Approve via the existing handleApprove builder.
//
// Deferred (still NOT in this screen):
//   - Per-player aggregate edit-before-approve (post-approval edit_match_players covers it)
//   - Realtime subscription on pending_match_entries (needs ALTER PUBLICATION first)

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Database, Json } from '../../lib/database.types'
import { shareMatchCard } from '../../lib/shareMatchCard'
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

function formatMatchMinute(minute: number, second: number): string {
  // Renders match minute as M' or M'SS. Stoppage-notation refinement
  // (e.g. "35+1'" instead of "36'" for 1st-half stoppage) is a polish
  // item for a later slice — at that point the format-driven regulation
  // half length will need to be plumbed in.
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
  // editMotm semantics:
  //   null                                     → no edit, fall back to entry.is_motm row
  //   { profile_id: 'x', guest_id: null }      → set MOTM to that profile
  //   { profile_id: null, guest_id: 'g' }      → set MOTM to that guest
  //   { profile_id: null, guest_id: null }     → explicit clear (handleApprove sends both as null)
  // editNotes semantics: null = no edit; '' = explicit clear; 'text' = update.
  const [editScoreWhite, setEditScoreWhite] = useState<number | null>(null)
  const [editScoreBlack, setEditScoreBlack] = useState<number | null>(null)
  const [editNotes, setEditNotes] = useState<string | null>(null)
  const [editMotm, setEditMotm] = useState<{ profile_id: string | null; guest_id: string | null } | null>(null)

  // Success state — set after approve_match_entry succeeds.
  const [approvedMatchId, setApprovedMatchId] = useState<string | null>(null)
  const [approvedScore, setApprovedScore] = useState<{ white: number; black: number } | null>(null)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)

  type Sheet =
    | { kind: 'approve' }
    | { kind: 'reject' }
    | { kind: 'drop_event'; event: PendingEventRow }
    | { kind: 'motm' }
    | { kind: 'notes' }
    | null

  const [sheet, setSheet] = useState<Sheet>(null)
  const [sheetBusy, setSheetBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const openSheet = useCallback((s: Sheet) => {
    setActionError(null)
    setSheet(s)
  }, [])

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional async hydration on mount/id change
    void loadAll(id)
  }, [id, loadAll])

  const handleApprove = async () => {
    if (!data || !id) return
    setSheetBusy(true)
    setActionError(null)
    try {
      // Build p_edits jsonb from match-level inline edits.
      const edits: Record<string, Json> = {}
      if (editScoreWhite !== null && editScoreWhite !== data.entry.score_white) edits.score_white = editScoreWhite
      if (editScoreBlack !== null && editScoreBlack !== data.entry.score_black) edits.score_black = editScoreBlack
      if (editNotes !== null && editNotes !== (data.entry.notes ?? '')) edits.notes = editNotes
      if (editMotm !== null) {
        edits.motm_user_id = editMotm.profile_id
        edits.motm_guest_id = editMotm.guest_id
      }
      // Always recompute result if scores were edited.
      if ('score_white' in edits || 'score_black' in edits) {
        edits.result = deriveResult(
          (edits.score_white as number | undefined) ?? data.entry.score_white,
          (edits.score_black as number | undefined) ?? data.entry.score_black,
        )
      }
      // Capture approved scores before the RPC (edits may override entry values).
      const finalWhite = (edits.score_white as number | undefined) ?? data.entry.score_white
      const finalBlack = (edits.score_black as number | undefined) ?? data.entry.score_black

      const { data: matchId, error } = await supabase.rpc('approve_match_entry', {
        p_pending_id: id,
        p_edits: edits as unknown as Json,
      })
      if (error) throw error
      openSheet(null)
      setApprovedScore({ white: finalWhite, black: finalBlack })
      setApprovedMatchId(matchId as string)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setSheetBusy(false)
    }
  }

  const handleReject = async (reason: string) => {
    if (!id) return
    if (reason.trim().length === 0) {
      setActionError('Reject reason is required')
      return
    }
    setSheetBusy(true)
    setActionError(null)
    try {
      const { error } = await supabase.rpc('reject_match_entry', {
        p_pending_id: id,
        p_reason: reason,
      })
      if (error) throw error
      openSheet(null)
      navigate('/admin/matches')
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setSheetBusy(false)
    }
  }

  const handleDropEvent = async (eventId: string) => {
    if (!id) return
    setSheetBusy(true)
    setActionError(null)
    try {
      const { error } = await supabase.rpc('admin_drop_pending_match_event', {
        p_event_id: eventId,
      })
      if (error) throw error
      openSheet(null)
      await loadAll(id)  // refresh event log
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setSheetBusy(false)
    }
  }

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

  // ── Success state: shown after approve_match_entry completes ──
  if (approvedMatchId) {
    return (
      <section className="mer-screen mer-success">
        <div className="mer-success-icon">✓</div>
        <h1 className="mer-success-title">Match approved</h1>
        <div className="mer-success-score">
          WHITE {approvedScore?.white ?? 0} – {approvedScore?.black ?? 0} BLACK
        </div>
        {shareError && <div className="mer-error">{shareError}</div>}
        <button
          type="button"
          className="mer-action-btn mer-action-btn--share"
          onClick={async () => {
            setShareBusy(true)
            setShareError(null)
            const result = await shareMatchCard(approvedMatchId)
            setShareBusy(false)
            if (result.kind === 'error') setShareError(result.message)
          }}
          disabled={shareBusy}
        >
          {shareBusy ? 'Generating card…' : '📲 Share to WhatsApp'}
        </button>
        <button
          type="button"
          className="mer-action-btn mer-action-btn--secondary"
          onClick={() => navigate('/admin/matches')}
        >
          Done
        </button>
      </section>
    )
  }

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
  const initialMotmPlayer = players.find((p) => p.is_motm) ?? null

  // effectiveMotm resolves the local edit override against the pending row's is_motm flag.
  // null result → no MOTM (either originally absent or explicitly cleared via the picker).
  const effectiveMotm: { profile_id: string | null; guest_id: string | null } | null =
    editMotm !== null
      ? (editMotm.profile_id === null && editMotm.guest_id === null ? null : editMotm)
      : (initialMotmPlayer ? { profile_id: initialMotmPlayer.profile_id, guest_id: initialMotmPlayer.guest_id } : null)

  const effectiveMotmName: string | null = effectiveMotm
    ? (effectiveMotm.profile_id
        ? (profilesById.get(effectiveMotm.profile_id)?.display_name ?? '—')
        : (guestsById.get(effectiveMotm.guest_id ?? '')?.display_name ?? '—'))
    : null

  // effectiveNotes — override wins; falls back to entry.notes (null → empty for textarea seeding).
  const effectiveNotes: string = editNotes !== null ? editNotes : (entry.notes ?? '')

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
              onChange={(e) => {
                const v = parseInt(e.target.value || '0', 10)
                setEditScoreWhite(Number.isFinite(v) ? Math.max(0, v) : 0)
              }}
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
              onChange={(e) => {
                const v = parseInt(e.target.value || '0', 10)
                setEditScoreBlack(Number.isFinite(v) ? Math.max(0, v) : 0)
              }}
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
          {effectiveMotmName
            ? <span className="mer-motm-name">{effectiveMotmName}</span>
            : <span className="mer-motm-empty">— none —</span>}
          <button
            type="button"
            className="mer-motm-change"
            onClick={() => openSheet({ kind: 'motm' })}
            disabled={sheetBusy}
          >
            {effectiveMotmName ? 'Change' : 'Set'}
          </button>
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
                <span className="mer-event-min">{formatMatchMinute(e.match_minute, e.match_second)}</span>
                <span className="mer-event-desc">{eventDescription(e, profilesById, guestsById)}</span>
                <button
                  type="button"
                  className="mer-event-drop"
                  onClick={() => openSheet({ kind: 'drop_event', event: e })}
                  disabled={isSystemEvent(e.event_type) || sheetBusy}
                  aria-label="Drop event"
                  title={isSystemEvent(e.event_type) ? 'System events cannot be dropped' : 'Drop event'}
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Notes — editable (saved on Approve) */}
      <div className="mer-card">
        <h2 className="mer-section-label">Ref notes</h2>
        <div className="mer-motm-row">
          {effectiveNotes.length > 0
            ? <span className="mer-notes-preview">{effectiveNotes}</span>
            : <span className="mer-motm-empty">— none —</span>}
          <button
            type="button"
            className="mer-motm-change"
            onClick={() => openSheet({ kind: 'notes' })}
            disabled={sheetBusy}
          >
            {effectiveNotes.length > 0 ? 'Edit' : 'Add'}
          </button>
        </div>
      </div>

      {/* Action row */}
      <div className="mer-actions">
        <button
          type="button"
          className="mer-action-btn mer-action-btn--reject"
          onClick={() => openSheet({ kind: 'reject' })}
          disabled={sheetBusy}
        >
          Reject
        </button>
        <button
          type="button"
          className="mer-action-btn mer-action-btn--approve"
          onClick={() => openSheet({ kind: 'approve' })}
          disabled={sheetBusy}
        >
          Approve
        </button>
      </div>

      {sheet && createPortal(
        <div className="sheet-overlay" role="dialog" aria-modal onClick={() => !sheetBusy && openSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" aria-hidden />
            {sheet.kind === 'approve' && (
              <ApproveSheet
                scoreWhite={effectiveScoreWhite}
                scoreBlack={effectiveScoreBlack}
                mismatch={!validation.ok}
                busy={sheetBusy}
                error={actionError}
                onConfirm={handleApprove}
                onCancel={() => !sheetBusy && openSheet(null)}
              />
            )}
            {sheet.kind === 'reject' && (
              <RejectSheet
                busy={sheetBusy}
                error={actionError}
                onConfirm={handleReject}
                onCancel={() => !sheetBusy && openSheet(null)}
              />
            )}
            {sheet.kind === 'drop_event' && (
              <DropEventSheet
                event={sheet.event}
                description={eventDescription(sheet.event, profilesById, guestsById)}
                minute={formatMatchMinute(sheet.event.match_minute, sheet.event.match_second)}
                busy={sheetBusy}
                error={actionError}
                onConfirm={() => handleDropEvent(sheet.event.id)}
                onCancel={() => !sheetBusy && openSheet(null)}
              />
            )}
            {sheet.kind === 'motm' && (
              <MotmSheet
                whitePlayers={whitePlayers}
                blackPlayers={blackPlayers}
                profiles={profilesById}
                guests={guestsById}
                current={effectiveMotm}
                onPick={(selection) => {
                  setEditMotm(selection)
                  openSheet(null)
                }}
                onClear={() => {
                  setEditMotm({ profile_id: null, guest_id: null })
                  openSheet(null)
                }}
                onCancel={() => openSheet(null)}
              />
            )}
            {sheet.kind === 'notes' && (
              <NotesSheet
                initial={effectiveNotes}
                onSave={(text) => {
                  setEditNotes(text)
                  openSheet(null)
                }}
                onCancel={() => openSheet(null)}
              />
            )}
          </div>
        </div>,
        document.body,
      )}
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

// ─── Sheet sub-components ──────────────────────────────────────

function ApproveSheet({
  scoreWhite, scoreBlack, mismatch, busy, error, onConfirm, onCancel,
}: {
  scoreWhite: number; scoreBlack: number; mismatch: boolean
  busy: boolean; error: string | null
  onConfirm: () => void; onCancel: () => void
}) {
  return (
    <>
      <h3>Approve match entry?</h3>
      <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
        Final: WHITE {scoreWhite} – {scoreBlack} BLACK. The match record will be promoted; player stats and event log will be locked in.
      </p>
      {mismatch && (
        <div className="mer-warn-banner">
          Score vs player goals don't match. Approve anyway only if you're sure.
        </div>
      )}
      {error && <div className="auth-banner auth-banner--danger" role="alert">{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="auth-btn auth-btn--approve" onClick={onConfirm} disabled={busy}>{busy ? 'Approving…' : 'Approve'}</button>
      </div>
    </>
  )
}

function RejectSheet({
  busy, error, onConfirm, onCancel,
}: {
  busy: boolean; error: string | null
  onConfirm: (reason: string) => void; onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  return (
    <>
      <h3>Reject this entry?</h3>
      <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
        The pending row + event log will be deleted. The ref must regenerate the link to resubmit.
      </p>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Reason (visible in audit log)</label>
      <textarea
        className="mer-notes-textarea"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        maxLength={300}
        placeholder="e.g. Wrong scoreline; ref to resubmit"
      />
      {error && <div className="auth-banner auth-banner--danger" role="alert">{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="auth-btn auth-btn--reject-filled" onClick={() => onConfirm(reason)} disabled={busy || reason.trim().length === 0}>{busy ? 'Rejecting…' : 'Reject'}</button>
      </div>
    </>
  )
}

function DropEventSheet({
  event: _event,
  description, minute, busy, error, onConfirm, onCancel,
}: {
  event: PendingEventRow; description: string; minute: string
  busy: boolean; error: string | null
  onConfirm: () => void; onCancel: () => void
}) {
  void _event
  return (
    <>
      <h3>Drop this event?</h3>
      <p style={{ fontSize: 14 }}><strong>{minute}</strong> · {description}</p>
      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        The event will be removed from this entry. The score and per-player aggregates are <strong>not</strong> auto-recalculated — adjust them manually before approving.
      </p>
      {error && <div className="auth-banner auth-banner--danger" role="alert">{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="auth-btn auth-btn--reject-filled" onClick={onConfirm} disabled={busy}>{busy ? 'Dropping…' : 'Drop event'}</button>
      </div>
    </>
  )
}

// MOTM picker — local-state-only (no RPC). Pick or Clear closes the sheet
// and writes to editMotm; the change is sent on Approve.
function MotmSheet({
  whitePlayers, blackPlayers, profiles, guests, current, onPick, onClear, onCancel,
}: {
  whitePlayers: PendingPlayerRow[]
  blackPlayers: PendingPlayerRow[]
  profiles: Map<string, PlayerLite>
  guests: Map<string, GuestLite>
  current: { profile_id: string | null; guest_id: string | null } | null
  onPick: (selection: { profile_id: string | null; guest_id: string | null }) => void
  onClear: () => void
  onCancel: () => void
}) {
  function isCurrent(p: PendingPlayerRow): boolean {
    if (!current) return false
    return current.profile_id === p.profile_id && current.guest_id === p.guest_id
  }
  function nameOf(p: PendingPlayerRow): string {
    return p.profile_id
      ? (profiles.get(p.profile_id)?.display_name ?? '—')
      : (guests.get(p.guest_id ?? '')?.display_name ?? '—')
  }
  return (
    <>
      <h3>Set MOTM</h3>
      <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
        Combined roster · saved on Approve. Tap a player to pick.
      </p>
      <div className="mer-motm-list">
        {([['WHITE', whitePlayers], ['BLACK', blackPlayers]] as const).map(([label, list]) => (
          <div key={label} className="mer-motm-team">
            <div className="mer-motm-team-label">{label}</div>
            {list.map((p) => (
              <button
                key={p.id}
                type="button"
                className={'mer-motm-pick' + (isCurrent(p) ? ' mer-motm-pick--active' : '')}
                onClick={() => onPick({ profile_id: p.profile_id, guest_id: p.guest_id })}
              >
                <span>{nameOf(p)}</span>
                {isCurrent(p) && <span aria-hidden>⭐</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: current ? '1fr 1fr' : '1fr', gap: 10, marginTop: 12 }}>
        {current && (
          <button type="button" className="auth-btn auth-btn--reject-filled" onClick={onClear}>Clear MOTM</button>
        )}
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel}>Close</button>
      </div>
    </>
  )
}

// Notes editor — local-state-only. Save closes the sheet and writes to editNotes;
// the change is sent on Approve.
function NotesSheet({
  initial, onSave, onCancel,
}: {
  initial: string
  onSave: (notes: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  const trimmed = text.trim()
  const isCleared = initial.length > 0 && trimmed.length === 0
  return (
    <>
      <h3>{initial.length > 0 ? 'Edit ref notes' : 'Add ref notes'}</h3>
      <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
        Optional · visible to other admins on the saved match. Saved when you Approve.
      </p>
      <textarea
        className="mer-notes-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        maxLength={500}
        placeholder="e.g. 8 mins extra time in 2nd half · disputed goal at 67'"
      />
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right', marginTop: 4 }}>
        {text.length} / 500
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="auth-btn auth-btn--approve"
          onClick={() => onSave(trimmed)}
        >
          {isCleared ? 'Clear' : 'Save'}
        </button>
      </div>
    </>
  )
}
