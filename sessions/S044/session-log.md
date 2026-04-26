# S044 — Phase 2 slice 2B-D: RefEntry live match console

**Date:** 27/APR/2026
**PC:** Home (`User`)
**Topic:** Replace the `mode === 'live'` placeholder in `RefEntry.tsx` with a fully working client-authoritative live match console — clock, score blocks, scorer picker (with own-goal toggle), pause-reason picker, two-stage card flow, MOTM picker, 15-second undo, halftime banner. All state-machine transitions persist to `localStorage`; submit flow defers to slice 2B-E.
**Outcome:** Complete. 8 commits on `main`, pushed at close. tsc + eslint + vite build all clean. **Migrations on live DB: 31 (unchanged from S043).** No backend work this slice — everything was client-side.

## Background — what 2B-D had to deliver

Phase 2 Track 2B is the live match console. Slice 2B-A (S040) shipped the migration 0028 backend foundation (`pending_match_events`, `match_events`, `match_event_type` enum, timing columns, RPCs). 2B-B (S041) shipped the admin "Generate ref link" UI. 2B-C (S042) shipped the pre-match RefEntry screen — token URL → roster + KICK OFF button → transition to live mode placeholder. 2B-D's job: turn that placeholder into a real live console matching mockup states 2–4.

Out of scope for 2B-D (deferred to 2B-E and onward):
- Post-match summary + submit (`submit_ref_entry` round-trip + token consumption + admin notification).
- Admin review screen `/admin/match-entries/:id`.
- Defense-in-depth REVOKE FROM PUBLIC on admin RPCs (S043 spawn).
- 2nd-half side-swap UI cosmetic.

## Plan

`docs/superpowers/plans/2026-04-27-phase2-slice-2B-D.md` (~2160 LOC, committed as `9a30297`). 6 tasks: pre-flight verify · constants + useMatchClock hook · LiveConsole shell · scorer picker · remaining pickers + undo · close-out.

Plan was executed via `superpowers:subagent-driven-development` — fresh subagent per task plus two-stage review (spec compliance, then code quality) before marking complete.

## Implementation summary

### Task 2 — `refConsoleConstants.ts` + `useMatchClock.ts`

5 named tunables in `ffc/src/lib/refConsoleConstants.ts`:
- `REGULATION_HALF_MINUTES` (Record `'7v7'`→35, `'5v5'`→25)
- `HALFTIME_BREAK_SECONDS = 300`
- `MAX_STOPPAGE_SOFT_LIMIT_SECONDS = 180`
- `UNDO_WINDOW_MS = 15_000`
- `HALFTIME_ADD_MIN_SECONDS = 60`

The hook at `ffc/src/lib/useMatchClock.ts` (~545 LOC) owns the clock state machine + event log:

```ts
export type MatchHalf = 1 | 2 | 'break'

export type EventType =
  | 'goal' | 'own_goal' | 'yellow_card' | 'red_card'
  | 'pause' | 'resume' | 'halftime' | 'fulltime'

export interface MatchEvent {
  ordinal: number
  event_type: EventType
  match_minute: number
  match_second: number
  half: 1 | 2                      // discriminator added in df189c2
  team: 'white' | 'black' | null
  profile_id: string | null
  guest_id: string | null
  meta: Record<string, unknown>
  committed_at: string
}

export interface ClockState {
  kickoff_at: string
  half: MatchHalf
  halftime_at: string | null
  halftime_break_seconds_extra: number
  second_half_kickoff_at: string | null
  stoppage_h1_seconds: number
  stoppage_h2_seconds: number
  paused_at: string | null
  score_white: number
  score_black: number
  events: MatchEvent[]
  motm: MotmSelection | null
}
```

Pure helpers exported for future testability: `computeHalfElapsedMs`, `formatMSS`, `formatStoppage`, `computeMatchStamp`. A module-internal `stampFromState(state, regulationHalfMinutes, pausedAtOverride?)` DRYs out the four event-construction sites.

Persistence: sibling `localStorage` key `<sessionStorageKey>:clock`. Hydration via async-aware `useEffect` (the parent's storage key resolves async via `crypto.subtle.digest`, so a lazy initializer can't see it). 1 Hz tick via `setInterval` drives display re-renders. `Date.now()` reads happen INSIDE `useMemo` bodies with `tick` in deps (and an `eslint-disable react-hooks/exhaustive-deps` intent comment).

Mutators: `addGoal(team, participant, isOwnGoal=false)`, `addCard(kind, team, participant)`, `pause(reason?)`, `resume()`, `endHalf()`, `startSecondHalf()`, `addBreakMin()`, `setMotm(selection)`, `undoLast()` (returns void — see lessons), with `canUndo` derived boolean.

Two spec-review fixes landed in this task: the original plan hardcoded `REGULATION_HALF_MINUTES['7v7']` in `undoLast`'s resume-undo half routing (would silently misbehave under 5v5); the original plan inlined `180` instead of importing `MAX_STOPPAGE_SOFT_LIMIT_SECONDS`. Both fixed in `07c8595`.

A code-quality pass landed in `cd91483`: `Date.now()` moved inside the `display` and `canUndo` memos (was at render scope, defeating memoization); `setState`-in-effect lint suppressed with intent comments; `undoLast()` return type narrowed from `boolean` to `void` (the boolean version had a setState-async race); `resume` guards `'break'` symmetrically with `pause`; dead `+ 0` and trailing `committed_at` no-op simplified; empty `if (state.half === 'break') {}` block in tick effect collapsed; JSDoc on `EventType` clarifying that `'fulltime'` is type-only until 2B-E; `stampFromState` helper extracted to dedupe four IIFE sites.

### Task 3 — LiveConsole shell

`ffc/src/pages/RefEntry.tsx` `mode === 'live'` placeholder swapped for `<LiveConsole>` (after a payload-null guard). New private components inside RefEntry.tsx:

- `LiveConsole` — root container, calls `useMatchClock`, owns `scorerTeam` local state, branches on `clock.state.half === 'break'`.
- `LiveHeader` — LIVE / BREAK chip with red-pulse / accent-static dot.
- `HalfStrip` — 1ST/2ND HALF label + progress bar 0..100% + stoppage chip (red-alarm pulse over 180s soft limit).
- Big M:SS clock display — `--rf-pause` amber when paused.
- `ScoreReadOnly` — used in halftime branch.
- `HalftimeView` — break countdown + Skip Break + Add Min.
- `EventStrip` — most-recent-first chronology (max 8), M' / M+S' notation, per-event-type icons + descriptions. Empty state copy "No events yet." until first event.
- Helpers: `formatEventMinute(e, regulationHalfMinutes)`, `eventIcon(t)`, `eventDescription(e)`.

`useMatchSession` extended to expose `sessionStorageKey: storageKey` so LiveConsole can wire its useMatchClock to the same browser-storage scope.

CSS additions to `ref-entry.css`: 4 new brand tokens (`--rf-success`, `--rf-warn`, `--rf-pause`, `--rf-danger`) + ~292 LOC of live-mode rules (live header, half strip, big clock, score block, action row, event strip, halftime banner, picker-sheet scaffold for Tasks 4+5).

A correctness fix landed in `df189c2`: code review noticed `formatEventMinute` couldn't disambiguate 1st-half stoppage (match_minute=36 → should render `35+1'`) from 2nd-half regulation (match_minute=36 → should render `36'`). Fix: add `half: 1 | 2` to `MatchEvent`, populate at every event-construction site, branch on `e.half` in the formatter.

### Task 4 — Scorer picker

Replace `ScorerPickerStub` with full `ScorerPicker` component:

- Props `{ team, payload, onPick, onClose }`.
- Local `useState` for `isOwnGoal`.
- `rosterTeam` flips to OPPOSITE team in own-goal mode (the player who put it in their own net).
- Title + sub-text flip with mode.
- Pill toggle row (Goal / Own Goal).
- Roster grid with name + captain (C) marker + position pill.
- `role="dialog"` + `aria-modal="true"`.

`LiveConsole` invocation passes `payload` and an `onPick` closure that calls `clock.addGoal(scorerTeam, participant, isOwnGoal)` — note the SCORING team is `scorerTeam` (the prop into the picker), NOT `rosterTeam` (the displayed roster's team in own-goal mode). Critical correctness invariant.

### Task 5 — Pause / Card / MOTM pickers + undo + extracted pickers file

Extended state:

```ts
const [pausePickerOpen, setPausePickerOpen] = useState(false)
const [cardPickerOpen, setCardPickerOpen] = useState(false)
const [motmPickerOpen, setMotmPickerOpen] = useState(false)
const [cardStage, setCardStage] = useState<{
  team: 'white' | 'black'
  profile_id: string | null
  guest_id: string | null
  display_name: string
} | null>(null)
```

Replaced minimal action row with full 3-row grid:
- Row 1: PAUSE/RESUME (PAUSE opens picker; RESUME calls `clock.resume()` directly) + CARD (opens picker; disabled when paused).
- Row 2: UNDO LAST (`disabled={!clock.canUndo}`) + SET MOTM / `MOTM: <truncated-name>` (dynamic label).
- Row 3: END 1ST HALF (disabled when half !== 1) + END MATCH (always disabled, `title="End match wires up in slice 2B-E"`).

Four new pickers added (originally to RefEntry.tsx, then extracted in 9d93527):

- **`PauseReasonPicker`** — 4 reason rows (Foul / Injury / Ref decision / Other) + "Pause without reason" (calls `onPick('')`, hook treats falsy reason as `meta: {}`).
- **`CardPlayerPicker`** — TWO-section sheet: WHITE roster grid + BLACK roster grid, both with sub-headers. Picking a player → `setCardStage({ team, ...participant })` → `setCardPickerOpen(false)`.
- **`CardKindPicker`** — Yellow accent-tinted button + Red danger-tinted button. Picking → `clock.addCard(kind, cardStage.team, cardStage.participant)` → `setCardStage(null)`.
- **`MotmPicker`** — combined-roster picker; each row has team-letter suffix `(W)` or `(B)`. `isCurrent` highlights via `--ref-picker-toggle--active` class. "Clear MOTM" button (renders only when current set) + "Close" button.

Two-stage card flow: conditional render is `cardPickerOpen && !cardStage` for the player picker, `cardStage` truthy for the kind picker — mutually exclusive.

After Task 5 the file hit 828 LOC, 28 over the 800-line global rule. Extracted the 5 pickers + `truncateName` helper + `PAUSE_REASONS` const into `ffc/src/pages/RefEntryPickers.tsx` (commit `9d93527`). RefEntry.tsx dropped to 555 LOC; new file is 293 LOC. Both well within typical range. Two scoped `eslint-disable react-refresh/only-export-components` directives needed on the non-component exports (`PAUSE_REASONS` const + `truncateName` helper) to satisfy `react-refresh/only-export-components` from a file that also exports components.

### Task 6 — Close-out (this commit)

Build verify: `tsc -b` EXIT 0, `eslint` clean across all touched files (incl. retrofit of `useMatchSession.ts:91` setState-in-effect comment-based suppression that was pre-existing from S042 but never landed before — applied here for consistency since useMatchClock used the same pattern), `vite build` succeeded (PWA precache 1525 KiB).

Updated `tasks/todo.md` (S045 agenda set), appended S044 segment to `CLAUDE.md` status header, created this session log, appended row to `sessions/INDEX.md`.

## Verification

- `tsc -b` EXIT 0
- `eslint` 0 errors / 0 warnings on `ffc/src/lib/useMatchClock.ts`, `ffc/src/lib/refConsoleConstants.ts`, `ffc/src/pages/RefEntry.tsx`, `ffc/src/pages/RefEntryPickers.tsx`, `ffc/src/lib/useMatchSession.ts`
- `vite build` ✓ built (PWA precache 1525.71 KiB / 11 entries)
- Migration count on live DB unchanged at 31 — slice 2B-D was client-only.
- Spec compliance review passed on all 4 implementation tasks (Tasks 2, 3, 4, 5).
- Code quality review passed on Task 2 (after one revisions pass) and Task 3 (approved with minor follow-up notes that were already in scope).

## Patterns / lessons (additive — see CLAUDE.md S044 segment for the canonical list)

### `Date.now()` at render scope defeats `useMemo`

A memo that reads `Date.now()` directly at render scope and includes it in deps recomputes every render (Date.now() changes every ms). Move the call INSIDE the memo body and depend on a `tick` counter set by `setInterval(1000)`. ESLint's `react-hooks/purity` rule catches this. Same fix any time a `setInterval`-driven re-render reads wall-clock state.

```ts
// WRONG
const now = Date.now()
const display = useMemo(() => { /* uses now */ }, [state, now])

// RIGHT
const display = useMemo(() => {
  const now = Date.now()
  /* uses now */
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick drives the per-second refresh
}, [state, tick])
```

### `setState` in `useEffect` for async-arrival hydration

Real lint error but unavoidable when the dep is async. The lazy initializer can't see future async values. Suppress with intent comment:

```ts
useEffect(() => {
  if (!clockKey || hydratedRef.current) return
  const stored = readClockState(clockKey)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional async hydration
  if (stored) setState(stored)
  hydratedRef.current = true
}, [clockKey, kickoffIso])
```

### `undoLast(): boolean` was a setState-async race trap

Setting a flag inside `setState((prev) => ...)` and reading it after the function returns is unreliable because React may defer the updater. The `setState` is async; the function returns synchronously before the closure runs. Fix: change the signature to `() => void`. Callers needing button-disabled state use the derived `canUndo` boolean (which reads the events array at render time + is `tick`-fresh).

### Sibling-key persistence pattern

When one hook owns a localStorage key, a downstream hook can write to a sibling key (`<parent>:clock`) instead of forcing the parent to know about the downstream's state shape. Keeps responsibilities clean and hydration races local. Used here so `useMatchClock` doesn't have to share its 12-field `ClockState` shape with `useMatchSession`.

### `MatchEvent` needs a `half` discriminator

Without it the formatter can't tell 1st-half stoppage (match_minute=36 → render `35+1'`) from 2nd-half regulation (match_minute=36 → render `36'`). Adding `half: 1 | 2` at every event-construction site is the cheap fix; downstream readers (Pickers, future submit RPC, admin review screen) inherit the right semantics.

### Pause + score-cell disable invariant

Disabling score buttons while paused prevents the ref from logging a goal at a stale match-minute (the clock is frozen, so the stamp would be wrong). UX nudge: resume first, then score. CARD also disables for consistency. PAUSE/RESUME stays enabled because the only way out of pause is to resume.

### Two-stage card flow > one-shot grid

Picking the player then the colour is two sheets back-to-back. Avoids cramming an 8-row × 2-team × 2-colour grid into one view. Conditional render: `cardPickerOpen && !cardStage` for player picker, `cardStage` truthy for kind picker — mutually exclusive.

### Own-goal flips the displayed roster

Picker title flips to "Who put it in their own net?" and the underlying roster array swaps. Goal credit goes to the OPPOSITE team via `clock.addGoal(team, participant, isOwnGoal=true)` where `team` is the SCORING team, NOT the rendered roster's team. Critical correctness invariant: the `team` prop on ScorerPicker tracks the SCORING team independently of which roster is shown.

### Soft-limit stoppage alarm

When `stoppage_h1/h2_seconds` exceeds `MAX_STOPPAGE_SOFT_LIMIT_SECONDS` (180 s), the chip turns red and pulses. Doesn't auto-end the half; just nudges. Driven from the same hook display-memo so it's per-tick fresh.

### 800-line file rule is a guardrail, not a target

Slice 2B-D's first finished implementation hit 828 LOC in RefEntry.tsx. Extracted the 5 picker components + helpers into `RefEntryPickers.tsx` as a single refactor commit before close-out. Both files dropped well into typical range (RefEntry 555 / Pickers 293). Doing extraction at slice-close (rather than after slice 2B-E grows the file further) was lower-friction.

### YAGNI > over-engineering for tunables

`REGULATION_HALF_MINUTES` etc. ship as TS constants. The Phase 2 design spec called for `app_settings` plumbing, but until a second league configures differently it'd just add round-trip cost + migration churn. Plan calls for the move when a real second league appears.

## Open follow-ups

- **Slice 2B-E** — post-match summary + submit. Wire `submit_ref_entry` round-trip + token consumption + post-submit "thanks" screen + admin notification scaffolding.
- **Slice 2B-F** — admin review screen `/admin/match-entries/:id`.
- **Defense-in-depth (S043 spawn)** — REVOKE EXECUTE FROM PUBLIC on admin RPCs.
- **Live device acceptance** for slices 2B-B / 2B-C / 2B-D on a real Thursday matchday.
- **Captain reroll live test** — deferred until MD31 runs in-app.

## Next session

**S045 — slice 2B-E (Post-match summary + submit).** Add a sixth mode (`'review'`) between `'live'` and `'post'` that fires on END MATCH (currently a disabled stub). Render final-score row, MOTM row, full event log with edit affordances, and SUBMIT TO ADMIN button. Wire `submit_ref_entry` RPC call (already extended in 0028 to accept `events[]` + `timing` payload). On success: token gets burned (`consumed_at = now()` is server-side), transition to `'post'` mode with thank-you copy. Out of scope: Web Push admin notification (Phase 2A), admin review screen (slice 2B-F).
