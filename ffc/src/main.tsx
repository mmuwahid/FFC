import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Workbox } from 'workbox-window'

import './index.css'
import App from './App'
import './lib/supabase' // side-effect: fail fast if env vars are missing

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Hide the inline splash as soon as React has committed its first render.
requestAnimationFrame(() => {
  const splash = document.getElementById('ffc-splash')
  if (!splash) return
  splash.classList.add('hide')
  splash.addEventListener('transitionend', () => splash.remove(), { once: true })
})

// Register the service worker in production only. `autoUpdate` strategy in
// vite.config.ts means each deploy's new SW takes over on the next reload.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const wb = new Workbox('/sw.js')
  wb.addEventListener('waiting', () => {
    // A new SW is ready. Ask it to activate on the next navigation; no
    // forced reload for now (avoids jarring UX during an active poll).
    wb.messageSkipWaiting()
  })
  wb.register().catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[FFC] SW registration failed:', err)
  })
}
