import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PasswordInput } from '../components/PasswordInput'

/* §3.2 Login — email/password + Google OAuth.
 * On success, onAuthStateChange (in AppContext) handles session/profile resolution
 * and HomeRoute redirects. Error banner states: wrong credentials, unconfirmed email,
 * rejected account (pushed here via `?err=rejected` after AppContext signs out). */

type BannerKind = 'danger' | 'warn'
interface Banner {
  kind: BannerKind
  title: string
  body: string
}

function mapAuthError(message: string): Banner {
  const m = message.toLowerCase()
  if (m.includes('email not confirmed') || m.includes('email_not_confirmed')) {
    return {
      kind: 'warn',
      title: 'Check your email.',
      body: 'We sent a confirmation link to verify your address.',
    }
  }
  // Default to the "wrong credentials" styling for invalid_credentials + anything else.
  return {
    kind: 'danger',
    title: 'Wrong email or password.',
    body: 'Double-check and try again.',
  }
}

export function Login() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)

  /* If AppContext signed us out because role=rejected, surface the banner.
   * Clear the query-param once consumed so a refresh doesn't re-trigger it. */
  useEffect(() => {
    if (params.get('err') === 'rejected') {
      let body = 'Reach out to an admin if you think this is a mistake.'
      try {
        const reason = sessionStorage.getItem('ffc_reject_reason')
        if (reason) {
          body = `Reason: "${reason}". Reach out to an admin if you think this is a mistake.`
          sessionStorage.removeItem('ffc_reject_reason')
        }
      } catch {
        /* storage blocked — fall back to generic body */
      }
      setBanner({
        kind: 'danger',
        title: 'Your signup was not approved.',
        body,
      })
      params.delete('err')
      setParams(params, { replace: true })
    }
  }, [params, setParams])

  const handleSignIn = async (e: FormEvent) => {
    e.preventDefault()
    setBanner(null)
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) {
      setBanner(mapAuthError(error.message))
      return
    }
    // onAuthStateChange will fire; HomeRoute handles the destination.
    navigate('/', { replace: true })
  }

  const handleGoogle = async () => {
    setBanner(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) {
      setBanner({
        kind: 'danger',
        title: 'Google sign-in failed.',
        body: error.message,
      })
    }
  }

  return (
    <section className="auth-screen">
      <div className="auth-hero">
        <img className="auth-crest" src="/ffc-logo.png" alt="FFC crest" />
      </div>

      <form className="auth-form" onSubmit={handleSignIn} noValidate>
        {banner && (
          <div className={`auth-banner auth-banner--${banner.kind}`} role="alert">
            <span className="auth-banner-icon" aria-hidden>
              {banner.kind === 'danger' ? '!' : 'i'}
            </span>
            <div>
              <strong>{banner.title}</strong>
              <br />
              {banner.body}
            </div>
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
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </label>

        <div className="auth-row-right">
          {/* Forgot password is a stub for Step 3 — Supabase default recovery, wired in a later session. */}
          <a className="auth-link" href="#" onClick={(e) => e.preventDefault()}>
            Forgot password?
          </a>
        </div>

        <button type="submit" className="auth-btn auth-btn--primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="auth-divider">or</div>

        <button type="button" className="auth-btn auth-btn--google" onClick={handleGoogle} disabled={busy}>
          <span className="auth-g-glyph" aria-hidden>G</span>
          Continue with Google
        </button>
      </form>

      <div className="auth-footer">
        Don't have an account? <Link to="/signup" className="auth-link">Request to join</Link>
      </div>
    </section>
  )
}
