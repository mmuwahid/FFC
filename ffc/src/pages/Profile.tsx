import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import { MatchDetailSheet } from '../components/MatchDetailSheet'
import type { Database } from '../lib/database.types'
import { AvatarSheet, compressImage } from './ProfileAvatarSheet'

/* §3.14 Player Profile — Phase 1 Depth-B slice (S023).
 * Route: /profile?profile_id=<uuid>&season_id=<uuid>
 * When profile_id is absent, defaults to the logged-in user's own profile.
 * When season_id is absent, defaults to the active season (ended_at IS NULL).
 */

type PlayerPosition = Database['public']['Enums']['player_position']
type ThemePreference = Database['public']['Enums']['theme_preference']
type SortKey = Database['public']['Enums']['leaderboard_sort']
type UserRoleEnum = Database['public']['Enums']['user_role']
type MatchResult = Database['public']['Enums']['match_result']
type TeamColor = Database['public']['Enums']['team_color']

interface ProfileData {
  id: string
  display_name: string
  avatar_url: string | null
  primary_position: PlayerPosition | null
  secondary_position: PlayerPosition | null
  theme_preference: ThemePreference
  leaderboard_sort: SortKey
  role: UserRoleEnum
  is_active: boolean
  joined_on: string
}

interface SeasonRow {
  id: string
  name: string
  starts_on: string
  ended_at: string | null
  archived_at: string | null
  created_at: string
}

interface StandingRow {
  wins: number | null
  draws: number | null
  losses: number | null
  goals: number | null
  yellows: number | null
  reds: number | null
  motms: number | null
  late_cancel_points: number | null
  points: number | null
}

interface AllStandingRow {
  profile_id: string | null
  display_name: string | null
  points: number | null
  wins: number | null
  motms: number | null
  goals: number | null
}

interface Last5Row {
  outcome: string | null
  kickoff_at: string | null
}

interface RecentMatchRow {
  team: TeamColor
  goals: number
  yellow_cards: number
  red_cards: number
  matches: {
    id: string
    result: MatchResult | null
    score_white: number | null
    score_black: number | null
    motm_user_id: string | null
    approved_at: string | null
    matchdays: { kickoff_at: string | null } | null
    seasons: { id: string; name: string } | null
  } | null
}

interface BanRow {
  ends_at: string
  revoked_at: string | null
}

interface CareerStats {
  matches: number
  goals: number
  yellows: number
  reds: number
  motms: number
  bestWStreak: number
  bestWStreakSeasonId: string | null
  worstLStreak: number
  worstLStreakSeasonId: string | null
}

/* Compute longest W-streak and L-streak per season (RLE approach).
 * v_player_achievements is Phase 2 — run in app code for Phase 1. */
function computeStreaks(
  rows: RecentMatchRow[],
): { bestW: number; bestWSeasonId: string | null; worstL: number; worstLSeasonId: string | null } {
  type MatchOutcome = { outcome: 'W' | 'D' | 'L'; seasonId: string; kickoff: string }
  const outcomes: MatchOutcome[] = rows
    .filter((r) => r.matches?.approved_at != null)
    .map((r) => {
      const result = r.matches!.result
      const seasonId = r.matches!.seasons?.id ?? ''
      const kickoff = r.matches!.matchdays?.kickoff_at ?? ''
      let outcome: 'W' | 'D' | 'L' = 'D'
      if (result === 'draw') outcome = 'D'
      else if ((result === 'win_white' && r.team === 'white') || (result === 'win_black' && r.team === 'black')) outcome = 'W'
      else outcome = 'L'
      return { outcome, seasonId, kickoff }
    })
    .sort((a, b) => {
      if (a.seasonId !== b.seasonId) return a.seasonId.localeCompare(b.seasonId)
      return a.kickoff.localeCompare(b.kickoff)
    })

  let bestW = 0; let bestWSeasonId: string | null = null
  let worstL = 0; let worstLSeasonId: string | null = null
  let curW = 0; let curL = 0
  let prevSeason = ''

  for (const m of outcomes) {
    if (m.seasonId !== prevSeason) { curW = 0; curL = 0; prevSeason = m.seasonId }
    if (m.outcome === 'W') { curW++; curL = 0; if (curW > bestW) { bestW = curW; bestWSeasonId = m.seasonId } }
    else if (m.outcome === 'L') { curL++; curW = 0; if (curL > worstL) { worstL = curL; worstLSeasonId = m.seasonId } }
    else { curW = 0; curL = 0 }
  }

  return { bestW, bestWSeasonId, worstL, worstLSeasonId }
}

/* Derive W/D/L outcome for a recent-match row from the viewing profile's perspective. */
function matchOutcome(row: RecentMatchRow): 'W' | 'D' | 'L' {
  const result = row.matches?.result
  if (!result || result === 'draw') return 'D'
  if ((result === 'win_white' && row.team === 'white') || (result === 'win_black' && row.team === 'black')) return 'W'
  return 'L'
}

/* Rank by points → wins → motms → goals → name (matches Leaderboard's compareStandings). */
function computeRank(rows: AllStandingRow[], viewProfileId: string): number | null {
  const sorted = [...rows].sort((a, b) => {
    const pa = a.points ?? 0; const pb = b.points ?? 0
    if (pa !== pb) return pb - pa
    const wa = a.wins ?? 0; const wb = b.wins ?? 0
    if (wa !== wb) return wb - wa
    const ma = a.motms ?? 0; const mb = b.motms ?? 0
    if (ma !== mb) return mb - ma
    const ga = a.goals ?? 0; const gb = b.goals ?? 0
    if (ga !== gb) return gb - ga
    return (a.display_name ?? '').localeCompare(b.display_name ?? '')
  })
  const idx = sorted.findIndex((r) => r.profile_id === viewProfileId)
  return idx >= 0 ? idx + 1 : null
}

/* Format an ISO date to DD/MMM/YYYY uppercase per ui-conventions.md */
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const day = String(d.getUTCDate()).padStart(2, '0')
  const mon = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase()
  const yr = d.getUTCFullYear()
  return `${day}/${mon}/${yr}`
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function rankLabel(n: number): string {
  if (n === 1) return '1st 🥇'
  if (n === 2) return '2nd 🥈'
  if (n === 3) return '3rd 🥉'
  return `#${n}`
}

const POSITIONS: PlayerPosition[] = ['GK', 'DEF', 'CDM', 'W', 'ST']

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'points', label: 'Points' },
  { value: 'wins', label: 'Wins' },
  { value: 'goals', label: 'Goals' },
  { value: 'motm', label: 'MOTM' },
  { value: 'last5_form', label: 'Last 5' },
]

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

/* ── Helper components ── */

function SeasonStatsCard({
  standing,
  seasonName,
  rank,
}: {
  standing: StandingRow | null
  seasonName: string | null
  rank: number | null
}) {
  const wins = standing?.wins ?? 0
  const draws = standing?.draws ?? 0
  const losses = standing?.losses ?? 0
  const goals = standing?.goals ?? 0
  const motms = standing?.motms ?? 0
  const lcp = standing?.late_cancel_points ?? 0
  const points = standing?.points ?? 0
  const mp = wins + draws + losses

  const hintParts: string[] = []
  if (seasonName) hintParts.push(seasonName)
  if (rank != null) hintParts.push(rankLabel(rank))
  const hint = hintParts.join(' · ')

  return (
    <div className="pf-card">
      <div className="pf-card-title">
        <span className="pf-card-label">Season stats</span>
        {hint && <span className="pf-card-hint">{hint}</span>}
      </div>
      {!standing ? (
        <div style={{ padding: '10px 14px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
          No matches this season yet
        </div>
      ) : (
        <div className="pf-kpi-grid">
          <div className="pf-kpi">
            <span className={`pf-kpi-v${points === 0 ? ' pf-kpi-v--muted' : ''}`}>{points}</span>
            <span className="pf-kpi-l">Points</span>
          </div>
          <div className="pf-kpi">
            <span className={`pf-kpi-v${mp === 0 ? ' pf-kpi-v--muted' : ''}`}>{mp}</span>
            <span className="pf-kpi-l">MP</span>
          </div>
          <div className="pf-kpi">
            <span className="pf-wdl">
              <span className="pf-w">{wins}</span>
              <span className="pf-sep">–</span>
              <span className="pf-d">{draws}</span>
              <span className="pf-sep">–</span>
              <span className="pf-l">{losses}</span>
            </span>
            <span className="pf-kpi-l">W – D – L</span>
          </div>
          <div className="pf-kpi">
            <span className={`pf-kpi-v${goals === 0 ? ' pf-kpi-v--muted' : ''}`}>{goals}</span>
            <span className="pf-kpi-l">Goals</span>
          </div>
          <div className="pf-kpi">
            <span className={`pf-kpi-v${motms === 0 ? ' pf-kpi-v--muted' : ''}`}>{motms}</span>
            <span className="pf-kpi-l">MOTM</span>
          </div>
          <div className="pf-kpi">
            <span className={`pf-kpi-v${lcp === 0 ? ' pf-kpi-v--muted' : ''}`}>{lcp}</span>
            <span className="pf-kpi-l">Late cancel</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Last5Strip({ rows }: { rows: Last5Row[] }) {
  if (rows.length === 0) return null
  return (
    <div className="pf-card">
      <div className="pf-last5">
        <span className="pf-card-label">Last 5</span>
        <div
          className="pf-last5-strip"
          aria-label={`Last ${rows.length} results: ${rows.map((r) => r.outcome ?? '?').join(' ')}`}
        >
          {rows.map((r, i) => {
            const o = (r.outcome ?? 'D') as 'W' | 'D' | 'L'
            return (
              <div key={i} className={`pf-circle pf-circle--${o}`} aria-hidden>
                {o}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function AchievementsCard({
  career,
  seasons,
  isSelf,
}: {
  career: CareerStats
  seasons: SeasonRow[]
  isSelf: boolean
}) {
  if (career.matches === 0) {
    return (
      <div className="pf-cta-tile">
        <div className="pf-cta-title">Your career starts here</div>
        <div className="pf-cta-sub">Play your first match to unlock stats</div>
        {isSelf && (
          <Link className="pf-cta-btn" to="/poll">RSVP Thursday →</Link>
        )}
      </div>
    )
  }

  const wSeasonName = seasons.find((s) => s.id === career.bestWStreakSeasonId)?.name ?? null
  const lSeasonName = seasons.find((s) => s.id === career.worstLStreakSeasonId)?.name ?? null

  return (
    <div className="pf-card">
      <div className="pf-card-title">
        <span className="pf-card-label">Career highlights</span>
      </div>
      <div className="pf-ach-grid">
        <div className="pf-ach-tile">
          <span className="pf-ach-icon">⭐</span>
          <span className="pf-ach-big">{career.motms}</span>
          <span className="pf-ach-lbl">MOTMs</span>
          <span className="pf-ach-ctx">career</span>
        </div>
        <div className="pf-ach-tile">
          <span className="pf-ach-icon">🔥</span>
          <span className="pf-ach-big pf-ach-big--pos">{career.bestWStreak}</span>
          <span className="pf-ach-lbl">W-streak</span>
          <span className="pf-ach-ctx">{wSeasonName ? `${wSeasonName} · best` : 'best'}</span>
        </div>
        <div className="pf-ach-tile">
          <span className="pf-ach-icon">🎯</span>
          <span className="pf-ach-big">{career.goals}</span>
          <span className="pf-ach-lbl">Goals</span>
          <span className="pf-ach-ctx">career total</span>
        </div>
        <div className="pf-ach-tile">
          <span className="pf-ach-icon">🟨</span>
          <span className="pf-ach-big">{career.yellows}</span>
          <span className="pf-ach-lbl">Yellows</span>
          <span className="pf-ach-ctx">career</span>
        </div>
        <div className="pf-ach-tile">
          <span className="pf-ach-icon">🟥</span>
          <span className="pf-ach-big">{career.reds}</span>
          <span className="pf-ach-lbl">Reds</span>
          <span className="pf-ach-ctx">{career.reds === 0 ? 'career · clean' : 'career'}</span>
        </div>
        <div className="pf-ach-tile">
          <span className="pf-ach-icon">📉</span>
          <span className="pf-ach-big pf-ach-big--neg">{career.worstLStreak}</span>
          <span className="pf-ach-lbl">L-streak</span>
          <span className="pf-ach-ctx">{lSeasonName ? `${lSeasonName} · longest` : 'longest'}</span>
        </div>
      </div>
    </div>
  )
}

function RecentMatchesList({
  matches,
  viewProfileId,
  onMatchTap,
}: {
  matches: RecentMatchRow[]
  viewProfileId: string
  onMatchTap: (matchId: string) => void
}) {
  if (matches.length === 0) {
    return (
      <div style={{ padding: '0 14px 12px', fontSize: 13, color: 'var(--text-muted)' }}>
        No match history yet.
      </div>
    )
  }

  return (
    <>
      <div className="pf-recent-head">Recent matches</div>
      <div className="pf-recent-list">
        {matches.map((row, i) => {
          const m = row.matches!
          const outcome = matchOutcome(row)
          const kickoff = m.matchdays?.kickoff_at ?? null
          const score =
            m.score_white != null && m.score_black != null
              ? `${m.score_white} – ${m.score_black}`
              : '? – ?'
          const isMotm = m.motm_user_id === viewProfileId
          const parts: string[] = []
          if (row.goals > 0) parts.push(`${row.goals} goal${row.goals > 1 ? 's' : ''}`)

          return (
            <button
              key={m.id ?? i}
              className="pf-recent-row"
              onClick={() => onMatchTap(m.id)}
              aria-label={`Match on ${fmtDate(kickoff)}: ${outcome === 'W' ? 'Win' : outcome === 'D' ? 'Draw' : 'Loss'}`}
            >
              <div className="pf-date-block">
                <div className="pf-date">{fmtDate(kickoff)}</div>
                {m.seasons?.name && <div className="pf-season-cap">{m.seasons.name}</div>}
              </div>
              <div className={`pf-result-badge pf-result-badge--${outcome}`}>{outcome}</div>
              <div className="pf-match-meta">
                <div className="pf-team-score-row">
                  <span className={`pf-team-chip pf-team-chip--${row.team}`}>
                    {row.team === 'white' ? 'White' : 'Black'}
                  </span>
                  <span className="pf-score">{score}</span>
                </div>
                <div className="pf-player-line">
                  {parts.length > 0 && <span>{parts.join(' · ')}</span>}
                  {isMotm && (
                    <span className="pf-player-line-motm">
                      {parts.length > 0 ? ' · ' : ''}MOTM ⭐
                    </span>
                  )}
                  {row.yellow_cards > 0 && (
                    <span className="pf-player-line-cardy"> 🟨{row.yellow_cards}</span>
                  )}
                  {row.red_cards > 0 && (
                    <span className="pf-player-line-cardr"> 🟥{row.red_cards}</span>
                  )}
                </div>
              </div>
              <span className="pf-caret">›</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

function EditSheet({
  editPrimary,
  editSecondary,
  editTheme,
  editSort,
  posError,
  saving,
  onPrimaryChange,
  onSecondaryChange,
  onThemeChange,
  onSortChange,
  onSave,
  onClose,
}: {
  editPrimary: PlayerPosition | null
  editSecondary: PlayerPosition | null
  editTheme: ThemePreference
  editSort: SortKey
  posError: string | null
  saving: boolean
  onPrimaryChange: (v: PlayerPosition) => void
  onSecondaryChange: (v: PlayerPosition | null) => void
  onThemeChange: (v: ThemePreference) => void
  onSortChange: (v: SortKey) => void
  onSave: () => void
  onClose: () => void
}) {
  return (
    <div className="pf-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="pf-sheet" role="dialog" aria-modal aria-label="Edit profile">
        <div className="pf-sheet-title">Edit profile</div>

        <div className="pf-sheet-section">Primary position *</div>
        <div className="pf-chip-row">
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              className={[
                'pf-chip',
                `pf-chip--pos-${pos.toLowerCase()}`,
                editPrimary === pos ? 'pf-chip--active' : '',
                pos === editSecondary ? 'pf-chip--disabled' : '',
              ].filter(Boolean).join(' ')}
              disabled={pos === editSecondary}
              onClick={() => onPrimaryChange(pos)}
              aria-pressed={editPrimary === pos}
            >
              {pos}
            </button>
          ))}
        </div>

        <div className="pf-sheet-section">Secondary position (optional)</div>
        <div className="pf-chip-row">
          <button
            className={`pf-chip${editSecondary === null ? ' pf-chip--active' : ''}`}
            onClick={() => onSecondaryChange(null)}
            aria-pressed={editSecondary === null}
          >
            None
          </button>
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              className={[
                'pf-chip',
                `pf-chip--pos-${pos.toLowerCase()}`,
                editSecondary === pos ? 'pf-chip--active' : '',
                pos === editPrimary ? 'pf-chip--disabled' : '',
              ].filter(Boolean).join(' ')}
              disabled={pos === editPrimary}
              onClick={() => onSecondaryChange(pos)}
              aria-pressed={editSecondary === pos}
            >
              {pos}
            </button>
          ))}
        </div>

        {posError && <div className="pf-sheet-error">{posError}</div>}

        <div className="pf-sheet-section">Theme</div>
        <div className="pf-chip-row">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`pf-chip${editTheme === opt.value ? ' pf-chip--active' : ''}`}
              onClick={() => onThemeChange(opt.value)}
              aria-pressed={editTheme === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="pf-sheet-section">Leaderboard sort preference</div>
        <div className="pf-chip-row">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`pf-chip${editSort === opt.value ? ' pf-chip--active' : ''}`}
              onClick={() => onSortChange(opt.value)}
              aria-pressed={editSort === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button
          className="pf-save-btn"
          onClick={onSave}
          disabled={saving || !editPrimary}
        >
          {saving ? 'Saving…' : 'Save positions'}
        </button>
      </div>
    </div>
  )
}

/* ── Main component ── */

export function Profile() {
  const navigate = useNavigate()
  const { profileId: selfProfileId, role: selfRole } = useApp()
  const [searchParams] = useSearchParams()

  const qProfileId = searchParams.get('profile_id')
  const qSeasonId = searchParams.get('season_id')
  const viewProfileId = qProfileId ?? selfProfileId ?? null

  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [seasons, setSeasons] = useState<SeasonRow[] | null>(null)
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(qSeasonId)
  const [standing, setStanding] = useState<StandingRow | null>(null)
  const [rankNumber, setRankNumber] = useState<number | null>(null)
  const [last5, setLast5] = useState<Last5Row[]>([])
  const [recentMatches, setRecentMatches] = useState<RecentMatchRow[]>([])
  const [career, setCareer] = useState<CareerStats | null>(null)
  const [activeBan, setActiveBan] = useState<BanRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [sheetOpen, setSheetOpen] = useState(false)
  const [openMatchId, setOpenMatchId] = useState<string | null>(null)
  const [editPrimary, setEditPrimary] = useState<PlayerPosition | null>(null)
  const [editSecondary, setEditSecondary] = useState<PlayerPosition | null>(null)
  const [editTheme, setEditTheme] = useState<ThemePreference>('system')
  const [editSort, setEditSort] = useState<SortKey>('points')
  const [posError, setPosError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [avatarSheetOpen, setAvatarSheetOpen] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pickerOpen) return
    const handler = (e: MouseEvent) => {
      if (pickerWrapRef.current && !pickerWrapRef.current.contains(e.target as Node))
        setPickerOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pickerOpen])

  /* Load seasons once on mount */
  useEffect(() => {
    supabase
      .from('seasons')
      .select('id, name, starts_on, ended_at, archived_at, created_at')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const rows = (data ?? []) as SeasonRow[]
        setSeasons(rows)
        if (!selectedSeasonId && rows.length > 0) {
          const active = rows.find((s) => s.ended_at === null && s.archived_at === null)
          setSelectedSeasonId(active?.id ?? rows[0].id)
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Main data load — runs when viewProfileId or selectedSeasonId changes */
  useEffect(() => {
    if (!viewProfileId || !selectedSeasonId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    const profileP = supabase
      .from('profiles')
      .select('id, display_name, avatar_url, primary_position, secondary_position, theme_preference, leaderboard_sort, role, is_active, joined_on')
      .eq('id', viewProfileId)
      .single()

    const standingP = supabase
      .from('v_season_standings')
      .select('wins, draws, losses, goals, yellows, reds, motms, late_cancel_points, points')
      .eq('season_id', selectedSeasonId)
      .eq('profile_id', viewProfileId)
      .maybeSingle()

    const allStandingsP = supabase
      .from('v_season_standings')
      .select('profile_id, display_name, points, wins, motms, goals')
      .eq('season_id', selectedSeasonId)

    const last5P = supabase
      .from('v_player_last5')
      .select('outcome, kickoff_at')
      .eq('season_id', selectedSeasonId)
      .eq('profile_id', viewProfileId)
      .order('kickoff_at', { ascending: true })

    const recentP = supabase
      .from('match_players')
      .select(`
        team, goals, yellow_cards, red_cards,
        matches(
          id, result, score_white, score_black, motm_user_id, approved_at,
          matchdays(kickoff_at),
          seasons(id, name)
        )
      `)
      .eq('profile_id', viewProfileId)

    const banP = supabase
      .from('player_bans')
      .select('ends_at, revoked_at')
      .eq('profile_id', viewProfileId)
      .gt('ends_at', new Date().toISOString())
      .is('revoked_at', null)
      .limit(1)
      .maybeSingle()

    Promise.all([profileP, standingP, allStandingsP, last5P, recentP, banP]).then(
      ([p, s, as_, l, r, b]) => {
        if (cancelled) return
        if (p.error) { setError(p.error.message); setLoading(false); return }

        setProfile(p.data as ProfileData)
        setStanding(s.data as StandingRow | null)

        const allRows = (as_.data ?? []) as AllStandingRow[]
        setRankNumber(computeRank(allRows, viewProfileId))

        setLast5((l.data ?? []) as Last5Row[])

        const allMatches = ((r.data ?? []) as RecentMatchRow[])
          .filter((row) => row.matches?.approved_at != null)
          .sort((a, b) => {
            const ka = a.matches?.matchdays?.kickoff_at ?? ''
            const kb = b.matches?.matchdays?.kickoff_at ?? ''
            return kb.localeCompare(ka)
          })
        setRecentMatches(allMatches.slice(0, 10))

        const careerGoals = allMatches.reduce((acc, m) => acc + m.goals, 0)
        const careerYellows = allMatches.reduce((acc, m) => acc + m.yellow_cards, 0)
        const careerReds = allMatches.reduce((acc, m) => acc + m.red_cards, 0)
        const careerMotms = allMatches.filter((m) => m.matches?.motm_user_id === viewProfileId).length
        const { bestW, bestWSeasonId, worstL, worstLSeasonId } = computeStreaks(allMatches)
        setCareer({
          matches: allMatches.length,
          goals: careerGoals,
          yellows: careerYellows,
          reds: careerReds,
          motms: careerMotms,
          bestWStreak: bestW,
          bestWStreakSeasonId: bestWSeasonId,
          worstLStreak: worstL,
          worstLStreakSeasonId: worstLSeasonId,
        })

        setActiveBan(b.data ? (b.data as BanRow) : null)
        setLoading(false)
      },
    )

    return () => { cancelled = true }
  }, [viewProfileId, selectedSeasonId])

  /* Auto-open edit sheet on first self-view if positions not yet set (ghost profile) */
  useEffect(() => {
    if (isSelf && profile && !profile.primary_position && !sheetOpen) openSheet()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  function openSheet() {
    if (!profile) return
    setEditPrimary(profile.primary_position)
    setEditSecondary(profile.secondary_position)
    setEditTheme(profile.theme_preference)
    setEditSort(profile.leaderboard_sort)
    setPosError(null)
    setSheetOpen(true)
  }

  async function handleThemeChange(val: ThemePreference) {
    setEditTheme(val)
    if (!selfProfileId) return
    await supabase.from('profiles').update({ theme_preference: val }).eq('id', selfProfileId)
    const root = document.documentElement
    root.classList.remove('theme-light', 'theme-dark', 'theme-auto')
    if (val === 'light') root.classList.add('theme-light')
    else if (val === 'dark') root.classList.add('theme-dark')
    else root.classList.add('theme-auto')
  }

  async function handleSortChange(val: SortKey) {
    setEditSort(val)
    if (!selfProfileId) return
    await supabase.from('profiles').update({ leaderboard_sort: val }).eq('id', selfProfileId)
  }

  async function handleSavePositions() {
    if (!editPrimary) { setPosError('Primary position is required'); return }
    if (editPrimary === editSecondary) { setPosError('Primary and secondary must differ'); return }
    setPosError(null)
    setSaving(true)
    const { error: saveErr } = await supabase
      .from('profiles')
      .update({
        primary_position: editPrimary,
        secondary_position: editSecondary ?? null,
      })
      .eq('id', selfProfileId!)
    setSaving(false)
    if (saveErr) { setPosError(saveErr.message); return }
    setProfile((prev) =>
      prev ? { ...prev, primary_position: editPrimary, secondary_position: editSecondary ?? null } : prev,
    )
    setSheetOpen(false)
  }

  async function handleAvatarFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !profile) return
    e.target.value = ''
    setAvatarUploading(true)
    setAvatarError(null)
    try {
      const blob = await compressImage(file)
      const path = `${profile.id}.jpg`
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
      const urlWithBust = `${publicUrl}?t=${Date.now()}`
      const { error: dbErr } = await supabase
        .from('profiles')
        .update({ avatar_url: urlWithBust })
        .eq('id', profile.id)
      if (dbErr) throw dbErr
      setProfile((prev) => prev ? { ...prev, avatar_url: urlWithBust } : prev)
      setAvatarSheetOpen(false)
    } catch (err: unknown) {
      setAvatarError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setAvatarUploading(false)
    }
  }

  async function handleRemoveAvatar() {
    if (!profile) return
    setAvatarUploading(true)
    setAvatarError(null)
    try {
      await supabase.storage.from('avatars').remove([`${profile.id}.jpg`])
      const { error: dbErr } = await supabase
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', profile.id)
      if (dbErr) throw dbErr
      setProfile((prev) => prev ? { ...prev, avatar_url: null } : prev)
      setAvatarSheetOpen(false)
    } catch (err: unknown) {
      setAvatarError(err instanceof Error ? err.message : 'Remove failed')
    } finally {
      setAvatarUploading(false)
    }
  }

  const isSelf = viewProfileId !== null && viewProfileId === selfProfileId
  const isAdminViewingOther = !isSelf && (selfRole === 'admin' || selfRole === 'super_admin')
  const selectedSeason = seasons?.find((s) => s.id === selectedSeasonId) ?? null
  const isActiveSeason = selectedSeason
    ? selectedSeason.ended_at === null && selectedSeason.archived_at === null
    : false

  if (loading || !profile) {
    return (
      <div className="pf-screen">
        <div className="pf-skeleton">
          <div className="pf-skel-block" style={{ height: 72 }} />
          <div className="pf-skel-block" style={{ height: 140 }} />
          <div className="pf-skel-block" style={{ height: 40 }} />
          <div className="pf-skel-block" style={{ height: 160 }} />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div
        className="pf-screen"
        style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)' }}
      >
        <div style={{ marginBottom: 12 }}>Couldn't load this profile.</div>
        <button
          style={{
            padding: '8px 18px',
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            fontWeight: 700,
          }}
          onClick={() => { setError(null); setLoading(true) }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="pf-screen">
      {/* === Top nav === */}
      <div className="pf-nav">
        <button className="pf-nav-btn" aria-label="Back" onClick={() => navigate(-1)}>←</button>
        {isSelf && (
          <button
            className="pf-nav-btn pf-nav-btn--edit"
            aria-label="Edit profile"
            onClick={openSheet}
          >
            ✎
          </button>
        )}
      </div>

      {/* === Hero band === */}
      <div className="pf-hero">
        {isSelf ? (
          <button
            className="pf-avatar-wrap"
            onClick={() => { setAvatarError(null); setAvatarSheetOpen(true) }}
            disabled={avatarUploading}
            aria-label="Change profile photo"
          >
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="pf-avatar" />
            ) : (
              <span className="pf-avatar">{initials(profile.display_name)}</span>
            )}
            {avatarUploading ? (
              <span className="pf-avatar-busy" aria-hidden>⏳</span>
            ) : (
              <span className="pf-avatar-cam" aria-hidden>📷</span>
            )}
          </button>
        ) : (
          <>
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="pf-avatar pf-avatar--other" />
            ) : (
              <div className="pf-avatar pf-avatar--other" aria-hidden>
                {initials(profile.display_name)}
              </div>
            )}
          </>
        )}
        <div className="pf-identity">
          <div className="pf-name-row">
            <span className="pf-name">{profile.display_name}</span>
            {(profile.role === 'admin' || profile.role === 'super_admin') && (
              <span className="pf-role-chip">
                {profile.role === 'super_admin' ? 'Super Admin' : 'Admin'}
              </span>
            )}
            {!profile.is_active && <span className="pf-inactive-chip">Inactive</span>}
          </div>
          {profile.primary_position && (
            <div className="pf-pills">
              <span className={`pf-pos pf-pos--fill-${profile.primary_position.toLowerCase()}`}>
                {profile.primary_position}
              </span>
              {profile.secondary_position && (
                <span className={`pf-pos pf-pos--out-${profile.secondary_position.toLowerCase()}`}>
                  {profile.secondary_position}
                </span>
              )}
            </div>
          )}
          {activeBan && (
            <div className="pf-banned-chip" role="status">
              🚫 Banned through {fmtDate(activeBan.ends_at)}
            </div>
          )}
          <div className="pf-joined">Joined {fmtDate(profile.joined_on)}</div>
        </div>
      </div>

      {/* === Season picker === */}
      {seasons && seasons.length > 0 && (
        <div ref={pickerWrapRef} className="pf-season-wrap">
          <button
            className="pf-season-chip"
            onClick={() => setPickerOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
          >
            <span className={`pf-season-dot${isActiveSeason ? '' : ' pf-season-dot--archived'}`} />
            <span>{selectedSeason?.name ?? 'Season'}</span>
            <span className="lb-caret">▾</span>
          </button>
          {pickerOpen && (
            <div className="pf-dropdown" role="listbox">
              {seasons.map((s) => {
                const isOngoing = s.ended_at === null && s.archived_at === null
                const label = isOngoing ? 'Ongoing' : s.archived_at ? 'Archived' : 'Ended'
                return (
                  <div
                    key={s.id}
                    className={`pf-dropdown-item${s.id === selectedSeasonId ? ' pf-dropdown-item--active' : ''}`}
                    role="option"
                    aria-selected={s.id === selectedSeasonId}
                    onClick={() => { setSelectedSeasonId(s.id); setPickerOpen(false) }}
                  >
                    <span>{s.name}</span>
                    <span
                      className={`lb-sheet-badge lb-sheet-badge--${
                        isOngoing ? 'ongoing' : s.archived_at ? 'archived' : 'ended'
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* === Season stats card === */}
      <SeasonStatsCard
        standing={standing}
        seasonName={selectedSeason?.name ?? null}
        rank={rankNumber}
      />

      {/* === Last-5 strip === */}
      <Last5Strip rows={last5} />

      {/* === Achievements card === */}
      {career && seasons && (
        <AchievementsCard career={career} seasons={seasons} isSelf={isSelf} />
      )}

      {/* === Recent matches === */}
      {viewProfileId && (
        <RecentMatchesList
          matches={recentMatches}
          viewProfileId={viewProfileId}
          onMatchTap={(id) => setOpenMatchId(id)}
        />
      )}

      {/* === Footer === */}
      <div className="pf-footer">
        <Link to="/leaderboard">View full leaderboard →</Link>
        {isAdminViewingOther && (
          <>
            {' · '}
            <Link to="/admin/players">Edit in Admin → Players</Link>
          </>
        )}
      </div>

      {/* === Match-detail sheet (opened from a recent-match row tap) === */}
      {openMatchId && (
        <MatchDetailSheet
          matchId={openMatchId}
          profileId={viewProfileId ?? undefined}
          onClose={() => setOpenMatchId(null)}
        />
      )}

      {/* === Edit sheet === */}
      {sheetOpen && (
        <EditSheet
          editPrimary={editPrimary}
          editSecondary={editSecondary}
          editTheme={editTheme}
          editSort={editSort}
          posError={posError}
          saving={saving}
          onPrimaryChange={setEditPrimary}
          onSecondaryChange={setEditSecondary}
          onThemeChange={handleThemeChange}
          onSortChange={handleSortChange}
          onSave={handleSavePositions}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {/* === Avatar upload sheet === */}
      {avatarSheetOpen && (
        <AvatarSheet
          uploading={avatarUploading}
          error={avatarError}
          hasAvatar={!!profile.avatar_url}
          cameraInputRef={cameraInputRef}
          galleryInputRef={galleryInputRef}
          onRemove={handleRemoveAvatar}
          onClose={() => setAvatarSheetOpen(false)}
          onFileChange={handleAvatarFile}
        />
      )}
    </div>
  )
}
