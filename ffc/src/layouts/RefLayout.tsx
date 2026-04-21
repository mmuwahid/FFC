import { Outlet } from 'react-router-dom'

/* Anonymous ref shell (§3.4). Token-gated; intentionally stripped —
 * no bottom nav, no persistent auth chrome. */
export function RefLayout() {
  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-topbar-inner">
          <span style={{ fontWeight: 700, letterSpacing: '0.12em' }}>FFC · Ref Entry</span>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
