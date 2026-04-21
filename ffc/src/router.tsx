import { createBrowserRouter, Navigate } from 'react-router-dom'

import { useApp } from './lib/AppContext'
import { PublicLayout } from './layouts/PublicLayout'
import { RoleLayout } from './layouts/RoleLayout'
import { RefLayout } from './layouts/RefLayout'

import { Welcome } from './pages/Welcome'
import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { Poll } from './pages/Poll'
import { Leaderboard } from './pages/Leaderboard'
import { Profile } from './pages/Profile'
import { MatchDetail } from './pages/MatchDetail'
import { Settings } from './pages/Settings'
import { RefEntry } from './pages/RefEntry'
import { NotFound } from './pages/NotFound'
import { AdminHome } from './pages/admin/AdminHome'
import { AdminPlayers } from './pages/admin/AdminPlayers'
import { AdminMatches } from './pages/admin/AdminMatches'
import { FormationPlanner } from './pages/admin/FormationPlanner'

function HomeRoute() {
  const { session, loading } = useApp()
  if (loading) return <div className="app-loading">Loading&hellip;</div>
  if (session) return <Navigate to="/poll" replace />
  return <Welcome />
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
      { path: 'admin', element: <AdminHome /> },
      { path: 'admin/players', element: <AdminPlayers /> },
      { path: 'admin/matches', element: <AdminMatches /> },
      { path: 'admin/matches/:id/formation', element: <FormationPlanner /> },
    ],
  },
  { path: '*', element: <NotFound /> },
])
