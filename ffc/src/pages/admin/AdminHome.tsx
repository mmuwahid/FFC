/**
 * Admin platform hub — S034 redesign.
 *
 * Lives at /admin. Entered via Settings → Admin platform (admin-only row).
 * Renders three management cards: Seasons · Players · Matches.
 * Non-admins hitting this route see the access-denied state.
 */
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import { useApp } from '../../lib/AppContext'

interface HubCard {
  to: string
  ico: string
  title: string
  help: string
}

const CARDS: HubCard[] = [
  { to: '/admin/seasons', ico: '🏆', title: 'Season management', help: 'Create · edit · end · delete seasons' },
  { to: '/admin/players', ico: '👥', title: 'Player management', help: 'Approve signups · ban · edit · reinstate' },
  { to: '/admin/matches', ico: '📅', title: 'Matches management', help: 'Create matchdays · lock roster · enter results' },
  { to: '/admin/roster-setup', ico: '⚽', title: 'Roster setup', help: 'Assign teams after captain draft · add/swap players' },
]

export function AdminHome() {
  const navigate = useNavigate()
  const { role } = useApp()
  const isAdmin = role === 'admin' || role === 'super_admin'

  // Issue #6 — when /admin opens after a route change, the page can land
  // mid-scroll because the previous route left the document scrolled. Reset
  // the window AND #root scroll on mount so the hub always opens at the top.
  useEffect(() => {
    window.scrollTo(0, 0)
    document.getElementById('root')?.scrollTo?.(0, 0)
  }, [])

  if (!isAdmin) {
    return (
      <div className="ah-root">
        <div className="as-empty">
          <h3>Admin only</h3>
          <p>This area is restricted to admins and super-admins.</p>
          <button type="button" className="auth-btn auth-btn--approve" onClick={() => navigate('/poll')}>Back to Poll</button>
        </div>
      </div>
    )
  }

  return (
    <div className="ah-root">
      <div className="ah-topbar">
        <button type="button" className="ah-back" onClick={() => navigate('/settings')}>‹ Back</button>
        <h1 className="ah-title">Admin platform</h1>
        <div className="ah-topbar-spacer" aria-hidden />
      </div>

      <div className="ah-cards">
        {CARDS.map((c) => (
          <button
            key={c.to}
            type="button"
            className="ah-card"
            onClick={() => navigate(c.to)}
          >
            <span className="ah-card-ico" aria-hidden>{c.ico}</span>
            <span className="ah-card-body">
              <span className="ah-card-title">{c.title}</span>
              <span className="ah-card-help">{c.help}</span>
            </span>
            <span className="ah-card-chev" aria-hidden>›</span>
          </button>
        ))}
      </div>
    </div>
  )
}
