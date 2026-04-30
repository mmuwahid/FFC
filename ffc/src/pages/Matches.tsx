import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { MatchDetailSheet } from '../components/MatchDetailSheet'
import '../styles/matches.css'

/* §3.20 Matches — league-wide match history (Phase 1 Depth-B slice, S024).
 * Data: matches + matchdays + motm (member / guest) joined via PostgREST embeds.
 * Scope: season picker (anchored dropdown), chronological list newest first,
 * tap row → opens shared MatchDetailSheet overlay (no URL change, spec-faithful).
 * Friendly matchdays are excluded client-side so the list stays league-only.
 * S029: flashcard redesign — split-colour scoreboard, GAME N / TOTAL banner,
 * per-team scorers, winner ribbon + dim, MOTM strip.
 */

interface SeasonRow {
  id: string
  name: string
  ended_at: string | null
  archived_at: string | null
  created_at: string
  planned_games: number | null
  // S058 follow-up — number of games already played before the season was
  // tracked in this app. Default 0 for app-native seasons.
  games_seeded: number | null
}

// Issue #33 — broadened from "scorers only" to "any participant with a
// disciplinary stat" (goals, yellow card, red card, or no-show / injury)
// so the match history surfaces cards and injuries inline with goals.
interface ParticipantRow {
  team: 'white' | 'black'
  goals: number
  yellow_cards: number
  red_cards: number
  is_no_show: boolean
  profile: { id: string; display_name: string } | null
  guest: { id: string; display_name: string } | null
}

interface MatchRow {
  id: string
  result: 'win_white' | 'win_black' | 'draw'
  score_white: number
  score_black: number
  approved_at: string
  matchday_id: string
  // S058 follow-up — needed to highlight MOTM in the scorer list with gold + ⭐.
  motm_user_id: string | null
  motm_guest_id: string | null
  matchday: {
    id: string
    kickoff_at: string
    is_friendly: boolean
  } | null
  motm_member: { display_name: string } | null
  motm_guest: { display_name: string } | null
  participants: ParticipantRow[]
}

interface GroupedParticipant {
  name: string
  goals: number
  yellow_cards: number
  red_cards: number
  is_no_show: boolean
  isMotm: boolean
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const day = String(d.getDate()).padStart(2, '0')
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  return `${day}/${months[d.getMonth()]}/${d.getFullYear()}`
}

// Issue #33 — groupParticipants returns one row per player who had ANY
// disciplinary stat (goals, yellow, red, no-show / injury) so the card
// surfaces them all in the same per-team list. MOTM still flagged via id
// match (more robust than name-based since two players could share a name).
function groupParticipants(
  participants: ParticipantRow[],
  team: 'white' | 'black',
  motmUserId: string | null,
  motmGuestId: string | null,
): GroupedParticipant[] {
  type Acc = {
    goals: number
    yellow_cards: number
    red_cards: number
    is_no_show: boolean
    profileId: string | null
    guestId: string | null
  }
  const byName = new Map<string, Acc>()
  for (const p of participants) {
    if (p.team !== team) continue
    // Skip players with zero stats — they played fine and don't need a row.
    if (p.goals === 0 && p.yellow_cards === 0 && p.red_cards === 0 && !p.is_no_show) continue
    const name = p.profile?.display_name ?? p.guest?.display_name ?? '—'
    const existing = byName.get(name)
    if (existing) {
      existing.goals += p.goals
      existing.yellow_cards += p.yellow_cards
      existing.red_cards += p.red_cards
      existing.is_no_show = existing.is_no_show || p.is_no_show
    } else {
      byName.set(name, {
        goals: p.goals,
        yellow_cards: p.yellow_cards,
        red_cards: p.red_cards,
        is_no_show: p.is_no_show,
        profileId: p.profile?.id ?? null,
        guestId: p.guest?.id ?? null,
      })
    }
  }
  return Array.from(byName.entries())
    .map(([name, acc]) => ({
      name,
      goals: acc.goals,
      yellow_cards: acc.yellow_cards,
      red_cards: acc.red_cards,
      is_no_show: acc.is_no_show,
      isMotm: (motmUserId !== null && acc.profileId === motmUserId)
            || (motmGuestId !== null && acc.guestId === motmGuestId),
    }))
    // Goals first (desc), then card holders, then no-shows. Names
    // alphabetised within each tier for stability.
    .sort((a, b) => {
      if (b.goals !== a.goals) return b.goals - a.goals
      const tier = (g: GroupedParticipant) => g.goals > 0 ? 0 : (g.red_cards + g.yellow_cards) > 0 ? 1 : 2
      const ta = tier(a), tb = tier(b)
      if (ta !== tb) return ta - tb
      return a.name.localeCompare(b.name)
    })
}

function bannerLabel(matchdayNumber: number, total: number | null): string {
  return total ? `GAME ${matchdayNumber} / ${total}` : `GAME ${matchdayNumber}`
}

// Issue #33 — single row that combines goals + cards + injury markers for
// one player. Examples: `⚽ ⭐ Latif ×2`, `🟨 Saz`, `⚽ Karim ×1 🟥`,
// `🤕 Moe Hamdan` (no-show / injury). HAT pill removed per follow-up
// feedback ("just adds clutter" — the ×N suffix already conveys it).
function ParticipantBadge({ row }: { row: GroupedParticipant }) {
  const scored = row.goals > 0
  return (
    <span className={`mt-scorer-row${row.isMotm ? ' mt-scorer-row--motm' : ''}`}>
      {scored && <span className="mt-scorer-ball">⚽</span>}
      {scored && row.isMotm && <span className="mt-scorer-star">⭐</span>}
      {!scored && row.is_no_show && <span className="mt-stat-icon" aria-label="Injury / no-show" title="Injury / no-show">🤕</span>}
      {row.name}
      {scored && <> ×{row.goals}</>}
      {row.yellow_cards > 0 && (
        <span className="mt-stat-icon mt-stat-icon--yellow" aria-label={`${row.yellow_cards} yellow card${row.yellow_cards > 1 ? 's' : ''}`} title="Yellow card">
          🟨{row.yellow_cards > 1 ? `×${row.yellow_cards}` : ''}
        </span>
      )}
      {row.red_cards > 0 && (
        <span className="mt-stat-icon mt-stat-icon--red" aria-label="Red card" title="Red card">🟥</span>
      )}
      {scored && row.is_no_show && (
        <span className="mt-stat-icon" aria-label="Injury / no-show" title="Injury / no-show">🤕</span>
      )}
    </span>
  )
}

export function Matches() {
  const [seasons, setSeasons] = useState<SeasonRow[]>([])
  const [activeSeasonId, setActiveSeasonId] = useState<string | null>(null)
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [matchdayNumber, setMatchdayNumber] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [openMatchId, setOpenMatchId] = useState<string | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Load seasons once
  useEffect(() => {
    supabase
      .from('seasons')
      .select('id, name, ended_at, archived_at, created_at, planned_games, games_seeded')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const rows = data ?? []
        setSeasons(rows)
        const active = rows.find(s => !s.ended_at && !s.archived_at) ?? rows[0]
        if (active) setActiveSeasonId(active.id)
      })
  }, [])

  // Load matches + matchday numbers. Extracted as a useCallback so realtime
  // subscriptions + window-focus / visibilitychange listeners can re-run it.
  // Issue #5 — previously the screen would show "No matches yet" on tab
  // return until a hard refresh; the new effects guarantee a re-fetch on
  // every visit and on every realtime mutation against matches/match_players.
  const loadMatches = useCallback(async (seasonId: string, mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true)
    const [matchRes, mdRes] = await Promise.all([
      supabase
        .from('matches')
        .select(`
          id, result, score_white, score_black, approved_at, matchday_id,
          motm_user_id, motm_guest_id,
          matchday:matchdays!inner(id, kickoff_at, is_friendly),
          motm_member:profiles!matches_motm_user_id_fkey(display_name),
          motm_guest:match_guests!matches_motm_guest_id_fkey(display_name),
          participants:match_players(team, goals, yellow_cards, red_cards, is_no_show, profile:profiles!match_players_profile_id_fkey(id, display_name), guest:match_guests(id, display_name))
        `)
        .eq('season_id', seasonId)
        .not('approved_at', 'is', null)
        .order('approved_at', { ascending: false })
        .limit(50),
      // S058 (post-close fix): the `profile:profiles(...)` embed inside the
      // scorers nested select was AMBIGUOUS — `match_players` has THREE FKs
      // to `profiles` (profile_id, substituted_in_by, updated_by). PostgREST
      // can't pick a path and silently errors the whole query, returning
      // null data → "No matches yet". Explicitly named the FK constraint
      // (`!match_players_profile_id_fkey`) to disambiguate.
      supabase
        .from('matchdays')
        .select('id, kickoff_at')
        .eq('season_id', seasonId)
        .order('kickoff_at', { ascending: true }),
    ])

    // S058 follow-up: matchday numbering starts from games_seeded + 1.
    // Season 11 was seeded with 30 prior games, so the first app-tracked
    // matchday displays as "GAME 31 / 40" not "GAME 1 / 40". Default 0 for
    // app-native seasons.
    const seasonRow = seasons.find((s) => s.id === seasonId)
    const seedOffset = seasonRow?.games_seeded ?? 0
    const numMap: Record<string, number> = {}
    ;(mdRes.data ?? []).forEach((row, i) => { numMap[row.id] = seedOffset + i + 1 })
    setMatchdayNumber(numMap)

    // S058 (post-close fix): if the matches query errored, log it so future
    // silent-empty regressions surface in the console. Without this, an
    // ambiguous PostgREST embed errors silently and the user sees a confusing
    // "No matches yet" state even though approved matches exist.
    if (matchRes.error) {
      console.error('[Matches] load error:', matchRes.error)
    }

    /* S058 #25b — drop the friendly filter. Users expect Matches tab to be the
     * full match history (the leaderboard already excludes friendlies via
     * v_season_standings, so they don't double-count there). Friendlies are
     * visually marked with a chip on the card so the difference is clear. */
    const rows = ((matchRes.data ?? []) as unknown as MatchRow[])
      .filter(m => m.matchday)
    setMatches(rows)
    setLoading(false)
  }, [seasons])

  // Initial + season-switch load
  useEffect(() => {
    if (!activeSeasonId) return
    void loadMatches(activeSeasonId, 'initial')
  }, [activeSeasonId, loadMatches])

  // Realtime — any match approval/edit triggers a silent refresh.
  useEffect(() => {
    if (!activeSeasonId) return
    const ch = supabase
      .channel(`matches-tab-${activeSeasonId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
        void loadMatches(activeSeasonId, 'refresh')
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_players' }, () => {
        void loadMatches(activeSeasonId, 'refresh')
      })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [activeSeasonId, loadMatches])

  // Re-fetch on tab focus / visibility — fixes "No matches yet" stale-state
  // bug when switching tabs in the bottom nav.
  useEffect(() => {
    if (!activeSeasonId) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadMatches(activeSeasonId, 'refresh')
    }
    const onFocus = () => { void loadMatches(activeSeasonId, 'refresh') }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [activeSeasonId, loadMatches])

  // Click-outside to close picker
  useEffect(() => {
    if (!pickerOpen) return
    function onDoc(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [pickerOpen])

  const activeSeason = useMemo(
    () => seasons.find(s => s.id === activeSeasonId) ?? null,
    [seasons, activeSeasonId],
  )

  return (
    <div className="mt-screen">

      <div className="mt-head">
        <h1 className="mt-title">Matches</h1>
        <div className="mt-picker-wrap" ref={pickerRef}>
          <button
            className="mt-picker"
            type="button"
            onClick={() => setPickerOpen(v => !v)}
            aria-expanded={pickerOpen}
          >
            <span className="mt-picker-dot" />
            <span>{activeSeason?.name ?? 'Season'}</span>
            <span className="mt-picker-caret">{pickerOpen ? '▴' : '▾'}</span>
          </button>
          {pickerOpen && (
            <div className="mt-picker-menu" role="menu">
              {seasons.map(s => (
                <button
                  key={s.id}
                  type="button"
                  className="mt-picker-item"
                  onClick={() => { setActiveSeasonId(s.id); setPickerOpen(false) }}
                  role="menuitem"
                >
                  <span>{s.name}</span>
                  {s.id === activeSeasonId && <span className="mt-picker-check">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="mt-skel-list">
          {[0, 1, 2].map(i => (
            <div key={i} className="mt-skel-row">
              <div className="mt-skel mt-skel-date" />
              <div>
                <div className="mt-skel mt-skel-score" />
                <div className="mt-skel mt-skel-sub" />
              </div>
              <div className="mt-skel mt-skel-chev" />
            </div>
          ))}
        </div>
      ) : matches.length === 0 ? (
        <div className="mt-empty">
          <div className="mt-empty-glyph" aria-hidden>⚽</div>
          <div className="mt-empty-title">No matches yet</div>
          <div className="mt-empty-body">Matches played this season will appear here.</div>
        </div>
      ) : (
        <>
          <div className="mt-section-label">
            {activeSeason?.name} · {matches.length} {matches.length === 1 ? 'match' : 'matches'}
          </div>
          <div className="mt-list">
            {matches.map(m => {
              const whiteRows = groupParticipants(m.participants, 'white', m.motm_user_id, m.motm_guest_id)
              const blackRows = groupParticipants(m.participants, 'black', m.motm_user_id, m.motm_guest_id)
              // Issue #37 follow-up — MOTM footer banner removed; the
              // scorer list already shows MOTM inline (gold ⭐ + name in
              // gold), so the footer was duplicating information.
              const isDraw = m.result === 'draw'
              const whiteWon = m.result === 'win_white'
              const blackWon = m.result === 'win_black'
              const n = matchdayNumber[m.matchday_id] ?? 0
              const total = activeSeason?.planned_games ?? null

              return (
                <button
                  key={m.id}
                  type="button"
                  className="mt-card"
                  onClick={() => setOpenMatchId(m.id)}
                >
                  <div className="mt-card-banner">
                    <span className="mt-card-banner-title">{bannerLabel(n, total)}</span>
                    {m.matchday?.is_friendly && (
                      <span className="mt-friendly-chip">FRIENDLY</span>
                    )}
                    <span className="mt-card-banner-date">{formatDate(m.matchday?.kickoff_at ?? m.approved_at)}</span>
                  </div>

                  {isDraw && <div className="mt-draw-banner">DRAW</div>}
                  {whiteWon && <>
                    <div className="mt-winner-ribbon left" />
                    <div className="mt-winner-label left">WINNER</div>
                  </>}
                  {blackWon && <>
                    <div className="mt-winner-ribbon right" />
                    <div className="mt-winner-label right">WINNER</div>
                  </>}

                  <div className="splitc">
                    <div className={`splitc-half splitc-white${blackWon ? ' splitc-loser' : ''}`}>
                      <div className="splitc-logo splitc-logo-white">
                        <img src="/ffc-logo.svg" alt="FFC" />
                      </div>
                      <span className="splitc-team-label">WHITE</span>
                      <span className="splitc-score splitc-score-white">{m.score_white}</span>
                    </div>
                    <div className={`splitc-half splitc-black${whiteWon ? ' splitc-loser' : ''}`}>
                      <div className="splitc-logo splitc-logo-black">
                        <img src="/ffc-logo.svg" alt="FFC" />
                      </div>
                      <span className="splitc-team-label right">BLACK</span>
                      <span className="splitc-score splitc-score-black">{m.score_black}</span>
                    </div>
                    <div className="splitc-vs">VS</div>
                  </div>

                  <div className="splitc-footer">
                    <div className={`splitc-footer-half${whiteRows.length === 0 ? ' empty' : ''}`}>
                      {whiteRows.length === 0 ? (
                        <span className="mt-scorer-row">no goals</span>
                      ) : whiteRows.map(r => (
                        <ParticipantBadge key={`w-${r.name}`} row={r} />
                      ))}
                    </div>
                    <div className={`splitc-footer-half right${blackRows.length === 0 ? ' empty' : ''}`}>
                      {blackRows.length === 0 ? (
                        <span className="mt-scorer-row">no goals</span>
                      ) : blackRows.map(r => (
                        <ParticipantBadge key={`b-${r.name}`} row={r} />
                      ))}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}

      {openMatchId && (
        <MatchDetailSheet
          matchId={openMatchId}
          onClose={() => setOpenMatchId(null)}
        />
      )}

    </div>
  )
}
