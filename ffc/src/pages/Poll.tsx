import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import type { Database } from '../lib/database.types'

/* §3.7 Poll Screen — Phase 1 Depth-B (S026).
 * Nine states rendered from one component, driven by:
 *   - active matchday (poll_opens_at / poll_closes_at / roster_locked_at)
 *   - caller's poll_votes row
 *   - v_match_commitments → merged sorted roster
 *   - match_guests with S007 stats
 *   - draft_sessions + draft_picks (State 6.5)
 *   - match_players.team when teams are set (State 8)
 * Realtime on poll_votes / match_guests / matchdays / draft_sessions / match_players
 * re-fetches on every event within the active matchday.
 */

type PlayerPosition = Database['public']['Enums']['player_position']
type GuestTrait = Database['public']['Enums']['guest_trait']
type GuestRating = Database['public']['Enums']['guest_rating']
type TeamColor = Database['public']['Enums']['team_color']

interface Matchday {
  id: string
  kickoff_at: string
  venue: string | null
  poll_opens_at: string
  poll_closes_at: string
  roster_locked_at: string | null
  format: Database['public']['Enums']['match_format'] | null
  friendly_flagged_at: string | null
  is_friendly: boolean
}

interface Commitment {
  kind: 'player' | 'guest'
  sort_ts: string
  rank: number
  // member-only
  profile_id?: string
  display_name: string
  primary_position?: PlayerPosition | null
  secondary_position?: PlayerPosition | null
  avatar_url?: string | null
  // guest-only
  guest_id?: string
  inviter_name?: string | null
  stamina?: GuestTrait | null
  accuracy?: GuestTrait | null
  rating?: GuestRating | null
  description?: string | null
  team?: TeamColor | null   // populated from match_players when teams set
  is_captain?: boolean
}

const POSITION_OPTIONS: PlayerPosition[] = ['GK', 'DEF', 'CDM', 'W', 'ST']
const TRAIT_OPTIONS: GuestTrait[] = ['low', 'medium', 'high']
const RATING_OPTIONS: GuestRating[] = ['weak', 'average', 'strong']

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function fmtDdMon(iso: string): string {
  const d = new Date(iso)
  const day = d.getDate().toString().padStart(2, '0')
  const mon = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getMonth()]
  const yr = d.getFullYear()
  return `${day} / ${mon} / ${yr}`
}
function fmtTime(iso: string): string {
  const d = new Date(iso)
  const hh = d.getHours()
  const mm = d.getMinutes().toString().padStart(2, '0')
  const ampm = hh >= 12 ? 'pm' : 'am'
  const h12 = ((hh + 11) % 12) + 1
  return `${h12}:${mm}${ampm}`
}
function fmtShort(iso: string): string {
  const d = new Date(iso)
  const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  return `${dow} ${hh}:${mm}`
}
function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60)
}

function PositionPills({ primary, secondary }: { primary?: PlayerPosition | null; secondary?: PlayerPosition | null }) {
  if (!primary && !secondary) return null
  return (
    <div className="po-pills">
      {primary && <span className={`po-pos po-pos--fill po-pos--${primary.toLowerCase()}`}>{primary}</span>}
      {secondary && <span className={`po-pos po-pos--out po-pos--${secondary.toLowerCase()}`}>{secondary}</span>}
    </div>
  )
}

function GuestRatingChip({ rating }: { rating?: GuestRating | null }) {
  if (!rating) return null
  return <span className={`po-guest-rating po-guest-rating--${rating}`}>⭐{rating}</span>
}

function Avatar({ name, url, guest, self }: { name: string; url?: string | null; guest?: boolean; self?: boolean }) {
  if (guest) return <span className="po-avatar po-avatar--guest">+1</span>
  if (url) return <img className={`po-avatar${self ? ' po-avatar--self' : ''}`} src={url} alt="" />
  return <span className={`po-avatar${self ? ' po-avatar--self' : ''}`}>{initialsOf(name)}</span>
}

export function Poll() {
  const navigate = useNavigate()
  const { profileId } = useApp()

  const [md, setMd] = useState<Matchday | null | 'none'>(null)   // 'none' = no matchday scheduled
  const [matchId, setMatchId] = useState<string | null>(null)     // §3.19 Slice E — for formation link
  const [commitments, setCommitments] = useState<Commitment[] | null>(null)
  const [rosterCap, setRosterCap] = useState<number>(14)
  const [myVote, setMyVote] = useState<{ id: string; choice: 'yes' | 'no' | 'maybe'; committed_at: string; cancelled_at: string | null } | null>(null)
  const [draft, setDraft] = useState<{ status: 'in_progress' | 'completed' | 'abandoned'; current_picker_team: TeamColor | null; reason: string | null; started_at: string } | null>(null)
  const [penaltyCopy, setPenaltyCopy] = useState<{ after_lock: number; within_24h: number; ban_days: number } | null>(null)
  const [guestSheetOpen, setGuestSheetOpen] = useState(false)
  const [penaltySheetOpen, setPenaltySheetOpen] = useState(false)
  const [expandedGuest, setExpandedGuest] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /* §3.15 — Post-lock captain reroll modal state.
   * `dropoutNotif` = latest unactioned `dropout_after_lock` notification for the caller
   * + current matchday. Surfaces the action card to captains when teams are revealed.
   * `rerollConfirmOpen` = confirmation sub-sheet for the irreversible reroll action. */
  const [dropoutNotif, setDropoutNotif] = useState<{
    id: string
    created_at: string
    substitute_name: string | null
  } | null>(null)
  const [rerollConfirmOpen, setRerollConfirmOpen] = useState(false)
  const [rerollCutoffHours, setRerollCutoffHours] = useState<number>(12)

  /* Load active matchday (poll open OR upcoming within 7 days). */
  const loadAll = useCallback(async () => {
    setError(null)
    const nowIso = new Date().toISOString()
    const cutoffIso = new Date(Date.now() + 14 * 86400e3).toISOString()

    // Active matchday: within the upcoming window, oldest first
    const { data: mdRows, error: mdErr } = await supabase
      .from('matchdays')
      .select('id, kickoff_at, venue, poll_opens_at, poll_closes_at, roster_locked_at, format, friendly_flagged_at, is_friendly')
      .gte('kickoff_at', nowIso)
      .lte('kickoff_at', cutoffIso)
      .order('kickoff_at', { ascending: true })
      .limit(1)

    if (mdErr) { setError(mdErr.message); return }
    if (!mdRows || mdRows.length === 0) { setMd('none'); setCommitments([]); return }
    const m = mdRows[0] as Matchday
    setMd(m)

    // Roster cap from effective_format RPC (resolves season default)
    const effFmt: 'USER-DEFINED' = await (async () => {
      const { data } = await supabase.rpc('effective_format', { p_matchday_id: m.id })
      return (data as unknown as 'USER-DEFINED') ?? '7v7'
    })()
    const fmt = (typeof effFmt === 'string' ? effFmt : '7v7') as '7v7' | '5v5'
    setRosterCap(fmt === '5v5' ? 10 : 14)

    // My vote
    if (profileId) {
      const { data: mv } = await supabase
        .from('poll_votes')
        .select('id, choice, committed_at, cancelled_at')
        .eq('matchday_id', m.id)
        .eq('profile_id', profileId)
        .maybeSingle()
      setMyVote(mv ?? null)
    } else {
      setMyVote(null)
    }

    // Commitments via v_match_commitments (guest_id added in migration 0020 — maps guest rows by pk)
    const { data: commitRows } = await supabase
      .from('v_match_commitments')
      .select('commitment_type, participant_id, inviter_id, guest_display_name, guest_id, sort_ts, slot_order')
      .eq('matchday_id', m.id)
      .order('sort_ts', { ascending: true })

    // Hydrate participants
    const memberIds = (commitRows ?? []).filter((r) => r.commitment_type === 'player' && r.participant_id).map((r) => r.participant_id as string)
    const guestMdRows: { id: string; inviter_id: string | null; display_name: string; primary_position: PlayerPosition | null; secondary_position: PlayerPosition | null; stamina: GuestTrait | null; accuracy: GuestTrait | null; rating: GuestRating | null; description: string | null }[] = []
    if (commitRows?.some((r) => r.commitment_type === 'guest')) {
      const { data: gs } = await supabase
        .from('match_guests')
        .select('id, inviter_id, display_name, primary_position, secondary_position, stamina, accuracy, rating, description')
        .eq('matchday_id', m.id)
        .is('cancelled_at', null)
      if (gs) guestMdRows.push(...gs)
    }
    const inviterIds = guestMdRows.map((g) => g.inviter_id).filter((x): x is string => !!x)
    const allProfileIds = Array.from(new Set([...memberIds, ...inviterIds]))
    const profileMap = new Map<string, { display_name: string; primary_position: PlayerPosition | null; secondary_position: PlayerPosition | null; avatar_url: string | null }>()
    if (allProfileIds.length) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, display_name, primary_position, secondary_position, avatar_url')
        .in('id', allProfileIds)
      for (const p of profs ?? []) {
        profileMap.set(p.id, {
          display_name: p.display_name,
          primary_position: p.primary_position,
          secondary_position: p.secondary_position,
          avatar_url: p.avatar_url,
        })
      }
    }

    // Merged, sorted
    const merged: Commitment[] = []
    const sortedRows = (commitRows ?? []).slice().sort((a, b) => String(a.sort_ts ?? '').localeCompare(String(b.sort_ts ?? '')))
    let rankCounter = 0
    for (const r of sortedRows) {
      rankCounter += 1
      if (r.commitment_type === 'player' && r.participant_id) {
        const info = profileMap.get(r.participant_id)
        if (!info) continue
        merged.push({
          kind: 'player',
          sort_ts: r.sort_ts ?? '',
          rank: rankCounter,
          profile_id: r.participant_id,
          display_name: info.display_name,
          primary_position: info.primary_position,
          secondary_position: info.secondary_position,
          avatar_url: info.avatar_url,
        })
      } else if (r.commitment_type === 'guest') {
        // Map guest commitment to guest row by id (exposed in v_match_commitments as of migration 0020)
        const guest = r.guest_id ? guestMdRows.find((g) => g.id === r.guest_id) : null
        if (!guest) continue
        merged.push({
          kind: 'guest',
          sort_ts: r.sort_ts ?? '',
          rank: rankCounter,
          guest_id: guest.id,
          display_name: guest.display_name,
          primary_position: guest.primary_position,
          secondary_position: guest.secondary_position,
          stamina: guest.stamina,
          accuracy: guest.accuracy,
          rating: guest.rating,
          description: guest.description,
          inviter_name: guest.inviter_id ? (profileMap.get(guest.inviter_id)?.display_name ?? null) : null,
        })
      }
    }

    // Team assignments (State 8) from match_players
    if (m.roster_locked_at) {
      // §3.19 Slice E — fetch matches.id so the Formation CTA can route.
      const { data: matchRow } = await supabase
        .from('matches')
        .select('id')
        .eq('matchday_id', m.id)
        .maybeSingle()
      setMatchId(matchRow?.id ?? null)
      const { data: mps } = await supabase
        .from('match_players')
        .select('profile_id, guest_id, team, is_captain')
        .in('profile_id', memberIds.length ? memberIds : ['00000000-0000-0000-0000-000000000000'])
      // Also load guest-side:
      const guestIds = guestMdRows.map((g) => g.id)
      let allMps = mps ?? []
      if (guestIds.length) {
        const { data: mpsG } = await supabase
          .from('match_players')
          .select('profile_id, guest_id, team, is_captain')
          .in('guest_id', guestIds)
        allMps = [...allMps, ...(mpsG ?? [])]
      }
      const mpMap = new Map<string, { team: TeamColor | null; is_captain: boolean | null }>()
      for (const r of allMps) {
        const key = r.profile_id ?? r.guest_id
        if (key) mpMap.set(key, { team: r.team, is_captain: r.is_captain })
      }
      for (const c of merged) {
        const key = c.profile_id ?? c.guest_id
        if (key) {
          const mp = mpMap.get(key)
          if (mp) { c.team = mp.team; c.is_captain = mp.is_captain ?? false }
        }
      }
    }

    setCommitments(merged)

    // Draft session (most recent in_progress or last completed)
    const { data: ds } = await supabase
      .from('draft_sessions')
      .select('status, current_picker_team, reason, started_at')
      .eq('matchday_id', m.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setDraft(ds as typeof draft)

    // Penalty copy from app_settings
    const { data: settings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'match_settings')
      .maybeSingle()
    if (settings?.value) {
      const v = settings.value as Record<string, number>
      setPenaltyCopy({
        after_lock: v.late_cancel_penalty_after_lock ?? -1,
        within_24h: v.late_cancel_penalty_within_24h ?? -1,
        ban_days: v.late_cancel_ban_days_within_24h ?? 7,
      })
    }

    // §3.15 — Reroll cutoff window (app_settings) + latest unactioned dropout_after_lock notif.
    const { data: cutoffRow } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'reroll_cutoff_hours_before_kickoff')
      .maybeSingle()
    if (cutoffRow?.value !== undefined && cutoffRow?.value !== null) {
      const parsed = Number(cutoffRow.value as unknown as string | number)
      if (Number.isFinite(parsed) && parsed > 0) setRerollCutoffHours(parsed)
    }

    if (profileId && m.roster_locked_at) {
      const { data: notifs } = await supabase
        .from('notifications')
        .select('id, created_at, payload')
        .eq('recipient_id', profileId)
        .eq('kind', 'dropout_after_lock')
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(5)
      // Client-side filter by payload.matchday_id (JSON-contains filter unreliable across envs)
      const mine = (notifs ?? []).find((n) => {
        const p = n.payload as { matchday_id?: string; outcome?: string } | null
        return p?.matchday_id === m.id && p?.outcome !== 'accepted'
      })
      if (mine) {
        const subId = (mine.payload as { substitute?: string } | null)?.substitute
        let subName: string | null = null
        if (subId) {
          const { data: subProf } = await supabase
            .from('profiles')
            .select('display_name')
            .eq('id', subId)
            .maybeSingle()
          subName = subProf?.display_name ?? null
        }
        setDropoutNotif({ id: mine.id, created_at: mine.created_at, substitute_name: subName })
      } else {
        setDropoutNotif(null)
      }
    } else {
      setDropoutNotif(null)
    }
  }, [profileId])

  useEffect(() => { void loadAll() }, [loadAll])

  /* Realtime — on any poll_vote/guest/matchday/draft change, reload. */
  useEffect(() => {
    if (!md || md === 'none') return
    const mdId = md.id
    const ch = supabase
      .channel(`poll-md-${mdId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes', filter: `matchday_id=eq.${mdId}` }, () => { void loadAll() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_guests', filter: `matchday_id=eq.${mdId}` }, () => { void loadAll() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matchdays', filter: `id=eq.${mdId}` }, () => { void loadAll() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_sessions', filter: `matchday_id=eq.${mdId}` }, () => { void loadAll() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_players' }, () => { void loadAll() })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [md, loadAll])

  /* Vote actions */
  const vote = async (choice: 'yes' | 'no' | 'maybe' | 'cancel') => {
    if (!md || md === 'none') return
    setBusy(true)
    setError(null)
    const { error: e } = await supabase.rpc('cast_poll_vote', { p_matchday_id: md.id, p_choice: choice })
    setBusy(false)
    if (e) { setError(e.message); return }
    await loadAll()
  }

  const cancelAttempt = async () => {
    if (!md || md === 'none') return
    const locked = !!md.roster_locked_at
    const within24 = hoursUntil(md.kickoff_at) < 24
    if (locked || within24) {
      setPenaltySheetOpen(true)
      return
    }
    await vote('cancel')
  }

  const confirmCancelWithPenalty = async () => {
    setPenaltySheetOpen(false)
    await vote('cancel')
  }

  /* §3.15 — Captain response to post-lock dropout. */
  const onAcceptSubstitute = async () => {
    if (!md || md === 'none') return
    setBusy(true); setError(null)
    const { error: e } = await supabase.rpc('accept_substitute', { p_matchday_id: md.id })
    setBusy(false)
    if (e) { setError(e.message); return }
    setDropoutNotif(null)
    await loadAll()
  }

  const onRequestReroll = async () => {
    if (!md || md === 'none') return
    setBusy(true); setError(null)
    const { error: e } = await supabase.rpc('request_reroll', { p_matchday_id: md.id })
    setBusy(false)
    setRerollConfirmOpen(false)
    if (e) { setError(e.message); return }
    setDropoutNotif(null)
    await loadAll()
  }

  if (md === null) {
    return (
      <section className="po-screen">
        <SkeletonPoll />
      </section>
    )
  }

  if (md === 'none') {
    return (
      <section className="po-screen">
        <div className="po-empty">
          <h2>No matchday scheduled</h2>
          <p>The next poll will post Monday.</p>
        </div>
      </section>
    )
  }

  /* ── Compute derived state ── */
  const now = Date.now()
  const pollOpen = now >= new Date(md.poll_opens_at).getTime() && now < new Date(md.poll_closes_at).getTime()
  const preOpen = now < new Date(md.poll_opens_at).getTime()
  const locked = !!md.roster_locked_at
  const confirmed = (commitments ?? []).filter((c) => c.rank <= rosterCap)
  const waitlist = (commitments ?? []).filter((c) => c.rank > rosterCap)
  const confirmedCount = confirmed.length
  const slotsOpen = confirmedCount < rosterCap
  const hoursToKick = hoursUntil(md.kickoff_at)
  const isWithin24h = hoursToKick < 24
  const guestUnlocked = slotsOpen && (locked || isWithin24h || hoursToKick < 48)
  const myRank = myVote && myVote.choice === 'yes' && !myVote.cancelled_at
    ? confirmed.find((c) => c.profile_id === profileId)?.rank ?? waitlist.find((c) => c.profile_id === profileId)?.rank ?? null
    : null
  const myConfirmed = myRank !== null && myRank <= rosterCap
  const myCommitment = myConfirmed ? confirmed.find((c) => c.profile_id === profileId) ?? null : null
  const myTeam = myCommitment?.team ?? null
  const iAmCaptain = !!myCommitment?.is_captain
  const draftInProgress = draft?.status === 'in_progress'
  const teamsRevealed = !draftInProgress && confirmed.some((c) => c.team)

  /* Partition for State 8 (two-team reveal) */
  const whiteList = confirmed.filter((c) => c.team === 'white')
  const blackList = confirmed.filter((c) => c.team === 'black')
  const unassigned = confirmed.filter((c) => !c.team)

  const statusCard = (() => {
    if (preOpen) {
      return (
        <div className="po-status po-status--preopen">
          <div className="po-status-title">Poll opens {fmtShort(md.poll_opens_at)}</div>
          <div className="po-status-sub">Matchday kicks off {fmtTime(md.kickoff_at)} · {fmtDdMon(md.kickoff_at)}</div>
        </div>
      )
    }
    if (!myVote || myVote.cancelled_at || myVote.choice !== 'yes') {
      if (locked) {
        return (
          <div className="po-status po-status--locked-nv">
            <div className="po-status-title">Roster locked</div>
            <div className="po-status-sub">Voting closed · kick-off {fmtTime(md.kickoff_at)}</div>
          </div>
        )
      }
      // Issue #2 — show explicit confirmation when the caller voted No or Maybe.
      // Previously this branch fell through to the "Will you play Thursday?" prompt
      // which made the click feel like a no-op. Now the chosen option is rendered
      // as the active state with a "Change my mind" affordance to re-open the row.
      const myChoice = myVote && !myVote.cancelled_at ? myVote.choice : null
      if (myChoice === 'no') {
        return (
          <div className="po-status po-status--no">
            <div className="po-status-title">You're sitting this one out</div>
            <div className="po-status-sub">Voted NO · {fmtShort(myVote!.committed_at)}</div>
            <button type="button" className="auth-btn auth-btn--sheet-cancel po-status-cancel" onClick={() => vote('cancel')} disabled={busy || !pollOpen}>
              Change my mind
            </button>
          </div>
        )
      }
      if (myChoice === 'maybe') {
        return (
          <div className="po-status po-status--maybe">
            <div className="po-status-title">You're a maybe</div>
            <div className="po-status-sub">Voted MAYBE · {fmtShort(myVote!.committed_at)}</div>
            <div className="po-vote-row">
              <button type="button" className="auth-btn auth-btn--approve" onClick={() => vote('yes')} disabled={busy || !pollOpen}>Confirm Yes</button>
              <button type="button" className="auth-btn auth-btn--reject" onClick={() => vote('no')} disabled={busy || !pollOpen}>Switch to No</button>
            </div>
          </div>
        )
      }
      return (
        <div className="po-status po-status--novote">
          <div className="po-status-title">Will you play Thursday?</div>
          <div className="po-vote-row">
            <button type="button" className="auth-btn auth-btn--approve" onClick={() => vote('yes')} disabled={busy || !pollOpen}>Yes</button>
            <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={() => vote('maybe')} disabled={busy || !pollOpen}>Maybe</button>
            <button type="button" className="auth-btn auth-btn--reject" onClick={() => vote('no')} disabled={busy || !pollOpen}>No</button>
          </div>
        </div>
      )
    }
    if (myConfirmed) {
      return (
        <div className={`po-status ${locked ? 'po-status--locked' : 'po-status--confirmed'}`}>
          <div className="po-status-badge">{myRank}</div>
          <div className="po-status-body">
            <div className="po-status-title">You're in — spot #{myRank} of {rosterCap}</div>
            <div className="po-status-sub">Voted YES · {fmtShort(myVote.committed_at)}</div>
            {myTeam && (
              <div className={`po-team-chip po-team-chip--${myTeam}`}>
                You're on {myTeam === 'white' ? '⚪ White' : '⚫ Black'}
              </div>
            )}
          </div>
          {!locked && (
            <button type="button" className="auth-btn auth-btn--reject po-status-cancel" onClick={cancelAttempt} disabled={busy}>Cancel</button>
          )}
        </div>
      )
    }
    // Waitlisted
    return (
      <div className="po-status po-status--waitlist">
        <div className="po-status-title">Waitlist #{(myRank ?? 0) - rosterCap}</div>
        <div className="po-status-sub">Promoted if anyone drops</div>
        <button type="button" className="auth-btn auth-btn--reject po-status-cancel" onClick={() => vote('cancel')} disabled={busy}>Cancel</button>
      </div>
    )
  })()

  /* Lock strip */
  const lockStrip = locked ? (
    <div className="po-lock-strip">
      <span className="po-lock-dot" aria-hidden />
      ROSTER LOCKED · Cancelling costs {penaltyCopy ? Math.abs(penaltyCopy.after_lock) : 1} pt{isWithin24h && penaltyCopy ? ` + ${penaltyCopy.ban_days}-day ban` : ''}
    </div>
  ) : null

  const guestStrip = guestUnlocked && !locked ? (
    <div className="po-guest-strip">
      {rosterCap - confirmedCount} {rosterCap - confirmedCount === 1 ? 'slot' : 'slots'} left — Bring a friend.
    </div>
  ) : null

  const draftStrip = draftInProgress && draft ? (
    <div className="po-draft-strip">
      <span className="po-draft-dot" aria-hidden />
      Draft in progress · {draft.current_picker_team === 'white' ? '⚪ WHITE' : draft.current_picker_team === 'black' ? '⚫ BLACK' : ''} picking
      {draft.reason === 'reroll_after_dropout' && <span className="po-draft-reroll"> · reroll</span>}
    </div>
  ) : null

  const renderRow = (c: Commitment) => {
    const isSelf = c.profile_id && c.profile_id === profileId
    const isGuestExpanded = c.guest_id && expandedGuest === c.guest_id
    return (
      <button
        type="button"
        key={(c.profile_id ?? c.guest_id) + ':' + c.rank}
        className={`po-row ${c.kind === 'guest' ? 'po-row--guest' : ''} ${isSelf ? 'po-row--me' : ''} ${c.team ? `po-row--team-${c.team}` : ''}`}
        onClick={() => {
          if (c.kind === 'player' && c.profile_id) navigate(`/profile?profile_id=${c.profile_id}`)
          else if (c.kind === 'guest' && c.guest_id) setExpandedGuest((v) => v === c.guest_id ? null : c.guest_id ?? null)
        }}
      >
        <span className="po-rank">{c.rank}</span>
        <Avatar name={c.display_name} url={c.avatar_url} guest={c.kind === 'guest'} self={!!isSelf} />
        <span className="po-name-block">
          <span className="po-name">
            {c.is_captain && <span className="po-captain">(C)</span>}
            {c.display_name}
            {isSelf && <span className="po-me-tag"> (ME)</span>}
            {c.kind === 'guest' && <GuestRatingChip rating={c.rating} />}
          </span>
          <PositionPills primary={c.primary_position} secondary={c.secondary_position} />
          {c.kind === 'guest' && (
            <span className="po-guest-sub">
              +1 · invited by {c.inviter_name ?? 'a player'}
            </span>
          )}
          {c.kind === 'guest' && c.description && isGuestExpanded && (
            <span className="po-guest-desc">"{c.description}"</span>
          )}
        </span>
        <span className="po-ts">{fmtShort(c.sort_ts)}</span>
      </button>
    )
  }

  return (
    <section className="po-screen">
      {error && <div className="po-error">{error}</div>}

      {/* Hero */}
      <header className="po-hero">
        <div className="po-hero-eyebrow">This Thursday</div>
        <h1 className="po-hero-date">{fmtDdMon(md.kickoff_at)}</h1>
        <div className="po-hero-meta">
          Kick-off {fmtTime(md.kickoff_at)}
          {md.venue && <> · 📍 {md.venue}</>}
        </div>
        <div className="po-hero-format">
          {rosterCap === 10 ? '5v5' : '7v7'}
          {md.friendly_flagged_at && !md.is_friendly && <span className="po-hero-flag"> · pending friendly review</span>}
          {md.is_friendly && <span className="po-hero-flag po-hero-flag--confirmed"> · Friendly</span>}
        </div>
      </header>

      {statusCard}
      {lockStrip}
      {draftStrip}
      {guestStrip}

      {/* §3.15 — Post-lock captain reroll card. Appears to captains when a dropout_after_lock
       * notification is unactioned for this matchday. After cutoff window (default 12h before
       * kickoff), the reroll option is withdrawn — captain can only Acknowledge the substitute. */}
      {dropoutNotif && iAmCaptain && locked && hoursToKick > 0 && (
        <div className="po-dropout-card">
          <div className="po-dropout-title">Dropout on the roster</div>
          <div className="po-dropout-body">
            {dropoutNotif.substitute_name
              ? `A player has cancelled. ${dropoutNotif.substitute_name} has been auto-promoted from the waitlist to fill the slot.`
              : 'A player has cancelled. The first waitlisted player has been auto-promoted.'}
          </div>
          {hoursToKick > rerollCutoffHours ? (
            <div className="po-dropout-actions">
              <button
                type="button"
                className="auth-btn auth-btn--approve"
                onClick={onAcceptSubstitute}
                disabled={busy}
              >Accept substitute</button>
              <button
                type="button"
                className="auth-btn auth-btn--reject"
                onClick={() => setRerollConfirmOpen(true)}
                disabled={busy}
              >Request reroll</button>
            </div>
          ) : (
            <>
              <div className="po-dropout-hint">Reroll window has closed ({rerollCutoffHours}h before kickoff).</div>
              <div className="po-dropout-actions">
                <button
                  type="button"
                  className="auth-btn auth-btn--approve"
                  onClick={onAcceptSubstitute}
                  disabled={busy}
                >Acknowledge</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Confirmed list — State 8 splits into two teams if teams revealed */}
      {teamsRevealed ? (
        <>
          <div className="po-team-header po-team-header--white">⚪ WHITE TEAM · {whiteList.length}</div>
          <div className="po-list">
            {whiteList.map(renderRow)}
            {whiteList.length === 0 && <div className="po-empty-row">No players assigned</div>}
          </div>
          <div className="po-team-header po-team-header--black">⚫ BLACK TEAM · {blackList.length}</div>
          <div className="po-list">
            {blackList.map(renderRow)}
            {blackList.length === 0 && <div className="po-empty-row">No players assigned</div>}
          </div>
          {unassigned.length > 0 && (
            <>
              <div className="po-team-header po-team-header--avail">Unassigned · {unassigned.length}</div>
              <div className="po-list">{unassigned.map(renderRow)}</div>
            </>
          )}
        </>
      ) : draftInProgress ? (
        <>
          <div className={`po-team-header po-team-header--white ${draft?.current_picker_team === 'white' ? 'po-team-header--active' : ''}`}>⚪ WHITE · {whiteList.length}</div>
          <div className="po-list">{whiteList.map(renderRow)}</div>
          <div className={`po-team-header po-team-header--black ${draft?.current_picker_team === 'black' ? 'po-team-header--active' : ''}`}>⚫ BLACK · {blackList.length}</div>
          <div className="po-list">{blackList.map(renderRow)}</div>
          <div className="po-team-header po-team-header--avail">Available · {unassigned.length}</div>
          <div className="po-list">{unassigned.map(renderRow)}</div>
        </>
      ) : (
        <>
          <div className="po-section-title">Confirmed · {confirmedCount} / {rosterCap}</div>
          {!locked && <div className="po-section-sub">Ordered by vote time</div>}
          <div className="po-list">
            {confirmed.length === 0 && <div className="po-empty-row">No confirmations yet</div>}
            {confirmed.map(renderRow)}
          </div>
        </>
      )}

      {waitlist.length > 0 && (
        <>
          <div className="po-section-title">Waitlist</div>
          <div className="po-list">
            {waitlist.map((c, i) => ({ ...c, rank: i + 1 })).map(renderRow)}
          </div>
        </>
      )}

      {/* CTAs */}
      <div className="po-cta-stack">
        {myConfirmed && !locked && (
          <button
            type="button"
            className="auth-btn auth-btn--approve"
            disabled={!guestUnlocked || busy}
            onClick={() => setGuestSheetOpen(true)}
          >
            Bring a +1
            {!guestUnlocked && <span className="po-cta-hint"> (unlocks 24h before)</span>}
          </button>
        )}
        {/* §3.19 Slice E — Formation CTA, State 8 only (teams revealed) */}
        {teamsRevealed && myTeam && matchId && (
          <button
            type="button"
            className="auth-btn auth-btn--approve"
            onClick={() => navigate(`/match/${matchId}/formation`)}
          >
            {iAmCaptain ? '🧩 Plan formation' : '🧩 View team formation'}
          </button>
        )}
      </div>

      {guestSheetOpen && (
        <GuestInviteSheet
          matchdayId={md.id}
          onClose={() => setGuestSheetOpen(false)}
          onDone={async () => { setGuestSheetOpen(false); await loadAll() }}
        />
      )}

      {penaltySheetOpen && penaltyCopy && (
        <PenaltySheet
          penaltyPts={isWithin24h ? penaltyCopy.within_24h : penaltyCopy.after_lock}
          banDays={isWithin24h ? penaltyCopy.ban_days : 0}
          onConfirm={confirmCancelWithPenalty}
          onKeep={() => setPenaltySheetOpen(false)}
          busy={busy}
        />
      )}

      {/* §3.15 — Reroll confirmation sub-sheet */}
      {rerollConfirmOpen && (
        <div className="sheet-overlay" role="dialog" aria-modal onClick={() => !busy && setRerollConfirmOpen(false)}>
          <div className="sheet-card po-dropout-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grabber" aria-hidden />
            <h3>Redraft teams?</h3>
            <p className="po-dropout-sheet-body">
              All non-captain slots will be redrawn from scratch. Current team assignments will be lost.
              This cannot be undone.
            </p>
            <div className="po-dropout-sheet-actions">
              <button
                type="button"
                className="auth-btn auth-btn--sheet-cancel"
                onClick={() => setRerollConfirmOpen(false)}
                disabled={busy}
              >Keep teams</button>
              <button
                type="button"
                className="auth-btn auth-btn--reject"
                onClick={onRequestReroll}
                disabled={busy}
              >Reroll now</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function SkeletonPoll() {
  return (
    <div className="po-skeleton">
      <div className="po-skeleton-hero" />
      <div className="po-skeleton-card" />
      {Array.from({ length: 6 }).map((_, i) => <div key={i} className="po-skeleton-row" />)}
    </div>
  )
}

function GuestInviteSheet({ matchdayId, onClose, onDone }: { matchdayId: string; onClose: () => void; onDone: () => void | Promise<void> }) {
  const [name, setName] = useState('')
  const [primary, setPrimary] = useState<PlayerPosition | ''>('')
  const [secondary, setSecondary] = useState<PlayerPosition | ''>('')
  const [stamina, setStamina] = useState<GuestTrait | ''>('')
  const [accuracy, setAccuracy] = useState<GuestTrait | ''>('')
  const [rating, setRating] = useState<GuestRating | ''>('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const canSubmit = name.trim().length > 0 && primary && stamina && accuracy && rating && !busy

  const submit = async () => {
    setErr(null)
    setBusy(true)
    const { error } = await supabase.rpc('invite_guest', {
      p_matchday_id: matchdayId,
      p_display_name: name.trim(),
      p_primary_position: primary as PlayerPosition,
      p_secondary_position: (secondary || null) as PlayerPosition,
      p_stamina: stamina as GuestTrait,
      p_accuracy: accuracy as GuestTrait,
      p_rating: rating as GuestRating,
      p_description: description.trim() || '',
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    await onDone()
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-modal onClick={onClose}>
      <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grabber" aria-hidden />
        <h3>Bring a +1</h3>

        <label className="admin-field">
          <span className="admin-field-label">Name (how to list)</span>
          <input className="auth-input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ayman" />
        </label>

        <div className="po-invite-group">
          <div className="po-invite-group-label">Primary position *</div>
          <div className="po-invite-chips">
            {POSITION_OPTIONS.map((p) => (
              <button key={p} type="button"
                className={`po-invite-chip ${primary === p ? 'po-invite-chip--on' : ''}`}
                onClick={() => setPrimary(p)}>{p}</button>
            ))}
          </div>
        </div>

        <div className="po-invite-group">
          <div className="po-invite-group-label">Secondary position</div>
          <div className="po-invite-chips">
            <button type="button" className={`po-invite-chip ${!secondary ? 'po-invite-chip--on' : ''}`} onClick={() => setSecondary('')}>—</button>
            {POSITION_OPTIONS.filter((p) => p !== primary).map((p) => (
              <button key={p} type="button"
                className={`po-invite-chip ${secondary === p ? 'po-invite-chip--on' : ''}`}
                onClick={() => setSecondary(p)}>{p}</button>
            ))}
          </div>
        </div>

        <div className="po-invite-group">
          <div className="po-invite-group-label">Stamina *</div>
          <div className="po-invite-chips">
            {TRAIT_OPTIONS.map((t) => (
              <button key={t} type="button"
                className={`po-invite-chip ${stamina === t ? 'po-invite-chip--on' : ''}`}
                onClick={() => setStamina(t)}>{t}</button>
            ))}
          </div>
        </div>

        <div className="po-invite-group">
          <div className="po-invite-group-label">Accuracy *</div>
          <div className="po-invite-chips">
            {TRAIT_OPTIONS.map((t) => (
              <button key={t} type="button"
                className={`po-invite-chip ${accuracy === t ? 'po-invite-chip--on' : ''}`}
                onClick={() => setAccuracy(t)}>{t}</button>
            ))}
          </div>
        </div>

        <div className="po-invite-group">
          <div className="po-invite-group-label">Rating *</div>
          <div className="po-invite-chips">
            {RATING_OPTIONS.map((r) => (
              <button key={r} type="button"
                className={`po-invite-chip po-invite-chip--${r} ${rating === r ? 'po-invite-chip--on' : ''}`}
                onClick={() => setRating(r)}>⭐{r}</button>
            ))}
          </div>
        </div>

        <label className="admin-field">
          <span className="admin-field-label">Description <span className="po-count">({description.length}/140)</span></span>
          <input className="auth-input" maxLength={140} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Friend from the office — target man." />
        </label>

        {err && <div className="auth-banner auth-banner--error">{err}</div>}

        <div className="sheet-actions">
          <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="auth-btn auth-btn--approve" onClick={submit} disabled={!canSubmit}>
            {busy ? 'Inviting…' : 'Invite'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PenaltySheet({ penaltyPts, banDays, onConfirm, onKeep, busy }: { penaltyPts: number; banDays: number; onConfirm: () => void | Promise<void>; onKeep: () => void; busy: boolean }) {
  return (
    <div className="sheet-overlay" role="dialog" aria-modal onClick={onKeep}>
      <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grabber" aria-hidden />
        <h3>Cancel your spot?</h3>
        <div className="po-penalty-pill">
          {penaltyPts} PT{banDays > 0 ? ` + ${banDays}-DAY BAN` : ''}
        </div>
        <p>
          Cancelling after the roster is locked costs {Math.abs(penaltyPts)} point{Math.abs(penaltyPts) === 1 ? '' : 's'} off your season tally.
          {banDays > 0 && ` Within 24 hours of kick-off you'll also be banned for ${banDays} days.`}
        </p>
        <div className="sheet-actions">
          <button type="button" className="auth-btn auth-btn--approve" onClick={onKeep} disabled={busy}>Keep my spot</button>
          <button type="button" className="auth-btn auth-btn--reject" onClick={() => { void onConfirm() }} disabled={busy}>
            {busy ? 'Cancelling…' : 'Confirm cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}
