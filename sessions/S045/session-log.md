# S045 — Phase 2 Slice 2B-E: RefEntry post-match review + submit

**Date:** 27/APR/2026
**PC:** Home
**Branch:** main
**Tip at start:** `bf0f2eb` (S044 close-out)
**Tip at end:** (post-push)

## Goal

Replace the `mode === 'post'` placeholder + the disabled `END MATCH` stub in `RefEntry.tsx` with a real post-match flow:

- New `'review'` mode between `'live'` and `'post'`.
- Tapping END MATCH transitions live → review (clock state frozen with `fulltime_at`, `'fulltime'` event emitted).
- Review screen shows final-score row (winner highlight or DRAW badge), MOTM card with change/clear, optional notes textarea, full chronological event log with delete affordance for goal/own_goal/yellow/red rows, BACK TO LIVE + SUBMIT TO ADMIN actions.
- SUBMIT calls `submit_ref_entry` RPC (already extended in migration 0028 to accept `events[]` + `timing` payload). On success: token server-burned, mode flips to `'post'`, success view rendered, `:clock` localStorage cleared.

## Outcome

✅ All planned scope shipped. `tsc -b` EXIT 0. `vite build` EXIT 0. ESLint clean on changed files. Dev server preview verified — `/ref/:token` route compiles and renders correctly with hooks lifted to top level.

End-to-end live device acceptance still pending real Thursday matchday (carry-over).

## Files changed

| Path | Lines (after) | Change |
|---|---|---|
| `ffc/src/lib/useMatchSession.ts` | ~190 | Added `'review'` to `MatchMode`, added `endMatch()` / `confirmSubmit()` / `reopenLive()` actions. |
| `ffc/src/lib/useMatchClock.ts` | ~640 | Added `fulltime_at` to `ClockState`, added `endMatch()` / `reopen()` / `deleteEvent(ordinal)` mutators. Defensive normalisation on hydration to tolerate legacy persisted state without `fulltime_at`. |
| `ffc/src/pages/RefEntry.tsx` | ~750 | Lifted `useMatchClock(...)` to RefEntry top level (shared by Live + Review). New `ReviewConsole` + `PostSubmittedView` + `buildSubmitPayload(...)` helper. END MATCH button enabled. |
| `ffc/src/pages/RefEntryPickers.tsx` | ~340 | Added `EventDeletePicker` confirm sheet. |
| `ffc/src/styles/ref-entry.css` | ~720 | Appended ~250 LOC of review + post-submitted styles (`.ref-review-*`, `.ref-post-*`, `.ref-action-btn--submit`). |
| `docs/superpowers/plans/2026-04-27-phase2-slice-2B-E.md` | new | Slice plan. |

**No migration this slice.** `submit_ref_entry` and `pending_match_events` already shipped in migration 0028 (S040).

## Commits

1. `5dd1be8` — `docs(s045,2b-e): plan — review mode + submit_ref_entry wiring`
2. `6c0b4aa` — `feat(s045,2b-e): hooks — review mode + endMatch + deleteEvent + fulltime_at`
3. `0348ce4` — `feat(s045,2b-e): review console + post view + submit_ref_entry wiring`
4. (close-out commit)

## Patterns / lessons (additive)

### Lifting a stateful hook to share between sibling routes

`useMatchClock` was originally instantiated inside `<LiveConsole>`. To share the same instance with `<ReviewConsole>` we lifted the call to `RefEntry()` itself. The hook already tolerated `null` for both `sessionStorageKey` and `kickoffIso` so calling it before `mode === 'live'` is a no-op (empty state, no persistence, no tick interval running because `kickoffAt` only resolves on `startMatch()`). Cleanest pattern when two siblings need the same authoritative state.

### Defensive hydration when ClockState gains a new field

Adding `fulltime_at` to `ClockState` would have made any persisted-by-S044 state hydrate as `fulltime_at: undefined`, and `undefined !== null` would have spuriously triggered the "match already ended" guard in `endMatch()`. Fixed by normalising every field in `readClockState`: `parsed.fulltime_at ?? null` etc. Cheap, works for any future field addition. Rule of thumb: when the persisted-state shape evolves, defensively `??`-normalise on read instead of bumping a version number, unless the change is destructive.

### `result` vs `score` redundancy in submit payload

`submit_ref_entry` accepts both `result` (`'white' | 'black' | 'draw'`) and `score_white` / `score_black`. Server doesn't (currently) cross-check them. Client derives `result` from scores via `useMemo` so the two can't drift. If the spec ever adds a "match was forfeit" case where the result doesn't match the on-pitch score, this assumption needs revisiting.

### Own-goal score-impact in `deleteEvent`

`addGoal(team, participant, isOwnGoal=true)` records `event.team` = SCORING team (not the participant's actual team). To reverse the score on delete we mirror the same `team`-as-scoring-team semantic: for `event_type === 'own_goal'`, decrement the scoring team's score (which IS `event.team`)... wait, re-reading the addGoal code: own_goal credits the OPPOSITE team via the `scoringTeam` variable. So `event.team` is the player's roster team while the score went to the opposite team. Therefore on delete we decrement the OPPOSITE of `event.team`. The implementation matches this — the comments in `deleteEvent` and `undoLast` both clarify "score went to opposite team; reverse it". Subtle invariant; document at every callsite that touches it.

### Pause/resume/halftime/fulltime are NON-deletable in review

These are clock-machine transition events. Removing them would corrupt accumulated stoppage / break / fulltime state. UI doesn't render delete affordance for them; `deleteEvent` no-ops if called with one of these ordinals as a defensive belt-and-braces. Ref's only escape hatch for a wrongly-pressed PAUSE: undo within 15s, or BACK TO LIVE → resume → re-end.

### `as unknown as Json` for jsonb RPC args

Supabase's generated `Json` type has an index signature `[k: string]: Json | undefined` which TypedScript checks structurally — our hand-written `SubmitPayload` interface doesn't have an index signature, so a direct assign fails TS2322. Precedent in `AdminMatches.tsx` (`p_edits: edits as unknown as Json`) — adopted same pattern. Alternatives: add an index signature to `SubmitPayload` (loses field-level type checking everywhere else) or import the generated `Args` type for `submit_ref_entry` (verbose, no real benefit).

### Top-level `useMatchClock` requires a fallback `format`

When `session.payload` is null (loading/invalid modes) the hook still gets called. Passed `'7v7'` as a default to avoid undefined. Doesn't matter — without `kickoffAt` the hook is in a no-op state anyway.

## Acceptance criteria (from plan)

- [x] END MATCH button enabled when `fulltime_at === null` and not paused. (Disabled while paused — ref must resume first to commit a clean fulltime stamp.)
- [x] Tapping END MATCH transitions to `'review'` immediately; `fulltime_at` set; `'fulltime'` event in events[].
- [x] Review screen final score with winner highlight or DRAW badge.
- [x] MOTM displayed; can change or clear.
- [x] Notes textarea; empty stays optional.
- [x] Event log full + chronological. Delete only on goal/own_goal/yellow_card/red_card.
- [x] EventDeletePicker confirm sheet; score adjusts on delete for goal/own_goal.
- [x] BACK TO LIVE re-enters `'live'` mode (clock state preserved); disabled while submit in flight.
- [x] SUBMIT TO ADMIN: busy state on tap; on success transitions to `'post'` and clears `:clock` storage; on error banner + retry.
- [x] PostSubmittedView shows final score + success copy.
- [x] Refresh on review mode → review mode (mode persists via session storage).
- [x] Refresh after submit → token burned → falls into `'invalid'` mode (correct, link is one-shot).
- [x] `tsc -b` exits 0.
- [x] `vite build` exits 0.

## Out of scope this slice (carried)

- Live device acceptance for slices 2B-B / 2B-C / 2B-D / 2B-E (real Thursday matchday) — carry-over.
- Captain reroll live test — deferred until MD31 runs in-app.
- Web Push admin notification on submit — Phase 2A scope.
- Admin review screen `/admin/match-entries/:id` (slice 2B-F) — next session.
- Defense-in-depth follow-up (S043 spawn): REVOKE EXECUTE FROM PUBLIC on admin RPCs.
