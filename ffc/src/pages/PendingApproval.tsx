import { useApp } from '../lib/AppContext'

/* Shown to users who have a Supabase session but no matching profile row —
 * i.e. pending admin approval (or a ghost profile they haven't been bound to yet).
 * Rejected users bounce back to /login via the AppContext role check elsewhere,
 * so this component only needs to cover the pending case. */
export function PendingApproval() {
  const { signOut, session } = useApp()
  const email = session?.user?.email ?? ''

  return (
    <section className="auth-screen">
      <div className="auth-waiting">
        <div className="auth-waiting-icon" aria-hidden>⧗</div>
        <div className="auth-waiting-copy">
          <h2>Waiting for approval</h2>
          <p>We've sent your request to an admin. You'll be in as soon as they tap Approve.</p>
          {email && <p className="auth-waiting-meta">Signed in as {email}</p>}
        </div>
        <button type="button" className="auth-signout-link" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    </section>
  )
}
