import { Outlet } from 'react-router-dom'

/* Anonymous shell: welcome / login / signup. No bottom nav, no admin chrome. */
export function PublicLayout() {
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
            <span className="app-topbar-title">FFC</span>
          </div>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
