// supabase/functions/render-match-card/index.ts
// V3.0:140 — Phase 3 WhatsApp Share PNG.
// Renders a 1080x1080 PNG of an approved match result, caches by match_id
// in the match-cards storage bucket, returns a 15-min signed URL.
//
// Auth model: caller's user JWT verified via supabase.auth.getUser; admin
// gating happens server-side inside get_match_card_payload (RPC raises
// 'Admin role required' on non-admins).
//
// Storage uploads use a service-role client because the bucket's RLS only
// permits service_role writes.

import { createClient } from '@supabase/supabase-js'
import satori from 'satori'
import { Resvg, initWasm } from '@resvg/resvg-wasm'
import { MatchCard } from './MatchCard.tsx'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
// Note (S048 lesson): SUPABASE_SERVICE_ROLE_KEY auto-injected by Supabase
// is the new sb_secret_* format; supabase-js needs the legacy JWT format
// for RLS-bypassing service-role connections. We use a separately-set
// LEGACY_SERVICE_ROLE_JWT env var.
const LEGACY_SERVICE_ROLE_JWT = Deno.env.get('LEGACY_SERVICE_ROLE_JWT')!

// === Module-scope cache ===
const fontInter = await Deno.readFile(new URL('./fonts/Inter-SemiBold.ttf', import.meta.url))
const fontPlayfair = await Deno.readFile(new URL('./fonts/PlayfairDisplay-Bold.ttf', import.meta.url))
const crestSvgBytes = await Deno.readFile(new URL('./ffc-crest.svg', import.meta.url))
const crestDataUri = 'data:image/svg+xml;base64,' + btoa(new TextDecoder().decode(crestSvgBytes))

// Resvg WASM — fetch once at module init.
const resvgWasm = await fetch('https://unpkg.com/@resvg/resvg-wasm@2/index_bg.wasm')
  .then(r => r.arrayBuffer())
await initWasm(resvgWasm)

const FONTS = [
  { name: 'Inter', data: fontInter, weight: 600 as const, style: 'normal' as const },
  { name: 'Playfair Display', data: fontPlayfair, weight: 700 as const, style: 'normal' as const },
]

const SERVICE_CLIENT = createClient(SUPABASE_URL, LEGACY_SERVICE_ROLE_JWT, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// CORS — allow the deployed app origin and localhost dev.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  // 1. Verify caller JWT
  const auth = req.headers.get('Authorization') ?? ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return jsonResponse({ error: 'Missing Authorization header' }, 401)

  const userClient = createClient(SUPABASE_URL, LEGACY_SERVICE_ROLE_JWT, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: userRes, error: userErr } = await userClient.auth.getUser(jwt)
  if (userErr || !userRes.user) return jsonResponse({ error: 'Invalid token' }, 401)

  // 2. Parse body
  let body: { match_id?: string; force?: boolean } = {}
  try { body = await req.json() } catch { /* default {} */ }
  const matchId = body.match_id
  const force = body.force === true
  if (!matchId || !/^[0-9a-f-]{36}$/i.test(matchId)) {
    return jsonResponse({ error: 'Invalid match_id' }, 422)
  }

  // 3. Cache check (skip if force=true)
  const cacheKey = `${matchId}.png`
  if (!force) {
    const { data: existing } = await SERVICE_CLIENT.storage
      .from('match-cards').list('', { search: cacheKey, limit: 1 })
    if (existing && existing.some(o => o.name === cacheKey)) {
      return await signAndReturn(cacheKey)
    }
  }

  // 4. Fetch payload via the user-context client (so is_admin() resolves on the caller)
  const { data: payload, error: rpcErr } = await userClient
    .rpc('get_match_card_payload', { p_match_id: matchId })
  if (rpcErr) {
    const status = /Admin role required/i.test(rpcErr.message) ? 403
                 : /Match not found|Match must be approved/i.test(rpcErr.message) ? 422
                 : 500
    return jsonResponse({ error: rpcErr.message }, status)
  }
  if (!payload || typeof payload !== 'object') {
    return jsonResponse({ error: 'Empty payload' }, 500)
  }

  // 5. Render SVG → PNG
  let pngBytes: Uint8Array
  try {
    const svg = await satori(
      MatchCard({ ...(payload as never), crestDataUri }),
      { width: 1080, height: 1080, fonts: FONTS },
    )
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1080 } }).render().asPng()
    pngBytes = new Uint8Array(png)
  } catch (e) {
    console.error('render failed:', e)
    return jsonResponse({ error: 'Render failed' }, 500)
  }

  // 6. Upload (service-role write)
  const { error: upErr } = await SERVICE_CLIENT.storage
    .from('match-cards')
    .upload(cacheKey, pngBytes, { contentType: 'image/png', upsert: true })
  if (upErr) {
    console.error('upload failed:', upErr)
    return jsonResponse({ error: 'Upload failed' }, 500)
  }

  return await signAndReturn(cacheKey)
})

async function signAndReturn(cacheKey: string): Promise<Response> {
  const { data: signed, error } = await SERVICE_CLIENT.storage
    .from('match-cards').createSignedUrl(cacheKey, 900)
  if (error || !signed) {
    return jsonResponse({ error: 'Sign URL failed' }, 500)
  }
  return jsonResponse({ signed_url: signed.signedUrl }, 200)
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
