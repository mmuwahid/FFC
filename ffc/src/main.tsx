import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Step 0 acceptance — verify env vars resolve at build time (publishable key).
// Intentionally temporary; replaced in Step 1 with the Supabase client init.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '')
const anonKeyPrefix = anonKey.slice(0, 20)
console.log('[FFC boot] Supabase URL:', supabaseUrl, '(len:', supabaseUrl?.length ?? 0, ')')
console.log('[FFC boot] Anon key prefix:', anonKeyPrefix ? anonKeyPrefix + '…' : '(missing)', '(len:', anonKey.length, ')')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
