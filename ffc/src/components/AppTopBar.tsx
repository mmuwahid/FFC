import type { MouseEvent } from 'react'

/* S049 — sticky top-bar used by every authenticated screen except
 * Profile / Settings / Rules (which render their own .pf-nav / .st-nav /
 * .lr-nav back-button headers).
 *
 * Left:  FFC crest + wordmark (matches existing .app-topbar-brand).
 * Right: 🔔 notification bell with unread badge + 32×32 avatar pill.
 *
 * State (drawer / panel open + unread count + profile data) lives in
 * RoleLayout — this component is a dumb presentational shell.
 */

interface Props {
  /** Profile display name — used for fallback initials when no avatar_url. */
  displayName: string | null
  /** Profile avatar URL (Supabase storage public URL). Null → render initials. */
  avatarUrl: string | null
  /** Bell badge count. 0 hides the badge. >99 renders as "99+". */
  unreadCount: number
  /** Bell tap → open NotificationsPanel. */
  onBellClick: (e: MouseEvent<HTMLButtonElement>) => void
  /** Avatar tap → open AppDrawer. */
  onAvatarClick: (e: MouseEvent<HTMLButtonElement>) => void
}

export function AppTopBar({ displayName, avatarUrl, unreadCount, onBellClick, onAvatarClick }: Props) {
  const initials = (displayName ? toInitials(displayName) : '?')
  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount)
  const hasBadge = unreadCount > 0
  return (
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
        <div className="app-topbar-actions">
          <button
            type="button"
            className="app-topbar-bell"
            onClick={onBellClick}
            aria-label={hasBadge
              ? `Notifications, ${unreadCount} unread`
              : 'Notifications'}
          >
            <span aria-hidden>🔔</span>
            {hasBadge && (
              <span className="app-topbar-bell-badge" aria-hidden>{badgeText}</span>
            )}
          </button>
          <button
            type="button"
            className="app-topbar-avatar"
            onClick={onAvatarClick}
            aria-label="Open menu"
          >
            {avatarUrl
              ? <img src={avatarUrl} alt="" />
              : <span className="app-topbar-avatar-initials">{initials}</span>}
          </button>
        </div>
      </div>
    </header>
  )
}

function toInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
}
