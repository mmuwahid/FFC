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
          <NavLink to="/poll" end>Home</NavLink>
          <NavLink to="/leaderboard">Leaderboard</NavLink>
          <NavLink to="/profile" end>Profile</NavLink>
          <NavLink to="/settings">Settings</NavLink>
          {isAdmin && <NavLink to="/admin">Admin</NavLink>}
        </div>
      </nav>
    </div>
  )
}
