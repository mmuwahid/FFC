/**
 * §3.1-v2 Captain Helper — Slice A.
 *
 * Admin-only screen for picking the two captains of a locked matchday.
 * Supersedes §3.1 (S002 first-pass).
 *
 * Slice A (this pass):
 *   - Route /matchday/:id/captains, admin-gated.
 *   - Formula mode (default when season_matchdays_approved >= 5):
 *     top suggested pair from suggest_captain_pairs RPC + candidate list with
 *     boolean triplet per player (min-matches · attendance · cooldown),
 *     sectioned Eligible / Partial / Ineligible.
 *   - Randomizer mode (default when < 5 approved matchdays): big Roll button
 *     hitting pick_captains_random; muted candidate list below.
 *   - Pair-confirmation sheet auto-applies White=weaker (higher rank number)
 *     and calls set_matchday_captains.
 *
 * Deferred to Slice B:
 *   - Guests-on-roster subsection with S007 stats (read-only).
 *   - Rank-gap > 5 "Proceed anyway?" sub-modal.
 *   - Criteria-triplet tooltip expansion.
 *   - Concurrent-admin toast.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useApp } from '../../lib/AppContext'
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

type PlayerPosition = Database['public']['Enums']['player_position']

interface MatchdayLite {
  id: string
  season_id: string
  kickoff_at: string
  venue: string | null
  roster_locked_at: string | null
}

interface MatchLite {
  id: string
  matchday_id: string
  approved_at: string | null
}

interface Candidate {
  profile_id: string
  display_name: string
  primary_position: PlayerPosition | null
  secondary_position: PlayerPosition | null
  initials: string
  matches_played: number
  attendance_rate: number
  matchdays_since_captained: number
  meets_min_matches: boolean
  meets_attendance: boolean
  cooldown_ok: boolean
  is_eligible: boolean
  rank: number | null // season rank, lower is better
  is_currently_captain: boolean
}

interface SuggestedPair {
  white_captain: string
  black_captain: string
  score: number
}

interface ConfirmSheetState {
  white_id: string
  black_id: string
  source: 'suggested' | 'manual' | 'random'
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  const MONTH = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  return `${DOW[d.getDay()]} · ${String(d.getDate()).padStart(2, '0')}/${MONTH[d.getMonth()]}/${d.getFullYear()}`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  let h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'pm' : 'am'
  h = h % 12 || 12
  return `${h}:${m}${ampm}`
}

export function CaptainHelper() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { role } = useApp()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [matchday, setMatchday] = useState<MatchdayLite | null>(null)
  const [match, setMatch] = useState<MatchLite | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [seasonApprovedCount, setSeasonApprovedCount] = useState(0)
  const [mode, setMode] = useState<'formula' | 'randomizer'>('formula')
  const [userToggledMode, setUserToggledMode] = useState(false)
  const [suggestedPairs, setSuggestedPairs] = useState<SuggestedPair[]>([])
  const [rolling, setRolling] = useState(false)
  const [confirmSheet, setConfirmSheet] = useState<ConfirmSheetState | null>(null)
  const [saving, setSaving] = useState(false)

  const isAdmin = role === 'admin' || role === 'super_admin'

  const loadAll = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)

    try {
      const { data: md, error: mdErr } = await supabase
        .from('matchdays')
        .select('id, season_id, kickoff_at, venue, roster_locked_at')
        .eq('id', id)
        .maybeSingle()
      if (mdErr) throw mdErr
      if (!md) {
        setError('Matchday not found.')
        setLoading(false)
        return
      }
      setMatchday(md)

      const { data: matchRow, error: matchErr } = await supabase
        .from('matches')
        .select('id, matchday_id, approved_at')
        .eq('matchday_id', md.id)
        .maybeSingle()
      if (matchErr) throw matchErr
      setMatch(matchRow)

      if (!md.roster_locked_at || !matchRow) {
        setCandidates([])
        setLoading(false)
        return
      }

      const { data: rosterRows, error: rosterErr } = await supabase
        .from('match_players')
        .select('profile_id, is_captain, profiles:profile_id(id, display_name, primary_position, secondary_position)')
        .eq('match_id', matchRow.id)
        .not('profile_id', 'is', null)
      if (rosterErr) throw rosterErr

      const rosterIds: string[] = []
      const profileLookup: Record<string, { display_name: string; primary_position: PlayerPosition | null; secondary_position: PlayerPosition | null; is_captain: boolean }> = {}
      for (const row of rosterRows ?? []) {
        if (!row.profile_id) continue
        rosterIds.push(row.profile_id)
        const p = row.profiles as unknown as { id: string; display_name: string; primary_position: PlayerPosition | null; secondary_position: PlayerPosition | null } | null
        if (p) {
          profileLookup[row.profile_id] = {
            display_name: p.display_name,
            primary_position: p.primary_position,
            secondary_position: p.secondary_position,
            is_captain: !!row.is_captain,
          }
        }
      }

      if (rosterIds.length === 0) {
        setCandidates([])
        setLoading(false)
        return
      }

      const { data: eligRows, error: eligErr } = await supabase
        .from('v_captain_eligibility')
        .select('profile_id, matches_played, attendance_rate, matchdays_since_captained, meets_min_matches, meets_attendance, cooldown_ok, is_eligible')
        .eq('season_id', md.season_id)
        .in('profile_id', rosterIds)
      if (eligErr) throw eligErr

      const eligLookup: Record<string, Pick<Candidate, 'matches_played' | 'attendance_rate' | 'matchdays_since_captained' | 'meets_min_matches' | 'meets_attendance' | 'cooldown_ok' | 'is_eligible'>> = {}
      for (const e of eligRows ?? []) {
        if (!e.profile_id) continue
        eligLookup[e.profile_id] = {
          matches_played: e.matches_played ?? 0,
          attendance_rate: Number(e.attendance_rate ?? 0),
          matchdays_since_captained: e.matchdays_since_captained ?? 999,
          meets_min_matches: !!e.meets_min_matches,
          meets_attendance: !!e.meets_attendance,
          cooldown_ok: !!e.cooldown_ok,
          is_eligible: !!e.is_eligible,
        }
      }

      // Season standings → rank
      const { data: standRows, error: standErr } = await supabase
        .from('v_season_standings')
        .select('profile_id, points, wins, motms, goals, display_name')
        .eq('season_id', md.season_id)
      if (standErr) throw standErr

      const sorted = [...(standRows ?? [])].sort((a, b) => {
        if ((b.points ?? 0) !== (a.points ?? 0)) return (b.points ?? 0) - (a.points ?? 0)
        if ((b.wins ?? 0) !== (a.wins ?? 0)) return (b.wins ?? 0) - (a.wins ?? 0)
        if ((b.motms ?? 0) !== (a.motms ?? 0)) return (b.motms ?? 0) - (a.motms ?? 0)
        if ((b.goals ?? 0) !== (a.goals ?? 0)) return (b.goals ?? 0) - (a.goals ?? 0)
        return String(a.display_name ?? '').localeCompare(String(b.display_name ?? ''))
      })
      const rankLookup: Record<string, number> = {}
      sorted.forEach((row, idx) => {
        if (row.profile_id) rankLookup[row.profile_id] = idx + 1
      })

      const cands: Candidate[] = rosterIds.map((pid) => {
        const prof = profileLookup[pid]
        const elig = eligLookup[pid]
        return {
          profile_id: pid,
          display_name: prof?.display_name ?? '—',
          primary_position: prof?.primary_position ?? null,
          secondary_position: prof?.secondary_position ?? null,
          initials: initials(prof?.display_name ?? ''),
          matches_played: elig?.matches_played ?? 0,
          attendance_rate: elig?.attendance_rate ?? 0,
          matchdays_since_captained: elig?.matchdays_since_captained ?? 999,
          meets_min_matches: !!elig?.meets_min_matches,
          meets_attendance: !!elig?.meets_attendance,
          cooldown_ok: !!elig?.cooldown_ok,
          is_eligible: !!elig?.is_eligible,
          rank: rankLookup[pid] ?? null,
          is_currently_captain: !!prof?.is_captain,
        }
      })
      setCandidates(cands)

      // Season approved matchdays count for mode default
      const { count: approvedCount } = await supabase
        .from('matches')
        .select('id, matchday_id!inner(season_id)', { count: 'exact', head: true })
        .eq('matchday_id.season_id', md.season_id)
        .not('approved_at', 'is', null)

      setSeasonApprovedCount(approvedCount ?? 0)
      if (!userToggledMode) {
        setMode((approvedCount ?? 0) >= 5 ? 'formula' : 'randomizer')
      }

      // Suggested pairs
      const { data: pairs, error: pairsErr } = await supabase.rpc('suggest_captain_pairs', {
        p_matchday_id: md.id,
      })
      if (pairsErr) throw pairsErr
      const pairRows: SuggestedPair[] = ((pairs ?? []) as unknown as SuggestedPair[])
        .filter((r) => r.white_captain && r.black_captain)
        .slice(0, 2)
      setSuggestedPairs(pairRows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load captain helper.')
    } finally {
      setLoading(false)
    }
  }, [id, userToggledMode])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const candidateById = useMemo(() => {
    const map: Record<string, Candidate> = {}
    for (const c of candidates) map[c.profile_id] = c
    return map
  }, [candidates])

  const sections = useMemo(() => {
    const passCount = (c: Candidate) =>
      (c.meets_min_matches ? 1 : 0) + (c.meets_attendance ? 1 : 0) + (c.cooldown_ok ? 1 : 0)
    const rankSort = (a: Candidate, b: Candidate) => (a.rank ?? 999) - (b.rank ?? 999)
    const eligible = candidates.filter((c) => c.is_eligible).sort(rankSort)
    const partial = candidates
      .filter((c) => !c.is_eligible && passCount(c) >= 1)
      .sort((a, b) => passCount(b) - passCount(a) || rankSort(a, b))
    const ineligible = candidates
      .filter((c) => !c.is_eligible && passCount(c) === 0)
      .sort((a, b) => a.display_name.localeCompare(b.display_name))
    return { eligible, partial, ineligible }
  }, [candidates])

  const onRoll = useCallback(async () => {
    if (!matchday) return
    setRolling(true)
    setError(null)
    try {
      const { data, error: rollErr } = await supabase.rpc('pick_captains_random', {
        p_matchday_id: matchday.id,
      })
      if (rollErr) throw rollErr
      const row = ((data ?? []) as unknown as { white_captain: string; black_captain: string }[])[0]
      if (!row?.white_captain || !row?.black_captain) {
        setError('Randomizer returned no pair — is the roster locked?')
        return
      }
      openConfirm(row.white_captain, row.black_captain, 'random')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Randomizer failed.')
    } finally {
      setRolling(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchday])

  const openConfirm = useCallback(
    (idA: string, idB: string, source: ConfirmSheetState['source']) => {
      const a = candidateById[idA]
      const b = candidateById[idB]
      if (!a || !b) return
      // White = weaker (higher rank number); fall back to alphabetical on ties/nulls.
      const aWeaker = (a.rank ?? 999) > (b.rank ?? 999) || (a.rank === b.rank && a.display_name > b.display_name)
      const white_id = aWeaker ? a.profile_id : b.profile_id
      const black_id = aWeaker ? b.profile_id : a.profile_id
      setConfirmSheet({ white_id, black_id, source })
    },
    [candidateById]
  )

  const onConfirm = useCallback(async () => {
    if (!matchday || !confirmSheet) return
    setSaving(true)
    setError(null)
    try {
      const { error: confErr } = await supabase.rpc('set_matchday_captains', {
        p_matchday_id: matchday.id,
        p_white_profile_id: confirmSheet.white_id,
        p_black_profile_id: confirmSheet.black_id,
      })
      if (confErr) throw confErr
      setConfirmSheet(null)
      navigate('/admin/matches')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save captains.')
    } finally {
      setSaving(false)
    }
  }, [matchday, confirmSheet, navigate])

  if (!isAdmin) {
    return (
      <div className="ch-root">
        <div className="ch-empty">
          <h3>Admin only</h3>
          <p>This screen is restricted to admins and super-admins.</p>
          <button type="button" className="auth-btn auth-btn--approve" onClick={() => navigate('/poll')}>
            Back to Poll
          </button>
        </div>
      </div>
    )
  }

  if (loading) return <div className="ch-root"><div className="ch-loading">Loading captain helper…</div></div>
  if (error) return <div className="ch-root"><div className="ch-empty"><h3>Couldn't load</h3><p>{error}</p></div></div>
  if (!matchday) return null

  if (!matchday.roster_locked_at || !match) {
    return (
      <div className="ch-root">
        <div className="ch-topbar">
          <button type="button" className="ch-back" onClick={() => navigate('/admin/matches')}>‹ Back</button>
          <div className="ch-title">Pick captains</div>
          <div className="ch-topbar-spacer" />
        </div>
        <div className="ch-empty">
          <h3>Roster isn't set for this matchday</h3>
          <p>Lock the roster first (admin → Matches → Lock roster), then return here.</p>
        </div>
      </div>
    )
  }

  const pickedOnce = candidates.some((c) => c.is_currently_captain)
  const topPair = suggestedPairs[0]
  const altPair = suggestedPairs[1]

  return (
    <div className="ch-root">
      <div className="ch-topbar">
        <button type="button" className="ch-back" onClick={() => navigate('/admin/matches')}>‹ Back</button>
        <div className="ch-title">Pick captains</div>
        <div className="ch-topbar-spacer" />
      </div>

      <div className="ch-md-strip">
        <div>
          <div className="ch-md-label">Matchday</div>
          <div className="ch-md-date">
            {formatDate(matchday.kickoff_at)} · kickoff {formatTime(matchday.kickoff_at)}
          </div>
        </div>
        <span className="ch-locked-chip">🔒 Roster locked</span>
      </div>

      <div className="ch-mode-toggle" role="tablist">
        <button
          type="button"
          role="tab"
          className={`ch-mode-opt${mode === 'formula' ? ' ch-mode-opt--active' : ''}`}
          aria-selected={mode === 'formula'}
          onClick={() => { setMode('formula'); setUserToggledMode(true) }}
        >
          Formula
        </button>
        <button
          type="button"
          role="tab"
          className={`ch-mode-opt${mode === 'randomizer' ? ' ch-mode-opt--active' : ''}`}
          aria-selected={mode === 'randomizer'}
          onClick={() => { setMode('randomizer'); setUserToggledMode(true) }}
        >
          Randomizer
        </button>
      </div>

      {pickedOnce && (
        <div className="ch-note ch-note--info">
          Captains already set — confirming again overwrites the pair.
        </div>
      )}

      {mode === 'formula' ? (
        <>
          <div className="ch-section-head">
            <span className="ch-section-label">Suggested pair</span>
            <span className="ch-section-aux">top by pair balance · season {seasonApprovedCount} approved</span>
          </div>
          {topPair ? (
            <SuggestedPairCard pair={topPair} primary candidateById={candidateById} onUse={() => openConfirm(topPair.white_captain, topPair.black_captain, 'suggested')} />
          ) : (
            <div className="ch-note ch-note--warn">
              No fully-eligible pair inside the 5-rank-gap rule — consider Randomizer or widen eligibility.
            </div>
          )}
          {altPair && (
            <SuggestedPairCard pair={altPair} primary={false} candidateById={candidateById} onUse={() => openConfirm(altPair.white_captain, altPair.black_captain, 'suggested')} />
          )}
        </>
      ) : (
        <div className="ch-random-card">
          <div className="ch-random-kicker">
            {seasonApprovedCount < 5
              ? `Season just started — only ${seasonApprovedCount} approved matchdays so far.`
              : 'Random pick from the locked 14.'}
          </div>
          <button
            type="button"
            className="ch-random-btn"
            onClick={() => void onRoll()}
            disabled={rolling}
          >
            {rolling ? 'Rolling…' : '🎲 Roll captains'}
          </button>
          <div className="ch-random-hint">Tap again to re-roll until you confirm a pair.</div>
        </div>
      )}

      <div className="ch-section-head ch-section-head--sub">
        <span className="ch-section-label">All candidates · {candidates.length} on roster</span>
        <span className="ch-section-aux">tap a row to start a pair</span>
      </div>

      {sections.eligible.length > 0 && (
        <>
          <div className="ch-cand-group-head ch-cand-group-head--eligible">● Eligible · {sections.eligible.length}</div>
          <ul className="ch-cand-list">
            {sections.eligible.map((c) => <CandidateRow key={c.profile_id} c={c} dim={false} onPick={() => openConfirm(c.profile_id, pickPartner(candidates, c).profile_id, 'manual')} />)}
          </ul>
        </>
      )}

      {sections.partial.length > 0 && (
        <>
          <div className="ch-cand-group-head ch-cand-group-head--partial">◐ Partial · {sections.partial.length}</div>
          <ul className="ch-cand-list">
            {sections.partial.map((c) => <CandidateRow key={c.profile_id} c={c} dim={mode === 'randomizer'} onPick={() => openConfirm(c.profile_id, pickPartner(candidates, c).profile_id, 'manual')} />)}
          </ul>
        </>
      )}

      {sections.ineligible.length > 0 && (
        <>
          <div className="ch-cand-group-head ch-cand-group-head--ineligible">○ Ineligible · {sections.ineligible.length}</div>
          <ul className="ch-cand-list">
            {sections.ineligible.map((c) => <CandidateRow key={c.profile_id} c={c} dim onPick={() => openConfirm(c.profile_id, pickPartner(candidates, c).profile_id, 'manual')} />)}
          </ul>
        </>
      )}

      {confirmSheet && (
        <ConfirmSheet
          white={candidateById[confirmSheet.white_id]}
          black={candidateById[confirmSheet.black_id]}
          source={confirmSheet.source}
          saving={saving}
          error={error}
          onCancel={() => setConfirmSheet(null)}
          onConfirm={() => void onConfirm()}
          onReRoll={mode === 'randomizer' ? () => { setConfirmSheet(null); void onRoll() } : undefined}
        />
      )}
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────

function pickPartner(candidates: Candidate[], anchor: Candidate): Candidate {
  // Manual-pick shortcut: auto-pair with the top eligible candidate that isn't the anchor.
  const eligibleOthers = candidates.filter((c) => c.profile_id !== anchor.profile_id && c.is_eligible).sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
  if (eligibleOthers.length > 0) return eligibleOthers[0]
  // Fall back to any other candidate.
  const others = candidates.filter((c) => c.profile_id !== anchor.profile_id).sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
  return others[0] ?? anchor
}

function SuggestedPairCard({
  pair, primary, candidateById, onUse,
}: {
  pair: SuggestedPair
  primary: boolean
  candidateById: Record<string, Candidate>
  onUse: () => void
}) {
  const a = candidateById[pair.white_captain]
  const b = candidateById[pair.black_captain]
  if (!a || !b) return null
  // Reflect White=weaker in the display: higher rank # (weaker) goes to White.
  const aWeaker = (a.rank ?? 999) > (b.rank ?? 999)
  const white = aWeaker ? a : b
  const black = aWeaker ? b : a
  const gap = a.rank && b.rank ? Math.abs(a.rank - b.rank) : null
  const gapOk = gap !== null && gap <= 5

  return (
    <div className={`ch-pair-card${primary ? ' ch-pair-card--primary' : ''}`}>
      <div className="ch-pair-kicker">{primary ? '★ Best match' : 'Alternative'}{gap !== null ? ` · rank gap ${gap}` : ''}</div>
      <div className="ch-pair-row">
        <span className="ch-pair-side ch-pair-side--white" aria-hidden>🤍</span>
        <div className="ch-pair-body">
          <div className="ch-pair-name">
            {white.display_name}
            {white.rank != null && <span className="ch-rank-pill">#{white.rank}</span>}
            <PositionPills primary={white.primary_position} secondary={white.secondary_position} />
          </div>
          <div className="ch-pair-stats">
            <Triplet c={white} />
            <span className="ch-pair-meta">{white.matches_played} MP · {Math.round(white.attendance_rate * 100)}% attend · cap {white.matchdays_since_captained >= 999 ? '—' : `${white.matchdays_since_captained}md ago`}</span>
          </div>
        </div>
      </div>
      <div className="ch-pair-row">
        <span className="ch-pair-side ch-pair-side--black" aria-hidden>⚫</span>
        <div className="ch-pair-body">
          <div className="ch-pair-name">
            {black.display_name}
            {black.rank != null && <span className="ch-rank-pill">#{black.rank}</span>}
            <PositionPills primary={black.primary_position} secondary={black.secondary_position} />
          </div>
          <div className="ch-pair-stats">
            <Triplet c={black} />
            <span className="ch-pair-meta">{black.matches_played} MP · {Math.round(black.attendance_rate * 100)}% attend · cap {black.matchdays_since_captained >= 999 ? '—' : `${black.matchdays_since_captained}md ago`}</span>
          </div>
        </div>
      </div>
      <div className="ch-pair-footer">
        <span className="ch-pair-gap">Rank gap: {gap ?? '—'}</span>
        <span className={`ch-gap-badge${gapOk ? ' ch-gap-badge--ok' : ' ch-gap-badge--warn'}`}>{gapOk ? '✓ within 5' : '⚠ over 5'}</span>
        <button type="button" className={`ch-use-btn${primary ? '' : ' ch-use-btn--ghost'}`} onClick={onUse}>Use this pair</button>
      </div>
    </div>
  )
}

function CandidateRow({ c, dim, onPick }: { c: Candidate; dim: boolean; onPick: () => void }) {
  return (
    <li className={`ch-cand-row${dim ? ' ch-cand-row--dim' : ''}${c.is_currently_captain ? ' ch-cand-row--captain' : ''}`}>
      <button type="button" className="ch-cand-btn" onClick={onPick}>
        <span className="ch-cand-rank">{c.rank != null ? `#${c.rank}` : '—'}</span>
        <span className="ch-cand-avatar" aria-hidden>{c.initials}</span>
        <span className="ch-cand-name">
          {c.display_name}
          {c.is_currently_captain && <span className="ch-cand-captain" title="Current captain">(C)</span>}
          <PositionPills primary={c.primary_position} secondary={c.secondary_position} />
        </span>
        <Triplet c={c} />
        <span className="ch-cand-meta">{c.matches_played} MP</span>
      </button>
    </li>
  )
}

function PositionPills({ primary, secondary }: { primary: PlayerPosition | null; secondary: PlayerPosition | null }) {
  return (
    <>
      {primary && <span className={`ap-pos ap-pos--${primary.toLowerCase()}`}>{primary}</span>}
      {secondary && <span className={`ap-pos ap-pos--${secondary.toLowerCase()} ap-pos--outline`}>{secondary}</span>}
    </>
  )
}

function Triplet({ c }: { c: Candidate }) {
  return (
    <span className="ch-triplet" title={`min-matches · attendance · cooldown — ${c.matches_played} MP · ${Math.round(c.attendance_rate * 100)}% · ${c.matchdays_since_captained >= 999 ? 'never' : `${c.matchdays_since_captained}md`}`}>
      <span className={c.meets_min_matches ? 'ch-triplet-y' : 'ch-triplet-n'}>{c.meets_min_matches ? '✓' : '✗'}</span>
      <span className={c.meets_attendance ? 'ch-triplet-y' : 'ch-triplet-n'}>{c.meets_attendance ? '✓' : '✗'}</span>
      <span className={c.cooldown_ok ? 'ch-triplet-y' : 'ch-triplet-n'}>{c.cooldown_ok ? '✓' : '✗'}</span>
    </span>
  )
}

function ConfirmSheet({
  white, black, source, saving, error, onCancel, onConfirm, onReRoll,
}: {
  white: Candidate | undefined
  black: Candidate | undefined
  source: ConfirmSheetState['source']
  saving: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
  onReRoll?: () => void
}) {
  if (!white || !black) return null
  const gap = white.rank && black.rank ? Math.abs(white.rank - black.rank) : null
  const gapOk = gap !== null && gap <= 5

  return (
    <div className="ch-sheet-scrim" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="ch-sheet">
        <div className="ch-sheet-handle" aria-hidden />
        <div className="ch-sheet-title">Confirm captains <span className="ch-sheet-source">· {source === 'suggested' ? 'suggested pair' : source === 'random' ? 'randomizer' : 'manual pick'}</span></div>

        <div className="ch-sheet-ab">
          <div className="ch-sheet-card ch-sheet-card--white">
            <div className="ch-sheet-tag">🤍 WHITE · weaker of pair</div>
            <div className="ch-sheet-big-avatar">{white.initials}</div>
            <div className="ch-sheet-name">{white.display_name}</div>
            <div className="ch-sheet-pills"><PositionPills primary={white.primary_position} secondary={white.secondary_position} /></div>
            <Triplet c={white} />
            <div className="ch-sheet-stats">#{white.rank ?? '—'} · {white.matches_played} MP · {Math.round(white.attendance_rate * 100)}%</div>
          </div>
          <div className="ch-sheet-card ch-sheet-card--black">
            <div className="ch-sheet-tag">⚫ BLACK</div>
            <div className="ch-sheet-big-avatar">{black.initials}</div>
            <div className="ch-sheet-name">{black.display_name}</div>
            <div className="ch-sheet-pills"><PositionPills primary={black.primary_position} secondary={black.secondary_position} /></div>
            <Triplet c={black} />
            <div className="ch-sheet-stats">#{black.rank ?? '—'} · {black.matches_played} MP · {Math.round(black.attendance_rate * 100)}%</div>
          </div>
        </div>

        <div className={`ch-sheet-balance${gapOk ? ' ch-sheet-balance--ok' : ' ch-sheet-balance--warn'}`}>
          Rank gap: {gap ?? '—'} · {gapOk ? '✓ within 5-position rule' : '⚠ exceeds 5-position rule (Phase 1 advisory)'}
        </div>

        <div className="ch-sheet-assign">
          Auto-assigned: <strong>{white.display_name} → White</strong> (weaker of pair), <strong>{black.display_name} → Black</strong>. Rule is not overridable in Phase 1.
        </div>

        {error && <div className="auth-banner auth-banner--error">{error}</div>}

        <div className="ch-sheet-actions">
          {onReRoll && <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onReRoll} disabled={saving}>🎲 Re-roll</button>}
          <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={saving}>Pick different pair</button>
          <button type="button" className="auth-btn auth-btn--approve" onClick={onConfirm} disabled={saving}>{saving ? 'Saving…' : 'Use this pair'}</button>
        </div>
      </div>
    </div>
  )
}
