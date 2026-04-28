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
}

interface ScorerRow {
  team: 'white' | 'black'
  goals: number
  profile: { display_name: string } | null
  guest: { display_name: string } | null
}

interface MatchRow {
  id: string
  result: 'win_white' | 'win_black' | 'draw'
  score_white: number
  score_black: number
  approved_at: string
  matchday_id: string
  matchday: {
    id: string
    kickoff_at: string
    is_friendly: boolean
  } | null
  motm_member: { display_name: string } | null
  motm_guest: { display_name: string } | null
  scorers: ScorerRow[]
}

interface GroupedScorer {
  name: string
  goals: number
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const day = String(d.getDate()).padStart(2, '0')
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  return `${day}/${months[d.getMonth()]}/${d.getFullYear()}`
}

function groupScorers(scorers: ScorerRow[], team: 'white' | 'black'): GroupedScorer[] {
  const byName = new Map<string, number>()
  for (const s of scorers) {
    if (s.team !== team || s.goals <= 0) continue
    const name = s.profile?.display_name ?? s.guest?.display_name ?? '—'
    byName.set(name, (byName.get(name) ?? 0) + s.goals)
  }
  return Array.from(byName.entries())
    .map(([name, goals]) => ({ name, goals }))
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name))
}

function bannerLabel(matchdayNumber: number, total: number | null): string {
  return total ? `GAME ${matchdayNumber} / ${total}` : `GAME ${matchdayNumber}`
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
      .select('id, name, ended_at, archived_at, created_at, planned_games')
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
          matchday:matchdays!inner(id, kickoff_at, is_friendly),
          motm_member:profiles!matches_motm_user_id_fkey(display_name),
          motm_guest:match_guests!matches_motm_guest_id_fkey(display_name),
          scorers:match_players(team, goals, profile:profiles(display_name), guest:match_guests(display_name))
        `)
        .eq('season_id', seasonId)
        .not('approved_at', 'is', null)
        .order('approved_at', { ascending: false })
        .limit(50),
      supabase
        .from('matchdays')
        .select('id, kickoff_at')
        .eq('season_id', seasonId)
        .order('kickoff_at', { ascending: true }),
    ])

    const numMap: Record<string, number> = {}
    ;(mdRes.data ?? []).forEach((row, i) => { numMap[row.id] = i + 1 })
    setMatchdayNumber(numMap)

    const rows = ((matchRes.data ?? []) as unknown as MatchRow[])
      .filter(m => m.matchday && !m.matchday.is_friendly)
    setMatches(rows)
    setLoading(false)
  }, [])

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
              const whiteScorers = groupScorers(m.scorers, 'white')
              const blackScorers = groupScorers(m.scorers, 'black')
              const motmName = m.motm_member?.display_name ?? m.motm_guest?.display_name ?? null
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
                    <div className={`splitc-footer-half${whiteScorers.length === 0 ? ' empty' : ''}`}>
                      {whiteScorers.length === 0 ? (
                        <span className="mt-scorer-row">no goals</span>
                      ) : whiteScorers.map(s => (
                        <span key={`w-${s.name}`} className="mt-scorer-row">
                          <span className="mt-scorer-ball">⚽</span>
                          {s.goals > 1 ? `${s.name} ×${s.goals}` : s.name}
                          {s.goals >= 3 && <span className="mt-hat-badge">HAT</span>}
                        </span>
                      ))}
                    </div>
                    <div className={`splitc-footer-half right${blackScorers.length === 0 ? ' empty' : ''}`}>
                      {blackScorers.length === 0 ? (
                        <span className="mt-scorer-row">no goals</span>
                      ) : blackScorers.map(s => (
                        <span key={`b-${s.name}`} className="mt-scorer-row">
                          <span className="mt-scorer-ball">⚽</span>
                          {s.goals > 1 ? `${s.name} ×${s.goals}` : s.name}
                          {s.goals >= 3 && <span className="mt-hat-badge">HAT</span>}
                        </span>
                      ))}
                    </div>
                  </div>

                  {motmName && (
                    <div className="mt-motm-strip">⭐ MOTM · {motmName}</div>
                  )}
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
