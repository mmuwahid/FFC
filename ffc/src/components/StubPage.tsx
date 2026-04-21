import type { ReactNode } from 'react'

interface StubPageProps {
  /** Spec reference — e.g. "§3.7" */
  section: string
  /** Screen title — e.g. "Poll" */
  title: string
  /** Optional sub-copy, one or two short sentences. */
  children?: ReactNode
}

/* Placeholder screen for the Step 1 route skeleton. Each real screen
 * (Welcome, Poll, Leaderboard, etc.) replaces its stub one-by-one
 * starting Step 3 of V2.8. */
export function StubPage({ section, title, children }: StubPageProps) {
  return (
    <section
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        gap: 12,
        textAlign: 'center',
      }}
    >
      <p style={{ color: 'var(--text-muted)', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {section}
      </p>
      <h1>{title}</h1>
      {children && <div style={{ color: 'var(--text-muted)', maxWidth: 360 }}>{children}</div>}
    </section>
  )
}
