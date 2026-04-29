import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

/* §3.24 Awards page (S053, V3.0:139).
 * Routes:
 *   /awards                            → active season default
 *   /awards?season_id=<uuid>           → specific season (active or ended)
 * Active season:  reads v_season_award_winners_live (live computation)
 * Ended season:   reads season_awards snapshot table
 * Wall of Fame:   reads season_awards table only (ended seasons)
 *
 * Task 3 ships the skeleton only — header, sub-line, loading state.
 * Task 4 re-adds: supabase client, Database type, AwardKind, SeasonRow,
 *   WinnerRow, ProfileLite, season+seasons+winners+profilesById state,
 *   pickerOpen, hero cards.
 * Task 5 adds: WallOfFameRow + wallOfFame state + Wall of Fame list.
 */

interface SeasonRow {
  id: string
  name: string
  starts_on: string
  ended_at: string | null
  archived_at: string | null
}

export default function Awards() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const seasonIdParam = searchParams.get('season_id')

  const [season] = useState<SeasonRow | null>(null)
  const [loading, setLoading] = useState(true)

  const isActiveSeason = season != null && season.ended_at == null

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      // Implementation lands in Task 4
      if (!cancelled) setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [seasonIdParam])

  return (
    <section className="aw-screen">
      <button type="button" className="aw-back" onClick={() => navigate(-1)}>‹ Back</button>
      <h1 className="aw-h1">{season ? `${(season as SeasonRow).name} Awards` : 'Awards'}</h1>
      <div className="aw-sub">
        {isActiveSeason ? 'PROVISIONAL' : 'FINAL'}
        <span className={`aw-badge ${isActiveSeason ? 'aw-badge--active' : 'aw-badge--ended'}`}>
          {isActiveSeason ? 'Active' : 'Ended'}
        </span>
      </div>
      {loading && <div className="aw-loading">Loading awards…</div>}
      {/* Hero cards land in Task 4, Wall of Fame in Task 5 */}
    </section>
  )
}
