import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'

/* §3.15 Match-detail sheet — read-only overlay (Phase 1 Depth-B slice, S024).
 * Opens via <MatchDetailSheet matchId profileId? onClose /> from any row tap.
 * Spec note: W/D/L chip only renders when profileId is passed (Matches list
 * omits it — no single owner perspective; Profile Recent Matches passes it).
 * Late-cancel strip is deferred until match_players.late_cancel_* columns land.
 */

interface Props {
  matchId: string
  profileId?: string
  onClose: () => void
}

interface MatchMain {
  id: string
  result: 'win_white' | 'win_black' | 'draw'
  score_white: number
  score_black: number
  motm_user_id: string | null
  motm_guest_id: string | null
  matchday: { id: string; kickoff_at: string; venue: string | null; season_id: string } | null
  season: { id: string; name: string } | null
  motm_member: { display_name: string } | null
  motm_guest: { display_name: string } | null
}

interface RosterRow {
  id: string
  team: 'white' | 'black'
  is_captain: boolean
  goals: number
  yellow_cards: number
  red_cards: number
  is_no_show: boolean
  profile_id: string | null
  guest_id: string | null
  member: {
    id: string
    display_name: string
    primary_position: string | null
    secondary_position: string | null
  } | null
  guest: {
    id: string
    display_name: string
    primary_position: string | null
    secondary_position: string | null
    inviter: { display_name: string } | null
  } | null
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase() ?? '')
    .join('')
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const day = String(d.getDate()).padStart(2, '0')
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  return `${day}/${months[d.getMonth()]}/${d.getFullYear()}`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  let h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'pm' : 'am'
  h = h % 12 || 12
  return `${h}:${m} ${ampm}`
}

export function MatchDetailSheet({ matchId, profileId, onClose }: Props) {
  const [main, setMain] = useState<MatchMain | null>(null)
  const [roster, setRoster] = useState<RosterRow[]>([])
  const [matchdayNumber, setMatchdayNumber] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Esc to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Prevent body scroll while sheet open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Fetch data
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      const [mainRes, rosterRes] = await Promise.all([
        supabase
          .from('matches')
          .select(`
            id, result, score_white, score_black, motm_user_id, motm_guest_id,
            matchday:matchdays(id, kickoff_at, venue, season_id),
            season:seasons(id, name),
            motm_member:profiles!matches_motm_user_id_fkey(display_name),
            motm_guest:match_guests!matches_motm_guest_id_fkey(display_name)
          `)
          .eq('id', matchId)
          .maybeSingle(),
        supabase
          .from('match_players')
          .select(`
            id, team, is_captain, goals, yellow_cards, red_cards, is_no_show,
            profile_id, guest_id,
            member:profiles!match_players_profile_id_fkey(id, display_name, primary_position, secondary_position),
            guest:match_guests!match_players_guest_id_fkey(id, display_name, primary_position, secondary_position,
              inviter:profiles!match_guests_inviter_id_fkey(display_name))
          `)
          .eq('match_id', matchId),
      ])

      if (cancelled) return
      if (mainRes.error || !mainRes.data) {
        setError("Couldn't load match details.")
        setLoading(false)
        return
      }
      const mainData = mainRes.data as unknown as MatchMain
      setMain(mainData)
      setRoster(((rosterRes.data ?? []) as unknown as RosterRow[]).filter(r => !r.is_no_show))

      // matchday number — fetch all in season and index
      if (mainData.matchday?.season_id) {
        const { data: mds } = await supabase
          .from('matchdays')
          .select('id, kickoff_at')
          .eq('season_id', mainData.matchday.season_id)
          .order('kickoff_at', { ascending: true })
        if (!cancelled) {
          const idx = (mds ?? []).findIndex(md => md.id === mainData.matchday?.id)
          setMatchdayNumber(idx >= 0 ? idx + 1 : null)
        }
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [matchId])

  // W/D/L chip — only when profileId provided and player appears in roster
  const viewerWdl = useMemo<'W' | 'D' | 'L' | null>(() => {
    if (!profileId || !main) return null
    const row = roster.find(r => r.profile_id === profileId)
    if (!row) return null
    if (main.result === 'draw') return 'D'
    if (row.team === 'white' && main.result === 'win_white') return 'W'
    if (row.team === 'black' && main.result === 'win_black') return 'W'
    return 'L'
  }, [profileId, main, roster])

  const white = useMemo(
    () => roster.filter(r => r.team === 'white').sort((a, b) => Number(b.is_captain) - Number(a.is_captain)),
    [roster],
  )
  const black = useMemo(
    () => roster.filter(r => r.team === 'black').sort((a, b) => Number(b.is_captain) - Number(a.is_captain)),
    [roster],
  )

  const motmTeam = useMemo<'white' | 'black' | null>(() => {
    if (!main || !roster.length) return null
    if (main.motm_user_id) {
      const r = roster.find(x => x.profile_id === main.motm_user_id)
      return r?.team ?? null
    }
    if (main.motm_guest_id) {
      const r = roster.find(x => x.guest_id === main.motm_guest_id)
      return r?.team ?? null
    }
    return null
  }, [main, roster])

  const motmName = main?.motm_member?.display_name ?? main?.motm_guest?.display_name ?? null
  const motmIsGuest = !main?.motm_member && !!main?.motm_guest

  return createPortal(
    <div className="md-scrim" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="md-sheet" onClick={e => e.stopPropagation()}>
        <div className="md-grabber" onClick={onClose} aria-label="Close" role="button" tabIndex={0} />

        {loading ? (
          <div className="md-loading">Loading…</div>
        ) : error ? (
          <div className="md-error">{error} <button type="button" onClick={onClose} className="md-error-close">Close</button></div>
        ) : !main ? (
          <div className="md-error">This match is no longer available. <button type="button" onClick={onClose} className="md-error-close">Close</button></div>
        ) : (
          <>
            {/* Header scoreline */}
            <div className="md-header">
              <div className="md-score-line">
                <span className="md-team-label">WHITE</span>
                <span className="md-score">{main.score_white}</span>
                <span className="md-score-dash">–</span>
                <span className="md-score">{main.score_black}</span>
                <span className="md-team-label">BLACK</span>
              </div>
              {viewerWdl && (
                <div className={`md-wdl md-wdl-${viewerWdl}`}>{viewerWdl}</div>
              )}
            </div>

            {/* MOTM banner */}
            {motmName && (
              <div className={`md-motm ${motmTeam ? `md-motm-${motmTeam}` : ''}`}>
                <span className="md-motm-star">⭐</span>
                <span className={motmIsGuest ? 'md-motm-guest' : ''}>
                  MOTM · {motmName}
                </span>
                {motmTeam && <span className="md-motm-team-tag">{motmTeam.toUpperCase()}</span>}
              </div>
            )}

            {/* WHITE roster */}
            <RosterSection team="white" rows={white} score={main.score_white} motmProfileId={main.motm_user_id} motmGuestId={main.motm_guest_id} />
            {/* BLACK roster */}
            <RosterSection team="black" rows={black} score={main.score_black} motmProfileId={main.motm_user_id} motmGuestId={main.motm_guest_id} />

            {/* Footer meta */}
            {main.matchday && (
              <div className="md-footer">
                <div>
                  {formatDate(main.matchday.kickoff_at)} · {formatTime(main.matchday.kickoff_at)}
                  {main.matchday.venue ? ` · ${main.matchday.venue}` : ''}
                </div>
                <div>
                  {matchdayNumber ? `Matchday ${matchdayNumber}` : ''}{matchdayNumber && main.season ? ' · ' : ''}{main.season?.name ?? ''}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

function RosterSection({
  team, rows, score, motmProfileId, motmGuestId,
}: {
  team: 'white' | 'black'
  rows: RosterRow[]
  score: number
  motmProfileId: string | null
  motmGuestId: string | null
}) {
  return (
    <div className="md-section">
      <div className="md-section-head">
        <span className={`md-section-title md-section-${team}`}>{team.toUpperCase()}</span>
        <span className="md-section-score">{score}</span>
      </div>
      {rows.length === 0 ? (
        <div className="md-section-empty">No roster recorded.</div>
      ) : (
        rows.map(r => {
          const isGuest = !!r.guest_id
          const name = isGuest
            ? (r.guest?.display_name ?? 'Guest')
            : (r.member?.display_name ?? 'Player')
          const pos1 = isGuest ? r.guest?.primary_position : r.member?.primary_position
          const pos2 = isGuest ? r.guest?.secondary_position : r.member?.secondary_position
          const inviter = isGuest ? r.guest?.inviter?.display_name : null
          const isMotm = (!isGuest && r.profile_id === motmProfileId) ||
                         (isGuest && r.guest_id === motmGuestId)
          return (
            <div key={r.id} className={`md-row ${isGuest ? 'md-row-guest' : ''}`}>
              <div className={`md-avatar ${isGuest ? 'md-avatar-guest' : ''}`}>{initials(name)}</div>
              <div className="md-row-body">
                <div className="md-row-name">
                  {r.is_captain && <span className="md-cap">(C)</span>}
                  <span className={isGuest ? 'md-name-guest' : ''}>{name}</span>
                </div>
                {isGuest && inviter && (
                  <div className="md-row-sub">+1 · invited by {inviter}</div>
                )}
              </div>
              <div className="md-row-positions">
                {pos1 && <span className="md-pos md-pos-primary">{pos1.toUpperCase()}</span>}
                {pos2 && <span className="md-pos md-pos-secondary">{pos2.toUpperCase()}</span>}
              </div>
              <div className="md-row-stats">
                {r.goals > 0 && <span className="md-stat md-stat-goal">⚽{r.goals}</span>}
                {r.yellow_cards > 0 && <span className="md-stat md-stat-yellow">🟨{r.yellow_cards > 1 ? r.yellow_cards : ''}</span>}
                {r.red_cards > 0 && <span className="md-stat md-stat-red">🟥</span>}
                {isMotm && <span className="md-stat md-stat-motm">⭐</span>}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
