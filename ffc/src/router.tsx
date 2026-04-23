import { createBrowserRouter, Navigate } from 'react-router-dom'

import { useApp } from './lib/AppContext'
import { PublicLayout } from './layouts/PublicLayout'
import { RoleLayout } from './layouts/RoleLayout'
import { RefLayout } from './layouts/RefLayout'

import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { PendingApproval } from './pages/PendingApproval'
import { Poll } from './pages/Poll'
import { Leaderboard } from './pages/Leaderboard'
import { Profile } from './pages/Profile'
import { MatchDetail } from './pages/MatchDetail'
import { Settings } from './pages/Settings'
import { Rules } from './pages/Rules'
import { RefEntry } from './pages/RefEntry'
import { NotFound } from './pages/NotFound'
import { AdminHome } from './pages/admin/AdminHome'
import { AdminPlayers } from './pages/admin/AdminPlayers'
import { AdminMatches } from './pages/admin/AdminMatches'
import { FormationPlanner } from './pages/admin/FormationPlanner'

/* Root route dispatcher — decides where a session lands based on auth state.
 *   No session         → /login (Login is the app entry)
 *   Session + role     → /poll
 *   Session + no role  → <PendingApproval /> (awaiting admin, or rejected fallthrough) */
function HomeRoute() {
  const { session, role, loading, profileLoading } = useApp()
  if (loading || profileLoading) return <div className="app-loading">Loading&hellip;</div>
  if (!session) return <Navigate to="/login" replace />
  if (!role) return <PendingApproval />
  return <Navigate to="/poll" replace />
}

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { index: true, element: <HomeRoute /> },
      { path: 'login', element: <Login /> },
      { path: 'signup', element: <Signup /> },
    ],
  },
  {
    element: <RefLayout />,
    children: [{ path: 'ref/:token', element: <RefEntry /> }],
  },
  {
    element: <RoleLayout />,
    children: [
      { path: 'poll', element: <Poll /> },
      { path: 'leaderboard', element: <Leaderboard /> },
      { path: 'profile', element: <Profile /> },
      { path: 'profile/:id', element: <Profile /> },
      { path: 'match/:id', element: <MatchDetail /> },
      { path: 'settings', element: <Settings /> },
      { path: 'settings/rules', element: <Rules /> },
      { path: 'admin', element: <AdminHome /> },
      { path: 'admin/players', element: <AdminPlayers /> },
      { path: 'admin/matches', element: <AdminMatches /> },
      { path: 'admin/matches/:id/formation', element: <FormationPlanner /> },
    ],
  },
  { path: '*', element: <NotFound /> },
])
