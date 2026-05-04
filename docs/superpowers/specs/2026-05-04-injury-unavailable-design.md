# Injury / Unavailable List — design spec

**Date:** 2026-05-04
**Session:** S066
**Status:** Draft → awaiting user review
**Scope:** Long-term unavailability flag on `profiles` distinct from the per-match `is_no_show` injury tag (mig 0064). Player-driven self-mark + admin override + auto-clear by date. Surfaces on Settings, AdminPlayers, Poll, Roster Setup, Leaderboard, and Profile.
**Phase:** Phase 3 backlog (V3.0:147).

---

## Problem

Today there is no way to mark a player as unavailable for an extended period. Edge cases handled poorly:

- A player travels for two weeks → either they remember to vote No on every Monday poll, or they get rostered while they're abroad.
- A player gets injured → no surface shows it; admins keep adding them to rosters.
- A player retires → still shows on the leaderboard at full opacity, indistinguishable from active players.
- The S060 `is_no_show` flag (mig 0064) only captures *match-time* injury during ref entry. There is no concept of "unavailable for the next four matchdays."

V3.0:147 commits the feature: "long-term unavailability flag distinct from poll No/Maybe (e.g. injured 6 weeks, travelling). Surfaces on roster setup + leaderboard as a muted 'OUT' badge."

## Goal

Add four typed unavailability states (`injured`, `travelling`, `suspended`, `retired`) on `profiles`, with player self-serve from Settings and admin override via AdminPlayers. Auto-clear at midnight UAE on the optional return date. Hide unavailable players from the Poll and Roster Setup pool. Show muted rows with status pills on the Leaderboard.

## Non-goals

- **Unavailability history.** Once a status clears, it's gone. Approach A from brainstorm; history table is a separate spec if ever needed.
- **Auto-cascade into locked rosters.** If a player is already on a locked matchday roster and goes OUT, the roster is unchanged. Admin manually drops via existing dropout flow. Future enhancement: trigger `cancel_my_vote` style dropout automatically.
- **Per-team substitution suggestions.** Out of scope.
- **Unit tests.** FFC has no test infrastructure (per `tasks/lessons.md`); verification is manual via the dev preview + Thursday matchday acceptance.

---

## Data model

### Migration `0070_unavailability.sql`

```sql
-- 1. Enum
CREATE TYPE unavailability_status AS ENUM
  ('available', 'injured', 'travelling', 'suspended', 'retired');

-- 2. Profile columns
ALTER TABLE profiles
  ADD COLUMN unavailable_status unavailability_status NOT NULL DEFAULT 'available',
  ADD COLUMN unavailable_until  DATE NULL,
  ADD COLUMN unavailable_reason TEXT NULL;

-- 3. Consistency constraint
ALTER TABLE profiles ADD CONSTRAINT chk_unavailable_consistency CHECK (
     (unavailable_status = 'available' AND unavailable_until IS NULL AND unavailable_reason IS NULL)
  OR (unavailable_status = 'retired'   AND unavailable_until IS NULL)
  OR (unavailable_status IN ('injured', 'travelling', 'suspended'))
);

-- 4. Notification kind extensions
ALTER TYPE notification_kind ADD VALUE 'unavailability_set';
ALTER TYPE notification_kind ADD VALUE 'unavailability_cleared';
```

### RPCs

| RPC | Caller | Behavior |
|---|---|---|
| `set_my_unavailability(p_status, p_until, p_reason)` | Authenticated player (RLS: own profile) | Validates: `p_status != 'available'`; if status `IN ('injured','travelling','suspended')` and `p_until` set, must be `>= CURRENT_DATE`; if status = `'retired'`, `p_until` must be NULL. Updates own profile. Clears any open `poll_votes.vote` rows for the caller (set to NULL) on future polls. Inserts `'unavailability_set'::notification_kind` notification for each admin. |
| `clear_my_unavailability()` | Authenticated player (RLS: own profile) | Sets `unavailable_status = 'available'`, NULLs the other two. Inserts `'unavailability_cleared'::notification_kind` for admins. |
| `admin_set_player_unavailability(p_player_id, p_status, p_until, p_reason)` | Admin (`is_admin()` helper) | Same validation as above, but writes to any profile. **Silent — no notifications fired.** Allows status = `'available'` (clears the flag). |
| `auto_clear_expired_unavailability()` | pg_cron job | `UPDATE profiles SET unavailable_status='available', unavailable_until=NULL, unavailable_reason=NULL WHERE unavailable_status IN ('injured','travelling','suspended') AND unavailable_until IS NOT NULL AND unavailable_until <= CURRENT_DATE RETURNING id, COALESCE(formal_name, full_name) AS name`. For each row, INSERT `'unavailability_cleared'::notification_kind` for admins. |

**S063 lesson applied:** every `INSERT INTO notifications (..., kind, ...) SELECT ..., 'unavailability_set'::notification_kind, ...` uses an explicit cast. PG locks projection types before INSERT context when the SELECT chains through a CTE / DISTINCT.

### pg_cron schedule

```sql
SELECT cron.schedule(
  'clear-expired-unavailability',
  '0 20 * * *',            -- 20:00 UTC = 00:00 UAE
  $$SELECT auto_clear_expired_unavailability()$$
);
```

### Realtime publication

`profiles` is already in `supabase_realtime` (verified via `pg_publication_tables` before assuming, per S047 lesson). No `ALTER PUBLICATION` needed.

### Views & query updates

- **`v_season_standings`** — no change to ordering / points; consumers handle the muted rendering. Add `unavailable_status` to the projection so frontend can read it without a second query.
- **`Poll.tsx` query** — append `WHERE p.unavailable_status = 'available'` to the eligible voter list selection.
- **`AdminRosterSetup` pool query** — same filter as Poll.

---

## UI surfaces

### 1. `Settings` — new "Availability" card

Renders below the existing notification preferences block.

**State: Available**
- Header: "Availability"
- Sub-line: "Available for matches"
- Form:
  - Status radio (5 options: 🟢 Available · 🩹 Injured · ✈️ Travelling · 🚫 Suspended · 🏁 Retired)
  - Date picker labelled "Expected return" (hidden when Available or Retired; optional otherwise)
  - Textarea labelled "Reason (optional)" (hidden when Available)
  - Save button
- Submitting calls `set_my_unavailability(status, until?, reason?)`.

**State: Out (any non-available status)**
- Header: "Availability — `<status pill>`"
- Sub-line: "`<reason>` · until `<until>`" (or "no return date set" if NULL)
- Primary action button: **"I'm back"** → `clear_my_unavailability()`
- Secondary "Edit" link → expands the form pre-filled with current values

### 2. `AdminPlayers` — per-player Availability row

Each player card gets a new row alongside the existing formal_name / ban_days / soft-delete controls:

```
Availability   <status pill>           [Edit]
```

Edit opens a modal with the same form as Settings (status / until / reason). Submit calls `admin_set_player_unavailability`. **No notification fired** (admin moves are silent).

### 3. `Poll` — hide unavailable players

`Poll.tsx` SELECT adds `WHERE unavailable_status = 'available'`. Counts (yes / maybe / no / total) recalculate naturally over the filtered set.

**Side-effect on flip from available → out:** `set_my_unavailability` clears the player's row in `poll_votes` for any open matchday (`vote = NULL`). Prevents stale Yes votes lingering invisibly.

### 4. `Leaderboard` — muted row + status pill

Row receives `data-unavailable={status}` attribute. CSS:

```css
[data-unavailable="injured"],
[data-unavailable="travelling"],
[data-unavailable="suspended"],
[data-unavailable="retired"] {
  opacity: 0.55;
}
```

Status pill rendered next to player name via shared `<UnavailabilityPill>` component. Pills:
- 🩹 OUT (injured) — red tint
- ✈️ AWAY (travelling) — blue tint
- 🚫 SUSP (suspended) — orange tint
- 🏁 RETIRED — grey tint

Player keeps their rank and points (per Q5 — "stay in rank, muted with status pill").

### 5. `Profile` screen (`Profile.tsx`)

If `unavailable_status != 'available'`, render a small status banner below the name with pill + reason + return date. Applies whether viewing your own or another player's profile. No new actions on this surface — editing your own status happens in Settings.

### 6. `AdminRosterSetup` pool

Same filter as Poll. Locked rosters are NOT auto-modified — if a player on a locked roster goes OUT, admin manually triggers the existing dropout flow.

### Shared component

`ffc/src/components/UnavailabilityPill.tsx`
```ts
interface UnavailabilityPillProps {
  status: 'available' | 'injured' | 'travelling' | 'suspended' | 'retired';
  size?: 'sm' | 'md';
}
```
Returns null for `'available'`. Single source of truth for icon + label + colour token across all surfaces. Uses per-screen brand tokens convention from `docs/ui-conventions.md`.

---

## Data flow

### Self-mark
```
Settings → set_my_unavailability('injured', '2026-05-14', 'ankle')
  ↓
UPDATE profiles SET unavailable_* = …
UPDATE poll_votes SET vote = NULL WHERE user_id = caller AND matchday open
INSERT notifications (kind='unavailability_set'::notification_kind, ...) for each admin
  ↓
Realtime → AppContext profile sub fires
  → Settings UI flips to "I'm back" state
  → Poll.tsx sub refreshes → caller hidden
  → Leaderboard sub refreshes → row dims, pill shows
  → Admin push: "🩹 Mohammed marked himself injured until 14 May (ankle)"
```

### "I'm back" early clear
```
Settings → clear_my_unavailability()
  ↓
UPDATE profiles SET unavailable_status='available', until=NULL, reason=NULL
INSERT notifications (kind='unavailability_cleared'::notification_kind, ...)
  ↓
Realtime → all subs refresh → player visible again
  → Admin push: "✅ Mohammed is back"
```

### Admin override (silent)
```
AdminPlayers Edit → admin_set_player_unavailability(player_id, 'travelling', '2026-05-20', 'work trip')
  ↓
UPDATE profiles
NO notification
  ↓
Realtime fires (free benefit) → other admin sessions update if open
```

### Auto-clear at 00:00 UAE
```
pg_cron @ 20:00 UTC daily
  ↓
auto_clear_expired_unavailability()
  → UPDATE profiles SET unavailable_status='available', until=NULL, reason=NULL
    WHERE unavailable_status IN ('injured','travelling','suspended')
      AND unavailable_until IS NOT NULL
      AND unavailable_until <= CURRENT_DATE
    RETURNING id, name
  → For each: INSERT notification 'unavailability_cleared'::notification_kind for admins
  ↓
Next time admin foregrounds: push received, leaderboard reflects unmuted row
```

---

## Edge cases & decisions

| Scenario | Decision |
|---|---|
| Player on locked roster goes OUT | Roster unchanged. Admin manually drops via existing flow. Status pill on Leaderboard makes them visible to admin during planning. Future enhancement: optional auto-cascade. |
| Player has Yes vote on open poll, then goes OUT | `set_my_unavailability` clears their `poll_votes.vote` to NULL. Vote tally recalculates. Player no longer appears in poll UI. |
| Status change while already OUT (Injured → Travelling) | UPDATE goes through; `unavailability_set` notification fires again with new payload so admins see the transition. |
| Past-date `unavailable_until` | RPC raises exception (`p_until < CURRENT_DATE`). Frontend should surface via toast helper from S063 (`extractErrMessage`). |
| Retired with `unavailable_until` provided | Rejected by CHECK constraint. RPC validates earlier and raises a clearer error. |
| Admin clears a player's status via AdminPlayers (sets to Available) | Silent, no notification. Leaderboard / Poll / Roster all refresh via realtime. |
| Soft-deleted player marked OUT | Existing soft-delete UI hides these from AdminPlayers entirely; not addressable. RPC still works defensively. |
| pg_cron job missed (Supabase free-tier hiccup) | Next-day run catches up — the WHERE clause uses `until <= CURRENT_DATE`, so any expired-yesterday rows still clear. |
| Player in Profile screen `MyProfile` while marked OUT | Status banner shows; no editing controls (Edit happens in Settings). |

---

## Files touched

### New files
- `supabase/migrations/0070_unavailability.sql`
- `ffc/src/components/UnavailabilityPill.tsx`

### Modified files
- `ffc/src/pages/Settings.tsx` — new "Availability" card
- `ffc/src/pages/admin/AdminPlayers.tsx` — Availability row + edit modal
- `ffc/src/pages/Poll.tsx` — query filter + render exclusion
- `ffc/src/pages/Leaderboard.tsx` — pill + dim row
- `ffc/src/pages/Profile.tsx` — status banner (own + other-player views)
- `ffc/src/pages/admin/AdminRosterSetup.tsx` — pool filter
- `ffc/src/styles/index.css` — `[data-unavailable]` opacity rule + pill colour tokens (per-screen brand block)
- `ffc/src/lib/types.ts` (or equivalent) — `UnavailabilityStatus` type alias matching DB enum
- `ffc/src/contexts/AppContext.tsx` — extend profile selection to include the 3 new columns

### Auto-regenerated
- `ffc/src/types/database.ts` — `npm run gen:types` after migration applied

---

## Verification

Manual via dev preview, plus Thursday matchday acceptance:

- [ ] Player marks themselves Injured from Settings → admin push received → poll hides player → leaderboard row dims with 🩹 OUT pill
- [ ] Player taps "I'm back" → admin push → all surfaces unmute
- [ ] Admin override from AdminPlayers → no notification, but UI updates everywhere via realtime
- [ ] Set `unavailable_until = today`, wait until 00:00 UAE → auto-clear runs → admin push `unavailability_cleared` → leaderboard unmutes
- [ ] Active poll vote: cast Yes → mark self injured → poll vote disappears, tally updates
- [ ] Past-date `until` → RPC error surfaces via toast (`extractErrMessage`)
- [ ] Retired status set → no return date input shown, no future auto-clear
- [ ] CHECK constraint rejects illegal combos (manual SQL test)
- [ ] Profile screen shows status banner when OUT

## Out of scope (follow-ups, not part of this spec)

- Auto-cascade into locked rosters (treat OUT as `cancel_my_vote`).
- Unavailability history table.
- Captain notifications when a confirmed player goes OUT post-lock.
- "Suggested substitute" surface for captains.
- Bulk admin tooling (mark all of [team X] OUT).
