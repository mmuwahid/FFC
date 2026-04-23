import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { MatchDetailSheet } from '../components/MatchDetailSheet'

/* §3.20 Matches — league-wide match history (Phase 1 Depth-B slice, S024).
 * Data: matches + matchdays + motm (member / guest) joined via PostgREST embeds.
 * Scope: season picker (anchored dropdown), chronological list newest first,
 * tap row → opens shared MatchDetailSheet overlay (no URL change, spec-faithful).
 * Friendly matchdays are excluded client-side so the list stays league-only.
 */

interface SeasonRow {
  id: string
  name: string
  ended_at: string | null
  archived_at: string | null
  created_at: string
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
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const day = String(d.getDate()).padStart(2, '0')
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  return `${day}/${months[d.getMonth()]}/${d.getFullYear()}`
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
      .select('id, name, ended_at, archived_at, created_at')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const rows = data ?? []
        setSeasons(rows)
        const active = rows.find(s => !s.ended_at && !s.archived_at) ?? rows[0]
        if (active) setActiveSeasonId(active.id)
      })
  }, [])

  // Load matches + matchday numbers whenever active season changes
  useEffect(() => {
    if (!activeSeasonId) return
    setLoading(true)
    ;(async () => {
      const [matchRes, mdRes] = await Promise.all([
        supabase
          .from('matches')
          .select(`
            id, result, score_white, score_black, approved_at, matchday_id,
            matchday:matchdays!inner(id, kickoff_at, is_friendly),
            motm_member:profiles!matches_motm_user_id_fkey(display_name),
            motm_guest:match_guests!matches_motm_guest_id_fkey(display_name)
          `)
          .eq('season_id', activeSeasonId)
          .not('approved_at', 'is', null)
          .order('approved_at', { ascending: false })
          .limit(50),
        supabase
          .from('matchdays')
          .select('id, kickoff_at')
          .eq('season_id', activeSeasonId)
          .order('kickoff_at', { ascending: true }),
      ])

      // Build matchday# lookup (index+1 by kickoff_at asc)
      const numMap: Record<string, number> = {}
      ;(mdRes.data ?? []).forEach((row, i) => {
        numMap[row.id] = i + 1
      })
      setMatchdayNumber(numMap)

      const rows = ((matchRes.data ?? []) as unknown as MatchRow[])
        .filter(m => m.matchday && !m.matchday.is_friendly)
      setMatches(rows)
      setLoading(false)
    })()
  }, [activeSeasonId])

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
              const isDraw = m.result === 'draw'
              const whiteWon = m.result === 'win_white'
              const blackWon = m.result === 'win_black'
              const motmName = m.motm_member?.display_name ?? m.motm_guest?.display_name ?? null
              return (
                <button
                  key={m.id}
                  type="button"
                  className="mt-row"
                  onClick={() => setOpenMatchId(m.id)}
                >
                  <div className="mt-row-date">
                    <div className="mt-row-date-main">{formatDate(m.matchday?.kickoff_at ?? m.approved_at)}</div>
                    {matchdayNumber[m.matchday_id] && (
                      <div className="mt-row-date-sub">Matchday {matchdayNumber[m.matchday_id]}</div>
                    )}
                  </div>
                  <div className="mt-row-main">
                    <div className="mt-score">
                      <span className={`mt-team-chip mt-team-white ${blackWon ? 'mt-team-loser' : ''}`}>WHITE</span>
                      <span className={`mt-score-num ${blackWon ? 'mt-score-loser' : ''}`}>{m.score_white}</span>
                      <span className="mt-score-dash">–</span>
                      <span className={`mt-score-num ${whiteWon ? 'mt-score-loser' : ''}`}>{m.score_black}</span>
                      <span className={`mt-team-chip mt-team-black ${whiteWon ? 'mt-team-loser' : ''}`}>BLACK</span>
                      {isDraw && <span className="mt-draw-tag">DRAW</span>}
                    </div>
                    {motmName && (
                      <div className="mt-motm">
                        <span className="mt-motm-star">⭐</span>
                        <span>MOTM · {motmName}</span>
                      </div>
                    )}
                  </div>
                  <span className="mt-row-chev" aria-hidden>›</span>
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
