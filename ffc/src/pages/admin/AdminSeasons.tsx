/**
 * §3 Admin · Seasons — S034 redesign.
 *
 * Replaces the inline always-visible create form with:
 *   • "+ New season" pill CTA at the top
 *   • Bottom sheet for create / edit (shared form, same component)
 *   • Richer list (format chip, DD/MMM/YYYY dates, end date, status)
 *   • Edit + Delete icons per row (delete only when no matchdays)
 *
 * Backend:
 *   create_season (S029, now requires planned_games — migration 0025)
 *   update_season (S034, migration 0025)
 *   delete_season (S034, migration 0025 — guarded against non-empty seasons)
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useApp } from '../../lib/AppContext'
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

type SeasonRow = Pick<
  Database['public']['Tables']['seasons']['Row'],
  'id' | 'name' | 'starts_on' | 'ends_on' | 'planned_games' |
  'default_format' | 'roster_policy' | 'ended_at' | 'archived_at'
>

type MatchFormat = Database['public']['Enums']['match_format']
type RosterPolicy = Database['public']['Enums']['roster_policy']

interface SeasonWithCount extends SeasonRow {
  matchday_count: number
}

interface FormState {
  name: string
  starts_on: string
  ends_on: string
  planned_games: string
  default_format: MatchFormat
  roster_policy: RosterPolicy
}

interface SheetState {
  mode: 'create' | 'edit'
  season: SeasonRow | null
}

const EMPTY_FORM: FormState = {
  name: '',
  starts_on: '',
  ends_on: '',
  planned_games: '',
  default_format: '7v7',
  roster_policy: 'carry_forward',
}

const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  // `iso` is a YYYY-MM-DD (Postgres DATE). Parse in local TZ so we don't
  // silently shift across the day boundary.
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${String(d).padStart(2, '0')}/${MONTH_ABBR[m - 1]}/${y}`
}

function statusLabel(row: SeasonRow): { label: string; tone: 'active' | 'ended' | 'archived' } {
  if (row.archived_at) return { label: 'ARCHIVED', tone: 'archived' }
  if (row.ended_at) return { label: 'ENDED', tone: 'ended' }
  return { label: 'ACTIVE', tone: 'active' }
}

function fromRow(row: SeasonRow): FormState {
  return {
    name: row.name,
    starts_on: row.starts_on,
    ends_on: row.ends_on ?? '',
    planned_games: row.planned_games?.toString() ?? '',
    default_format: row.default_format,
    roster_policy: row.roster_policy,
  }
}

export function AdminSeasons() {
  const { role } = useApp()
  const navigate = useNavigate()
  const isAdmin = role === 'admin' || role === 'super_admin'

  const [seasons, setSeasons] = useState<SeasonWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [sheet, setSheet] = useState<SheetState | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const [deleting, setDeleting] = useState<SeasonWithCount | null>(null)
  const [deleteInFlight, setDeleteInFlight] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const { data: rows, error } = await supabase
        .from('seasons')
        .select('id, name, starts_on, ends_on, planned_games, default_format, roster_policy, ended_at, archived_at')
        .order('starts_on', { ascending: false })
      if (error) throw error

      // Fetch matchday counts in one query; aggregate client-side.
      const ids = (rows ?? []).map((r) => r.id)
      const counts: Record<string, number> = {}
      if (ids.length > 0) {
        const { data: mdRows, error: mdErr } = await supabase
          .from('matchdays')
          .select('season_id')
          .in('season_id', ids)
        if (mdErr) throw mdErr
        for (const r of mdRows ?? []) {
          if (r.season_id) counts[r.season_id] = (counts[r.season_id] ?? 0) + 1
        }
      }

      setSeasons((rows ?? []).map((r) => ({ ...r, matchday_count: counts[r.id] ?? 0 })))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load seasons')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const openCreate = useCallback(() => {
    setErr(null)
    setForm(EMPTY_FORM)
    setSheet({ mode: 'create', season: null })
  }, [])

  const openEdit = useCallback((row: SeasonRow) => {
    setErr(null)
    setForm(fromRow(row))
    setSheet({ mode: 'edit', season: row })
  }, [])

  const closeSheet = useCallback(() => {
    if (saving) return
    setSheet(null)
    setErr(null)
  }, [saving])

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sheet) return
    setErr(null)

    if (!form.name.trim()) { setErr('Name is required'); return }
    if (!form.starts_on) { setErr('Start date is required'); return }
    const planned = Number(form.planned_games)
    if (!form.planned_games || !Number.isInteger(planned) || planned < 1) {
      setErr('Planned games is required (whole number ≥ 1)')
      return
    }
    const endsOn = form.ends_on || null
    if (endsOn && endsOn < form.starts_on) {
      setErr('End date must be on or after start date'); return
    }

    setSaving(true)
    try {
      if (sheet.mode === 'create') {
        const { error } = await supabase.rpc('create_season', {
          p_name: form.name,
          p_starts_on: form.starts_on,
          p_planned_games: planned,
          p_default_format: form.default_format,
          p_roster_policy: form.roster_policy,
        })
        if (error) throw error
      } else {
        const orig = sheet.season!
        const clearingEnds = !endsOn && !!orig.ends_on
        const { error } = await supabase.rpc('update_season', {
          p_season_id: orig.id,
          p_name: form.name,
          p_starts_on: form.starts_on,
          p_planned_games: planned,
          p_default_format: form.default_format,
          p_roster_policy: form.roster_policy,
          ...(endsOn ? { p_ends_on: endsOn } : {}),
          ...(clearingEnds ? { p_clear_ends_on: true } : {}),
        })
        if (error) throw error
      }
      setSheet(null)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [sheet, form, load])

  const onDeleteConfirm = useCallback(async () => {
    if (!deleting) return
    setDeleteInFlight(true)
    setErr(null)
    try {
      const { error } = await supabase.rpc('delete_season', { p_season_id: deleting.id })
      if (error) throw error
      setDeleting(null)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleteInFlight(false)
    }
  }, [deleting, load])

  const sortedSeasons = useMemo(() => seasons, [seasons])

  if (!isAdmin) {
    return (
      <div className="as-root">
        <div className="as-empty">
          <h3>Admin only</h3>
          <p>This screen is restricted to admins and super-admins.</p>
          <button type="button" className="auth-btn auth-btn--approve" onClick={() => navigate('/poll')}>Back to Poll</button>
        </div>
      </div>
    )
  }

  return (
    <div className="as-root">
      <div className="as-topbar">
        <button type="button" className="as-back" onClick={() => navigate('/settings')}>‹ Back</button>
        <h1 className="as-title">Seasons</h1>
        <button type="button" className="as-new-btn" onClick={openCreate}>
          <span aria-hidden>+</span> New season
        </button>
      </div>

      {err && !sheet && !deleting && (
        <div className="as-error" role="alert">{err}</div>
      )}

      {loading ? (
        <div className="as-loading">Loading seasons…</div>
      ) : sortedSeasons.length === 0 ? (
        <div className="as-empty">
          <h3>No seasons yet</h3>
          <p>Create the first season to get started.</p>
        </div>
      ) : (
        <ul className="as-list" aria-label="Seasons">
          {sortedSeasons.map((s) => {
            const status = statusLabel(s)
            const canDelete = s.matchday_count === 0
            return (
              <li key={s.id} className={`as-row as-row--${status.tone}`}>
                <div className="as-row-main">
                  <div className="as-row-name-line">
                    <span className="as-row-name">{s.name}</span>
                    <span className={`as-fmt-chip as-fmt-chip--${s.default_format}`}>{s.default_format.toUpperCase()}</span>
                    <span className={`as-status as-status--${status.tone}`}>{status.label}</span>
                  </div>
                  <div className="as-row-meta">
                    <span className="as-meta-item">
                      <span className="as-meta-label">Start</span>
                      <span className="as-meta-val">{fmtDate(s.starts_on)}</span>
                    </span>
                    <span className="as-meta-sep" aria-hidden>·</span>
                    <span className="as-meta-item">
                      <span className="as-meta-label">End</span>
                      <span className="as-meta-val">{fmtDate(s.ends_on)}</span>
                    </span>
                    <span className="as-meta-sep" aria-hidden>·</span>
                    <span className="as-meta-item">
                      <span className="as-meta-label">Games</span>
                      <span className="as-meta-val">{s.planned_games ?? '—'}</span>
                    </span>
                    <span className="as-meta-sep" aria-hidden>·</span>
                    <span className="as-meta-item">
                      <span className="as-meta-label">Matchdays</span>
                      <span className="as-meta-val">{s.matchday_count}</span>
                    </span>
                  </div>
                </div>
                <div className="as-row-actions">
                  <button type="button" className="as-icon-btn" aria-label={`Edit ${s.name}`} title="Edit" onClick={() => openEdit(s)}>✎</button>
                  {canDelete ? (
                    <button type="button" className="as-icon-btn as-icon-btn--danger" aria-label={`Delete ${s.name}`} title="Delete (no matchdays yet)" onClick={() => setDeleting(s)}>🗑</button>
                  ) : (
                    <span className="as-icon-btn as-icon-btn--disabled" aria-hidden title={`Cannot delete — ${s.matchday_count} matchday${s.matchday_count === 1 ? '' : 's'} exist`}>🗑</span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {sheet && (
        <SeasonSheet
          mode={sheet.mode}
          form={form}
          onChange={setForm}
          err={err}
          saving={saving}
          onCancel={closeSheet}
          onSubmit={onSubmit}
        />
      )}

      {deleting && (
        <DeleteConfirm
          name={deleting.name}
          inFlight={deleteInFlight}
          err={err}
          onCancel={() => { if (!deleteInFlight) { setDeleting(null); setErr(null) } }}
          onConfirm={onDeleteConfirm}
        />
      )}
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────

function SeasonSheet({
  mode, form, onChange, err, saving, onCancel, onSubmit,
}: {
  mode: 'create' | 'edit'
  form: FormState
  onChange: (next: FormState) => void
  err: string | null
  saving: boolean
  onCancel: () => void
  onSubmit: (e: React.FormEvent) => void
}) {
  const title = mode === 'create' ? 'New season' : 'Edit season'
  const submitLabel = mode === 'create' ? (saving ? 'Creating…' : 'Create season') : (saving ? 'Saving…' : 'Save changes')

  return (
    <div className="as-scrim" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <form className="as-sheet" onSubmit={onSubmit}>
        <div className="as-sheet-handle" aria-hidden />
        <div className="as-sheet-title">{title}</div>

        <label className="as-field">
          <span className="as-field-label">Name</span>
          <input
            type="text"
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
            placeholder="Season 12"
            required
            autoFocus
          />
        </label>

        <div className="as-field-row">
          <label className="as-field">
            <span className="as-field-label">First match date</span>
            <input
              type="date"
              value={form.starts_on}
              onChange={(e) => onChange({ ...form, starts_on: e.target.value })}
              required
            />
          </label>
          {mode === 'edit' && (
            <label className="as-field">
              <span className="as-field-label">End date</span>
              <input
                type="date"
                value={form.ends_on}
                onChange={(e) => onChange({ ...form, ends_on: e.target.value })}
              />
            </label>
          )}
        </div>

        <label className="as-field">
          <span className="as-field-label">Planned games</span>
          <input
            type="number"
            min={1}
            value={form.planned_games}
            onChange={(e) => onChange({ ...form, planned_games: e.target.value })}
            placeholder="e.g. 40"
            required
          />
        </label>

        <div className="as-field-row">
          <div className="as-field">
            <span className="as-field-label">Format</span>
            <div className="as-chip-group" role="radiogroup" aria-label="Format">
              {(['7v7', '5v5'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={form.default_format === f}
                  className={`as-chip${form.default_format === f ? ' as-chip--on' : ''}`}
                  onClick={() => onChange({ ...form, default_format: f })}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="as-field">
          <span className="as-field-label">Roster policy</span>
          <div className="as-chip-col" role="radiogroup" aria-label="Roster policy">
            <button
              type="button"
              role="radio"
              aria-checked={form.roster_policy === 'carry_forward'}
              className={`as-chip as-chip--wide${form.roster_policy === 'carry_forward' ? ' as-chip--on' : ''}`}
              onClick={() => onChange({ ...form, roster_policy: 'carry_forward' })}
            >
              <span className="as-chip-title">Carry forward</span>
              <span className="as-chip-help">Same players as previous season</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={form.roster_policy === 'fresh'}
              className={`as-chip as-chip--wide${form.roster_policy === 'fresh' ? ' as-chip--on' : ''}`}
              onClick={() => onChange({ ...form, roster_policy: 'fresh' })}
            >
              <span className="as-chip-title">Fresh</span>
              <span className="as-chip-help">Empty roster; players re-apply</span>
            </button>
          </div>
        </div>

        {err && <div className="as-error" role="alert">{err}</div>}

        <div className="as-sheet-actions">
          <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="auth-btn auth-btn--approve" disabled={saving}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

function DeleteConfirm({
  name, inFlight, err, onCancel, onConfirm,
}: {
  name: string
  inFlight: boolean
  err: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="as-scrim" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget && !inFlight) onCancel() }}>
      <div className="as-sheet as-sheet--warn">
        <div className="as-sheet-handle" aria-hidden />
        <div className="as-sheet-title">Delete season</div>
        <div className="as-sheet-warn-body">
          Delete <strong>{name}</strong>? This removes the season row. It's only possible because no matchdays exist on it.
        </div>
        {err && <div className="as-error" role="alert">{err}</div>}
        <div className="as-sheet-actions">
          <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={inFlight}>
            Cancel
          </button>
          <button type="button" className="auth-btn auth-btn--danger" onClick={onConfirm} disabled={inFlight}>
            {inFlight ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
