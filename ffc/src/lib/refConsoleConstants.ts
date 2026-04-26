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
