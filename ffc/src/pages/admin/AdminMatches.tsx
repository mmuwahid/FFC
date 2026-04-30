import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Database, Json } from '../../lib/database.types'

/* §3.18 Admin Matches — full Depth-B (S025 slice).
 *
 * Surfaces:
 *   - Friendly-review pending card (kept from S024)
 *   - Segments: This week · Upcoming · Past
 *   - Create matchday sheet
 *   - Per-card state-aware actions (edit matchday, lock roster, enter result, approve, edit result)
 *
 * RPCs:
 *   create_matchday · update_matchday · lock_roster ·
 *   admin_submit_match_result · edit_match_result ·
 *   confirm_friendly_matchday · dismiss_friendly_flag
 */

type MatchFormat = Database['public']['Enums']['match_format']
type TeamColor = Database['public']['Enums']['team_color']
type MatchResult = Database['public']['Enums']['match_result']

type MatchdayRow = Database['public']['Tables']['matchdays']['Row']
type MatchRow = Pick<
  Database['public']['Tables']['matches']['Row'],
  'id' | 'matchday_id' | 'score_white' | 'score_black' | 'result' | 'motm_user_id' | 'motm_guest_id' | 'approved_at' | 'notes'
>
type ProfileLite = {
  id: string
  display_name: string
  primary_position: Database['public']['Enums']['player_position'] | null
  secondary_position: Database['public']['Enums']['player_position'] | null
  role: Database['public']['Enums']['user_role']
  is_active: boolean
}
type MatchPlayerRow = Database['public']['Tables']['match_players']['Row']

interface DraftInfo {
  id: string
  status: 'in_progress' | 'completed' | 'abandoned'
  current_picker_team: Database['public']['Enums']['team_color'] | null
  reason: Database['public']['Enums']['draft_reason'] | null
  started_at: string
  pick_count: number
  captain_name: string | null
}

type ActiveTokenInfo = {
  expires_at: string  // ISO timestamp
}

interface MatchdayWithMatch extends MatchdayRow {
  match?: MatchRow | null
  effective_format: MatchFormat
  draft?: DraftInfo | null
  activeToken?: ActiveTokenInfo  // present iff a non-consumed, non-expired ref_tokens row exists
  pendingEntryId?: string  // present iff a pending_match_entries row with status='pending' exists
}

type Segment = 'this_week' | 'upcoming' | 'past'

type Sheet =
  | { kind: 'create' }
  | { kind: 'edit_md'; md: MatchdayWithMatch }
  | { kind: 'lock'; md: MatchdayWithMatch }
  | { kind: 'unlock'; md: MatchdayWithMatch }
  | { kind: 'result'; md: MatchdayWithMatch; mode: 'create' }
  | { kind: 'result_edit'; md: MatchdayWithMatch; match: MatchRow }
  | { kind: 'confirm_friendly'; md: MatchdayWithMatch }
  | { kind: 'dismiss_friendly'; md: MatchdayWithMatch }
  | { kind: 'draft_force_complete'; md: MatchdayWithMatch }
  | { kind: 'draft_abandon'; md: MatchdayWithMatch }
  // S058 issue #21
  | { kind: 'delete_match'; md: MatchdayWithMatch; match: MatchRow }
  | { kind: 'edit_roster_post'; md: MatchdayWithMatch; match: MatchRow }
  | null

// ─── Helpers ───────────────────────────────────────────────────

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
}
function timeLabel(iso: string): string {
  // 12-hour format: "8:15pm"
  const s = new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return s.replace(' AM', 'am').replace(' PM', 'pm').replace(/\s/g, '')
}
function dowLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()
}
function fullLabel(iso: string): string {
  return `${dowLabel(iso)} · ${dateLabel(iso)} · ${timeLabel(iso)}`
}

function bucketize(md: MatchdayWithMatch): Segment {
  const now = Date.now()
  const ko = new Date(md.kickoff_at).getTime()
  const week = 7 * 24 * 60 * 60 * 1000
  if (ko < now - 3 * 60 * 60 * 1000) return 'past'
  if (ko <= now + week) return 'this_week'
  return 'upcoming'
}

function phaseLabel(md: MatchdayWithMatch): { text: string; tone: 'muted' | 'warn' | 'accent' | 'success' } {
  if (md.match?.approved_at) return { text: 'Final', tone: 'success' }
  if (md.match) return { text: 'Result pending approval', tone: 'warn' }
  if (md.draft?.status === 'in_progress') return { text: 'Phase 5.5 · Draft in progress', tone: 'warn' }
  if (md.roster_locked_at) return { text: 'Roster locked · enter result', tone: 'accent' }
  const now = Date.now()
  const ko = new Date(md.kickoff_at).getTime()
  if (ko < now) return { text: 'Past kickoff · enter result', tone: 'warn' }
  if (new Date(md.poll_closes_at).getTime() < now) return { text: 'Poll closed · lock roster', tone: 'warn' }
  if (new Date(md.poll_opens_at).getTime() < now) return { text: 'Poll open', tone: 'accent' }
  return { text: 'Scheduled', tone: 'muted' }
}

function formatDraftElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime()
  const mins = Math.max(0, Math.floor(ms / 60000))
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return `${hrs}h ${rem}m ago`
}

function formatExpiresIn(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return 'expired'
  const totalMin = Math.floor(ms / 60000)
  if (totalMin < 60) return `expires in ${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `expires in ${h}h ${m}m`
}

// ─── Match result × player goals sanity check (S026+) ────────────
// A saved result must have its team score equal the sum of individual
// player goals for that team. Example: WHITE 3-1 BLACK but only two white
// players have goals > 0 (totalling 2) → mismatch; must be blocked.
// Works for both the creation flow (admin_submit_match_result) and the
// post-approval edit flow (edit_match_result + edit_match_players).
interface TeamGoalRow { team: 'white' | 'black' | null; goals: number | null | undefined }

function validateScoreMatchesGoals(
  scoreWhite: number,
  scoreBlack: number,
  rows: TeamGoalRow[],
): { ok: boolean; messages: string[]; whiteSum: number; blackSum: number } {
  let whiteSum = 0
  let blackSum = 0
  for (const r of rows) {
    const g = r.goals ?? 0
    if (r.team === 'white') whiteSum += g
    else if (r.team === 'black') blackSum += g
  }
  const messages: string[] = []
  if (whiteSum !== scoreWhite) {
    messages.push(
      `WHITE team: scoreline shows ${scoreWhite} but players scored ${whiteSum}. Double-check match result or player stats.`,
    )
  }
  if (blackSum !== scoreBlack) {
    messages.push(
      `BLACK team: scoreline shows ${scoreBlack} but players scored ${blackSum}. Double-check match result or player stats.`,
    )
  }
  return { ok: messages.length === 0, messages, whiteSum, blackSum }
}

// ─── Component ─────────────────────────────────────────────────

export function AdminMatches() {
  const navigate = useNavigate()
  const [seg, setSeg] = useState<Segment>('this_week')
  const [matchdays, setMatchdays] = useState<MatchdayWithMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [sheetBusy, setSheetBusy] = useState(false)
  const [seasonId, setSeasonId] = useState<string | null>(null)
  const [seasonFormat, setSeasonFormat] = useState<MatchFormat>('7v7')
  const [toast, setToast] = useState<string | null>(null)
  const [refSheet, setRefSheet] = useState<{ matchday: MatchdayWithMatch; rawToken: string } | null>(null)
  const [mintBusy, setMintBusy] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [mdRes, matchesRes, seasonsRes, draftsRes, tokensRes, pendingRes] = await Promise.all([
      supabase.from('matchdays').select('*').order('kickoff_at', { ascending: false }).limit(60),
      supabase.from('matches').select('id, matchday_id, score_white, score_black, result, motm_user_id, motm_guest_id, approved_at, notes'),
      supabase.from('seasons').select('id, default_format, ended_at').is('ended_at', null).order('starts_on', { ascending: false }).limit(1),
      supabase.from('draft_sessions').select('id, matchday_id, status, current_picker_team, reason, started_at, triggered_by_profile_id').in('status', ['in_progress']),
      supabase.from('ref_tokens').select('matchday_id, expires_at').is('consumed_at', null).gt('expires_at', new Date().toISOString()),
      supabase.from('pending_match_entries').select('id, matchday_id').eq('status', 'pending').order('submitted_at', { ascending: false }),
    ])
    if (mdRes.error) setError(mdRes.error.message)
    if (matchesRes.error) setError(matchesRes.error.message)

    const matchByMd = new Map<string, MatchRow>()
    for (const m of (matchesRes.data ?? []) as MatchRow[]) matchByMd.set(m.matchday_id, m)

    // Active ref tokens per matchday (non-consumed, not yet expired)
    const tokensByMd = new Map<string, ActiveTokenInfo>()
    for (const t of (tokensRes.data ?? []) as { matchday_id: string; expires_at: string }[]) {
      tokensByMd.set(t.matchday_id, { expires_at: t.expires_at })
    }

    // Pending ref entries per matchday (status='pending'; one expected per matchday by RPC contract — order_by takes the latest if a duplicate ever appears).
    const pendingByMd = new Map<string, string>()
    for (const pe of (pendingRes.data ?? []) as { id: string; matchday_id: string }[]) {
      pendingByMd.set(pe.matchday_id, pe.id)
    }

    // Draft info per matchday (in-progress only)
    const draftByMd = new Map<string, DraftInfo>()
    const draftIds = (draftsRes.data ?? []).map((d) => d.id)
    const pickCountByDraft = new Map<string, number>()
    if (draftIds.length > 0) {
      const picksRes = await supabase.from('draft_picks').select('draft_session_id').in('draft_session_id', draftIds)
      for (const p of picksRes.data ?? []) {
        pickCountByDraft.set(p.draft_session_id, (pickCountByDraft.get(p.draft_session_id) ?? 0) + 1)
      }
    }
    const triggererIds = (draftsRes.data ?? []).map((d) => d.triggered_by_profile_id).filter((x): x is string => !!x)
    const triggererMap = new Map<string, string>()
    if (triggererIds.length > 0) {
      const profRes = await supabase.from('profiles').select('id, display_name').in('id', triggererIds)
      for (const p of profRes.data ?? []) triggererMap.set(p.id, p.display_name)
    }
    for (const d of draftsRes.data ?? []) {
      draftByMd.set(d.matchday_id, {
        id: d.id,
        status: d.status as 'in_progress',
        current_picker_team: d.current_picker_team,
        reason: d.reason,
        started_at: d.started_at,
        pick_count: pickCountByDraft.get(d.id) ?? 0,
        captain_name: d.triggered_by_profile_id ? (triggererMap.get(d.triggered_by_profile_id) ?? null) : null,
      })
    }

    const season = seasonsRes.data?.[0]
    if (season) {
      setSeasonId(season.id)
      setSeasonFormat((season.default_format as MatchFormat) ?? '7v7')
    }

    const enriched: MatchdayWithMatch[] = ((mdRes.data ?? []) as MatchdayRow[]).map((md) => ({
      ...md,
      match: matchByMd.get(md.id) ?? null,
      effective_format: md.format ?? (season?.default_format as MatchFormat) ?? '7v7',
      draft: draftByMd.get(md.id) ?? null,
      activeToken: tokensByMd.get(md.id),
      pendingEntryId: pendingByMd.get(md.id),
    }))
    setMatchdays(enriched)
    setLoading(false)
  }, [])

  useEffect(() => { void loadAll() }, [loadAll])

  const pendingFriendly = useMemo(
    () => matchdays.filter((md) => md.friendly_flagged_at && !md.is_friendly),
    [matchdays],
  )

  const byBucket = useMemo(() => {
    const b: Record<Segment, MatchdayWithMatch[]> = { this_week: [], upcoming: [], past: [] }
    for (const md of matchdays) b[bucketize(md)].push(md)
    return b
  }, [matchdays])

  const handleMintRefLink = async (md: MatchdayWithMatch) => {
    if (mintBusy) return
    setError(null)
    setMintBusy(md.id)
    try {
      const { data, error } = await supabase.rpc('regenerate_ref_token', { p_matchday_id: md.id })
      if (error) {
        setError(error.message)
        return
      }
      if (typeof data !== 'string' || data.length === 0) {
        setError('Unexpected empty token from regenerate_ref_token')
        return
      }
      setRefSheet({ matchday: md, rawToken: data })
      // Refresh activeToken view so the card chip flips to "expires in 6h 0m" once sheet closes.
      await loadAll()
    } finally {
      setMintBusy(null)
    }
  }

  return (
    <section className="admin-matches">
      <button type="button" className="admin-back" onClick={() => navigate('/admin')}>‹ Back</button>
      <header className="admin-players-top">
        <h1>Admin · Matches</h1>
        <button type="button" className="auth-btn auth-btn--approve admin-create-btn" onClick={() => setSheet({ kind: 'create' })}>
          + Create matchday
        </button>
      </header>

      {pendingFriendly.length > 0 && (
        <section className="admin-friendly-pending">
          <h2 className="admin-section-label">Pending friendly review</h2>
          {pendingFriendly.map((md) => (
            <div key={md.id} className="card admin-friendly-card">
              <div className="admin-friendly-head">
                <span className="admin-friendly-date">{dateLabel(md.kickoff_at)}</span>
                <span className="chip admin-friendly-chip">FRIENDLY?</span>
              </div>
              <div className="admin-friendly-actions">
                <button type="button" className="auth-btn auth-btn--reject-filled" onClick={() => setSheet({ kind: 'confirm_friendly', md })}>
                  Confirm friendly
                </button>
                <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={() => setSheet({ kind: 'dismiss_friendly', md })}>
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="admin-segments" role="tablist">
        {(['this_week', 'upcoming', 'past'] as Segment[]).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={seg === s}
            className={`admin-seg${seg === s ? ' admin-seg--active' : ''}`}
            onClick={() => setSeg(s)}
          >
            {s === 'this_week' ? 'This week' : s === 'upcoming' ? 'Upcoming' : 'Past'}
            <span className="admin-seg-count">{byBucket[s].length}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="auth-banner auth-banner--danger" role="alert" style={{ margin: '0 16px 12px' }}>
          <span className="auth-banner-icon" aria-hidden>!</span>
          <div>{error}</div>
        </div>
      )}

      {toast && (
        <div className="st-toast" role="alert" onAnimationEnd={() => setToast(null)}>
          {toast}
        </div>
      )}

      {loading ? (
        <div className="app-loading">Loading…</div>
      ) : byBucket[seg].length === 0 ? (
        <div className="admin-empty">
          <div className="admin-empty-icon" aria-hidden>∅</div>
          <h4>No matchdays</h4>
          <p>{seg === 'this_week' ? 'Nothing scheduled this week.' : seg === 'upcoming' ? 'No future matchdays queued.' : 'No past matchdays yet.'}</p>
        </div>
      ) : (
        <ul className="admin-md-list">
          {byBucket[seg].map((md) => (
            <MatchdayCard
              key={md.id}
              md={md}
              onEdit={() => setSheet({ kind: 'edit_md', md })}
              onLock={() => setSheet({ kind: 'lock', md })}
              onUnlock={() => setSheet({ kind: 'unlock', md })}
              onEnterResult={() => setSheet({ kind: 'result', md, mode: 'create' })}
              onEditResult={() => md.match && setSheet({ kind: 'result_edit', md, match: md.match })}
              onDraftForceComplete={() => setSheet({ kind: 'draft_force_complete', md })}
              onDraftAbandon={() => setSheet({ kind: 'draft_abandon', md })}
              onFormation={() => md.match && navigate(`/match/${md.match.id}/formation`)}
              onPickCaptains={() => navigate(`/matchday/${md.id}/captains`)}
              onMintRefLink={() => { void handleMintRefLink(md) }}
              mintBusy={mintBusy === md.id}
              onReviewPending={() => md.pendingEntryId && navigate(`/admin/match-entries/${md.pendingEntryId}`)}
              onEditRoster={() => md.match && setSheet({ kind: 'edit_roster_post', md, match: md.match })}
              onDeleteMatch={() => md.match && setSheet({ kind: 'delete_match', md, match: md.match })}
            />
          ))}
        </ul>
      )}

      {sheet && (
        <div className="sheet-overlay" role="dialog" aria-modal onClick={() => !sheetBusy && setSheet(null)}>
          <div className="sheet sheet--wide" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" aria-hidden />
            {sheet.kind === 'create' && seasonId && (
              <CreateMatchdaySheet
                seasonId={seasonId}
                seasonDefaultFormat={seasonFormat}
                busy={sheetBusy}
                setBusy={setSheetBusy}
                onDone={async () => { setSheet(null); await loadAll() }}
                onError={setError}
                onCancel={() => !sheetBusy && setSheet(null)}
              />
            )}
            {sheet.kind === 'edit_md' && (
              <EditMatchdaySheet
                md={sheet.md}
                seasonDefaultFormat={seasonFormat}
                busy={sheetBusy}
                setBusy={setSheetBusy}
                onDone={async () => { setSheet(null); await loadAll() }}
                onError={setError}
                onCancel={() => !sheetBusy && setSheet(null)}
              />
            )}
            {sheet.kind === 'lock' && (
              <SimpleConfirmSheet
                title={`Lock roster — ${dateLabel(sheet.md.kickoff_at)}`}
                body="After locking, no more votes can be added. You can still edit the result."
                confirmLabel="Confirm lock"
                busy={sheetBusy}
                onConfirm={async () => {
                  setSheetBusy(true)
                  const { error } = await supabase.rpc('lock_roster', { p_matchday_id: sheet.md.id })
                  setSheetBusy(false)
                  if (error) { setError(error.message); return }
                  setSheet(null)
                  await loadAll()
                }}
                onCancel={() => !sheetBusy && setSheet(null)}
              />
            )}
            {sheet.kind === 'unlock' && (
              <SimpleConfirmSheet
                title={`Unlock roster — ${dateLabel(sheet.md.kickoff_at)}`}
                body="This reopens the roster so you can edit the formation. Re-lock when ready. Blocked if a ref entry is already pending review."
                confirmLabel="Unlock"
                busy={sheetBusy}
                onConfirm={async () => {
                  setSheetBusy(true)
                  const { error } = await supabase.rpc('unlock_roster', { p_matchday_id: sheet.md.id })
                  setSheetBusy(false)
                  if (error) { setError(error.message); return }
                  setSheet(null)
                  await loadAll()
                }}
                onCancel={() => !sheetBusy && setSheet(null)}
              />
            )}
            {sheet.kind === 'result' && (
              <ResultEntrySheet
                md={sheet.md}
                busy={sheetBusy}
                setBusy={setSheetBusy}
                onDone={async () => { setSheet(null); await loadAll() }}
                onError={setError}
                onToast={setToast}
                onCancel={() => !sheetBusy && setSheet(null)}
              />
            )}
            {sheet.kind === 'result_edit' && (
              <ResultEditSheet
                md={sheet.md}
                match={sheet.match}
                busy={sheetBusy}
                setBusy={setSheetBusy}
                onDone={async () => { setSheet(null); await loadAll() }}
                onError={setError}
                onToast={setToast}
                onCancel={() => !sheetBusy && setSheet(null)}
              />
            )}
            {sheet.kind === 'confirm_friendly' && (
              <SimpleConfirmSheet
                title="Confirm friendly"
                body="This matchday will be marked friendly and excluded from the season leaderboard."
                confirmLabel="Confirm"
                busy={sheetBusy}
                onConfirm={async () => {
                  setSheetBusy(true)
                  const { error } = await supabase.rpc('confirm_friendly_matchday', { p_matchday_id: sheet.md.id })
                  setSheetBusy(false)
                  if (error) { setError(error.message); return }
                  setSheet(null)
                  await loadAll()
                }}
                onCancel={() => !sheetBusy && setSheet(null)}
              />
            )}
            {sheet.kind === 'dismiss_friendly' && (
              <SimpleConfirmSheet
                title="Dismiss friendly flag"
                body="Keep this matchday as a regular ranked game."
                confirmLabel="Dismiss"
                busy={sheetBusy}
                onConfirm={async () => {
                  setSheetBusy(true)
                  const { error } = await supabase.rpc('dismiss_friendly_flag', { p_matchday_id: sheet.md.id })
                  setSheetBusy(false)
                  if (error) { setError(error.message); return }
                  setSheet(null)
                  await loadAll()
                }}
                onCancel={() => !sheetBusy && setSheet(null)}
              />
            )}
            {sheet.kind === 'draft_force_complete' && (
              <SimpleConfirmSheet
                title="Force-complete draft"
                body="Auto-assigns any remaining unpicked players to alternating teams (starting with the current picker) and marks the draft completed. This is audited and cannot be undone — use only if the captain draft is genuinely stuck."
                confirmLabel="Force complete"
                busy={sheetBusy}
                onConfirm={async () => {
                  setSheetBusy(true)
                  const { error } = await supabase.rpc('admin_draft_force_complete', { p_matchday_id: sheet.md.id })
                  setSheetBusy(false)
                  if (error) { setError(error.message); return }
                  setSheet(null)
                  setToast('Draft force-completed')
                  await loadAll()
                }}
                onCancel={() => !sheetBusy && setSheet(null)}
              />
            )}
            {sheet.kind === 'draft_abandon' && (
              <SimpleConfirmSheet
                title="Abandon draft"
                body="Marks the draft abandoned so admins can restart via a fresh captain-draft flow. Existing picks are preserved in the audit log. This action is audited."
                confirmLabel="Abandon draft"
                busy={sheetBusy}
                onConfirm={async () => {
                  setSheetBusy(true)
                  const { error } = await supabase.rpc('admin_draft_abandon', { p_matchday_id: sheet.md.id })
                  setSheetBusy(false)
                  if (error) { setError(error.message); return }
                  setSheet(null)
                  setToast('Draft abandoned')
                  await loadAll()
                }}
                onCancel={() => !sheetBusy && setSheet(null)}
              />
            )}
            {sheet.kind === 'delete_match' && (
              <DeleteMatchSheet
                md={sheet.md}
                match={sheet.match}
                busy={sheetBusy}
                setBusy={setSheetBusy}
                onDone={async () => { setSheet(null); setToast('Match deleted'); await loadAll() }}
                onError={setError}
                onCancel={() => !sheetBusy && setSheet(null)}
              />
            )}
            {sheet.kind === 'edit_roster_post' && (
              <EditRosterPostSheet
                md={sheet.md}
                match={sheet.match}
                busy={sheetBusy}
                setBusy={setSheetBusy}
                onDone={async () => { setSheet(null); setToast('Roster updated'); await loadAll() }}
                onError={setError}
                onCancel={() => !sheetBusy && setSheet(null)}
              />
            )}
          </div>
        </div>
      )}

      {refSheet && (
        <RefLinkSheet
          matchday={refSheet.matchday}
          rawToken={refSheet.rawToken}
          onClose={() => setRefSheet(null)}
          onCopy={() => {
            setToast('Link copied to clipboard')
            // Don't close the sheet on copy — admin may want to share to WhatsApp too.
          }}
        />
      )}
    </section>
  )
}

// ─── Matchday card ─────────────────────────────────────────────

function MatchdayCard({
  md, onEdit, onLock, onUnlock, onEnterResult, onEditResult, onDraftForceComplete, onDraftAbandon, onFormation, onPickCaptains, onMintRefLink, mintBusy, onReviewPending, onEditRoster, onDeleteMatch,
}: {
  md: MatchdayWithMatch
  onEdit: () => void
  onLock: () => void
  onUnlock: () => void
  onEnterResult: () => void
  onEditResult: () => void
  onDraftForceComplete: () => void
  onDraftAbandon: () => void
  onFormation: () => void
  onPickCaptains: () => void
  onMintRefLink: () => void
  mintBusy: boolean
  onReviewPending: () => void
  onEditRoster: () => void
  onDeleteMatch: () => void
}) {
  const phase = phaseLabel(md)
  const hasResult = !!md.match
  const approved = !!md.match?.approved_at
  const locked = !!md.roster_locked_at
  const isFriendly = md.is_friendly
  const isPast = new Date(md.kickoff_at).getTime() < Date.now()

  return (
    <li className={`admin-md-card${approved ? ' admin-md-card--final' : ''}`}>
      <div className="admin-md-head">
        <div className="admin-md-head-main">
          <span className="admin-md-date">{dowLabel(md.kickoff_at)} · {dateLabel(md.kickoff_at)}</span>
          <span className="admin-md-time">· {timeLabel(md.kickoff_at)}</span>
          {md.venue && <span className="admin-md-venue">· {md.venue}</span>}
        </div>
        <div className="admin-md-head-chips">
          <span className={`admin-md-fmt admin-md-fmt--${md.effective_format}`}>{md.effective_format}</span>
          {isFriendly && <span className="chip chip-friendly">friendly</span>}
        </div>
      </div>

      <div className={`admin-md-phase admin-md-phase--${phase.tone}`}>{phase.text}</div>

      {hasResult && md.match && (
        <div className="admin-md-result">
          <div className="admin-md-score">
            <span className="admin-md-score-white">⚪ WHITE {md.match.score_white}</span>
            <span className="admin-md-score-sep">–</span>
            <span className="admin-md-score-black">{md.match.score_black} BLACK ⚫</span>
          </div>
          {md.match.result && <span className={`admin-md-result-chip admin-md-result-chip--${md.match.result}`}>{resultLabel(md.match.result)}</span>}
        </div>
      )}

      <div className="admin-md-poll-meta">
        Poll: {fullLabel(md.poll_opens_at)} → {fullLabel(md.poll_closes_at)}
        {locked && <span className="admin-md-lock"> · 🔒 locked {dateLabel(md.roster_locked_at!)}</span>}
      </div>

      {md.draft?.status === 'in_progress' && (
        <DraftInProgressCard
          draft={md.draft}
          effectiveFormat={md.effective_format}
          onForceComplete={onDraftForceComplete}
          onAbandon={onDraftAbandon}
        />
      )}

      {md.pendingEntryId && !md.match?.approved_at && (
        <div className="admin-md-pending-review" role="region" aria-label="Pending ref entry">
          <span className="admin-md-pending-label">⏳ Ref entry awaiting review</span>
          <button type="button" className="auth-btn auth-btn--approve admin-md-pending-cta" onClick={onReviewPending}>
            Review →
          </button>
        </div>
      )}

      <div className="admin-md-actions">
        {!hasResult && !approved && (
          <>
            <button type="button" className="auth-btn auth-btn--sheet-cancel admin-md-btn" onClick={onEdit}>
              Edit matchday
            </button>
            {!locked && (
              <button type="button" className="auth-btn auth-btn--sheet-cancel admin-md-btn" onClick={onLock}>
                Lock roster
              </button>
            )}
            {locked && !approved && (
              <button type="button" className="auth-btn auth-btn--sheet-cancel admin-md-btn" onClick={onUnlock}>
                🔓 Unlock roster
              </button>
            )}
            {isPast && (
              <button type="button" className="auth-btn auth-btn--approve admin-md-btn" onClick={onEnterResult}>
                Enter result
              </button>
            )}
          </>
        )}
        {hasResult && (
          <button type="button" className="auth-btn auth-btn--approve admin-md-btn" onClick={onEditResult}>
            {approved ? 'Edit result' : 'Review / approve'}
          </button>
        )}
        {/* §3.19 Slice E — Formation link. Available once a match row exists. */}
        {md.match && (
          <button type="button" className="auth-btn auth-btn--sheet-cancel admin-md-btn" onClick={onFormation}>
            🧩 Formation
          </button>
        )}
        {/* §3.1-v2 Slice A — Pick captains. Available once roster is locked. */}
        {locked && md.match && (
          <button type="button" className="auth-btn auth-btn--sheet-cancel admin-md-btn" onClick={onPickCaptains}>
            👔 Pick captains
          </button>
        )}
        {/* S058 issue #21 — admin match management on approved matches.
         * Edit roster (post-match) + Delete match (red, type-DELETE confirm). */}
        {approved && md.match && (
          <>
            <button type="button" className="auth-btn auth-btn--sheet-cancel admin-md-btn" onClick={onEditRoster}>
              👥 Edit roster
            </button>
            <button type="button" className="auth-btn auth-btn--reject-filled admin-md-btn" onClick={onDeleteMatch}>
              🗑 Delete match
            </button>
          </>
        )}
      </div>

      {/* §3.4-v2 Slice 2B-B — Ref link section. Available once roster is locked. */}
      {locked && (
        <div className="admin-ref-link">
          {md.activeToken ? (
            <button
              type="button"
              className="admin-ref-link-active"
              onClick={onMintRefLink}
              disabled={mintBusy}
              title="Regenerate ref link (burns the previous one)"
            >
              <span className="admin-ref-link-label">Ref link</span>
              <span className="admin-ref-link-expiry">· {formatExpiresIn(md.activeToken.expires_at)}</span>
              <span className="admin-ref-link-regen" aria-hidden>🔄</span>
            </button>
          ) : (
            <button
              type="button"
              className="admin-ref-link-generate"
              onClick={onMintRefLink}
              disabled={mintBusy}
            >
              + Generate ref link
            </button>
          )}
        </div>
      )}
    </li>
  )
}

// ─── Ref-link sheet (Slice 2B-B) ──────────────────────────────────
// Receives the raw token from regenerate_ref_token RPC return value.
// The plaintext token is one-shot — Postgres only stores sha256(token).
// Once this sheet closes, the URL is gone forever (must regenerate to share again).
function RefLinkSheet({
  matchday,
  rawToken,
  onClose,
  onCopy,
}: {
  matchday: MatchdayWithMatch
  rawToken: string
  onClose: () => void
  onCopy: () => void
}) {
  const url = `${window.location.origin}/ref/${rawToken}`
  const matchdayLabel = `${dateLabel(matchday.kickoff_at)}`
  const whatsappMessage = `FFC ref link for Matchday ${matchdayLabel}: ${url}  Expires in 6h.`
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(whatsappMessage)}`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      onCopy()
    } catch {
      // Fallback: select the input so the user can long-press / Ctrl+C
      document.getElementById('admin-ref-link-input')?.focus()
    }
  }

  return createPortal(
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet admin-ref-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden />
        <h3>Ref link ready</h3>
        <p className="admin-ref-sheet-copy">
          Share this link with the ref. It works for one submission and expires in 6&nbsp;h.
          <br />
          <strong>Shown once</strong> — regenerate to share again.
        </p>
        <input
          id="admin-ref-link-input"
          className="admin-ref-link-url"
          type="text"
          value={url}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="admin-ref-sheet-actions">
          <button
            type="button"
            className="auth-btn auth-btn--approve"
            onClick={() => { void handleCopy() }}
          >
            📋 Copy link
          </button>
          <a
            className="auth-btn auth-btn--sheet-cancel"
            href={whatsappHref}
            target="_blank"
            rel="noreferrer noopener"
          >
            💬 Share to WhatsApp
          </a>
        </div>
        <button
          type="button"
          className="auth-btn auth-btn--sheet-cancel admin-ref-sheet-done"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>,
    document.body
  )
}

function resultLabel(r: MatchResult): string {
  if (r === 'win_white') return 'W wins'
  if (r === 'win_black') return 'B wins'
  return 'Draw'
}

// ─── Phase 5.5 · Draft in progress (S026) ─────────────────────────
function DraftInProgressCard({
  draft, effectiveFormat, onForceComplete, onAbandon,
}: {
  draft: DraftInfo
  effectiveFormat: MatchFormat
  onForceComplete: () => void
  onAbandon: () => void
}) {
  const cap = effectiveFormat === '5v5' ? 10 : 14
  const stuckThresholdHours = 6
  const elapsedHours = (Date.now() - new Date(draft.started_at).getTime()) / (1000 * 60 * 60)
  const stuck = elapsedHours > stuckThresholdHours
  const pickerLabel =
    draft.current_picker_team === 'white' ? '⚪ WHITE picking'
    : draft.current_picker_team === 'black' ? '⚫ BLACK picking'
    : '— awaiting first pick —'

  return (
    <div className="admin-draft-card">
      <div className="admin-draft-head">
        <span className="admin-draft-dot" aria-hidden />
        <span className="admin-draft-title">Draft in progress</span>
        <span className="admin-draft-elapsed">{formatDraftElapsed(draft.started_at)}</span>
      </div>
      <div className="admin-draft-meta">
        Pick {draft.pick_count} of {cap} · {pickerLabel}
        {draft.captain_name && <> · started by {draft.captain_name}</>}
      </div>
      {draft.reason === 'reroll_after_dropout' && (
        <div className="admin-draft-reroll">
          ⚠ Reroll in progress after dropout
        </div>
      )}
      {stuck && (
        <div className="admin-draft-override">
          <div className="admin-draft-override-hint">
            Draft has been open {Math.floor(elapsedHours)}h — override if stuck:
          </div>
          <div className="admin-draft-override-actions">
            <button
              type="button"
              className="auth-btn auth-btn--sheet-cancel admin-md-btn"
              onClick={onForceComplete}
            >
              Force complete
            </button>
            <button
              type="button"
              className="auth-btn auth-btn--reject admin-md-btn"
              onClick={onAbandon}
            >
              Abandon draft
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sheets ────────────────────────────────────────────────────

interface BaseSheetProps {
  busy: boolean
  setBusy: (b: boolean) => void
  onDone: () => void | Promise<void>
  onError: (msg: string) => void
  onToast?: (msg: string) => void
  onCancel: () => void
}

function toLocalInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const tzoff = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - tzoff).toISOString().slice(0, 16)
}

function fromLocalInput(local: string): string {
  // Interpret as local time → ISO.
  return new Date(local).toISOString()
}

function CreateMatchdaySheet({
  seasonId, seasonDefaultFormat, busy, setBusy, onDone, onError, onCancel,
}: BaseSheetProps & { seasonId: string; seasonDefaultFormat: MatchFormat }) {
  const nextThu = (() => {
    const d = new Date()
    d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7 || 7))
    d.setHours(20, 15, 0, 0)
    return d
  })()
  const initKickoff = toLocalInput(nextThu.toISOString())
  const initOpens = (() => { const d = new Date(nextThu); d.setDate(d.getDate() - 3); d.setHours(9, 0, 0, 0); return toLocalInput(d.toISOString()) })()
  const initCloses = (() => { const d = new Date(nextThu); d.setDate(d.getDate() - 1); d.setHours(21, 0, 0, 0); return toLocalInput(d.toISOString()) })()

  // Confirmed = what gets submitted + drives auto-derive. Draft = live picker value.
  const [kickoff, setKickoff] = useState(initKickoff)
  const [kickoffDraft, setKickoffDraft] = useState(initKickoff)
  const [venue, setVenue] = useState('')
  const [pollOpens, setPollOpens] = useState(initOpens)
  const [pollOpensDraft, setPollOpensDraft] = useState(initOpens)
  const [pollCloses, setPollCloses] = useState(initCloses)
  const [pollClosesDraft, setPollClosesDraft] = useState(initCloses)
  const [format, setFormat] = useState<MatchFormat>(seasonDefaultFormat || '7v7')

  // Auto-derive poll windows when kickoff is confirmed (issue #19)
  useEffect(() => {
    if (!kickoff) return
    const [datePart] = kickoff.split('T')
    if (!datePart || datePart.length < 10) return
    const [y, m, d] = datePart.split('-').map(Number)
    if (!y || !m || !d) return
    const opensLocal = new Date(y, m - 1, d - 3)
    opensLocal.setHours(9, 0, 0, 0)
    const closesLocal = new Date(y, m - 1, d - 1)
    closesLocal.setHours(21, 0, 0, 0)
    const opensVal = toLocalInput(opensLocal.toISOString())
    const closesVal = toLocalInput(closesLocal.toISOString())
    setPollOpens(opensVal); setPollOpensDraft(opensVal)
    setPollCloses(closesVal); setPollClosesDraft(closesVal)
  }, [kickoff])

  const isThursday = (() => {
    if (!kickoff) return true
    const [datePart] = kickoff.split('T')
    if (!datePart) return true
    return new Date(datePart + 'T12:00').getDay() === 4
  })()

  const submit = async () => {
    if (!kickoff || !pollOpens || !pollCloses) { onError('All dates required.'); return }
    setBusy(true)
    const args: Database['public']['Functions']['create_matchday']['Args'] = {
      p_season_id: seasonId,
      p_kickoff_at: fromLocalInput(kickoff),
      p_venue: venue.trim(),
      p_poll_opens_at: fromLocalInput(pollOpens),
      p_poll_closes_at: fromLocalInput(pollCloses),
      p_format: format,
    }
    const { error } = await supabase.rpc('create_matchday', args)
    setBusy(false)
    if (error) { onError(error.message); return }
    await onDone()
  }

  const preview = (local: string) => local ? fullLabel(fromLocalInput(local)) : '—'

  return (
    <>
      <h3>Create matchday</h3>
      <p className="sheet-sub">Season default format: {seasonDefaultFormat}.</p>

      {!isThursday && (
        <p className="admin-warn-banner">Not a Thursday — double-check the date.</p>
      )}

      <div className="admin-field">
        <span className="admin-field-label">Kickoff</span>
        <div className="admin-dt-row">
          <input type="datetime-local" className="auth-input" value={kickoffDraft} onChange={(e) => setKickoffDraft(e.target.value)} />
          <button type="button" className={`admin-dt-set-btn${kickoffDraft !== kickoff ? ' admin-dt-set-btn--pending' : ''}`} onClick={() => setKickoff(kickoffDraft)}>Set ✓</button>
        </div>
        <span className="admin-dt-preview">{preview(kickoffDraft)}</span>
      </div>

      <label className="admin-field">
        <span className="admin-field-label">Venue</span>
        <input className="auth-input" placeholder="e.g. Al Wasl Sports Club" value={venue} onChange={(e) => setVenue(e.target.value)} />
      </label>

      <div className="admin-field">
        <span className="admin-field-label">Poll opens</span>
        <div className="admin-dt-row">
          <input type="datetime-local" className="auth-input" value={pollOpensDraft} onChange={(e) => setPollOpensDraft(e.target.value)} />
          <button type="button" className={`admin-dt-set-btn${pollOpensDraft !== pollOpens ? ' admin-dt-set-btn--pending' : ''}`} onClick={() => setPollOpens(pollOpensDraft)}>Set ✓</button>
        </div>
        <span className="admin-dt-preview">{preview(pollOpensDraft)}</span>
      </div>

      <div className="admin-field">
        <span className="admin-field-label">Poll closes</span>
        <div className="admin-dt-row">
          <input type="datetime-local" className="auth-input" value={pollClosesDraft} onChange={(e) => setPollClosesDraft(e.target.value)} />
          <button type="button" className={`admin-dt-set-btn${pollClosesDraft !== pollCloses ? ' admin-dt-set-btn--pending' : ''}`} onClick={() => setPollCloses(pollClosesDraft)}>Set ✓</button>
        </div>
        <span className="admin-dt-preview">{preview(pollClosesDraft)}</span>
      </div>

      <div className="admin-field">
        <span className="admin-field-label">Format</span>
        <div className="admin-chip-row">
          <button type="button" className={`admin-chip${format === '7v7' ? ' admin-chip--on' : ''}`} onClick={() => setFormat('7v7')}>7v7</button>
          <button type="button" className={`admin-chip${format === '5v5' ? ' admin-chip--on' : ''}`} onClick={() => setFormat('5v5')}>5v5</button>
        </div>
      </div>

      <div className="sheet-actions">
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="auth-btn auth-btn--approve" onClick={submit} disabled={busy}>
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
    </>
  )
}

function EditMatchdaySheet({
  md, seasonDefaultFormat, busy, setBusy, onDone, onError, onCancel,
}: BaseSheetProps & { md: MatchdayWithMatch; seasonDefaultFormat: MatchFormat }) {
  const initKickoff = toLocalInput(md.kickoff_at)
  const initOpens = toLocalInput(md.poll_opens_at)
  const initCloses = toLocalInput(md.poll_closes_at)

  const [kickoff, setKickoff] = useState(initKickoff)
  const [kickoffDraft, setKickoffDraft] = useState(initKickoff)
  const [venue, setVenue] = useState(md.venue ?? '')
  const [pollOpens, setPollOpens] = useState(initOpens)
  const [pollOpensDraft, setPollOpensDraft] = useState(initOpens)
  const [pollCloses, setPollCloses] = useState(initCloses)
  const [pollClosesDraft, setPollClosesDraft] = useState(initCloses)
  const [format, setFormat] = useState<MatchFormat>((md.format ?? seasonDefaultFormat) || '7v7')

  const submit = async () => {
    setBusy(true)
    const args: Database['public']['Functions']['update_matchday']['Args'] = {
      p_matchday_id: md.id,
      p_kickoff_at: fromLocalInput(kickoff),
      p_poll_opens_at: fromLocalInput(pollOpens),
      p_poll_closes_at: fromLocalInput(pollCloses),
      p_venue: venue.trim() || undefined,
      p_venue_explicit_null: venue.trim() === '',
      p_format: format,
    }
    const { error } = await supabase.rpc('update_matchday', args)
    setBusy(false)
    if (error) { onError(error.message); return }
    await onDone()
  }

  const preview = (local: string) => local ? fullLabel(fromLocalInput(local)) : '—'

  return (
    <>
      <h3>Edit matchday — {dowLabel(md.kickoff_at)} · {dateLabel(md.kickoff_at)}</h3>
      <p className="sheet-sub">Season default: {seasonDefaultFormat}.</p>

      <div className="admin-field">
        <span className="admin-field-label">Kickoff</span>
        <div className="admin-dt-row">
          <input type="datetime-local" className="auth-input" value={kickoffDraft} onChange={(e) => setKickoffDraft(e.target.value)} />
          <button type="button" className={`admin-dt-set-btn${kickoffDraft !== kickoff ? ' admin-dt-set-btn--pending' : ''}`} onClick={() => setKickoff(kickoffDraft)}>Set ✓</button>
        </div>
        <span className="admin-dt-preview">{preview(kickoffDraft)}</span>
      </div>
      <label className="admin-field"><span className="admin-field-label">Venue</span>
        <input className="auth-input" value={venue} onChange={(e) => setVenue(e.target.value)} /></label>
      <div className="admin-field">
        <span className="admin-field-label">Poll opens</span>
        <div className="admin-dt-row">
          <input type="datetime-local" className="auth-input" value={pollOpensDraft} onChange={(e) => setPollOpensDraft(e.target.value)} />
          <button type="button" className={`admin-dt-set-btn${pollOpensDraft !== pollOpens ? ' admin-dt-set-btn--pending' : ''}`} onClick={() => setPollOpens(pollOpensDraft)}>Set ✓</button>
        </div>
        <span className="admin-dt-preview">{preview(pollOpensDraft)}</span>
      </div>
      <div className="admin-field">
        <span className="admin-field-label">Poll closes</span>
        <div className="admin-dt-row">
          <input type="datetime-local" className="auth-input" value={pollClosesDraft} onChange={(e) => setPollClosesDraft(e.target.value)} />
          <button type="button" className={`admin-dt-set-btn${pollClosesDraft !== pollCloses ? ' admin-dt-set-btn--pending' : ''}`} onClick={() => setPollCloses(pollClosesDraft)}>Set ✓</button>
        </div>
        <span className="admin-dt-preview">{preview(pollClosesDraft)}</span>
      </div>

      <div className="admin-field">
        <span className="admin-field-label">Format</span>
        <div className="admin-chip-row">
          <button type="button" className={`admin-chip${format === '7v7' ? ' admin-chip--on' : ''}`} onClick={() => setFormat('7v7')}>7v7</button>
          <button type="button" className={`admin-chip${format === '5v5' ? ' admin-chip--on' : ''}`} onClick={() => setFormat('5v5')}>5v5</button>
        </div>
      </div>

      <div className="sheet-actions">
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="auth-btn auth-btn--approve" onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </>
  )
}

// ─── Result entry ──────────────────────────────────────────────

interface ResultRow {
  profile_id?: string
  guest_id?: string
  display_name: string
  team: TeamColor
  is_captain: boolean
  goals: number
  yellow_cards: number
  red_cards: number
  is_no_show: boolean
}

function ResultEntrySheet({
  md, busy, setBusy, onDone, onError, onToast, onCancel,
}: BaseSheetProps & { md: MatchdayWithMatch }) {
  const [scoreWhite, setScoreWhite] = useState(0)
  const [scoreBlack, setScoreBlack] = useState(0)
  const [motm, setMotm] = useState<string>('')
  const [rows, setRows] = useState<ResultRow[]>([])
  const [notes, setNotes] = useState('')
  const [approve, setApprove] = useState(true)
  const [availablePlayers, setAvailablePlayers] = useState<ProfileLite[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [pickerTeam, setPickerTeam] = useState<TeamColor>('white')
  // S058 issue #21 — search filter on the roster-add picker.
  const [pickerSearch, setPickerSearch] = useState('')

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, display_name, primary_position, secondary_position, role, is_active')
      .in('role', ['player', 'admin', 'super_admin'])
      .eq('is_active', true)
      .order('display_name')
      .then(({ data }) => setAvailablePlayers((data ?? []) as ProfileLite[]))
  }, [])

  const addRow = (p: ProfileLite, team: TeamColor) => {
    if (rows.some((r) => r.profile_id === p.id)) return
    setRows([...rows, {
      profile_id: p.id,
      display_name: p.display_name,
      team,
      is_captain: false,
      goals: 0,
      yellow_cards: 0,
      red_cards: 0,
      is_no_show: false,
    }])
    setShowPicker(false)
  }

  const removeRow = (idx: number) => setRows(rows.filter((_, i) => i !== idx))
  const updateRow = (idx: number, patch: Partial<ResultRow>) =>
    setRows(rows.map((r, i) => i === idx ? { ...r, ...patch } : r))

  // Live goal-sum check — drives inline warning + blocks submit
  const goalCheck = validateScoreMatchesGoals(scoreWhite, scoreBlack, rows)

  const submit = async () => {
    // Only enforce when at least one score is > 0 and we have roster rows —
    // drafting an empty result before filling the roster should be allowed.
    if (rows.length > 0 && (scoreWhite > 0 || scoreBlack > 0) && !goalCheck.ok) {
      onError(goalCheck.messages.join(' '))
      onToast?.(goalCheck.messages[0])
      return
    }
    setBusy(true)
    const args: Database['public']['Functions']['admin_submit_match_result']['Args'] = {
      p_matchday_id: md.id,
      p_score_white: scoreWhite,
      p_score_black: scoreBlack,
      p_motm_profile_id: motm || (null as unknown as string),
      p_motm_guest_id: (null as unknown as string),
      p_players: rows.map((r) => ({
        profile_id: r.profile_id,
        team: r.team,
        is_captain: r.is_captain,
        goals: r.goals,
        yellow_cards: r.yellow_cards,
        red_cards: r.red_cards,
        is_no_show: r.is_no_show,
      })),
      p_notes: notes.trim() || undefined,
      p_approve: approve,
    }
    const { error } = await supabase.rpc('admin_submit_match_result', args)
    setBusy(false)
    if (error) { onError(error.message); return }
    await onDone()
  }

  const motmChoices = rows.filter((r) => r.profile_id && !r.is_no_show)
  const usedIds = new Set(rows.map((r) => r.profile_id).filter(Boolean) as string[])
  const showGoalWarn = rows.length > 0 && (scoreWhite > 0 || scoreBlack > 0) && !goalCheck.ok

  return (
    <>
      <h3>Enter result — {dateLabel(md.kickoff_at)}</h3>
      <p className="sheet-sub">Format {md.effective_format}. Creates matches + match_players atomically.</p>

      <div className="admin-score-row">
        <label className="admin-score-field">
          <span>WHITE</span>
          <input type="number" min={0} className="auth-input" value={scoreWhite} onChange={(e) => setScoreWhite(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <span className="admin-score-sep">–</span>
        <label className="admin-score-field">
          <span>BLACK</span>
          <input type="number" min={0} className="auth-input" value={scoreBlack} onChange={(e) => setScoreBlack(Math.max(0, Number(e.target.value) || 0))} />
        </label>
      </div>

      <div className={`admin-goal-sum ${showGoalWarn ? 'admin-goal-sum--warn' : 'admin-goal-sum--ok'}`} role="status">
        <span>⚪ goals by players: <strong>{goalCheck.whiteSum}</strong> / {scoreWhite}</span>
        <span>⚫ goals by players: <strong>{goalCheck.blackSum}</strong> / {scoreBlack}</span>
        {showGoalWarn && (
          <div className="admin-goal-sum-msg">
            ⚠ {goalCheck.messages.join(' ')}
          </div>
        )}
      </div>

      <div className="admin-roster-block">
        <div className="admin-roster-head">
          <h4>Roster ({rows.length})</h4>
          <div className="admin-roster-add">
            <button type="button" className="admin-chip admin-chip--on" onClick={() => { setPickerTeam('white'); setShowPicker((v) => !v) }}>+ WHITE</button>
            <button type="button" className="admin-chip admin-chip--on" onClick={() => { setPickerTeam('black'); setShowPicker((v) => !v) }}>+ BLACK</button>
          </div>
        </div>

        {showPicker && (() => {
          const q = pickerSearch.trim().toLowerCase()
          const candidates = availablePlayers.filter((p) => !usedIds.has(p.id))
          const filtered = q
            ? candidates.filter((p) => p.display_name.toLowerCase().includes(q))
            : candidates
          return (
            <div className="admin-picker">
              <input
                className="auth-input admin-picker-search"
                type="text"
                placeholder="Search player name…"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                autoFocus
              />
              {filtered.map((p) => (
                <button key={p.id} type="button" className="admin-picker-row" onClick={() => { addRow(p, pickerTeam); setPickerSearch('') }}>
                  <span>{p.display_name}</span>
                  {p.primary_position && <span className="ap-pos ap-pos-primary">{p.primary_position}</span>}
                </button>
              ))}
              {filtered.length === 0 && candidates.length > 0 && (
                <div className="admin-picker-empty">No matches for “{pickerSearch}”.</div>
              )}
              {candidates.length === 0 && (
                <div className="admin-picker-empty">All active players added.</div>
              )}
            </div>
          )
        })()}

        {rows.length === 0 && !showPicker && (
          <p className="admin-roster-empty">No players added yet. Use + WHITE or + BLACK to begin.</p>
        )}

        <ul className="admin-roster-list">
          {rows.map((r, i) => (
            <li key={i} className={`admin-roster-row admin-roster-row--${r.team}`}>
              <div className="admin-roster-name">
                <span className={`admin-roster-team admin-roster-team--${r.team}`}>{r.team === 'white' ? 'W' : 'B'}</span>
                <span>{r.display_name}</span>
                {r.is_captain && <span className="chip chip-role">C</span>}
              </div>
              <div className="admin-roster-stats">
                <label title="Goals">⚽<input type="number" min={0} value={r.goals} onChange={(e) => updateRow(i, { goals: Math.max(0, Number(e.target.value) || 0) })} /></label>
                <label title="Yellow"><span className="c-yel">🟨</span><input type="number" min={0} max={2} value={r.yellow_cards} onChange={(e) => updateRow(i, { yellow_cards: Math.max(0, Math.min(2, Number(e.target.value) || 0)) })} /></label>
                <label title="Red"><span className="c-red">🟥</span><input type="number" min={0} max={1} value={r.red_cards} onChange={(e) => updateRow(i, { red_cards: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })} /></label>
                <button type="button" className={`admin-chip admin-chip--sm${r.is_captain ? ' admin-chip--on' : ''}`} onClick={() => updateRow(i, { is_captain: !r.is_captain })} title="Captain">(C)</button>
                <button type="button" className={`admin-chip admin-chip--sm${r.is_no_show ? ' admin-chip--on' : ''}`} onClick={() => updateRow(i, { is_no_show: !r.is_no_show })} title="No-show">NS</button>
                <button type="button" className="admin-roster-remove" onClick={() => removeRow(i)}>✕</button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <label className="admin-field">
        <span className="admin-field-label">MOTM (profile)</span>
        <select className="auth-input" value={motm} onChange={(e) => setMotm(e.target.value)}>
          <option value="">— none —</option>
          {motmChoices.map((r) => (
            <option key={r.profile_id} value={r.profile_id}>{r.display_name} ({r.team})</option>
          ))}
        </select>
      </label>

      <label className="admin-field">
        <span className="admin-field-label">Notes (optional)</span>
        <textarea className="auth-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <label className="admin-field admin-field--row">
        <span className="admin-field-label">Approve immediately</span>
        <button type="button" className={`admin-pill${approve ? ' admin-pill--on' : ''}`} aria-pressed={approve} onClick={() => setApprove((v) => !v)}>
          {approve ? 'Approve' : 'Draft only'}
        </button>
      </label>

      <div className="sheet-actions">
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button
          type="button"
          className="auth-btn auth-btn--approve"
          onClick={submit}
          disabled={busy || showGoalWarn}
          title={showGoalWarn ? 'Player goals must add up to the scoreline' : undefined}
        >
          {busy ? 'Saving…' : approve ? 'Submit & approve' : 'Save draft'}
        </button>
      </div>
    </>
  )
}

// ─── Result edit (already-approved match) ───
// Score/MOTM/notes via edit_match_result. Per-player stat corrections via
// edit_match_players (S026 · Phase 2 seed — admin-only, audited whitelist of
// goals/yellow_cards/red_cards/is_no_show/is_captain/team).

type PlayerPatch = {
  goals?: number
  yellow_cards?: number
  red_cards?: number
  is_no_show?: boolean
  is_captain?: boolean
}

function ResultEditSheet({
  md, match, busy, setBusy, onDone, onError, onToast, onCancel,
}: BaseSheetProps & { md: MatchdayWithMatch; match: MatchRow }) {
  const [scoreWhite, setScoreWhite] = useState(match.score_white ?? 0)
  const [scoreBlack, setScoreBlack] = useState(match.score_black ?? 0)
  const [motm, setMotm] = useState<string>(match.motm_user_id ?? '')
  const [notes, setNotes] = useState(match.notes ?? '')
  const [players, setPlayers] = useState<(MatchPlayerRow & { display_name: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [editStats, setEditStats] = useState(false)
  // mp.id → local patch (only diffs vs persisted row)
  const [patches, setPatches] = useState<Record<string, PlayerPatch>>({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      const mpRes = await supabase.from('match_players').select('*').eq('match_id', match.id)
      if (cancelled) return
      const mpRows = (mpRes.data ?? []) as MatchPlayerRow[]
      const profileIds = mpRows.map((r) => r.profile_id).filter((x): x is string => !!x)
      const guestIds = mpRows.map((r) => r.guest_id).filter((x): x is string => !!x)
      const [profRes, guestRes] = await Promise.all([
        profileIds.length
          ? supabase.from('profiles').select('id, display_name').in('id', profileIds)
          : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
        guestIds.length
          ? supabase.from('match_guests').select('id, display_name').in('id', guestIds)
          : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
      ])
      if (cancelled) return
      const nameMap = new Map<string, string>()
      for (const p of profRes.data ?? []) nameMap.set(p.id, p.display_name)
      for (const g of guestRes.data ?? []) nameMap.set(g.id, g.display_name)
      setPlayers(mpRows.map((r) => ({
        ...r,
        display_name: nameMap.get((r.profile_id ?? r.guest_id) ?? '') ?? '—',
      })))
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [match.id])

  const patchRow = (mpId: string, patch: Partial<PlayerPatch>) => {
    setPatches((prev) => ({ ...prev, [mpId]: { ...(prev[mpId] ?? {}), ...patch } }))
  }

  // Live goal-sum check combines persisted rows + any pending patches
  const effectivePlayers = players.map((p) => {
    const pa = patches[p.id]
    if (!pa) return { team: p.team, goals: p.goals ?? 0 }
    return { team: p.team, goals: pa.goals ?? p.goals ?? 0 }
  })
  const goalCheck = validateScoreMatchesGoals(scoreWhite, scoreBlack, effectivePlayers)
  const showGoalWarn = !goalCheck.ok

  const submit = async () => {
    if (!match.approved_at) {
      onError('Not-yet-approved matches must be approved via admin_submit_match_result.')
      return
    }
    if (showGoalWarn) {
      onError(goalCheck.messages.join(' '))
      onToast?.(goalCheck.messages[0])
      return
    }
    setBusy(true)
    const edits: Record<string, unknown> = {
      score_white: scoreWhite,
      score_black: scoreBlack,
      result: scoreWhite > scoreBlack ? 'win_white' : scoreBlack > scoreWhite ? 'win_black' : 'draw',
      motm_user_id: motm || '',
      notes: notes.trim() || '',
    }
    const editRes = await supabase.rpc('edit_match_result', { p_match_id: match.id, p_edits: edits as unknown as Json })
    if (editRes.error) { setBusy(false); onError(editRes.error.message); return }

    // If any per-player patches, call edit_match_players
    const entries = Object.entries(patches)
    if (entries.length > 0) {
      const payload: Record<string, unknown>[] = entries.map(([mpId, patch]) => {
        const row = players.find((p) => p.id === mpId)
        if (!row) return { profile_id: null }
        return {
          profile_id: row.profile_id,
          guest_id: row.guest_id,
          ...(patch.goals !== undefined ? { goals: patch.goals } : {}),
          ...(patch.yellow_cards !== undefined ? { yellow_cards: patch.yellow_cards } : {}),
          ...(patch.red_cards !== undefined ? { red_cards: patch.red_cards } : {}),
          ...(patch.is_no_show !== undefined ? { is_no_show: patch.is_no_show } : {}),
          ...(patch.is_captain !== undefined ? { is_captain: patch.is_captain } : {}),
        }
      })
      const mpRes = await supabase.rpc('edit_match_players', { p_match_id: match.id, p_players: payload as unknown as Json })
      if (mpRes.error) { setBusy(false); onError(mpRes.error.message); return }
    }

    setBusy(false)
    await onDone()
  }

  if (loading) return <div className="app-loading" style={{ padding: 32 }}>Loading…</div>

  const effective = (p: MatchPlayerRow & { display_name: string }): MatchPlayerRow & { display_name: string } => {
    const pa = patches[p.id]
    if (!pa) return p
    return {
      ...p,
      goals:         pa.goals         ?? p.goals,
      yellow_cards:  pa.yellow_cards  ?? p.yellow_cards,
      red_cards:     pa.red_cards     ?? p.red_cards,
      is_no_show:    pa.is_no_show    ?? p.is_no_show,
      is_captain:    pa.is_captain    ?? p.is_captain,
    }
  }

  // In edit mode: show ALL rostered players. In view mode: events-only.
  const hasEvent = (p: MatchPlayerRow): boolean =>
    (p.goals ?? 0) > 0 || (p.yellow_cards ?? 0) > 0 || (p.red_cards ?? 0) > 0 ||
    !!p.is_no_show || !!p.is_captain || p.profile_id === match.motm_user_id || p.guest_id === match.motm_guest_id
  const whiteRows = players.filter((p) => p.team === 'white').map(effective)
  const blackRows = players.filter((p) => p.team === 'black').map(effective)
  const whiteVisible = editStats ? whiteRows : whiteRows.filter(hasEvent)
  const blackVisible = editStats ? blackRows : blackRows.filter(hasEvent)

  const dirtyCount = Object.keys(patches).length

  return (
    <>
      <h3>Edit result — {dowLabel(md.kickoff_at)} · {dateLabel(md.kickoff_at)}</h3>

      <div className="admin-score-row">
        <label className="admin-score-field"><span>⚪ WHITE</span>
          <input type="number" min={0} className="auth-input" value={scoreWhite} onChange={(e) => setScoreWhite(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <span className="admin-score-sep">–</span>
        <label className="admin-score-field"><span>BLACK ⚫</span>
          <input type="number" min={0} className="auth-input" value={scoreBlack} onChange={(e) => setScoreBlack(Math.max(0, Number(e.target.value) || 0))} />
        </label>
      </div>

      <div className={`admin-goal-sum ${showGoalWarn ? 'admin-goal-sum--warn' : 'admin-goal-sum--ok'}`} role="status">
        <span>⚪ goals by players: <strong>{goalCheck.whiteSum}</strong> / {scoreWhite}</span>
        <span>⚫ goals by players: <strong>{goalCheck.blackSum}</strong> / {scoreBlack}</span>
        {showGoalWarn && (
          <div className="admin-goal-sum-msg">
            ⚠ {goalCheck.messages.join(' ')}
          </div>
        )}
      </div>

      <div className="admin-mp-header">
        <button
          type="button"
          className={`admin-chip ${editStats ? 'admin-chip--on' : 'admin-chip--off'}`}
          onClick={() => setEditStats((v) => !v)}
        >
          {editStats ? '✎ Editing stats' : '✎ Edit player stats'}
        </button>
        {dirtyCount > 0 && <span className="admin-mp-dirty">{dirtyCount} pending change{dirtyCount === 1 ? '' : 's'}</span>}
      </div>

      <div className="admin-team-grid">
        <RosterColumn
          title="⚪ WHITE"
          rows={whiteVisible}
          motmProfileId={match.motm_user_id}
          motmGuestId={match.motm_guest_id}
          editing={editStats}
          onPatch={patchRow}
        />
        <RosterColumn
          title="BLACK ⚫"
          rows={blackVisible}
          motmProfileId={match.motm_user_id}
          motmGuestId={match.motm_guest_id}
          editing={editStats}
          onPatch={patchRow}
        />
      </div>

      <label className="admin-field">
        <span className="admin-field-label">MOTM</span>
        <select className="auth-input" value={motm} onChange={(e) => setMotm(e.target.value)}>
          <option value="">— none —</option>
          {players.filter((p) => p.profile_id && !p.is_no_show).map((p) => (
            <option key={p.id} value={p.profile_id!}>{p.display_name} ({p.team})</option>
          ))}
        </select>
      </label>

      <label className="admin-field">
        <span className="admin-field-label">Notes</span>
        <textarea className="auth-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div className="sheet-actions">
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button
          type="button"
          className="auth-btn auth-btn--approve"
          onClick={submit}
          disabled={busy || !match.approved_at || showGoalWarn}
          title={showGoalWarn ? 'Player goals must add up to the scoreline' : undefined}
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </>
  )
}

function RosterColumn({
  title, rows, motmProfileId, motmGuestId, editing, onPatch,
}: {
  title: string
  rows: (MatchPlayerRow & { display_name: string })[]
  motmProfileId: string | null
  motmGuestId: string | null
  editing: boolean
  onPatch: (mpId: string, patch: Partial<PlayerPatch>) => void
}) {
  return (
    <div className="admin-team-col">
      <h5 className="admin-team-col-title">{title}</h5>
      {rows.length === 0 ? (
        <p className="admin-team-col-empty">{editing ? 'No players' : 'No events'}</p>
      ) : (
        <ul className="admin-team-col-list">
          {rows.map((p) => {
            const isMotm = (p.profile_id && p.profile_id === motmProfileId) ||
                           (p.guest_id && p.guest_id === motmGuestId)
            if (!editing) {
              return (
                <li key={p.id} className="admin-team-col-row">
                  <span className="admin-team-col-name">
                    {p.is_captain && <span className="admin-team-c">(C)</span>}
                    {p.display_name}
                    {isMotm && <span className="admin-team-motm">⭐</span>}
                  </span>
                  <span className="admin-team-col-stats">
                    {(p.goals ?? 0) > 0 && <span>⚽ {p.goals}</span>}
                    {(p.yellow_cards ?? 0) > 0 && <span className="c-yel">🟨{(p.yellow_cards ?? 0) > 1 ? ` ${p.yellow_cards}` : ''}</span>}
                    {(p.red_cards ?? 0) > 0 && <span className="c-red">🟥</span>}
                    {p.is_no_show && <span className="admin-chip admin-chip--on admin-chip--sm">NS</span>}
                  </span>
                </li>
              )
            }
            return (
              <li key={p.id} className="admin-team-col-row admin-team-col-row--edit">
                <span className="admin-team-col-name">
                  {p.is_captain && <span className="admin-team-c">(C)</span>}
                  {p.display_name}
                  {isMotm && <span className="admin-team-motm">⭐</span>}
                </span>
                <div className="admin-mp-edit">
                  <label className="admin-mp-edit-field">
                    <span>⚽</span>
                    <input
                      type="number"
                      min={0}
                      className="admin-mp-edit-num"
                      value={p.goals ?? 0}
                      onChange={(e) => onPatch(p.id, { goals: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </label>
                  <label className="admin-mp-edit-field">
                    <span className="c-yel">🟨</span>
                    <input
                      type="number"
                      min={0}
                      max={2}
                      className="admin-mp-edit-num"
                      value={p.yellow_cards ?? 0}
                      onChange={(e) => onPatch(p.id, { yellow_cards: Math.max(0, Math.min(2, Number(e.target.value) || 0)) })}
                    />
                  </label>
                  <label className="admin-mp-edit-field">
                    <span className="c-red">🟥</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      className="admin-mp-edit-num"
                      value={p.red_cards ?? 0}
                      onChange={(e) => onPatch(p.id, { red_cards: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })}
                    />
                  </label>
                  <button
                    type="button"
                    className={`admin-chip admin-chip--sm ${p.is_captain ? 'admin-chip--on' : 'admin-chip--off'}`}
                    onClick={() => onPatch(p.id, { is_captain: !p.is_captain })}
                    title="Toggle captain"
                  >
                    (C)
                  </button>
                  <button
                    type="button"
                    className={`admin-chip admin-chip--sm ${p.is_no_show ? 'admin-chip--on' : 'admin-chip--off'}`}
                    onClick={() => onPatch(p.id, { is_no_show: !p.is_no_show })}
                    title="Toggle no-show"
                  >
                    NS
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function SimpleConfirmSheet({
  title, body, confirmLabel, busy, onConfirm, onCancel,
}: {
  title: string
  body: string
  confirmLabel: string
  busy: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}) {
  return (
    <>
      <h3>{title}</h3>
      <p>{body}</p>
      <div className="sheet-actions">
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="auth-btn auth-btn--approve" onClick={() => { void onConfirm() }} disabled={busy}>
          {busy ? 'Saving…' : confirmLabel}
        </button>
      </div>
    </>
  )
}

// ─── S058 issue #21 · Delete match (type-DELETE confirm) ──────────
function DeleteMatchSheet({
  md, match, busy, setBusy, onDone, onError, onCancel,
}: BaseSheetProps & { md: MatchdayWithMatch; match: MatchRow }) {
  const [typed, setTyped] = useState('')
  const armed = typed === 'DELETE'

  const submit = async () => {
    if (!armed) return
    setBusy(true)
    const { error } = await supabase.rpc('admin_delete_match', { p_match_id: match.id })
    setBusy(false)
    if (error) { onError(error.message); return }
    await onDone()
  }

  return (
    <>
      <h3>Delete match</h3>
      <p className="sheet-sub">Hard-deletes <strong>{dateLabel(md.kickoff_at)}</strong> · WHITE {match.score_white} – {match.score_black} BLACK. The matchday entry stays — admin can submit a new result against it.</p>

      <div className="admin-warn-banner" role="alert">
        ⚠ All player stats, goals, cards, MOTM and the scoreline for this match will be permanently removed from the leaderboard. Cannot be undone. Players whose rank changes will be notified.
      </div>

      <label className="admin-field">
        <span className="admin-field-label">Type <strong>DELETE</strong> to confirm:</span>
        <input
          className="auth-input"
          type="text"
          autoCapitalize="characters"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
        />
      </label>

      <div className="sheet-actions">
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button
          type="button"
          className="auth-btn auth-btn--reject-filled"
          onClick={() => { void submit() }}
          disabled={busy || !armed}
          title={armed ? 'Permanently delete this match' : 'Type DELETE to enable'}
        >
          {busy ? 'Deleting…' : '🗑 Delete match'}
        </button>
      </div>
    </>
  )
}

// ─── S058 issue #21 · Edit roster on an approved match ────────────
// Replaces the match_players roster via admin_edit_match_roster RPC.
interface PostRosterRow {
  profile_id: string
  display_name: string
  team: TeamColor
  is_captain: boolean
  goals: number
  yellow_cards: number
  red_cards: number
  is_no_show: boolean
}

// S058 follow-up: ensures each team has exactly ONE captain. If a team has
// zero captains (e.g., the previous captain was just removed), the first row
// in that team is auto-promoted. If a team has multiple captains (shouldn't
// happen but defensive), only the first one is kept.
function normalizeCaptains(rows: PostRosterRow[]): PostRosterRow[] {
  let whiteSeenCaptain = false
  let blackSeenCaptain = false
  // First pass: keep only the first captain per team.
  const dedup = rows.map((r) => {
    if (r.team === 'white') {
      if (r.is_captain && !whiteSeenCaptain) { whiteSeenCaptain = true; return r }
      return { ...r, is_captain: false }
    } else {
      if (r.is_captain && !blackSeenCaptain) { blackSeenCaptain = true; return r }
      return { ...r, is_captain: false }
    }
  })
  // Second pass: if a team has no captain, promote its first row.
  return dedup.map((r, i) => {
    const teamHasCaptain = r.team === 'white' ? whiteSeenCaptain : blackSeenCaptain
    if (teamHasCaptain) return r
    const isFirstInTeam = dedup.findIndex((x) => x.team === r.team) === i
    return isFirstInTeam ? { ...r, is_captain: true } : r
  })
}

function EditRosterPostSheet({
  md, match, busy, setBusy, onDone, onError, onCancel,
}: BaseSheetProps & { md: MatchdayWithMatch; match: MatchRow }) {
  const [rows, setRows] = useState<PostRosterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [availablePlayers, setAvailablePlayers] = useState<ProfileLite[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [pickerTeam, setPickerTeam] = useState<TeamColor>('white')
  const [pickerSearch, setPickerSearch] = useState('')

  const cap = md.effective_format === '5v5' ? 5 : 7

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [{ data: mp }, { data: ap }] = await Promise.all([
        supabase
          .from('match_players')
          .select('profile_id, team, is_captain, goals, yellow_cards, red_cards, is_no_show, profile:profiles(display_name)')
          .eq('match_id', match.id),
        supabase
          .from('profiles')
          .select('id, display_name, primary_position, secondary_position, role, is_active')
          .in('role', ['player', 'admin', 'super_admin'])
          .eq('is_active', true)
          .order('display_name'),
      ])
      if (cancelled) return
      const loaded: PostRosterRow[] = ((mp ?? []) as unknown as Array<{
        profile_id: string | null
        team: TeamColor
        is_captain: boolean
        goals: number
        yellow_cards: number
        red_cards: number
        is_no_show: boolean
        profile: { display_name: string } | null
      }>)
        .filter((r) => r.profile_id)
        .map((r) => ({
          profile_id: r.profile_id as string,
          display_name: r.profile?.display_name ?? '—',
          team: r.team,
          is_captain: r.is_captain,
          goals: r.goals,
          yellow_cards: r.yellow_cards,
          red_cards: r.red_cards,
          is_no_show: r.is_no_show,
        }))
      setRows(normalizeCaptains(loaded))
      setAvailablePlayers((ap ?? []) as ProfileLite[])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [match.id])

  const usedIds = new Set(rows.map((r) => r.profile_id))
  const whiteCount = rows.filter((r) => r.team === 'white').length
  const blackCount = rows.filter((r) => r.team === 'black').length
  const teamFull = (team: TeamColor) =>
    (team === 'white' ? whiteCount : blackCount) >= cap

  const addRow = (p: ProfileLite, team: TeamColor) => {
    if (rows.some((r) => r.profile_id === p.id)) return
    setRows(normalizeCaptains([...rows, {
      profile_id: p.id,
      display_name: p.display_name,
      team,
      is_captain: false,  // normalizeCaptains will auto-set to true if team is empty
      goals: 0,
      yellow_cards: 0,
      red_cards: 0,
      is_no_show: false,
    }]))
    setShowPicker(false)
    setPickerSearch('')
  }
  // S058 follow-up: removeRow runs through normalizeCaptains so the captain
  // auto-promotes from the next row when the captain was the one removed.
  const removeRow = (idx: number) => setRows(normalizeCaptains(rows.filter((_, i) => i !== idx)))

  // S058 follow-up: promote a non-captain row to captain. Demotes the previous
  // captain in the same team. The user picked "first-slot auto-captain +
  // tap-to-promote" UX.
  const promoteCaptain = (idx: number) => {
    const target = rows[idx]
    if (!target || target.is_captain) return
    setRows(rows.map((r) => {
      if (r.team !== target.team) return r
      if (r.profile_id === target.profile_id) return { ...r, is_captain: true }
      return { ...r, is_captain: false }
    }))
  }

  const submit = async () => {
    if (rows.length === 0) { onError('Roster cannot be empty'); return }
    if (whiteCount > cap || blackCount > cap) { onError(`Each team capped at ${cap}`); return }
    setBusy(true)
    const players = rows.map((r) => ({
      profile_id: r.profile_id,
      team: r.team,
      is_captain: r.is_captain,
      goals: r.goals,
      yellow_cards: r.yellow_cards,
      red_cards: r.red_cards,
      is_no_show: r.is_no_show,
    }))
    const { error } = await supabase.rpc('admin_edit_match_roster', {
      p_match_id: match.id,
      p_players: players as unknown as Json,
    })
    setBusy(false)
    if (error) { onError(error.message); return }
    await onDone()
  }

  if (loading) return <div className="app-loading">Loading roster…</div>

  return (
    <>
      <h3>Edit roster — {dateLabel(md.kickoff_at)}</h3>
      <p className="sheet-sub">Format {md.effective_format}. Replaces the post-match roster (per-player stats are preserved on existing rows; new rows start at 0). Re-snapshots ranks so affected players are notified.</p>

      <div className="admin-roster-block">
        <div className="admin-roster-head">
          <h4>Roster · ⚪ {whiteCount}/{cap} · ⚫ {blackCount}/{cap}</h4>
          <div className="admin-roster-add">
            <button
              type="button"
              className="admin-chip admin-chip--on"
              onClick={() => { setPickerTeam('white'); setShowPicker((v) => !v) }}
              disabled={teamFull('white')}
              title={teamFull('white') ? 'WHITE is full' : 'Add to WHITE'}
            >+ WHITE</button>
            <button
              type="button"
              className="admin-chip admin-chip--on"
              onClick={() => { setPickerTeam('black'); setShowPicker((v) => !v) }}
              disabled={teamFull('black')}
              title={teamFull('black') ? 'BLACK is full' : 'Add to BLACK'}
            >+ BLACK</button>
          </div>
        </div>

        {showPicker && (() => {
          const q = pickerSearch.trim().toLowerCase()
          const candidates = availablePlayers.filter((p) => !usedIds.has(p.id))
          const filtered = q
            ? candidates.filter((p) => p.display_name.toLowerCase().includes(q))
            : candidates
          return (
            <div className="admin-picker">
              <input
                className="auth-input admin-picker-search"
                type="text"
                placeholder="Search player name…"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                autoFocus
              />
              {filtered.map((p) => (
                <button key={p.id} type="button" className="admin-picker-row" onClick={() => addRow(p, pickerTeam)}>
                  <span>{p.display_name}</span>
                  {p.primary_position && <span className="ap-pos ap-pos-primary">{p.primary_position}</span>}
                </button>
              ))}
              {filtered.length === 0 && candidates.length > 0 && (
                <div className="admin-picker-empty">No matches.</div>
              )}
              {candidates.length === 0 && (
                <div className="admin-picker-empty">All active players added.</div>
              )}
            </div>
          )
        })()}

        {/* S058 follow-up: render WHITE then BLACK as separate sections, each
         * with captain pinned at the top so "first slot = captain" is visible.
         * The flat `rows` array still drives the data model (RPC payload). */}
        {(['white', 'black'] as TeamColor[]).map((team) => {
          const teamRows = rows
            .map((r, idx) => ({ row: r, idx }))
            .filter(({ row }) => row.team === team)
            .sort((a, b) => Number(b.row.is_captain) - Number(a.row.is_captain))
          if (teamRows.length === 0) return null
          return (
            <div key={team} className={`admin-roster-team-block admin-roster-team-block--${team}`}>
              <h5 className="admin-roster-team-label">
                {team === 'white' ? '⚪ WHITE' : '⚫ BLACK'} · {teamRows.length}/{cap}
              </h5>
              <ul className="admin-roster-list">
                {teamRows.map(({ row: r, idx: i }) => (
                  <li
                    key={r.profile_id}
                    className={`admin-roster-row admin-roster-row--${r.team}${r.is_captain ? ' admin-roster-row--captain' : ''}`}
                  >
                    <div className="admin-roster-name">
                      <span className={`admin-roster-team admin-roster-team--${r.team}`}>{r.team === 'white' ? 'W' : 'B'}</span>
                      <span>{r.display_name}</span>
                      {r.is_captain && <span className="chip chip-role admin-roster-captain-badge">👑 CAPTAIN</span>}
                    </div>
                    <div className="admin-roster-row-actions">
                      {!r.is_captain && (
                        <button
                          type="button"
                          className="admin-roster-make-captain"
                          onClick={() => promoteCaptain(i)}
                          title="Make captain"
                          aria-label="Make captain"
                        >☆</button>
                      )}
                      <button
                        type="button"
                        className="admin-roster-remove"
                        onClick={() => removeRow(i)}
                        title="Remove from roster"
                      >✕</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      <div className="sheet-actions">
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button
          type="button"
          className="auth-btn auth-btn--approve"
          onClick={() => { void submit() }}
          disabled={busy || rows.length === 0}
        >
          {busy ? 'Saving…' : 'Save roster'}
        </button>
      </div>
    </>
  )
}
