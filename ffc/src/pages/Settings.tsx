import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import type { Database } from '../lib/database.types'

/* §3.16 Settings — Phase 1 Depth-B (S024 slice 4).
 * Five rows: Theme · Push · Positions · Display name · Account.
 * (Leaderboard sort moved into the Leaderboard screen's own sort dropdown
 *  in S037 — no duplicate control in Settings.)
 * Push delivery backend is Phase 2; this screen only stores preferences
 * on profiles.push_prefs jsonb (migration 0015) and surfaces the permission
 * state tiles (first-visit prompt / denied fallback).
 */

type ThemePreference = Database['public']['Enums']['theme_preference']
type PlayerPosition = Database['public']['Enums']['player_position']

interface PushPrefs {
  master: boolean
  poll_open: boolean
  poll_reminder: boolean
  roster_locked: boolean
  plus_one_unlocked: boolean
  match_result_posted: boolean
  dropout_after_lock: boolean
}

interface ProfileData {
  id: string
  display_name: string
  email: string | null
  theme_preference: ThemePreference
  push_prefs: PushPrefs
  primary_position: PlayerPosition | null
  secondary_position: PlayerPosition | null
}

const DEFAULT_PUSH_PREFS: PushPrefs = {
  master: true,
  poll_open: true,
  poll_reminder: true,
  roster_locked: true,
  plus_one_unlocked: true,
  match_result_posted: true,
  dropout_after_lock: true,
}

const THEME_CHIPS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

const POSITIONS: PlayerPosition[] = ['GK', 'DEF', 'CDM', 'W', 'ST']

const PUSH_EVENTS: { key: keyof PushPrefs; label: string }[] = [
  { key: 'poll_open', label: 'Poll opens' },
  { key: 'poll_reminder', label: 'Poll reminder (2 min before close)' },
  { key: 'roster_locked', label: 'Roster locked' },
  { key: 'plus_one_unlocked', label: '+1 slot unlocked' },
  { key: 'match_result_posted', label: 'Match result posted' },
  { key: 'dropout_after_lock', label: 'Dropout after lock' },
]

function applyThemeClass(theme: ThemePreference) {
  const root = document.documentElement
  root.classList.remove('theme-light', 'theme-dark', 'theme-auto')
  if (theme === 'light') root.classList.add('theme-light')
  else if (theme === 'dark') root.classList.add('theme-dark')
  else root.classList.add('theme-auto')
}

function normalisePushPrefs(raw: unknown): PushPrefs {
  if (raw && typeof raw === 'object') {
    const r = raw as Partial<Record<keyof PushPrefs | 'position_changed', boolean>>
    return {
      master: r.master ?? true,
      poll_open: r.poll_open ?? true,
      poll_reminder: r.poll_reminder ?? true,
      roster_locked: r.roster_locked ?? true,
      plus_one_unlocked: r.plus_one_unlocked ?? true,
      match_result_posted: r.match_result_posted ?? true,
      dropout_after_lock: r.dropout_after_lock ?? true,
    }
  }
  return { ...DEFAULT_PUSH_PREFS }
}

export function Settings() {
  const navigate = useNavigate()
  const { session, signOut, role } = useApp()
  const isAdmin = role === 'admin' || role === 'super_admin'

  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Display-name row local state
  const [nameDraft, setNameDraft] = useState('')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [nameShake, setNameShake] = useState(false)

  // Push-permission state
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  )
  const [promptDismissed, setPromptDismissed] = useState(false)

  // Admin-only: pending match entries count (S047 nav badge).
  // Fetched only when role is admin/super_admin; non-admins don't see the row at all.
  const [pendingEntriesCount, setPendingEntriesCount] = useState<number>(0)

  // Delete-account toast
  const [toast, setToast] = useState<string | null>(null)

  // Load profile
  useEffect(() => {
    if (!session?.user?.id) { setLoading(false); return }
    ;(async () => {
      const { data, error: err } = await supabase
        .from('profiles')
        .select('id, display_name, email, theme_preference, push_prefs, primary_position, secondary_position')
        .eq('auth_user_id', session.user.id)
        .maybeSingle()
      if (err || !data) {
        setError("Couldn't load your settings.")
        setLoading(false)
        return
      }
      const p: ProfileData = {
        id: data.id,
        display_name: data.display_name,
        email: data.email,
        theme_preference: data.theme_preference,
        push_prefs: normalisePushPrefs(data.push_prefs),
        primary_position: data.primary_position,
        secondary_position: data.secondary_position,
      }
      setProfile(p)
      setNameDraft(p.display_name)
      setLoading(false)
    })()
  }, [session?.user?.id])

  // Admin-only: fetch pending_match_entries count for the nav badge.
  // Cheap exact-count query against a small table; runs once per Settings mount.
  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    ;(async () => {
      const { count, error: err } = await supabase
        .from('pending_match_entries')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
      if (!cancelled && !err && typeof count === 'number') {
        setPendingEntriesCount(count)
      }
    })()
    return () => { cancelled = true }
  }, [isAdmin])

  async function patchProfile(updates: Partial<Database['public']['Tables']['profiles']['Update']>) {
    if (!profile) return { ok: false }
    const { error: err } = await supabase.from('profiles').update(updates).eq('id', profile.id)
    return { ok: !err, error: err }
  }

  async function handleThemeChange(val: ThemePreference) {
    if (!profile) return
    setProfile({ ...profile, theme_preference: val })
    applyThemeClass(val)
    const res = await patchProfile({ theme_preference: val })
    if (!res.ok) setToast("Couldn't save theme. Try again.")
  }

  async function handlePositionChange(field: 'primary_position' | 'secondary_position', val: PlayerPosition | null) {
    if (!profile) return
    const next: ProfileData = { ...profile, [field]: val }
    if (field === 'primary_position' && val && next.secondary_position === val) {
      next.secondary_position = null
    }
    setProfile(next)
    const res = await patchProfile({
      primary_position: next.primary_position,
      secondary_position: next.secondary_position,
    })
    if (!res.ok) setToast("Couldn't save positions.")
  }

  async function handlePushToggle(key: keyof PushPrefs, val: boolean) {
    if (!profile) return
    // Permission coupling: turning master ON while permission === 'default' requests it
    if (key === 'master' && val && permission === 'default') {
      try {
        const result = await Notification.requestPermission()
        setPermission(result)
        if (result !== 'granted') {
          // Revert
          return
        }
      } catch {
        return
      }
    }
    const nextPrefs: PushPrefs = { ...profile.push_prefs, [key]: val }
    setProfile({ ...profile, push_prefs: nextPrefs })
    const res = await patchProfile({ push_prefs: nextPrefs as unknown as never })
    if (!res.ok) setToast("Couldn't save notification preferences.")
  }

  function isValidName(s: string) {
    return /^[A-Za-z0-9 .'\-]{2,30}$/.test(s.trim())
  }

  async function handleSaveName() {
    if (!profile) return
    const trimmed = nameDraft.trim().replace(/\s+/g, ' ')
    if (!isValidName(trimmed)) { setNameError('2–30 letters, digits, dots, apostrophes or hyphens.'); return }
    if (trimmed === profile.display_name) return
    setNameSaving(true); setNameError(null)
    const { data: conflicts } = await supabase
      .from('profiles')
      .select('id')
      .ilike('display_name', trimmed)
      .neq('id', profile.id)
      .limit(1)
    if ((conflicts?.length ?? 0) > 0) {
      setNameError("That name's taken. Try another.")
      setNameShake(true)
      setTimeout(() => setNameShake(false), 400)
      setNameSaving(false)
      return
    }
    const res = await patchProfile({ display_name: trimmed })
    if (!res.ok) {
      setNameError("Couldn't save. Try again.")
      setNameSaving(false)
      return
    }
    setProfile({ ...profile, display_name: trimmed })
    setNameDraft(trimmed)
    setNameSaving(false)
  }

  async function handleSignOut() {
    try {
      await signOut()
    } catch {
      setToast("Couldn't sign out. Check your connection.")
      return
    }
    navigate('/login')
  }

  function handleDeleteAccount() {
    setToast('Delete account — coming soon.')
  }

  if (loading) return <div className="st-loading">Loading&hellip;</div>
  if (error) return <div className="st-error">{error}</div>
  if (!profile) return <div className="st-error">No profile found.</div>

  const masterOff = !profile.push_prefs.master
  const showPromptTile = permission === 'default' && !promptDismissed
  const showDeniedTile = permission === 'denied'
  const nameDirty = nameDraft.trim() !== profile.display_name
  const nameDisabled = !nameDirty || nameSaving || !isValidName(nameDraft)

  return (
    <div className="st-screen">
      <h1 className="st-title">Settings</h1>

      {/* ============ State tiles ============ */}
      {showDeniedTile && (
        <div className="st-tile st-tile-denied">
          <div className="st-tile-title">Push is blocked by your browser</div>
          <div className="st-tile-body">Open browser site settings for FFC and set Notifications to Allow, then refresh this page.</div>
        </div>
      )}
      {showPromptTile && (
        <div className="st-tile st-tile-prompt">
          <div className="st-tile-title">Enable push notifications?</div>
          <div className="st-tile-body">Know when polls open and teams are revealed.</div>
          <div className="st-tile-actions">
            <button
              type="button"
              className="st-btn-primary"
              onClick={async () => {
                try {
                  const r = await Notification.requestPermission()
                  setPermission(r)
                  if (r === 'granted') handlePushToggle('master', true)
                } catch { /* ignore */ }
              }}
            >
              Enable notifications
            </button>
            <button
              type="button"
              className="st-btn-ghost"
              onClick={() => setPromptDismissed(true)}
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {/* ============ Row 1: Theme ============ */}
      <section className="st-section">
        <div className="st-section-label">Theme</div>
        <div className="st-chip-row">
          {THEME_CHIPS.map(c => (
            <button
              key={c.value}
              type="button"
              className={`st-chip ${profile.theme_preference === c.value ? 'st-chip-active' : ''}`}
              onClick={() => handleThemeChange(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </section>

      {/* ============ Row 2: Push notifications ============ */}
      <section className="st-section">
        <div className="st-section-head">
          <span className="st-section-label">Push notifications</span>
          <PillToggle
            on={profile.push_prefs.master}
            onChange={v => handlePushToggle('master', v)}
            disabled={showDeniedTile}
          />
        </div>
        <div className={`st-push-children ${masterOff ? 'st-push-disabled' : ''}`}>
          {PUSH_EVENTS.map(e => (
            <div key={e.key} className="st-push-item">
              <span className="st-push-label">{e.label}</span>
              <PillToggle
                on={profile.push_prefs[e.key]}
                onChange={v => handlePushToggle(e.key, v)}
                disabled={masterOff || showDeniedTile}
                compact
              />
            </div>
          ))}
          {masterOff && (
            <div className="st-push-hint">Turn the master on to receive per-event notifications. Your selections are preserved.</div>
          )}
        </div>
      </section>

      {/* ============ Row 3: Positions ============ */}
      <section className="st-section">
        <div className="st-section-label">Positions</div>
        <div className="st-positions">
          <label className="st-position-field">
            <span className="st-position-cap">Primary</span>
            <select
              value={profile.primary_position ?? ''}
              onChange={e => handlePositionChange('primary_position', (e.target.value || null) as PlayerPosition | null)}
            >
              <option value="">—</option>
              {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="st-position-field">
            <span className="st-position-cap">Secondary</span>
            <select
              value={profile.secondary_position ?? ''}
              onChange={e => handlePositionChange('secondary_position', (e.target.value || null) as PlayerPosition | null)}
            >
              <option value="">—</option>
              {POSITIONS.filter(p => p !== profile.primary_position).map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
            </select>
          </label>
        </div>
      </section>

      {/* ============ Row 4: Display name ============ */}
      <section className="st-section">
        <div className="st-section-label">Display name</div>
        <div className={`st-name-row ${nameShake ? 'st-shake' : ''}`}>
          <input
            className={`st-name-input ${nameError ? 'st-name-input-error' : ''}`}
            type="text"
            value={nameDraft}
            onChange={e => { setNameDraft(e.target.value); setNameError(null) }}
            maxLength={30}
          />
          <button
            type="button"
            className="st-name-save"
            disabled={nameDisabled}
            onClick={handleSaveName}
          >
            {nameSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {nameError && <div className="st-name-error">{nameError}</div>}
      </section>

      {/* ============ Row 5: Account ============ */}
      <section className="st-section">
        <div className="st-section-label">Account</div>
        <div className="st-account">
          <div className="st-account-email">{profile.email ?? session?.user?.email ?? '—'}</div>
          <button type="button" className="st-btn-signout" onClick={handleSignOut}>Sign out</button>
          <button type="button" className="st-btn-delete" onClick={handleDeleteAccount}>
            Delete account <span className="st-soon">coming soon</span>
          </button>
        </div>
      </section>

      {/* ============ Bottom-of-screen link to Rules ============ */}
      <section className="st-section">
        <button type="button" className="st-rules-link" onClick={() => navigate('/settings/rules')}>
          <span>League Rules</span>
          <span className="st-chevron">›</span>
        </button>
      </section>

      {/* ============ Admin platform entry — S034 (badge: S047) ============ */}
      {isAdmin && (
        <section className="st-section">
          <button type="button" className="st-admin-link" onClick={() => navigate('/admin')}>
            <span className="st-admin-link-label">
              🛠 Admin platform
              {pendingEntriesCount > 0 && (
                <span
                  className="st-admin-badge"
                  aria-label={`${pendingEntriesCount} pending match ${pendingEntriesCount === 1 ? 'entry' : 'entries'} awaiting review`}
                >
                  {pendingEntriesCount}
                </span>
              )}
            </span>
            <span className="st-chevron">›</span>
          </button>
        </section>
      )}

      {toast && (
        <div className="st-toast" onAnimationEnd={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  )
}

function PillToggle({
  on, onChange, disabled, compact,
}: {
  on: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  compact?: boolean
}) {
  return (
    <button
      type="button"
      className={`st-pill ${on ? 'st-pill-on' : 'st-pill-off'} ${compact ? 'st-pill-compact' : ''}`}
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      role="switch"
      aria-checked={on}
    >
      <span className="st-pill-knob" />
    </button>
  )
}
