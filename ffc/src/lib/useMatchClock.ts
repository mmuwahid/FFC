import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  HALFTIME_ADD_MIN_SECONDS,
  HALFTIME_BREAK_SECONDS,
  MAX_STOPPAGE_SOFT_LIMIT_SECONDS,
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

/**
 * Event types — mirror DB enum match_event_type.
 * `fulltime` is emitted by `endMatch()` (slice 2B-E).
 */
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
  half: 1 | 2                   // which half this event belongs to (halftime event uses 1)
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
  fulltime_at: string | null          // when 2nd half ended (slice 2B-E)
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
  /** Undo the most recent event (within UNDO_WINDOW_MS). No-op if no event or outside the undo window. */
  undoLast: () => void
  /** True if the most recent event is still within the undo window. */
  canUndo: boolean
  /** End the match. Captures fulltime_at, finalizes any open pause, emits 'fulltime' event. */
  endMatch: () => void
  /** Re-open the match (review → live transition). Clears fulltime_at and removes the most recent 'fulltime' event. No-op if not at full time. */
  reopen: () => void
  /**
   * Delete an event by ordinal. Goal/own_goal events also reverse their score
   * impact. Pause/resume/halftime/fulltime events refuse the delete (silently
   * no-op) because removing them would corrupt clock state.
   */
  deleteEvent: (ordinal: number) => void
}

const CLOCK_KEY_SUFFIX = ':clock'

function clockStorageKey(sessionKey: string): string {
  return sessionKey + CLOCK_KEY_SUFFIX
}

function readClockState(key: string): ClockState | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ClockState>
    // Normalize fields that may be missing on legacy persisted state (pre-2B-E).
    return {
      kickoff_at: parsed.kickoff_at ?? new Date().toISOString(),
      half: parsed.half ?? 1,
      halftime_at: parsed.halftime_at ?? null,
      halftime_break_seconds_extra: parsed.halftime_break_seconds_extra ?? 0,
      second_half_kickoff_at: parsed.second_half_kickoff_at ?? null,
      stoppage_h1_seconds: parsed.stoppage_h1_seconds ?? 0,
      stoppage_h2_seconds: parsed.stoppage_h2_seconds ?? 0,
      paused_at: parsed.paused_at ?? null,
      fulltime_at: parsed.fulltime_at ?? null,
      score_white: parsed.score_white ?? 0,
      score_black: parsed.score_black ?? 0,
      events: parsed.events ?? [],
      motm: parsed.motm ?? null,
    }
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

/**
 * Stamp the current match minute + second from a ClockState snapshot.
 * Returns regulation-half-minute / 0-second for break state (rare). For
 * pause events, pass `pausedAtOverride: null` to compute the stamp at
 * "right now" rather than from the existing paused_at.
 */
function stampFromState(
  state: ClockState,
  regulationHalfMinutes: number,
  pausedAtOverride: string | null | undefined = undefined,
): { match_minute: number; match_second: number } {
  if (state.half === 'break') {
    return { match_minute: regulationHalfMinutes, match_second: 0 }
  }
  const halfStartIso = state.half === 1
    ? state.kickoff_at
    : (state.second_half_kickoff_at ?? state.kickoff_at)
  const stoppageSec = state.half === 1 ? state.stoppage_h1_seconds : state.stoppage_h2_seconds
  const elapsedMs = computeHalfElapsedMs({
    now: Date.now(),
    halfStartIso,
    stoppageSeconds: stoppageSec,
    pausedAtIso: pausedAtOverride === undefined ? state.paused_at : pausedAtOverride,
  })
  return computeMatchStamp({
    half: state.half,
    halfElapsedMs: elapsedMs,
    regulationHalfMinutes,
  })
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
    fulltime_at: null,
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
    // sessionStorageKey resolves async (Web Crypto digest), so we can't hydrate
    // in the lazy initializer — must use an effect. The cascading second render
    // on key arrival is unavoidable and intentional here.
    if (!clockKey || hydratedRef.current) return
    const stored = readClockState(clockKey)
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional hydration
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

  // 1 Hz tick to drive the live clock display (and halftime countdown).
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [state.half])

  const display = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity -- intentional: tick in deps drives the per-second refresh of this clock value.
    const now = Date.now()
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
      stoppageOverSoftLimit: stoppageSec > MAX_STOPPAGE_SOFT_LIMIT_SECONDS,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick drives the per-second refresh; Date.now() is read inside the body so it's not a dep.
  }, [state, regulationHalfMinutes, tick])

  const nextOrdinal = useCallback((events: MatchEvent[]): number => {
    return events.length === 0 ? 1 : events[events.length - 1].ordinal + 1
  }, [])

  const addGoal: UseMatchClockReturn['addGoal'] = useCallback((team, participant, isOwnGoal = false) => {
    setState((prev) => {
      const stamp = stampFromState(prev, regulationHalfMinutes)
      const event: MatchEvent = {
        ordinal: nextOrdinal(prev.events),
        event_type: isOwnGoal ? 'own_goal' : 'goal',
        match_minute: stamp.match_minute,
        match_second: stamp.match_second,
        half: prev.half === 'break' ? 1 : prev.half,
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
      const stamp = stampFromState(prev, regulationHalfMinutes)
      const event: MatchEvent = {
        ordinal: nextOrdinal(prev.events),
        event_type: kind === 'yellow' ? 'yellow_card' : 'red_card',
        match_minute: stamp.match_minute,
        match_second: stamp.match_second,
        half: prev.half === 'break' ? 1 : prev.half,
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
      const stamp = stampFromState(prev, regulationHalfMinutes, null)
      const event: MatchEvent = {
        ordinal: nextOrdinal(prev.events),
        event_type: 'pause',
        match_minute: stamp.match_minute,
        match_second: stamp.match_second,
        half: prev.half,
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
      if (prev.half === 'break') return prev
      const pauseDurationSec = Math.floor((Date.now() - Date.parse(prev.paused_at)) / 1000)
      const isFirstHalf = prev.half === 1
      const newH1 = isFirstHalf ? prev.stoppage_h1_seconds + pauseDurationSec : prev.stoppage_h1_seconds
      const newH2 = !isFirstHalf && prev.half === 2 ? prev.stoppage_h2_seconds + pauseDurationSec : prev.stoppage_h2_seconds
      // Build a hypothetical post-resume state to stamp from.
      const stamp = stampFromState(
        { ...prev, paused_at: null, stoppage_h1_seconds: newH1, stoppage_h2_seconds: newH2 },
        regulationHalfMinutes,
      )
      const event: MatchEvent = {
        ordinal: nextOrdinal(prev.events),
        event_type: 'resume',
        match_minute: stamp.match_minute,
        match_second: stamp.match_second,
        half: prev.half,
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
        half: 1,
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

  const endMatch: UseMatchClockReturn['endMatch'] = useCallback(() => {
    setState((prev) => {
      if (prev.fulltime_at) return prev // already ended
      // 'break' is a transitional state; we shouldn't end the match from it.
      // Caller should startSecondHalf first; UI gates this.
      if (prev.half === 'break') return prev
      // Stamp BEFORE finalizing the pause, so the fulltime event minute reflects
      // the displayed clock at the moment the ref tapped END MATCH.
      const stamp = stampFromState(prev, regulationHalfMinutes)
      // If currently paused, finalize the pause into the current half's stoppage.
      let finalH1 = prev.stoppage_h1_seconds
      let finalH2 = prev.stoppage_h2_seconds
      if (prev.paused_at) {
        const pauseDurationSec = Math.floor((Date.now() - Date.parse(prev.paused_at)) / 1000)
        if (prev.half === 1) finalH1 += pauseDurationSec
        else if (prev.half === 2) finalH2 += pauseDurationSec
      }
      const event: MatchEvent = {
        ordinal: nextOrdinal(prev.events),
        event_type: 'fulltime',
        match_minute: stamp.match_minute,
        match_second: stamp.match_second,
        half: prev.half,
        team: null,
        profile_id: null,
        guest_id: null,
        meta: {},
        committed_at: new Date().toISOString(),
      }
      return {
        ...prev,
        fulltime_at: new Date().toISOString(),
        paused_at: null,
        stoppage_h1_seconds: finalH1,
        stoppage_h2_seconds: finalH2,
        events: [...prev.events, event],
      }
    })
  }, [nextOrdinal, regulationHalfMinutes])

  const reopen: UseMatchClockReturn['reopen'] = useCallback(() => {
    setState((prev) => {
      if (!prev.fulltime_at) return prev
      // Drop the most recent 'fulltime' event (should be at the tail).
      const last = prev.events[prev.events.length - 1]
      const events = last && last.event_type === 'fulltime'
        ? prev.events.slice(0, -1)
        : prev.events
      return { ...prev, fulltime_at: null, events }
    })
  }, [])

  const deleteEvent: UseMatchClockReturn['deleteEvent'] = useCallback((ordinal) => {
    setState((prev) => {
      const idx = prev.events.findIndex((e) => e.ordinal === ordinal)
      if (idx === -1) return prev
      const evt = prev.events[idx]
      // Refuse deletes that would corrupt clock-machine state.
      if (
        evt.event_type === 'pause'
        || evt.event_type === 'resume'
        || evt.event_type === 'halftime'
        || evt.event_type === 'fulltime'
      ) {
        return prev
      }
      // Reverse score impact for goal/own_goal.
      let scoreWhite = prev.score_white
      let scoreBlack = prev.score_black
      if (evt.event_type === 'goal') {
        if (evt.team === 'white') scoreWhite -= 1
        if (evt.team === 'black') scoreBlack -= 1
      } else if (evt.event_type === 'own_goal') {
        // Score went to opposite team; reverse it.
        if (evt.team === 'white') scoreBlack -= 1
        if (evt.team === 'black') scoreWhite -= 1
      }
      return {
        ...prev,
        events: [...prev.events.slice(0, idx), ...prev.events.slice(idx + 1)],
        score_white: Math.max(0, scoreWhite),
        score_black: Math.max(0, scoreBlack),
      }
    })
  }, [])

  const undoLast: UseMatchClockReturn['undoLast'] = useCallback(() => {
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
          ? pauseEvt.committed_at
          : new Date(Date.now() - dur * 1000).toISOString()
        if (prev.half === 1) {
          h1 = Math.max(0, h1 - dur)
        } else if (prev.half === 2) {
          h2 = Math.max(0, h2 - dur)
        }
      }
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
  }, [])

  const canUndo = useMemo(() => {
    const last = state.events[state.events.length - 1]
    if (!last) return false
    // eslint-disable-next-line react-hooks/purity -- intentional: tick in deps drives the per-second refresh as the undo window expires.
    return Date.now() - Date.parse(last.committed_at) <= UNDO_WINDOW_MS
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick drives the per-second refresh as the undo window expires.
  }, [state.events, tick])

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
    endMatch,
    reopen,
    deleteEvent,
  }
}
