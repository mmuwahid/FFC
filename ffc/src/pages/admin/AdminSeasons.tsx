import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

type SeasonRow = Pick<
  Database['public']['Tables']['seasons']['Row'],
  'id' | 'name' | 'starts_on' | 'ends_on' | 'planned_games' |
  'default_format' | 'roster_policy' | 'ended_at' | 'archived_at'
>

type MatchFormat = Database['public']['Enums']['match_format']
type RosterPolicy = Database['public']['Enums']['roster_policy']

// Inline edit state for planned_games on an active season
type EditState = { id: string; value: string } | null

function statusLabel(row: SeasonRow): string {
  if (row.archived_at) return 'ARCHIVED'
  if (row.ended_at) return 'ENDED'
  return 'ACTIVE'
}

export function AdminSeasons() {
  const [seasons, setSeasons] = useState<SeasonRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // Create form state
  const [newName, setNewName] = useState('')
  const [newStartsOn, setNewStartsOn] = useState('')
  const [newPlanned, setNewPlanned] = useState<string>('')
  const [newFormat, setNewFormat] = useState<MatchFormat>('7v7')
  const [newPolicy, setNewPolicy] = useState<RosterPolicy>('carry_forward')
  const [creating, setCreating] = useState(false)

  // Inline edit state for planned_games on an active season
  const [editing, setEditing] = useState<EditState>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    const { data, error } = await supabase
      .from('seasons')
      .select('id, name, starts_on, ends_on, planned_games, default_format, roster_policy, ended_at, archived_at')
      .order('starts_on', { ascending: false })
    if (error) { setErr(error.message); setLoading(false); return }
    setSeasons((data ?? []) as SeasonRow[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const onCreate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (!newName.trim() || !newStartsOn) { setErr('Name and start date are required'); return }
    const planned = newPlanned.trim() === '' ? null : Number(newPlanned)
    if (planned !== null && (!Number.isInteger(planned) || planned < 1)) {
      setErr('Planned games must be a whole number ≥ 1'); return
    }
    setCreating(true)
    const { error } = await supabase.rpc('create_season', {
      p_name: newName,
      p_starts_on: newStartsOn,
      ...(planned !== null ? { p_planned_games: planned } : {}),
      p_default_format: newFormat,
      p_roster_policy: newPolicy,
    })
    setCreating(false)
    if (error) { setErr(error.message); return }
    setNewName(''); setNewStartsOn(''); setNewPlanned('')
    setNewFormat('7v7'); setNewPolicy('carry_forward')
    await load()
  }, [newName, newStartsOn, newPlanned, newFormat, newPolicy, load])

  const beginEdit = useCallback((row: SeasonRow) => {
    setEditing({ id: row.id, value: row.planned_games?.toString() ?? '' })
    setErr(null)
  }, [])

  const cancelEdit = useCallback(() => setEditing(null), [])

  const saveEdit = useCallback(async (seasonId: string) => {
    if (!editing) return
    setErr(null)
    const val = editing.value.trim() === '' ? null : Number(editing.value)
    if (val !== null && (!Number.isInteger(val) || val < 1)) {
      setErr('Planned games must be a whole number ≥ 1'); return
    }
    setSavingEdit(true)
    const { error } = await supabase.rpc('update_season_planned_games', {
      p_season_id: seasonId,
      ...(val !== null ? { p_planned_games: val } : {}),
    })
    setSavingEdit(false)
    if (error) { setErr(error.message); return }
    setEditing(null)
    await load()
  }, [editing, load])

  return (
    <div style={{ padding: '16px', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Admin · Seasons</h1>

      <form onSubmit={onCreate} style={{
        background: '#152038', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10, padding: 14, marginBottom: 20,
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
      }}>
        <div style={{ gridColumn: '1 / -1', fontWeight: 700, fontSize: 13, letterSpacing: 0.12, textTransform: 'uppercase', color: '#60a5fa' }}>New season</div>
        <label>Name
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Season 2" style={{ width: '100%' }} />
        </label>
        <label>Starts on
          <input type="date" value={newStartsOn} onChange={e => setNewStartsOn(e.target.value)} style={{ width: '100%' }} />
        </label>
        <label>Planned games (optional)
          <input type="number" min={1} value={newPlanned} onChange={e => setNewPlanned(e.target.value)} placeholder="e.g. 30" style={{ width: '100%' }} />
        </label>
        <label>Format
          <select value={newFormat} onChange={e => setNewFormat(e.target.value as MatchFormat)} style={{ width: '100%' }}>
            <option value="7v7">7v7</option>
            <option value="5v5">5v5</option>
          </select>
        </label>
        <label>Roster policy
          <select value={newPolicy} onChange={e => setNewPolicy(e.target.value as RosterPolicy)} style={{ width: '100%' }}>
            <option value="carry_forward">carry_forward</option>
            <option value="fresh">fresh</option>
          </select>
        </label>
        <div style={{ gridColumn: '1 / -1' }}>
          <button type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create season'}
          </button>
          {err && <span style={{ color: '#f87171', marginLeft: 10 }}>{err}</span>}
        </div>
      </form>

      {loading ? (
        <div>Loading…</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#8b97ad', fontSize: 11, letterSpacing: 0.1, textTransform: 'uppercase' }}>
              <th style={{ padding: '6px 4px' }}>Name</th>
              <th style={{ padding: '6px 4px' }}>Starts</th>
              <th style={{ padding: '6px 4px' }}>Planned</th>
              <th style={{ padding: '6px 4px' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {seasons.map(s => (
              <tr key={s.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <td style={{ padding: '8px 4px', fontWeight: 600 }}>{s.name}</td>
                <td style={{ padding: '8px 4px' }}>{s.starts_on}</td>
                <td style={{ padding: '8px 4px' }}>
                  {editing?.id === s.id ? (
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="number"
                        min={1}
                        value={editing.value}
                        onChange={e => setEditing({ id: s.id, value: e.target.value })}
                        style={{ width: 80 }}
                        autoFocus
                      />
                      <button type="button" disabled={savingEdit} onClick={() => saveEdit(s.id)}>
                        {savingEdit ? '…' : 'Save'}
                      </button>
                      <button type="button" onClick={cancelEdit}>Cancel</button>
                    </span>
                  ) : (
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <span>{s.planned_games ?? '—'}</span>
                      {!s.ended_at && (
                        <button type="button" onClick={() => beginEdit(s)} style={{ fontSize: 11 }}>Edit</button>
                      )}
                    </span>
                  )}
                </td>
                <td style={{ padding: '8px 4px' }}>{statusLabel(s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
