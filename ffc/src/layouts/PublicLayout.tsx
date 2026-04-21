import { Outlet } from 'react-router-dom'

/* Anonymous shell: welcome / login / signup. No bottom nav, no admin chrome. */
export function PublicLayout() {
  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-topbar-inner">
          <span style={{ fontWeight: 700, letterSpacing: '0.12em' }}>FFC</span>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
