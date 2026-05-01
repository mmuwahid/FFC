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
// NOTE: Supabase EF CLI only deploys .ts/.tsx/.json — binary files (TTF, SVG) are
// silently skipped. All assets are therefore loaded via HTTP fetch (same pattern
// as the WASM below), or inlined. The local font/SVG files remain in the repo
// for local `supabase functions serve` development.

// Fonts — fetched from jsDelivr (versioned, reliable CDN). Use .woff format
// (NOT .woff2) — Satori v0.10 supports TTF/OTF/WOFF only; WOFF2 lacks Brotli
// decompression in Satori's bundled font-decoder and silently fails to render.
const [fontInterBuf, fontInter700Buf, fontPlayfairBuf] = await Promise.all([
  fetch('https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-600-normal.woff').then(r => r.arrayBuffer()),
  fetch('https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-700-normal.woff').then(r => r.arrayBuffer()),
  fetch('https://cdn.jsdelivr.net/npm/@fontsource/playfair-display@5/files/playfair-display-latin-700-normal.woff').then(r => r.arrayBuffer()),
])
const fontInter = new Uint8Array(fontInterBuf)
const fontInter700 = new Uint8Array(fontInter700Buf)
const fontPlayfair = new Uint8Array(fontPlayfairBuf)

// Emoji asset loader — Inter ships no emoji glyphs, so without this Satori
// renders ⭐ ⚽ 🟨 🟥 as tofu boxes. Pre-fetch each emoji's twemoji SVG once
// at module init and stash them as data URIs for satori's `graphemeImages`
// option, which swaps each grapheme cluster for the mapped image at render
// time. Keep the list small (4 graphemes total today) — every entry adds a
// cold-start fetch.
const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg'
const EMOJI_CODEPOINTS: Record<string, string> = {
  '\u2B50': '2b50',          // ⭐ MOTM
  '\u26BD': '26bd',          // ⚽ goal
  '\uD83D\uDFE8': '1f7e8',   // 🟨 yellow card
  '\uD83D\uDFE5': '1f7e5',   // 🟥 red card
}

async function fetchEmoji(codepoint: string): Promise<string> {
  const svg = await fetch(`${TWEMOJI_BASE}/${codepoint}.svg`).then(r => r.text())
  // btoa requires ASCII; SVGs are ASCII-safe except for occasional UTF-8.
  // The twemoji files we use are pure ASCII so the simple call is safe.
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

const graphemeImages: Record<string, string> = {}
await Promise.all(
  Object.entries(EMOJI_CODEPOINTS).map(async ([emoji, cp]) => {
    graphemeImages[emoji] = await fetchEmoji(cp)
  }),
)

// FFC crest — inlined as base64 data URI (avoids CLI binary-asset deploy gap).
const crestDataUri = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4bWxuczppbmtzY2FwZT0iaHR0cDovL3d3dy5pbmtzY2FwZS5vcmcvbmFtZXNwYWNlcy9pbmtzY2FwZSIgdmVyc2lvbj0iMS4xIiB3aWR0aD0iNTk1LjI4IiBoZWlnaHQ9IjU5NS4yOCIgdmlld0JveD0iMCAwIDU5NS4yOCA1OTUuMjgiPg0KPGRlZnM+DQo8Y2xpcFBhdGggaWQ9ImNsaXBfMSI+DQo8cGF0aCB0cmFuc2Zvcm09Im1hdHJpeCgxLDAsMCwtMSwwLDU5NS4yOCkiIGQ9Ik0wIDU5NS4yOEg1OTUuMjhWMEgwWiIvPg0KPC9jbGlwUGF0aD4NCjwvZGVmcz4NCjxnIGlua3NjYXBlOmdyb3VwbW9kZT0ibGF5ZXIiIGlua3NjYXBlOmxhYmVsPSJMYXllciAxIj4NCjxnIGNsaXAtcGF0aD0idXJsKCNjbGlwXzEpIj4NCjxwYXRoIHRyYW5zZm9ybT0ibWF0cml4KDEsMCwwLC0xLDE4MC41MjA2LDQyNC40NDg5KSIgZD0iTTAgMEMzNy42NzUtMzMuNTYgNzIuNDc1LTQ5LjkxOCAxMTYuNDA5LTY1LjQzN0wxMTcuMTItNjUuNjkgMTE3Ljc4OC02NS40NTFDMTYxLjc2NS00OS45MTggMTk2LjU2My0zMy41NiAyMzQuMjUgLjAwOSAyNjUuMTU5IDI3LjYyNiAyODIuODkxIDcwLjQ2MyAyODIuODkxIDExNy41MjMgMjgyLjg5MSAxMzkuNzIyIDI3OS4zMjQgMTYwLjg5MyAyNzEuNjY1IDE4NC4xNTEgMjY5Ljc5OCAxODkuNzMyIDI2Ny42MzEgMTk1LjUzMSAyNjUuNTM2IDIwMS4xMzkgMjYxLjUyMyAyMTEuODg2IDI1Ny4zNyAyMjMuMDAxIDI1NC41ODkgMjM0LjM2NyAyNTIuMTYyIDI0NC40NyAyNTEuMTk2IDI1My45IDI1MS42MzEgMjYzLjIzOSAyNTIuNzYzIDI4Ny4zNyAyNjEuNzg1IDMwNi4zNzcgMjgwLjAyNyAzMjMuMDU3IDI4Mi4xMzEgMzI1LjAxNSAyODIuNzg2IDMyOC4xMSAyODEuNjA1IDMzMC43MDggMjgwLjM5NSAzMzMuNDA0IDI3Ny43MjQgMzM0LjkxMSAyNzQuODAxIDMzNC42MjUgMjU2LjkwOSAzMzIuODEgMjM3LjQ3IDMzMi44MzQgMjE3LjAwNCAzMzQuNjg1IDIwMC4wNjEgMzM2LjIxNiAxNDIuODkxIDM0My4wNSAxMTguNjE0IDM2Ni42MzVMMTE3LjE0OCAzNjguMDQ4IDExNS42OTkgMzY2LjYzOUM5MS40MTggMzQzLjA1IDM0LjI0NiAzMzYuMjE2IDE3LjMwMSAzMzQuNjg1LTMuMjIyIDMzMi44MzQtMjIuNjg0IDMzMi44MTQtNDAuNTUxIDMzNC42MjQtNDAuNzg5IDMzNC42NDgtNDEuMDI3IDMzNC42NjEtNDEuMjYzIDMzNC42NjEtNDMuODg4IDMzNC42NjEtNDYuMjcyIDMzMy4xNDgtNDcuMzU0IDMzMC43MzktNDguNTE0IDMyOC4xMi00Ny44NzEgMzI0Ljk5NC00NS43MzMgMzIzLjAwOC0yNy41NDYgMzA2LjM3Ny0xOC41MjMgMjg3LjM3LTE3LjM5NCAyNjMuMjQzVjI2My4yNDFDLTE2Ljk1NyAyNTMuOTEzLTE3LjkyMyAyNDQuNDgtMjAuMzM5IDIzNC40MDYtMjMuMDQ3IDIyMy4xNTMtMjcuMTQ4IDIxMi4xNjMtMzEuMTE0IDIwMS41MzctMzMuMjUyIDE5NS44MDYtMzUuNDY0IDE4OS44OC0zNy4zNiAxODQuMTQzLTQ1LjAwMyAxNjEuMTQ0LTQ4LjU5IDEzOS45Ny00OC42NTQgMTE3LjQ5OS00OC42NTQgNzAuNDYzLTMwLjkyIDI3LjYyNiAwIDAiIGZpbGw9IiNlYmU3ZTAiIGZpbGwtcnVsZT0iZXZlbm9kZCIvPg0KPHBhdGggdHJhbnNmb3JtPSJtYXRyaXgoMSwwLDAsLTEsMTg3Ljg4MjksNDE2LjE3NDU0KSIgZD0iTTAgMEMzNS42MTItMzEuNzUyIDY3LjQ1NC00Ny4xMjggMTA5Ljc1OS02Mi4yOTggMTUyLjEwMy00Ny4xNDEgMTgzLjk0NC0zMS43NyAyMTkuNTEzLS4wMDQgMjQ4LjE2NyAyNS41MTMgMjY0LjU1MyA2NS4zMjYgMjY0LjQ4IDEwOS4yMzUgMjY0LjQ4IDE0NC40MTIgMjU1LjYgMTY4LjM1NiAyNDcuMDEgMTkxLjUxNCAyMzkuMzU3IDIxMi4xNDIgMjMyLjEzMSAyMzEuNjI2IDIzMy4yMTkgMjU1LjUxNCAyMzQuMzMgMjc4LjcxIDI0MS45MTQgMjk3LjcxNSAyNTYuOTA3IDMxNC41MDggMjA1Ljc2MSAzMTEuNTM0IDE0MC45MzggMzIxLjc5NSAxMDkuNzY0IDM0NS4xNTcgNzguNjQzIDMyMS43OTcgMTMuODIxIDMxMS41My0zNy4zMjcgMzE0LjUwNC0yMi4zNzUgMjk3LjczMS0xNC44MTcgMjc4LjczNS0xMy43MDYgMjU1LjUzNFYyNTUuNTI4Qy0xMi41NzkgMjMxLjU5Ni0xOS44MTggMjEyLjA3Ny0yNy40OCAxOTEuNDEyLTM2LjA2IDE2OC4yNzYtNDQuOTMxIDE0NC4zNTQtNDQuOTY2IDEwOS4yNDEtNDQuOTY2IDY1LjMyLTI4LjU3NyAyNS40OTkgMCAwIiBmaWxsPSIjYjBhNDhhIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiLz4NCjxwYXRoIHRyYW5zZm9ybT0ibWF0cml4KDEsMCwwLC0xLDI5My4wNDYsODIuNTQ0MTMpIiBkPSJNMCAwQy0zMS4yMjQtMjAuNzA4LTgyLjk3Mi0yOC42OTktMTI0LjA4Ny0yOC45NzctMTE1LjgxMS00My4yOTItMTExLjMwMi01OS4yNzQtMTEwLjQyNy03Ny42ODktMTA5Ljg4OS04OS41MDItMTExLjE2Ny0xMDAuODk5LTExMy44NTktMTEyLjM2NC0xMTguMDMxLTEzMC4wODUtMTI1LjIzMS0xNDYuOTAxLTEzMC44MTYtMTY0LjIwNC0xMzcuMjc3LTE4NC4yMTctMTQwLjcwOS0yMDMuMTg4LTE0MC43MDktMjI0LjM4Mi0xNDAuNzA5LTI2Mi4zOTMtMTI4LjE5Mi0zMDAuODIxLTEwMC4xOTktMzI2LjYwMS02OC4zMDItMzU1LjkyNS0zOC42OTMtMzcxLjM1MiAwLTM4NS44NzUiIGZpbGw9IiMyMzFmMjAiIGZpbGwtcnVsZT0iZXZlbm9kZCIvPg0KPHBhdGggdHJhbnNmb3JtPSJtYXRyaXgoMSwwLDAsLTEsMzAyLjIzNDQsODIuNTQ0MTMpIiBkPSJNMCAwQzMxLjIyNC0yMC43MDggODIuOTcyLTI4LjY5OSAxMjQuMDg3LTI4Ljk3NyAxMTUuODEtNDMuMjkyIDExMS4zMDEtNTkuMjc0IDExMC40MjctNzcuNjg5IDEwOS44ODgtODkuNTAyIDExMS4xNjctMTAwLjg5OSAxMTMuODU4LTExMi4zNjQgMTE4LjAzLTEzMC4wODUgMTI1LjIzLTE0Ni45MDEgMTMwLjgxNS0xNjQuMjA0IDEzNy4yNzYtMTg0LjIxNyAxNDAuNzA4LTIwMy4xODggMTQwLjcwOC0yMjQuMzgyIDE0MC43MDgtMjYyLjM5MyAxMjguMTkxLTMwMC44MjEgMTAwLjE5OC0zMjYuNjAxIDY4LjMwMi0zNTUuOTI1IDM4LjY5Mi0zNzEuMzUyIDAtMzg1Ljg3NSIgZmlsbD0iI2ZmZmZmZiIgZmlsbC1ydWxlPSJldmVub2RkIi8+DQo8cGF0aCB0cmFuc2Zvcm09Im1hdHJpeCgxLDAsMCwtMSwyOTcuNjQwMiw1MzguODc5NjYpIiBkPSJNMCAwIDQuNzkyIDE0LjczMUgyMC4yMjVMNy43MTUgMjMuNzMyIDEyLjUwOSAzOC41OCAwIDI5LjM0NS0xMi41MDkgMzguNTgtNy43MTYgMjMuNzMyLTIwLjIyNSAxNC43MzFILTQuNzkzWiIgZmlsbD0iI2IwYTQ4YSIgZmlsbC1ydWxlPSJldmVub2RkIi8+DQo8cGF0aCB0cmFuc2Zvcm09Im1hdHJpeCgxLDAsMCwtMSwyMzYuMDI5Myw1MTUuNzMxMTcpIiBkPSJNMCAwIDcuODMzIDEwLjA1NCAxOS43NTcgNS43MjkgMTIuNjI2IDE2LjI1IDIwLjQ1OSAyNi4zMDQgOC4xODQgMjIuNzk3IDEuMDUzIDMzLjMxOSAuNzAxIDIwLjU3NS0xMS41NzQgMTcuMDY4IC40NjggMTIuNzQyWiIgZmlsbD0iI2IwYTQ4YSIgZmlsbC1ydWxlPSJldmVub2RkIi8+DQo8cGF0aCB0cmFuc2Zvcm09Im1hdHJpeCgxLDAsMCwtMSwzNTkuMjUxLDUxNS43MzExNykiIGQ9Ik0wIDAtNy44MzQgMTAuMDU0LTE5Ljc1OCA1LjcyOS0xMi42MjcgMTYuMjUtMjAuNDYgMjYuMzA0LTguMTg1IDIyLjc5Ny0xLjA1MyAzMy4zMTktLjcwMSAyMC41NzUgMTEuNTczIDE3LjA2OC0uNDY4IDEyLjc0MloiIGZpbGw9IiNiMGE0OGEiIGZpbGwtcnVsZT0iZXZlbm9kZCIvPg0KPHBhdGggdHJhbnNmb3JtPSJtYXRyaXgoMSwwLDAsLTEsMTUwLjYwMDEsNDE5LjE1MTA0KSIgZD0iTTAgMEMtLjM0Ny0uMzQ4LS42MjUtLjYyNi0xLjA0Mi0uOTc0LTExLjYwNS0xMC4yMTYtMjYuNzU0LTguNjg3LTM0Ljc0NSAyLjU3LTM5LjE5MiA4Ljc1NS00My42MzkgMTQuOTM5LTQ4LjA4NyAyMS4xOTQtNDcuMjUzIDIyLjE2Ny00Ni4zNSAyMy4wNy00NS4zNzYgMjMuOTAzLTM0LjgxNCAzMy4xNDYtMTkuNjY2IDMxLjYxNy0xMS42NzQgMjAuMzU5TC0yLjIyNCA3LjIyN0MtMTIuMzY5IDYuNDYyLTIyLjQ0NSA5LjQ1LTMyLjQ1MiAxNi4zMjktMjUuMDg2IDYuNTMxLTE0LjI0NiAxLjExMSAwIDAiIGZpbGw9IiNiMGE0OGEiIGZpbGwtcnVsZT0iZXZlbm9kZCIvPg0KPHBhdGggdHJhbnNmb3JtPSJtYXRyaXgoMSwwLDAsLTEsMTI0LjQwMjQsMzc4LjQ5OTc0KSIgZD0iTTAgMEMtMTEuMzI3LTQuODY1LTIzLjk3NCAuNjk0LTI4LjU2IDEyLjc4Ni0zMS4xMzEgMTkuNjY1LTMzLjc3MiAyNi42MTQtMzYuNDEzIDMzLjQ5NC0zNS40NCAzNC4xODgtMzQuMzk3IDM0Ljc0NC0zMy4zNTQgMzUuMy0yMS44MTkgNDAuOTk4LTguNDc4IDM1LjUwOS0zLjc1MiAyMy4wN0wyLjE1NCA3LjQzNUMtOC4yNyAxMS4xMTgtMTYuNjA4IDE4LjY5Mi0yMi43OTIgMzAuMDg5LTIwLjYzOCAxNy42NDktMTIuOTk1IDcuNTczIDAgMCIgZmlsbD0iI2IwYTQ4YSIgZmlsbC1ydWxlPSJldmVub2RkIi8+DQo8cGF0aCB0cmFuc2Zvcm09Im1hdHJpeCgxLDAsMCwtMSwxMTMuNDkyMiwzMzIuMTUxMTMpIiBkPSJNMCAwLS40MTctLjA2OEMtMTIuMDIxLTIuMTU0LTIyLjcyMyA2LjUzMi0yNC4xMTIgMTkuMjQ5LTI0Ljg3NyAyNi4yNjgtMjUuNzExIDMzLjM1NS0yNi40NzYgNDAuMzc0LTI1LjQzMyA0MC43MjEtMjQuMzkgNDEtMjMuMzQ4IDQxLjIwOC0xMS42NzQgNDMuMjkyLTEuMDQyIDM0LjYwNiAuNDE3IDIxLjg5TDIuMDE2IDcuMzY2Qy02LjExNSAxMi44NTYtMTIuMDkxIDIxLjA1Ni0xNS45MTMgMzIuMTA0LTE1Ljc3NCAyMC4wMTQtMTAuNDkzIDkuMzEyIDAgMCIgZmlsbD0iI2IwYTQ4YSIgZmlsbC1ydWxlPSJldmVub2RkIi8+DQo8cGF0aCB0cmFuc2Zvcm09Im1hdHJpeCgxLDAsMCwtMSwxMTAuMTU2OCwyODMuNDM4MjQpIiBkPSJNMCAwQy05LjI0MiAyLjk4OC0xNS4wNzkgMTMuMjcyLTEzLjIwMyAyNC4xODItMTIuMDkgMzAuNzg0LTEwLjkwOSAzNy4zODUtOS43OTggNDMuOTg3LTguODI1IDQzLjk4Ny03Ljc4MiA0My45MTctNi44MSA0My43NzggMy45NjEgNDIuMDQxIDExLjExOSAzMC44NTMgOS4wMzQgMTguOTAxTDYuMTg1IDIuMzYyQy0uMzQ3IDkuNjU5LTMuNDc0IDE5LjA0LTMuMTI3IDMwLjU3NS02Ljc0IDIwLjg0Ny01LjY5OCAxMC42MzIgMCAwIiBmaWxsPSIjYjBhNDhhIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiLz4NCjxwYXRoIHRyYW5zZm9ybT0ibWF0cml4KDEsMCwwLC0xLDEyMS42MjMxLDIzNi4yNTQ2NCkiIGQ9Ik0wIDBDLTguMDYxIDUuMjExLTExLjA0OSAxNi41MzgtNi42NzEgMjYuMTk3LTQuMSAzMS44MjYtMS40NTkgMzcuNTI0IDEuMTEyIDQzLjE1MiAxLjk0NiA0Mi44NzUgMi43NzkgNDIuNTI3IDMuNjEzIDQyLjExIDEyLjcxNiAzNy40NTUgMTYuMzk5IDI1LjI5MyAxMS43NDQgMTUuMDc5TDUuMjgxIC45NzNDMi40MzIgOC4xMyAyLjAxNSAxNi4xOSAzLjg5MSAyNS4xNTUtLjQ4NiAxNy43MTktMS44MDcgOS4zMTEgMCAwIiBmaWxsPSIjYjBhNDhhIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiLz4NCjxwYXRoIHRyYW5zZm9ybT0ibWF0cml4KDEsMCwwLC0xLDEzOC43MTc4LDE5MC42MDAzNCkiIGQ9Ik0wIDBDLTUuNDkgMy4zMzUtOC4wNjIgMTAuODQtNS43NjggMTcuMzAzLTQuMzA5IDIxLjEyNS0yLjkxOSAyNC45NDctMS41MjkgMjguNzY5LS45NzMgMjguNjMtLjM0OCAyOC4zNTIgLjIwOCAyOC4xNDMgNi41MzEgMjUuMTU1IDkuNTg5IDE3LjA5NCA3LjA4NyAxMC4yMTVMMy42ODIgLjkwM0MxLjExMSA1LjU1OSAuMDY5IDExLjExOSAuNTU1IDE3LjUxMS0xLjczOCAxMS45NTItMS45NDYgNi4xMTUgMCAwIiBmaWxsPSIjYjBhNDhhIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiLz4NCjxwYXRoIHRyYW5zZm9ybT0ibWF0cml4KDEsMCwwLC0xLDE4Mi41NjUsNDUyLjk5Mjg0KSIgZD0iTTAgMEMtLjI3OC0uMzQ4LS40ODYtLjYyNi0uNjk1LS45NzMtNy45MjItMTAuNzcxLTIwLjk4NS0xMi4yMy0yOS44MTEtNC4zMDktMzQuNzQ0IC4xMzktMzkuNjA5IDQuNTE3LTQ0LjU0MyA4Ljk2NC00My45ODcgOS44NjctNDMuNDMxIDEwLjg0LTQyLjczNiAxMS43NDQtMzUuNTc5IDIxLjU0Mi0yMi40NDUgMjMuMDAxLTEzLjYyIDE1LjA3OUwtMy4yNjYgNS42OThDLTExLjY3NCAzLjEyNy0yMC43NzcgMy44MjItMzAuNDM2IDcuNzgyLTIyLjM3NSAuOTAzLTEyLjIzLTEuNjY4IDAgMCIgZmlsbD0iI2IwYTQ4YSIgZmlsbC1ydWxlPSJldmVub2RkIi8+DQo8cGF0aCB0cmFuc2Zvcm09Im1hdHJpeCgxLDAsMCwtMSwyMTQuMjUzLDQ3Ni4yMDI4MykiIGQ9Ik0wIDBDLS4xNC0uMzQ4LS4zNDgtLjYyNS0uNDg3LS45MDMtNS44MzctOS44NjctMTYuODg2LTEyLjIyOS0yNS4wODYtNi4xODQtMjkuNjAzLTIuNzc5LTM0LjE4OSAuNTU3LTM4LjcwNyAzLjk2MS0zOC4zNTkgNC43OTUtMzcuOTQyIDUuNjI5LTM3LjQ1NiA2LjQ2My0zMi4xMDQgMTUuNDI3LTIxLjA1NiAxNy43OS0xMi44NTYgMTEuNjc0TC0zLjE5NyA0LjU4N0MtMTAuMjE1IDEuNzM3LTE3Ljk5OSAxLjUyOS0yNi42MTUgNC4xMDEtMTkuMTgtMS4xMTEtMTAuMjg1LTIuNTAyIDAgMCIgZmlsbD0iI2IwYTQ4YSIgZmlsbC1ydWxlPSJldmVub2RkIi8+DQo8cGF0aCB0cmFuc2Zvcm09Im1hdHJpeCgxLDAsMCwtMSw0NDQuNjc5Nyw0MTkuMTUxMDQpIiBkPSJNMCAwQy4zNDgtLjM0OCAuNjk1LS42MjYgMS4wNDItLjk3NCAxMS42MDUtMTAuMjE2IDI2Ljc1NC04LjY4NyAzNC44MTQgMi41NyAzOS4xOTIgOC43NTUgNDMuNjQgMTQuOTM5IDQ4LjA4NyAyMS4xOTQgNDcuMjUzIDIyLjE2NyA0Ni4zNSAyMy4wNyA0NS4zNzcgMjMuOTAzIDM0LjgxNCAzMy4xNDYgMTkuNjY2IDMxLjYxNyAxMS42NzQgMjAuMzU5TDIuMjI0IDcuMjI3QzEyLjQzOCA2LjQ2MiAyMi41MTUgOS40NSAzMi40NTIgMTYuMzI5IDI1LjA4NiA2LjUzMSAxNC4yNDYgMS4xMTEgMCAwIiBmaWxsPSIjYjBhNDhhIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiLz4NCjxwYXRoIHRyYW5zZm9ybT0ibWF0cml4KDEsMCwwLC0xLDQ3MC45NDczLDM3OC40OTk3NCkiIGQ9Ik0wIDBDMTEuMjU3LTQuODY1IDIzLjkwNCAuNjk0IDI4LjQ5IDEyLjc4NiAzMS4xMzEgMTkuNjY1IDMzLjcwMiAyNi42MTQgMzYuMzQzIDMzLjQ5NCAzNS4zNyAzNC4xODggMzQuMzk3IDM0Ljc0NCAzMy4yODUgMzUuMyAyMS43NSA0MC45OTggOC40MDggMzUuNTA5IDMuNjgzIDIzLjA3TC0yLjIyNCA3LjQzNUM4LjE5OSAxMS4xMTggMTYuNTM4IDE4LjY5MiAyMi43MjMgMzAuMDg5IDIwLjU2OCAxNy42NDkgMTIuOTk0IDcuNTczIDAgMCIgZmlsbD0iI2IwYTQ4YSIgZmlsbC1ydWxlPSJldmVub2RkIi8+DQo8cGF0aCB0cmFuc2Zvcm09Im1hdHJpeCgxLDAsMCwtMSw0ODEuNzg3MiwzMzIuMTUxMTMpIiBkPSJNMCAwIC40MTctLjA2OEMxMi4wMjItMi4xNTQgMjIuNzI0IDYuNTMyIDI0LjExMyAxOS4yNDkgMjQuOTQ3IDI2LjI2OCAyNS43MTIgMzMuMzU1IDI2LjQ3NiA0MC4zNzQgMjUuNTAzIDQwLjcyMSAyNC40NjEgNDEgMjMuMzQ5IDQxLjIwOCAxMS43NDQgNDMuMjkyIDEuMDQyIDM0LjYwNi0uMzQ4IDIxLjg5TC0xLjk0NSA3LjM2NkM2LjE4NSAxMi44NTYgMTIuMTYxIDIxLjA1NiAxNS45MTMgMzIuMTA0IDE1Ljg0NCAyMC4wMTQgMTAuNDkzIDkuMzEyIDAgMCIgZmlsbD0iI2IwYTQ4YSIgZmlsbC1ydWxlPSJldmVub2RkIi8+DQo8cGF0aCB0cmFuc2Zvcm09Im1hdHJpeCgxLDAsMCwtMSw0ODUuMTkyNCwyODMuNDM4MjQpIiBkPSJNMCAwQzkuMjQyIDIuOTg4IDE1LjAxIDEzLjI3MiAxMy4xMzQgMjQuMTgyIDEyLjAyMSAzMC43ODQgMTAuODQgMzcuMzg1IDkuNzI5IDQzLjk4NyA4Ljc1NiA0My45ODcgNy43ODIgNDMuOTE3IDYuNzQgNDMuNzc4LTQuMDMgNDIuMDQxLTExLjE4OCAzMC44NTMtOS4xMDQgMTguOTAxTC02LjI1NCAyLjM2MkMuMjc3IDkuNjU5IDMuNDA0IDE5LjA0IDMuMDU4IDMwLjU3NSA2LjY3MSAyMC44NDcgNS42MjkgMTAuNjMyIDAgMCIgZmlsbD0iI2IwYTQ4YSIgZmlsbC1ydWxlPSJldmVub2RkIi8+DQo8cGF0aCB0cmFuc2Zvcm09Im1hdHJpeCgxLDAsMCwtMSw0NzMuNjU3MywyMzYuMjU0NjQpIiBkPSJNMCAwQzguMDYxIDUuMjExIDExLjA0OSAxNi41MzggNi42NzEgMjYuMTk3IDQuMSAzMS44MjYgMS41MjggMzcuNTI0LTEuMDQyIDQzLjE1Mi0xLjk0NiA0Mi44NzUtMi43NzkgNDIuNTI3LTMuNjE0IDQyLjExLTEyLjcxNyAzNy40NTUtMTYuNCAyNS4yOTMtMTEuNzQ0IDE1LjA3OUwtNS4yODEgLjk3M0MtMi40MzMgOC4xMy0xLjk0NiAxNi4xOS0zLjg5MiAyNS4xNTUgLjU1NiAxNy43MTkgMS44MDcgOS4zMTEgMCAwIiBmaWxsPSIjYjBhNDhhIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiLz4NCjxwYXRoIHRyYW5zZm9ybT0ibWF0cml4KDEsMCwwLC0xLDQ1Ni41NjI2LDE5MC42MDAzNCkiIGQ9Ik0wIDBDNS41NiAzLjMzNSA4LjEzMSAxMC44NCA1Ljc2OCAxNy4zMDMgNC4zNzggMjEuMTI1IDIuOTg4IDI0Ljk0NyAxLjU5OSAyOC43NjkgLjk3MyAyOC42MyAuNDE3IDI4LjM1Mi0uMjA5IDI4LjE0My02LjQ2MyAyNS4xNTUtOS41OSAxNy4wOTQtNy4wODggMTAuMjE1TC0zLjY4MyAuOTAzQy0xLjExMSA1LjU1OS0uMDY5IDExLjExOS0uNTU2IDE3LjUxMSAxLjgwNyAxMS45NTIgMS45NDUgNi4xMTUgMCAwIiBmaWxsPSIjYjBhNDhhIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiLz4NCjxwYXRoIHRyYW5zZm9ybT0ibWF0cml4KDEsMCwwLC0xLDQxMi43ODQyLDQ1Mi45OTI4NCkiIGQ9Ik0wIDBDLjIwOS0uMzQ4IC40MTctLjYyNiAuNjI2LS45NzMgNy44NTMtMTAuNzcxIDIwLjkxNi0xMi4yMyAyOS43NDEtNC4zMDkgMzQuNjc1IC4xMzkgMzkuNTM5IDQuNTE3IDQ0LjQ3MyA4Ljk2NCA0My45MTggOS44NjcgNDMuMzYxIDEwLjg0IDQyLjczNiAxMS43NDQgMzUuNTEgMjEuNTQyIDIyLjQ0NSAyMy4wMDEgMTMuNjIgMTUuMDc5TDMuMTk2IDUuNjk4QzExLjYwNCAzLjEyNyAyMC43MDggMy44MjIgMzAuMzY3IDcuNzgyIDIyLjMwNyAuOTAzIDEyLjIzLTEuNjY4IDAgMCIgZmlsbD0iI2IwYTQ4YSIgZmlsbC1ydWxlPSJldmVub2RkIi8+DQo8cGF0aCB0cmFuc2Zvcm09Im1hdHJpeCgxLDAsMCwtMSwzODEuMDI3NCw0NzYuMjAyODMpIiBkPSJNMCAwQy4xNC0uMzQ4IC4zNDgtLjYyNSAuNDg2LS45MDMgNS44MzctOS44NjcgMTYuODg2LTEyLjIyOSAyNS4wODYtNi4xODQgMjkuNjcyLTIuNzc5IDM0LjE4OCAuNTU3IDM4LjcwNSAzLjk2MSAzOC4zNTggNC43OTUgMzcuOTQxIDUuNjI5IDM3LjQ1NSA2LjQ2MyAzMi4xMDQgMTUuNDI3IDIxLjA1NiAxNy43OSAxMi44NTUgMTEuNjc0TDMuMjY3IDQuNTg3QzEwLjIxNSAxLjczNyAxNy45OTggMS41MjkgMjYuNjE0IDQuMTAxIDE5LjE4LTEuMTExIDEwLjI4NS0yLjUwMiAwIDAiIGZpbGw9IiNiMGE0OGEiIGZpbGwtcnVsZT0iZXZlbm9kZCIvPg0KPHBhdGggdHJhbnNmb3JtPSJtYXRyaXgoMSwwLDAsLTEsNDExLjE4MDcsMzExLjg2MDAzKSIgZD0iTTAgMEMwLTYyLjcwNy01MC44MzQtMTEzLjU0MS0xMTMuNTQxLTExMy41NDEtMTc2LjI0OC0xMTMuNTQxLTIyNy4wODItNjIuNzA3LTIyNy4wODIgMC0yMjcuMDgyIDYyLjcwNy0xNzYuMjQ4IDExMy41NDEtMTEzLjU0MSAxMTMuNTQxLTUwLjgzNCAxMTMuNTQxIDAgNjIuNzA3IDAgMCIgZmlsbD0iI2IwYTQ4YSIvPg0KPHBhdGggdHJhbnNmb3JtPSJtYXRyaXgoMSwwLDAsLTEsMzk3Ljc3NDUsMzAyLjY3MTY0KSIgZD0iTTAgMEMtMy42NDQgNDAuMjEzLTMwLjk1OCA3My41OS02Ny45MDEgODYuMDg1VjY2LjM5OEMtNDEuMjU1IDU0Ljk5MS0yMS44MTIgMjkuODk1LTE4LjQ3MSAwLTE4LjEzMy0zLjAxOC0xNy45NTQtNi4wODItMTcuOTU0LTkuMTg4LTE3Ljk1NC0xMi4yOTQtMTguMTMzLTE1LjM1OC0xOC40NzEtMTguMzc2LTIyLjE4Ny01MS42MzktNDUuODM2LTc4Ljk2NC03Ny4xNjUtODguMDk4LTgzLjA0Ny04OS44MTItODkuMTk4LTkwLjg4Ny05NS41NC05MS4yMzgtOTcuMDYyLTkxLjMyMi05OC41OTMtOTEuMzY5LTEwMC4xMzQtOTEuMzY5LTEwMS42NzYtOTEuMzY5LTEwMy4yMDgtOTEuMzIyLTEwNC43MjktOTEuMjM4VjYzLjY1NkMtMTExLjEwOCA2My4yNTctMTE3LjI2OSA2Mi4wMzgtMTIzLjEwNCA2MC4wOTgtMTQ0Ljc3OSA1Mi44OTUtMTYxLjk2IDM1Ljc4MS0xNjkuMjggMTQuMTZILTE0OS40ODlDLTE0NC4wMjMgMjUuNjY3LTEzNC42NiAzNC45NzctMTIzLjEwNCA0MC4zNTZWMEgtMTU5Ljk1NEMtMTYwLjMzNC0zLjAxMS0xNjAuNTMtNi4wNzctMTYwLjUzLTkuMTg4LTE2MC41My0xMi4zLTE2MC4zMzQtMTUuMzY2LTE1OS45NTQtMTguMzc2SC0xMjMuMTA0Vi0xMDcuMTA2Qy0xMTcuMTY0LTEwOC40OTQtMTExLjAyMS0xMDkuMzUzLTEwNC43MjktMTA5LjYzNi0xMDMuMjA1LTEwOS43MDQtMTAxLjY3NS0xMDkuNzQ1LTEwMC4xMzQtMTA5Ljc0NS05OC41OTUtMTA5Ljc0NS05Ny4wNjMtMTA5LjcwNC05NS41NC0xMDkuNjM2LTg5LjI0Ny0xMDkuMzUzLTgzLjEwNC0xMDguNDk0LTc3LjE2NS0xMDcuMTA2LTM1LjU5LTk3LjM5Mi0zLjk0Mi02MS44ODQgMC0xOC4zNzYgLjI3NC0xNS4zNSAuNDIyLTEyLjI4NiAuNDIyLTkuMTg4IC40MjItNi4wOSAuMjc0LTMuMDI3IDAgMCIgZmlsbD0iIzIzMWYyMCIvPg0KPHBhdGggdHJhbnNmb3JtPSJtYXRyaXgoMSwwLDAsLTEsMzIwLjYwOTQsMzAyLjY3MTY0KSIgZD0iTTAgMFY0MC4zNTZDMTEuNTU3IDM0Ljk3NyAyMC45MiAyNS42NjcgMjYuMzg1IDE0LjE2SDQ2LjE3NkMzOC44NTUgMzUuNzgxIDIxLjY3NSA1Mi44OTUgMCA2MC4wOThWODguNzI5Qy01LjkzOSA5MC4xMTgtMTIuMDgyIDkwLjk3Ni0xOC4zNzUgOTEuMjU5LTE5Ljg5OCA5MS4zMjgtMjEuNDMgOTEuMzY4LTIyLjk2OSA5MS4zNjgtMjQuNTEgOTEuMzY4LTI2LjA0IDkxLjMyOC0yNy41NjMgOTEuMjU5LTMzLjg1NiA5MC45NzYtMzkuOTk5IDkwLjExOC00NS45MzkgODguNzI5LTg3LjUxNCA3OS4wMTUtMTE5LjE2MiA0My41MDctMTIzLjEwNCAwLTEyMy4zNzgtMy4wMjctMTIzLjUyNi02LjA5LTEyMy41MjYtOS4xODgtMTIzLjUyNi0xMi4yODYtMTIzLjM3OC0xNS4zNS0xMjMuMTA0LTE4LjM3Ni0xMTkuNDU4LTU4LjYxNy05Mi4xMDgtOTIuMDEyLTU1LjEyNy0xMDQuNDg2Vi04NC44MDdDLTgxLjgxMy03My40MTUtMTAxLjI4OS00OC4zLTEwNC42MzQtMTguMzc2LTEwNC45NzEtMTUuMzU4LTEwNS4xNS0xMi4yOTQtMTA1LjE1LTkuMTg4LTEwNS4xNS02LjA4Mi0xMDQuOTcxLTMuMDE4LTEwNC42MzQgMC0xMDAuOTE2IDMzLjI2Mi03Ny4yNjggNjAuNTg3LTQ1LjkzOSA2OS43MjEtNDAuMDU3IDcxLjQzNi0zMy45MDUgNzIuNTEtMjcuNTYzIDcyLjg2Mi0yNi4wNDIgNzIuOTQ2LTI0LjUxMSA3Mi45OTItMjIuOTY5IDcyLjk5Mi0yMS40MjggNzIuOTkyLTE5Ljg5NiA3Mi45NDYtMTguMzc1IDcyLjg2MlYtODIuMDMyQy0xMS45OTYtODEuNjM0LTUuODM1LTgwLjQxNCAwLTc4LjQ3NVYtMTguMzc2SDM2Ljg1QzM3LjIyOS0xNS4zNjYgMzcuNDI3LTEyLjMgMzcuNDI3LTkuMTg4IDM3LjQyNy02LjA3NyAzNy4yMjktMy4wMTEgMzYuODUgMFoiIGZpbGw9IiNmZmZmZmYiLz4NCjwvZz4NCjwvZz4NCjwvc3ZnPg0K'

// Resvg WASM — fetch once at module init.
const resvgWasm = await fetch('https://unpkg.com/@resvg/resvg-wasm@2/index_bg.wasm')
  .then(r => r.arrayBuffer())
await initWasm(resvgWasm)

const FONTS = [
  { name: 'Inter', data: fontInter, weight: 600 as const, style: 'normal' as const },
  { name: 'Inter', data: fontInter700, weight: 700 as const, style: 'normal' as const },
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

  // 3. Cache check (skip if force=true).
  //
  // RENDER_VERSION is bumped any time the MatchCard layout / RPC payload
  // shape changes — bumping invalidates every cached PNG without needing
  // a manual storage wipe. Keep the cache key in `<matchId>-v<N>.png`
  // form. Old `<matchId>.png` (v0) and lower-version files are left as
  // orphans on the bucket; they are harmless and storage-cheap.
  const RENDER_VERSION = 3
  const cacheKey = `${matchId}-v${RENDER_VERSION}.png`
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
      { width: 1080, height: 1080, fonts: FONTS, graphemeImages },
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
