import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import {
  isIosNonStandalone,
  subscribeAndPersist,
  unsubscribeAndDelete,
} from '../lib/pushSubscribe'
import { IosInstallPrompt } from '../components/IosInstallPrompt'
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
  vote_reminder: boolean
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
  vote_reminder: true,
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
  { key: 'vote_reminder', label: 'Vote reminders (24h · 3h · 15m before close)' },
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
      vote_reminder: r.vote_reminder ?? true,
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
  const { session, signOut } = useApp()
  // S051 issue #4 — Admin platform link moved out of Settings into the avatar drawer.
  // The role check + pending-count fetch that used to live here have been removed.

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

  // Master push toggle wiring (S050 Task 5)
  const [masterBusy, setMasterBusy] = useState(false)
  const [masterError, setMasterError] = useState<string | null>(null)
  const [iosInstallOpen, setIosInstallOpen] = useState(false)

  // Delete-account state (S049 — RPC live; soft-delete via migration 0040)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteText, setDeleteText] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Generic toast
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

    if (key === 'master') {
      // Master gates the full subscribe/unsubscribe lifecycle.
      // Children just write to push_prefs jsonb.
      await handleMasterToggle(val)
      return
    }

    const nextPrefs: PushPrefs = { ...profile.push_prefs, [key]: val }
    setProfile({ ...profile, push_prefs: nextPrefs })
    const res = await patchProfile({ push_prefs: nextPrefs as unknown as never })
    if (!res.ok) setToast("Couldn't save notification preferences.")
  }

  async function handleMasterToggle(val: boolean) {
    if (!profile || masterBusy) return
    setMasterError(null)

    if (val) {
      // ===== Master ON ===========================================
      // 1. iOS gate: if we're on iPhone/iPad outside a PWA, point them at the install flow.
      if (isIosNonStandalone()) {
        setIosInstallOpen(true)
        return // master stays OFF
      }
      // 2. Permission gate.
      let perm: NotificationPermission | 'unsupported' = permission
      if (permission === 'default') {
        try {
          perm = await Notification.requestPermission()
          setPermission(perm)
        } catch {
          setMasterError("Couldn't request notification permission.")
          return
        }
      }
      if (perm !== 'granted') {
        // Permission denied or unsupported — leave master OFF.
        return
      }
      // 3. Subscribe + persist + flip the pref.
      setMasterBusy(true)
      const sub = await subscribeAndPersist(profile.id)
      if (!sub.ok) {
        setMasterBusy(false)
        setMasterError(sub.reason || "Couldn't enable push.")
        return
      }
      const nextPrefs: PushPrefs = { ...profile.push_prefs, master: true }
      setProfile({ ...profile, push_prefs: nextPrefs })
      const res = await patchProfile({ push_prefs: nextPrefs as unknown as never })
      setMasterBusy(false)
      if (!res.ok) {
        setMasterError("Saved subscription but couldn't update preferences. Try again.")
      }
      return
    }

    // ===== Master OFF ============================================
    setMasterBusy(true)
    const unsub = await unsubscribeAndDelete(profile.id)
    if (!unsub.ok) {
      setMasterBusy(false)
      setMasterError(unsub.reason || "Couldn't disable push.")
      return
    }
    const nextPrefs: PushPrefs = { ...profile.push_prefs, master: false }
    setProfile({ ...profile, push_prefs: nextPrefs })
    const res = await patchProfile({ push_prefs: nextPrefs as unknown as never })
    setMasterBusy(false)
    if (!res.ok) {
      setMasterError("Removed subscription but couldn't update preferences.")
    }
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
    // S049 — notify top-bar to refetch display name.
    window.dispatchEvent(new Event('ffc:profile-changed'))
  }

  function openDeleteSheet() {
    setDeleteOpen(true)
    setDeleteText('')
    setDeleteError(null)
  }

  async function confirmDelete() {
    if (deleteText.trim() !== 'DELETE') {
      setDeleteError('Type DELETE in capitals to confirm.')
      return
    }
    setDeleteBusy(true)
    setDeleteError(null)
    const { error: err } = await supabase.rpc('delete_my_account')
    if (err) {
      setDeleteError(err.message ?? "Couldn't delete account. Try again.")
      setDeleteBusy(false)
      return
    }
    // Success — sign out + leave the screen.
    try { await signOut() } catch { /* ignore */ }
    navigate('/login', { replace: true })
  }

  if (loading) return (
    <div className="st-screen">
      <button type="button" className="st-back" aria-label="Back" disabled>‹ Back</button>
      <h1 className="st-title">Settings</h1>
      <div className="st-skel" aria-label="Loading settings">
        <div className="st-skel-tile app-skel-block" />
        <div className="st-skel-section">
          <div className="st-skel-line-lg app-skel-block" />
          <div className="st-skel-line-md app-skel-block" />
          <div className="st-skel-line-sm app-skel-block" />
        </div>
        <div className="st-skel-section">
          <div className="st-skel-row">
            <div className="st-skel-line-md app-skel-block" />
            <div className="st-skel-toggle app-skel-block" />
          </div>
          <div className="st-skel-row">
            <div className="st-skel-line-md app-skel-block" />
            <div className="st-skel-toggle app-skel-block" />
          </div>
          <div className="st-skel-row">
            <div className="st-skel-line-md app-skel-block" />
            <div className="st-skel-toggle app-skel-block" />
          </div>
        </div>
      </div>
    </div>
  )
  if (error) return <div className="st-error">{error}</div>
  if (!profile) return <div className="st-error">No profile found.</div>

  const masterOff = !profile.push_prefs.master
  const showPromptTile = permission === 'default' && !promptDismissed
  const showDeniedTile = permission === 'denied'
  const nameDirty = nameDraft.trim() !== profile.display_name
  const nameDisabled = !nameDirty || nameSaving || !isValidName(nameDraft)

  return (
    <div className="st-screen">
      {/* Issue #4 — back button so the user can leave Settings without
       * resorting to OS back-gestures or the bottom nav. */}
      <button type="button" className="st-back" onClick={() => navigate(-1)} aria-label="Back">
        ‹ Back
      </button>
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
              onClick={() => handlePushToggle('master', true)}
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
            disabled={showDeniedTile || masterBusy}
          />
        </div>
        {masterBusy && (
          <div className="st-push-hint">Working&hellip;</div>
        )}
        {masterError && (
          <div className="st-push-hint" style={{ color: 'var(--danger, #e63349)' }}>{masterError}</div>
        )}
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
      <IosInstallPrompt open={iosInstallOpen} onClose={() => setIosInstallOpen(false)} />

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

      {/* ============ League Rules link ============ */}
      <section className="st-section">
        <button type="button" className="st-rules-link" onClick={() => navigate('/settings/rules')}>
          <span>League Rules</span>
          <span className="st-chevron">›</span>
        </button>
      </section>

      {/* ============ Account (S051 issue #4 layout, S059 issue #31 trim) ===
       * Issue #31 — sign-out lives on the avatar drawer; the duplicate
       * Sign-out button here was removed. Account row now shows email +
       * Delete-account only. */}
      <section className="st-section">
        <div className="st-section-label">Account</div>
        <div className="st-account-row">
          <span className="st-account-row-email" title={profile.email ?? session?.user?.email ?? ''}>
            {profile.email ?? session?.user?.email ?? '—'}
          </span>
          <button type="button" className="st-btn-delete st-btn-delete--active" onClick={openDeleteSheet}>
            Delete account
          </button>
        </div>
      </section>

      {toast && (
        <div className="st-toast" onAnimationEnd={() => setToast(null)}>
          {toast}
        </div>
      )}

      {deleteOpen && createPortal(
        <div className="st-delete-root" role="dialog" aria-modal="true" aria-label="Delete account">
          <button
            type="button"
            className="st-delete-backdrop"
            onClick={() => !deleteBusy && setDeleteOpen(false)}
            aria-label="Cancel"
          />
          <div className="st-delete-panel">
            <div className="st-delete-title">Delete account?</div>
            <div className="st-delete-body">
              <p>This action soft-deletes your profile. Your stats stay on the leaderboard as <strong>Deleted player</strong> so historical match results remain intact.</p>
              <p>You can rejoin later by signing up again — an admin will need to re-approve you.</p>
              <p className="st-delete-confirm-prompt">Type <strong>DELETE</strong> to confirm:</p>
              <input
                className="st-delete-input"
                type="text"
                value={deleteText}
                onChange={(e) => { setDeleteText(e.target.value); setDeleteError(null) }}
                placeholder="DELETE"
                autoCapitalize="characters"
                disabled={deleteBusy}
              />
              {deleteError && <div className="st-delete-error">{deleteError}</div>}
            </div>
            <div className="st-delete-actions">
              <button
                type="button"
                className="st-delete-cancel"
                onClick={() => setDeleteOpen(false)}
                disabled={deleteBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="st-delete-confirm"
                onClick={confirmDelete}
                disabled={deleteBusy || deleteText.trim() !== 'DELETE'}
              >
                {deleteBusy ? 'Deleting…' : 'Delete account'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
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
