# Phase 2 Slice 2B-C — RefEntry pre-match mode

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** The token URL `/ref/:token` is no longer a stub. It opens to a pre-match screen showing the matchday header + locked rosters (with captain markers) + a big KICK OFF button. Tapping KICK OFF requests a screen wake-lock, persists kickoff timestamp to `localStorage`, and transitions the state machine into a live-mode placeholder. Live mode itself is slice 2B-D.

**Architecture:**
- One new migration `0029_get_ref_matchday.sql` adds an anonymous-callable `get_ref_matchday(p_token text) returns jsonb` SECURITY DEFINER RPC. Validates the token via sha256, returns matchday header + both rosters + token expiry as a single JSONB envelope. Anonymous caller — no auth session required.
- `RefEntry.tsx` is rewritten from stub into a state machine: `loading | invalid | pre-match | live`. State persisted to `localStorage[ffc_ref_<sha256(token)>]` so a refresh recovers the same mode.
- New `useMatchSession` hook owns the state machine, the wake-lock lifecycle, and the localStorage hydration.
- Live mode renders a placeholder ("Live console — wired in slice 2B-D") for now.
- Migration **renumber note:** Phase 2A's automation migration was originally going to be 0028, then 0029 after slice 2B-A claimed 0028. With slice 2B-C now claiming 0029, Phase 2A's migration becomes **0030** when slice 2A-A lands. Document inline as part of Task 2.

**Tech Stack:**
- Supabase JS (`supabase.rpc('get_ref_matchday', { p_token })`) — anon role, no auth required
- React 19 + TypeScript 6
- `navigator.wakeLock` API (Chrome 84+, Safari 16.4+, all evergreen mobile browsers)

---

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `supabase/migrations/0029_get_ref_matchday.sql` | **Create** | Single RPC + GRANT to anon. Transactional (BEGIN/COMMIT). |
| `ffc/src/lib/database.types.ts` | **Overwrite** | Regen from live schema after migration applies. |
| `ffc/src/lib/useMatchSession.ts` | **Create** | New hook: state machine + wake-lock + localStorage. ~80–120 LOC. |
| `ffc/src/pages/RefEntry.tsx` | **Rewrite** | Stub → real component. ~150–200 LOC. |
| `ffc/src/styles/ref-entry.css` | **Create** | New file for RefEntry styles. ~80 LOC. Brand-tokenised but standalone (RefEntry has no auth context, so app-level brand tokens may not be on the document). |
| `ffc/src/main.tsx` | **Edit** | Import the new CSS. (Or import in RefEntry.tsx if Vite tolerates per-component CSS import.) |
| `tasks/todo.md` + `CLAUDE.md` + `sessions/S042/session-log.md` + `sessions/INDEX.md` | **Edit/Create** | Standard close-out per Task 4. |

**Why a separate CSS file (not in `index.css`):** RefEntry is a public route loaded without the authenticated app shell. The brand tokens declared on `.admin-matches`, `.po-screen`, etc. don't apply. RefEntry needs its own root scope (`.ref-entry`) declaring brand tokens locally. A standalone CSS file makes that scope clear.

---

## Pre-flight context

- Last committed tip: `613bdf1` (slice 2B-B close-out).
- Live DB migrations: 28 (Phase 2B foundation = 0028).
- `ref_tokens` table has columns `id, matchday_id, token_sha256, issued_at, issued_by, expires_at, consumed_at, label`.
- `match_players` has `match_id, profile_id, guest_id, team, is_captain, goals, ...`.
- `matchdays` has `id, season_id, kickoff_at, venue, default_format, etc.`. Use `effective_format(matchday_id)` helper.
- Existing helpers from 0028: `current_profile_id()`, `is_admin()`, `log_admin_action()`. None of those needed here — `get_ref_matchday` is anon, no caller identity.
- The `ffc/src/pages/RefEntry.tsx` stub at HEAD is 11 lines (just renders the token).

---

## Task 1 — Pre-flight (5 min)

- [ ] **Step 1: Verify state**

```bash
cd "C:/Users/User/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC" && git status -sb && git log --oneline -3
```

Expected: clean, top is `613bdf1`. If ahead — fine, no extra unpushed commits expected.

```bash
npx --yes supabase@latest db query --linked "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 2"
```
Expected: top row corresponds to migration 0028.

```bash
npx --yes supabase@latest db query --linked "SELECT count(*) FROM pg_proc WHERE proname='get_ref_matchday'"
```
Expected: 0 (function doesn't exist yet).

If any expectation fails — STOP, report BLOCKED.

---

## Task 2 — Migration 0029 + apply + types regen (25 min)

- [ ] **Step 1: Author `supabase/migrations/0029_get_ref_matchday.sql`**

Use the Write tool to create the file with the following content:

```sql
-- 0029_get_ref_matchday.sql
-- Phase 2 Slice 2B-C — anonymous-callable matchday-fetch for the ref console.
--
-- Adds get_ref_matchday(p_token text) which validates a raw ref token
-- (via sha256 lookup against ref_tokens) and returns a curated JSONB
-- envelope of matchday header + white roster + black roster + token
-- expiry. Anonymous-callable; no auth session required.
--
-- Numbering note: Phase 2A automation was speculatively documented as
-- "0029" before build-order locked. Slice 2B-A took 0028. Slice 2B-C
-- (this file) takes 0029. Phase 2A automation moves to 0030.

BEGIN;

CREATE OR REPLACE FUNCTION get_ref_matchday(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_token_hash text;
  v_token_row  ref_tokens%ROWTYPE;
  v_matchday   matchdays%ROWTYPE;
  v_match_id   uuid;
  v_white      jsonb;
  v_black      jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) = 0 THEN
    RAISE EXCEPTION 'Token is required' USING ERRCODE = '22023';
  END IF;

  v_token_hash := encode(digest(p_token, 'sha256'), 'hex');

  SELECT * INTO v_token_row
  FROM ref_tokens
  WHERE token_sha256 = v_token_hash
    AND consumed_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired ref token' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_matchday FROM matchdays WHERE id = v_token_row.matchday_id;

  -- Match row may or may not exist yet (admin must lock roster first; lock
  -- creates the matches row). If it doesn't exist, return an empty roster
  -- — the ref will see a "Roster not yet locked" message client-side.
  SELECT id INTO v_match_id FROM matches WHERE matchday_id = v_token_row.matchday_id;

  IF v_match_id IS NOT NULL THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'profile_id', mp.profile_id,
        'guest_id', mp.guest_id,
        'display_name', COALESCE(p.display_name, g.display_name),
        'primary_position',
          COALESCE(p.primary_position::text, g.primary_position::text),
        'is_captain', COALESCE(mp.is_captain, false)
      )
      ORDER BY mp.is_captain DESC NULLS LAST,
               COALESCE(p.display_name, g.display_name) ASC
    )
    INTO v_white
    FROM match_players mp
    LEFT JOIN profiles p ON mp.profile_id = p.id
    LEFT JOIN match_guests g ON mp.guest_id = g.id
    WHERE mp.match_id = v_match_id AND mp.team = 'white';

    SELECT jsonb_agg(
      jsonb_build_object(
        'profile_id', mp.profile_id,
        'guest_id', mp.guest_id,
        'display_name', COALESCE(p.display_name, g.display_name),
        'primary_position',
          COALESCE(p.primary_position::text, g.primary_position::text),
        'is_captain', COALESCE(mp.is_captain, false)
      )
      ORDER BY mp.is_captain DESC NULLS LAST,
               COALESCE(p.display_name, g.display_name) ASC
    )
    INTO v_black
    FROM match_players mp
    LEFT JOIN profiles p ON mp.profile_id = p.id
    LEFT JOIN match_guests g ON mp.guest_id = g.id
    WHERE mp.match_id = v_match_id AND mp.team = 'black';
  END IF;

  RETURN jsonb_build_object(
    'matchday', jsonb_build_object(
      'id', v_matchday.id,
      'kickoff_at', v_matchday.kickoff_at,
      'venue', v_matchday.venue,
      'effective_format', effective_format(v_matchday.id),
      'roster_locked_at', v_matchday.roster_locked_at
    ),
    'white', COALESCE(v_white, '[]'::jsonb),
    'black', COALESCE(v_black, '[]'::jsonb),
    'token_expires_at', v_token_row.expires_at,
    'has_match_row', v_match_id IS NOT NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_ref_matchday(text) TO anon, authenticated;

COMMENT ON FUNCTION get_ref_matchday(text) IS
  'Anonymous-callable matchday-fetch for the ref console. Validates raw
   token via sha256, returns matchday header + rosters + token expiry.
   Does not consume the token (use submit_ref_entry for that).';

COMMIT;
```

- [ ] **Step 2: Apply the migration**

```bash
npx --yes supabase@latest db push --linked
```

Expected: `Applying migration ...0029_get_ref_matchday.sql ... Finished supabase db push.` If failure, capture full error and report BLOCKED.

- [ ] **Step 3: Verify the function exists with correct signature + grants**

```bash
npx --yes supabase@latest db query --linked "SELECT proname, pg_get_function_arguments(oid), pg_get_function_result(oid) FROM pg_proc WHERE proname='get_ref_matchday'"
```

Expected: 1 row, args `p_token text`, returns `jsonb`.

```bash
npx --yes supabase@latest db query --linked "SELECT grantee, privilege_type FROM information_schema.routine_privileges WHERE routine_name = 'get_ref_matchday' ORDER BY grantee"
```

Expected: at least `anon | EXECUTE` and `authenticated | EXECUTE` rows.

- [ ] **Step 4: Smoke-test the RPC with an invalid token (should error cleanly)**

```bash
npx --yes supabase@latest db query --linked "SELECT get_ref_matchday('not-a-real-token')"
```

Expected: error containing `Invalid or expired ref token` (ERRCODE 22023). Confirm the error path works.

- [ ] **Step 5: Regenerate TypeScript types**

```bash
npx --yes supabase@latest gen types typescript --linked 2>/dev/null > "ffc/src/lib/database.types.ts"
```

Verify:
```bash
wc -l ffc/src/lib/database.types.ts
head -3 ffc/src/lib/database.types.ts
grep -n "get_ref_matchday" ffc/src/lib/database.types.ts | head
```

Expected: line count up by ~15–25 from 2183. First line `export type Json =`. At least 2 grep hits for the new RPC.

- [ ] **Step 6: tsc verify**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc -b
```

Expected: EXIT 0.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0029_get_ref_matchday.sql ffc/src/lib/database.types.ts
git commit -m "$(cat <<'EOF'
feat(s042,2b-c): migration 0029 — get_ref_matchday anon RPC + types

Adds the anon-callable RPC that the ref console calls to fetch matchday
header + locked rosters + token expiry. Validates the raw token via
sha256 against ref_tokens (consumed_at IS NULL, expires_at > now()).
Returns curated JSONB envelope so anon caller doesn't need direct read
on profiles / match_players / matchdays (all RLS-gated).

Numbering: 2B-C claims migration 0029. Phase 2A automation moves to
0030 when slice 2A-A lands.

Migrations on live DB: 29.
EOF
)"
```

---

## Task 3 — `useMatchSession` hook + RefEntry pre-match UI (45 min)

- [ ] **Step 1: Create `ffc/src/lib/useMatchSession.ts`**

Use the Write tool. Full content:

```ts
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * Ref console state machine for slice 2B-C onward.
 *
 * Modes:
 *   'loading' — fetching matchday from token
 *   'invalid' — token rejected by server (expired, consumed, or never existed)
 *   'pre'     — pre-match screen visible; admin tapped link, ref hasn't started
 *   'live'    — match clock running (slice 2B-D wires the actual UI)
 *   'post'    — match ended, awaiting submit (slice 2B-E)
 *
 * State persists per-token in localStorage so a refresh / backgrounding doesn't
 * lose context. Key is sha256(token) so multiple admins minting different tokens
 * for different matchdays don't clobber each other in the browser.
 */

export type MatchMode = 'loading' | 'invalid' | 'pre' | 'live' | 'post'

interface RosterPlayer {
  profile_id: string | null
  guest_id: string | null
  display_name: string
  primary_position: string | null
  is_captain: boolean
}

interface MatchdayInfo {
  id: string
  kickoff_at: string
  venue: string | null
  effective_format: '7v7' | '5v5'
  roster_locked_at: string | null
}

export interface RefMatchdayPayload {
  matchday: MatchdayInfo
  white: RosterPlayer[]
  black: RosterPlayer[]
  token_expires_at: string
  has_match_row: boolean
}

interface PersistedState {
  mode: MatchMode
  kickoff_started_at: string | null
}

const STORAGE_PREFIX = 'ffc_ref_'

async function tokenKey(token: string): Promise<string> {
  // Use the Web Crypto API for sha256 — same hash the server uses, so the
  // localStorage key is stable per-token across devices on the same browser.
  const buf = new TextEncoder().encode(token)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return STORAGE_PREFIX + Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

function readPersisted(key: string): PersistedState | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as PersistedState
  } catch {
    return null
  }
}

function writePersisted(key: string, state: PersistedState): void {
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    /* private mode / storage blocked — non-fatal */
  }
}

export function useMatchSession(token: string | undefined) {
  const [mode, setMode] = useState<MatchMode>('loading')
  const [payload, setPayload] = useState<RefMatchdayPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [storageKey, setStorageKey] = useState<string | null>(null)
  const [kickoffAt, setKickoffAt] = useState<string | null>(null)

  // Resolve storage key from token (async because Web Crypto is async).
  useEffect(() => {
    if (!token) {
      setMode('invalid')
      return
    }
    let cancelled = false
    void tokenKey(token).then((key) => {
      if (cancelled) return
      setStorageKey(key)
    })
    return () => { cancelled = true }
  }, [token])

  // Once we have the storage key, hydrate persisted state and fetch matchday.
  useEffect(() => {
    if (!storageKey || !token) return
    let cancelled = false
    const persisted = readPersisted(storageKey)

    void supabase
      .rpc('get_ref_matchday', { p_token: token })
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) {
          setError(err.message)
          setMode('invalid')
          return
        }
        if (!data) {
          setError('Empty matchday payload')
          setMode('invalid')
          return
        }
        setPayload(data as unknown as RefMatchdayPayload)
        // If we have persisted state, restore it; otherwise stay 'pre'.
        if (persisted) {
          setMode(persisted.mode)
          setKickoffAt(persisted.kickoff_started_at)
        } else {
          setMode('pre')
        }
      })
    return () => { cancelled = true }
  }, [storageKey, token])

  // Persist whenever mode or kickoffAt change (and we have a key).
  useEffect(() => {
    if (!storageKey) return
    if (mode === 'loading' || mode === 'invalid') return
    writePersisted(storageKey, { mode, kickoff_started_at: kickoffAt })
  }, [storageKey, mode, kickoffAt])

  const startMatch = async () => {
    setKickoffAt(new Date().toISOString())
    setMode('live')
    // Best-effort screen wake-lock. Some browsers reject without a recent
    // user gesture, but this is invoked from the KICK OFF button click,
    // which IS a user gesture.
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<unknown> }
      }
      if (nav.wakeLock) {
        await nav.wakeLock.request('screen')
      }
    } catch {
      /* wake-lock denied or unsupported — non-fatal */
    }
  }

  return { mode, payload, error, kickoffAt, startMatch }
}
```

- [ ] **Step 2: Rewrite `ffc/src/pages/RefEntry.tsx`**

Replace the 11-line stub with the full implementation. Use Write tool:

```tsx
import { useParams } from 'react-router-dom'
import { useMatchSession } from '../lib/useMatchSession'
import '../styles/ref-entry.css'

/* §3.4-v2 Slice 2B-C — RefEntry pre-match mode.
 *
 * URL: /ref/:token (anonymous; token is the only auth).
 *
 * Modes (slice 2B-C handles loading/invalid/pre; 2B-D adds live; 2B-E adds post):
 *   loading → spinner
 *   invalid → token-rejected screen
 *   pre     → matchday header + rosters + KICK OFF button
 *   live    → placeholder ("Live console — wired in slice 2B-D")
 */

export function RefEntry() {
  const { token } = useParams()
  const { mode, payload, error, startMatch } = useMatchSession(token)

  if (mode === 'loading') {
    return (
      <section className="ref-entry ref-entry--center">
        <div className="ref-entry-spinner" aria-hidden />
        <p className="ref-entry-hint">Loading matchday…</p>
      </section>
    )
  }

  if (mode === 'invalid') {
    return (
      <section className="ref-entry ref-entry--center">
        <h1 className="ref-entry-title">Link expired</h1>
        <p className="ref-entry-copy">
          This ref link is no longer valid — it may have been used or replaced. Ask
          the admin to share a fresh link.
        </p>
        {error && <p className="ref-entry-error">{error}</p>}
      </section>
    )
  }

  if (mode === 'live') {
    return (
      <section className="ref-entry ref-entry--center">
        <h1 className="ref-entry-title">Live console</h1>
        <p className="ref-entry-copy">
          Live mode wires up in slice 2B-D. The match clock, score blocks, and
          event log come next.
        </p>
      </section>
    )
  }

  if (mode === 'post') {
    return (
      <section className="ref-entry ref-entry--center">
        <h1 className="ref-entry-title">Submit pending</h1>
        <p className="ref-entry-copy">Post-match summary wires up in slice 2B-E.</p>
      </section>
    )
  }

  // mode === 'pre'
  if (!payload) return null

  const md = payload.matchday
  const kickoffLabel = formatKickoff(md.kickoff_at)

  if (!payload.has_match_row || md.roster_locked_at === null) {
    return (
      <section className="ref-entry ref-entry--center">
        <h1 className="ref-entry-title">Roster not yet locked</h1>
        <p className="ref-entry-copy">
          The admin hasn't locked the roster yet. Refresh once they have, or ask
          them to share a fresh ref link.
        </p>
      </section>
    )
  }

  return (
    <section className="ref-entry">
      <header className="ref-entry-header">
        <span className="ref-entry-md-label">Matchday</span>
        <h1 className="ref-entry-title">{kickoffLabel}</h1>
        <p className="ref-entry-meta">
          {md.effective_format} · {md.venue ?? 'Venue TBD'}
        </p>
      </header>

      <div className="ref-entry-rosters">
        <RosterCard team="white" players={payload.white} />
        <RosterCard team="black" players={payload.black} />
      </div>

      <div className="ref-entry-cta-wrap">
        <button
          type="button"
          className="ref-entry-cta"
          onClick={() => void startMatch()}
        >
          ⚽ KICK OFF
        </button>
        <p className="ref-entry-cta-hint">
          Screen will stay awake. Tap when the match starts.
        </p>
      </div>
    </section>
  )
}

interface RosterCardProps {
  team: 'white' | 'black'
  players: Array<{
    profile_id: string | null
    guest_id: string | null
    display_name: string
    primary_position: string | null
    is_captain: boolean
  }>
}

function RosterCard({ team, players }: RosterCardProps) {
  return (
    <div className={`ref-roster ref-roster--${team}`}>
      <div className="ref-roster-head">
        <span className={`ref-roster-chip ref-roster-chip--${team}`}>
          {team.toUpperCase()} · {players.length}
        </span>
      </div>
      <ul className="ref-roster-list">
        {players.map((p, i) => (
          <li
            key={(p.profile_id ?? p.guest_id ?? 'p') + ':' + i}
            className={`ref-roster-row${p.is_captain ? ' ref-roster-row--cap' : ''}`}
          >
            <span className="ref-roster-name">{p.display_name}</span>
            {p.is_captain && <span className="ref-roster-cap">C</span>}
            {p.primary_position && (
              <span className="ref-roster-pos">{p.primary_position.toUpperCase()}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function formatKickoff(iso: string): string {
  const d = new Date(iso)
  const dow = d.toLocaleDateString('en-GB', { weekday: 'short' })
  const day = d.getDate().toString().padStart(2, '0')
  const mon = d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()
  const year = d.getFullYear()
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  return `${dow} ${day}/${mon}/${year} · ${hh}:${mm}`
}
```

- [ ] **Step 3: Create `ffc/src/styles/ref-entry.css`**

Use Write tool:

```css
/* §3.4-v2 Slice 2B-C — RefEntry pre-match styles.
 *
 * RefEntry is rendered without the authenticated app shell so brand tokens
 * declared on .admin-matches / .po-screen don't apply. Declare them locally
 * on .ref-entry root so the page is self-contained. */

.ref-entry {
  --rf-bg: #0e1826;
  --rf-surface: rgba(20, 34, 52, 0.78);
  --rf-surface-2: #182437;
  --rf-border: rgba(242, 234, 214, 0.08);
  --rf-text: #f2ead6;
  --rf-text-muted: #85929f;
  --rf-accent: #e5ba5b;
  --rf-white-team: #f2ead6;
  --rf-black-team: #0a1018;

  min-height: 100vh;
  background: var(--rf-bg);
  color: var(--rf-text);
  padding: calc(20px + env(safe-area-inset-top, 12px)) 16px calc(28px + env(safe-area-inset-bottom, 12px));
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ref-entry--center {
  align-items: center;
  justify-content: center;
  text-align: center;
}

.ref-entry-spinner {
  width: 28px; height: 28px;
  border: 3px solid var(--rf-border);
  border-top-color: var(--rf-accent);
  border-radius: 50%;
  animation: ref-spin 0.9s linear infinite;
}
@keyframes ref-spin {
  to { transform: rotate(360deg); }
}

.ref-entry-title {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.01em;
  margin: 0;
}

.ref-entry-copy, .ref-entry-hint {
  color: var(--rf-text-muted);
  font-size: 14px;
  line-height: 1.55;
  max-width: 320px;
}

.ref-entry-error {
  color: var(--rf-accent);
  font-size: 12px;
  margin-top: 8px;
}

.ref-entry-header {
  text-align: center;
}

.ref-entry-md-label {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--rf-text-muted);
  margin-bottom: 6px;
}

.ref-entry-meta {
  color: var(--rf-text-muted);
  font-size: 13px;
  margin: 4px 0 0;
}

.ref-entry-rosters {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ref-roster {
  background: var(--rf-surface);
  border: 1px solid var(--rf-border);
  border-radius: 14px;
  padding: 14px;
}

.ref-roster-chip {
  display: inline-block;
  padding: 5px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  margin-bottom: 8px;
}
.ref-roster-chip--white { background: var(--rf-white-team); color: var(--rf-bg); }
.ref-roster-chip--black { background: var(--rf-black-team); color: var(--rf-text); border: 1px solid var(--rf-border); }

.ref-roster-list {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 13px;
  line-height: 1.7;
}

.ref-roster-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.ref-roster-row--cap { font-weight: 700; }

.ref-roster-name { flex: 1; }

.ref-roster-cap {
  font-size: 10px;
  font-weight: 800;
  background: var(--rf-accent);
  color: var(--rf-bg);
  padding: 2px 6px;
  border-radius: 4px;
  letter-spacing: 0.06em;
}

.ref-roster-pos {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--rf-text-muted);
}

.ref-entry-cta-wrap {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}

.ref-entry-cta {
  height: 88px;
  border-radius: 22px;
  background: var(--rf-accent);
  color: var(--rf-bg);
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border: none;
  box-shadow: 0 16px 40px -12px rgba(229,186,91,0.6);
  cursor: pointer;
}
.ref-entry-cta:active { transform: translateY(1px); }

.ref-entry-cta-hint {
  text-align: center;
  font-size: 12px;
  color: var(--rf-text-muted);
  margin: 0;
}
```

- [ ] **Step 4: tsc + vite verify**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc -b && node ./node_modules/vite/bin/vite.js build 2>&1 | tail -3
```

Expected: tsc EXIT 0; vite ✓ built.

- [ ] **Step 5: Commit**

```bash
git add ffc/src/lib/useMatchSession.ts ffc/src/pages/RefEntry.tsx ffc/src/styles/ref-entry.css
git commit -m "$(cat <<'EOF'
feat(s042,2b-c): RefEntry pre-match — useMatchSession hook + roster UI + KICK OFF

Replaces RefEntry stub with a real state-machine implementation.

- useMatchSession hook: loading | invalid | pre | live | post modes,
  localStorage-persisted state per token (key = sha256(token) prefix
  for cross-device safety), wake-lock request on KICK OFF.
- RefEntry pre-match: matchday header (kickoff label + format + venue),
  white/black roster cards with captain markers + position pills, big
  gold KICK OFF button bottom-anchored. Live and post modes render
  placeholders for slices 2B-D and 2B-E.
- ref-entry.css: standalone scope-root with brand tokens — RefEntry
  loads outside the authenticated app shell, so .ref-entry declares
  --rf-* tokens locally.
- Calls get_ref_matchday RPC (anon-callable, shipped this slice).
EOF
)"
```

---

## Task 4 — Build verify + S042 close-out + push (10 min)

- [ ] **Step 1: Final verify**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc -b
cd ffc && node ./node_modules/vite/bin/vite.js build 2>&1 | tail -5
```

Expected: tsc EXIT 0; vite ✓ built; PWA size up ~3-5 KiB (new component + CSS).

- [ ] **Step 2: Close out S042 in `tasks/todo.md`**

Update the `## NEXT SESSION — S042` block to S043. Insert `## Completed in S042 (26/APR/2026, Home PC)` section above S041. Mention:
- Migration 0029 `get_ref_matchday` anon RPC
- `useMatchSession` hook with localStorage + wake-lock
- RefEntry rewritten from stub → 5-mode state machine; pre-match UI live; live + post modes are placeholders for 2B-D/E
- Migrations on live DB: 29
- New patterns: (a) anon RPC for token-gated public reads (no RLS), (b) localStorage keyed by sha256(token) prefix, (c) wake-lock on user-gesture, (d) standalone scope-root brand tokens for unshelled routes.

S043 NEXT block: slice 2B-D — Live mode (clock, score block, scorer picker, pause/resume, cards, MOTM, event log).

- [ ] **Step 3: Append S042 segment to CLAUDE.md status header.**

One-sentence summary covering slice 2B-C: anon RPC + RefEntry pre-match shipped; migration 0029 live (29 total).

- [ ] **Step 4: Create `sessions/S042/session-log.md`**

Follow `sessions/S041/session-log.md` structure. Sections: header, what landed (per-task summary), verification, patterns/lessons, next session pointer (S043 → slice 2B-D).

- [ ] **Step 5: Append S042 row to `sessions/INDEX.md`** with S043 next-session pointer.

- [ ] **Step 6: Commit + push**

```bash
git add tasks/todo.md CLAUDE.md sessions/S042/session-log.md sessions/INDEX.md
git commit -m "$(cat <<'EOF'
docs(s042,2b-c): close-out — todo S042 + CLAUDE.md narrative + S042 session log + INDEX

Slice 2B-C shipped — anon get_ref_matchday RPC + RefEntry pre-match
mode. Migrations on live DB: 29. S043 agenda set for slice 2B-D
(Live mode — clock + score + scorer picker + pause/resume + cards +
MOTM + event log).
EOF
)"
git push
```

---

## Acceptance criteria — Slice 2B-C

- [ ] `0029_get_ref_matchday.sql` applies cleanly to live DB.
- [ ] `get_ref_matchday(text)` callable from anon and authenticated roles.
- [ ] Invalid token raises `Invalid or expired ref token`.
- [ ] Valid token returns `{ matchday, white, black, token_expires_at, has_match_row }` jsonb.
- [ ] `useMatchSession` hook hydrates from localStorage on mount.
- [ ] RefEntry renders matchday header + rosters + KICK OFF button when token is valid + roster locked.
- [ ] KICK OFF transitions to `live` mode (placeholder rendered).
- [ ] State persists across page refresh (refreshing on the live placeholder stays on live placeholder).
- [ ] tsc + vite clean.
- [ ] Migrations on live DB: 29.

---

## Out of scope

- Live mode UI (clock, score block, scorer picker, pause/resume, cards, MOTM) → slice 2B-D.
- Post-match summary + submit → slice 2B-E.
- Admin review screen → slice 2B-F.
- Phase 2A automation → slices 2A-A onward.

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-26-phase2-slice-2B-C.md`.**
