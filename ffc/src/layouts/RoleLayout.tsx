import { useCallback, useEffect, useState } from 'react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useApp } from '../lib/AppContext'
import { supabase } from '../lib/supabase'
import { AppTopBar } from '../components/AppTopBar'
import { AppDrawer } from '../components/AppDrawer'
import { NotificationsPanel } from '../components/NotificationsPanel'
import { InstallPrompt } from '../components/IosInstallPrompt'

/* Authenticated shell. S049 restructure:
 *   - Bottom nav reduced from 5 → 3 tabs (Poll · Leaderboard · Matches).
 *   - Profile + Settings moved into the avatar drawer (top-right).
 *   - Top-bar gains 🔔 bell + 32×32 avatar pill.
 *   - Bell click → NotificationsPanel; avatar click → AppDrawer.
 *   - Top-bar suppressed on /profile and /settings/* (those screens render
 *     their own .pf-nav / .st-nav back-button headers).
 *
 * Defensive role-gate (S038): if someone hits a /poll, /matches, etc.
 * URL directly while their session has no profile (ghost-claimer mid-flow,
 * banned/rejected race, stale token), bounce back through HomeRoute.
 */
export function RoleLayout() {
  const { session, profileId, role, loading, profileLoading, signOut } = useApp()
  const location = useLocation()

  // Top-bar profile data (display_name + avatar_url) — fetched once on mount,
  // refreshed on the 'ffc:profile-changed' custom event (Profile.tsx fires
  // this after avatar upload + display-name change).
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  // Bell unread count + open state.
  const [unreadCount, setUnreadCount] = useState<number>(0)
  const [bellOpen, setBellOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)
  const [notifTick, setNotifTick] = useState(0) // bumped on realtime INSERT

  const isAdmin = role === 'admin' || role === 'super_admin'

  const refreshProfile = useCallback(async (pid: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('display_name, avatar_url')
      .eq('id', pid)
      .maybeSingle()
    if (data) {
      setDisplayName(data.display_name ?? null)
      setAvatarUrl(data.avatar_url ?? null)
    }
  }, [])

  const refreshUnread = useCallback(async (pid: string) => {
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', pid)
      .is('read_at', null)
    if (typeof count === 'number') setUnreadCount(count)
  }, [])

  // Initial profile + unread count load.
  useEffect(() => {
    if (!profileId) return
    void refreshProfile(profileId)
    void refreshUnread(profileId)
  }, [profileId, refreshProfile, refreshUnread])

  // Listen for in-app profile mutations (avatar upload, name change).
  useEffect(() => {
    if (!profileId) return
    const handler = () => { void refreshProfile(profileId) }
    window.addEventListener('ffc:profile-changed', handler)
    return () => { window.removeEventListener('ffc:profile-changed', handler) }
  }, [profileId, refreshProfile])

  // Realtime notifications subscription. Bumps unread count + tick to
  // refresh the panel if it's open. `notifications` was added to the
  // supabase_realtime publication in migration 0038.
  useEffect(() => {
    if (!profileId) return
    const channel = supabase
      .channel(`notif:${profileId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${profileId}`,
        },
        () => {
          setUnreadCount(c => c + 1)
          setNotifTick(t => t + 1)
        },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [profileId])

  // Close panels on route change so backwards navigation feels right.
  useEffect(() => {
    setBellOpen(false)
    setDrawerOpen(false)
  }, [location.pathname])

  if (loading || profileLoading) return <div className="app-loading">Loading&hellip;</div>
  if (!session || !role) return <Navigate to="/" replace />

  const path = location.pathname
  const suppressTopBar =
    path === '/profile' ||
    path.startsWith('/profile/') ||
    path === '/settings' ||
    path.startsWith('/settings/')

  return (
    <div className="app-shell">
      {!suppressTopBar && (
        <AppTopBar
          displayName={displayName}
          avatarUrl={avatarUrl}
          unreadCount={unreadCount}
          onBellClick={() => { setDrawerOpen(false); setBellOpen(true) }}
          onAvatarClick={() => { setBellOpen(false); setDrawerOpen(true) }}
        />
      )}
      <main className="app-main">
        <Outlet />
      </main>
      <nav className="app-bottom-nav" aria-label="Primary">
        <div className="app-bottom-nav-inner">
          <NavLink to="/poll" end>
            <span className="nav-ico" aria-hidden>🗳️</span>
            <span className="nav-label">Poll</span>
          </NavLink>
          <NavLink to="/leaderboard">
            <span className="nav-ico" aria-hidden>🏆</span>
            <span className="nav-label">Leaderboard</span>
          </NavLink>
          <NavLink to="/matches">
            <span className="nav-ico" aria-hidden>📅</span>
            <span className="nav-label">Matches</span>
          </NavLink>
        </div>
      </nav>

      <AppDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        displayName={displayName}
        avatarUrl={avatarUrl}
        onSignOut={signOut}
        isAdmin={isAdmin}
        onInstallClick={() => setInstallOpen(true)}
      />
      <InstallPrompt open={installOpen} onClose={() => setInstallOpen(false)} />
      <NotificationsPanel
        open={bellOpen}
        onClose={() => setBellOpen(false)}
        profileId={profileId}
        refreshKey={notifTick}
        onChanged={() => { if (profileId) void refreshUnread(profileId) }}
      />
    </div>
  )
}
