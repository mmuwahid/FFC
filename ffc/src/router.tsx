import { createBrowserRouter, Navigate } from 'react-router-dom'

import { useApp } from './lib/AppContext'
import { PublicLayout } from './layouts/PublicLayout'
import { RoleLayout } from './layouts/RoleLayout'
import { RefLayout } from './layouts/RefLayout'

import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { Poll } from './pages/Poll'
import { Leaderboard } from './pages/Leaderboard'
import Awards from './pages/Awards'
import Payments from './pages/Payments'
import { Matches } from './pages/Matches'
import { Profile } from './pages/Profile'
import { MatchDetail } from './pages/MatchDetail'
import { Settings } from './pages/Settings'
import { Rules } from './pages/Rules'
import { RefEntry } from './pages/RefEntry'
import { ResetPassword } from './pages/ResetPassword'
import { NotFound } from './pages/NotFound'
import { AdminHome } from './pages/admin/AdminHome'
import { AdminPlayers } from './pages/admin/AdminPlayers'
import { AdminMatches } from './pages/admin/AdminMatches'
import { AdminSeasons } from './pages/admin/AdminSeasons'
import { MatchEntryReview } from './pages/admin/MatchEntryReview'
import { CaptainHelper } from './pages/admin/CaptainHelper' // §3.1-v2
import { FormationPlanner } from './pages/FormationPlanner' // §3.19
import { AdminRosterSetup } from './pages/admin/AdminRosterSetup' // §issue-11

/* Root route dispatcher — decides where a session lands based on auth state.
 *   No session         → /login
 *   Session + role     → /poll
 *   Session + no role  → /signup  (Signup.tsx self-derives the right stage:
 *                                   stage 'who' = ghost-picker if no pending row
 *                                   stage 'waiting' = if pending row exists)
 *
 * S038 fix: previously rendered <PendingApproval /> here, which left
 * Google-OAuth ghost-claimers (e.g. Barhoom) with no path forward — they
 * had a session but no profile AND no pending_signups row, so admins never
 * saw them in the queue. Routing through /signup reuses Signup.tsx Stage 2,
 * which inserts the pending_signups row and surfaces the claim hint to
 * admin via approve_signup(p_claim_profile_id). PendingApproval.tsx is
 * now dead code (file kept for git-history simplicity, not imported). */
function HomeRoute() {
  const { session, role, loading, profileLoading } = useApp()
  if (loading || profileLoading) return (
    <div className="app-splash">
      <img className="app-splash__crest" src="/ffc-logo.svg" alt="" aria-hidden="true" />
    </div>
  )
  if (!session) return <Navigate to="/login" replace />
  if (!role) return <Navigate to="/signup" replace />
  return <Navigate to="/poll" replace />
}

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { index: true, element: <HomeRoute /> },
      { path: 'login', element: <Login /> },
      { path: 'signup', element: <Signup /> },
      { path: 'reset-password', element: <ResetPassword /> },
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
      { path: 'awards', element: <Awards /> },
      { path: 'payments', element: <Payments /> },
      { path: 'matches', element: <Matches /> },
      { path: 'profile', element: <Profile /> },
      { path: 'profile/:id', element: <Profile /> },
      { path: 'match/:id', element: <MatchDetail /> },
      { path: 'match/:id/formation', element: <FormationPlanner /> },
      { path: 'matchday/:id/captains', element: <CaptainHelper /> },
      { path: 'settings', element: <Settings /> },
      { path: 'settings/rules', element: <Rules /> },
      { path: 'admin', element: <AdminHome /> },
      { path: 'admin/players', element: <AdminPlayers /> },
      { path: 'admin/matches', element: <AdminMatches /> },
      { path: 'admin/seasons', element: <AdminSeasons /> },
      { path: 'admin/match-entries/:id', element: <MatchEntryReview /> },
      { path: 'admin/roster-setup', element: <AdminRosterSetup /> },
    ],
  },
  { path: '*', element: <NotFound /> },
])
