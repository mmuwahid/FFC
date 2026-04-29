import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

/* §3.24 Awards page (S053, V3.0:139).
 * Routes:
 *   /awards                            → active season default
 *   /awards?season_id=<uuid>           → specific season (active or ended)
 * Active season:  reads v_season_award_winners_live (live computation)
 * Ended season:   reads season_awards snapshot table
 * Wall of Fame (Task 5): reads season_awards table only (ended seasons)
 */

type AwardKind = 'ballon_dor' | 'golden_boot' | 'most_motm'

interface SeasonRow {
  id: string
  name: string
  starts_on: string
  ended_at: string | null
  archived_at: string | null
}

interface WinnerRow {
  award_kind: AwardKind
  winner_profile_id: string | null
  runner_up_profile_id: string | null
  metric_value: number
  runner_up_metric: number | null
  meta: Record<string, number> | null
}

interface ProfileLite {
  id: string
  display_name: string
  avatar_url: string | null
  deleted_at: string | null
}

const HERO_META: Record<AwardKind, { trophy: string; title: string; metricLabel: (m: number, meta: Record<string, number> | null) => string }> = {
  ballon_dor: {
    trophy: '🏆',
    title: "Ballon d'Or",
    metricLabel: (m, meta) => {
      const wins = meta?.wins ?? 0
      const draws = meta?.draws ?? 0
      const losses = meta?.losses ?? 0
      const winPct = meta?.win_pct ?? 0
      return `${m} pts · ${wins}W ${draws}D ${losses}L · ${winPct}% win`
    },
  },
  golden_boot: {
    trophy: '⚽',
    title: 'Golden Boot',
    metricLabel: (m, meta) => {
      const gpm = meta?.goals_per_match ?? 0
      return `${m} goals · ${gpm} per match`
    },
  },
  most_motm: {
    trophy: '⭐',
    title: 'Most MOTM',
    metricLabel: (m, meta) => {
      const mp = meta?.matches_played ?? 0
      return `${m} MOTMs · in ${mp} matches`
    },
  },
}

function renderHero(
  row: WinnerRow,
  profilesById: Record<string, ProfileLite>,
  navigate: ReturnType<typeof useNavigate>,
  seasonId: string,
) {
  const winner = row.winner_profile_id ? profilesById[row.winner_profile_id] : null
  const runner = row.runner_up_profile_id ? profilesById[row.runner_up_profile_id] : null
  const heroDef = HERO_META[row.award_kind]
  const initials = winner?.display_name ? winner.display_name[0]?.toUpperCase() ?? '?' : '—'
  const winnerName = winner?.deleted_at ? 'Deleted player' : winner?.display_name ?? '—'
  const isDeleted = winner?.deleted_at != null
  return (
    <div className="aw-hero" key={row.award_kind}>
      <div className="aw-hero-trophy">{heroDef.trophy}</div>
      <div className="aw-hero-body">
        <div className="aw-hero-award">{heroDef.title}</div>
        <button
          type="button"
          className="aw-hero-name"
          disabled={isDeleted || !winner}
          onClick={() => winner && navigate(`/profile?profile_id=${winner.id}&season_id=${seasonId}`)}
        >
          {winnerName}
        </button>
        <div className="aw-hero-meta">
          <strong>{heroDef.metricLabel(Number(row.metric_value), row.meta)}</strong>
          {runner && (
            <span className="aw-hero-runner">
              2nd: <button
                type="button"
                className="aw-hero-runner-link"
                onClick={() => navigate(`/profile?profile_id=${runner.id}&season_id=${seasonId}`)}
              >{runner.deleted_at ? 'Deleted player' : runner.display_name}</button>
              {row.runner_up_metric != null && ` (${row.runner_up_metric})`}
            </span>
          )}
        </div>
      </div>
      <div className={`aw-hero-avatar${isDeleted ? ' aw-hero-avatar--deleted' : ''}`}>
        {winner?.avatar_url ? (
          <img src={winner.avatar_url} alt={winnerName} />
        ) : (
          initials
        )}
      </div>
    </div>
  )
}

export default function Awards() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const seasonIdParam = searchParams.get('season_id')

  const [season, setSeason] = useState<SeasonRow | null>(null)
  const [seasons, setSeasons] = useState<SeasonRow[]>([])
  const [winners, setWinners] = useState<WinnerRow[]>([])
  const [profilesById, setProfilesById] = useState<Record<string, ProfileLite>>({})
  const [loading, setLoading] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)

  const isActiveSeason = season != null && season.ended_at == null

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)

      // 1. Load all seasons for the picker
      const { data: allSeasons } = await supabase
        .from('seasons')
        .select('id, name, starts_on, ended_at, archived_at')
        .order('starts_on', { ascending: false })
        .returns<SeasonRow[]>()
      if (cancelled) return

      // 2. Pick target season
      const targetSeason = (() => {
        if (!allSeasons) return null
        if (seasonIdParam) return allSeasons.find((s) => s.id === seasonIdParam) ?? null
        return allSeasons.find((s) => s.ended_at == null) ?? allSeasons[0] ?? null
      })()
      if (!targetSeason) { setLoading(false); return }

      // 3. Fetch winners — view for active, snapshot table for ended
      const winnersQuery = targetSeason.ended_at == null
        ? supabase.from('v_season_award_winners_live').select('award_kind, winner_profile_id, runner_up_profile_id, metric_value, runner_up_metric, meta').eq('season_id', targetSeason.id)
        : supabase.from('season_awards').select('award_kind, winner_profile_id, runner_up_profile_id, metric_value, runner_up_metric, meta').eq('season_id', targetSeason.id)

      const { data: winnerRows } = await winnersQuery.returns<WinnerRow[]>()
      if (cancelled) return

      // 4. Fetch profiles for all winners + runner-ups in one query
      const profileIds = new Set<string>()
      ;(winnerRows ?? []).forEach((w) => {
        if (w.winner_profile_id) profileIds.add(w.winner_profile_id)
        if (w.runner_up_profile_id) profileIds.add(w.runner_up_profile_id)
      })
      const profileMap: Record<string, ProfileLite> = {}
      if (profileIds.size > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name, avatar_url, deleted_at')
          .in('id', Array.from(profileIds))
          .returns<ProfileLite[]>()
        ;(profiles ?? []).forEach((p) => { profileMap[p.id] = p })
      }
      if (cancelled) return

      setSeasons(allSeasons ?? [])
      setSeason(targetSeason)
      setWinners(winnerRows ?? [])
      setProfilesById(profileMap)
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [seasonIdParam])

  return (
    <section className="aw-screen">
      <button type="button" className="aw-back" onClick={() => navigate(-1)}>‹ Back</button>
      <h1 className="aw-h1">{season ? `${season.name} Awards` : 'Awards'}</h1>
      {!loading && season && (
        <div className="aw-sub">
          {isActiveSeason ? 'PROVISIONAL' : 'FINAL'}
          <span className={`aw-badge ${isActiveSeason ? 'aw-badge--active' : 'aw-badge--ended'}`}>
            {isActiveSeason ? 'Active' : 'Ended'}
          </span>
        </div>
      )}
      {!loading && season && (
        <div className="aw-season-pill-row">
          <button
            type="button"
            className="aw-season-pill"
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
            aria-haspopup="menu"
          >
            {season.name} · {season.archived_at ? 'archived' : season.ended_at ? 'ended' : 'ongoing'}
            <span className="aw-caret" aria-hidden>▾</span>
          </button>
          {pickerOpen && (
            <div className="aw-dropdown" role="menu">
              {seasons.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={s.id === season.id}
                  className={`aw-dropdown-item${s.id === season.id ? ' aw-dropdown-item--selected' : ''}`}
                  onClick={() => {
                    setPickerOpen(false)
                    navigate(`/awards?season_id=${s.id}`)
                  }}
                >
                  <span>{s.name}</span>
                  <span className="aw-dropdown-status">
                    {s.archived_at ? 'archived' : s.ended_at ? 'ended' : 'ongoing'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {loading && <div className="aw-loading">Loading awards…</div>}
      {!loading && season && winners.length === 0 && (
        <div className="aw-empty">
          <div className="aw-empty-trophy">🏆</div>
          <p>No matches played yet this season — awards will appear once results are in.</p>
        </div>
      )}
      {!loading && winners.length > 0 && (
        <div className="aw-heroes">
          {(['ballon_dor', 'golden_boot', 'most_motm'] as AwardKind[]).map((kind) => {
            const row = winners.find((w) => w.award_kind === kind)
            if (!row) return null
            return renderHero(row, profilesById, navigate, season?.id ?? '')
          })}
        </div>
      )}
    </section>
  )
}
