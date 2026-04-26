import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PasswordInput } from '../components/PasswordInput'

/* §3.2-ext Reset Password — handles the Supabase recovery link callback.
 * Supabase redirects here after the user taps the password-reset email link.
 * The URL hash contains the access token; Supabase SDK picks it up via
 * onAuthStateChange (event = PASSWORD_RECOVERY) and sets a temporary session,
 * allowing updateUser({ password }) to set the new credential. */

export function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError("Passwords don’t match.")
      return
    }
    setBusy(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setDone(true)
    setTimeout(() => navigate('/', { replace: true }), 2000)
  }

  if (done) {
    return (
      <section className="auth-screen">
        <div className="auth-hero">
          <img className="auth-crest" src="/ffc-logo.png" alt="FFC crest" />
        </div>
        <div className="auth-waiting">
          <div className="auth-waiting-icon" aria-hidden>✓</div>
          <div className="auth-waiting-copy">
            <h2>Password updated</h2>
            <p>Taking you to the app&hellip;</p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="auth-screen">
      <div className="auth-hero">
        <img className="auth-crest" src="/ffc-logo.png" alt="FFC crest" />
      </div>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <h2 className="auth-title">Set new password</h2>
        {error && (
          <div className="auth-banner auth-banner--danger" role="alert">
            <span className="auth-banner-icon" aria-hidden>!</span>
            <div>{error}</div>
          </div>
        )}
        <label className="auth-field">
          <span className="auth-field-label">New password</span>
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
            placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
          />
        </label>
        <button type="submit" className="auth-btn auth-btn--primary" disabled={busy}>
          {busy ? 'Updating…' : 'Set password'}
        </button>
      </form>
    </section>
  )
}
