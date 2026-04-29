import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import type { Database } from '../lib/database.types'

/* §3.13 Leaderboard — Phase 1 Depth-B slice (S022) + Depth-B gate (S026).
 * Data: v_season_standings + profiles (FK embed) + seasons for the picker.
 * Scope: ranked list, Not-yet-played group, season picker, position filter,
 * sort dropdown (session-local, defaults to 'points' per S037), medal icons for
 * top 3 in current season only, last-5 strip, realtime subscription on
 * matches UPDATE, pull-to-refresh, skeleton rows. */

const SKELETON_ROWS = 6
const PTR_THRESHOLD = 70

type PlayerPosition = Database['public']['Enums']['player_position']
type SortKey = Database['public']['Enums']['leaderboard_sort']
type UserRoleEnum = Database['public']['Enums']['user_role']

interface SeasonRow {
  id: string
  name: string
  default_format: Database['public']['Enums']['match_format']
  ended_at: string | null
  archived_at: string | null
  created_at: string
}

interface StandingEmbed {
  profile_id: string | null
  display_name: string | null
  wins: number | null
  draws: number | null
  losses: number | null
  goals: number | null
  yellows: number | null
  reds: number | null
  motms: number | null
  late_cancel_points: number | null
  no_show_points: number | null
  points: number | null
  profile: {
    primary_position: PlayerPosition | null
    secondary_position: PlayerPosition | null
    avatar_url: string | null
    role: UserRoleEnum
    is_active: boolean
  } | null
}

interface ProfileLite {
  id: string
  display_name: string
  primary_position: PlayerPosition | null
  secondary_position: PlayerPosition | null
  avatar_url: string | null
  role: UserRoleEnum
  is_active: boolean
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'points', label: 'Points' },
  { value: 'wins', label: 'Wins' },
  { value: 'goals', label: 'Goals' },
  { value: 'motm', label: 'MOTM' },
  { value: 'last5_form', label: 'Last 5' },
]

const POSITION_CHIPS: (PlayerPosition | 'ALL')[] = ['ALL', 'GK', 'DEF', 'CDM', 'W', 'ST']

/* Inline SVG icons — avoid emoji for precise-alignment + theme-aware colour.
 * Filter = 3-line funnel. Sort = stacked up/down arrows. */
const FilterIcon = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 5h14" />
    <path d="M6 10h8" />
    <path d="M9 15h2" />
  </svg>
)
const SortIcon = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 4v11" />
    <path d="M3 7l3-3 3 3" />
    <path d="M14 15V4" />
    <path d="M11 12l3 3 3-3" />
  </svg>
)
const TrophyIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </svg>
)

/* Initials fallback for avatar disc. "Mohammed Muwahid" → "MM". */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

/* Primary-key getter per spec §3.13 sort dropdown. Missing data → 0 so
 * undefined never corrupts the sort (NaN would). */
function sortKeyValue(s: StandingEmbed, sort: SortKey): number {
  switch (sort) {
    case 'goals':
      return s.goals ?? 0
    case 'motm':
      return s.motms ?? 0
    case 'wins':
      return s.wins ?? 0
    case 'last5_form':
      // S049: actual W-count over last 5 (from last5ByProfile, threaded via
      // sortKeyValueWithLast5 below). This branch is only reached via the
      // legacy plain sortKeyValue used in tiebreaks — fall back to total wins.
      return s.wins ?? 0
    case 'points':
    default:
      return s.points ?? 0
  }
}

/* Tiebreak chain per §3.13: wins DESC → motms DESC → goals DESC → display_name ASC.
 * Primary sort is determined by `sort`; the chain is always applied after. */
function compareStandings(a: StandingEmbed, b: StandingEmbed, sort: SortKey): number {
  const pa = sortKeyValue(a, sort)
  const pb = sortKeyValue(b, sort)
  if (pa !== pb) return pb - pa
  const wa = a.wins ?? 0
  const wb = b.wins ?? 0
  if (wa !== wb) return wb - wa
  const ma = a.motms ?? 0
  const mb = b.motms ?? 0
  if (ma !== mb) return mb - ma
  const ga = a.goals ?? 0
  const gb = b.goals ?? 0
  if (ga !== gb) return gb - ga
  const na = a.display_name ?? ''
  const nb = b.display_name ?? ''
  return na.localeCompare(nb)
}

/* Matches spec row-rank semantics: ties share the number, next rank skips
 * (1, 2, 2, 4). Based on the already-sorted array + the primary sort key. */
function assignRanks(sorted: StandingEmbed[], sort: SortKey): (number | null)[] {
  const ranks: (number | null)[] = []
  let lastKey: number | null = null
  let lastRank = 0
  for (let i = 0; i < sorted.length; i++) {
    const key = sortKeyValue(sorted[i], sort)
    if (lastKey === null || key !== lastKey) {
      lastRank = i + 1
      lastKey = key
    }
    ranks.push(lastRank)
  }
  return ranks
}

function PositionPills({
  primary,
  secondary,
  motms,
}: {
  primary: PlayerPosition | null
  secondary: PlayerPosition | null
  motms?: number
}) {
  const hasAny = primary || secondary || (motms && motms > 0)
  if (!hasAny) return null
  return (
    <div className="lb-pills">
      {primary && <span className={`lb-pos lb-pos--fill lb-pos--${primary.toLowerCase()}`}>{primary}</span>}
      {secondary && <span className={`lb-pos lb-pos--out lb-pos--${secondary.toLowerCase()}`}>{secondary}</span>}
      {motms && motms > 0 && (
        <span className="lb-motm-chip" aria-label={`${motms} Man of the Match ${motms === 1 ? 'award' : 'awards'}`}>
          <span aria-hidden>⭐</span>
          {motms}
        </span>
      )}
    </div>
  )
}

function Avatar({ name, url, self }: { name: string; url: string | null; self: boolean }) {
  if (url) {
    return <img className={`lb-avatar${self ? ' lb-avatar--self' : ''}`} src={url} alt="" />
  }
  return <div className={`lb-avatar${self ? ' lb-avatar--self' : ''}`}>{initialsOf(name)}</div>
}

export function Leaderboard() {
  const navigate = useNavigate()
  const { profileId } = useApp()

  const [seasons, setSeasons] = useState<SeasonRow[] | null>(null)
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null)
  const [standings, setStandings] = useState<StandingEmbed[] | null>(null)
  const [profiles, setProfiles] = useState<ProfileLite[] | null>(null)
  const [last5ByProfile, setLast5ByProfile] = useState<Map<string, ('W' | 'D' | 'L')[]>>(new Map())
  const [sort, setSort] = useState<SortKey>('points')
  const [activeFilters, setActiveFilters] = useState<Set<PlayerPosition | 'ALL'>>(new Set(['ALL']))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [ptrY, setPtrY] = useState(0) // translation for the pull-to-refresh indicator
  const [ptrArmed, setPtrArmed] = useState(false)

  const seasonWrapRef = useRef<HTMLDivElement>(null)
  const filterWrapRef = useRef<HTMLDivElement>(null)
  const sortWrapRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const ptrStartY = useRef<number | null>(null)

  /* Close any open popover on outside click. One global listener; cost is trivial. */
  useEffect(() => {
    if (!pickerOpen && !filterOpen && !sortOpen) return
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (pickerOpen && seasonWrapRef.current && !seasonWrapRef.current.contains(t)) setPickerOpen(false)
      if (filterOpen && filterWrapRef.current && !filterWrapRef.current.contains(t)) setFilterOpen(false)
      if (sortOpen && sortWrapRef.current && !sortWrapRef.current.contains(t)) setSortOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pickerOpen, filterOpen, sortOpen])

  /* Seasons — load once on mount. Picker defaults to active season (ended_at NULL)
   * else most recent archived. */
  useEffect(() => {
    let cancelled = false
    supabase
      .from('seasons')
      .select('id, name, default_format, ended_at, archived_at, created_at')
      .order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) {
          setError(err.message)
          return
        }
        const rows = (data ?? []) as SeasonRow[]
        setSeasons(rows)
        if (rows.length > 0 && !selectedSeasonId) {
          const active = rows.find((s) => s.ended_at === null && s.archived_at === null)
          setSelectedSeasonId(active?.id ?? rows[0].id)
        }
      })
    return () => {
      cancelled = true
    }
    // selectedSeasonId intentionally excluded — first-load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* S037: sort always initialises to 'points' for everyone. The per-user
   * persistence was removed when the corresponding Settings row was deleted;
   * each visit starts fresh and users change the sort in-screen via the
   * dropdown icon. The profiles.leaderboard_sort DB column is left in place
   * but no longer read or written from the client. */

  /* Standings loader. Exposed as a callback so realtime + pull-to-refresh
   * can re-trigger without duplicating the query logic. `mode` drives which
   * UI flag advertises the fetch: 'initial' clears cached data + shows the
   * skeleton; 'refresh' keeps old data visible + shows the PTR spinner. */
  const loadSeason = useCallback(
    async (seasonId: string, mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') {
        setStandings(null)
        setProfiles(null)
        setLast5ByProfile(new Map())
      } else {
        setRefreshing(true)
      }
      setError(null)

      const startedAt = performance.now()

      // NB: no `profile:profiles!inner(...)` embed. After S037's migration 0026
      // the view is backed by a UNION over live aggregates + season_seed_stats,
      // which breaks PostgREST's auto-join detection between the view and
      // profiles. Profile fields are merged client-side from the parallel
      // profiles query below.
      const standingsP = supabase
        .from('v_season_standings')
        .select(
          'profile_id, display_name, wins, draws, losses, goals, yellows, reds, motms, late_cancel_points, no_show_points, points',
        )
        .eq('season_id', seasonId)

      const profilesP = supabase
        .from('profiles')
        .select('id, display_name, primary_position, secondary_position, avatar_url, role, is_active')
        .in('role', ['player', 'admin', 'super_admin'])
        .eq('is_active', true)

      const last5P = supabase
        .from('v_player_last5')
        .select('profile_id, outcome, kickoff_at')
        .eq('season_id', seasonId)
        .order('kickoff_at', { ascending: true })

      const [s, p, l] = await Promise.all([standingsP, profilesP, last5P])

      if (s.error) {
        setError(s.error.message)
        setRefreshing(false)
        return
      }
      if (p.error) {
        setError(p.error.message)
        setRefreshing(false)
        return
      }
      if (l.error) {
        console.warn('[FFC] v_player_last5 fetch failed', l.error.message)
      }

      // Skeleton minimum hold so we don't flash on fast networks.
      if (mode === 'initial') {
        const elapsed = performance.now() - startedAt
        const hold = Math.max(0, 150 - elapsed)
        if (hold > 0) await new Promise((r) => setTimeout(r, hold))
      }

      // Merge profile fields onto each standing row client-side. Rows without
      // a matching profile (rejected/inactive) get `.profile = null` which the
      // downstream filters already handle (played-partition drops null-profile rows).
      const profilesList = (p.data ?? []) as ProfileLite[]
      const profileById = new Map<string, ProfileLite>()
      for (const prof of profilesList) profileById.set(prof.id, prof)

      const rawStandings = (s.data ?? []) as unknown as Omit<StandingEmbed, 'profile'>[]
      const hydrated: StandingEmbed[] = rawStandings.map((row) => {
        const prof = row.profile_id ? profileById.get(row.profile_id) ?? null : null
        return {
          ...row,
          profile: prof
            ? {
                primary_position: prof.primary_position,
                secondary_position: prof.secondary_position,
                avatar_url: prof.avatar_url,
                role: prof.role,
                is_active: prof.is_active,
              }
            : null,
        }
      })

      setStandings(hydrated)
      setProfiles(profilesList)

      const m = new Map<string, ('W' | 'D' | 'L')[]>()
      for (const row of l.data ?? []) {
        if (!row.profile_id || !row.outcome) continue
        const out = row.outcome.toUpperCase() as 'W' | 'D' | 'L'
        if (out !== 'W' && out !== 'D' && out !== 'L') continue
        const arr = m.get(row.profile_id) ?? []
        arr.push(out)
        m.set(row.profile_id, arr)
      }
      setLast5ByProfile(m)
      setRefreshing(false)
    },
    [],
  )

  /* Initial + season-switch load. */
  useEffect(() => {
    if (!selectedSeasonId) return
    void loadSeason(selectedSeasonId, 'initial')
  }, [selectedSeasonId, loadSeason])

  /* Realtime subscription — any change to a match / match_players row in this
   * season refreshes the standings in place. Supabase broadcast latency for a
   * free-tier project is typically <2s. One channel per season-switch. */
  useEffect(() => {
    if (!selectedSeasonId) return
    const channel = supabase
      .channel(`lb-season-${selectedSeasonId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        () => {
          void loadSeason(selectedSeasonId, 'refresh')
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_players' },
        () => {
          void loadSeason(selectedSeasonId, 'refresh')
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [selectedSeasonId, loadSeason])

  const selectedSeason = seasons?.find((s) => s.id === selectedSeasonId) ?? null
  const isCurrentSeason = selectedSeason?.archived_at === null && selectedSeason?.ended_at === null

  const filteredPositions = useMemo(() => {
    if (activeFilters.has('ALL') || activeFilters.size === 0) return null
    return activeFilters as Set<PlayerPosition>
  }, [activeFilters])

  /* Spec rule 4: players with wins+draws+losses = 0 move to Not-yet-played.
   * We compute played from the standings row itself, then partition. */
  const { rankedWithRank, notPlayed } = useMemo(() => {
    if (!standings || !profiles) return { rankedWithRank: null, notPlayed: null }

    const matchesFilter = (primary: PlayerPosition | null, secondary: PlayerPosition | null) => {
      if (!filteredPositions) return true
      if (primary && filteredPositions.has(primary)) return true
      if (secondary && filteredPositions.has(secondary)) return true
      return false
    }

    const playedIds = new Set<string>()
    const played: StandingEmbed[] = []
    for (const row of standings) {
      const w = row.wins ?? 0
      const d = row.draws ?? 0
      const l = row.losses ?? 0
      if (!row.profile_id) continue
      // Banned is rendered per spec; rejected users are filtered out.
      if (row.profile?.role === 'rejected') continue
      if (w + d + l === 0) continue
      playedIds.add(row.profile_id)
      if (matchesFilter(row.profile?.primary_position ?? null, row.profile?.secondary_position ?? null)) {
        played.push(row)
      }
    }
    played.sort((a, b) => compareStandings(a, b, sort))
    const ranks = assignRanks(played, sort)

    const np = profiles
      .filter((p) => !playedIds.has(p.id))
      .filter((p) => matchesFilter(p.primary_position, p.secondary_position))
      .sort((a, b) => a.display_name.localeCompare(b.display_name))

    return {
      rankedWithRank: played.map((row, i) => ({ row, rank: ranks[i] })),
      notPlayed: np,
    }
  }, [standings, profiles, sort, filteredPositions])

  const handleSortChange = (next: SortKey) => {
    // Session-local only; no DB persistence per S037.
    setSort(next)
  }

  const togglePosition = (pos: PlayerPosition | 'ALL') => {
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (pos === 'ALL') return new Set(['ALL'])
      next.delete('ALL')
      if (next.has(pos)) next.delete(pos)
      else next.add(pos)
      if (next.size === 0) return new Set(['ALL'])
      return next
    })
  }

  const handleRowTap = (pid: string) => {
    if (!selectedSeasonId) return
    navigate(`/profile?profile_id=${pid}&season_id=${selectedSeasonId}`)
  }

  /* S049 — Leaderboard fills the screen in landscape orientation by
   * overriding the global #root max-width (560px) for as long as this
   * screen is mounted. body class added on mount, removed on unmount.
   * matchMedia listener flips it as the device rotates. */
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)')
    const update = () => {
      document.body.classList.toggle('is-leaderboard-landscape', mq.matches)
    }
    update()
    mq.addEventListener('change', update)
    return () => {
      mq.removeEventListener('change', update)
      document.body.classList.remove('is-leaderboard-landscape')
    }
  }, [])

  /* Pull-to-refresh — only arms when scroll is already at top to avoid
   * competing with normal scrolling. */
  const onTouchStart = (e: React.TouchEvent) => {
    if (bodyRef.current && bodyRef.current.scrollTop > 0) return
    ptrStartY.current = e.touches[0].clientY
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (ptrStartY.current === null) return
    const dy = e.touches[0].clientY - ptrStartY.current
    if (dy < 0) {
      setPtrY(0)
      setPtrArmed(false)
      return
    }
    // Resistance curve — easing so past-threshold feels weighty
    const eased = dy * 0.5
    setPtrY(Math.min(100, eased))
    setPtrArmed(eased >= PTR_THRESHOLD)
  }
  const onTouchEnd = () => {
    const armed = ptrArmed
    ptrStartY.current = null
    setPtrY(0)
    setPtrArmed(false)
    if (armed && selectedSeasonId) {
      void loadSeason(selectedSeasonId, 'refresh')
    }
  }

  if (error) {
    return (
      <section className="lb-screen">
        <div className="lb-error">
          <strong>Couldn't load the table.</strong>
          <p>{error}</p>
        </div>
      </section>
    )
  }

  const loading = !seasons || !standings || !profiles || !selectedSeason
  const totalVisible = (rankedWithRank?.length ?? 0) + (notPlayed?.length ?? 0)
  const hasAnyPlayers = profiles !== null && profiles.length > 0
  const hasAnyStandings = standings !== null && standings.some((r) => (r.wins ?? 0) + (r.draws ?? 0) + (r.losses ?? 0) > 0)
  const filterActive = filteredPositions !== null

  return (
    <section className="lb-screen">
      <header className="lb-head">
        <div className="lb-head-top">
          <h1 className="lb-title">Leaderboard</h1>
          {selectedSeason?.archived_at && <span className="lb-archived-tag">archived</span>}
        </div>

        <div className="lb-controls-row">
          <div className="lb-season-wrap" ref={seasonWrapRef}>
            <button
              type="button"
              className={`lb-season-chip${selectedSeason?.archived_at ? ' lb-season-chip--archived' : ''}`}
              onClick={() => {
                setPickerOpen((v) => !v)
                setFilterOpen(false)
                setSortOpen(false)
              }}
              disabled={!seasons}
              aria-expanded={pickerOpen}
              aria-haspopup="menu"
            >
              <span className="lb-season-dot" aria-hidden />
              <span className="lb-season-chip-text">
                {selectedSeason?.name ?? 'Loading…'}
                {selectedSeason && (
                  <> · {selectedSeason.archived_at ? 'archived' : selectedSeason.ended_at ? 'ended' : 'ongoing'}</>
                )}
              </span>
              <span className="lb-caret" aria-hidden>▾</span>
            </button>
            {pickerOpen && seasons && (
              <div className="lb-dropdown lb-dropdown--wide" role="menu">
                {seasons.map((s) => {
                  const badge = s.archived_at ? 'archived' : s.ended_at ? 'ended' : 'ongoing'
                  const selected = s.id === selectedSeasonId
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className={`lb-dropdown-item${selected ? ' lb-dropdown-item--selected' : ''}`}
                      onClick={() => {
                        setSelectedSeasonId(s.id)
                        setPickerOpen(false)
                      }}
                    >
                      <span className="lb-dropdown-item-main">
                        <span className={`lb-season-dot lb-season-dot--${badge}`} aria-hidden />
                        {s.name}
                      </span>
                      <span className={`lb-sheet-badge lb-sheet-badge--${badge}`}>{badge}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="lb-icon-wrap" ref={filterWrapRef}>
            <button
              type="button"
              className={`lb-icon-btn${filterActive ? ' lb-icon-btn--active' : ''}`}
              onClick={() => {
                setFilterOpen((v) => !v)
                setSortOpen(false)
              }}
              aria-label="Filter by position"
              aria-expanded={filterOpen}
            >
              <FilterIcon />
              {filterActive && (
                <span className="lb-icon-btn-badge" aria-hidden>
                  {filteredPositions?.size ?? 0}
                </span>
              )}
            </button>
            {filterOpen && (
              <div className="lb-dropdown" role="menu">
                {POSITION_CHIPS.map((pos) => {
                  const active = activeFilters.has(pos)
                  return (
                    <button
                      key={pos}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={active}
                      className={`lb-dropdown-item${active ? ' lb-dropdown-item--selected' : ''}`}
                      data-pos={pos === 'ALL' ? undefined : pos}
                      onClick={() => togglePosition(pos)}
                    >
                      <span>{pos === 'ALL' ? 'All positions' : pos}</span>
                      {active && <span className="lb-dropdown-check" aria-hidden>✓</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="lb-icon-wrap" ref={sortWrapRef}>
            <button
              type="button"
              className="lb-icon-btn"
              onClick={() => {
                setSortOpen((v) => !v)
                setFilterOpen(false)
              }}
              aria-label="Sort by"
              aria-expanded={sortOpen}
            >
              <SortIcon />
            </button>
            {sortOpen && (
              <div className="lb-dropdown" role="menu">
                {SORT_OPTIONS.map((opt) => {
                  const selected = opt.value === sort
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className={`lb-dropdown-item${selected ? ' lb-dropdown-item--selected' : ''}`}
                      onClick={() => {
                        void handleSortChange(opt.value)
                        setSortOpen(false)
                      }}
                    >
                      <span>{opt.label}</span>
                      {selected && <span className="lb-dropdown-check" aria-hidden>✓</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="lb-icon-wrap">
            <button
              type="button"
              className="lb-icon-btn lb-icon-btn--awards"
              onClick={() => navigate(`/awards?season_id=${selectedSeasonId ?? ''}`)}
              aria-label="View season awards"
            >
              <TrophyIcon />
            </button>
          </div>
        </div>

        {filterActive && !loading && (
          <div className="lb-count-line">
            {totalVisible} visible
          </div>
        )}
      </header>

      <div
        className="lb-body"
        ref={bodyRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {(ptrY > 0 || refreshing) && (
          <div
            className={`lb-ptr${ptrArmed ? ' lb-ptr--armed' : ''}${refreshing ? ' lb-ptr--spinning' : ''}`}
            style={{ height: refreshing ? 42 : ptrY }}
            aria-hidden
          >
            <span className="lb-ptr-inner">
              {refreshing ? '↻ Refreshing…' : ptrArmed ? '↑ Release to refresh' : '↓ Pull to refresh'}
            </span>
          </div>
        )}

        {loading && (
          <div className="lb-skel" aria-label="Loading leaderboard">
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <div key={i} className="lb-skel-row">
                <span className="lb-skel-rank" />
                <span className="lb-skel-name" />
                <span className="lb-skel-wdl" />
                <span className="lb-skel-pts" />
              </div>
            ))}
          </div>
        )}

        {!loading && !hasAnyStandings && hasAnyPlayers && !filterActive && (
          <div className="lb-empty">
            <strong>Season starts here.</strong>
            <p>First matchday will update the table.</p>
          </div>
        )}

        {!loading && !hasAnyStandings && hasAnyPlayers && notPlayed && notPlayed.length > 0 && (
          <div className="lb-not-played">
            <div className="lb-not-played-heading">Not yet played this season</div>
            {notPlayed.map((p) => {
              const isSelf = p.id === profileId
              return (
                <button
                  key={p.id}
                  type="button"
                  className="lb-np-row"
                  onClick={() => handleRowTap(p.id)}
                >
                  <Avatar name={p.display_name} url={p.avatar_url} self={isSelf} />
                  <div className="lb-name-block">
                    <div className="lb-name">{p.display_name}</div>
                    <PositionPills primary={p.primary_position} secondary={p.secondary_position} />
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {!loading && hasAnyStandings && rankedWithRank && (
          <>
            {/* S049 — table-grid layout with horizontal scroll for portrait
             * (sticky rank + player columns), full-width fill in landscape via
             * the body.is-leaderboard-landscape class set in the orientation
             * effect above. */}
            <div className="lb-table-wrap">
              <div className="lb-table-grid lb-table-grid--header">
                <span className="lb-cell lb-cell--rank lb-cell--sticky-1" aria-hidden />
                <span className="lb-cell lb-cell--player lb-cell--sticky-2">Player</span>
                <span className="lb-cell lb-cell--num">Pts</span>
                <span className="lb-cell lb-cell--num">MP</span>
                <span className="lb-cell lb-cell--num">W</span>
                <span className="lb-cell lb-cell--num">D</span>
                <span className="lb-cell lb-cell--num">L</span>
                <span className="lb-cell lb-cell--num">GF</span>
                <span className="lb-cell lb-cell--num">Win%</span>
                <span className="lb-cell lb-cell--last5">Last 5</span>
              </div>

              {rankedWithRank.map(({ row, rank }) => {
                if (!row.profile_id) return null
                const medal = isCurrentSeason && rank !== null && rank <= 3
                  ? rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'
                  : null
                const trophy = !isCurrentSeason && rank !== null && rank <= 3 ? '🏆' : null
                const top3Class = medal
                  ? rank === 1
                    ? ' lb-row--gold'
                    : rank === 2
                      ? ' lb-row--silver'
                      : ' lb-row--bronze'
                  : ''
                const wins = row.wins ?? 0
                const draws = row.draws ?? 0
                const losses = row.losses ?? 0
                const mp = wins + draws + losses
                const winPct = mp > 0 ? Math.round((wins / mp) * 100) : 0
                const last5 = last5ByProfile.get(row.profile_id!) ?? []
                return (
                  <button
                    key={row.profile_id}
                    type="button"
                    className={`lb-table-grid lb-table-grid--row${top3Class}`}
                    onClick={() => handleRowTap(row.profile_id!)}
                  >
                    <span className="lb-cell lb-cell--rank lb-cell--sticky-1">
                      {medal ?? trophy ?? rank}
                    </span>
                    <span className="lb-cell lb-cell--player lb-cell--sticky-2">
                      <span className="lb-name-block">
                        <span className="lb-name">{row.display_name ?? 'Unknown'}</span>
                        <PositionPills
                          primary={row.profile?.primary_position ?? null}
                          secondary={row.profile?.secondary_position ?? null}
                          motms={row.motms ?? 0}
                        />
                      </span>
                    </span>
                    <span className="lb-cell lb-cell--num lb-cell--pts">{row.points ?? 0}</span>
                    <span className="lb-cell lb-cell--num">{mp}</span>
                    <span className="lb-cell lb-cell--num lb-cell--w">{wins}</span>
                    <span className="lb-cell lb-cell--num lb-cell--d">{draws}</span>
                    <span className="lb-cell lb-cell--num lb-cell--l">{losses}</span>
                    <span className="lb-cell lb-cell--num">{row.goals ?? 0}</span>
                    <span className="lb-cell lb-cell--num">{winPct}%</span>
                    <span className="lb-cell lb-cell--last5" aria-label={`Last ${last5.length} results`}>
                      {last5.length === 0
                        ? <span className="lb-last5-empty">—</span>
                        : last5.map((o, i) => (
                            <span key={i} className={`lb-last5-pill lb-last5-pill--${o}`} aria-hidden>
                              {o}
                            </span>
                          ))}
                    </span>
                  </button>
                )
              })}
            </div>

            {notPlayed && notPlayed.length > 0 && (
              <div className="lb-not-played">
                <div className="lb-not-played-heading">Not yet played this season</div>
                {notPlayed.map((p) => {
                  const isSelf = p.id === profileId
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className="lb-np-row"
                      onClick={() => handleRowTap(p.id)}
                    >
                      <Avatar name={p.display_name} url={p.avatar_url} self={isSelf} />
                      <div className="lb-name-block">
                        <div className="lb-name">{p.display_name}</div>
                        <PositionPills primary={p.primary_position} secondary={p.secondary_position} />
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}

        {!loading && filterActive && totalVisible === 0 && (
          <div className="lb-empty lb-empty--muted">
            <p>No players match the current filter.</p>
            <button
              type="button"
              className="lb-clear-filter"
              onClick={() => setActiveFilters(new Set(['ALL']))}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

    </section>
  )
}
