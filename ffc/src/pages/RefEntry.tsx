import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Json } from '../lib/database.types'
import { useMatchSession, type RefMatchdayPayload } from '../lib/useMatchSession'
import { useMatchClock, type ClockState, type MatchEvent } from '../lib/useMatchClock'
import { REGULATION_HALF_MINUTES, MAX_STOPPAGE_SOFT_LIMIT_SECONDS } from '../lib/refConsoleConstants'
import {
  CardKindPicker,
  CardPlayerPicker,
  EventDeletePicker,
  MotmPicker,
  PauseReasonPicker,
  ScorerPicker,
  truncateName,
} from './RefEntryPickers'
import '../styles/ref-entry.css'

/* §3.4-v2 RefEntry — slices 2B-C (pre), 2B-D (live), 2B-E (review + post + submit).
 *
 * URL: /ref/:token (anonymous; token is the only auth).
 *
 * Modes:
 *   loading → spinner
 *   invalid → token-rejected screen
 *   pre     → matchday header + rosters + KICK OFF button
 *   live    → live match console (score/clock/event log/pickers)
 *   review  → final score + MOTM + event log + notes + SUBMIT TO ADMIN
 *   post    → "submitted, admin notified" success view
 */

export function RefEntry() {
  const { token } = useParams()
  const session = useMatchSession(token)
  // Lift the clock hook to RefEntry top-level so live + review screens share
  // the same instance. The hook tolerates null sessionStorageKey/kickoffIso.
  const clock = useMatchClock({
    sessionStorageKey: session.sessionStorageKey,
    kickoffIso: session.kickoffAt,
    format: session.payload?.matchday.effective_format ?? '7v7',
  })

  if (session.mode === 'loading') {
    return (
      <section className="ref-entry ref-entry--center">
        <div className="ref-entry-spinner" aria-hidden />
        <p className="ref-entry-hint">Loading matchday…</p>
      </section>
    )
  }

  if (session.mode === 'invalid') {
    return (
      <section className="ref-entry ref-entry--center">
        <h1 className="ref-entry-title">Link expired</h1>
        <p className="ref-entry-copy">
          This ref link is no longer valid — it may have been used or replaced. Ask
          the admin to share a fresh link.
        </p>
        {session.error && <p className="ref-entry-error">{session.error}</p>}
      </section>
    )
  }

  if (!session.payload) return null

  if (session.mode === 'live') {
    return (
      <LiveConsole
        payload={session.payload}
        clock={clock}
        onEndMatch={() => {
          clock.endMatch()
          session.endMatch()
        }}
      />
    )
  }

  if (session.mode === 'review') {
    return (
      <ReviewConsole
        payload={session.payload}
        clock={clock}
        token={token ?? ''}
        sessionStorageKey={session.sessionStorageKey}
        onSubmitted={() => session.confirmSubmit()}
        onBackToLive={() => {
          clock.reopen()
          session.reopenLive()
        }}
      />
    )
  }

  if (session.mode === 'post') {
    return <PostSubmittedView clock={clock} />
  }

  // mode === 'pre'
  const md = session.payload.matchday
  const kickoffLabel = formatKickoff(md.kickoff_at)

  if (!session.payload.has_match_row || md.roster_locked_at === null) {
    return (
      <section className="ref-entry ref-entry--center">
        <h1 className="ref-entry-title">Roster not yet locked</h1>
        <p className="ref-entry-copy">
          The admin hasn't locked the roster yet. Refresh once they have, or ask
          them to share a fresh ref link.
        </p>
      </section>
    )
  }

  return (
    <section className="ref-entry">
      <header className="ref-entry-header">
        <span className="ref-entry-md-label">Matchday</span>
        <h1 className="ref-entry-title">{kickoffLabel}</h1>
        <p className="ref-entry-meta">
          {md.effective_format} · {md.venue ?? 'Venue TBD'}
        </p>
      </header>

      <div className="ref-entry-rosters">
        <RosterCard team="white" players={session.payload.white} />
        <RosterCard team="black" players={session.payload.black} />
      </div>

      <div className="ref-entry-cta-wrap">
        <button
          type="button"
          className="ref-entry-cta"
          onClick={() => void session.startMatch()}
        >
          ⚽ KICK OFF
        </button>
        <p className="ref-entry-cta-hint">
          Screen will stay awake. Tap when the match starts.
        </p>
      </div>
    </section>
  )
}

interface RosterCardProps {
  team: 'white' | 'black'
  players: Array<{
    profile_id: string | null
    guest_id: string | null
    display_name: string
    primary_position: string | null
    is_captain: boolean
  }>
}

function RosterCard({ team, players }: RosterCardProps) {
  return (
    <div className={`ref-roster ref-roster--${team}`}>
      <div className="ref-roster-head">
        <span className={`ref-roster-chip ref-roster-chip--${team}`}>
          {team.toUpperCase()} · {players.length}
        </span>
      </div>
      <ul className="ref-roster-list">
        {players.map((p, i) => (
          <li
            key={(p.profile_id ?? p.guest_id ?? 'p') + ':' + i}
            className={`ref-roster-row${p.is_captain ? ' ref-roster-row--cap' : ''}`}
          >
            <span className="ref-roster-name">{p.display_name}</span>
            {p.is_captain && <span className="ref-roster-cap">C</span>}
            {p.primary_position && (
              <span className="ref-roster-pos">{p.primary_position.toUpperCase()}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function formatKickoff(iso: string): string {
  const d = new Date(iso)
  const dow = d.toLocaleDateString('en-GB', { weekday: 'short' })
  const day = d.getDate().toString().padStart(2, '0')
  const mon = d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()
  const year = d.getFullYear()
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  return `${dow} ${day}/${mon}/${year} · ${hh}:${mm}`
}

/* ─── §3.4-v2 Slice 2B-D — Live console ───────────────────────────────────── */

type ClockHook = ReturnType<typeof useMatchClock>

interface LiveConsoleProps {
  payload: RefMatchdayPayload
  clock: ClockHook
  onEndMatch: () => void
}

function LiveConsole({ payload, clock, onEndMatch }: LiveConsoleProps) {
  const [scorerTeam, setScorerTeam] = useState<'white' | 'black' | null>(null)
  const [pausePickerOpen, setPausePickerOpen] = useState(false)
  const [cardPickerOpen, setCardPickerOpen] = useState(false)
  const [motmPickerOpen, setMotmPickerOpen] = useState(false)
  const [cardStage, setCardStage] = useState<{
    team: 'white' | 'black'
    profile_id: string | null
    guest_id: string | null
    display_name: string
  } | null>(null)

  if (clock.state.half === 'break') {
    return (
      <section className="ref-entry">
        <LiveHeader half="break" />
        <div className="ref-live">
          <HalftimeView clock={clock} />
          <ScoreReadOnly clock={clock} />
          <EventStrip events={clock.state.events} format={payload.matchday.effective_format} />
        </div>
      </section>
    )
  }

  return (
    <section className="ref-entry">
      <LiveHeader half={clock.state.half} />
      <div className="ref-live">
        <HalfStrip clock={clock} format={payload.matchday.effective_format} />
        <div className="ref-clock-display">
          <div
            className={
              'ref-clock-min' +
              (clock.state.paused_at ? ' ref-clock-min--paused' : '')
            }
          >
            {clock.display.clockLabel}
          </div>
        </div>
        <div className="ref-score-block">
          <button
            type="button"
            className="ref-score-cell ref-score-cell--white"
            onClick={() => setScorerTeam('white')}
            disabled={clock.state.paused_at !== null}
          >
            <div className="ref-score-label">WHITE</div>
            <div className="ref-score-number">{clock.state.score_white}</div>
            <div className="ref-score-tap-hint">tap to add goal</div>
          </button>
          <div className="ref-score-divider">:</div>
          <button
            type="button"
            className="ref-score-cell ref-score-cell--black"
            onClick={() => setScorerTeam('black')}
            disabled={clock.state.paused_at !== null}
          >
            <div className="ref-score-label">BLACK</div>
            <div className="ref-score-number">{clock.state.score_black}</div>
            <div className="ref-score-tap-hint">tap to add goal</div>
          </button>
        </div>
        <div className="ref-action-row">
          <button
            type="button"
            className={
              'ref-action-btn ' +
              (clock.state.paused_at ? 'ref-action-btn--resume' : 'ref-action-btn--pause')
            }
            onClick={() => {
              if (clock.state.paused_at) {
                clock.resume()
              } else {
                setPausePickerOpen(true)
              }
            }}
          >
            <span className="ref-action-btn-ico">{clock.state.paused_at ? '▶' : '⏸'}</span>
            {clock.state.paused_at ? 'RESUME' : 'PAUSE'}
          </button>
          <button
            type="button"
            className="ref-action-btn ref-action-btn--card"
            onClick={() => setCardPickerOpen(true)}
            disabled={clock.state.paused_at !== null}
          >
            <span className="ref-action-btn-ico">🟨</span> CARD
          </button>
        </div>
        <div className="ref-action-row">
          <button
            type="button"
            className="ref-action-btn"
            onClick={() => clock.undoLast()}
            disabled={!clock.canUndo}
          >
            <span className="ref-action-btn-ico">↺</span> UNDO LAST
          </button>
          <button
            type="button"
            className="ref-action-btn"
            onClick={() => setMotmPickerOpen(true)}
          >
            <span className="ref-action-btn-ico">⭐</span>
            {clock.state.motm ? `MOTM: ${truncateName(clock.state.motm.display_name)}` : 'SET MOTM'}
          </button>
        </div>
        <div className="ref-action-row">
          <button
            type="button"
            className="ref-action-btn ref-action-btn--end"
            onClick={() => clock.endHalf()}
            disabled={clock.state.half !== 1}
          >
            <span className="ref-action-btn-ico">⏭</span>
            END 1ST HALF
          </button>
          <button
            type="button"
            className="ref-action-btn ref-action-btn--end"
            onClick={onEndMatch}
            disabled={clock.state.paused_at !== null}
          >
            <span className="ref-action-btn-ico">🏁</span> END MATCH
          </button>
        </div>
        <EventStrip events={clock.state.events} format={payload.matchday.effective_format} />
      </div>
      {scorerTeam && (
        <ScorerPicker
          team={scorerTeam}
          payload={payload}
          onPick={(participant, isOwnGoal) => {
            clock.addGoal(scorerTeam, participant, isOwnGoal)
          }}
          onClose={() => setScorerTeam(null)}
        />
      )}
      {pausePickerOpen && (
        <PauseReasonPicker
          onPick={(reason) => {
            clock.pause(reason)
            setPausePickerOpen(false)
          }}
          onClose={() => setPausePickerOpen(false)}
        />
      )}
      {cardPickerOpen && !cardStage && (
        <CardPlayerPicker
          payload={payload}
          onPick={(team, p) => {
            setCardStage({ team, ...p })
            setCardPickerOpen(false)
          }}
          onClose={() => setCardPickerOpen(false)}
        />
      )}
      {cardStage && (
        <CardKindPicker
          playerName={cardStage.display_name}
          team={cardStage.team}
          onPick={(kind) => {
            clock.addCard(kind, cardStage.team, {
              profile_id: cardStage.profile_id,
              guest_id: cardStage.guest_id,
            })
            setCardStage(null)
          }}
          onClose={() => setCardStage(null)}
        />
      )}
      {motmPickerOpen && (
        <MotmPicker
          payload={payload}
          current={clock.state.motm}
          onPick={(selection) => {
            clock.setMotm(selection)
            setMotmPickerOpen(false)
          }}
          onClose={() => setMotmPickerOpen(false)}
        />
      )}
    </section>
  )
}

function LiveHeader({ half }: { half: 1 | 2 | 'break' }) {
  const halfLabel =
    half === 'break' ? 'Halftime · swap sides' :
    half === 1 ? '1st half' : '2nd half'
  return (
    <header className="ref-live-header">
      <div className="ref-live-header-block">
        <span className="ref-live-md-label">Matchday</span>
        <span className="ref-live-half-label">{halfLabel}</span>
      </div>
      <span className={'ref-live-dot' + (half === 'break' ? ' ref-live-dot--break' : '')}>
        {half === 'break' ? 'BREAK' : 'LIVE'}
      </span>
    </header>
  )
}

interface HalfStripProps {
  clock: ClockHook
  format: '7v7' | '5v5'
}

function HalfStrip({ clock, format }: HalfStripProps) {
  const halfMinutes = REGULATION_HALF_MINUTES[format]
  const halfStartIso = clock.state.half === 1
    ? clock.state.kickoff_at
    : (clock.state.second_half_kickoff_at ?? clock.state.kickoff_at)
  const halfStart = Date.parse(halfStartIso)
  const stoppageSec = clock.state.half === 1 ? clock.state.stoppage_h1_seconds : clock.state.stoppage_h2_seconds
  // eslint-disable-next-line react-hooks/purity -- intentional: parent re-renders on each clock tick, so Date.now() drives the per-second progress-bar refresh.
  const now = Date.now()
  const elapsedMs = Math.max(0, now - halfStart - stoppageSec * 1000 - (clock.state.paused_at ? now - Date.parse(clock.state.paused_at) : 0))
  const pct = Math.min(100, (elapsedMs / (halfMinutes * 60_000)) * 100)
  const stoppageOver = clock.state.half !== 'break' && stoppageSec > MAX_STOPPAGE_SOFT_LIMIT_SECONDS

  return (
    <div className="ref-half-strip">
      <span className="ref-half-name">{clock.state.half === 1 ? '1ST HALF' : '2ND HALF'}</span>
      <div className="ref-half-progress">
        <div className="ref-half-bar" style={{ width: `${pct.toFixed(1)}%` }} />
      </div>
      {clock.display.stoppageLabel && (
        <span className={'ref-stoppage-chip' + (stoppageOver ? ' ref-stoppage-chip--alarm' : '')}>
          {clock.display.stoppageLabel}
        </span>
      )}
    </div>
  )
}

function ScoreReadOnly({ clock }: { clock: ClockHook }) {
  return (
    <div className="ref-score-block" style={{ opacity: 0.85 }}>
      <div className="ref-score-cell ref-score-cell--white">
        <div className="ref-score-label">WHITE</div>
        <div className="ref-score-number">{clock.state.score_white}</div>
      </div>
      <div className="ref-score-divider">:</div>
      <div className="ref-score-cell ref-score-cell--black">
        <div className="ref-score-label">BLACK</div>
        <div className="ref-score-number">{clock.state.score_black}</div>
      </div>
    </div>
  )
}

function HalftimeView({ clock }: { clock: ClockHook }) {
  return (
    <div className="ref-halftime-banner">
      <div className="ref-ht-label">
        HALFTIME · {clock.display.breakRemainingLabel} LEFT
      </div>
      <div className="ref-ht-clock">{clock.display.breakRemainingLabel}</div>
      <div className="ref-ht-hint">
        2nd half starts when ready. Tap below to skip break or add a minute.
      </div>
      <div className="ref-action-row" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="ref-action-btn"
          onClick={() => clock.startSecondHalf()}
        >
          <span className="ref-action-btn-ico">⏭</span> SKIP BREAK
        </button>
        <button
          type="button"
          className="ref-action-btn"
          onClick={() => clock.addBreakMin()}
        >
          <span className="ref-action-btn-ico">+</span> ADD MIN
        </button>
      </div>
    </div>
  )
}

function EventStrip({ events, format }: { events: MatchEvent[]; format: '7v7' | '5v5' }) {
  if (events.length === 0) {
    return (
      <div className="ref-event-strip">
        <div className="ref-event-strip-empty">No events yet.</div>
      </div>
    )
  }
  // Show most recent first, max 8 in the strip.
  const recent = [...events].reverse().slice(0, 8)
  const halfMinutes = REGULATION_HALF_MINUTES[format]
  return (
    <div className="ref-event-strip">
      {recent.map((e) => (
        <div
          key={e.ordinal}
          className={'ref-event-row' + (e.event_type === 'pause' || e.event_type === 'resume' ? ' ref-event-row--paused' : '')}
        >
          <span className="ref-event-min">{formatEventMinute(e, halfMinutes)}</span>
          <span className="ref-event-ico">{eventIcon(e.event_type)}</span>
          <span className="ref-event-desc">{eventDescription(e)}</span>
        </div>
      ))}
    </div>
  )
}

function formatEventMinute(e: MatchEvent, regulationHalfMinutes: number): string {
  if (e.half === 1) {
    if (e.match_minute < regulationHalfMinutes) {
      return `${e.match_minute}'`
    }
    const stoppageMin = e.match_minute - regulationHalfMinutes
    return `${regulationHalfMinutes}+${stoppageMin}'`
  }
  // half === 2
  const totalReg = regulationHalfMinutes * 2
  if (e.match_minute < totalReg) {
    return `${e.match_minute}'`
  }
  const stoppageMin = e.match_minute - totalReg
  return `${totalReg}+${stoppageMin}'`
}

function eventIcon(t: MatchEvent['event_type']): string {
  switch (t) {
    case 'goal': return '⚽'
    case 'own_goal': return '🥅'
    case 'yellow_card': return '🟨'
    case 'red_card': return '🟥'
    case 'pause': return '⏸'
    case 'resume': return '▶'
    case 'halftime': return '🟫'
    case 'fulltime': return '✓'
    default: return '•'
  }
}

function eventDescription(e: MatchEvent): string {
  const teamLabel = e.team ? `(${e.team[0].toUpperCase()})` : ''
  switch (e.event_type) {
    case 'goal':
    case 'own_goal':
      return `Goal ${teamLabel}${e.event_type === 'own_goal' ? ' · OG' : ''}`
    case 'yellow_card':
      return `Yellow ${teamLabel}`
    case 'red_card':
      return `Red ${teamLabel}`
    case 'pause': {
      const meta = e.meta as { pause_reason?: string }
      return meta.pause_reason ? `Pause · ${meta.pause_reason}` : 'Pause'
    }
    case 'resume': {
      const meta = e.meta as { pause_duration_seconds?: number }
      return meta.pause_duration_seconds
        ? `Resume · +${meta.pause_duration_seconds}s stoppage`
        : 'Resume'
    }
    case 'halftime': return 'Halftime'
    case 'fulltime': return 'Full time'
    default: return ''
  }
}

/* ─── §3.4-v2 Slice 2B-E — Review console + post-submitted view ───────────── */

interface ReviewConsoleProps {
  payload: RefMatchdayPayload
  clock: ClockHook
  token: string
  sessionStorageKey: string | null
  onSubmitted: () => void
  onBackToLive: () => void
}

function ReviewConsole({ payload, clock, token, sessionStorageKey, onSubmitted, onBackToLive }: ReviewConsoleProps) {
  const [notes, setNotes] = useState('')
  const [motmPickerOpen, setMotmPickerOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<MatchEvent | null>(null)
  const [submitBusy, setSubmitBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const halfMinutes = REGULATION_HALF_MINUTES[payload.matchday.effective_format]

  const winner = useMemo<'white' | 'black' | 'draw'>(() => {
    if (clock.state.score_white > clock.state.score_black) return 'white'
    if (clock.state.score_black > clock.state.score_white) return 'black'
    return 'draw'
  }, [clock.state.score_white, clock.state.score_black])

  const sortedEvents = useMemo(
    () => [...clock.state.events].sort((a, b) => a.ordinal - b.ordinal),
    [clock.state.events],
  )

  async function handleSubmit() {
    if (submitBusy) return
    setSubmitBusy(true)
    setSubmitError(null)
    try {
      const refPayload = buildSubmitPayload(clock.state, payload, notes, winner)
      const { error } = await supabase.rpc('submit_ref_entry', {
        p_token: token,
        p_payload: refPayload as unknown as Json,
      })
      if (error) throw error
      // Best-effort cleanup: token is now server-burned; the clock state is
      // dead weight after this point. A reload will land on 'invalid' anyway.
      if (sessionStorageKey) {
        try {
          localStorage.removeItem(sessionStorageKey + ':clock')
        } catch {
          /* private mode / storage blocked — non-fatal */
        }
      }
      onSubmitted()
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Submit failed. Tap SUBMIT again.')
      setSubmitBusy(false)
    }
  }

  return (
    <section className="ref-entry">
      <header className="ref-live-header">
        <div className="ref-live-header-block">
          <span className="ref-live-md-label">Matchday</span>
          <span className="ref-live-half-label">Match complete · review</span>
        </div>
        <span className="ref-live-dot ref-live-dot--break">DONE</span>
      </header>
      <div className="ref-review">
        <div className={'ref-review-final-score ref-review-final-score--' + winner}>
          <div className={'ref-review-side ref-review-side--white' + (winner === 'white' ? ' ref-review-side--winner' : '')}>
            <div className="ref-score-label">WHITE</div>
            <div className="ref-review-final-num">{clock.state.score_white}</div>
          </div>
          <div className="ref-review-final-divider">{winner === 'draw' ? 'DRAW' : ':'}</div>
          <div className={'ref-review-side ref-review-side--black' + (winner === 'black' ? ' ref-review-side--winner' : '')}>
            <div className="ref-score-label">BLACK</div>
            <div className="ref-review-final-num">{clock.state.score_black}</div>
          </div>
        </div>

        <div className="ref-review-motm-card">
          <div className="ref-review-motm-label">MAN OF THE MATCH</div>
          {clock.state.motm ? (
            <div className="ref-review-motm-row">
              <span className="ref-review-motm-name">⭐ {clock.state.motm.display_name}</span>
              <span className={'ref-roster-chip ref-roster-chip--' + clock.state.motm.team}>
                {clock.state.motm.team.toUpperCase()}
              </span>
            </div>
          ) : (
            <div className="ref-review-motm-empty">Not set</div>
          )}
          <button
            type="button"
            className="ref-review-motm-btn"
            onClick={() => setMotmPickerOpen(true)}
            disabled={submitBusy}
          >
            {clock.state.motm ? 'Change MOTM' : 'Set MOTM'}
          </button>
        </div>

        <div className="ref-review-notes">
          <label htmlFor="ref-notes" className="ref-review-section-label">NOTES (OPTIONAL)</label>
          <textarea
            id="ref-notes"
            className="ref-review-notes-input"
            rows={3}
            placeholder="Anything the admin should know? Disputed call, abandoned, etc."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={submitBusy}
            maxLength={500}
          />
        </div>

        <div className="ref-review-events">
          <div className="ref-review-section-label">
            EVENT LOG · {sortedEvents.length} {sortedEvents.length === 1 ? 'event' : 'events'}
          </div>
          {sortedEvents.length === 0 ? (
            <div className="ref-event-strip-empty" style={{ marginTop: 8 }}>
              No events logged.
            </div>
          ) : (
            <ul className="ref-review-events-list">
              {sortedEvents.map((e) => (
                <li
                  key={e.ordinal}
                  className={
                    'ref-review-event-row' +
                    (e.event_type === 'pause' || e.event_type === 'resume' ? ' ref-review-event-row--muted' : '')
                  }
                >
                  <span className="ref-event-min">{formatEventMinute(e, halfMinutes)}</span>
                  <span className="ref-event-ico">{eventIcon(e.event_type)}</span>
                  <span className="ref-event-desc">{eventDescription(e)}{describeParticipant(e, payload)}</span>
                  {isDeletable(e) && (
                    <button
                      type="button"
                      className="ref-review-event-delete-btn"
                      onClick={() => setDeleteTarget(e)}
                      disabled={submitBusy}
                      aria-label="Delete event"
                    >
                      🗑
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {submitError && (
          <div className="ref-review-error-banner" role="alert">
            <strong>Couldn&apos;t submit.</strong> {submitError}
          </div>
        )}

        <div className="ref-review-actions">
          <button
            type="button"
            className="ref-action-btn"
            onClick={onBackToLive}
            disabled={submitBusy}
          >
            <span className="ref-action-btn-ico">←</span> BACK TO LIVE
          </button>
          <button
            type="button"
            className="ref-action-btn ref-action-btn--submit"
            onClick={() => void handleSubmit()}
            disabled={submitBusy}
          >
            <span className="ref-action-btn-ico">📤</span>
            {submitBusy ? 'SUBMITTING…' : 'SUBMIT TO ADMIN'}
          </button>
        </div>
      </div>

      {motmPickerOpen && (
        <MotmPicker
          payload={payload}
          current={clock.state.motm}
          onPick={(selection) => {
            clock.setMotm(selection)
            setMotmPickerOpen(false)
          }}
          onClose={() => setMotmPickerOpen(false)}
        />
      )}
      {deleteTarget && (
        <EventDeletePicker
          minuteLabel={formatEventMinute(deleteTarget, halfMinutes)}
          description={eventDescription(deleteTarget) + describeParticipant(deleteTarget, payload)}
          onConfirm={() => clock.deleteEvent(deleteTarget.ordinal)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </section>
  )
}

function isDeletable(e: MatchEvent): boolean {
  return e.event_type === 'goal' || e.event_type === 'own_goal'
    || e.event_type === 'yellow_card' || e.event_type === 'red_card'
}

/** Render " · <player>" if the event is associated with one, else empty. */
function describeParticipant(e: MatchEvent, payload: RefMatchdayPayload): string {
  if (!e.profile_id && !e.guest_id) return ''
  const all = [...payload.white, ...payload.black]
  const match = all.find((p) =>
    (e.profile_id && p.profile_id === e.profile_id)
    || (e.guest_id && p.guest_id === e.guest_id)
  )
  return match ? ` · ${match.display_name}` : ''
}

interface SubmitPlayer {
  profile_id: string | null
  guest_id: string | null
  team: 'white' | 'black'
  goals: number
  yellow_cards: number
  red_cards: number
  is_motm: boolean
}

interface SubmitEvent {
  event_type: MatchEvent['event_type']
  match_minute: number
  match_second: number
  team: 'white' | 'black' | null
  profile_id: string | null
  guest_id: string | null
  meta: Record<string, unknown>
  ordinal: number
}

interface SubmitPayload {
  result: 'white' | 'black' | 'draw'
  score_white: number
  score_black: number
  notes: string | null
  players: SubmitPlayer[]
  events: SubmitEvent[]
  timing: {
    kickoff_at: string
    halftime_at: string | null
    fulltime_at: string | null
    stoppage_h1_seconds: number
    stoppage_h2_seconds: number
  }
}

/**
 * Build the submit_ref_entry payload from the clock state + roster.
 * Aggregates per-player goals/cards from events; own_goal events do NOT credit
 * the scoring player (they only increment the scoreboard, which is already in
 * `score_white`/`score_black`). MOTM derived from `state.motm`.
 */
function buildSubmitPayload(
  state: ClockState,
  payload: RefMatchdayPayload,
  notes: string,
  winner: 'white' | 'black' | 'draw',
): SubmitPayload {
  const eachRoster: Array<{ team: 'white' | 'black'; players: typeof payload.white }> = [
    { team: 'white', players: payload.white },
    { team: 'black', players: payload.black },
  ]

  const players: SubmitPlayer[] = eachRoster.flatMap(({ team, players: roster }) =>
    roster.map((p) => {
      let goals = 0
      let yellow = 0
      let red = 0
      for (const e of state.events) {
        const matches =
          (p.profile_id && e.profile_id === p.profile_id)
          || (p.guest_id && e.guest_id === p.guest_id)
        if (!matches) continue
        // Goal credit: only the scorer's actual roster team gets the goal.
        // event.team is the team that *scored* — for a regular goal that's the
        // scorer's roster team; for an own_goal it's the OPPOSITE roster team.
        if (e.event_type === 'goal' && e.team === team) goals += 1
        else if (e.event_type === 'yellow_card') yellow += 1
        else if (e.event_type === 'red_card') red += 1
      }
      const isMotm =
        !!state.motm
        && state.motm.team === team
        && (
          (state.motm.profile_id !== null && state.motm.profile_id === p.profile_id)
          || (state.motm.guest_id !== null && state.motm.guest_id === p.guest_id)
        )
      return {
        profile_id: p.profile_id,
        guest_id: p.guest_id,
        team,
        goals,
        yellow_cards: yellow,
        red_cards: red,
        is_motm: isMotm,
      }
    }),
  )

  const events: SubmitEvent[] = state.events.map((e) => ({
    event_type: e.event_type,
    match_minute: e.match_minute,
    match_second: e.match_second,
    team: e.team,
    profile_id: e.profile_id,
    guest_id: e.guest_id,
    meta: e.meta,
    ordinal: e.ordinal,
  }))

  const trimmedNotes = notes.trim()

  return {
    result: winner,
    score_white: state.score_white,
    score_black: state.score_black,
    notes: trimmedNotes === '' ? null : trimmedNotes,
    players,
    events,
    timing: {
      kickoff_at: state.kickoff_at,
      halftime_at: state.halftime_at,
      fulltime_at: state.fulltime_at,
      stoppage_h1_seconds: state.stoppage_h1_seconds,
      stoppage_h2_seconds: state.stoppage_h2_seconds,
    },
  }
}

function PostSubmittedView({ clock }: { clock: ClockHook }) {
  return (
    <section className="ref-entry ref-entry--center">
      <div className="ref-post-checkmark" aria-hidden>✓</div>
      <h1 className="ref-entry-title">Submitted</h1>
      <p className="ref-entry-copy">
        Result sent for admin review. You can close this tab.
      </p>
      <div className="ref-post-final-score-readout">
        <span className="ref-post-side">WHITE {clock.state.score_white}</span>
        <span className="ref-post-divider">·</span>
        <span className="ref-post-side">BLACK {clock.state.score_black}</span>
      </div>
      {clock.state.motm && (
        <p className="ref-entry-copy" style={{ marginTop: 8 }}>
          MOTM: <strong>{clock.state.motm.display_name}</strong> ({clock.state.motm.team[0].toUpperCase()})
        </p>
      )}
    </section>
  )
}
