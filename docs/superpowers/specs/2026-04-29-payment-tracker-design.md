# Payment Tracker — Design Spec
**Date:** 2026-04-29  
**Session:** S056  
**Status:** Approved for implementation

---

## 1. Overview

A per-match payment tracker so the admin can record who has paid the weekly match fee (60 AED, configurable). Debts are created automatically when a match result is approved. All players can see the full season balance for everyone (full transparency). Only the admin can mark payments or open/close collection windows.

---

## 2. User Stories

| Who | What | So that |
|-----|------|---------|
| Admin | Mark a player paid for a specific match | Record cash or bank transfer received |
| Admin | Close a collection window manually | Signal that the payment period for a match is over |
| Admin | Override a closed window | Accept late payments after the window closed |
| Player | View the season overview (all players) | See who owes what and compare balances |
| Player | View their own match-by-match ledger | Know exactly which matches they owe for |

---

## 3. Decisions & Rules

- **Fee**: 60 AED per player per match. Stored in `app_settings` (`payment_fee_aed`). Configurable per season by admin.
- **Who owes**: All `match_players` rows for the match where `is_no_show = false` (played or was on the bench). Guests included at the same rate.
- **Debt creation trigger**: Automatically when `matches.approved_at` transitions `NULL → NOT NULL` (admin approves result in MatchEntryReview).
- **Payment methods**: Cash or bank transfer — admin records both the same way (no method distinction in DB).
- **Visibility**: Fully public — all authenticated users can read `match_payment_records` and `payment_windows`.
- **Mark paid**: Admin-only. Only allowed when the match's collection window is open.
- **Window close**: Auto-closes when every record for that match has `paid_at IS NOT NULL`. Admin can also close manually.
- **Override**: Admin can reopen any closed window to mark late payments. No limit on overrides.
- **No-show exclusion**: `match_players.is_no_show = true` → no payment record created for that slot.
- **Guest display name**: Pulled from `match_guests.display_name` (no profile link).
- **Season scope**: Overview shows the active season by default. Season picker available if multiple seasons exist.

---

## 4. Data Model

### 4.1 New table: `match_payment_records`

```sql
CREATE TABLE match_payment_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       uuid NOT NULL REFERENCES matches(id),
  profile_id     uuid REFERENCES profiles(id),   -- null for guests
  guest_id       uuid REFERENCES match_guests(id), -- null for registered players
  amount_aed     integer NOT NULL DEFAULT 60,
  paid_at        timestamptz,                     -- null = unpaid
  marked_paid_by uuid REFERENCES profiles(id),   -- admin who recorded payment
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- exactly one of profile_id / guest_id must be set
  CONSTRAINT payment_record_one_subject
    CHECK (
      (profile_id IS NOT NULL AND guest_id IS NULL)
      OR
      (profile_id IS NULL AND guest_id IS NOT NULL)
    ),

  CONSTRAINT payment_record_unique_player
    UNIQUE (match_id, profile_id),               -- partial uniqueness handled by CHECK

  CONSTRAINT payment_record_unique_guest
    UNIQUE (match_id, guest_id)
);
```

> **Note:** The two UNIQUE constraints include NULLs in their columns, but in Postgres `UNIQUE` ignores NULLs, so two rows with `guest_id IS NULL` on the same match will not conflict via that constraint — the `profile_id` constraint catches duplicates for registered players, and the `guest_id` constraint catches duplicates for guests.

### 4.2 New table: `payment_windows`

```sql
CREATE TABLE payment_windows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    uuid NOT NULL UNIQUE REFERENCES matches(id),
  opened_at   timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz,          -- null = open
  closed_by   uuid REFERENCES profiles(id), -- null if auto-closed
  auto_closed boolean NOT NULL DEFAULT false
);
```

### 4.3 New app_settings row

```sql
INSERT INTO app_settings (key, value, description)
VALUES (
  'payment_fee_aed',
  '{"amount": 60}'::jsonb,
  'Default match fee in AED. Change here to update fee for new records going forward.'
);
```

### 4.4 RLS policies

```sql
-- match_payment_records: all authenticated users can read; no direct writes (go through RPCs)
ALTER TABLE match_payment_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all" ON match_payment_records
  FOR SELECT TO authenticated USING (true);

-- payment_windows: all authenticated users can read
ALTER TABLE payment_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all" ON payment_windows
  FOR SELECT TO authenticated USING (true);
```

---

## 5. RPC Contracts

All admin RPCs: `SECURITY DEFINER`, `search_path = public`, `REVOKE EXECUTE FROM PUBLIC`, `GRANT EXECUTE TO authenticated`, `is_admin()` body guard.

### 5.1 `open_match_payment_window(p_match_id uuid) → void`

**Called by:** trigger on `matches` AFTER UPDATE OF `approved_at` (NULL→NOT NULL transition).  
**Behaviour:**
1. Read `app_settings.payment_fee_aed.amount` (default 60 if missing).
2. Insert `payment_windows` row for `p_match_id` (`opened_at = now()`). `ON CONFLICT DO NOTHING` (idempotent).
3. For each `match_players` row where `match_id = p_match_id AND is_no_show = false`:
   - `match_players` already tracks both registered players (`profile_id` set, `guest_id` null) and guests (`guest_id` set, `profile_id` null). No separate `match_guests` query needed.
   - Insert `match_payment_records (match_id, profile_id, guest_id, amount_aed)`. `ON CONFLICT DO NOTHING`.
4. No return value.

**Security:** `SECURITY DEFINER`. Called from a trigger (no auth.uid context); does not call `is_admin()`. The trigger itself is the guard (only fires on approved_at transition).

### 5.2 `mark_payment_paid(p_match_id uuid, p_profile_id uuid) → void`

**Called by:** admin tapping "Mark paid ✓" on a registered player row.  
**Behaviour:**
1. `is_admin()` guard (raises `42501` if not admin).
2. Check `payment_windows` for `p_match_id`: raise `42501` ("Window closed — use override to reopen") if `closed_at IS NOT NULL`.
3. `UPDATE match_payment_records SET paid_at = now(), marked_paid_by = current_profile_id() WHERE match_id = p_match_id AND profile_id = p_profile_id AND paid_at IS NULL`.
4. After update, check auto-close (see §6).

### 5.3 `mark_guest_payment_paid(p_match_id uuid, p_guest_id uuid) → void`

Same as `mark_payment_paid` but targets `guest_id` column.

### 5.4 `close_payment_window(p_match_id uuid) → void`

**Called by:** admin tapping "🔒 Close M# window".  
**Behaviour:**
1. `is_admin()` guard.
2. `UPDATE payment_windows SET closed_at = now(), closed_by = current_profile_id(), auto_closed = false WHERE match_id = p_match_id AND closed_at IS NULL`.
3. Raise notice if already closed (not an error — idempotent).

### 5.5 `reopen_payment_window(p_match_id uuid) → void`

**Called by:** admin tapping "↩ Override — reopen window".  
**Behaviour:**
1. `is_admin()` guard.
2. `UPDATE payment_windows SET closed_at = NULL, closed_by = NULL, auto_closed = false WHERE match_id = p_match_id`.

### 5.6 `get_season_payment_summary(p_season_id uuid) → TABLE`

**Called by:** `/payments` season overview screen load.  
**Accessible to:** all authenticated users (no admin guard).  
**Returns one row per player/guest who appeared in at least one match this season:**

```
profile_id        uuid
guest_id          uuid
display_name      text
avatar_url        text   (null for guests)
matches_played    integer
matches_paid      integer
total_owed_aed    integer
total_paid_aed    integer
outstanding_aed   integer   (total_owed - total_paid)
```

**Logic:** JOIN `match_payment_records` → `matches` (filter `season_id = p_season_id`) → LEFT JOIN `profiles` (for registered players) and `match_guests` (for guests, via `match_guests.id = match_payment_records.guest_id`). Aggregate per subject (profile_id OR guest_id). Guest `display_name` from `match_guests.display_name`; registered player name from `profiles.display_name`.

### 5.7 `get_player_payment_ledger(p_profile_id uuid DEFAULT NULL, p_guest_id uuid DEFAULT NULL, p_season_id uuid) → TABLE`

**Called by:** player ledger sheet on tapping a player card (registered player) or a guest card.  
**Accessible to:** all authenticated users.  
**Exactly one of `p_profile_id` / `p_guest_id` must be non-null** (raises exception otherwise).  
**Returns one row per match the player/guest appeared in this season:**

```
match_id          uuid
match_number      integer    (derived: row_number() over season ordered by kickoff_at)
kickoff_at        timestamptz
amount_aed        integer
paid_at           timestamptz   (null = unpaid)
window_open       boolean       (payment_windows.closed_at IS NULL)
```

---

## 6. Auto-Close Trigger

```sql
-- AFTER UPDATE OF paid_at ON match_payment_records
-- Fires once per row update.
-- If all records for that match_id now have paid_at IS NOT NULL → auto-close.
CREATE OR REPLACE FUNCTION auto_close_payment_window_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM match_payment_records
    WHERE match_id = NEW.match_id AND paid_at IS NULL
  ) THEN
    UPDATE payment_windows
    SET closed_at = now(), auto_closed = true
    WHERE match_id = NEW.match_id AND closed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_close_payment_window
  AFTER UPDATE OF paid_at ON match_payment_records
  FOR EACH ROW EXECUTE FUNCTION auto_close_payment_window_trigger();
```

---

## 7. Match Approval Trigger

Hooks into existing `matches.approved_at` transition to open the payment window automatically.

```sql
CREATE OR REPLACE FUNCTION on_match_approved_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.approved_at IS NULL AND NEW.approved_at IS NOT NULL THEN
    PERFORM open_match_payment_window(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_match_approved
  AFTER UPDATE OF approved_at ON matches
  FOR EACH ROW EXECUTE FUNCTION on_match_approved_trigger();
```

---

## 8. Frontend

### 8.1 Entry point

`AppDrawer.tsx` — new row **"💰 Payments"** visible to all authenticated users (admin + players), navigates to `/payments`.

### 8.2 Route

`/payments` added to `router.tsx` inside `RoleLayout` children, same pattern as `/awards`.

### 8.3 Screen: `Payments.tsx`

**Brand token class:** `.py-screen`  
**12-token brand block** at `.py-screen` scope root (same palette as other screens: `--bg:#0e1826`, `--accent:#e5ba5b`, etc.)

**Sections:**
1. **Season picker** — defaults to active season. Dropdown if multiple seasons exist (same pattern as Awards screen).
2. **Summary strip** — 3 boxes: Collected (green) · Owed (red) · Total (muted). Amounts in AED.
3. **Open window banner** — shown when any match has an open payment window: `⏳ Match N collection open · close before next match`. Red-tinted. Hidden when all windows are closed. Note: there is no automatic time-based close — the banner is a reminder only. Window closes when admin closes it manually or all players are marked paid.
4. **Player card list** — one card per player/guest, sorted by `outstanding_aed DESC` (highest debtors first), then alphabetically. Card shows: avatar · name · `X of Y matches` · balance amount (green ✓ 0 / gold partial / red −N AED).
5. **No data state** — "No matches played this season yet." if zero records.

**On player card tap** → opens `PaymentLedgerSheet` (bottom sheet).

### 8.4 Component: `PaymentLedgerSheet.tsx`

**Props:** `profileId?: string`, `guestId?: string`, `displayName: string`, `seasonId: string`, `isAdmin: boolean`, `onClose: () => void`  
Exactly one of `profileId` / `guestId` is provided. `mark_payment_paid` or `mark_guest_payment_paid` is called accordingly.

**Sections:**
1. **Summary strip** — Paid · Owed · Matches count.
2. **Match history list** — one row per match, newest first.

**Row anatomy:**
- Row background: `rgba(79,191,147,.07)` if paid · `rgba(230,51,73,.08)` if unpaid.
- Leading ✓ (green) or ✕ (red) icon.
- Match badge (M1, M2…) + fee amount + date + window status (`Open` / `Closed`).
- **"Mark paid ✓" button** — shown only if `isAdmin && window_open && !paid_at`. Calls `mark_payment_paid` or `mark_guest_payment_paid`. Optimistic update: row flips to paid immediately, reverts on error.
- Closed window rows for admin: "Mark paid ✓" button is hidden (window closed).

3. **Season balance total bar** — `−N AED` in red or `✓ 0` in green.
4. **Admin controls strip** (admin only):
   - `🔒 Close M# window` — visible when the latest match has an open window. Calls `close_payment_window`.
   - `↩ Override — reopen window` — visible when the latest match window is closed. Calls `reopen_payment_window`.

### 8.5 Fee config

Admin can update `payment_fee_aed` via a new row in the Admin Settings section (future — out of scope for this slice). For now, fee is changed directly via `app_settings` table. New payment records always read the current `app_settings.payment_fee_aed.amount` at the time the match is approved.

---

## 9. Migration

**File:** `supabase/migrations/0055_payment_tracker.sql`

**Contents (in order):**
1. `CREATE TABLE match_payment_records` + constraints + RLS.
2. `CREATE TABLE payment_windows` + RLS.
3. `INSERT INTO app_settings` for `payment_fee_aed`.
4. `open_match_payment_window` function.
5. `mark_payment_paid` function + REVOKE + GRANT.
6. `mark_guest_payment_paid` function + REVOKE + GRANT.
7. `close_payment_window` function + REVOKE + GRANT.
8. `reopen_payment_window` function + REVOKE + GRANT.
9. `get_season_payment_summary` function (no REVOKE — public read).
10. `get_player_payment_ledger` function (no REVOKE — public read).
11. `auto_close_payment_window_trigger` function + trigger.
12. `on_match_approved_trigger` function + trigger.
13. `ALTER PUBLICATION supabase_realtime ADD TABLE match_payment_records` — so the ledger sheet can subscribe to live paid_at updates.
14. `ALTER PUBLICATION supabase_realtime ADD TABLE payment_windows` — so the open/closed banner updates in real time.

---

## 10. Realtime

Both tables added to `supabase_realtime` publication (§9 above).

- `Payments.tsx` subscribes to `match_payment_records` INSERT/UPDATE filtered by `season_id` (via join — use `match_id=in.(...)` filter built from season's match IDs). On change: refetch summary.
- `PaymentLedgerSheet.tsx` subscribes to `match_payment_records` UPDATE filtered by `profile_id = <current player>`. On change: flip the row optimistically confirmed.
- `PaymentLedgerSheet.tsx` subscribes to `payment_windows` UPDATE filtered by relevant `match_id`s. On change: update `window_open` per row.

---

## 11. Non-Goals

- Online payment processing (Stripe, Apple Pay, etc.) — this is a tracking tool only.
- Payment reminders / push notifications — out of scope for this slice.
- Partial payment amounts — fee is always the full 60 AED per match (no partial tracking).
- Editing the fee per individual player — fee is uniform.
- Admin settings UI for changing the fee — future slice. For now, update via DB directly.
- Historical backfill for matches approved before this migration — payment records are only auto-created for future approvals.
