# Phase 2 Slice 2B-F — Admin Match-Entry Review Screen

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the admin review screen at `/admin/match-entries/:id` that loads a `pending_match_entries` row submitted by the ref console, renders timing summary + final score + MOTM + per-player aggregates + chronological event log with per-event drop affordance, and exposes APPROVE / REJECT actions wired to the existing `approve_match_entry` / `reject_match_entry` RPCs. Surface entry point: a "Ref entry awaiting review" CTA on the matchday card in `/admin/matches`.

**Architecture:** New dedicated route renders one self-contained screen. Hydrates from four queries in parallel: `pending_match_entries` (header + timing + score) + `pending_match_entry_players` (player grid) + `pending_match_events` (event log) + `matchdays` (kickoff label + format). Match-level inline edits (score / MOTM / notes) collected into a `p_edits` jsonb passed to `approve_match_entry`. Per-event drop is a new tiny admin RPC `admin_drop_pending_match_event(p_event_id)` introduced in migration 0032. AdminMatches gets a fifth Promise.all branch fetching the count of pending entries per matchday.

**Tech Stack:** React 19 + TypeScript 6 + React Router (`useParams`, `useNavigate`); supabase-js v2 for RPCs + table reads; brand-themed scope-root CSS tokens (~12 vars); shared `.sheet-overlay` / `.sheet` portal pattern (precedent in AdminMatches); `validateScoreMatchesGoals` lint warning (existing helper).

**Out of scope (deferred, NOT in this slice):**
- Per-player aggregate editing before approve (use `edit_match_players` post-approval if a stat is wrong).
- Admin-bottom-nav badge for pending entries (Phase 2A push notifications cover this — `ref_submitted` notification kind already exists).
- Realtime subscription on `pending_match_entries` (Phase 2 spec requires `ALTER PUBLICATION` first; deferred — admin pull-to-refresh is fine for v1).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/0032_admin_drop_pending_match_event.sql` | CREATE | Admin RPC `admin_drop_pending_match_event(p_event_id uuid)` — admin-gated, deletes one `pending_match_events` row + audits. |
| `ffc/src/lib/database.types.ts` | REGEN | Picks up the new RPC signature. |
| `ffc/src/pages/admin/MatchEntryReview.tsx` | CREATE | The screen. ~500 LOC target. Owns load + render + 3 inline-editable match-level fields + 3 sheets (Approve / Reject / Drop event). |
| `ffc/src/styles/match-entry-review.css` | CREATE | Scope-root brand tokens + screen-specific layout rules. ~200 LOC target. |
| `ffc/src/router.tsx` | MODIFY | Adds `{ path: 'admin/match-entries/:id', element: <MatchEntryReview /> }` inside the existing RoleLayout block. Import the page. |
| `ffc/src/pages/admin/AdminMatches.tsx` | MODIFY | Adds `pendingEntries: { id: string; submitted_at: string }[]` to `MatchdayWithMatch`; fifth Promise.all branch in `loadAll`; `onReviewPending` prop on `MatchdayCard`; new `<PendingReviewSection>` rendered conditionally inside the card. |

---

## Task 1: Migration 0032 — `admin_drop_pending_match_event` RPC

**Why:** The admin needs to drop a single bogus event row from a submitted entry before approving. Direct DELETE is blocked by RLS (pending_match_events has admin-SELECT only, no INSERT/UPDATE/DELETE policy). A SECURITY DEFINER RPC is the established pattern.

**Files:**
- Create: `supabase/migrations/0032_admin_drop_pending_match_event.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0032_admin_drop_pending_match_event.sql
-- Phase 2 Slice 2B-F — admin affordance to drop a single bogus event row
-- from a submitted ref entry before approving. Rare; for ref typos.
--
-- Idempotent on a missing row: returns silently if the event id no longer
-- exists (no-op rather than 22023). Caller (admin UI) refreshes the event
-- list after success either way, so a dropped-twice click is harmless.

BEGIN;

CREATE OR REPLACE FUNCTION admin_drop_pending_match_event(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pending_id uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  -- Capture the parent pending_entry_id for audit before delete.
  SELECT pending_entry_id INTO v_pending_id
    FROM pending_match_events
   WHERE id = p_event_id;

  IF v_pending_id IS NULL THEN
    RETURN;  -- already gone; idempotent no-op
  END IF;

  DELETE FROM pending_match_events WHERE id = p_event_id;

  PERFORM log_admin_action(
    'pending_match_events',
    p_event_id,
    'admin_drop_pending_match_event',
    jsonb_build_object('pending_entry_id', v_pending_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_drop_pending_match_event(uuid) TO authenticated;

COMMIT;
```

- [ ] **Step 2: Apply the migration to the live DB**

Run from project root:
```bash
npx supabase db push --linked
```

Expected output: `Applied migration 0032_admin_drop_pending_match_event`. Migrations on live DB jump from 31 → 32.

- [ ] **Step 3: Smoke-test from db query (sanity only — real verification is anon-key curl)**

```bash
npx supabase db query --linked "SELECT pg_get_functiondef('public.admin_drop_pending_match_event(uuid)'::regprocedure)" 2>&1 | head -30
```

Expected: function body printed with `SECURITY DEFINER` + `SET search_path = public` visible.

- [ ] **Step 4: Verify is_admin guard with anon-key curl** (per S043 lesson — db query lies for SECURITY DEFINER + auth-derived helpers)

```bash
curl -sX POST "https://hylarwwsedjxwavuwjrn.supabase.co/rest/v1/rpc/admin_drop_pending_match_event" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_event_id":"00000000-0000-0000-0000-000000000000"}'
```

Expected: `{"code":"42501","details":null,"hint":null,"message":"Admin role required"}`

- [ ] **Step 5: Regen types**

```bash
npx supabase gen types typescript --linked 2>/dev/null > ffc/src/lib/database.types.ts
```

Expected: file grows by ~5 lines for the new RPC signature. `wc -l ffc/src/lib/database.types.ts` reads ~2189.

- [ ] **Step 6: Build sanity**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc -b
```

Expected: EXIT 0 (no usages of the new RPC yet — types regen alone shouldn't break anything).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0032_admin_drop_pending_match_event.sql ffc/src/lib/database.types.ts
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(s046,2b-f): migration 0032 admin_drop_pending_match_event RPC

Admin-gated SECURITY DEFINER RPC for dropping a single bogus
pending_match_events row before approve. Idempotent on missing row.
Audited via log_admin_action.

Verified is_admin guard via anon-key curl (42501 returned for anon).

Migrations on live DB: 32."
```

---

## Task 2: Skeleton screen + route — read-only render

**Why:** Get the page loading + rendering data first. No actions yet. Validates the data fetch + types + brand-themed shell before wiring any mutations. Follows the project rule: "do not propose changes to code you haven't read."

**Files:**
- Create: `ffc/src/pages/admin/MatchEntryReview.tsx`
- Create: `ffc/src/styles/match-entry-review.css`
- Modify: `ffc/src/router.tsx` (add import + route)

- [ ] **Step 1: Create the CSS file with scope-root brand tokens**

```css
/* match-entry-review.css — Phase 2 Slice 2B-F.
 * Brand-themed scope-root tokens declared on .mer-screen.
 * Pattern source: Poll, Leaderboard, Matches (S035–S036).
 */

.mer-screen {
  --bg: #0e1826;
  --surface: rgba(20, 34, 52, 0.68);
  --surface-2: rgba(28, 44, 64, 0.78);
  --text: #f2ead6;
  --text-muted: rgba(242, 234, 214, 0.62);
  --border: rgba(242, 234, 214, 0.14);
  --accent: #e5ba5b;
  --success: #4fbf93;
  --warn: #d7a04a;
  --warning: #d7a04a;
  --danger: #e63349;
  --skel-a: rgba(242, 234, 214, 0.06);
  --skel-b: rgba(242, 234, 214, 0.10);

  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  padding: 16px 12px calc(96px + env(safe-area-inset-bottom)) 12px;
}

.mer-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  background: none;
  border: none;
  font-size: 14px;
  padding: 6px 0;
  cursor: pointer;
}
.mer-back:hover { color: var(--text); }

.mer-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0 16px;
}
.mer-header h1 {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
  letter-spacing: 0.2px;
}
.mer-header-sub {
  font-size: 13px;
  color: var(--text-muted);
}

.mer-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px;
  margin-bottom: 12px;
}

.mer-section-label {
  font-size: 11px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--text-muted);
  margin: 0 0 8px;
}

/* Final score block */
.mer-score-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
}
.mer-score-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.mer-score-team {
  font-size: 11px;
  letter-spacing: 1.2px;
  color: var(--text-muted);
}
.mer-score-value {
  font-size: 44px;
  font-weight: 700;
  line-height: 1;
}
.mer-score-side--winner .mer-score-value { color: var(--accent); }
.mer-score-dash {
  font-size: 28px;
  color: var(--text-muted);
}
.mer-score-input {
  width: 64px;
  height: 56px;
  font-size: 32px;
  font-weight: 700;
  text-align: center;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text);
}

/* Timing summary grid */
.mer-timing-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 16px;
}
.mer-timing-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.mer-timing-row dt { color: var(--text-muted); }
.mer-timing-row dd { margin: 0; font-variant-numeric: tabular-nums; }

/* Player grid (read-only in 2B-F) */
.mer-team-block {
  margin-bottom: 14px;
}
.mer-team-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}
.mer-team-head--white .mer-team-name::before { content: 'WHITE · '; color: var(--text-muted); font-weight: 400; }
.mer-team-head--black .mer-team-name::before { content: 'BLACK · '; color: var(--text-muted); font-weight: 400; }
.mer-player-row {
  display: grid;
  grid-template-columns: 1fr auto auto auto auto;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
  align-items: center;
}
.mer-player-row:last-child { border-bottom: none; }
.mer-player-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mer-player-stat {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  min-width: 28px;
  justify-content: flex-end;
}
.mer-player-stat--motm { color: var(--accent); }

/* Event log */
.mer-events-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.mer-event-row {
  display: grid;
  grid-template-columns: 48px 1fr auto;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  align-items: center;
}
.mer-event-row:last-child { border-bottom: none; }
.mer-event-min {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.mer-event-desc { color: var(--text); }
.mer-event-drop {
  background: none;
  border: 1px solid var(--border);
  color: var(--danger);
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}
.mer-event-drop:hover { background: rgba(230, 51, 73, 0.08); }
.mer-event-drop:disabled { opacity: 0.4; cursor: not-allowed; }
.mer-event-row--system { opacity: 0.7; }
.mer-event-row--system .mer-event-drop { display: none; }

/* MOTM block */
.mer-motm-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.mer-motm-name { font-weight: 600; }
.mer-motm-empty { color: var(--text-muted); font-style: italic; }
.mer-motm-change {
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}

/* Notes */
.mer-notes-textarea {
  width: 100%;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 10px;
  padding: 10px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  min-height: 72px;
}

/* Action row (sticky bottom) */
.mer-actions {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--bg);
  border-top: 1px solid var(--border);
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.mer-action-btn {
  height: 48px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
  border: 1px solid var(--border);
  cursor: pointer;
}
.mer-action-btn--reject { background: transparent; color: var(--danger); border-color: var(--danger); }
.mer-action-btn--reject:hover { background: rgba(230, 51, 73, 0.08); }
.mer-action-btn--approve { background: var(--accent); color: #1a1306; border-color: var(--accent); }
.mer-action-btn--approve:hover { filter: brightness(1.05); }
.mer-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Validation warning banner */
.mer-warn-banner {
  background: rgba(215, 160, 74, 0.12);
  border: 1px solid var(--warn);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13px;
  color: var(--warn);
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Error banner (reuses .auth-banner from app shell — local override only for color) */

/* Loading skeleton */
.mer-skel {
  background: linear-gradient(90deg, var(--skel-a) 25%, var(--skel-b) 50%, var(--skel-a) 75%);
  background-size: 200% 100%;
  animation: mer-skel 1.4s ease-in-out infinite;
  border-radius: 8px;
}
@keyframes mer-skel { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
```

- [ ] **Step 2: Create the screen file with skeleton + load-only rendering**

```typescript
// ffc/src/pages/admin/MatchEntryReview.tsx
//
// §B.4 — Admin Match-Entry Review screen at /admin/match-entries/:id.
//
// Slice 2B-F scope:
//   - Loads pending_match_entries row + per-player aggregates + event log + matchday header
//   - Renders read-only player grid + chronological event log with per-row drop affordance
//   - Match-level inline editable fields: score_white, score_black, motm_user_id, motm_guest_id, notes
//   - APPROVE → approve_match_entry({ p_pending_id, p_edits })
//   - REJECT  → reject_match_entry({ p_pending_id, p_reason })
//   - DROP single event → admin_drop_pending_match_event({ p_event_id }) (migration 0032)
//
// Deferred (NOT in this slice):
//   - Per-player aggregate edit-before-approve (post-approval edit_match_players covers it)
//   - Realtime subscription on pending_match_entries (needs ALTER PUBLICATION first)

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Database, Json } from '../../lib/database.types'
import '../../styles/match-entry-review.css'

type TeamColor = Database['public']['Enums']['team_color']
type MatchEventType = Database['public']['Enums']['match_event_type']
type MatchResult = Database['public']['Enums']['match_result']

type PendingEntryRow = Database['public']['Tables']['pending_match_entries']['Row']
type PendingPlayerRow = Database['public']['Tables']['pending_match_entry_players']['Row']
type PendingEventRow = Database['public']['Tables']['pending_match_events']['Row']

interface PlayerLite {
  id: string
  display_name: string
}
interface GuestLite {
  id: string
  display_name: string
}

interface ScreenData {
  entry: PendingEntryRow
  players: PendingPlayerRow[]
  events: PendingEventRow[]
  matchday: {
    id: string
    kickoff_at: string
    format: 'cancelled' | '7v7' | '5v5' | null
  }
  profilesById: Map<string, PlayerLite>
  guestsById: Map<string, GuestLite>
}

// ─── Helpers ───────────────────────────────────────────────────

function timeOnly(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
}

function formatMSS(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatMatchMinute(minute: number, second: number, regulationHalf: number): string {
  // Regulation: 0..(regHalf-1) → "M'", regHalf..regHalf*2-1 → "M'"
  // Stoppage 1st half: minute >= regHalf and < regHalf*2 → reads as "regHalf+N'"
  // We can't tell stoppage from regulation 2nd-half from minute alone, so we
  // rely on a simple rule: if minute in [regHalf, regHalf*2), it's
  // 2nd-half regulation. If >= regHalf*2, 2nd-half stoppage.
  // 1st-half stoppage events are stored with minute = regHalf, regHalf+1, etc.
  // BUT they were captured during 1st half. The pending_match_events table has
  // no 'half' column; we infer from event order vs the halftime/fulltime events.
  // For now, render as plain "M'M:SS" — refining stoppage notation is a polish
  // item. Match-second precision is preserved for sort stability.
  if (second === 0) return `${minute}'`
  return `${minute}'${String(second).padStart(2, '0')}`
}

function eventDescription(
  e: PendingEventRow,
  profiles: Map<string, PlayerLite>,
  guests: Map<string, GuestLite>,
): string {
  const teamLabel = e.team ? e.team.toUpperCase() : ''
  const participantName = e.profile_id
    ? (profiles.get(e.profile_id)?.display_name ?? '—')
    : e.guest_id
      ? (guests.get(e.guest_id)?.display_name ?? '—')
      : ''
  switch (e.event_type) {
    case 'goal':       return `${teamLabel} · Goal · ${participantName}`
    case 'own_goal':   return `${teamLabel} · Own goal · ${participantName}`
    case 'yellow_card': return `${teamLabel} · Yellow · ${participantName}`
    case 'red_card':    return `${teamLabel} · Red · ${participantName}`
    case 'pause':      return 'Pause'
    case 'resume':     return 'Resume'
    case 'halftime':   return 'Half-time'
    case 'fulltime':   return 'Full-time'
  }
}

function isSystemEvent(t: MatchEventType): boolean {
  return t === 'pause' || t === 'resume' || t === 'halftime' || t === 'fulltime'
}

function deriveResult(scoreWhite: number, scoreBlack: number): MatchResult {
  if (scoreWhite > scoreBlack) return 'white'
  if (scoreBlack > scoreWhite) return 'black'
  return 'draw'
}

interface TeamGoalRow { team: TeamColor | null; goals: number }
function validateScoreMatchesGoals(
  scoreWhite: number,
  scoreBlack: number,
  rows: TeamGoalRow[],
): { ok: boolean; messages: string[] } {
  let whiteSum = 0
  let blackSum = 0
  for (const r of rows) {
    if (r.team === 'white') whiteSum += r.goals
    else if (r.team === 'black') blackSum += r.goals
  }
  const messages: string[] = []
  if (whiteSum !== scoreWhite) messages.push(`White scoreline ${scoreWhite} vs player goals ${whiteSum}`)
  if (blackSum !== scoreBlack) messages.push(`Black scoreline ${scoreBlack} vs player goals ${blackSum}`)
  return { ok: messages.length === 0, messages }
}

// ─── Component ─────────────────────────────────────────────────

export function MatchEntryReview() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<ScreenData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Match-level inline edits (only set when user changes from pending value).
  const [editScoreWhite, setEditScoreWhite] = useState<number | null>(null)
  const [editScoreBlack, setEditScoreBlack] = useState<number | null>(null)
  const [editNotes, setEditNotes] = useState<string | null>(null)
  const [editMotm, setEditMotm] = useState<{ profile_id: string | null; guest_id: string | null } | null>(null)

  const loadAll = useCallback(async (entryId: string) => {
    setLoading(true)
    setError(null)
    try {
      const [entryRes, playersRes, eventsRes] = await Promise.all([
        supabase.from('pending_match_entries').select('*').eq('id', entryId).single(),
        supabase.from('pending_match_entry_players').select('*').eq('pending_entry_id', entryId),
        supabase.from('pending_match_events').select('*').eq('pending_entry_id', entryId).order('ordinal', { ascending: true }),
      ])
      if (entryRes.error) throw entryRes.error
      if (playersRes.error) throw playersRes.error
      if (eventsRes.error) throw eventsRes.error

      const entry = entryRes.data
      const players = playersRes.data ?? []
      const events = eventsRes.data ?? []

      const mdRes = await supabase.from('matchdays').select('id, kickoff_at, format').eq('id', entry.matchday_id).single()
      if (mdRes.error) throw mdRes.error

      // Resolve display names for profiles + guests referenced in players + events.
      const profileIds = new Set<string>()
      const guestIds = new Set<string>()
      for (const p of players) { if (p.profile_id) profileIds.add(p.profile_id); if (p.guest_id) guestIds.add(p.guest_id) }
      for (const e of events) { if (e.profile_id) profileIds.add(e.profile_id); if (e.guest_id) guestIds.add(e.guest_id) }
      // MOTM also needs lookups.
      // (Pending entry doesn't store MOTM at row level — it's on the player row via is_motm.)

      const [profilesRes, guestsRes] = await Promise.all([
        profileIds.size > 0
          ? supabase.from('profiles').select('id, display_name').in('id', [...profileIds])
          : Promise.resolve({ data: [], error: null }),
        guestIds.size > 0
          ? supabase.from('match_guests').select('id, display_name').in('id', [...guestIds])
          : Promise.resolve({ data: [], error: null }),
      ])
      if (profilesRes.error) throw profilesRes.error
      if (guestsRes.error) throw guestsRes.error

      const profilesById = new Map<string, PlayerLite>()
      for (const p of (profilesRes.data ?? []) as PlayerLite[]) profilesById.set(p.id, p)
      const guestsById = new Map<string, GuestLite>()
      for (const g of (guestsRes.data ?? []) as GuestLite[]) guestsById.set(g.id, g)

      setData({
        entry,
        players,
        events,
        matchday: { id: mdRes.data.id, kickoff_at: mdRes.data.kickoff_at, format: mdRes.data.format },
        profilesById,
        guestsById,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!id) return
    void loadAll(id)
  }, [id, loadAll])

  // Effective scores after inline edits, used for both display + validation.
  const effectiveScoreWhite = editScoreWhite ?? data?.entry.score_white ?? 0
  const effectiveScoreBlack = editScoreBlack ?? data?.entry.score_black ?? 0

  const validation = useMemo(() => {
    if (!data) return { ok: true, messages: [] as string[] }
    return validateScoreMatchesGoals(
      effectiveScoreWhite,
      effectiveScoreBlack,
      data.players.map((p) => ({ team: p.team, goals: p.goals })),
    )
  }, [data, effectiveScoreWhite, effectiveScoreBlack])

  const regulationHalf = data?.matchday.format === '5v5' ? 25 : 35

  if (loading) {
    return (
      <section className="mer-screen">
        <button type="button" className="mer-back" onClick={() => navigate('/admin/matches')}>← Admin · Matches</button>
        <div className="mer-card"><div className="mer-skel" style={{ height: 80 }} /></div>
        <div className="mer-card"><div className="mer-skel" style={{ height: 120 }} /></div>
      </section>
    )
  }

  if (error || !data) {
    return (
      <section className="mer-screen">
        <button type="button" className="mer-back" onClick={() => navigate('/admin/matches')}>← Admin · Matches</button>
        <div className="auth-banner auth-banner--danger" role="alert" style={{ margin: '16px 0' }}>
          {error ?? 'Entry not found'}
        </div>
      </section>
    )
  }

  const { entry, players, events, matchday, profilesById, guestsById } = data
  const whitePlayers = players.filter((p) => p.team === 'white')
  const blackPlayers = players.filter((p) => p.team === 'black')
  const motmPlayer = players.find((p) => p.is_motm)
  const motmName = motmPlayer
    ? (motmPlayer.profile_id ? profilesById.get(motmPlayer.profile_id)?.display_name : guestsById.get(motmPlayer.guest_id ?? '')?.display_name) ?? '—'
    : null

  const winningSide = effectiveScoreWhite > effectiveScoreBlack ? 'white' : effectiveScoreBlack > effectiveScoreWhite ? 'black' : 'draw'

  return (
    <section className="mer-screen">
      <button type="button" className="mer-back" onClick={() => navigate('/admin/matches')}>← Admin · Matches</button>

      <header className="mer-header">
        <h1>Match-entry review</h1>
        <span className="mer-header-sub">{dateLabel(matchday.kickoff_at)} · {matchday.format ?? '7v7'} · submitted {timeOnly(entry.submitted_at)}</span>
      </header>

      {!validation.ok && (
        <div className="mer-warn-banner" role="alert">
          <strong>Score vs player goals mismatch</strong>
          {validation.messages.map((m, i) => <span key={i}>{m}</span>)}
        </div>
      )}

      {/* Final score + inline edit */}
      <div className="mer-card">
        <h2 className="mer-section-label">Final score</h2>
        <div className="mer-score-row">
          <div className={`mer-score-side${winningSide === 'white' ? ' mer-score-side--winner' : ''}`}>
            <span className="mer-score-team">WHITE</span>
            <input
              type="number"
              min={0}
              className="mer-score-input"
              value={effectiveScoreWhite}
              onChange={(e) => setEditScoreWhite(Math.max(0, parseInt(e.target.value || '0', 10)))}
            />
          </div>
          <span className="mer-score-dash">–</span>
          <div className={`mer-score-side${winningSide === 'black' ? ' mer-score-side--winner' : ''}`}>
            <span className="mer-score-team">BLACK</span>
            <input
              type="number"
              min={0}
              className="mer-score-input"
              value={effectiveScoreBlack}
              onChange={(e) => setEditScoreBlack(Math.max(0, parseInt(e.target.value || '0', 10)))}
            />
          </div>
        </div>
      </div>

      {/* Timing summary */}
      <div className="mer-card">
        <h2 className="mer-section-label">Timing</h2>
        <dl className="mer-timing-grid">
          <div className="mer-timing-row"><dt>Kickoff</dt><dd>{timeOnly(entry.kickoff_at)}</dd></div>
          <div className="mer-timing-row"><dt>Half-time</dt><dd>{timeOnly(entry.halftime_at)}</dd></div>
          <div className="mer-timing-row"><dt>Full-time</dt><dd>{timeOnly(entry.fulltime_at)}</dd></div>
          <div className="mer-timing-row"><dt>1st-half stoppage</dt><dd>{formatMSS(entry.stoppage_h1_seconds)}</dd></div>
          <div className="mer-timing-row"><dt>2nd-half stoppage</dt><dd>{formatMSS(entry.stoppage_h2_seconds)}</dd></div>
          <div className="mer-timing-row"><dt>Result</dt><dd>{deriveResult(effectiveScoreWhite, effectiveScoreBlack).toUpperCase()}</dd></div>
        </dl>
      </div>

      {/* MOTM */}
      <div className="mer-card">
        <h2 className="mer-section-label">Man of the Match</h2>
        <div className="mer-motm-row">
          {motmName ? <span className="mer-motm-name">{motmName}</span> : <span className="mer-motm-empty">— none —</span>}
          {/* Change/Set deferred — uses sheet wired in Task 4 */}
        </div>
      </div>

      {/* Per-player grid (read-only in 2B-F) */}
      <div className="mer-card">
        <h2 className="mer-section-label">Player aggregates</h2>
        <div className="mer-team-block mer-team-head--white">
          <div className="mer-team-head"><span className="mer-team-name">{whitePlayers.length} on roster</span></div>
          {whitePlayers.map((p) => (
            <PlayerRow key={p.id} row={p} profiles={profilesById} guests={guestsById} />
          ))}
        </div>
        <div className="mer-team-block mer-team-head--black">
          <div className="mer-team-head"><span className="mer-team-name">{blackPlayers.length} on roster</span></div>
          {blackPlayers.map((p) => (
            <PlayerRow key={p.id} row={p} profiles={profilesById} guests={guestsById} />
          ))}
        </div>
      </div>

      {/* Event log */}
      <div className="mer-card">
        <h2 className="mer-section-label">Event log · {events.length}</h2>
        {events.length === 0 ? (
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>No events recorded.</span>
        ) : (
          <ul className="mer-events-list">
            {events.map((e) => (
              <li key={e.id} className={`mer-event-row${isSystemEvent(e.event_type) ? ' mer-event-row--system' : ''}`}>
                <span className="mer-event-min">{formatMatchMinute(e.match_minute, e.match_second, regulationHalf)}</span>
                <span className="mer-event-desc">{eventDescription(e, profilesById, guestsById)}</span>
                <button
                  type="button"
                  className="mer-event-drop"
                  disabled
                  aria-label="Drop event (wired in Task 4)"
                  title="Drop"
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Notes (read-only in this Task; editable in Task 4 sheet) */}
      {entry.notes && (
        <div className="mer-card">
          <h2 className="mer-section-label">Ref notes</h2>
          <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{entry.notes}</p>
        </div>
      )}

      {/* Action row stub — wired in Task 4 */}
      <div className="mer-actions">
        <button type="button" className="mer-action-btn mer-action-btn--reject" disabled>Reject</button>
        <button type="button" className="mer-action-btn mer-action-btn--approve" disabled>Approve</button>
      </div>
    </section>
  )
}

// ─── PlayerRow sub-component ───────────────────────────────────

function PlayerRow({
  row, profiles, guests,
}: {
  row: PendingPlayerRow
  profiles: Map<string, PlayerLite>
  guests: Map<string, GuestLite>
}) {
  const name = row.profile_id
    ? (profiles.get(row.profile_id)?.display_name ?? '—')
    : (guests.get(row.guest_id ?? '')?.display_name ?? '—')
  return (
    <div className="mer-player-row">
      <span className="mer-player-name">{name}</span>
      <span className="mer-player-stat" title="Goals">⚽ {row.goals}</span>
      <span className="mer-player-stat" title="Yellows">🟨 {row.yellow_cards}</span>
      <span className="mer-player-stat" title="Reds">🟥 {row.red_cards}</span>
      <span className={`mer-player-stat${row.is_motm ? ' mer-player-stat--motm' : ''}`} title="MOTM">{row.is_motm ? '⭐' : ''}</span>
    </div>
  )
}
```

- [ ] **Step 3: Wire the route in `router.tsx`**

Edit `ffc/src/router.tsx`. Add the import at the top with the other admin imports:

```typescript
import { MatchEntryReview } from './pages/admin/MatchEntryReview'
```

Add the route inside the `RoleLayout` block, alongside the existing admin routes:

```typescript
{ path: 'admin/match-entries/:id', element: <MatchEntryReview /> },
```

Place it after `{ path: 'admin/seasons', element: <AdminSeasons /> },` so the admin routes stay grouped.

- [ ] **Step 4: Build sanity**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc -b
```

Expected: EXIT 0. Vite-style import resolution + types match the regenerated `database.types.ts`.

- [ ] **Step 5: Preview-verify the skeleton**

Start dev server (or rely on local `npm run dev` if already running):
```bash
cd ffc && node ./node_modules/vite/bin/vite.js
```

Navigate manually to `/admin/match-entries/00000000-0000-0000-0000-000000000000` (a deliberately-bad UUID). Expected: error banner with "Entry not found" or PostgREST single-row error message, plus the back-link works.

- [ ] **Step 6: Commit**

```bash
git add ffc/src/pages/admin/MatchEntryReview.tsx ffc/src/styles/match-entry-review.css ffc/src/router.tsx
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(s046,2b-f): MatchEntryReview screen — read-only render

New route /admin/match-entries/:id renders pending_match_entries
header (timing summary + final score), per-player aggregate grid
(read-only), chronological event log with system-event styling, MOTM
display, and ref-notes block. Brand-themed scope-root tokens at
.mer-screen. Action row stub disabled — wired in next commit.

Migrations on live DB: 32."
```

---

## Task 3: Surface entry point in AdminMatches

**Why:** Admin needs a discoverable path to the new review screen. Following the existing `result_edit` button pattern: a CTA inline on the matchday card when a pending entry exists.

**Files:**
- Modify: `ffc/src/pages/admin/AdminMatches.tsx`

- [ ] **Step 1: Extend `MatchdayWithMatch` interface and add fifth Promise.all branch**

In `AdminMatches.tsx` near line 54 (`interface MatchdayWithMatch extends MatchdayRow { ... }`) add the field:

```typescript
interface MatchdayWithMatch extends MatchdayRow {
  match?: MatchRow | null
  effective_format: MatchFormat
  draft?: DraftInfo | null
  activeToken?: ActiveTokenInfo
  pendingEntryId?: string  // present iff a pending_match_entries row with status='pending' exists
}
```

In `loadAll` (around line 186), extend the `Promise.all` array to include a sixth branch:

```typescript
const [mdRes, matchesRes, seasonsRes, draftsRes, tokensRes, pendingRes] = await Promise.all([
  supabase.from('matchdays').select('*').order('kickoff_at', { ascending: false }).limit(60),
  supabase.from('matches').select('id, matchday_id, score_white, score_black, result, motm_user_id, motm_guest_id, approved_at, notes'),
  supabase.from('seasons').select('id, default_format, ended_at').is('ended_at', null).order('starts_on', { ascending: false }).limit(1),
  supabase.from('draft_sessions').select('id, matchday_id, status, current_picker_team, reason, started_at, triggered_by_profile_id').in('status', ['in_progress']),
  supabase.from('ref_tokens').select('matchday_id, expires_at').is('consumed_at', null).gt('expires_at', new Date().toISOString()),
  supabase.from('pending_match_entries').select('id, matchday_id').eq('status', 'pending'),
])
```

Right after the existing `tokensByMd` loop, insert:

```typescript
const pendingByMd = new Map<string, string>()
for (const pe of (pendingRes.data ?? []) as { id: string; matchday_id: string }[]) {
  pendingByMd.set(pe.matchday_id, pe.id)
}
```

In the `enriched` map (around line 239), add the field:

```typescript
const enriched: MatchdayWithMatch[] = ((mdRes.data ?? []) as MatchdayRow[]).map((md) => ({
  ...md,
  match: matchByMd.get(md.id) ?? null,
  effective_format: md.format ?? (season?.default_format as MatchFormat) ?? '7v7',
  draft: draftByMd.get(md.id) ?? null,
  activeToken: tokensByMd.get(md.id),
  pendingEntryId: pendingByMd.get(md.id),
}))
```

- [ ] **Step 2: Add prop to `MatchdayCard` and CTA inside the card**

Find `MatchdayCard` component definition (likely around line 600+; search for `function MatchdayCard`). Add the prop:

```typescript
interface MatchdayCardProps {
  md: MatchdayWithMatch
  onEdit: () => void
  onLock: () => void
  onEnterResult: () => void
  onEditResult: () => void
  onDraftForceComplete: () => void
  onDraftAbandon: () => void
  onFormation: () => void
  onPickCaptains: () => void
  onMintRefLink: () => void
  mintBusy: boolean
  onReviewPending: () => void  // NEW
}
```

In the card's render, near the existing footer actions (lock/result/edit-result/etc.), insert a conditional CTA block. Reuse the `.admin-friendly-card` pattern — a tinted block with a single label + action row:

```tsx
{md.pendingEntryId && !md.match?.approved_at && (
  <div className="admin-md-pending-review" role="region" aria-label="Pending ref entry">
    <span className="admin-md-pending-label">⏳ Ref entry awaiting review</span>
    <button type="button" className="auth-btn auth-btn--approve admin-md-pending-cta" onClick={onReviewPending}>
      Review →
    </button>
  </div>
)}
```

- [ ] **Step 3: Pass the handler from the parent**

In the matchday list render (around line 354), pass the new prop:

```tsx
<MatchdayCard
  key={md.id}
  md={md}
  onEdit={() => setSheet({ kind: 'edit_md', md })}
  onLock={() => setSheet({ kind: 'lock', md })}
  onEnterResult={() => setSheet({ kind: 'result', md, mode: 'create' })}
  onEditResult={() => md.match && setSheet({ kind: 'result_edit', md, match: md.match })}
  onDraftForceComplete={() => setSheet({ kind: 'draft_force_complete', md })}
  onDraftAbandon={() => setSheet({ kind: 'draft_abandon', md })}
  onFormation={() => md.match && navigate(`/match/${md.match.id}/formation`)}
  onPickCaptains={() => navigate(`/matchday/${md.id}/captains`)}
  onMintRefLink={() => { void handleMintRefLink(md) }}
  mintBusy={mintBusy === md.id}
  onReviewPending={() => md.pendingEntryId && navigate(`/admin/match-entries/${md.pendingEntryId}`)}
/>
```

- [ ] **Step 4: Add CSS for the pending-review CTA block**

Append to `ffc/src/index.css` (or whatever shared admin stylesheet AdminMatches uses — search for `.admin-friendly-card` to find the file). Add:

```css
.admin-md-pending-review {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(229, 186, 91, 0.08);
  border: 1px solid rgba(229, 186, 91, 0.32);
  border-radius: 10px;
  margin: 8px 0;
}
.admin-md-pending-label {
  font-size: 13px;
  color: var(--accent, #e5ba5b);
  font-weight: 500;
}
.admin-md-pending-cta {
  white-space: nowrap;
  font-size: 13px;
  padding: 6px 12px;
}
```

- [ ] **Step 5: Build sanity**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc -b
```

Expected: EXIT 0.

- [ ] **Step 6: Preview-verify**

Reload `/admin/matches`. With at least one pending entry in the DB (from the live device test or a manual SQL insert), confirm the "⏳ Ref entry awaiting review" CTA appears on the relevant card and the Review button navigates to the new screen.

If you want to fabricate test data without running the live ref flow:
```sql
-- insert a fake pending entry for an existing matchday with a draft match
INSERT INTO pending_match_entries (matchday_id, submitted_by_token_id, result, score_white, score_black, status, kickoff_at, halftime_at, fulltime_at)
SELECT m.id, rt.id, 'white', 3, 1, 'pending', now() - interval '2 hours', now() - interval '85 minutes', now() - interval '40 minutes'
FROM matchdays m
JOIN ref_tokens rt ON rt.matchday_id = m.id
WHERE m.kickoff_at < now() ORDER BY m.kickoff_at DESC LIMIT 1
RETURNING id;
```

- [ ] **Step 7: Commit**

```bash
git add ffc/src/pages/admin/AdminMatches.tsx ffc/src/index.css
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(s046,2b-f): surface pending-review CTA on AdminMatches cards

Sixth Promise.all branch fetches pending_match_entries with
status='pending'; per-card 'Ref entry awaiting review' block with
Review button navigates to /admin/match-entries/:id."
```

---

## Task 4: Wire actions — Approve / Reject / Drop event sheets

**Why:** Now that the screen renders + entry surface is live, ship the three mutating flows. All three use the existing `.sheet-overlay` / `.sheet` portal pattern from AdminMatches.

**Files:**
- Modify: `ffc/src/pages/admin/MatchEntryReview.tsx` (add three sheet components + state)

- [ ] **Step 1: Add sheet state + reload-after-action helper to the screen**

Inside `MatchEntryReview()`, near the inline-edit state declarations, add:

```typescript
type Sheet =
  | { kind: 'approve' }
  | { kind: 'reject' }
  | { kind: 'drop_event'; event: PendingEventRow }
  | { kind: 'motm' }
  | null

const [sheet, setSheet] = useState<Sheet>(null)
const [sheetBusy, setSheetBusy] = useState(false)
const [actionError, setActionError] = useState<string | null>(null)
```

- [ ] **Step 2: Implement `handleApprove`, `handleReject`, `handleDropEvent`**

Place these inside the component body, after the existing `loadAll` call:

```typescript
const handleApprove = async () => {
  if (!data || !id) return
  setSheetBusy(true)
  setActionError(null)
  try {
    // Build p_edits jsonb from match-level inline edits.
    const edits: Record<string, Json> = {}
    if (editScoreWhite !== null && editScoreWhite !== data.entry.score_white) edits.score_white = editScoreWhite
    if (editScoreBlack !== null && editScoreBlack !== data.entry.score_black) edits.score_black = editScoreBlack
    if (editNotes !== null && editNotes !== (data.entry.notes ?? '')) edits.notes = editNotes
    if (editMotm !== null) {
      edits.motm_user_id = editMotm.profile_id
      edits.motm_guest_id = editMotm.guest_id
    }
    // Always recompute result if scores were edited.
    if ('score_white' in edits || 'score_black' in edits) {
      edits.result = deriveResult(
        (edits.score_white as number | undefined) ?? data.entry.score_white,
        (edits.score_black as number | undefined) ?? data.entry.score_black,
      )
    }
    const { error } = await supabase.rpc('approve_match_entry', {
      p_pending_id: id,
      p_edits: edits as unknown as Json,
    })
    if (error) throw error
    setSheet(null)
    navigate('/admin/matches')
  } catch (e) {
    setActionError(e instanceof Error ? e.message : String(e))
  } finally {
    setSheetBusy(false)
  }
}

const handleReject = async (reason: string) => {
  if (!id) return
  if (reason.trim().length === 0) {
    setActionError('Reject reason is required')
    return
  }
  setSheetBusy(true)
  setActionError(null)
  try {
    const { error } = await supabase.rpc('reject_match_entry', {
      p_pending_id: id,
      p_reason: reason,
    })
    if (error) throw error
    setSheet(null)
    navigate('/admin/matches')
  } catch (e) {
    setActionError(e instanceof Error ? e.message : String(e))
  } finally {
    setSheetBusy(false)
  }
}

const handleDropEvent = async (eventId: string) => {
  if (!id) return
  setSheetBusy(true)
  setActionError(null)
  try {
    const { error } = await supabase.rpc('admin_drop_pending_match_event', {
      p_event_id: eventId,
    })
    if (error) throw error
    setSheet(null)
    await loadAll(id)  // refresh event log
  } catch (e) {
    setActionError(e instanceof Error ? e.message : String(e))
  } finally {
    setSheetBusy(false)
  }
}
```

- [ ] **Step 3: Replace the disabled action-row buttons with live ones**

In the `.mer-actions` JSX block, replace the disabled buttons:

```tsx
<div className="mer-actions">
  <button
    type="button"
    className="mer-action-btn mer-action-btn--reject"
    onClick={() => setSheet({ kind: 'reject' })}
    disabled={sheetBusy}
  >
    Reject
  </button>
  <button
    type="button"
    className="mer-action-btn mer-action-btn--approve"
    onClick={() => setSheet({ kind: 'approve' })}
    disabled={sheetBusy}
  >
    Approve
  </button>
</div>
```

- [ ] **Step 4: Replace the disabled drop button on each event row**

In the events list, replace the disabled `mer-event-drop`:

```tsx
<button
  type="button"
  className="mer-event-drop"
  onClick={() => setSheet({ kind: 'drop_event', event: e })}
  disabled={isSystemEvent(e.event_type) || sheetBusy}
  aria-label="Drop event"
  title={isSystemEvent(e.event_type) ? 'System events cannot be dropped' : 'Drop event'}
>
  🗑
</button>
```

- [ ] **Step 5: Add the three sheet components below the screen JSX**

Inside the screen component, just before the closing `</section>`, render the sheet portal:

```tsx
{sheet && createPortal(
  <div className="sheet-overlay" role="dialog" aria-modal onClick={() => !sheetBusy && setSheet(null)}>
    <div className="sheet" onClick={(e) => e.stopPropagation()}>
      <div className="sheet-handle" aria-hidden />
      {sheet.kind === 'approve' && (
        <ApproveSheet
          scoreWhite={effectiveScoreWhite}
          scoreBlack={effectiveScoreBlack}
          mismatch={!validation.ok}
          busy={sheetBusy}
          error={actionError}
          onConfirm={handleApprove}
          onCancel={() => !sheetBusy && setSheet(null)}
        />
      )}
      {sheet.kind === 'reject' && (
        <RejectSheet
          busy={sheetBusy}
          error={actionError}
          onConfirm={handleReject}
          onCancel={() => !sheetBusy && setSheet(null)}
        />
      )}
      {sheet.kind === 'drop_event' && (
        <DropEventSheet
          event={sheet.event}
          description={eventDescription(sheet.event, profilesById, guestsById)}
          minute={formatMatchMinute(sheet.event.match_minute, sheet.event.match_second, regulationHalf)}
          busy={sheetBusy}
          error={actionError}
          onConfirm={() => handleDropEvent(sheet.event.id)}
          onCancel={() => !sheetBusy && setSheet(null)}
        />
      )}
    </div>
  </div>,
  document.body,
)}
```

- [ ] **Step 6: Define the three sheet sub-components below `PlayerRow`**

```tsx
function ApproveSheet({
  scoreWhite, scoreBlack, mismatch, busy, error, onConfirm, onCancel,
}: {
  scoreWhite: number; scoreBlack: number; mismatch: boolean
  busy: boolean; error: string | null
  onConfirm: () => void; onCancel: () => void
}) {
  return (
    <>
      <h3>Approve match entry?</h3>
      <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
        Final: WHITE {scoreWhite} – {scoreBlack} BLACK. The match record will be promoted; player stats and event log will be locked in.
      </p>
      {mismatch && (
        <div className="mer-warn-banner">
          Score vs player goals don't match. Approve anyway only if you're sure.
        </div>
      )}
      {error && <div className="auth-banner auth-banner--danger" role="alert">{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="auth-btn auth-btn--approve" onClick={onConfirm} disabled={busy}>{busy ? 'Approving…' : 'Approve'}</button>
      </div>
    </>
  )
}

function RejectSheet({
  busy, error, onConfirm, onCancel,
}: {
  busy: boolean; error: string | null
  onConfirm: (reason: string) => void; onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  return (
    <>
      <h3>Reject this entry?</h3>
      <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
        The pending row + event log will be deleted. The ref must regenerate the link to resubmit.
      </p>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Reason (visible in audit log)</label>
      <textarea
        className="mer-notes-textarea"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        maxLength={300}
        placeholder="e.g. Wrong scoreline; ref to resubmit"
      />
      {error && <div className="auth-banner auth-banner--danger" role="alert">{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="auth-btn auth-btn--reject-filled" onClick={() => onConfirm(reason)} disabled={busy || reason.trim().length === 0}>{busy ? 'Rejecting…' : 'Reject'}</button>
      </div>
    </>
  )
}

function DropEventSheet({
  description, minute, busy, error, onConfirm, onCancel,
}: {
  event: PendingEventRow; description: string; minute: string
  busy: boolean; error: string | null
  onConfirm: () => void; onCancel: () => void
}) {
  return (
    <>
      <h3>Drop this event?</h3>
      <p style={{ fontSize: 14 }}><strong>{minute}</strong> · {description}</p>
      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        The event will be removed from this entry. The score and per-player aggregates are <strong>not</strong> auto-recalculated — adjust them manually before approving.
      </p>
      {error && <div className="auth-banner auth-banner--danger" role="alert">{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        <button type="button" className="auth-btn auth-btn--sheet-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="auth-btn auth-btn--reject-filled" onClick={onConfirm} disabled={busy}>{busy ? 'Dropping…' : 'Drop event'}</button>
      </div>
    </>
  )
}
```

(The `event` prop on `DropEventSheet` is captured in the `Sheet` discriminated union but isn't used inside the body — the description + minute are derived in the parent. Keep it for type-completeness; TS will flag it as unused if strict-no-unused-args is enabled, in which case prefix with `_event`.)

- [ ] **Step 7: Build sanity**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc -b
```

Expected: EXIT 0. If `event` is flagged unused, rename to `_event`.

- [ ] **Step 8: Preview-verify each flow against test data**

Using the SQL-fabricated pending entry from Task 3 Step 6:

1. Navigate to `/admin/match-entries/<id>` → entry renders.
2. Tap 🗑 on a goal event → drop sheet → Confirm → event disappears, score does NOT auto-update (per UX copy), no errors.
3. Tap Reject → sheet opens → empty reason disables Confirm → type "test reject" → Confirm → navigates back to `/admin/matches`. Entry should be gone from the list.
4. Re-fabricate the pending entry. Tap Approve → sheet → Confirm → navigates back. The matchday card now shows "Final" instead of "Ref entry awaiting review".
5. Verify in DB: `SELECT status FROM pending_match_entries WHERE id = '<id>'` → 'approved'. `SELECT count(*) FROM match_events WHERE match_id = (SELECT id FROM matches WHERE matchday_id = '<md_id>')` → matches the event count from before.

- [ ] **Step 9: Commit**

```bash
git add ffc/src/pages/admin/MatchEntryReview.tsx
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(s046,2b-f): wire approve/reject/drop-event actions

ApproveSheet — submits inline-edited match-level fields (score, MOTM,
notes) via approve_match_entry p_edits jsonb. Score-vs-goals mismatch
shown as warning, not blocker.

RejectSheet — required reason min 1 char, calls reject_match_entry,
navigates back to /admin/matches on success.

DropEventSheet — calls migration 0032 admin_drop_pending_match_event;
copy explicitly warns admin that score and player aggregates are not
auto-recalculated."
```

---

## Task 5: Build verification + close-out

**Files:** None modified — verification + docs only.

- [ ] **Step 1: Full build**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc -b && node ./node_modules/vite/bin/vite.js build
```

Expected: both EXIT 0. PWA precache count ≈ 12 entries (one new chunk for MatchEntryReview).

- [ ] **Step 2: ESLint check on changed files**

```bash
cd ffc && node ./node_modules/eslint/bin/eslint.js src/pages/admin/MatchEntryReview.tsx src/pages/admin/AdminMatches.tsx
```

Expected: no errors. Warnings about `react-hooks/exhaustive-deps` are acceptable if explicit (eslint-disable-next-line with intent comment).

- [ ] **Step 3: Update CLAUDE.md status line + open `tasks/todo.md` for S046 close**

In `CLAUDE.md`, append S046 narrative to the Current state line (you are NOT writing the full session log here — that's separate). Add the migration count update: "**Migrations on live DB: 32 (0001 → 0032).**"

- [ ] **Step 4: Append session-log file**

Create `sessions/S046/session-log.md` summarising the slice: what shipped, what was deferred, gotchas/lessons (e.g. score-vs-goals mismatch warning copy, `as unknown as Json` precedent reused, drop-event explicit-non-auto-recalc UX copy).

- [ ] **Step 5: Close-out commit**

```bash
git add CLAUDE.md tasks/todo.md sessions/INDEX.md sessions/S046/
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "docs(s046,2b-f): close-out — session log + INDEX + CLAUDE.md status + todo S047 prep"
git push origin main
```

- [ ] **Step 6: Verify Vercel deploy**

Check `https://ffc-gilt.vercel.app/admin/match-entries/<existing-pending-id>` once Vercel deploy is READY (~30 s). Smoke-test the approve flow on a real pending entry if one exists from the live device test.

---

## Self-Review Notes

Coverage check vs spec §B.4:
- ✅ Final score (large) — Task 2 + 4 (inline editable)
- ✅ Per-player grid — Task 2 (read-only; edit-before-approve deferred per scope)
- ✅ Event timeline with 🗑 per row — Task 2 + 4
- ✅ Timing summary (kickoff / halftime / fulltime / stoppage h1 / stoppage h2) — Task 2
- ✅ Validation warnings (per-player goal sum vs scoreline mismatch flagged but not blocked) — Task 2
- ✅ APPROVE → approve_match_entry — Task 4
- ✅ REJECT → reject_match_entry — Task 4
- ⏭ EDIT AND APPROVE — partially: match-level edits via p_edits land in approve flow; per-player aggregate edit-before-approve explicitly deferred
- ✅ Migration 0028 already shipped (S040) — extended approve_match_entry copies event log + timing
- ✅ Migration 0032 — admin_drop_pending_match_event (this slice)

Type consistency: `eventDescription` returns string; `formatMatchMinute` takes `(number, number, number) => string`; `validateScoreMatchesGoals` returns `{ ok, messages }` matching the inline mismatch render.

No placeholders. All steps have exact file paths and complete code blocks.

---

## Notes for the implementer

- **Schema-drift safety:** the only non-obvious detail is `pending_match_entry_players.team` is non-null (`team_color` enum) — verified against types. `pending_match_events.team` IS nullable (system events have no team).
- **`as unknown as Json` cast** for `p_edits`: precedent in `AdminMatches.tsx` line 367. TS2322 fires without it because the generated `Json` carries an index signature that hand-written record literals don't.
- **Don't auto-recalculate score on drop-event.** Per the DropEventSheet copy. The admin remains source of truth for the final scoreline; the event log is supplementary.
- **`reject_match_entry`** RPC requires non-empty `p_reason` (existing constraint). The sheet enforces this client-side.
- **`approve_match_entry`** RPC requires the matches draft row to exist (raises `22023 No draft match found for matchday` otherwise). On the ref-flow path, the matches row is created during `lock_roster` / draft completion, so this is not a concern for normal flow — but if test data is fabricated by direct INSERT into `pending_match_entries`, ensure the matches draft row exists first.
- **800-LOC discipline:** the screen file is targeted at ~500 LOC. If it overruns during Task 4, extract `ApproveSheet`/`RejectSheet`/`DropEventSheet` into a sibling `MatchEntryReviewSheets.tsx` (precedent: `RefEntryPickers.tsx` from S044).
