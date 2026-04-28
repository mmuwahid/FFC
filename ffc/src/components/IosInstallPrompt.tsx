// ffc/src/components/IosInstallPrompt.tsx
// Phase 2 Slice 2A-B Task 4 — iOS install prompt (S050).
//
// Surfaces when an iOS user toggles push ON without having installed the PWA.
// iOS Safari only honours Web Push when the page is launched from the home-screen
// shortcut (display-mode: standalone). This portal modal walks the user through
// the 3 taps required: Share → Add to Home Screen → Open from home screen.
//
// Caller is responsible for the gate (use isIosNonStandalone() from pushSubscribe.ts)
// and for keeping the master toggle OFF until the user re-launches as a PWA.

import { createPortal } from 'react-dom'

interface IosInstallPromptProps {
  open: boolean
  onClose: () => void
}

export function IosInstallPrompt({ open, onClose }: IosInstallPromptProps) {
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
        <h2 id="iip-title" className="iip-title">Install FFC to enable push</h2>
        <p className="iip-lede">
          iPhone needs FFC on your home screen before it can show notifications. Three taps:
        </p>
        <ol className="iip-steps">
          <li>
            <span className="iip-step-num">1</span>
            <span className="iip-step-body">
              Tap the <strong>Share</strong> icon in Safari&rsquo;s bottom bar
              <span aria-hidden="true" className="iip-step-icon">⎙</span>
            </span>
          </li>
          <li>
            <span className="iip-step-num">2</span>
            <span className="iip-step-body">
              Choose <strong>Add to Home Screen</strong>
            </span>
          </li>
          <li>
            <span className="iip-step-num">3</span>
            <span className="iip-step-body">
              Open FFC from the new home-screen icon, then enable push from Settings.
            </span>
          </li>
        </ol>
        <button type="button" className="iip-close" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>,
    document.body,
  )
}
