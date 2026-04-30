# S053 — Admin Roster Setup

**Date:** 30/APR/2026 | **PC:** Home Mac (`chaos`) | **Branch:** `feature/fix-login`

## What was built

Implemented Issue #11 — Admin Roster Setup — in full. New admin screen at `/admin/roster` with drag-and-drop team assignment that works on web and mobile.

### Commits on this branch (S053)
- `bc07fc9` — `feat(s053): admin Roster Setup page + drag-and-drop team builder`
- `00f580c` — `feat(s053): roster cap enforcement + waitlist in AdminRosterSetup`
- `4f96e32` — `chore(s053): regen types after migration 0047/0048 db push`

(Previous session's branch commits `a00222e` + `2c435a0` + `b1010f1` also on this branch from S052-era 2B work.)

## What shipped

### New: `AdminRosterSetup.tsx`
- Lists all matchdays; tap one to open the editor
- **New matchday:** pool of yes-voters → drag into White / Black; Auto-assign button fills teams alternating (1st→White, 2nd→Black, …)
- **Existing match:** "Edit Roster" → calls `unlock_roster` RPC → loads current team assignments alongside unassigned/pool/removed players
- **Cap enforcement:** players beyond the format cap (14 for 7v7, 10 for 5v5) split into a Waitlist lane by `committed_at` order; dragging into a full team silently blocked; saving over cap shows inline error
- Drag engine: Pointer Events API only (no library) — `onPointerDown` + document-level `pointermove`/`pointerup` + `document.elementFromPoint()` for drop detection; `touch-action: none` for mobile
- Ghost element follows cursor/finger during drag

### New: `supabase/migrations/0048_admin_replace_match_roster.sql`
SECURITY DEFINER RPC to replace team assignments on an already-registered match. Audits BEFORE destructive DELETE. REVOKE PUBLIC + GRANT authenticated.

### Modified
- `AdminHome.tsx` — added Roster Setup card to admin hub
- `AdminMatches.tsx` — removed stale `@ts-expect-error` on `unlock_roster` (now in generated types)
- `router.tsx` — added `/admin/roster` route
- `ffc/src/index.css` — roster styles scoped under `.rs-*`
- `ffc/src/lib/database.types.ts` — regenerated after migration 0047 push

## DB state

- Migration 0047 (`unlock_roster_rpc`) — pushed and confirmed in types
- Migration 0048 (`admin_replace_match_roster`) — pushed by user during session but NOT reflected in generated types yet; `@ts-expect-error` retained in code until next regen confirms it

## PR state at close

Branch pushed to `origin/feature/fix-login`. PR created and ready for Mohammed to review and merge. After merge Vercel auto-deploys. Then live test the roster feature on a real matchday.

## Pending after merge

1. After deploy, re-run: `supabase gen types typescript --linked 2>/dev/null > ffc/src/lib/database.types.ts`  
   If `admin_replace_match_roster` appears → remove the `@ts-expect-error` at `AdminRosterSetup.tsx:467` and push a follow-up commit.
2. Live-test checklist:
   - `/admin/roster` lists matchdays
   - New matchday: drag-and-drop, auto-assign, save → creates match draft
   - Existing matchday: Edit Roster → unlocks → loads current assignments correctly (not blank)
   - Waitlist lane shows for matchdays with >14 yes-voters (7v7)
   - Over-cap save is blocked with error message
3. Phase 2 live acceptance (8-box checklist from S053 todo) — still owed on a real Thursday

## Patterns / lessons

- **`document.elementFromPoint()` is the right drop-target detection primitive when a ghost `div` is overlaid.** The ghost has `pointer-events: none` so `elementFromPoint` finds the element underneath; then walk up with `.closest('[data-drop-zone]')` to find the zone.
- **Cap enforcement belongs in the data layer, not just the UI.** Sort yes-voters by `committed_at`, split at `capFor(fmt)` index — this ensures the waitlist is stable (same ordering as the real committed_at queue) and auto-assign/drag both respect the same cap.
- **`@ts-expect-error` should explain the exact condition for its removal** — "migration 0048 not yet reflected in generated types" is more actionable than a generic comment; future-you knows exactly what to check.
- **Types regen confirmation pattern:** after `db push`, always `grep` the output types file for the new function name before removing a `@ts-expect-error`. If missing, the migration may have failed silently or the RPC signature didn't parse.
