import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMatchSession, type RefMatchdayPayload } from '../lib/useMatchSession'
import { useMatchClock, type MatchEvent } from '../lib/useMatchClock'
import { REGULATION_HALF_MINUTES, MAX_STOPPAGE_SOFT_LIMIT_SECONDS } from '../lib/refConsoleConstants'
import '../styles/ref-entry.css'

/* §3.4-v2 Slice 2B-C — RefEntry pre-match mode.
 *
 * URL: /ref/:token (anonymous; token is the only auth).
 *
 * Modes (slice 2B-C handles loading/invalid/pre; 2B-D adds live; 2B-E adds post):
 *   loading → spinner
 *   invalid → token-rejected screen
 *   pre     → matchday header + rosters + KICK OFF button
 *   live    → placeholder ("Live console — wired in slice 2B-D")
 */

export function RefEntry() {
  const { token } = useParams()
  const { mode, payload, error, kickoffAt, startMatch, sessionStorageKey } = useMatchSession(token)

  if (mode === 'loading') {
    return (
      <section className="ref-entry ref-entry--center">
        <div className="ref-entry-spinner" aria-hidden />
        <p className="ref-entry-hint">Loading matchday…</p>
      </section>
    )
  }

  if (mode === 'invalid') {
    return (
      <section className="ref-entry ref-entry--center">
        <h1 className="ref-entry-title">Link expired</h1>
        <p className="ref-entry-copy">
          This ref link is no longer valid — it may have been used or replaced. Ask
          the admin to share a fresh link.
        </p>
        {error && <p className="ref-entry-error">{error}</p>}
      </section>
    )
  }

  if (mode === 'live') {
    if (!payload) return null
    return (
      <LiveConsole
        payload={payload}
        kickoffAt={kickoffAt}
        sessionStorageKey={sessionStorageKey}
      />
    )
  }

  if (mode === 'post') {
    return (
      <section className="ref-entry ref-entry--center">
        <h1 className="ref-entry-title">Submit pending</h1>
        <p className="ref-entry-copy">Post-match summary wires up in slice 2B-E.</p>
      </section>
    )
  }

  // mode === 'pre'
  if (!payload) return null

  const md = payload.matchday
  const kickoffLabel = formatKickoff(md.kickoff_at)

  if (!payload.has_match_row || md.roster_locked_at === null) {
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
        <RosterCard team="white" players={payload.white} />
        <RosterCard team="black" players={payload.black} />
      </div>

      <div className="ref-entry-cta-wrap">
        <button
          type="button"
          className="ref-entry-cta"
          onClick={() => void startMatch()}
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

interface LiveConsoleProps {
  payload: RefMatchdayPayload
  kickoffAt: string | null
  sessionStorageKey: string | null
}

function LiveConsole({ payload, kickoffAt, sessionStorageKey }: LiveConsoleProps) {
  const clock = useMatchClock({
    sessionStorageKey,
    kickoffIso: kickoffAt,
    format: payload.matchday.effective_format,
  })

  // Picker state — Tasks 4 & 5 add more pickers (pause-reason, card,
  // MOTM); Task 3 only needs the scorer trigger so the score-cell handlers
  // compile. The own-goal toggle is a local useState INSIDE ScorerPicker.
  const [scorerTeam, setScorerTeam] = useState<'white' | 'black' | null>(null)

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
        {/* Action rows are wired in Tasks 4 + 5. For Task 3 keep a minimal action row. */}
        <div className="ref-action-row">
          <button
            type="button"
            className={
              'ref-action-btn ' +
              (clock.state.paused_at ? 'ref-action-btn--resume' : 'ref-action-btn--pause')
            }
            onClick={() => (clock.state.paused_at ? clock.resume() : clock.pause())}
          >
            <span className="ref-action-btn-ico">{clock.state.paused_at ? '▶' : '⏸'}</span>
            {clock.state.paused_at ? 'RESUME' : 'PAUSE'}
          </button>
          <button
            type="button"
            className="ref-action-btn ref-action-btn--end"
            onClick={() => clock.endHalf()}
            disabled={clock.state.half !== 1}
          >
            <span className="ref-action-btn-ico">⏭</span>
            END HALF
          </button>
        </div>
        <EventStrip events={clock.state.events} format={payload.matchday.effective_format} />
      </div>
      {/* Scorer picker placeholder — wired fully in Task 4. */}
      {scorerTeam && (
        <ScorerPickerStub
          team={scorerTeam}
          onClose={() => setScorerTeam(null)}
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
  clock: ReturnType<typeof useMatchClock>
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

function ScoreReadOnly({ clock }: { clock: ReturnType<typeof useMatchClock> }) {
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

function HalftimeView({ clock }: { clock: ReturnType<typeof useMatchClock> }) {
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
  const baseHalfStart = e.match_minute < regulationHalfMinutes ? 0 : regulationHalfMinutes
  const minutesIntoHalf = e.match_minute - baseHalfStart
  const isStoppage = minutesIntoHalf >= regulationHalfMinutes
  if (isStoppage) {
    const stoppageMin = minutesIntoHalf - regulationHalfMinutes
    return `${regulationHalfMinutes}+${stoppageMin}'`
  }
  return `${e.match_minute}'`
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

/* Stub picker — replaced in Task 4. Just allows the score cells to compile
 * with an onClick handler. */
function ScorerPickerStub({ team, onClose }: { team: 'white' | 'black'; onClose: () => void }) {
  return (
    <>
      <div className="ref-picker-backdrop" onClick={onClose} />
      <div className="ref-picker-sheet">
        <div className="ref-picker-grabber" />
        <h3 className="ref-picker-title">Who scored for {team === 'white' ? 'White' : 'Black'}?</h3>
        <p className="ref-picker-sub">Picker UI lands in Task 4.</p>
        <button type="button" className="ref-picker-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  )
}
