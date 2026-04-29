// ffc/src/pages/Payments.tsx
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import PaymentLedgerSheet from './PaymentLedgerSheet'

interface SeasonRow {
  id: string
  name: string
  starts_on: string
  ended_at: string | null
}

interface SummaryRow {
  profile_id: string | null
  guest_id: string | null
  display_name: string | null
  avatar_url: string | null
  matches_played: number
  matches_paid: number
  total_owed_aed: number
  total_paid_aed: number
  outstanding_aed: number
}

interface OpenWindow {
  match_id: string
}

interface SheetTarget {
  profileId?: string
  guestId?: string
  displayName: string
}

export default function Payments() {
  const { role } = useApp()
  const isAdmin = role === 'admin' || role === 'super_admin'
  const [searchParams] = useSearchParams()
  const seasonIdParam = searchParams.get('season_id')

  const [seasons, setSeasons] = useState<SeasonRow[]>([])
  const [season, setSeason] = useState<SeasonRow | null>(null)
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [openWindow, setOpenWindow] = useState<OpenWindow | null>(null)
  const [loading, setLoading] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sheetTarget, setSheetTarget] = useState<SheetTarget | null>(null)

  const loadSummary = useCallback(async (targetSeasonId: string) => {
    const [{ data: rows }, { data: approvedMatches }] = await Promise.all([
      supabase.rpc('get_season_payment_summary', { p_season_id: targetSeasonId })
        .returns<SummaryRow[]>(),
      supabase
        .from('matches')
        .select('id')
        .eq('season_id', targetSeasonId)
        .not('approved_at', 'is', null),
    ])
    setSummary(rows ?? [])
    const matchIds = (approvedMatches ?? []).map((m: { id: string }) => m.id)
    if (matchIds.length) {
      const { data: win } = await supabase
        .from('payment_windows')
        .select('match_id')
        .in('match_id', matchIds)
        .is('closed_at', null)
        .limit(1)
        .maybeSingle()
      setOpenWindow(win ?? null)
    } else {
      setOpenWindow(null)
    }
  }, [])

  // Initial boot — load seasons + summary
  useEffect(() => {
    let cancelled = false
    async function boot() {
      setLoading(true)
      const { data: allSeasons } = await supabase
        .from('seasons')
        .select('id, name, starts_on, ended_at')
        .order('starts_on', { ascending: false })
        .returns<SeasonRow[]>()
      if (cancelled) return
      const target = (() => {
        if (!allSeasons?.length) return null
        if (seasonIdParam) return allSeasons.find(s => s.id === seasonIdParam) ?? null
        return allSeasons.find(s => s.ended_at == null) ?? allSeasons[0]
      })()
      setSeasons(allSeasons ?? [])
      setSeason(target)
      if (target) await loadSummary(target.id)
      if (!cancelled) setLoading(false)
    }
    boot()
    return () => { cancelled = true }
  }, [seasonIdParam, loadSummary])

  // Realtime subscription
  useEffect(() => {
    if (!season) return
    const channel = supabase
      .channel(`payments-season-${season.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'match_payment_records',
      }, () => { loadSummary(season.id) })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'payment_windows',
      }, () => { loadSummary(season.id) })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [season, loadSummary])

  const totalOwed   = summary.reduce((s, r) => s + r.total_owed_aed, 0)
  const totalPaid   = summary.reduce((s, r) => s + r.total_paid_aed, 0)
  const outstanding = totalOwed - totalPaid

  function initials(name: string | null) {
    if (!name) return '?'
    return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('')
  }

  function balanceLabel(row: SummaryRow) {
    if (row.outstanding_aed === 0) return '✓ 0'
    return `−${row.outstanding_aed}`
  }

  function balanceClass(row: SummaryRow) {
    if (row.outstanding_aed === 0) return 'py-balance-amt--paid'
    if (row.outstanding_aed < row.total_owed_aed) return 'py-balance-amt--partial'
    return 'py-balance-amt--owed'
  }

  return (
    <div className="py-screen">
      {/* Header */}
      <div className="py-header">
        <span className="py-header-title">💰 Payments</span>
        {seasons.length > 1 && (
          <button
            type="button"
            className="py-season-pill"
            onClick={() => setPickerOpen(p => !p)}
          >
            {season?.name ?? '—'} ▾
          </button>
        )}
        {seasons.length === 1 && (
          <span className="py-season-pill py-season-pill--static">{season?.name ?? '—'}</span>
        )}
      </div>

      {/* Season picker dropdown */}
      {pickerOpen && (
        <div className="py-picker-overlay" onClick={() => setPickerOpen(false)}>
          <div className="py-picker" onClick={e => e.stopPropagation()}>
            {seasons.map(s => (
              <button
                key={s.id}
                type="button"
                className={`py-picker-item${s.id === season?.id ? ' py-picker-item--active' : ''}`}
                onClick={() => { setSeason(s); setPickerOpen(false) }}
              >
                {s.name}{s.ended_at ? '' : ' · Active'}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-loading">Loading…</div>
      ) : (
        <>
          {/* Summary strip */}
          <div className="py-summary">
            <div className="py-sbox">
              <div className="py-sbox-amt py-sbox-amt--paid">{totalPaid.toLocaleString()}</div>
              <div className="py-sbox-lbl">Collected</div>
            </div>
            <div className="py-sbox">
              <div className="py-sbox-amt py-sbox-amt--owed">{outstanding.toLocaleString()}</div>
              <div className="py-sbox-lbl">Owed</div>
            </div>
            <div className="py-sbox">
              <div className="py-sbox-amt py-sbox-amt--total">{totalOwed.toLocaleString()}</div>
              <div className="py-sbox-lbl">Total</div>
            </div>
          </div>

          {/* Open collection window banner */}
          {openWindow && (
            <div className="py-banner py-banner--open">
              <span className="py-banner-icon">⏳</span>
              <span className="py-banner-text">Collection open · close before next match</span>
            </div>
          )}

          {/* No-data state */}
          {summary.length === 0 ? (
            <div className="py-empty">No matches played this season yet.</div>
          ) : (
            <div className="py-list">
              {summary.map(row => {
                const key = row.profile_id ?? row.guest_id ?? row.display_name ?? 'unknown'
                return (
                  <button
                    key={key}
                    type="button"
                    className="py-card"
                    onClick={() => setSheetTarget({
                      profileId: row.profile_id ?? undefined,
                      guestId:   row.guest_id   ?? undefined,
                      displayName: row.display_name ?? 'Unknown',
                    })}
                  >
                    <div className="py-avatar">
                      {row.avatar_url
                        ? <img src={row.avatar_url} alt="" />
                        : <span>{initials(row.display_name)}</span>}
                    </div>
                    <div className="py-card-info">
                      <div className="py-card-name">{row.display_name ?? 'Unknown'}</div>
                      <div className="py-card-meta">
                        {row.matches_paid} of {row.matches_played} matches
                        {row.guest_id ? ' · Guest' : ''}
                      </div>
                    </div>
                    <div className="py-balance">
                      <div className={`py-balance-amt ${balanceClass(row)}`}>
                        {balanceLabel(row)}
                      </div>
                      <div className="py-balance-lbl">AED</div>
                    </div>
                    <span className="py-card-chevron" aria-hidden>›</span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Player ledger sheet */}
      {sheetTarget && season && (
        <PaymentLedgerSheet
          profileId={sheetTarget.profileId}
          guestId={sheetTarget.guestId}
          displayName={sheetTarget.displayName}
          seasonId={season.id}
          isAdmin={isAdmin}
          onClose={() => setSheetTarget(null)}
          onPaymentMarked={() => {
            loadSummary(season.id)
            setSheetTarget(null)
          }}
        />
      )}
    </div>
  )
}
