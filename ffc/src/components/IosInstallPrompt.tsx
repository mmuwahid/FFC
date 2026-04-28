// ffc/src/components/IosInstallPrompt.tsx
// Phase 2 Slice 2A-B Task 4 — install prompt (S050).
// S051 — extended into a tabbed iOS / Android install guide so the avatar
// drawer can surface a generic "📲 Install app" affordance for everyone, not
// just the iOS push-gating flow.
//
// The component still exports IosInstallPrompt for back-compat with Settings'
// push-gate path; the new InstallPrompt export is what the drawer hooks into.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface InstallPromptProps {
  open: boolean
  onClose: () => void
  /** Force a specific tab open. Default = 'auto' which picks based on UA. */
  initialTab?: 'ios' | 'android' | 'auto'
}

function detectPlatform(): 'ios' | 'android' {
  if (typeof navigator === 'undefined') return 'ios'
  const ua = navigator.userAgent.toLowerCase()
  if (/iphone|ipad|ipod/.test(ua)) return 'ios'
  if (/android/.test(ua)) return 'android'
  // Default to iOS on desktop — most desktop users won't see this prompt anyway.
  return 'ios'
}

export function InstallPrompt({ open, onClose, initialTab = 'auto' }: InstallPromptProps) {
  const [tab, setTab] = useState<'ios' | 'android'>(
    initialTab === 'auto' ? detectPlatform() : initialTab,
  )

  // Reset tab when re-opened so each open lands on the active platform.
  useEffect(() => {
    if (open && initialTab === 'auto') setTab(detectPlatform())
  }, [open, initialTab])

  if (!open) return null

  return createPortal(
    <div
      className="iip-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="iip-title"
      onClick={onClose}
    >
      <div className="iip-sheet" onClick={e => e.stopPropagation()}>
        <h2 id="iip-title" className="iip-title">Install FFC on your phone</h2>
        <p className="iip-lede">
          Add FFC to your home screen for a full-screen, app-like experience and to enable push notifications.
        </p>

        <div className="iip-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'ios'}
            className={`iip-tab${tab === 'ios' ? ' iip-tab--active' : ''}`}
            onClick={() => setTab('ios')}
          >
            iPhone / iPad
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'android'}
            className={`iip-tab${tab === 'android' ? ' iip-tab--active' : ''}`}
            onClick={() => setTab('android')}
          >
            Android
          </button>
        </div>

        {tab === 'ios' ? (
          <ol className="iip-steps">
            <li>
              <span className="iip-step-num">1</span>
              <span className="iip-step-body">
                Open FFC in <strong>Safari</strong> (not Chrome on iOS).
              </span>
            </li>
            <li>
              <span className="iip-step-num">2</span>
              <span className="iip-step-body">
                Tap the <strong>Share</strong> icon in Safari's bottom bar
                <span aria-hidden="true" className="iip-step-icon">⎙</span>
              </span>
            </li>
            <li>
              <span className="iip-step-num">3</span>
              <span className="iip-step-body">
                Choose <strong>Add to Home Screen</strong>, then tap Add.
              </span>
            </li>
            <li>
              <span className="iip-step-num">4</span>
              <span className="iip-step-body">
                Open FFC from the new home-screen icon. Push notifications can now be enabled from Settings.
              </span>
            </li>
          </ol>
        ) : (
          <ol className="iip-steps">
            <li>
              <span className="iip-step-num">1</span>
              <span className="iip-step-body">
                Open FFC in <strong>Chrome</strong>.
              </span>
            </li>
            <li>
              <span className="iip-step-num">2</span>
              <span className="iip-step-body">
                Tap the <strong>⋮</strong> menu (top-right).
              </span>
            </li>
            <li>
              <span className="iip-step-num">3</span>
              <span className="iip-step-body">
                Choose <strong>Add to Home screen</strong> or <strong>Install app</strong>, then confirm.
              </span>
            </li>
            <li>
              <span className="iip-step-num">4</span>
              <span className="iip-step-body">
                Launch FFC from the new icon. Push notifications can be enabled from Settings.
              </span>
            </li>
          </ol>
        )}

        <button type="button" className="iip-close" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>,
    document.body,
  )
}

/** Back-compat alias for the existing iOS push-gate caller in Settings.tsx. */
export function IosInstallPrompt(props: { open: boolean; onClose: () => void }) {
  return <InstallPrompt {...props} initialTab="ios" />
}
