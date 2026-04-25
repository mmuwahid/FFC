import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { useApp } from '../lib/AppContext'

/* Authenticated shell. Five tabs for everyone — the Admin entry point
 * moved into Settings → Admin platform at S034 (was a conditional 5th
 * nav tab before). Single component keeps the bottom-nav markup
 * consistent regardless of role.
 *
 * Defensive role-gate (S038): if someone hits a /poll, /matches, etc.
 * URL directly while their session has no profile (ghost-claimer mid-
 * flow, banned/rejected race, stale token), bounce back through
 * HomeRoute instead of rendering pages that assume role/profileId. */
export function RoleLayout() {
  const { session, role, loading, profileLoading } = useApp()
  if (loading || profileLoading) return <div className="app-loading">Loading&hellip;</div>
  if (!session || !role) return <Navigate to="/" replace />
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
      <nav className="app-bottom-nav" aria-label="Primary">
        <div className="app-bottom-nav-inner">
          <NavLink to="/poll" end>
            <span className="nav-ico" aria-hidden>🏠</span>
            <span className="nav-label">Home</span>
          </NavLink>
          <NavLink to="/leaderboard">
            <span className="nav-ico" aria-hidden>📊</span>
            <span className="nav-label">Leaderboard</span>
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
        </div>
      </nav>
    </div>
  )
}
