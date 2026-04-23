import { useCallback, useEffect, useMemo, useState } from 'react'
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

interface MatchdayWithMatch extends MatchdayRow {
  match?: MatchRow | null
  effective_format: MatchFormat
}

type Segment = 'this_week' | 'upcoming' | 'past'

type Sheet =
  | { kind: 'create' }
  | { kind: 'edit_md'; md: MatchdayWithMatch }
  | { kind: 'lock'; md: MatchdayWithMatch }
  | { kind: 'result'; md: MatchdayWithMatch; mode: 'create' }
  | { kind: 'result_edit'; md: MatchdayWithMatch; match: MatchRow }
  | { kind: 'confirm_friendly'; md: MatchdayWithMatch }
  | { kind: 'dismiss_friendly'; md: MatchdayWithMatch }
  | null

// ─── Helpers ───────────────────────────────────────────────────

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
}
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
function fullLabel(iso: string): string {
  return `${dateLabel(iso)} · ${timeLabel(iso)}`
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
  if (md.roster_locked_at) return { text: 'Roster locked · enter result', tone: 'accent' }
  const now = Date.now()
  const ko = new Date(md.kickoff_at).getTime()
  if (ko < now) return { text: 'Past kickoff · enter result', tone: 'warn' }
  if (new Date(md.poll_closes_at).getTime() < now) return { text: 'Poll closed · lock roster', tone: 'warn' }
  if (new Date(md.poll_opens_at).getTime() < now) return { text: 'Poll open', tone: 'accent' }
  return { text: 'Scheduled', tone: 'muted' }
}

// ─── Component ─────────────────────────────────────────────────

export function AdminMatches() {
  const [seg, setSeg] = useState<Segment>('this_week')
  const [matchdays, setMatchdays] = useState<MatchdayWithMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [sheetBusy, setSheetBusy] = useState(false)
  const [seasonId, setSeasonId] = useState<string | null>(null)
  const [seasonFormat, setSeasonFormat] = useState<MatchFormat>('7v7')

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [mdRes, matchesRes, seasonsRes] = await Promise.all([
      supabase.from('matchdays').select('*').order('kickoff_at', { ascending: false }).limit(60),
      supabase.from('matches').select('id, matchday_id, score_white, score_black, result, motm_user_id, motm_guest_id, approved_at, notes'),
      supabase.from('seasons').select('id, default_format, ended_at').is('ended_at', null).order('starts_on', { ascending: false }).limit(1),
    ])
    if (mdRes.error) setError(mdRes.error.message)
    if (matchesRes.error) setError(matchesRes.error.message)

    const matchByMd = new Map<string, MatchRow>()
    for (const m of (matchesRes.data ?? []) as MatchRow[]) matchByMd.set(m.matchday_id, m)

    const season = seasonsRes.data?.[0]
    if (season) {
      setSeasonId(season.id)
      setSeasonFormat((season.default_format as MatchFormat) ?? '7v7')
    }

    const enriched: MatchdayWithMatch[] = ((mdRes.data ?? []) as MatchdayRow[]).map((md) => ({
      ...md,
      match: matchByMd.get(md.id) ?? null,
      effective_format: md.format ?? (season?.default_format as MatchFormat) ?? '7v7',
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

  return (
    <section className="admin-matches">
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
              onEnterResult={() => setSheet({ kind: 'result', md, mode: 'create' })}
              onEditResult={() => md.match && setSheet({ kind: 'result_edit', md, match: md.match })}
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
            {sheet.kind === 'result' && (
              <ResultEntrySheet
                md={sheet.md}
                busy={sheetBusy}
                setBusy={setSheetBusy}
                onDone={async () => { setSheet(null); await loadAll() }}
                onError={setError}
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
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Matchday card ─────────────────────────────────────────────

function MatchdayCard({
  md, onEdit, onLock, onEnterResult, onEditResult,
}: {
  md: MatchdayWithMatch
  onEdit: () => void
  onLock: () => void
  onEnterResult: () => void
  onEditResult: () => void
}) {
  const phase = phaseLabel(md)
  const hasResult = !!md.match
  const approved = !!md.match?.approved_at
  const locked = !!md.roster_locked_at
  const isFriendly = md.is_friendly

  return (
    <li className={`admin-md-card${approved ? ' admin-md-card--final' : ''}`}>
      <div className="admin-md-head">
        <div className="admin-md-head-main">
          <span className="admin-md-date">{dateLabel(md.kickoff_at)}</span>
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
            <span className="admin-md-score-white">WHITE {md.match.score_white}</span>
            <span className="admin-md-score-sep">–</span>
            <span className="admin-md-score-black">{md.match.score_black} BLACK</span>
          </div>
          {md.match.result && <span className={`admin-md-result-chip admin-md-result-chip--${md.match.result}`}>{resultLabel(md.match.result)}</span>}
        </div>
      )}

      <div className="admin-md-poll-meta">
        Poll: {fullLabel(md.poll_opens_at)} → {fullLabel(md.poll_closes_at)}
        {locked && <span className="admin-md-lock"> · 🔒 locked {dateLabel(md.roster_locked_at!)}</span>}
      </div>

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
            <button type="button" className="auth-btn auth-btn--approve admin-md-btn" onClick={onEnterResult}>
              Enter result
            </button>
          </>
        )}
        {hasResult && (
          <button type="button" className="auth-btn auth-btn--approve admin-md-btn" onClick={onEditResult}>
            {approved ? 'Edit result' : 'Review / approve'}
          </button>
        )}
      </div>
    </li>
  )
}

function resultLabel(r: MatchResult): string {
  if (r === 'win_white') return 'W wins'
  if (r === 'win_black') return 'B wins'
  return 'Draw'
}

// ─── Sheets ────────────────────────────────────────────────────

interface BaseSheetProps {
  busy: boolean
  setBusy: (b: boolean) => void
  onDone: () => void | Promise<void>
  onError: (msg: string) => void
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
  const [kickoff, setKickoff] = useState(toLocalInput(nextThu.toISOString()))
  const [venue, setVenue] = useState('')
  const [pollOpens, setPollOpens] = useState(() => {
    const d = new Date(nextThu); d.setDate(d.getDate() - 3); d.setHours(9, 0, 0, 0); return toLocalInput(d.toISOString())
  })
  const [pollCloses, setPollCloses] = useState(() => {
    const d = new Date(nextThu); d.setDate(d.getDate() - 1); d.setHours(21, 0, 0, 0); return toLocalInput(d.toISOString())
  })
  const [format, setFormat] = useState<MatchFormat | ''>('')

  const submit = async () => {
    if (!kickoff || !pollOpens || !pollCloses) { onError('All dates required.'); return }
    setBusy(true)
    const args: Database['public']['Functions']['create_matchday']['Args'] = {
      p_season_id: seasonId,
      p_kickoff_at: fromLocalInput(kickoff),
      p_venue: venue.trim(),
      p_poll_opens_at: fromLocalInput(pollOpens),
      p_poll_closes_at: fromLocalInput(pollCloses),
    }
    if (format) args.p_format = format
    const { error } = await supabase.rpc('create_matchday', args)
    setBusy(false)
    if (error) { onError(error.message); return }
    await onDone()
  }

  return (
    <>
      <h3>Create matchday</h3>
      <p className="sheet-sub">Season default format: {seasonDefaultFormat}. Leave format blank to inherit.</p>

      <label className="admin-field">
        <span className="admin-field-label">Kickoff</span>
        <input type="datetime-local" className="auth-input" value={kickoff} onChange={(e) => setKickoff(e.target.value)} />
      </label>

      <label className="admin-field">
        <span className="admin-field-label">Venue</span>
        <input className="auth-input" placeholder="e.g. Al Wasl Sports Club" value={venue} onChange={(e) => setVenue(e.target.value)} />
      </label>

      <label className="admin-field">
        <span className="admin-field-label">Poll opens</span>
        <input type="datetime-local" className="auth-input" value={pollOpens} onChange={(e) => setPollOpens(e.target.value)} />
      </label>

      <label className="admin-field">
        <span className="admin-field-label">Poll closes</span>
        <input type="datetime-local" className="auth-input" value={pollCloses} onChange={(e) => setPollCloses(e.target.value)} />
      </label>

      <div className="admin-field">
        <span className="admin-field-label">Format</span>
        <div className="admin-chip-row">
          <button type="button" className={`admin-chip${format === '' ? ' admin-chip--on' : ''}`} onClick={() => setFormat('')}>
            Inherit ({seasonDefaultFormat})
          </button>
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
  const [kickoff, setKickoff] = useState(toLocalInput(md.kickoff_at))
  const [venue, setVenue] = useState(md.venue ?? '')
  const [pollOpens, setPollOpens] = useState(toLocalInput(md.poll_opens_at))
  const [pollCloses, setPollCloses] = useState(toLocalInput(md.poll_closes_at))
  const [format, setFormat] = useState<MatchFormat | ''>(md.format ?? '')

  const submit = async () => {
    setBusy(true)
    const args: Database['public']['Functions']['update_matchday']['Args'] = {
      p_matchday_id: md.id,
      p_kickoff_at: fromLocalInput(kickoff),
      p_poll_opens_at: fromLocalInput(pollOpens),
      p_poll_closes_at: fromLocalInput(pollCloses),
      p_venue: venue.trim() || undefined,
      p_venue_explicit_null: venue.trim() === '',
    }
    if (format) args.p_format = format
    else args.p_format_explicit_null = true
    const { error } = await supabase.rpc('update_matchday', args)
    setBusy(false)
    if (error) { onError(error.message); return }
    await onDone()
  }

  return (
    <>
      <h3>Edit matchday — {dateLabel(md.kickoff_at)}</h3>
      <p className="sheet-sub">Season default: {seasonDefaultFormat}.</p>

      <label className="admin-field"><span className="admin-field-label">Kickoff</span>
        <input type="datetime-local" className="auth-input" value={kickoff} onChange={(e) => setKickoff(e.target.value)} /></label>
      <label className="admin-field"><span className="admin-field-label">Venue</span>
        <input className="auth-input" value={venue} onChange={(e) => setVenue(e.target.value)} /></label>
      <label className="admin-field"><span className="admin-field-label">Poll opens</span>
        <input type="datetime-local" className="auth-input" value={pollOpens} onChange={(e) => setPollOpens(e.target.value)} /></label>
      <label className="admin-field"><span className="admin-field-label">Poll closes</span>
        <input type="datetime-local" className="auth-input" value={pollCloses} onChange={(e) => setPollCloses(e.target.value)} /></label>

      <div className="admin-field">
        <span className="admin-field-label">Format</span>
        <div className="admin-chip-row">
          <button type="button" className={`admin-chip${format === '' ? ' admin-chip--on' : ''}`} onClick={() => setFormat('')}>Inherit ({seasonDefaultFormat})</button>
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
  md, busy, setBusy, onDone, onError, onCancel,
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

  const submit = async () => {
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

      <div className="admin-roster-block">
        <div className="admin-roster-head">
          <h4>Roster ({rows.length})</h4>
          <div className="admin-roster-add">
            <button type="button" className="admin-chip admin-chip--on" onClick={() => { setPickerTeam('white'); setShowPicker((v) => !v) }}>+ WHITE</button>
            <button type="button" className="admin-chip admin-chip--on" onClick={() => { setPickerTeam('black'); setShowPicker((v) => !v) }}>+ BLACK</button>
          </div>
        </div>

        {showPicker && (
          <div className="admin-picker">
            {availablePlayers.filter((p) => !usedIds.has(p.id)).map((p) => (
              <button key={p.id} type="button" className="admin-picker-row" onClick={() => addRow(p, pickerTeam)}>
                <span>{p.display_name}</span>
                {p.primary_position && <span className="ap-pos ap-pos-primary">{p.primary_position}</span>}
              </button>
            ))}
            {availablePlayers.filter((p) => !usedIds.has(p.id)).length === 0 && (
              <div className="admin-picker-empty">All active players added.</div>
            )}
          </div>
        )}

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
        <button type="button" className="auth-btn auth-btn--approve" onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : approve ? 'Submit & approve' : 'Save draft'}
        </button>
      </div>
    </>
  )
}

// ─── Result edit (already-approved match: score/MOTM/notes only) ───
// Per-player stat edits post-approval are a Phase 2 scope item and require
// a dedicated edit_match_players RPC. Phase 1 admin surface only lets the
// admin correct score, result, MOTM, and notes via edit_match_result.

function ResultEditSheet({
  md, match, busy, setBusy, onDone, onError, onCancel,
}: BaseSheetProps & { md: MatchdayWithMatch; match: MatchRow }) {
  const [scoreWhite, setScoreWhite] = useState(match.score_white ?? 0)
  const [scoreBlack, setScoreBlack] = useState(match.score_black ?? 0)
  const [motm, setMotm] = useState<string>(match.motm_user_id ?? '')
  const [notes, setNotes] = useState(match.notes ?? '')
  const [players, setPlayers] = useState<(MatchPlayerRow & { display_name: string })[]>([])
  const [loading, setLoading] = useState(true)

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

  const submit = async () => {
    if (!match.approved_at) {
      onError('Not-yet-approved matches must be approved via admin_submit_match_result; per-player edits pre-approval aren\'t exposed yet.')
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
    const { error } = await supabase.rpc('edit_match_result', { p_match_id: match.id, p_edits: edits as unknown as Json })
    setBusy(false)
    if (error) { onError(error.message); return }
    await onDone()
  }

  if (loading) return <div className="app-loading" style={{ padding: 32 }}>Loading…</div>

  return (
    <>
      <h3>Edit result — {dateLabel(md.kickoff_at)}</h3>
      <p className="sheet-sub">Score / MOTM / notes only. Per-player stat corrections are a Phase 2 item.</p>

      <div className="admin-score-row">
        <label className="admin-score-field"><span>WHITE</span>
          <input type="number" min={0} className="auth-input" value={scoreWhite} onChange={(e) => setScoreWhite(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <span className="admin-score-sep">–</span>
        <label className="admin-score-field"><span>BLACK</span>
          <input type="number" min={0} className="auth-input" value={scoreBlack} onChange={(e) => setScoreBlack(Math.max(0, Number(e.target.value) || 0))} />
        </label>
      </div>

      <div className="admin-roster-block">
        <h4>Roster ({players.length}) — read-only</h4>
        <ul className="admin-roster-list admin-roster-list--ro">
          {players.map((p) => (
            <li key={p.id} className={`admin-roster-row admin-roster-row--${p.team}`}>
              <div className="admin-roster-name">
                <span className={`admin-roster-team admin-roster-team--${p.team}`}>{p.team === 'white' ? 'W' : 'B'}</span>
                <span>{p.display_name}</span>
                {p.is_captain && <span className="chip chip-role">C</span>}
              </div>
              <div className="admin-roster-stats admin-roster-stats--ro">
                <span>⚽ {p.goals ?? 0}</span>
                {(p.yellow_cards ?? 0) > 0 && <span className="c-yel">🟨 {p.yellow_cards}</span>}
                {(p.red_cards ?? 0) > 0 && <span className="c-red">🟥 {p.red_cards}</span>}
                {p.is_no_show && <span className="admin-chip admin-chip--on admin-chip--sm">NS</span>}
              </div>
            </li>
          ))}
        </ul>
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
        <button type="button" className="auth-btn auth-btn--approve" onClick={submit} disabled={busy || !match.approved_at}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </>
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
