import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import { PasswordInput } from '../components/PasswordInput'
import type { Database } from '../lib/database.types'

/* §3.3 Self-signup + admin approval — 3-stage flow.
 *   Stage 1 (auth)    — email/password or Google → auth.users row created.
 *   Stage 2 (who)     — claim unclaimed ghost OR declare new → pending_signups row.
 *   Stage 3 (waiting) — pending admin action; polls on mount via AppContext.
 *
 * Stage is derived from context where possible:
 *   - No session            → stage 1
 *   - Session + no role + no pending_signup row → stage 2
 *   - Session + no role + pending_signup row    → stage 3
 * We track a local override for the moment between user submitting a pending row
 * and the next render so the user isn't kicked back to stage 2.
 */

type GhostProfile = Pick<
  Database['public']['Tables']['profiles']['Row'],
  'id' | 'display_name' | 'primary_position'
>

type Banner = { kind: 'danger' | 'warn'; text: string } | null
type Stage = 'auth' | 'who' | 'waiting'

export function Signup() {
  const { session, signOut, role, profileLoading } = useApp()
  const [stage, setStage] = useState<Stage>('auth')
  const [banner, setBanner] = useState<Banner>(null)
  const [busy, setBusy] = useState(false)

  /* Stage 1 state */
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  /* Stage 2 state */
  const [ghosts, setGhosts] = useState<GhostProfile[] | null>(null)
  const [selectedGhost, setSelectedGhost] = useState<GhostProfile | null>(null)
  const [mode, setMode] = useState<'claim' | 'new'>('claim')
  const [displayName, setDisplayName] = useState('')
  const [message, setMessage] = useState('')

  /* Derive which stage to show. */
  useEffect(() => {
    if (!session) {
      setStage('auth')
      return
    }
    if (role) {
      // Approved — nothing to do on this screen; AppContext will bounce via HomeRoute.
      return
    }
    // Session but no role: check for existing pending row.
    let cancelled = false
    setBusy(true)
    supabase
      .from('pending_signups')
      .select('id')
      .eq('auth_user_id', session.user.id)
      .eq('resolution', 'pending')
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setBusy(false)
        setStage(data ? 'waiting' : 'who')
      })
    return () => {
      cancelled = true
    }
  }, [session, role])

  /* Load unclaimed ghost profiles when entering stage 2. */
  useEffect(() => {
    if (stage !== 'who' || ghosts !== null) return
    supabase
      .from('profiles')
      .select('id, display_name, primary_position')
      .is('auth_user_id', null)
      .eq('is_active', true)
      .order('display_name')
      .then(({ data, error }) => {
        if (error) {
          console.warn('[FFC] ghost list fetch failed', error.message)
          setGhosts([])
          return
        }
        setGhosts(data ?? [])
      })
  }, [stage, ghosts])

  const handleStage1 = async (e: FormEvent) => {
    e.preventDefault()
    setBanner(null)
    if (password.length < 8) {
      setBanner({ kind: 'danger', text: 'Password must be at least 8 characters.' })
      return
    }
    if (password !== confirm) {
      setBanner({ kind: 'danger', text: 'Passwords don\u2019t match.' })
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.signUp({ email, password })
    setBusy(false)
    if (error) {
      setBanner({ kind: 'danger', text: error.message })
      return
    }
    // onAuthStateChange fires → AppContext picks up session → the effect above lands us in 'who'.
  }

  const handleGoogle = async () => {
    setBanner(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/signup' },
    })
    if (error) setBanner({ kind: 'danger', text: error.message })
  }

  const handleStage2 = async (e: FormEvent) => {
    e.preventDefault()
    if (!session) return
    setBanner(null)

    const payloadName = mode === 'claim' ? selectedGhost?.display_name ?? '' : displayName.trim()
    if (!payloadName) {
      setBanner({
        kind: 'danger',
        text: mode === 'claim' ? 'Pick a name to claim first.' : 'Enter a display name.',
      })
      return
    }

    setBusy(true)
    const { error } = await supabase.from('pending_signups').insert({
      auth_user_id: session.user.id,
      display_name: payloadName,
      email: session.user.email ?? email,
      claim_profile_hint: mode === 'claim' ? selectedGhost?.id ?? null : null,
      message: message.trim() || null,
    })
    setBusy(false)
    if (error) {
      setBanner({ kind: 'danger', text: error.message })
      return
    }
    setStage('waiting')
  }

  /* ────────── Render ────────── */

  if (stage === 'auth') {
    return (
      <section className="auth-screen">
        <div className="auth-hero">
          <img className="auth-crest" src="/ffc-logo.png" alt="FFC crest" />
        </div>

        <div className="auth-progress">
          <span className="auth-progress-dot auth-progress-dot--active" />
          <span className="auth-progress-dot" />
          <span className="auth-progress-dot" />
        </div>

        <form className="auth-form" onSubmit={handleStage1} noValidate>
          {banner && (
            <div className={`auth-banner auth-banner--${banner.kind}`} role="alert">
              <span className="auth-banner-icon" aria-hidden>!</span>
              <div>{banner.text}</div>
            </div>
          )}
          <label className="auth-field">
            <span className="auth-field-label">Email</span>
            <input
              className="auth-input"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label className="auth-field">
            <span className="auth-field-label">Password</span>
            <PasswordInput
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </label>
          <label className="auth-field">
            <span className="auth-field-label">Confirm password</span>
            <PasswordInput
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
            />
          </label>
          <button type="submit" className="auth-btn auth-btn--primary" disabled={busy}>
            {busy ? 'Creating account…' : 'Continue'}
          </button>
          <div className="auth-divider">or</div>
          <button
            type="button"
            className="auth-btn auth-btn--google"
            onClick={handleGoogle}
            disabled={busy}
          >
            <span className="auth-g-glyph" aria-hidden>G</span>
            Continue with Google
          </button>
        </form>

        <div className="auth-footer">
          Already have an account? <Link to="/login" className="auth-link">Sign in</Link>
        </div>
      </section>
    )
  }

  if (stage === 'who') {
    return (
      <section className="auth-screen">
        <div className="auth-progress">
          <span className="auth-progress-dot" />
          <span className="auth-progress-dot auth-progress-dot--active" />
          <span className="auth-progress-dot" />
        </div>

        <div className="auth-who-header">
          <h1 className="auth-title">Who are you?</h1>
          <p className="auth-subtitle">Pick your name if you see it — the admin pre-seeded the roster.</p>
        </div>

        <form className="auth-form" onSubmit={handleStage2}>
          {banner && (
            <div className={`auth-banner auth-banner--${banner.kind}`} role="alert">
              <span className="auth-banner-icon" aria-hidden>!</span>
              <div>{banner.text}</div>
            </div>
          )}

          <div className="auth-section-label">I'm already in FFC</div>
          <div className="ghost-list">
            {(ghosts ?? []).map((g) => {
              const selected = mode === 'claim' && selectedGhost?.id === g.id
              return (
                <button
                  type="button"
                  key={g.id}
                  className={`ghost-row${selected ? ' ghost-row--selected' : ''}`}
                  onClick={() => {
                    setMode('claim')
                    setSelectedGhost(g)
                  }}
                >
                  <span className="ghost-avatar">
                    {g.display_name.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase()}
                  </span>
                  <span className="ghost-name">{g.display_name}</span>
                  {g.primary_position && (
                    <span className={`pos-pill pos-pill--${g.primary_position}`}>
                      {g.primary_position.toUpperCase()}
                    </span>
                  )}
                </button>
              )
            })}
            {ghosts && ghosts.length === 0 && (
              <div className="ghost-empty">No unclaimed profiles — tap "I'm new to FFC" below.</div>
            )}
          </div>

          <div className="auth-section-label">Or</div>
          <button
            type="button"
            className={`ghost-new${mode === 'new' ? ' ghost-new--active' : ''}`}
            onClick={() => {
              setMode('new')
              setSelectedGhost(null)
            }}
          >
            <span className="ghost-new-plus">＋</span>
            I'm new to FFC
          </button>

          {mode === 'new' && (
            <div className="auth-form-inset">
              <label className="auth-field">
                <span className="auth-field-label">Display name</span>
                <input
                  className="auth-input"
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How should we list you?"
                />
              </label>
              <label className="auth-field">
                <span className="auth-field-label">Note to admin (optional)</span>
                <textarea
                  className="auth-input"
                  rows={2}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="e.g. 'Friend of Mohammed — wants to join Thursdays.'"
                />
              </label>
            </div>
          )}

          <button type="submit" className="auth-btn auth-btn--primary" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit request'}
          </button>
          <p className="auth-hint auth-hint--center">
            {mode === 'claim' && selectedGhost
              ? <>Claiming <strong>{selectedGhost.display_name}</strong> — admin will confirm.</>
              : mode === 'new'
              ? <>Admin will review and add you as a new player.</>
              : <>Pick your name above, or choose "I'm new to FFC".</>}
          </p>
        </form>
      </section>
    )
  }

  // stage === 'waiting'
  return (
    <section className="auth-screen">
      <div className="auth-progress">
        <span className="auth-progress-dot" />
        <span className="auth-progress-dot" />
        <span className="auth-progress-dot auth-progress-dot--active" />
      </div>
      <div className="auth-waiting">
        <div className="auth-waiting-icon" aria-hidden>⧗</div>
        <div className="auth-waiting-copy">
          <h2>Waiting for approval</h2>
          <p>We've sent your request to an admin. You'll be in as soon as they tap Approve.</p>
          {profileLoading && <p className="auth-waiting-meta">Checking status…</p>}
        </div>
        <button type="button" className="auth-signout-link" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    </section>
  )
}
