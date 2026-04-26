import { useParams } from 'react-router-dom'
import { useMatchSession } from '../lib/useMatchSession'
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
  const { mode, payload, error, startMatch } = useMatchSession(token)

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
    return (
      <section className="ref-entry ref-entry--center">
        <h1 className="ref-entry-title">Live console</h1>
        <p className="ref-entry-copy">
          Live mode wires up in slice 2B-D. The match clock, score blocks, and
          event log come next.
        </p>
      </section>
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
