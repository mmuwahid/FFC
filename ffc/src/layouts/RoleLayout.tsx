import { NavLink, Outlet } from 'react-router-dom'
import { useApp } from '../lib/AppContext'

/* Authenticated shell. Four tabs for players; five tabs when the admin
 * layout is in effect. Single component keeps the bottom-nav markup
 * consistent and lets the admin tab appear/disappear as role changes. */
export function RoleLayout() {
  const { role } = useApp()
  const isAdmin = role === 'admin' || role === 'super_admin'

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
      <nav className="app-bottom-nav" aria-label="Primary">
        <div className="app-bottom-nav-inner">
          <NavLink to="/poll" end>
            <span className="nav-ico" aria-hidden>🏠</span>
            <span className="nav-label">Home</span>
          </NavLink>
          <NavLink to="/leaderboard">
            <span className="nav-ico" aria-hidden>📊</span>
            <span className="nav-label">Table</span>
          </NavLink>
          <NavLink to="/matches">
            <span className="nav-ico" aria-hidden>📅</span>
            <span className="nav-label">Matches</span>
          </NavLink>
          <NavLink to="/profile" end>
            <span className="nav-ico" aria-hidden>👤</span>
            <span className="nav-label">Profile</span>
          </NavLink>
          <NavLink to="/settings">
            <span className="nav-ico" aria-hidden>⚙️</span>
            <span className="nav-label">Settings</span>
          </NavLink>
          {isAdmin && (
            <NavLink to="/admin">
              <span className="nav-ico" aria-hidden>🛠</span>
              <span className="nav-label">Admin</span>
            </NavLink>
          )}
        </div>
      </nav>
    </div>
  )
}
