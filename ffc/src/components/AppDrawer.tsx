import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'

/* S049 — right-side slide-in drawer triggered by the top-bar avatar.
 * Replaces the Profile + Settings tabs that used to live in the bottom nav.
 *
 * Three rows: Profile · Settings · Sign out.
 * Backdrop tap or ESC closes; drawer state owned by RoleLayout.
 */

interface Props {
  open: boolean
  onClose: () => void
  /** Display name shown in the drawer header. */
  displayName: string | null
  /** Avatar URL — null falls back to initials inside the header avatar. */
  avatarUrl: string | null
  /** Sign out — provided by AppContext, threaded through RoleLayout. */
  onSignOut: () => Promise<void>
  /** True for admin / super-admin — surfaces the Admin platform row (S051 issue #4). */
  isAdmin?: boolean
  /** Open the install-instructions modal. RoleLayout owns the modal state. */
  onInstallClick?: () => void
}

export function AppDrawer({ open, onClose, displayName, avatarUrl, onSignOut, isAdmin, onInstallClick }: Props) {
  const navigate = useNavigate()

  // ESC + lock scroll while open
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  function go(path: string) {
    onClose()
    navigate(path)
  }

  async function handleSignOut() {
    onClose()
    try {
      await onSignOut()
    } finally {
      navigate('/login')
    }
  }

  const initials = displayName ? toInitials(displayName) : '?'

  return createPortal(
    <div className="app-drawer-root" role="dialog" aria-modal="true" aria-label="Account menu">
      <button
        type="button"
        className="app-drawer-backdrop"
        onClick={onClose}
        aria-label="Close menu"
      />
      <div className="app-drawer-panel">
        <div className="app-drawer-header">
          <div className="app-drawer-avatar">
            {avatarUrl
              ? <img src={avatarUrl} alt="" />
              : <span>{initials}</span>}
          </div>
          <div className="app-drawer-name">{displayName ?? 'Player'}</div>
        </div>
        <nav className="app-drawer-nav">
          <button
            type="button"
            className="app-drawer-item"
            onClick={() => go('/profile')}
          >
            <span className="app-drawer-item-ico" aria-hidden>👤</span>
            <span className="app-drawer-item-label">Profile</span>
            <span className="app-drawer-chevron" aria-hidden>›</span>
          </button>
          <button
            type="button"
            className="app-drawer-item"
            onClick={() => go('/settings')}
          >
            <span className="app-drawer-item-ico" aria-hidden>⚙️</span>
            <span className="app-drawer-item-label">Settings</span>
            <span className="app-drawer-chevron" aria-hidden>›</span>
          </button>
          {isAdmin && (
            <button
              type="button"
              className="app-drawer-item"
              onClick={() => go('/admin')}
            >
              <span className="app-drawer-item-ico" aria-hidden>🛠️</span>
              <span className="app-drawer-item-label">Admin platform</span>
              <span className="app-drawer-chevron" aria-hidden>›</span>
            </button>
          )}
          <button
            type="button"
            className="app-drawer-item"
            onClick={() => { onClose(); onInstallClick?.() }}
          >
            <span className="app-drawer-item-ico" aria-hidden>📲</span>
            <span className="app-drawer-item-label">Install app</span>
            <span className="app-drawer-chevron" aria-hidden>›</span>
          </button>
          <button
            type="button"
            className="app-drawer-item app-drawer-item--danger"
            onClick={handleSignOut}
          >
            <span className="app-drawer-item-ico" aria-hidden>🚪</span>
            <span className="app-drawer-item-label">Sign out</span>
          </button>
        </nav>
      </div>
    </div>,
    document.body,
  )
}

function toInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
}
