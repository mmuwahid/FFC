# Phase 2 Slice 2B-D — RefEntry Live Match Console

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Replace the `mode === 'live'` placeholder in `RefEntry.tsx` with a fully working live-match console: client-authoritative clock (1st half / halftime / 2nd half), tap-to-score blocks with scorer picker, pause/resume with reason picker, yellow/red cards, MOTM picker, and 15-second undo. Everything is local-only — events accumulate in `localStorage`; the `submit_ref_entry` round-trip is slice 2B-E.

**Architecture:**
- New `useMatchClock` hook owns the clock state machine + event log + score + MOTM. It persists to a sibling `localStorage` key (`<sessionKey>:clock`) so `useMatchSession` (slice 2B-C) stays unchanged.
- New `LiveConsole` component (rendered when `mode === 'live'`) consumes both hooks: `useMatchSession` for the matchday + rosters, `useMatchClock` for the live state.
- All clock math lives in pure functions in `useMatchClock.ts` so it's testable later without React. Display values (`M:SS`, stoppage `+M:SS`, current `match_minute`) are derived per-tick via a 1-second `setInterval`.
- Match-minute encoding follows the Phase 2 spec: continuous count from kickoff in whole minutes, with `match_second` for sub-minute precision. The `+N` stoppage notation is rendered client-side by comparing `match_minute` to the regulation half length.
- Configurable per-format half length (35 min for 7v7, 25 min for 5v5), halftime break (300 s), and undo window (15 s) live in TS constants for now (deferred plumbing to `app_settings` until a second league configures them differently — YAGNI).

**Tech Stack:**
- React 19 + TypeScript 6 (no new dependencies)
- `localStorage` for persistence (Web Storage API)
- `setInterval` 1 Hz for live clock re-render

---

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `ffc/src/lib/refConsoleConstants.ts` | **Create** | Hard-coded half lengths, halftime break, max stoppage, undo window. ~30 LOC. |
| `ffc/src/lib/useMatchClock.ts` | **Create** | Hook: clock state machine + event log + score + MOTM + pause + persistence to sibling key. ~280 LOC including pure math helpers. |
| `ffc/src/pages/RefEntry.tsx` | **Modify** | Replace `mode === 'live'` placeholder with `<LiveConsole>`; extract `LiveConsole`, `ScorerPickerSheet`, `PausePickerSheet`, `CardFlowSheet`, `MotmPickerSheet`, `HalftimeBanner` sub-components. ~350 → ~700 LOC. |
| `ffc/src/styles/ref-entry.css` | **Modify** | Append live-mode styles (clock display, score blocks, half strip, action buttons, picker sheets, halftime banner, event strip). ~170 → ~450 LOC. |
| `tasks/todo.md` + `CLAUDE.md` + `sessions/S044/session-log.md` + `sessions/INDEX.md` | **Edit/Create** | Standard close-out. |

**No migration this slice.** Schema for `pending_match_events` already shipped in 0028 (S040). Submit RPC already accepts `events` payload. We're only writing the client side.

---

## Pre-flight context

- Branch: `main`. Tip: `5ddf20f` (S043 close-out).
- Live DB migrations: 31 (0001 → 0031).
- `RefEntry.tsx` currently has 5 modes (`loading | invalid | pre | live | post`); slice 2B-C wired the first three. `live` and `post` are placeholders.
- `useMatchSession` exposes `{ mode, payload, error, kickoffAt, startMatch }`. Storage key derivation already async-resolves to `ffc_ref_<sha256(token)[0:32]>`.
- `payload.matchday.effective_format` is `'7v7' | '5v5'` — drives half length.
- `payload.white` and `payload.black` arrays carry `{ profile_id, guest_id, display_name, primary_position, is_captain }` — directly consumable by the scorer picker.
- Brand tokens (`--rf-bg`, `--rf-text`, `--rf-accent`, `--rf-white-team`, `--rf-black-team`) already declared on `.ref-entry`. Slice 2B-D will add `--rf-success`, `--rf-warn`, `--rf-pause`, `--rf-danger` for the new affordances.
- Mockup reference: `mockups/3-4-v2-ref-console.html` states 2, 3, 4 are slice 2B-D scope.

### Key types already in scope

From `useMatchSession.ts`:
```ts
export type MatchMode = 'loading' | 'invalid' | 'pre' | 'live' | 'post'
export interface RefMatchdayPayload {
  matchday: { id: string; kickoff_at: string; venue: string | null;
              effective_format: '7v7' | '5v5'; roster_locked_at: string | null }
  white: RosterPlayer[]
  black: RosterPlayer[]
  token_expires_at: string
  has_match_row: boolean
}
interface RosterPlayer {
  profile_id: string | null
  guest_id: string | null
  display_name: string
  primary_position: string | null
  is_captain: boolean
}
```

### Out of scope (deferred)

- **Post-match summary + submit** — slice 2B-E.
- **Admin review screen** (`/admin/match-entries/:id`) — slice 2B-F.
- **`submit_ref_entry` extension** to accept `events[]` and `timing` — already shipped in 0028 (S040), no work this slice.
- **Web Push notification** (`ref_submitted` notification kind) — Phase 2A.
- **Server-authoritative clock / spectator view** — Phase 3.
- **`app_settings` plumbing** for half lengths and break duration — defer until a second league wants different values.
- **2nd-half side-swap UI** — cosmetic only; data still tracks team colour.

---

## Task 1 — Pre-flight (5 min)

- [ ] **Step 1: Verify branch state**

```bash
cd "C:/Users/User/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC" && git status -sb && git log --oneline -3
```

Expected: `## main` clean, top three commits include `5ddf20f docs(s043): close-out`. If working tree dirty — STOP, report BLOCKED.

- [ ] **Step 2: Confirm migration count is 31**

```bash
npx --yes supabase@latest db query --linked "SELECT count(*)::int AS migration_count FROM supabase_migrations.schema_migrations" 2>/dev/null
```

Expected: `migration_count = 31`. If higher — investigate (someone applied a migration outside this branch). If lower — investigate.

- [ ] **Step 3: Confirm RefEntry's live placeholder is the starting point**

```bash
grep -n "Live console" ffc/src/pages/RefEntry.tsx
```

Expected: matches the placeholder text from slice 2B-C (`<h1 className="ref-entry-title">Live console</h1>`).

If any check fails — STOP, surface the discrepancy, do not proceed.

---

## Task 2 — Constants module + `useMatchClock` hook (60 min)

- [ ] **Step 1: Create `ffc/src/lib/refConsoleConstants.ts`**

Use the Write tool. Full content:

```ts
/**
 * Phase 2 Slice 2B-D — ref console tunables.
 *
 * These ship as TS constants for now; if a second league ever wants different
 * half lengths or break durations we'll move them to app_settings. Until then,
 * YAGNI says hard-code.
 */

export const REGULATION_HALF_MINUTES: Record<'7v7' | '5v5', number> = {
  '7v7': 35,
  '5v5': 25,
}

/** Halftime countdown duration in seconds. */
export const HALFTIME_BREAK_SECONDS = 300

/** Soft ceiling: when stoppage exceeds this in seconds, the UI nudges the ref to
 * end the half. Doesn't auto-end. */
export const MAX_STOPPAGE_SOFT_LIMIT_SECONDS = 180

/** Undo window for goals/cards/pauses, in milliseconds. After this elapses,
 * the UNDO LAST button greys out for that event. */
export const UNDO_WINDOW_MS = 15_000

/** Seconds added to the halftime break when ref taps "+ ADD MIN". */
export const HALFTIME_ADD_MIN_SECONDS = 60
```

- [ ] **Step 2: Create `ffc/src/lib/useMatchClock.ts`**

Use the Write tool. Full content (long — paste exactly):

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  HALFTIME_ADD_MIN_SECONDS,
  HALFTIME_BREAK_SECONDS,
  REGULATION_HALF_MINUTES,
  UNDO_WINDOW_MS,
} from './refConsoleConstants'

/**
 * Phase 2 Slice 2B-D — client-authoritative match clock + event log.
 *
 * Owns the live state for one matchday session: kickoff timestamp, halftime,
 * 2nd-half kickoff, accumulated stoppage, paused state, score, event log, MOTM.
 * Persists to a sibling localStorage key so a backgrounded tab / refresh / OS
 * sleep recovers the same state.
 *
 * Decoupled from useMatchSession (token + matchday fetch) — the parent passes
 * in the storage key + format. The hook does its own hydration and writes.
 */

export type MatchHalf = 1 | 2 | 'break'

export type EventType =
  | 'goal'
  | 'own_goal'
  | 'yellow_card'
  | 'red_card'
  | 'pause'
  | 'resume'
  | 'halftime'
  | 'fulltime'

export interface MatchEvent {
  ordinal: number               // monotonic; matches DB ordinal column
  event_type: EventType
  match_minute: number          // continuous from kickoff (whole minutes)
  match_second: number          // 0..59
  team: 'white' | 'black' | null
  profile_id: string | null
  guest_id: string | null
  meta: Record<string, unknown> // e.g. { pause_reason: 'foul' }
  committed_at: string          // ISO; for undo-window calculation
}

export interface MotmSelection {
  profile_id: string | null
  guest_id: string | null
  display_name: string
  team: 'white' | 'black'
}

export interface ClockState {
  kickoff_at: string                  // 1st-half kickoff ISO
  half: MatchHalf
  halftime_at: string | null          // when 1st half ended (also break start)
  halftime_break_seconds_extra: number // user "+ADD MIN" presses ×60
  second_half_kickoff_at: string | null
  stoppage_h1_seconds: number         // accumulated; updated on resume
  stoppage_h2_seconds: number
  paused_at: string | null            // ISO if currently paused, else null
  score_white: number
  score_black: number
  events: MatchEvent[]
  motm: MotmSelection | null
}

export type MatchFormat = '7v7' | '5v5'

interface UseMatchClockReturn {
  /** Reactive — cycles every ~1 s while live. Read-only snapshot. */
  state: ClockState
  /** Derived for display. Updates each tick. */
  display: {
    /** "M:SS" of regulation+stoppage time within the current half. */
    clockLabel: string
    /** "+M:SS" stoppage bank for the current half, or null when 0. */
    stoppageLabel: string | null
    /** Halftime break "M:SS" countdown (only meaningful when half==='break'). */
    breakRemainingLabel: string
    /** True once break countdown reaches 0 (UI auto-prompts second-half start). */
    breakComplete: boolean
    /** True when stoppage has crossed the soft limit (UI nudges to end half). */
    stoppageOverSoftLimit: boolean
  }
  /** Push a goal for `team`. `participant` identifies who. Stamps minute/second. */
  addGoal: (team: 'white' | 'black', participant: { profile_id: string | null; guest_id: string | null }, isOwnGoal?: boolean) => void
  /** Push a card. `kind` is yellow|red. */
  addCard: (kind: 'yellow' | 'red', team: 'white' | 'black', participant: { profile_id: string | null; guest_id: string | null }) => void
  /** Pause the clock. Optional reason recorded as event. */
  pause: (reason?: string) => void
  /** Resume the clock. Adds elapsed pause duration to current-half stoppage bank. */
  resume: () => void
  /** End the 1st half. Captures halftime_at, transitions to 'break'. */
  endHalf: () => void
  /** Start the 2nd half. Captures second_half_kickoff_at, transitions to half=2. */
  startSecondHalf: () => void
  /** Add 60 s to halftime break countdown. */
  addBreakMin: () => void
  /** Set MOTM (overwrites prior selection). */
  setMotm: (selection: MotmSelection | null) => void
  /** Undo the most recent event (within UNDO_WINDOW_MS). Returns true if popped. */
  undoLast: () => boolean
  /** True if the most recent event is still within the undo window. */
  canUndo: boolean
}

const CLOCK_KEY_SUFFIX = ':clock'

function clockStorageKey(sessionKey: string): string {
  return sessionKey + CLOCK_KEY_SUFFIX
}

function readClockState(key: string): ClockState | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as ClockState
  } catch {
    return null
  }
}

function writeClockState(key: string, state: ClockState): void {
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    /* private mode / storage blocked — non-fatal */
  }
}

/**
 * Pure helper: how many milliseconds of CLOCK time have elapsed in the given half,
 * accounting for accumulated stoppage and the current pause (if any).
 *
 * Returned ms is the value the big M:SS clock should display.
 */
export function computeHalfElapsedMs(args: {
  now: number
  halfStartIso: string
  stoppageSeconds: number
  pausedAtIso: string | null
}): number {
  const halfStart = Date.parse(args.halfStartIso)
  const totalMs = args.now - halfStart
  const stoppageMs = args.stoppageSeconds * 1000
  const currentPauseMs = args.pausedAtIso ? args.now - Date.parse(args.pausedAtIso) : 0
  return Math.max(0, totalMs - stoppageMs - currentPauseMs)
}

/** Format milliseconds as "M:SS" (zero-padded seconds). */
export function formatMSS(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Format seconds as "+M:SS" or null if zero. */
export function formatStoppage(seconds: number): string | null {
  if (seconds <= 0) return null
  return '+' + formatMSS(seconds * 1000)
}

/** Compute continuous match-minute (whole) and second-within-minute from a half elapsed-ms. */
export function computeMatchStamp(args: {
  half: 1 | 2
  halfElapsedMs: number
  regulationHalfMinutes: number
}): { match_minute: number; match_second: number } {
  const elapsedSec = Math.floor(args.halfElapsedMs / 1000)
  const minIntoHalf = Math.floor(elapsedSec / 60)
  const secOfMin = elapsedSec % 60
  const baseOffset = args.half === 2 ? args.regulationHalfMinutes : 0
  return { match_minute: baseOffset + minIntoHalf, match_second: secOfMin }
}

function emptyClockState(kickoffIso: string): ClockState {
  return {
    kickoff_at: kickoffIso,
    half: 1,
    halftime_at: null,
    halftime_break_seconds_extra: 0,
    second_half_kickoff_at: null,
    stoppage_h1_seconds: 0,
    stoppage_h2_seconds: 0,
    paused_at: null,
    score_white: 0,
    score_black: 0,
    events: [],
    motm: null,
  }
}

export function useMatchClock(args: {
  sessionStorageKey: string | null
  kickoffIso: string | null
  format: MatchFormat
}): UseMatchClockReturn {
  const { sessionStorageKey, kickoffIso, format } = args
  const regulationHalfMinutes = REGULATION_HALF_MINUTES[format]

  const clockKey = sessionStorageKey ? clockStorageKey(sessionStorageKey) : null

  const [state, setState] = useState<ClockState>(() => emptyClockState(kickoffIso ?? new Date().toISOString()))
  const [tick, setTick] = useState(0)
  const hydratedRef = useRef(false)

  // Hydrate from storage exactly once when key becomes available.
  useEffect(() => {
    if (!clockKey || hydratedRef.current) return
    const stored = readClockState(clockKey)
    if (stored) {
      setState(stored)
    } else if (kickoffIso) {
      setState(emptyClockState(kickoffIso))
    }
    hydratedRef.current = true
  }, [clockKey, kickoffIso])

  // Persist on every state change (after hydration).
  useEffect(() => {
    if (!clockKey || !hydratedRef.current) return
    writeClockState(clockKey, state)
  }, [clockKey, state])

  // 1 Hz tick to drive the live clock display.
  useEffect(() => {
    if (state.half === 'break') {
      // Still tick during break for the countdown.
    }
    const id = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [state.half])

  const now = Date.now()
  void tick // referenced so React knows to re-render each tick

  const display = useMemo(() => {
    const regSec = regulationHalfMinutes * 60
    if (state.half === 'break' && state.halftime_at) {
      const breakElapsedMs = now - Date.parse(state.halftime_at)
      const breakDurationSec = HALFTIME_BREAK_SECONDS + state.halftime_break_seconds_extra
      const breakRemainingMs = Math.max(0, breakDurationSec * 1000 - breakElapsedMs)
      return {
        clockLabel: formatMSS(regSec * 1000),
        stoppageLabel: null,
        breakRemainingLabel: formatMSS(breakRemainingMs),
        breakComplete: breakRemainingMs === 0,
        stoppageOverSoftLimit: false,
      }
    }

    const halfStartIso = state.half === 1 ? state.kickoff_at : (state.second_half_kickoff_at ?? state.kickoff_at)
    const stoppageSec = state.half === 1 ? state.stoppage_h1_seconds : state.stoppage_h2_seconds
    const elapsedMs = computeHalfElapsedMs({
      now,
      halfStartIso,
      stoppageSeconds: stoppageSec,
      pausedAtIso: state.paused_at,
    })

    // 1st half: clock label = elapsedMs (capped to half_length on big display? no — show real)
    // 2nd half: clock label = elapsedMs + half_length_ms so it reads 35:00 → 70:00 continuously
    const offsetMs = state.half === 2 ? regulationHalfMinutes * 60_000 : 0
    return {
      clockLabel: formatMSS(elapsedMs + offsetMs),
      stoppageLabel: formatStoppage(stoppageSec),
      breakRemainingLabel: '0:00',
      breakComplete: false,
      stoppageOverSoftLimit: stoppageSec > 180, // MAX_STOPPAGE_SOFT_LIMIT_SECONDS
    }
  }, [state, regulationHalfMinutes, now])

  /** Returns the current match-minute / second stamp. Used at event commit time. */
  const stampNow = useCallback((): { match_minute: number; match_second: number } => {
    if (state.half === 'break') {
      // Stoppage events captured during break shouldn't normally happen, but if
      // they do, stamp the end-of-1st-half regulation minute.
      return { match_minute: regulationHalfMinutes, match_second: 0 }
    }
    const halfStartIso = state.half === 1 ? state.kickoff_at : (state.second_half_kickoff_at ?? state.kickoff_at)
    const stoppageSec = state.half === 1 ? state.stoppage_h1_seconds : state.stoppage_h2_seconds
    const elapsedMs = computeHalfElapsedMs({
      now: Date.now(),
      halfStartIso,
      stoppageSeconds: stoppageSec,
      pausedAtIso: state.paused_at,
    })
    return computeMatchStamp({ half: state.half, halfElapsedMs: elapsedMs, regulationHalfMinutes })
  }, [state, regulationHalfMinutes])

  const nextOrdinal = useCallback((events: MatchEvent[]): number => {
    return events.length === 0 ? 1 : events[events.length - 1].ordinal + 1
  }, [])

  const addGoal: UseMatchClockReturn['addGoal'] = useCallback((team, participant, isOwnGoal = false) => {
    setState((prev) => {
      const stamp = (() => {
        if (prev.half === 'break') return { match_minute: regulationHalfMinutes, match_second: 0 }
        const halfStartIso = prev.half === 1 ? prev.kickoff_at : (prev.second_half_kickoff_at ?? prev.kickoff_at)
        const stoppageSec = prev.half === 1 ? prev.stoppage_h1_seconds : prev.stoppage_h2_seconds
        const elapsedMs = computeHalfElapsedMs({
          now: Date.now(), halfStartIso, stoppageSeconds: stoppageSec, pausedAtIso: prev.paused_at,
        })
        return computeMatchStamp({ half: prev.half as 1 | 2, halfElapsedMs: elapsedMs, regulationHalfMinutes })
      })()
      const event: MatchEvent = {
        ordinal: nextOrdinal(prev.events),
        event_type: isOwnGoal ? 'own_goal' : 'goal',
        match_minute: stamp.match_minute,
        match_second: stamp.match_second,
        team,
        profile_id: participant.profile_id,
        guest_id: participant.guest_id,
        meta: isOwnGoal ? { own_goal_for: team === 'white' ? 'black' : 'white' } : {},
        committed_at: new Date().toISOString(),
      }
      // Score: own_goal credits the OPPOSITE team. Goal credits scorer's team.
      const scoringTeam = isOwnGoal ? (team === 'white' ? 'black' : 'white') : team
      return {
        ...prev,
        events: [...prev.events, event],
        score_white: scoringTeam === 'white' ? prev.score_white + 1 : prev.score_white,
        score_black: scoringTeam === 'black' ? prev.score_black + 1 : prev.score_black,
      }
    })
  }, [nextOrdinal, regulationHalfMinutes])

  const addCard: UseMatchClockReturn['addCard'] = useCallback((kind, team, participant) => {
    setState((prev) => {
      const stamp = (() => {
        if (prev.half === 'break') return { match_minute: regulationHalfMinutes, match_second: 0 }
        const halfStartIso = prev.half === 1 ? prev.kickoff_at : (prev.second_half_kickoff_at ?? prev.kickoff_at)
        const stoppageSec = prev.half === 1 ? prev.stoppage_h1_seconds : prev.stoppage_h2_seconds
        const elapsedMs = computeHalfElapsedMs({
          now: Date.now(), halfStartIso, stoppageSeconds: stoppageSec, pausedAtIso: prev.paused_at,
        })
        return computeMatchStamp({ half: prev.half as 1 | 2, halfElapsedMs: elapsedMs, regulationHalfMinutes })
      })()
      const event: MatchEvent = {
        ordinal: nextOrdinal(prev.events),
        event_type: kind === 'yellow' ? 'yellow_card' : 'red_card',
        match_minute: stamp.match_minute,
        match_second: stamp.match_second,
        team,
        profile_id: participant.profile_id,
        guest_id: participant.guest_id,
        meta: {},
        committed_at: new Date().toISOString(),
      }
      return { ...prev, events: [...prev.events, event] }
    })
  }, [nextOrdinal, regulationHalfMinutes])

  const pause: UseMatchClockReturn['pause'] = useCallback((reason) => {
    setState((prev) => {
      if (prev.paused_at) return prev // already paused
      if (prev.half === 'break') return prev
      const stamp = (() => {
        const halfStartIso = prev.half === 1 ? prev.kickoff_at : (prev.second_half_kickoff_at ?? prev.kickoff_at)
        const stoppageSec = prev.half === 1 ? prev.stoppage_h1_seconds : prev.stoppage_h2_seconds
        const elapsedMs = computeHalfElapsedMs({
          now: Date.now(), halfStartIso, stoppageSeconds: stoppageSec, pausedAtIso: null,
        })
        return computeMatchStamp({ half: prev.half as 1 | 2, halfElapsedMs: elapsedMs, regulationHalfMinutes })
      })()
      const event: MatchEvent = {
        ordinal: nextOrdinal(prev.events),
        event_type: 'pause',
        match_minute: stamp.match_minute,
        match_second: stamp.match_second,
        team: null,
        profile_id: null,
        guest_id: null,
        meta: reason ? { pause_reason: reason } : {},
        committed_at: new Date().toISOString(),
      }
      return { ...prev, paused_at: new Date().toISOString(), events: [...prev.events, event] }
    })
  }, [nextOrdinal, regulationHalfMinutes])

  const resume: UseMatchClockReturn['resume'] = useCallback(() => {
    setState((prev) => {
      if (!prev.paused_at) return prev
      const pauseDurationSec = Math.floor((Date.now() - Date.parse(prev.paused_at)) / 1000)
      const isFirstHalf = prev.half === 1
      const newH1 = isFirstHalf ? prev.stoppage_h1_seconds + pauseDurationSec : prev.stoppage_h1_seconds
      const newH2 = !isFirstHalf && prev.half === 2 ? prev.stoppage_h2_seconds + pauseDurationSec : prev.stoppage_h2_seconds
      const stamp = (() => {
        const halfStartIso = isFirstHalf ? prev.kickoff_at : (prev.second_half_kickoff_at ?? prev.kickoff_at)
        const stoppageSec = isFirstHalf ? newH1 : newH2
        const elapsedMs = computeHalfElapsedMs({
          now: Date.now(), halfStartIso, stoppageSeconds: stoppageSec, pausedAtIso: null,
        })
        return computeMatchStamp({ half: prev.half as 1 | 2, halfElapsedMs: elapsedMs, regulationHalfMinutes })
      })()
      const event: MatchEvent = {
        ordinal: nextOrdinal(prev.events),
        event_type: 'resume',
        match_minute: stamp.match_minute,
        match_second: stamp.match_second,
        team: null,
        profile_id: null,
        guest_id: null,
        meta: { pause_duration_seconds: pauseDurationSec },
        committed_at: new Date().toISOString(),
      }
      return {
        ...prev,
        paused_at: null,
        stoppage_h1_seconds: newH1,
        stoppage_h2_seconds: newH2,
        events: [...prev.events, event],
      }
    })
  }, [nextOrdinal, regulationHalfMinutes])

  const endHalf: UseMatchClockReturn['endHalf'] = useCallback(() => {
    setState((prev) => {
      if (prev.half !== 1) return prev
      // If currently paused, finalize the pause first by adding to stoppage.
      const finalH1 = prev.paused_at
        ? prev.stoppage_h1_seconds + Math.floor((Date.now() - Date.parse(prev.paused_at)) / 1000)
        : prev.stoppage_h1_seconds
      const event: MatchEvent = {
        ordinal: nextOrdinal(prev.events),
        event_type: 'halftime',
        match_minute: regulationHalfMinutes,
        match_second: 0,
        team: null,
        profile_id: null,
        guest_id: null,
        meta: {},
        committed_at: new Date().toISOString(),
      }
      return {
        ...prev,
        half: 'break',
        halftime_at: new Date().toISOString(),
        paused_at: null,
        stoppage_h1_seconds: finalH1,
        events: [...prev.events, event],
      }
    })
  }, [nextOrdinal, regulationHalfMinutes])

  const startSecondHalf: UseMatchClockReturn['startSecondHalf'] = useCallback(() => {
    setState((prev) => {
      if (prev.half !== 'break') return prev
      return {
        ...prev,
        half: 2,
        second_half_kickoff_at: new Date().toISOString(),
      }
    })
  }, [])

  const addBreakMin: UseMatchClockReturn['addBreakMin'] = useCallback(() => {
    setState((prev) => ({
      ...prev,
      halftime_break_seconds_extra: prev.halftime_break_seconds_extra + HALFTIME_ADD_MIN_SECONDS,
    }))
  }, [])

  const setMotm: UseMatchClockReturn['setMotm'] = useCallback((selection) => {
    setState((prev) => ({ ...prev, motm: selection }))
  }, [])

  const undoLast: UseMatchClockReturn['undoLast'] = useCallback(() => {
    let popped = false
    setState((prev) => {
      const last = prev.events[prev.events.length - 1]
      if (!last) return prev
      const ageMs = Date.now() - Date.parse(last.committed_at)
      if (ageMs > UNDO_WINDOW_MS) return prev
      // Reverse score impact for goal/own_goal.
      let scoreWhite = prev.score_white
      let scoreBlack = prev.score_black
      if (last.event_type === 'goal') {
        if (last.team === 'white') scoreWhite -= 1
        if (last.team === 'black') scoreBlack -= 1
      } else if (last.event_type === 'own_goal') {
        // Score went to opposite team; reverse it.
        if (last.team === 'white') scoreBlack -= 1
        if (last.team === 'black') scoreWhite -= 1
      }
      // Reverse pause/resume state if applicable.
      let pausedAt = prev.paused_at
      let h1 = prev.stoppage_h1_seconds
      let h2 = prev.stoppage_h2_seconds
      if (last.event_type === 'pause') {
        pausedAt = null
      } else if (last.event_type === 'resume') {
        // Restore the paused_at and roll back the stoppage we added on resume.
        const meta = last.meta as { pause_duration_seconds?: number }
        const dur = meta.pause_duration_seconds ?? 0
        // Find the matching pause event to recover its commit time as paused_at.
        const pauseEvt = [...prev.events].reverse().find((e) => e.event_type === 'pause' && e.ordinal < last.ordinal)
        pausedAt = pauseEvt
          ? new Date(Date.parse(pauseEvt.committed_at) + 0).toISOString() // approximate — pause ts ≈ commit ts
          : new Date(Date.now() - dur * 1000).toISOString()
        if (last.match_minute < REGULATION_HALF_MINUTES['7v7'] || prev.half === 1) {
          h1 = Math.max(0, h1 - dur)
        } else {
          h2 = Math.max(0, h2 - dur)
        }
      }
      popped = true
      return {
        ...prev,
        events: prev.events.slice(0, -1),
        score_white: Math.max(0, scoreWhite),
        score_black: Math.max(0, scoreBlack),
        paused_at: pausedAt,
        stoppage_h1_seconds: h1,
        stoppage_h2_seconds: h2,
      }
    })
    return popped
  }, [])

  const canUndo = useMemo(() => {
    const last = state.events[state.events.length - 1]
    if (!last) return false
    return Date.now() - Date.parse(last.committed_at) <= UNDO_WINDOW_MS
  }, [state.events, tick]) // tick keeps this fresh as the window expires

  return {
    state,
    display,
    addGoal,
    addCard,
    pause,
    resume,
    endHalf,
    startSecondHalf,
    addBreakMin,
    setMotm,
    undoLast,
    canUndo,
  }
}
```

- [ ] **Step 3: TypeScript verify**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc -b
```

Expected: EXIT 0. If any error — read it, fix it, re-run. Common pitfalls:
- `tick` declared unused → kept the `void tick` line which silences it.
- `as 1 | 2` cast: TS should narrow `prev.half !== 'break'` automatically inside the addGoal/addCard/pause closures, but if it complains add an `if (prev.half === 'break')` guard.

- [ ] **Step 4: Commit**

```bash
git add ffc/src/lib/refConsoleConstants.ts ffc/src/lib/useMatchClock.ts
git commit -m "$(cat <<'EOF'
feat(s044,2b-d): useMatchClock hook + tunables module

Slice 2B-D foundation. Pure client-side authoritative match clock for
the ref console: 1st half / halftime break / 2nd half state machine,
pause/resume with stoppage accumulation, event log with score deltas,
MOTM, and 15-second undo window. Persists to localStorage at a sibling
key (<sessionKey>:clock) so a refresh / backgrounding doesn't lose state.

refConsoleConstants.ts: REGULATION_HALF_MINUTES (35/25), HALFTIME_BREAK_SECONDS
(300), MAX_STOPPAGE_SOFT_LIMIT_SECONDS (180), UNDO_WINDOW_MS (15000),
HALFTIME_ADD_MIN_SECONDS (60). Hard-coded for now; deferred app_settings
plumbing until a second league configures differently.

useMatchClock.ts: ClockState shape covers kickoff/halftime/2nd-half ISOs,
stoppage_h1/h2_seconds, paused_at, score_white/black, events[], motm.
Pure helpers (computeHalfElapsedMs, formatMSS, formatStoppage,
computeMatchStamp) are exported for future testability. Hook drives
display via 1Hz setInterval tick and exposes addGoal / addCard / pause /
resume / endHalf / startSecondHalf / addBreakMin / setMotm / undoLast.

No UI changes this commit — RefEntry still renders the live placeholder.
EOF
)"
```

---

## Task 3 — `LiveConsole` shell: clock, score block, half strip, event strip (45 min)

This task replaces the `mode === 'live'` placeholder with a working live console — minus the picker sheets (those land in Task 4 + 5).

- [ ] **Step 1: Append live-mode + halftime CSS to `ffc/src/styles/ref-entry.css`**

Use the Edit tool to append (after the existing `.ref-entry-cta-hint` rule). Add new tokens to the `.ref-entry` root first, then the new rules. Full append text:

```css

/* §3.4-v2 Slice 2B-D — Live console additions. */

.ref-entry {
  /* Re-declared here for clarity; keep in sync with the block above. The
   * Edit tool will inline these into the existing :root block — see Step 1. */
}

/* === Live header === */
.ref-live-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0 8px;
  border-bottom: 1px solid var(--rf-border);
}
.ref-live-header-block { display: flex; flex-direction: column; gap: 2px; }
.ref-live-md-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.14em;
  color: var(--rf-text-muted); text-transform: uppercase;
}
.ref-live-half-label {
  font-size: 13px; font-weight: 600; color: var(--rf-text);
}
.ref-live-dot {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.14em;
  color: var(--rf-danger); text-transform: uppercase;
}
.ref-live-dot::before {
  content: ''; width: 7px; height: 7px; border-radius: 50%;
  background: var(--rf-danger);
  box-shadow: 0 0 0 3px rgba(230, 51, 73, 0.18);
  animation: ref-pulse 1.6s infinite;
}
.ref-live-dot--break { color: var(--rf-accent); }
.ref-live-dot--break::before { background: var(--rf-accent); box-shadow: none; animation: none; }
@keyframes ref-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.18); }
}

/* === Half strip === */
.ref-half-strip {
  display: flex; align-items: center; justify-content: space-between;
  background: var(--rf-surface);
  border: 1px solid var(--rf-border);
  border-radius: 12px;
  padding: 8px 14px;
}
.ref-half-name {
  font-size: 12px; font-weight: 700; color: var(--rf-text);
  letter-spacing: 0.14em; text-transform: uppercase;
}
.ref-half-progress {
  flex: 1; margin: 0 12px; height: 4px;
  background: var(--rf-surface-2);
  border-radius: 4px; overflow: hidden;
}
.ref-half-bar { height: 100%; background: var(--rf-accent); border-radius: 4px; transition: width 0.3s ease-out; }
.ref-stoppage-chip {
  font-size: 11px; font-weight: 700; color: var(--rf-warn);
  letter-spacing: 0.1em; font-variant-numeric: tabular-nums;
}
.ref-stoppage-chip--alarm { color: var(--rf-danger); animation: ref-pulse 1.2s infinite; }

/* === Big clock === */
.ref-clock-display {
  text-align: center;
  padding: 20px 0 8px;
}
.ref-clock-min {
  font-size: 96px; font-weight: 800;
  letter-spacing: -0.04em; line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--rf-text);
}
.ref-clock-min--paused { color: var(--rf-pause); }
.ref-clock-min--break { color: var(--rf-text-muted); }

/* === Score block === */
.ref-score-block {
  display: grid;
  grid-template-columns: 1fr 28px 1fr;
  align-items: stretch;
  gap: 6px;
  margin-top: 8px;
}
.ref-score-cell {
  border-radius: 18px;
  padding: 18px 12px;
  border: 2px solid var(--rf-border);
  text-align: center;
  cursor: pointer;
  user-select: none;
  font-family: inherit;
}
.ref-score-cell--white { background: var(--rf-white-team); color: var(--rf-bg); }
.ref-score-cell--black { background: var(--rf-black-team); color: var(--rf-text); }
.ref-score-cell:active { transform: translateY(1px); }
.ref-score-cell:disabled { opacity: 0.55; cursor: not-allowed; }
.ref-score-label {
  font-size: 10px; font-weight: 700; letter-spacing: 0.22em;
  opacity: 0.8; text-transform: uppercase;
}
.ref-score-number {
  font-size: 64px; font-weight: 800;
  line-height: 0.95; margin-top: 2px;
  font-variant-numeric: tabular-nums;
}
.ref-score-tap-hint {
  font-size: 11px; margin-top: 6px; opacity: 0.7;
}
.ref-score-divider {
  display: flex; align-items: center; justify-content: center;
  font-size: 24px; font-weight: 700; color: var(--rf-text-muted);
}

/* === Action row === */
.ref-action-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 4px;
}
.ref-action-btn {
  height: 60px;
  border-radius: 14px;
  font-size: 14px; font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase;
  border: 1px solid var(--rf-border);
  background: var(--rf-surface);
  color: var(--rf-text);
  display: flex; align-items: center; justify-content: center; gap: 6px;
  cursor: pointer;
  font-family: inherit;
}
.ref-action-btn:active { transform: translateY(1px); }
.ref-action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ref-action-btn--pause { background: var(--rf-pause); color: var(--rf-bg); border-color: var(--rf-pause); }
.ref-action-btn--resume { background: var(--rf-success); color: var(--rf-bg); border-color: var(--rf-success); }
.ref-action-btn--card { background: var(--rf-warn); color: var(--rf-bg); border-color: var(--rf-warn); }
.ref-action-btn--end { background: var(--rf-danger); color: var(--rf-text); border-color: var(--rf-danger); }
.ref-action-btn-ico { font-size: 16px; line-height: 1; }

/* === Event strip === */
.ref-event-strip {
  margin: 8px 0 0;
  border-top: 1px solid var(--rf-border);
  padding: 10px 0;
  font-size: 12px;
  color: var(--rf-text-muted);
  overflow-y: auto;
  max-height: 96px;
}
.ref-event-strip-empty {
  font-style: italic; opacity: 0.7; text-align: center; padding: 8px 0;
}
.ref-event-row {
  padding: 4px 0;
  display: flex; align-items: center; gap: 8px;
}
.ref-event-min {
  font-weight: 700; color: var(--rf-text);
  font-variant-numeric: tabular-nums;
  width: 44px;
}
.ref-event-ico { width: 18px; text-align: center; }
.ref-event-desc { color: var(--rf-text); flex: 1; }
.ref-event-row--paused { color: var(--rf-pause); font-style: italic; }

/* === Halftime banner === */
.ref-halftime-banner {
  background: linear-gradient(160deg, rgba(229, 186, 91, 0.18), rgba(14, 24, 38, 0.4));
  border: 1px solid rgba(229, 186, 91, 0.4);
  border-radius: 16px;
  padding: 18px;
  text-align: center;
}
.ref-ht-label {
  font-size: 13px; font-weight: 700;
  color: var(--rf-accent);
  letter-spacing: 0.16em; text-transform: uppercase;
}
.ref-ht-clock {
  font-size: 72px; font-weight: 800;
  margin-top: 6px;
  color: var(--rf-accent);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.ref-ht-hint {
  font-size: 12px; color: var(--rf-text-muted);
  margin-top: 8px;
}

/* === Picker sheets === */
.ref-picker-backdrop {
  position: fixed; inset: 0;
  background: rgba(10, 16, 24, 0.6);
  backdrop-filter: blur(2px);
  z-index: 100;
  animation: ref-fade 0.18s ease-out;
}
@keyframes ref-fade { from { opacity: 0; } to { opacity: 1; } }
.ref-picker-sheet {
  position: fixed; left: 0; right: 0; bottom: 0;
  background: var(--rf-bg);
  border-top-left-radius: 22px;
  border-top-right-radius: 22px;
  border-top: 1px solid var(--rf-border);
  padding: 18px 16px calc(28px + env(safe-area-inset-bottom, 12px));
  box-shadow: 0 -20px 60px rgba(0, 0, 0, 0.5);
  z-index: 110;
  animation: ref-slide-up 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  max-height: 85vh;
  overflow-y: auto;
}
@keyframes ref-slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
.ref-picker-grabber {
  width: 40px; height: 4px;
  background: var(--rf-text-muted);
  border-radius: 4px;
  margin: 0 auto 14px;
  opacity: 0.4;
}
.ref-picker-title {
  margin: 0 0 4px;
  font-size: 18px; font-weight: 700;
  color: var(--rf-text);
}
.ref-picker-sub {
  font-size: 12px; color: var(--rf-text-muted);
  margin: 0 0 14px;
}
.ref-picker-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.ref-picker-row {
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--rf-surface);
  border: 1px solid var(--rf-border);
  font-size: 14px; font-weight: 600;
  text-align: left;
  color: var(--rf-text);
  cursor: pointer;
  font-family: inherit;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.ref-picker-row:active { transform: translateY(1px); }
.ref-picker-pos {
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--rf-accent);
}
.ref-picker-row--span2 { grid-column: span 2; justify-content: center; }
.ref-picker-toggle-row {
  display: flex; gap: 8px;
  padding: 8px 0 12px;
}
.ref-picker-toggle {
  flex: 1;
  padding: 10px;
  border-radius: 10px;
  background: var(--rf-surface);
  border: 1px solid var(--rf-border);
  color: var(--rf-text);
  font-size: 12px; font-weight: 700;
  letter-spacing: 0.06em; text-transform: uppercase;
  cursor: pointer; font-family: inherit;
}
.ref-picker-toggle--active {
  background: var(--rf-accent); color: var(--rf-bg); border-color: var(--rf-accent);
}
.ref-picker-cancel {
  margin-top: 12px; width: 100%;
  padding: 12px;
  background: transparent;
  border: 1px solid var(--rf-border);
  color: var(--rf-text-muted);
  border-radius: 10px;
  font-size: 13px; font-weight: 600;
  cursor: pointer; font-family: inherit;
}

/* === Live mode root layout === */
.ref-live {
  display: flex; flex-direction: column; gap: 12px;
  flex: 1 1 auto;
}
```

After appending these rules, **also** edit the existing `.ref-entry { ... }` token block at the top of the file to add the new tokens. Use the Edit tool with this `old_string` / `new_string`:

```
old: --rf-accent: #e5ba5b;
     --rf-white-team: #f2ead6;
     --rf-black-team: #0a1018;

new: --rf-accent: #e5ba5b;
     --rf-success: #4fbf93;
     --rf-warn: #d7a04a;
     --rf-pause: #d7a04a;
     --rf-danger: #e63349;
     --rf-white-team: #f2ead6;
     --rf-black-team: #0a1018;
```

(Match exact indentation. Use the Read tool first to confirm the existing block matches.)

- [ ] **Step 2: Replace the `mode === 'live'` placeholder with `<LiveConsole>` in `RefEntry.tsx`**

Use the Read tool to confirm the current RefEntry.tsx contents match what's documented in pre-flight. Then use the Edit tool.

Replace this block:
```tsx
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
```

With this:
```tsx
  if (mode === 'live') {
    if (!payload) return null
    return <LiveConsole payload={payload} kickoffAt={kickoffAt} sessionStorageKey={sessionStorageKey} />
  }
```

You'll also need to expose `sessionStorageKey` from `useMatchSession`. Edit `ffc/src/lib/useMatchSession.ts` — change the final return statement:

```ts
  return { mode, payload, error, kickoffAt, startMatch }
```

To:

```ts
  return { mode, payload, error, kickoffAt, startMatch, sessionStorageKey: storageKey }
```

Then update the destructure at the top of `RefEntry()`:

```tsx
  const { mode, payload, error, startMatch } = useMatchSession(token)
```

To:

```tsx
  const { mode, payload, error, kickoffAt, startMatch, sessionStorageKey } = useMatchSession(token)
```

- [ ] **Step 3: Append `LiveConsole`, `EventStrip`, `HalftimeView`, `LiveView` components to `RefEntry.tsx`**

Append the following imports at the top of `RefEntry.tsx` (after the existing `import '../styles/ref-entry.css'` line):

```tsx
import { useState } from 'react'
import { useMatchClock, type MatchEvent } from '../lib/useMatchClock'
import type { RefMatchdayPayload } from '../lib/useMatchSession'
import { REGULATION_HALF_MINUTES, MAX_STOPPAGE_SOFT_LIMIT_SECONDS } from '../lib/refConsoleConstants'
```

Then append at the bottom of the file (after the `formatKickoff` helper):

```tsx

/* ─── §3.4-v2 Slice 2B-D — Live console ───────────────────────────────────── */

interface LiveConsoleProps {
  payload: RefMatchdayPayload
  kickoffAt: string | null
  sessionStorageKey: string | null
}

function LiveConsole({ payload, kickoffAt, sessionStorageKey }: LiveConsoleProps) {
  const clock = useMatchClock({
    sessionStorageKey,
    kickoffIso: kickoffAt,
    format: payload.matchday.effective_format,
  })

  // Picker state — Tasks 4 & 5 add more pickers (pause-reason, card,
  // MOTM); Task 3 only needs the scorer trigger so the score-cell handlers
  // compile. The own-goal toggle is a local useState INSIDE ScorerPicker.
  const [scorerTeam, setScorerTeam] = useState<'white' | 'black' | null>(null)

  if (clock.state.half === 'break') {
    return (
      <section className="ref-entry">
        <LiveHeader half="break" />
        <div className="ref-live">
          <HalftimeView clock={clock} />
          <ScoreReadOnly clock={clock} />
          <EventStrip events={clock.state.events} format={payload.matchday.effective_format} />
        </div>
      </section>
    )
  }

  return (
    <section className="ref-entry">
      <LiveHeader half={clock.state.half} />
      <div className="ref-live">
        <HalfStrip clock={clock} format={payload.matchday.effective_format} />
        <div className="ref-clock-display">
          <div
            className={
              'ref-clock-min' +
              (clock.state.paused_at ? ' ref-clock-min--paused' : '')
            }
          >
            {clock.display.clockLabel}
          </div>
        </div>
        <div className="ref-score-block">
          <button
            type="button"
            className="ref-score-cell ref-score-cell--white"
            onClick={() => setScorerTeam('white')}
            disabled={clock.state.paused_at !== null}
          >
            <div className="ref-score-label">WHITE</div>
            <div className="ref-score-number">{clock.state.score_white}</div>
            <div className="ref-score-tap-hint">tap to add goal</div>
          </button>
          <div className="ref-score-divider">:</div>
          <button
            type="button"
            className="ref-score-cell ref-score-cell--black"
            onClick={() => setScorerTeam('black')}
            disabled={clock.state.paused_at !== null}
          >
            <div className="ref-score-label">BLACK</div>
            <div className="ref-score-number">{clock.state.score_black}</div>
            <div className="ref-score-tap-hint">tap to add goal</div>
          </button>
        </div>
        {/* Action rows are wired in Tasks 4 + 5. For Task 3 keep a minimal action row. */}
        <div className="ref-action-row">
          <button
            type="button"
            className={
              'ref-action-btn ' +
              (clock.state.paused_at ? 'ref-action-btn--resume' : 'ref-action-btn--pause')
            }
            onClick={() => (clock.state.paused_at ? clock.resume() : clock.pause())}
          >
            <span className="ref-action-btn-ico">{clock.state.paused_at ? '▶' : '⏸'}</span>
            {clock.state.paused_at ? 'RESUME' : 'PAUSE'}
          </button>
          <button
            type="button"
            className="ref-action-btn ref-action-btn--end"
            onClick={() => clock.endHalf()}
            disabled={clock.state.half !== 1}
          >
            <span className="ref-action-btn-ico">⏭</span>
            END HALF
          </button>
        </div>
        <EventStrip events={clock.state.events} format={payload.matchday.effective_format} />
      </div>
      {/* Scorer picker placeholder — wired fully in Task 4. */}
      {scorerTeam && (
        <ScorerPickerStub
          team={scorerTeam}
          onClose={() => setScorerTeam(null)}
        />
      )}
    </section>
  )
}

function LiveHeader({ half }: { half: 1 | 2 | 'break' }) {
  const halfLabel =
    half === 'break' ? 'Halftime · swap sides' :
    half === 1 ? '1st half' : '2nd half'
  return (
    <header className="ref-live-header">
      <div className="ref-live-header-block">
        <span className="ref-live-md-label">Matchday</span>
        <span className="ref-live-half-label">{halfLabel}</span>
      </div>
      <span className={'ref-live-dot' + (half === 'break' ? ' ref-live-dot--break' : '')}>
        {half === 'break' ? 'BREAK' : 'LIVE'}
      </span>
    </header>
  )
}

interface HalfStripProps {
  clock: ReturnType<typeof useMatchClock>
  format: '7v7' | '5v5'
}

function HalfStrip({ clock, format }: HalfStripProps) {
  const halfMinutes = REGULATION_HALF_MINUTES[format]
  // Compute progress 0..1 within the regulation portion of the current half.
  const halfStartIso = clock.state.half === 1
    ? clock.state.kickoff_at
    : (clock.state.second_half_kickoff_at ?? clock.state.kickoff_at)
  const halfStart = Date.parse(halfStartIso)
  const stoppageSec = clock.state.half === 1 ? clock.state.stoppage_h1_seconds : clock.state.stoppage_h2_seconds
  const elapsedMs = Math.max(0, Date.now() - halfStart - stoppageSec * 1000 - (clock.state.paused_at ? Date.now() - Date.parse(clock.state.paused_at) : 0))
  const pct = Math.min(100, (elapsedMs / (halfMinutes * 60_000)) * 100)
  const stoppageOver = clock.state.half !== 'break' && stoppageSec > MAX_STOPPAGE_SOFT_LIMIT_SECONDS

  return (
    <div className="ref-half-strip">
      <span className="ref-half-name">{clock.state.half === 1 ? '1ST HALF' : '2ND HALF'}</span>
      <div className="ref-half-progress">
        <div className="ref-half-bar" style={{ width: `${pct.toFixed(1)}%` }} />
      </div>
      {clock.display.stoppageLabel && (
        <span className={'ref-stoppage-chip' + (stoppageOver ? ' ref-stoppage-chip--alarm' : '')}>
          {clock.display.stoppageLabel}
        </span>
      )}
    </div>
  )
}

function ScoreReadOnly({ clock }: { clock: ReturnType<typeof useMatchClock> }) {
  return (
    <div className="ref-score-block" style={{ opacity: 0.85 }}>
      <div className="ref-score-cell ref-score-cell--white">
        <div className="ref-score-label">WHITE</div>
        <div className="ref-score-number">{clock.state.score_white}</div>
      </div>
      <div className="ref-score-divider">:</div>
      <div className="ref-score-cell ref-score-cell--black">
        <div className="ref-score-label">BLACK</div>
        <div className="ref-score-number">{clock.state.score_black}</div>
      </div>
    </div>
  )
}

function HalftimeView({ clock }: { clock: ReturnType<typeof useMatchClock> }) {
  return (
    <div className="ref-halftime-banner">
      <div className="ref-ht-label">
        HALFTIME · {clock.display.breakRemainingLabel} LEFT
      </div>
      <div className="ref-ht-clock">{clock.display.breakRemainingLabel}</div>
      <div className="ref-ht-hint">
        2nd half starts when ready. Tap below to skip break or add a minute.
      </div>
      <div className="ref-action-row" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="ref-action-btn"
          onClick={() => clock.startSecondHalf()}
        >
          <span className="ref-action-btn-ico">⏭</span> SKIP BREAK
        </button>
        <button
          type="button"
          className="ref-action-btn"
          onClick={() => clock.addBreakMin()}
        >
          <span className="ref-action-btn-ico">+</span> ADD MIN
        </button>
      </div>
    </div>
  )
}

function EventStrip({ events, format }: { events: MatchEvent[]; format: '7v7' | '5v5' }) {
  if (events.length === 0) {
    return (
      <div className="ref-event-strip">
        <div className="ref-event-strip-empty">No events yet.</div>
      </div>
    )
  }
  // Show most recent first, max 8 in the strip.
  const recent = [...events].reverse().slice(0, 8)
  const halfMinutes = REGULATION_HALF_MINUTES[format]
  return (
    <div className="ref-event-strip">
      {recent.map((e) => (
        <div
          key={e.ordinal}
          className={'ref-event-row' + (e.event_type === 'pause' || e.event_type === 'resume' ? ' ref-event-row--paused' : '')}
        >
          <span className="ref-event-min">{formatEventMinute(e, halfMinutes)}</span>
          <span className="ref-event-ico">{eventIcon(e.event_type)}</span>
          <span className="ref-event-desc">{eventDescription(e)}</span>
        </div>
      ))}
    </div>
  )
}

function formatEventMinute(e: MatchEvent, regulationHalfMinutes: number): string {
  const baseHalfStart = e.match_minute < regulationHalfMinutes ? 0 : regulationHalfMinutes
  const minutesIntoHalf = e.match_minute - baseHalfStart
  const isStoppage = minutesIntoHalf >= regulationHalfMinutes
  if (isStoppage) {
    const stoppageMin = minutesIntoHalf - regulationHalfMinutes
    return `${regulationHalfMinutes}+${stoppageMin}'`
  }
  return `${e.match_minute}'`
}

function eventIcon(t: MatchEvent['event_type']): string {
  switch (t) {
    case 'goal': return '⚽'
    case 'own_goal': return '🥅'
    case 'yellow_card': return '🟨'
    case 'red_card': return '🟥'
    case 'pause': return '⏸'
    case 'resume': return '▶'
    case 'halftime': return '🟫'
    case 'fulltime': return '✓'
    default: return '•'
  }
}

function eventDescription(e: MatchEvent): string {
  const teamLabel = e.team ? `(${e.team[0].toUpperCase()})` : ''
  switch (e.event_type) {
    case 'goal':
    case 'own_goal':
      return `Goal ${teamLabel}${e.event_type === 'own_goal' ? ' · OG' : ''}`
    case 'yellow_card':
      return `Yellow ${teamLabel}`
    case 'red_card':
      return `Red ${teamLabel}`
    case 'pause': {
      const meta = e.meta as { pause_reason?: string }
      return meta.pause_reason ? `Pause · ${meta.pause_reason}` : 'Pause'
    }
    case 'resume': {
      const meta = e.meta as { pause_duration_seconds?: number }
      return meta.pause_duration_seconds
        ? `Resume · +${meta.pause_duration_seconds}s stoppage`
        : 'Resume'
    }
    case 'halftime': return 'Halftime'
    case 'fulltime': return 'Full time'
    default: return ''
  }
}

/* Stub picker — replaced in Task 4. Just allows the score cells to compile
 * with an onClick handler. */
function ScorerPickerStub({ team, onClose }: { team: 'white' | 'black'; onClose: () => void }) {
  return (
    <>
      <div className="ref-picker-backdrop" onClick={onClose} />
      <div className="ref-picker-sheet">
        <div className="ref-picker-grabber" />
        <h3 className="ref-picker-title">Who scored for {team === 'white' ? 'White' : 'Black'}?</h3>
        <p className="ref-picker-sub">Picker UI lands in Task 4.</p>
        <button type="button" className="ref-picker-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  )
}
```

- [ ] **Step 4: Build verify**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc -b
cd ffc && node ./node_modules/vite/bin/vite.js build 2>&1 | tail -5
```

Expected: tsc EXIT 0; vite ✓ built. Both must succeed.

If `import '../styles/ref-entry.css'` is duplicated due to the Edit tool, deduplicate manually.

- [ ] **Step 5: Commit**

```bash
git add ffc/src/styles/ref-entry.css ffc/src/pages/RefEntry.tsx ffc/src/lib/useMatchSession.ts
git commit -m "$(cat <<'EOF'
feat(s044,2b-d): LiveConsole shell — clock, score block, half strip, event strip

Replaces mode==='live' placeholder in RefEntry.tsx with a working live
console. Includes:

- LiveHeader (LIVE / BREAK chip)
- HalfStrip (1ST/2ND HALF · progress bar · stoppage chip with alarm
  pulse when over MAX_STOPPAGE_SOFT_LIMIT_SECONDS)
- Big M:SS clock display (paused = amber)
- White / Black score blocks (tap → opens stub picker; disabled when paused)
- Minimum action row: Pause/Resume + End Half
- Halftime banner with break countdown + Skip Break + Add Min
- EventStrip with most-recent-first chronology, M' / M+S' stoppage notation,
  per-event-type icons + descriptions

ref-entry.css extended with --rf-success/--rf-warn/--rf-pause/--rf-danger
brand tokens and ~280 LOC of live-mode styles (clock, score block, half
strip, action buttons, picker sheet, halftime banner, event strip).

useMatchSession exposes sessionStorageKey so LiveConsole can wire its
useMatchClock to the same browser-storage scope.

Scorer picker, card flow, MOTM picker, undo, and pause-reason picker are
deferred to Tasks 4 + 5. The score cells currently open a Task 4 stub.
EOF
)"
```

---

## Task 4 — Scorer picker (with own-goal toggle) (35 min)

This task replaces `ScorerPickerStub` with a full picker that filters to the scoring team's roster, supports an own-goal toggle, and commits the goal via `clock.addGoal()`.

- [ ] **Step 1: Replace `ScorerPickerStub` in `RefEntry.tsx`**

Use the Edit tool. Find the entire `ScorerPickerStub` definition (the function from `function ScorerPickerStub({ team, onClose }: ...` through its closing `}`) and replace it with:

```tsx
interface ScorerPickerProps {
  team: 'white' | 'black'
  payload: RefMatchdayPayload
  onPick: (participant: { profile_id: string | null; guest_id: string | null }, isOwnGoal: boolean) => void
  onClose: () => void
}

function ScorerPicker({ team, payload, onPick, onClose }: ScorerPickerProps) {
  const [isOwnGoal, setIsOwnGoal] = useState(false)
  // When own-goal mode is active, show the OPPOSITE team's roster (the player
  // who put it in their own net).
  const rosterTeam: 'white' | 'black' = isOwnGoal ? (team === 'white' ? 'black' : 'white') : team
  const players = rosterTeam === 'white' ? payload.white : payload.black
  const titleTeam = team === 'white' ? 'White' : 'Black'

  return (
    <>
      <div className="ref-picker-backdrop" onClick={onClose} />
      <div className="ref-picker-sheet" role="dialog" aria-modal="true">
        <div className="ref-picker-grabber" />
        <h3 className="ref-picker-title">
          {isOwnGoal ? `Own goal — who put it in their own net?` : `Who scored for ${titleTeam}?`}
        </h3>
        <p className="ref-picker-sub">
          {isOwnGoal
            ? `Goal credits ${titleTeam}.`
            : `Auto-stamps the current match minute. Tap player.`}
        </p>
        <div className="ref-picker-toggle-row">
          <button
            type="button"
            className={'ref-picker-toggle' + (!isOwnGoal ? ' ref-picker-toggle--active' : '')}
            onClick={() => setIsOwnGoal(false)}
          >
            Goal
          </button>
          <button
            type="button"
            className={'ref-picker-toggle' + (isOwnGoal ? ' ref-picker-toggle--active' : '')}
            onClick={() => setIsOwnGoal(true)}
          >
            Own Goal
          </button>
        </div>
        <div className="ref-picker-grid">
          {players.map((p) => (
            <button
              key={(p.profile_id ?? p.guest_id ?? 'p') + ':' + p.display_name}
              type="button"
              className="ref-picker-row"
              onClick={() => {
                onPick({ profile_id: p.profile_id, guest_id: p.guest_id }, isOwnGoal)
                onClose()
              }}
            >
              <span>{p.display_name}{p.is_captain ? ' (C)' : ''}</span>
              {p.primary_position && (
                <span className="ref-picker-pos">{p.primary_position.toUpperCase()}</span>
              )}
            </button>
          ))}
        </div>
        <button type="button" className="ref-picker-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Replace the `ScorerPickerStub` invocation inside `LiveConsole`**

Find this block in `LiveConsole`:

```tsx
      {scorerTeam && (
        <ScorerPickerStub
          team={scorerTeam}
          onClose={() => setScorerTeam(null)}
        />
      )}
```

Replace with:

```tsx
      {scorerTeam && (
        <ScorerPicker
          team={scorerTeam}
          payload={payload}
          onPick={(participant, isOwnGoal) => {
            clock.addGoal(scorerTeam, participant, isOwnGoal)
          }}
          onClose={() => setScorerTeam(null)}
        />
      )}
```

- [ ] **Step 3: Build verify**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc -b
cd ffc && node ./node_modules/vite/bin/vite.js build 2>&1 | tail -5
```

Expected: tsc EXIT 0; vite ✓ built.

- [ ] **Step 4: Commit**

```bash
git add ffc/src/pages/RefEntry.tsx
git commit -m "$(cat <<'EOF'
feat(s044,2b-d): scorer picker — Goal / Own Goal toggle + roster grid

Replaces ScorerPickerStub with a real bottom-sheet picker. Tapping a
score cell opens the picker filtered to that team's roster. A pill
toggle switches between "Goal" (default) and "Own Goal" modes — own
goal flips the displayed roster to the OPPOSITE team (the player who
put it in their own net) and credits the goal to the correct team via
clock.addGoal(team, participant, isOwnGoal=true).

Position pills + captain (C) marker render alongside the name. The
picker dismisses on backdrop tap or after pick.
EOF
)"
```

---

## Task 5 — Pause-reason picker, card flow, MOTM picker, undo (50 min)

This is the polish-pass task. After it, the live console matches mockup states 2–4 fully.

- [ ] **Step 1: Add picker state to `LiveConsole`**

Use the Edit tool. Find the existing state declaration in `LiveConsole`:

```tsx
  const [scorerTeam, setScorerTeam] = useState<'white' | 'black' | null>(null)
```

Replace with:

```tsx
  const [scorerTeam, setScorerTeam] = useState<'white' | 'black' | null>(null)
  const [pausePickerOpen, setPausePickerOpen] = useState(false)
  const [cardPickerOpen, setCardPickerOpen] = useState(false)
  const [motmPickerOpen, setMotmPickerOpen] = useState(false)
  // Card flow: stage 1 = picking team+player; stage 2 = yellow-or-red.
  const [cardStage, setCardStage] = useState<{ team: 'white' | 'black'; profile_id: string | null; guest_id: string | null; display_name: string } | null>(null)
```

- [ ] **Step 2: Replace the minimum action row with the full action grid**

Find this block in `LiveConsole`:

```tsx
        {/* Action rows are wired in Tasks 4 + 5. For Task 3 keep a minimal action row. */}
        <div className="ref-action-row">
          <button
            type="button"
            className={
              'ref-action-btn ' +
              (clock.state.paused_at ? 'ref-action-btn--resume' : 'ref-action-btn--pause')
            }
            onClick={() => (clock.state.paused_at ? clock.resume() : clock.pause())}
          >
            <span className="ref-action-btn-ico">{clock.state.paused_at ? '▶' : '⏸'}</span>
            {clock.state.paused_at ? 'RESUME' : 'PAUSE'}
          </button>
          <button
            type="button"
            className="ref-action-btn ref-action-btn--end"
            onClick={() => clock.endHalf()}
            disabled={clock.state.half !== 1}
          >
            <span className="ref-action-btn-ico">⏭</span>
            END HALF
          </button>
        </div>
```

Replace with:

```tsx
        <div className="ref-action-row">
          <button
            type="button"
            className={
              'ref-action-btn ' +
              (clock.state.paused_at ? 'ref-action-btn--resume' : 'ref-action-btn--pause')
            }
            onClick={() => {
              if (clock.state.paused_at) {
                clock.resume()
              } else {
                setPausePickerOpen(true)
              }
            }}
          >
            <span className="ref-action-btn-ico">{clock.state.paused_at ? '▶' : '⏸'}</span>
            {clock.state.paused_at ? 'RESUME' : 'PAUSE'}
          </button>
          <button
            type="button"
            className="ref-action-btn ref-action-btn--card"
            onClick={() => setCardPickerOpen(true)}
            disabled={clock.state.paused_at !== null}
          >
            <span className="ref-action-btn-ico">🟨</span> CARD
          </button>
        </div>
        <div className="ref-action-row">
          <button
            type="button"
            className="ref-action-btn"
            onClick={() => clock.undoLast()}
            disabled={!clock.canUndo}
          >
            <span className="ref-action-btn-ico">↺</span> UNDO LAST
          </button>
          <button
            type="button"
            className="ref-action-btn"
            onClick={() => setMotmPickerOpen(true)}
          >
            <span className="ref-action-btn-ico">⭐</span>
            {clock.state.motm ? `MOTM: ${truncateName(clock.state.motm.display_name)}` : 'SET MOTM'}
          </button>
        </div>
        <div className="ref-action-row">
          <button
            type="button"
            className="ref-action-btn ref-action-btn--end"
            onClick={() => clock.endHalf()}
            disabled={clock.state.half !== 1}
          >
            <span className="ref-action-btn-ico">⏭</span>
            END 1ST HALF
          </button>
          {/* Right side: end-match (full time) only enabled in 2nd half — wires
            * to slice 2B-E post-match summary. Disabled stub for now. */}
          <button
            type="button"
            className="ref-action-btn ref-action-btn--end"
            disabled
            title="End match wires up in slice 2B-E"
          >
            <span className="ref-action-btn-ico">🏁</span> END MATCH
          </button>
        </div>
```

- [ ] **Step 3: Add the picker overlays inside `LiveConsole`**

Find the existing scorer picker conditional render at the end of `LiveConsole`:

```tsx
      {scorerTeam && (
        <ScorerPicker
          team={scorerTeam}
          payload={payload}
          onPick={(participant, isOwnGoal) => {
            clock.addGoal(scorerTeam, participant, isOwnGoal)
          }}
          onClose={() => setScorerTeam(null)}
        />
      )}
```

Append immediately after (before the closing `</section>`):

```tsx
      {pausePickerOpen && (
        <PauseReasonPicker
          onPick={(reason) => {
            clock.pause(reason)
            setPausePickerOpen(false)
          }}
          onClose={() => setPausePickerOpen(false)}
        />
      )}
      {cardPickerOpen && !cardStage && (
        <CardPlayerPicker
          payload={payload}
          onPick={(team, p) => {
            setCardStage({ team, ...p })
            setCardPickerOpen(false)
          }}
          onClose={() => setCardPickerOpen(false)}
        />
      )}
      {cardStage && (
        <CardKindPicker
          playerName={cardStage.display_name}
          team={cardStage.team}
          onPick={(kind) => {
            clock.addCard(kind, cardStage.team, {
              profile_id: cardStage.profile_id,
              guest_id: cardStage.guest_id,
            })
            setCardStage(null)
          }}
          onClose={() => setCardStage(null)}
        />
      )}
      {motmPickerOpen && (
        <MotmPicker
          payload={payload}
          current={clock.state.motm}
          onPick={(selection) => {
            clock.setMotm(selection)
            setMotmPickerOpen(false)
          }}
          onClose={() => setMotmPickerOpen(false)}
        />
      )}
```

- [ ] **Step 4: Append the new picker components + helpers at the bottom of `RefEntry.tsx`**

Append (after `ScorerPicker`):

```tsx

const PAUSE_REASONS = ['Foul', 'Injury', 'Ref decision', 'Other'] as const

interface PauseReasonPickerProps {
  onPick: (reason: string) => void
  onClose: () => void
}

function PauseReasonPicker({ onPick, onClose }: PauseReasonPickerProps) {
  return (
    <>
      <div className="ref-picker-backdrop" onClick={onClose} />
      <div className="ref-picker-sheet" role="dialog" aria-modal="true">
        <div className="ref-picker-grabber" />
        <h3 className="ref-picker-title">Pause — why?</h3>
        <p className="ref-picker-sub">Optional. Choose to log it; skip to pause without a reason.</p>
        <div className="ref-picker-grid">
          {PAUSE_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              className="ref-picker-row"
              onClick={() => onPick(reason)}
            >
              <span>{reason}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ref-picker-cancel"
          onClick={() => onPick('')}
        >
          Pause without reason
        </button>
      </div>
    </>
  )
}

interface CardPlayerPickerProps {
  payload: RefMatchdayPayload
  onPick: (team: 'white' | 'black', participant: { profile_id: string | null; guest_id: string | null; display_name: string }) => void
  onClose: () => void
}

function CardPlayerPicker({ payload, onPick, onClose }: CardPlayerPickerProps) {
  return (
    <>
      <div className="ref-picker-backdrop" onClick={onClose} />
      <div className="ref-picker-sheet" role="dialog" aria-modal="true">
        <div className="ref-picker-grabber" />
        <h3 className="ref-picker-title">Card — who?</h3>
        <p className="ref-picker-sub">Pick the player. Yellow / Red comes next.</p>
        {(['white', 'black'] as const).map((team) => {
          const players = team === 'white' ? payload.white : payload.black
          return (
            <div key={team} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--rf-text-muted)', textTransform: 'uppercase', margin: '8px 0 6px' }}>
                {team === 'white' ? 'White' : 'Black'}
              </div>
              <div className="ref-picker-grid">
                {players.map((p) => (
                  <button
                    key={(p.profile_id ?? p.guest_id ?? 'p') + ':' + p.display_name}
                    type="button"
                    className="ref-picker-row"
                    onClick={() => onPick(team, { profile_id: p.profile_id, guest_id: p.guest_id, display_name: p.display_name })}
                  >
                    <span>{p.display_name}</span>
                    {p.primary_position && (
                      <span className="ref-picker-pos">{p.primary_position.toUpperCase()}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
        <button type="button" className="ref-picker-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  )
}

interface CardKindPickerProps {
  playerName: string
  team: 'white' | 'black'
  onPick: (kind: 'yellow' | 'red') => void
  onClose: () => void
}

function CardKindPicker({ playerName, team, onPick, onClose }: CardKindPickerProps) {
  return (
    <>
      <div className="ref-picker-backdrop" onClick={onClose} />
      <div className="ref-picker-sheet" role="dialog" aria-modal="true">
        <div className="ref-picker-grabber" />
        <h3 className="ref-picker-title">Card for {playerName} ({team[0].toUpperCase()})</h3>
        <p className="ref-picker-sub">Yellow or Red?</p>
        <div className="ref-picker-grid">
          <button
            type="button"
            className="ref-picker-row"
            onClick={() => onPick('yellow')}
            style={{ background: 'rgba(229,186,91,0.18)', borderColor: 'var(--rf-accent)' }}
          >
            <span>🟨 Yellow</span>
          </button>
          <button
            type="button"
            className="ref-picker-row"
            onClick={() => onPick('red')}
            style={{ background: 'rgba(230,51,73,0.18)', borderColor: 'var(--rf-danger)' }}
          >
            <span>🟥 Red</span>
          </button>
        </div>
        <button type="button" className="ref-picker-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  )
}

interface MotmPickerProps {
  payload: RefMatchdayPayload
  current: { profile_id: string | null; guest_id: string | null; display_name: string; team: 'white' | 'black' } | null
  onPick: (selection: { profile_id: string | null; guest_id: string | null; display_name: string; team: 'white' | 'black' } | null) => void
  onClose: () => void
}

function MotmPicker({ payload, current, onPick, onClose }: MotmPickerProps) {
  const allPlayers: Array<{
    profile_id: string | null
    guest_id: string | null
    display_name: string
    team: 'white' | 'black'
    primary_position: string | null
  }> = [
    ...payload.white.map((p) => ({
      profile_id: p.profile_id,
      guest_id: p.guest_id,
      display_name: p.display_name,
      team: 'white' as const,
      primary_position: p.primary_position,
    })),
    ...payload.black.map((p) => ({
      profile_id: p.profile_id,
      guest_id: p.guest_id,
      display_name: p.display_name,
      team: 'black' as const,
      primary_position: p.primary_position,
    })),
  ]

  function isCurrent(p: { profile_id: string | null; guest_id: string | null }): boolean {
    if (!current) return false
    return current.profile_id === p.profile_id && current.guest_id === p.guest_id
  }

  return (
    <>
      <div className="ref-picker-backdrop" onClick={onClose} />
      <div className="ref-picker-sheet" role="dialog" aria-modal="true">
        <div className="ref-picker-grabber" />
        <h3 className="ref-picker-title">Set MOTM</h3>
        <p className="ref-picker-sub">Combined roster · can be changed before submit.</p>
        <div className="ref-picker-grid">
          {allPlayers.map((p) => (
            <button
              key={(p.profile_id ?? p.guest_id ?? 'p') + ':' + p.display_name}
              type="button"
              className={'ref-picker-row' + (isCurrent(p) ? ' ref-picker-toggle--active' : '')}
              onClick={() => onPick({
                profile_id: p.profile_id,
                guest_id: p.guest_id,
                display_name: p.display_name,
                team: p.team,
              })}
            >
              <span>{p.display_name} <span style={{ color: 'var(--rf-text-muted)', fontWeight: 600 }}>({p.team[0].toUpperCase()})</span></span>
              {p.primary_position && (
                <span className="ref-picker-pos">{p.primary_position.toUpperCase()}</span>
              )}
            </button>
          ))}
        </div>
        {current && (
          <button
            type="button"
            className="ref-picker-cancel"
            onClick={() => onPick(null)}
          >
            Clear MOTM
          </button>
        )}
        <button type="button" className="ref-picker-cancel" onClick={onClose} style={{ marginTop: 8 }}>
          Close
        </button>
      </div>
    </>
  )
}

function truncateName(name: string): string {
  if (name.length <= 14) return name
  return name.slice(0, 12) + '…'
}
```

- [ ] **Step 5: Build verify**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc -b
cd ffc && node ./node_modules/vite/bin/vite.js build 2>&1 | tail -5
```

Expected: tsc EXIT 0; vite ✓ built.

- [ ] **Step 6: Commit**

```bash
git add ffc/src/pages/RefEntry.tsx
git commit -m "$(cat <<'EOF'
feat(s044,2b-d): pause-reason / card / MOTM pickers + undo + full action grid

Completes the live console action surface (mockup states 2 + 3 full).

- Pause flow: PAUSE button opens PauseReasonPicker (Foul / Injury / Ref
  decision / Other / Pause without reason). RESUME closes the pause and
  adds the duration to the current half's stoppage bank.
- Card flow: two-stage. CardPlayerPicker shows BOTH teams (W and B
  sub-headers); pick a player → CardKindPicker offers Yellow / Red. The
  selected card commits via clock.addCard().
- MOTM flow: combined-roster picker; selection persists in clock state.
  The action-row label updates to show the current MOTM's name (truncated
  to 12 chars). "Clear MOTM" inside the sheet wipes the selection.
- UNDO LAST: enabled only while clock.canUndo is true (15-second window
  from the last event's commit_at). Pops the most recent event, reverses
  score impact for goals/own-goals, and rolls back pause/resume bookkeeping.
- Full 3-row action grid: Pause+Card / Undo+MOTM / EndHalf+EndMatch.
  END MATCH is disabled until slice 2B-E.

Score cells disable while paused (no goals during pause); CARD button
also disables (consistent with paused state). PAUSE has its own picker
flow so it's always available — closing the picker without picking does
not pause the clock.
EOF
)"
```

---

## Task 6 — Build verify + S044 close-out + push (15 min)

- [ ] **Step 1: Final build verify**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc -b
cd ffc && node ./node_modules/vite/bin/vite.js build 2>&1 | tail -5
```

Expected: tsc EXIT 0; vite `✓ built`. Note PWA size; should be up ~10–15 KiB from S043.

- [ ] **Step 2: Update `tasks/todo.md`**

Edit the `## NEXT SESSION — S044` block. Rename to `## NEXT SESSION — S045` with:
- **S045 agenda:** slice 2B-E (post-match summary + submit_ref_entry round-trip + token consumption + admin push notification scaffolding).
- **Carry-over:** acceptance tests for slices 2B-B/C/D on real device (real Thursday matchday). Captain reroll live test.
- **Defense-in-depth:** REVOKE EXECUTE FROM PUBLIC on admin RPCs (still pending from S043 spawn).

Insert a new `## Completed in S044 (27/APR/2026, Home PC)` section above the existing `## Completed in S043` block. Cover:
- New `useMatchClock` hook (~280 LOC) with pure clock-math helpers.
- `refConsoleConstants.ts` for tunables.
- LiveConsole component with clock display, half strip, score block, scorer picker (with own-goal toggle), pause-reason picker, two-stage card flow, MOTM picker, 15-second undo, halftime banner with skip-break / +add-min, event strip with M' / M+S' notation.
- ~280 LOC of live-mode CSS appended to ref-entry.css with new `--rf-success/--rf-warn/--rf-pause/--rf-danger` brand tokens.
- No migrations this slice. **Migrations on live DB: 31 (unchanged).**

S044 gotchas / lessons (additive):
- **Sibling-key persistence pattern** — when one hook (`useMatchSession`) already owns a localStorage key, a downstream hook can write to a sibling key (`<parent>:clock`) instead of forcing the parent to know about clock-state shape. Keeps responsibilities clean.
- **1 Hz tick via `setInterval` re-renders the React tree** — because the derived `display` memo reads `Date.now()` each pass. The bare `void tick` reference is enough to force the effect to re-evaluate. Avoids RAF complexity for a clock that updates per second.
- **Pause + score-cell disable invariant** — disabling the score buttons while paused prevents the ref from logging a goal at a stale match-minute (the clock is frozen, so the stamp would be wrong). UX nudge: resume first, then score.
- **Two-stage card flow** — picking the player then the colour is two sheets back-to-back. Avoids cramming an 8-row × 2-team × 2-colour grid into one view.
- **Own-goal flips the displayed roster** — picker title flips to "who put it in their own net?" and the underlying roster array swaps. Goal credit goes to the OPPOSITE team via clock.addGoal(team, participant, isOwnGoal=true) where `team` is the SCORING team.
- **Soft-limit stoppage alarm** — when stoppage_h1/h2_seconds exceeds MAX_STOPPAGE_SOFT_LIMIT_SECONDS (180 s), the chip turns red and pulses. Doesn't auto-end the half; just nudges.
- **Configurable tunables as TS constants** — REGULATION_HALF_MINUTES (35/25), HALFTIME_BREAK_SECONDS (300), UNDO_WINDOW_MS (15000). Deferred app_settings plumbing until a second league configures differently. YAGNI > over-engineering.

- [ ] **Step 3: Append S044 segment to `CLAUDE.md`**

In the long status header, append a sentence-or-two summary of slice 2B-D: useMatchClock hook + LiveConsole landed; mockup states 2–4 fully wired; submit flow deferred to 2B-E; migrations unchanged at 31. Keep the existing prose style — it's a single dense paragraph per session.

- [ ] **Step 4: Create `sessions/S044/session-log.md`**

Follow the structure of `sessions/S042/session-log.md` (and S043). Sections: header (date/branch/PC/migrations), what landed (per-task summary), verification (tsc+vite), patterns/lessons (the additive list from Step 2 above), next-session pointer (S045 → slice 2B-E).

- [ ] **Step 5: Append a row to `sessions/INDEX.md`**

Format: `S044 · 27/APR/2026 · Home PC · Phase 2 slice 2B-D — RefEntry live console (clock + pickers + undo) · 4 commits · next: S045 slice 2B-E`. Keep the columns aligned with prior rows.

- [ ] **Step 6: Commit + push**

```bash
git add tasks/todo.md CLAUDE.md sessions/S044/session-log.md sessions/INDEX.md
git commit -m "$(cat <<'EOF'
docs(s044,2b-d): close-out — todo S044 + CLAUDE.md narrative + S044 session log + INDEX

Slice 2B-D shipped — useMatchClock hook + LiveConsole component covering
mockup states 2-4 (live · scorer-picker · halftime). Pause-reason picker,
two-stage card flow, MOTM picker, and 15-second undo all wired. No
migrations this slice. Submit flow deferred to 2B-E (slice 2B-E will land
post-match summary + submit_ref_entry round-trip + token consumption).

Migrations on live DB: 31 (unchanged).
EOF
)"
git push
```

Expected push: 4 feat commits + 1 docs commit = 5 commits total for S044.

---

## Acceptance criteria — Slice 2B-D

- [ ] `tsc -b` EXIT 0 and `vite build` succeeds.
- [ ] Hitting `/ref/<valid-token>` (with locked roster) shows the pre-match screen, KICK OFF transitions to live mode.
- [ ] Big M:SS clock counts up 1 Hz from kickoff.
- [ ] Tapping WHITE / BLACK opens the scorer picker filtered to that team.
- [ ] OWN GOAL toggle flips picker to opposite roster; selection credits goal to original team.
- [ ] Score increments by 1 on pick.
- [ ] PAUSE opens reason picker; choosing a reason pauses the clock with a logged event; resume button replaces pause label.
- [ ] On RESUME, stoppage chip increments by the pause duration.
- [ ] CARD opens player picker, then colour picker; logs yellow_card or red_card event.
- [ ] SET MOTM opens combined-roster picker; selection appears in action button label.
- [ ] UNDO LAST pops the most recent event when within 15 s; greys out after.
- [ ] END HALF (1st half only) transitions to break view; 5-minute countdown shown.
- [ ] SKIP BREAK transitions to 2nd half; clock resumes counting from 35:00.
- [ ] + ADD MIN bumps the break countdown by 60 s.
- [ ] Refresh during live mode preserves state (clock, score, events, MOTM).
- [ ] localStorage key `ffc_ref_<sha256(token)[0:32]>:clock` populated with the ClockState JSON.
- [ ] No console errors during a 2-minute manual smoke test.

---

## Out of scope (deferred to slice 2B-E and beyond)

- POST-match summary screen with editable event log.
- `submit_ref_entry` round-trip + token consumption + post-submit "thanks" screen.
- Web Push admin notification when ref submits (Phase 2A).
- Admin review screen `/admin/match-entries/:id`.
- Server-side defense-in-depth (REVOKE FROM PUBLIC on admin RPCs).
- 2nd-half side-swap UI cosmetic.
- Live spectator clock for non-ref users (Phase 3, requires server clock).

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-27-phase2-slice-2B-D.md`.**
