import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Step 0 acceptance — verify env vars resolve at build time.
// Intentionally temporary; replaced in Step 1 with the Supabase client init.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const anonKeyPrefix = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').slice(0, 16)
console.log('[FFC boot] Supabase URL:', supabaseUrl)
console.log('[FFC boot] Anon key prefix:', anonKeyPrefix ? anonKeyPrefix + '…' : '(missing)')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
