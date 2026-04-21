import { Link } from 'react-router-dom'

export function Welcome() {
  return (
    <section
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        gap: 20,
        textAlign: 'center',
      }}
    >
      <div
        aria-hidden
        style={{
          width: 96,
          height: 96,
          borderRadius: 24,
          background: 'linear-gradient(135deg, var(--accent), #8a1830)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--accent-contrast)',
          fontWeight: 800,
          fontSize: 32,
          letterSpacing: '0.06em',
          boxShadow: '0 10px 30px rgba(230,51,73,0.35)',
        }}
      >
        FFC
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1>Friends, football, Thursdays.</h1>
        <p style={{ color: 'var(--text-muted)', maxWidth: 320 }}>
          Weekly 7-a-side with the same crew. Vote on Monday, play on Thursday.
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 280 }}>
        <Link
          to="/login"
          style={{
            background: 'var(--accent)',
            color: 'var(--accent-contrast)',
            padding: '14px 18px',
            borderRadius: 12,
            fontWeight: 600,
            textAlign: 'center',
          }}
        >
          Sign in
        </Link>
        <Link
          to="/signup"
          style={{
            background: 'var(--surface)',
            color: 'var(--text)',
            padding: '14px 18px',
            borderRadius: 12,
            fontWeight: 600,
            textAlign: 'center',
            border: '1px solid var(--border)',
          }}
        >
          Request to join
        </Link>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>
        Auth wiring ships in Step 3 of V2.8.
      </p>
    </section>
  )
}
