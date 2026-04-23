import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface MatchdayRow {
  id: string
  kickoff_at: string
  season_id: string
  is_friendly: boolean
  friendly_flagged_at: string | null
}

type ActionState = 'idle' | 'loading' | 'error'

export function AdminMatches() {
  const [matchdays, setMatchdays] = useState<MatchdayRow[]>([])
  const [loading, setLoading] = useState(true)
  const [actionState, setActionState] = useState<Record<string, ActionState>>({})

  useEffect(() => {
    supabase
      .from('matchdays')
      .select('id, kickoff_at, season_id, is_friendly, friendly_flagged_at')
      .order('kickoff_at', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        setMatchdays(data ?? [])
        setLoading(false)
      })
  }, [])

  async function confirmFriendly(matchdayId: string) {
    setActionState(s => ({ ...s, [matchdayId]: 'loading' }))
    const { error } = await supabase.rpc('confirm_friendly_matchday', { p_matchday_id: matchdayId })
    if (error) {
      setActionState(s => ({ ...s, [matchdayId]: 'error' }))
      return
    }
    setMatchdays(prev =>
      prev.map(md => md.id === matchdayId ? { ...md, is_friendly: true } : md)
    )
    setActionState(s => ({ ...s, [matchdayId]: 'idle' }))
  }

  async function dismissFriendly(matchdayId: string) {
    setActionState(s => ({ ...s, [matchdayId]: 'loading' }))
    const { error } = await supabase.rpc('dismiss_friendly_flag', { p_matchday_id: matchdayId })
    if (error) {
      setActionState(s => ({ ...s, [matchdayId]: 'error' }))
      return
    }
    setMatchdays(prev =>
      prev.map(md => md.id === matchdayId ? { ...md, friendly_flagged_at: null, is_friendly: false } : md)
    )
    setActionState(s => ({ ...s, [matchdayId]: 'idle' }))
  }

  const pending = matchdays.filter(md => md.friendly_flagged_at && !md.is_friendly)

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Admin: Matches</h1>

      {pending.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, marginBottom: 8 }}>
            Pending Friendly Review
          </h2>
          {pending.map(md => {
            const state = actionState[md.id] ?? 'idle'
            const kickoff = new Date(md.kickoff_at)
            const dateStr = kickoff.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
            return (
              <div key={md.id} className="card" style={{ padding: '12px 16px', marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{dateStr}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: '#f59e0b',
                    background: 'rgba(245,158,11,0.15)', borderRadius: 6, padding: '2px 8px',
                  }}>
                    FRIENDLY?
                  </span>
                </div>
                {state === 'error' && (
                  <p style={{ color: 'var(--color-red, #e53935)', fontSize: 13, margin: '0 0 8px' }}>
                    Action failed — try again.
                  </p>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => confirmFriendly(md.id)}
                    disabled={state === 'loading'}
                    style={{
                      flex: 1, padding: '10px 0', borderRadius: 8, border: 'none',
                      background: 'var(--color-red, #e53935)', color: '#fff',
                      fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: state === 'loading' ? 0.6 : 1,
                    }}
                  >
                    Confirm Friendly
                  </button>
                  <button
                    onClick={() => dismissFriendly(md.id)}
                    disabled={state === 'loading'}
                    style={{
                      flex: 1, padding: '10px 0', borderRadius: 8,
                      border: '1px solid rgba(255,255,255,0.15)', background: 'transparent',
                      color: 'inherit', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                      opacity: state === 'loading' ? 0.6 : 1,
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )
          })}
        </section>
      )}

      <section>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, marginBottom: 8 }}>
          Recent Matchdays
        </h2>
        {matchdays.length === 0 && (
          <p style={{ opacity: 0.4, fontSize: 14 }}>No matchdays yet.</p>
        )}
        {matchdays.map(md => {
          const kickoff = new Date(md.kickoff_at)
          const dateStr = kickoff.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
          return (
            <div key={md.id} className="card" style={{ padding: '12px 16px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14 }}>{dateStr}</span>
              {md.is_friendly && (
                <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', background: 'rgba(156,163,175,0.15)', borderRadius: 6, padding: '2px 8px' }}>
                  FRIENDLY
                </span>
              )}
            </div>
          )
        })}
      </section>

      <p style={{ opacity: 0.4, fontSize: 13, textAlign: 'center', marginTop: 24 }}>
        §3.18 full match management (phases 1–7) coming soon
      </p>
    </div>
  )
}
