# Phase 2 Slice 2B-E — RefEntry Post-Match Review + Submit

**Goal:** Replace the `mode === 'post'` placeholder + the disabled `END MATCH` stub in `RefEntry.tsx` with a real post-match flow: tapping END MATCH transitions to a new `'review'` mode showing final score, MOTM, full event log with delete affordance, optional notes textarea, and a SUBMIT TO ADMIN button. SUBMIT calls `submit_ref_entry` RPC (already extended in 0028 to accept `events[]` + `timing` payload). On success: token is server-burned, mode flips to `'post'`, success view rendered.

**Architecture:**
- `useMatchSession` mode union extends from `'loading' | 'invalid' | 'pre' | 'live' | 'post'` to add `'review'`. New actions: `endMatch()` flips live→review, `confirmSubmit()` flips review→post.
- `useMatchClock` gains a new `endMatch()` mutator that captures `fulltime_at`, finalizes any open pause into stoppage, and emits a `'fulltime'` event. New `fulltime_at: string | null` field on `ClockState`.
- `useMatchClock` gains a new `deleteEvent(ordinal)` mutator that lets the review screen prune events the ref noticed too late (past the 15s undo window). Score and motm are re-derived consistently with the deletion (goal/own_goal events decrement score on delete).
- Lift `useMatchClock(...)` call from inside `LiveConsole` to the top-level `RefEntry()` so both LiveConsole and ReviewConsole share the same hook instance. Pass the `clock` return value down as a prop.
- New `ReviewConsole` and `PostSubmittedView` components rendered when `mode === 'review'` and `mode === 'post'` respectively.
- New picker `EventDeletePicker` (in `RefEntryPickers.tsx`) for the delete-confirm bottom sheet.
- Submit flow: client aggregates `players[]` from rosters + events (per-player goals, yellow_cards, red_cards, is_motm), builds the payload, calls `supabase.rpc('submit_ref_entry', { p_token: token, p_payload })`.

**Tech Stack:**
- React 19 + TypeScript 6 (no new dependencies)
- Existing supabase client for the RPC call
- No migration this slice — schema + RPC already shipped in 0028 (S040)

---

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `ffc/src/lib/useMatchSession.ts` | **Modify** | Add `'review'` to `MatchMode` union, add `endMatch()` and `confirmSubmit()` actions, persist new modes. ~165 → ~210 LOC. |
| `ffc/src/lib/useMatchClock.ts` | **Modify** | Add `fulltime_at` to `ClockState`, `endMatch()` and `deleteEvent(ordinal)` mutators. ~545 → ~640 LOC. |
| `ffc/src/pages/RefEntry.tsx` | **Modify** | Lift `useMatchClock` to RefEntry top level; wire END MATCH; add `ReviewConsole` + `PostSubmittedView`; replace `'post'` stub. Submit handler builds payload + calls RPC. ~555 → ~830 LOC. |
| `ffc/src/pages/RefEntryPickers.tsx` | **Modify** | Add `EventDeletePicker` (delete-event-confirm sheet). ~293 → ~340 LOC. |
| `ffc/src/styles/ref-entry.css` | **Modify** | Append review-mode + post-submitted styles. ~470 → ~620 LOC. |
| `tasks/todo.md` + `CLAUDE.md` + `sessions/S045/session-log.md` + `sessions/INDEX.md` | **Edit/Create** | Standard close-out. |

**No migration this slice.** `submit_ref_entry` already accepts the `events[]` + `timing` payload (migration 0028, S040). `pending_match_events` already exists. `match_events` is populated server-side by `approve_match_entry` on admin approval (slice 2B-F scope).

---

## Pre-flight context

- Branch: `main`. Tip: `bf0f2eb` (S044 close-out).
- Live DB migrations: 31 (0001 → 0031).
- `RefEntry.tsx` mode flow currently: `pre → live → post (stub)`. END MATCH button disabled.
- `useMatchSession.startMatch()` flips `pre → live` and grabs wake-lock. We follow the same pattern for `endMatch()` (flips `live → review`) — no wake-lock change.
- Clock owns events array. Ordinals are monotonic (1-indexed). Order of events on submit matches the array order.
- `submit_ref_entry` payload schema (from 0028):
  - `result: 'white' | 'black' | 'draw'`
  - `score_white`, `score_black: int`
  - `notes: string | null`
  - `players: [{ profile_id, guest_id, team, goals, yellow_cards, red_cards, is_motm }]`
  - `events: [{ event_type, match_minute, match_second, team, profile_id, guest_id, meta, ordinal }]`
  - `timing: { kickoff_at, halftime_at, fulltime_at, stoppage_h1_seconds, stoppage_h2_seconds }`
- Server burns the token on success; admin notification row inserted into `notifications` for all admin/super_admin profiles.

### Aggregation rules (client-side, derived from `events` + rosters)

For each roster player (white + black), iterate events:
- `'goal'` event with matching `profile_id`/`guest_id` → +1 to that player's `goals` (only if event.team matches the roster team).
- `'own_goal'` event → no player gets credit. Score increment is already in `score_white`/`score_black` from the clock; the player aggregate does NOT include it.
- `'yellow_card'` event → +1 to that player's `yellow_cards`.
- `'red_card'` event → +1 to that player's `red_cards`.
- `is_motm`: true iff `clock.state.motm.profile_id` (or `guest_id`) matches AND `clock.state.motm.team` matches the player's roster team.

`result` derived from `score_white` vs `score_black`: `'white'` if W > B, `'black'` if B > W, `'draw'` if equal.

---

## Tasks

### Task 1 — `useMatchSession` extensions

Add `'review'` to `MatchMode`. Add `endMatch()` and `confirmSubmit()` actions. Both write the new mode through to the persisted state so a refresh on the review screen lands back on the review screen (handy if the ref accidentally swipes-away mid-review).

```ts
export type MatchMode = 'loading' | 'invalid' | 'pre' | 'live' | 'review' | 'post'

const endMatch = () => setMode('review')
const confirmSubmit = () => setMode('post')
```

Return both alongside `startMatch`.

### Task 2 — `useMatchClock.endMatch()` + `deleteEvent()` + `fulltime_at`

Add `fulltime_at: string | null` to `ClockState`. Default null in `emptyClockState`.

`endMatch()`:
- No-op if already at fulltime (`prev.fulltime_at !== null`).
- If currently paused, finalize the pause into the current half's stoppage (mirrors `endHalf` logic).
- Captures `fulltime_at = new Date().toISOString()`.
- Emits a `'fulltime'` event with stamp computed pre-pause-finalization (so the time matches what's on the clock at the moment the ref taps end).
- Sets `paused_at: null` (we've absorbed it).

`deleteEvent(ordinal: number)`:
- Find event by ordinal. No-op if not found.
- Remove from `events` array.
- If event was a `'goal'`: decrement `score_white` or `score_black` on event.team.
- If event was an `'own_goal'`: decrement on the OPPOSITE of event.team (because own-goals score for the opposing team — see addGoal logic).
- If event was a `'pause'` or `'resume'`: refuse the delete (these are paired clock-state events; deleting one would corrupt stoppage. Show a toast in the UI? Or just silently no-op. We'll silently no-op and gate the UI to disable the affordance for these event types).
- If event was a `'halftime'` or `'fulltime'`: refuse the delete (these are clock-machine transitions). Silently no-op + gate UI.
- All other events (yellow_card, red_card): just remove. Aggregates re-derive from events on submit so no other state to update.

`canUndo` continues to work as before — operates on the last event, irrelevant to deletes.

### Task 3 — Lift `useMatchClock` to `RefEntry()` top level

Currently `useMatchClock` is called inside `LiveConsole`. Lift it to `RefEntry` so both `LiveConsole` and `ReviewConsole` share the same hook instance.

- `useMatchClock` already tolerates `null` for `sessionStorageKey` and `kickoffIso` — safe to call before mode transitions to `live`.
- Pass `clock` as a prop to `LiveConsole`, `ReviewConsole`, `PostSubmittedView`.
- This also sets up the END MATCH button to call `clock.endMatch()` then `session.endMatch()` (in that order — clock state must be frozen before mode flips).

### Task 4 — `ReviewConsole` component

Layout (top to bottom):
1. **Header** — "Match complete · review before submit" + final M:SS clock readout (frozen at `fulltime_at`).
2. **Final score row** — big WHITE n : n BLACK with winner highlight (gold pulse on the winning side, or "DRAW" badge centered if equal).
3. **MOTM card** — name + team chip. Tap to change (re-uses `MotmPicker`). "Clear" button.
4. **Notes textarea** — optional. ~3 rows. Placeholder "Anything the admin should know?". Plain `<textarea>`.
5. **Event log** — full chronological list (oldest first this time, contrast with LiveConsole's most-recent-first strip). Each row shows `M'`/`M+S'` minute, icon, description, and a small `🗑` button on the right for deletable types (goals/cards/own_goals). Pause/resume/halftime/fulltime rows show no delete affordance.
6. **Action row** — `← BACK TO LIVE` (re-enters `'live'` mode for last-second clock-affecting fixes — guarded; only available if no `submit_busy` flag and `fulltime_at` is set) + `📤 SUBMIT TO ADMIN` (primary, gold).

State:
- `notes: string`
- `submitBusy: boolean` (locks the submit button + disables BACK TO LIVE)
- `submitError: string | null`
- `motmPickerOpen`, `eventDeleteTarget: MatchEvent | null`

Submit handler:
```ts
async function handleSubmit() {
  setSubmitBusy(true)
  setSubmitError(null)
  try {
    const payload = buildSubmitPayload(clock.state, payload, notes)
    const { error } = await supabase.rpc('submit_ref_entry', {
      p_token: token,
      p_payload: payload,
    })
    if (error) throw error
    session.confirmSubmit() // flip to 'post'
    // Clear clock storage so a stale state doesn't survive (token now burned).
    if (sessionStorageKey) {
      try { localStorage.removeItem(sessionStorageKey + ':clock') } catch {}
    }
  } catch (e) {
    setSubmitError(e instanceof Error ? e.message : 'Submit failed. Try again.')
    setSubmitBusy(false)
  }
}
```

Note: `submitBusy` is intentionally NOT cleared on success — the component unmounts when mode flips to `'post'`.

### Task 5 — `buildSubmitPayload(state, payload, notes)`

Pure function in `RefEntry.tsx` (or extract to `useMatchClock.ts` as a sibling export — TBD by line count).

Signature:
```ts
function buildSubmitPayload(
  state: ClockState,
  payload: RefMatchdayPayload,
  notes: string,
): SubmitRefEntryPayload
```

Aggregate per-player from rosters + events. Derive result. Strip client-only fields from events (`committed_at`, `half`). Include timing block. Empty-string-safe for nullable text (notes empty string → null).

### Task 6 — `EventDeletePicker` (in RefEntryPickers.tsx)

Bottom sheet with the event description + minute, and `Delete event` (danger-tinted) / `Cancel` buttons. `role="dialog"` + `aria-modal="true"`. ~50 LOC.

### Task 7 — `PostSubmittedView`

Final-score readout + "✓ Submitted to admin · You're done" message + brief copy ("The admin will review and approve the result. You can close this tab."). Optional: link back to `/` (homepage), but the ref likely opened this tab from a WhatsApp share so a "Close tab" instruction is enough.

### Task 8 — CSS

Append to `ref-entry.css`:
- `.ref-review` container
- `.ref-review-header` + final M:SS readout
- `.ref-review-final-score` (big winner-highlighted block)
- `.ref-review-motm-card`
- `.ref-review-notes` (textarea styling matching brand)
- `.ref-review-events-list` (chronological, with `.ref-review-event-row` and `.ref-review-event-delete-btn`)
- `.ref-review-actions` (BACK / SUBMIT)
- `.ref-review-error-banner`
- `.ref-post` (success view)
- `.ref-post-checkmark` (big ✓)
- `.ref-post-final-score-readout`

### Task 9 — END MATCH button wiring

In `LiveConsole`'s third action row, replace the disabled stub:
```tsx
<button
  type="button"
  className="ref-action-btn ref-action-btn--end"
  onClick={() => {
    clock.endMatch()
    session.endMatch()
  }}
>
  <span className="ref-action-btn-ico">🏁</span> END MATCH
</button>
```

Remove the `disabled` and `title` props.

### Task 10 — Build verification

`node ./node_modules/typescript/bin/tsc -b` (must EXIT 0; Vercel uses project-refs which is stricter than `tsc --noEmit`).

`node ./node_modules/vite/bin/vite.js build` (must EXIT 0).

### Task 11 — Close-out

- Update `tasks/todo.md`: drop S045 from NEXT SESSION; promote to "Completed in S045"; set NEXT SESSION to S046 with slice 2B-F (admin review screen) as the next step.
- Update `CLAUDE.md` with S045 narrative paragraph.
- Create `sessions/S045/session-log.md`.
- Append S045 row to `sessions/INDEX.md`.
- Commit individually per logical step. Push at close.

---

## Out of scope this slice

- Web Push notification to admin on submit (Phase 2A — Track 2 work).
- Admin review screen `/admin/match-entries/:id` (slice 2B-F).
- Edit-event flow beyond delete (e.g. correcting minute or player on a logged event). The undo window in 2B-D + delete in 2B-E covers ~95% of correction needs; full edit can be a future enhancement.
- Re-opening a submitted match (post-submit edits are admin-side via the review screen — slice 2B-F).
- Live device acceptance — pending real Thursday matchday.

---

## Acceptance criteria

- [ ] END MATCH button is enabled in any half ≥ 1 when `fulltime_at === null` and the clock isn't in `'break'`. (Edge: it should also work in 2nd half — primary case; 1st half is for unusual abandonment but fine to allow.)
- [ ] Tapping END MATCH transitions to `'review'` mode immediately. Clock state.fulltime_at is set; `'fulltime'` event is in events[].
- [ ] Review screen shows final score with winner highlight (or DRAW badge).
- [ ] MOTM displayed; can be changed or cleared.
- [ ] Notes textarea works; empty stays optional.
- [ ] Event log full + chronological. Delete affordance only on goal/own_goal/yellow_card/red_card rows.
- [ ] Tapping delete opens EventDeletePicker; confirming removes the event and updates score correctly for goal/own_goal.
- [ ] BACK TO LIVE re-enters `'live'` mode (with full clock state preserved) — useful if ref realised they ended too early. Disabled while submit is in flight.
- [ ] SUBMIT TO ADMIN: shows busy state on tap; on success transitions to `'post'` and clears `:clock` storage; on error shows banner + allows retry.
- [ ] PostSubmittedView shows final score + success copy.
- [ ] Refresh on review mode → review mode (mode persists via session storage).
- [ ] Refresh after submit → token now burned → `useMatchSession` falls into `'invalid'` mode (server returns Invalid or expired ref token). This is correct — the link is one-shot.
- [ ] `tsc -b` exits 0.
- [ ] `vite build` exits 0.
