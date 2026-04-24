import { Outlet } from 'react-router-dom'

/* Anonymous ref shell (§3.4). Token-gated; intentionally stripped —
 * no bottom nav, no persistent auth chrome. */
export function RefLayout() {
  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-topbar-inner">
          <div className="app-topbar-brand">
            <img
              className="app-topbar-logo"
              src="/ffc-logo-192.png"
              alt=""
              aria-hidden
              width="28"
              height="28"
            />
            <span className="app-topbar-title">FFC · Ref Entry</span>
          </div>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
