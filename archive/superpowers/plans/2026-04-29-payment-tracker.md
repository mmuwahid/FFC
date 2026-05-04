# Payment Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-match payment tracker (60 AED fee, configurable) so the admin can record who has paid after each approved match, with full transparency for all players.

**Architecture:** DB migration creates two tables (`match_payment_records`, `payment_windows`) and eight RPCs. Debts auto-created on match approval via trigger. Frontend adds `/payments` page (season overview) + `PaymentLedgerSheet` bottom sheet (per-player drill-down). Entry via AppDrawer. Realtime subscriptions keep both screens live.

**Tech Stack:** React 19, TypeScript, Supabase (Postgres + RLS + realtime), Vite, existing FFC brand token system.

**Quality gates (no test framework in project):** `node ./node_modules/typescript/bin/tsc -b` + `node ./node_modules/vite/bin/vite.js build` must exit 0 after every task.

**Reference spec:** `docs/superpowers/specs/2026-04-29-payment-tracker-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/0055_payment_tracker.sql` | All DB objects |
| Regen | `ffc/src/lib/database.types.ts` | Updated types after migration |
| Create | `ffc/src/pages/Payments.tsx` | Season overview screen |
| Create | `ffc/src/pages/PaymentLedgerSheet.tsx` | Per-player ledger bottom sheet |
| Modify | `ffc/src/index.css` | Add `.py-screen` brand token block + component CSS |
| Modify | `ffc/src/router.tsx` | Add `/payments` route |
| Modify | `ffc/src/components/AppDrawer.tsx` | Add 💰 Payments drawer row |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/0055_payment_tracker.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/0055_payment_tracker.sql

-- ── 1. match_payment_records ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_payment_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       uuid NOT NULL REFERENCES matches(id),
  profile_id     uuid REFERENCES profiles(id),
  guest_id       uuid REFERENCES match_guests(id),
  amount_aed     integer NOT NULL DEFAULT 60,
  paid_at        timestamptz,
  marked_paid_by uuid REFERENCES profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_record_one_subject CHECK (
    (profile_id IS NOT NULL AND guest_id IS NULL)
    OR
    (profile_id IS NULL     AND guest_id IS NOT NULL)
  )
);

-- Partial unique indexes handle nullable uniqueness correctly in Postgres
CREATE UNIQUE INDEX IF NOT EXISTS payment_record_unique_player
  ON match_payment_records (match_id, profile_id) WHERE profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_record_unique_guest
  ON match_payment_records (match_id, guest_id)   WHERE guest_id  IS NOT NULL;

ALTER TABLE match_payment_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all" ON match_payment_records
  FOR SELECT TO authenticated USING (true);

-- ── 2. payment_windows ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_windows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    uuid NOT NULL UNIQUE REFERENCES matches(id),
  opened_at   timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz,
  closed_by   uuid REFERENCES profiles(id),
  auto_closed boolean NOT NULL DEFAULT false
);

ALTER TABLE payment_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all" ON payment_windows
  FOR SELECT TO authenticated USING (true);

-- ── 3. app_settings fee row ──────────────────────────────────────────────────
INSERT INTO app_settings (key, value, description)
VALUES (
  'payment_fee_aed',
  '{"amount": 60}'::jsonb,
  'Default match fee in AED. Change value.amount to update fee for future match approvals.'
) ON CONFLICT (key) DO NOTHING;

-- ── 4. open_match_payment_window ─────────────────────────────────────────────
-- Called by trigger on approved_at transition. NOT admin-guarded (no auth.uid in trigger).
CREATE OR REPLACE FUNCTION open_match_payment_window(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fee integer;
BEGIN
  SELECT COALESCE((value->>'amount')::integer, 60)
  INTO v_fee
  FROM app_settings
  WHERE key = 'payment_fee_aed';

  IF v_fee IS NULL THEN v_fee := 60; END IF;

  -- Idempotent window open
  INSERT INTO payment_windows (match_id, opened_at)
  VALUES (p_match_id, now())
  ON CONFLICT (match_id) DO NOTHING;

  -- match_players has both registered players (profile_id set) and guests (guest_id set)
  INSERT INTO match_payment_records (match_id, profile_id, guest_id, amount_aed)
  SELECT p_match_id, mp.profile_id, mp.guest_id, v_fee
  FROM match_players mp
  WHERE mp.match_id = p_match_id
    AND (mp.is_no_show IS NULL OR mp.is_no_show = false)
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION open_match_payment_window(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION open_match_payment_window(uuid) TO authenticated;

-- ── 5. mark_payment_paid ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mark_payment_paid(p_match_id uuid, p_profile_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM payment_windows
    WHERE match_id = p_match_id AND closed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Window closed — use override to reopen' USING ERRCODE = '42501';
  END IF;
  UPDATE match_payment_records
  SET paid_at = now(), marked_paid_by = current_profile_id()
  WHERE match_id = p_match_id AND profile_id = p_profile_id AND paid_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION mark_payment_paid(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION mark_payment_paid(uuid, uuid) TO authenticated;

-- ── 6. mark_guest_payment_paid ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mark_guest_payment_paid(p_match_id uuid, p_guest_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM payment_windows
    WHERE match_id = p_match_id AND closed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Window closed — use override to reopen' USING ERRCODE = '42501';
  END IF;
  UPDATE match_payment_records
  SET paid_at = now(), marked_paid_by = current_profile_id()
  WHERE match_id = p_match_id AND guest_id = p_guest_id AND paid_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION mark_guest_payment_paid(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION mark_guest_payment_paid(uuid, uuid) TO authenticated;

-- ── 7. close_payment_window ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION close_payment_window(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  UPDATE payment_windows
  SET closed_at = now(), closed_by = current_profile_id(), auto_closed = false
  WHERE match_id = p_match_id AND closed_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION close_payment_window(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION close_payment_window(uuid) TO authenticated;

-- ── 8. reopen_payment_window ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reopen_payment_window(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  UPDATE payment_windows
  SET closed_at = NULL, closed_by = NULL, auto_closed = false
  WHERE match_id = p_match_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION reopen_payment_window(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION reopen_payment_window(uuid) TO authenticated;

-- ── 9. get_season_payment_summary ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_season_payment_summary(p_season_id uuid)
RETURNS TABLE (
  profile_id      uuid,
  guest_id        uuid,
  display_name    text,
  avatar_url      text,
  matches_played  integer,
  matches_paid    integer,
  total_owed_aed  integer,
  total_paid_aed  integer,
  outstanding_aed integer
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.profile_id,
    r.guest_id,
    COALESCE(p.display_name, g.display_name)                                         AS display_name,
    p.avatar_url,
    COUNT(r.id)::integer                                                              AS matches_played,
    COUNT(r.paid_at)::integer                                                         AS matches_paid,
    SUM(r.amount_aed)::integer                                                        AS total_owed_aed,
    COALESCE(SUM(r.amount_aed) FILTER (WHERE r.paid_at IS NOT NULL), 0)::integer      AS total_paid_aed,
    (SUM(r.amount_aed)
      - COALESCE(SUM(r.amount_aed) FILTER (WHERE r.paid_at IS NOT NULL), 0))::integer AS outstanding_aed
  FROM match_payment_records r
  JOIN matches m     ON m.id  = r.match_id
  LEFT JOIN profiles p       ON p.id  = r.profile_id
  LEFT JOIN match_guests g   ON g.id  = r.guest_id
  WHERE m.season_id = p_season_id
  GROUP BY r.profile_id, r.guest_id, p.display_name, g.display_name, p.avatar_url
  ORDER BY outstanding_aed DESC, display_name ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_season_payment_summary(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_season_payment_summary(uuid) TO authenticated;

-- ── 10. get_player_payment_ledger ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_player_payment_ledger(
  p_profile_id uuid DEFAULT NULL,
  p_guest_id   uuid DEFAULT NULL,
  p_season_id  uuid DEFAULT NULL
)
RETURNS TABLE (
  match_id      uuid,
  match_number  integer,
  kickoff_at    timestamptz,
  amount_aed    integer,
  paid_at       timestamptz,
  window_open   boolean
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (p_profile_id IS NULL) = (p_guest_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_profile_id or p_guest_id must be provided';
  END IF;

  RETURN QUERY
  SELECT
    r.match_id,
    ROW_NUMBER() OVER (ORDER BY m.kickoff_at)::integer AS match_number,
    m.kickoff_at,
    r.amount_aed,
    r.paid_at,
    (pw.closed_at IS NULL)                             AS window_open
  FROM match_payment_records r
  JOIN matches m             ON m.id        = r.match_id
  LEFT JOIN payment_windows pw ON pw.match_id = r.match_id
  WHERE (p_season_id IS NULL OR m.season_id = p_season_id)
    AND (
      (p_profile_id IS NOT NULL AND r.profile_id = p_profile_id)
      OR
      (p_guest_id   IS NOT NULL AND r.guest_id   = p_guest_id)
    )
  ORDER BY m.kickoff_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_player_payment_ledger(uuid, uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_player_payment_ledger(uuid, uuid, uuid) TO authenticated;

-- ── 11. auto-close trigger ────────────────────────────────────────────────────
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

-- ── 12. match approval trigger ────────────────────────────────────────────────
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

-- ── 13. Realtime ──────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE match_payment_records;
ALTER PUBLICATION supabase_realtime ADD TABLE payment_windows;
```

- [ ] **Step 2: Apply migration**

```bash
cd ffc
npx supabase db push --linked
```

Expected: `Applied migration 0055_payment_tracker`  
If error `already in publication`: the `ALTER PUBLICATION` is idempotent in newer Supabase — safe to ignore.

- [ ] **Step 3: Verify tables and RPCs exist**

```bash
npx supabase db query --linked "SELECT table_name FROM information_schema.tables WHERE table_name IN ('match_payment_records','payment_windows') ORDER BY 1;" 2>/dev/null
```

Expected output includes both table names.

```bash
npx supabase db query --linked "SELECT routine_name FROM information_schema.routines WHERE routine_name LIKE '%payment%' ORDER BY 1;" 2>/dev/null
```

Expected: 8 rows — `auto_close_payment_window_trigger`, `close_payment_window`, `get_player_payment_ledger`, `get_season_payment_summary`, `mark_guest_payment_paid`, `mark_payment_paid`, `on_match_approved_trigger`, `open_match_payment_window`, `reopen_payment_window`.

- [ ] **Step 4: Commit migration**

```bash
cd ..
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  add supabase/migrations/0055_payment_tracker.sql
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  commit -m "feat(s056): migration 0055 — payment tracker tables + RPCs + triggers"
```

---

## Task 2: TypeScript Types Regen

**Files:**
- Modify: `ffc/src/lib/database.types.ts`

- [ ] **Step 1: Regenerate types**

```bash
cd ffc
npx supabase gen types typescript --linked 2>/dev/null > src/lib/database.types.ts
```

- [ ] **Step 2: Verify the new RPCs appear in the generated file**

```bash
grep -n "payment" src/lib/database.types.ts | head -20
```

Expected: lines for `get_season_payment_summary`, `get_player_payment_ledger`, `mark_payment_paid`, `mark_guest_payment_paid`, `close_payment_window`, `reopen_payment_window`.

- [ ] **Step 3: Verify tsc still passes**

```bash
node ./node_modules/typescript/bin/tsc -b
```

Expected: exit 0, zero output.

- [ ] **Step 4: Commit**

```bash
cd ..
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  add ffc/src/lib/database.types.ts
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  commit -m "chore(s056): regen types after migration 0055"
```

---

## Task 3: Skeleton + Route + Drawer Entry

**Files:**
- Create: `ffc/src/pages/Payments.tsx`
- Modify: `ffc/src/router.tsx` (add `/payments` route)
- Modify: `ffc/src/components/AppDrawer.tsx` (add 💰 Payments row)

Goal: get the route wired and reachable with a placeholder render, passing `tsc -b`.

- [ ] **Step 1: Create `ffc/src/pages/Payments.tsx` skeleton**

```tsx
// ffc/src/pages/Payments.tsx
export default function Payments() {
  return (
    <div className="py-screen">
      <p>Payments loading…</p>
    </div>
  )
}
```

- [ ] **Step 2: Add route to `ffc/src/router.tsx`**

Add the import after the Awards import line:

```tsx
import Payments from './pages/Payments'
```

Add the route inside the `RoleLayout` children array, after the `awards` route:

```tsx
{ path: 'payments', element: <Payments /> },
```

- [ ] **Step 3: Add 💰 Payments row to `ffc/src/components/AppDrawer.tsx`**

Add this button inside `<nav className="app-drawer-nav">`, after the Settings button and before the `{isAdmin && ...}` admin block:

```tsx
<button
  type="button"
  className="app-drawer-item"
  onClick={() => go('/payments')}
>
  <span className="app-drawer-item-ico" aria-hidden>💰</span>
  <span className="app-drawer-item-label">Payments</span>
  <span className="app-drawer-chevron" aria-hidden>›</span>
</button>
```

- [ ] **Step 4: Verify tsc passes**

```bash
cd ffc
node ./node_modules/typescript/bin/tsc -b
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
cd ..
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  add ffc/src/pages/Payments.tsx ffc/src/router.tsx ffc/src/components/AppDrawer.tsx
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  commit -m "feat(s056): payments route + drawer entry (skeleton)"
```

---

## Task 4: Season Overview — Data Loading + Player Cards

**Files:**
- Modify: `ffc/src/pages/Payments.tsx` (full implementation)
- Modify: `ffc/src/index.css` (add `.py-screen` CSS block)

- [ ] **Step 1: Replace `Payments.tsx` with full implementation**

```tsx
// ffc/src/pages/Payments.tsx
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import PaymentLedgerSheet from './PaymentLedgerSheet'

interface SeasonRow {
  id: string
  name: string
  starts_on: string
  ended_at: string | null
}

interface SummaryRow {
  profile_id: string | null
  guest_id: string | null
  display_name: string | null
  avatar_url: string | null
  matches_played: number
  matches_paid: number
  total_owed_aed: number
  total_paid_aed: number
  outstanding_aed: number
}

interface OpenWindow {
  match_id: string
}

interface SheetTarget {
  profileId?: string
  guestId?: string
  displayName: string
}

export default function Payments() {
  const { profile } = useApp()
  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'
  const [searchParams] = useSearchParams()
  const seasonIdParam = searchParams.get('season_id')

  const [seasons, setSeasons] = useState<SeasonRow[]>([])
  const [season, setSeason] = useState<SeasonRow | null>(null)
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [openWindow, setOpenWindow] = useState<OpenWindow | null>(null)
  const [loading, setLoading] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sheetTarget, setSheetTarget] = useState<SheetTarget | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)

      const { data: allSeasons } = await supabase
        .from('seasons')
        .select('id, name, starts_on, ended_at')
        .order('starts_on', { ascending: false })
        .returns<SeasonRow[]>()
      if (cancelled) return

      const target = (() => {
        if (!allSeasons?.length) return null
        if (seasonIdParam) return allSeasons.find(s => s.id === seasonIdParam) ?? null
        return allSeasons.find(s => s.ended_at == null) ?? allSeasons[0]
      })()

      setSeasons(allSeasons ?? [])
      setSeason(target)

      if (!target) { setLoading(false); return }

      const [{ data: rows }, { data: approvedMatches }] = await Promise.all([
        supabase.rpc('get_season_payment_summary', { p_season_id: target.id })
          .returns<SummaryRow[]>(),
        supabase
          .from('matches')
          .select('id')
          .eq('season_id', target.id)
          .not('approved_at', 'is', null),
      ])
      if (cancelled) return

      setSummary(rows ?? [])

      // Find the single open collection window for this season (if any)
      const matchIds = (approvedMatches ?? []).map(m => m.id)
      if (matchIds.length) {
        const { data: win } = await supabase
          .from('payment_windows')
          .select('match_id')
          .in('match_id', matchIds)
          .is('closed_at', null)
          .limit(1)
          .maybeSingle()
        if (!cancelled) setOpenWindow(win ?? null)
      }

      if (!cancelled) setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [seasonIdParam])

  const totalOwed   = summary.reduce((s, r) => s + r.total_owed_aed, 0)
  const totalPaid   = summary.reduce((s, r) => s + r.total_paid_aed, 0)
  const outstanding = totalOwed - totalPaid

  function initials(name: string | null) {
    if (!name) return '?'
    return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('')
  }

  function balanceLabel(row: SummaryRow) {
    if (row.outstanding_aed === 0) return '✓ 0'
    return `−${row.outstanding_aed}`
  }

  function balanceClass(row: SummaryRow) {
    if (row.outstanding_aed === 0) return 'py-balance--paid'
    if (row.outstanding_aed < row.total_owed_aed) return 'py-balance--partial'
    return 'py-balance--owed'
  }

  return (
    <div className="py-screen">
      {/* Header */}
      <div className="py-header">
        <span className="py-header-title">💰 Payments</span>
        {seasons.length > 1 && (
          <button
            type="button"
            className="py-season-pill"
            onClick={() => setPickerOpen(p => !p)}
          >
            {season?.name ?? '—'} ▾
          </button>
        )}
        {seasons.length === 1 && (
          <span className="py-season-pill py-season-pill--static">{season?.name ?? '—'}</span>
        )}
      </div>

      {/* Season picker dropdown */}
      {pickerOpen && (
        <div className="py-picker-overlay" onClick={() => setPickerOpen(false)}>
          <div className="py-picker" onClick={e => e.stopPropagation()}>
            {seasons.map(s => (
              <button
                key={s.id}
                type="button"
                className={`py-picker-item${s.id === season?.id ? ' py-picker-item--active' : ''}`}
                onClick={() => { setSeason(s); setPickerOpen(false) }}
              >
                {s.name}{s.ended_at ? '' : ' · Active'}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-loading">Loading…</div>
      ) : (
        <>
          {/* Summary strip */}
          <div className="py-summary">
            <div className="py-sbox">
              <div className="py-sbox-amt py-sbox-amt--paid">{totalPaid.toLocaleString()}</div>
              <div className="py-sbox-lbl">Collected</div>
            </div>
            <div className="py-sbox">
              <div className="py-sbox-amt py-sbox-amt--owed">{outstanding.toLocaleString()}</div>
              <div className="py-sbox-lbl">Owed</div>
            </div>
            <div className="py-sbox">
              <div className="py-sbox-amt py-sbox-amt--total">{totalOwed.toLocaleString()}</div>
              <div className="py-sbox-lbl">Total</div>
            </div>
          </div>

          {/* Open collection window banner */}
          {openWindow && (
            <div className="py-banner py-banner--open">
              <span className="py-banner-icon">⏳</span>
              <span className="py-banner-text">Collection open · close before next match</span>
            </div>
          )}

          {/* No-data state */}
          {summary.length === 0 ? (
            <div className="py-empty">No matches played this season yet.</div>
          ) : (
            <div className="py-list">
              {summary.map(row => {
                const key = row.profile_id ?? row.guest_id ?? row.display_name ?? 'unknown'
                return (
                  <button
                    key={key}
                    type="button"
                    className="py-card"
                    onClick={() => setSheetTarget({
                      profileId: row.profile_id ?? undefined,
                      guestId:   row.guest_id   ?? undefined,
                      displayName: row.display_name ?? 'Unknown',
                    })}
                  >
                    <div className="py-avatar">
                      {row.avatar_url
                        ? <img src={row.avatar_url} alt="" />
                        : <span>{initials(row.display_name)}</span>}
                    </div>
                    <div className="py-card-info">
                      <div className="py-card-name">{row.display_name ?? 'Unknown'}</div>
                      <div className="py-card-meta">
                        {row.matches_paid} of {row.matches_played} matches
                        {row.guest_id ? ' · Guest' : ''}
                      </div>
                    </div>
                    <div className="py-balance">
                      <div className={`py-balance-amt ${balanceClass(row)}`}>
                        {balanceLabel(row)}
                      </div>
                      <div className="py-balance-lbl">AED</div>
                    </div>
                    <span className="py-card-chevron" aria-hidden>›</span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Player ledger sheet */}
      {sheetTarget && season && (
        <PaymentLedgerSheet
          profileId={sheetTarget.profileId}
          guestId={sheetTarget.guestId}
          displayName={sheetTarget.displayName}
          seasonId={season.id}
          isAdmin={isAdmin}
          onClose={() => setSheetTarget(null)}
          onPaymentMarked={() => {
            // Reload summary after a payment is marked
            setSheetTarget(null)
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add CSS block to `ffc/src/index.css`**

Append to the very end of `ffc/src/index.css`:

```css
/* ── Payments screen (.py-screen) ── S056 ────────────────────────────────── */
.py-screen {
  --bg: #0e1826;
  --surface: rgba(255, 255, 255, 0.04);
  --text: #f2ead6;
  --accent: #e5ba5b;
  --danger: #e63349;
  --success: #4fbf93;
  --warn: #e5ba5b;
  --muted: #8a9bb0;

  background: var(--bg);
  min-height: 100svh;
  padding: 16px 16px calc(env(safe-area-inset-bottom) + 80px);
  color: var(--text);
  font-family: inherit;
}

.py-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.py-header-title {
  font-size: 1rem;
  font-weight: 800;
  color: var(--text);
}

.py-season-pill {
  background: rgba(229, 186, 91, 0.1);
  border: 1px solid rgba(229, 186, 91, 0.3);
  border-radius: 20px;
  padding: 4px 12px;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--accent);
  cursor: pointer;
}

.py-season-pill--static {
  cursor: default;
}

/* Season picker */
.py-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
}

.py-picker {
  position: absolute;
  top: 48px;
  right: 16px;
  background: #162030;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  overflow: hidden;
  min-width: 160px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}

.py-picker-item {
  display: block;
  width: 100%;
  padding: 10px 16px;
  text-align: left;
  font-size: 0.8rem;
  color: var(--muted);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
  background: transparent;
  border-left: none;
  border-right: none;
  border-top: none;
}

.py-picker-item--active {
  color: var(--accent);
  font-weight: 700;
}

.py-picker-item:last-child {
  border-bottom: none;
}

/* Summary strip */
.py-summary {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.py-sbox {
  flex: 1;
  background: rgba(229, 186, 91, 0.07);
  border: 1px solid rgba(229, 186, 91, 0.15);
  border-radius: 10px;
  padding: 8px;
  text-align: center;
}

.py-sbox-amt {
  font-size: 0.95rem;
  font-weight: 800;
  line-height: 1;
}

.py-sbox-amt--paid  { color: var(--success); }
.py-sbox-amt--owed  { color: var(--danger); }
.py-sbox-amt--total { color: var(--muted); }

.py-sbox-lbl {
  font-size: 0.55rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  margin-top: 3px;
}

/* Banners */
.py-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 10px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 0.72rem;
  line-height: 1.4;
}

.py-banner--open {
  background: rgba(230, 51, 73, 0.1);
  border: 1px solid rgba(230, 51, 73, 0.25);
  color: var(--text);
}

.py-banner--open .py-banner-icon { font-size: 1rem; }

.py-banner--closed {
  background: rgba(79, 191, 147, 0.07);
  border: 1px solid rgba(79, 191, 147, 0.2);
  color: var(--muted);
}

.py-banner-icon { flex-shrink: 0; }

/* Player cards */
.py-list { display: flex; flex-direction: column; gap: 6px; }

.py-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--surface);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 10px 12px;
  cursor: pointer;
  text-align: left;
  width: 100%;
  color: var(--text);
}

.py-card:active { background: rgba(255, 255, 255, 0.07); }

.py-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #1e3a5f;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--accent);
  flex-shrink: 0;
  overflow: hidden;
}

.py-avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }

.py-card-info { flex: 1; min-width: 0; }
.py-card-name { font-size: 0.8rem; font-weight: 700; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.py-card-meta { font-size: 0.62rem; color: var(--muted); margin-top: 2px; }

.py-balance { text-align: right; flex-shrink: 0; }
.py-balance-amt { font-size: 0.9rem; font-weight: 800; }
.py-balance-amt--paid    { color: var(--success); }
.py-balance-amt--partial { color: var(--warn); }
.py-balance-amt--owed    { color: var(--danger); }
.py-balance-lbl { font-size: 0.5rem; text-transform: uppercase; color: var(--muted); margin-top: 1px; }

.py-card-chevron { font-size: 1rem; color: var(--muted); margin-left: 2px; }

.py-loading { text-align: center; color: var(--muted); padding: 40px 0; font-size: 0.85rem; }
.py-empty   { text-align: center; color: var(--muted); padding: 40px 0; font-size: 0.85rem; }

/* ── PaymentLedgerSheet ──────────────────────────────────────────────────── */
.py-sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 100;
}

.py-sheet {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  z-index: 101;
  background: #131f2e;
  border-radius: 20px 20px 0 0;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding: 0 0 calc(env(safe-area-inset-bottom) + 16px);
  max-height: 85svh;
  display: flex;
  flex-direction: column;
}

.py-sheet-handle {
  width: 36px; height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  margin: 12px auto 0;
  flex-shrink: 0;
}

.py-sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 8px;
  flex-shrink: 0;
}

.py-sheet-name { font-size: 0.9rem; font-weight: 800; color: var(--text); }

.py-sheet-close {
  width: 28px; height: 28px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  display: flex; align-items: center; justify-content: center;
  font-size: 0.7rem; color: var(--muted);
  cursor: pointer;
  border: none;
}

.py-sheet-summary {
  display: flex;
  gap: 6px;
  padding: 0 16px 10px;
  flex-shrink: 0;
}

/* Ledger rows */
.py-ledger { overflow-y: auto; flex: 1; padding: 0 16px; }

.py-ledger-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px;
  border-radius: 8px;
  margin-bottom: 4px;
}

.py-ledger-row--paid   { background: rgba(79, 191, 147, 0.07); }
.py-ledger-row--unpaid { background: rgba(230, 51, 73, 0.08); }

.py-row-icon { font-size: 0.8rem; flex-shrink: 0; width: 16px; text-align: center; }
.py-row-icon--paid   { color: var(--success); }
.py-row-icon--unpaid { color: var(--danger); }

.py-match-badge {
  background: rgba(229, 186, 91, 0.12);
  border: 1px solid rgba(229, 186, 91, 0.2);
  border-radius: 5px;
  padding: 2px 6px;
  font-size: 0.58rem;
  font-weight: 700;
  color: var(--accent);
  flex-shrink: 0;
}

.py-row-info { flex: 1; min-width: 0; }
.py-row-fee  { font-size: 0.68rem; font-weight: 700; color: var(--text); }
.py-row-date { font-size: 0.55rem; color: var(--muted); margin-top: 1px; }

.py-mark-btn {
  background: rgba(229, 186, 91, 0.12);
  border: 1px solid rgba(229, 186, 91, 0.3);
  border-radius: 7px;
  padding: 4px 8px;
  font-size: 0.58rem;
  font-weight: 700;
  color: var(--accent);
  cursor: pointer;
  flex-shrink: 0;
  white-space: nowrap;
}

.py-mark-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Total bar */
.py-total-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  padding: 10px 14px;
  margin: 8px 16px;
  flex-shrink: 0;
}

.py-total-lbl { font-size: 0.72rem; color: var(--muted); }
.py-total-val { font-size: 1rem; font-weight: 800; }
.py-total-val--zero { color: var(--success); }
.py-total-val--owed { color: var(--danger); }

/* Admin controls */
.py-admin-strip {
  display: flex;
  gap: 8px;
  padding: 0 16px 4px;
  flex-shrink: 0;
}

.py-admin-btn {
  flex: 1;
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 0.65rem;
  font-weight: 700;
  text-align: center;
  cursor: pointer;
}

.py-admin-btn--close {
  background: rgba(230, 51, 73, 0.1);
  border: 1px solid rgba(230, 51, 73, 0.3);
  color: var(--danger);
}

.py-admin-btn--reopen {
  background: rgba(229, 186, 91, 0.1);
  border: 1px solid rgba(229, 186, 91, 0.3);
  color: var(--accent);
}
```

- [ ] **Step 3: Verify build**

```bash
cd ffc
node ./node_modules/typescript/bin/tsc -b && node ./node_modules/vite/bin/vite.js build
```

Expected: both exit 0. If `PaymentLedgerSheet` not found error, create the stub in the next task first then re-run.

- [ ] **Step 4: Commit**

```bash
cd ..
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  add ffc/src/pages/Payments.tsx ffc/src/index.css
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  commit -m "feat(s056): payments season overview screen + CSS"
```

---

## Task 5: PaymentLedgerSheet — Read-only View

**Files:**
- Create: `ffc/src/pages/PaymentLedgerSheet.tsx`

- [ ] **Step 1: Create `ffc/src/pages/PaymentLedgerSheet.tsx`**

```tsx
// ffc/src/pages/PaymentLedgerSheet.tsx
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'

interface LedgerRow {
  match_id: string
  match_number: number
  kickoff_at: string
  amount_aed: number
  paid_at: string | null
  window_open: boolean
}

interface Props {
  profileId?: string
  guestId?: string
  displayName: string
  seasonId: string
  isAdmin: boolean
  onClose: () => void
  onPaymentMarked: () => void
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('T')[0].split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d} ${months[parseInt(m, 10) - 1]} ${y}`
}

export default function PaymentLedgerSheet({
  profileId, guestId, displayName, seasonId, isAdmin, onClose, onPaymentMarked,
}: Props) {
  const [rows, setRows]       = useState<LedgerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<string | null>(null)  // match_id being marked
  const [error, setError]     = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const args = {
        p_season_id:  seasonId,
        p_profile_id: profileId ?? null,
        p_guest_id:   guestId   ?? null,
      }
      const { data } = await supabase
        .rpc('get_player_payment_ledger', args)
        .returns<LedgerRow[]>()
      if (!cancelled) {
        setRows(data ?? [])
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [profileId, guestId, seasonId])

  // Close on ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const totalPaid  = rows.reduce((s, r) => s + (r.paid_at ? r.amount_aed : 0), 0)
  const totalOwed  = rows.reduce((s, r) => s + r.amount_aed, 0)
  const outstanding = totalOwed - totalPaid

  // Latest row (rows are newest-first from the RPC)
  const latestRow = rows[0] ?? null

  async function handleMarkPaid(row: LedgerRow) {
    setBusy(row.match_id)
    setError(null)
    // Optimistic update
    setRows(prev => prev.map(r =>
      r.match_id === row.match_id ? { ...r, paid_at: new Date().toISOString() } : r
    ))
    const rpcName = profileId ? 'mark_payment_paid' : 'mark_guest_payment_paid'
    const args = profileId
      ? { p_match_id: row.match_id, p_profile_id: profileId }
      : { p_match_id: row.match_id, p_guest_id: guestId! }
    const { error: rpcErr } = await supabase.rpc(rpcName, args as Record<string, string>)
    if (rpcErr) {
      // Revert optimistic update
      setRows(prev => prev.map(r =>
        r.match_id === row.match_id ? { ...r, paid_at: null } : r
      ))
      setError(rpcErr.message)
    } else {
      onPaymentMarked()
    }
    setBusy(null)
  }

  async function handleCloseWindow(matchId: string) {
    setBusy(matchId)
    setError(null)
    const { error: rpcErr } = await supabase.rpc('close_payment_window', { p_match_id: matchId })
    if (rpcErr) { setError(rpcErr.message) }
    else {
      setRows(prev => prev.map(r =>
        r.match_id === matchId ? { ...r, window_open: false } : r
      ))
    }
    setBusy(null)
  }

  async function handleReopenWindow(matchId: string) {
    setBusy(matchId)
    setError(null)
    const { error: rpcErr } = await supabase.rpc('reopen_payment_window', { p_match_id: matchId })
    if (rpcErr) { setError(rpcErr.message) }
    else {
      setRows(prev => prev.map(r =>
        r.match_id === matchId ? { ...r, window_open: true } : r
      ))
    }
    setBusy(null)
  }

  return createPortal(
    <>
      <button
        type="button"
        className="py-sheet-backdrop"
        onClick={onClose}
        aria-label="Close"
      />
      <div
        className="py-sheet"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${displayName} payment ledger`}
      >
        <div className="py-sheet-handle" />

        <div className="py-sheet-header">
          <span className="py-sheet-name">{displayName}</span>
          <button type="button" className="py-sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Summary strip */}
        <div className="py-sheet-summary">
          <div className="py-sbox">
            <div className="py-sbox-amt py-sbox-amt--paid">{totalPaid}</div>
            <div className="py-sbox-lbl">Paid</div>
          </div>
          <div className="py-sbox">
            <div className="py-sbox-amt py-sbox-amt--owed">{outstanding}</div>
            <div className="py-sbox-lbl">Owed</div>
          </div>
          <div className="py-sbox">
            <div className="py-sbox-amt py-sbox-amt--total">{rows.length}</div>
            <div className="py-sbox-lbl">Matches</div>
          </div>
        </div>

        {/* Match history */}
        <div className="py-ledger">
          {loading ? (
            <div className="py-loading">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-empty">No payment records.</div>
          ) : (
            rows.map(row => {
              const isPaid = row.paid_at != null
              const canMark = isAdmin && !isPaid && row.window_open && busy !== row.match_id
              return (
                <div
                  key={row.match_id}
                  className={`py-ledger-row ${isPaid ? 'py-ledger-row--paid' : 'py-ledger-row--unpaid'}`}
                >
                  <span className={`py-row-icon ${isPaid ? 'py-row-icon--paid' : 'py-row-icon--unpaid'}`}>
                    {isPaid ? '✓' : '✕'}
                  </span>
                  <span className="py-match-badge">M{row.match_number}</span>
                  <div className="py-row-info">
                    <div className="py-row-fee">{row.amount_aed} AED</div>
                    <div className="py-row-date">
                      {fmtDate(row.kickoff_at)} · {row.window_open ? 'Open' : 'Closed'}
                    </div>
                  </div>
                  {canMark && (
                    <button
                      type="button"
                      className="py-mark-btn"
                      onClick={() => handleMarkPaid(row)}
                      disabled={busy !== null}
                    >
                      Mark paid ✓
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Season total */}
        {!loading && rows.length > 0 && (
          <div className="py-total-bar">
            <span className="py-total-lbl">Season balance</span>
            <span className={`py-total-val ${outstanding === 0 ? 'py-total-val--zero' : 'py-total-val--owed'}`}>
              {outstanding === 0 ? '✓ 0 AED' : `−${outstanding} AED`}
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: '0 16px 8px', color: 'var(--danger)', fontSize: '0.7rem' }}>
            {error}
          </div>
        )}

        {/* Admin close/reopen strip */}
        {isAdmin && !loading && latestRow && (
          <div className="py-admin-strip">
            {latestRow.window_open ? (
              <button
                type="button"
                className="py-admin-btn py-admin-btn--close"
                disabled={busy !== null}
                onClick={() => handleCloseWindow(latestRow.match_id)}
              >
                🔒 Close M{latestRow.match_number} window
              </button>
            ) : (
              <button
                type="button"
                className="py-admin-btn py-admin-btn--reopen"
                disabled={busy !== null}
                onClick={() => handleReopenWindow(latestRow.match_id)}
              >
                ↩ Override — reopen window
              </button>
            )}
          </div>
        )}
      </div>
    </>,
    document.body,
  )
}
```

- [ ] **Step 2: Verify build**

```bash
cd ffc
node ./node_modules/typescript/bin/tsc -b && node ./node_modules/vite/bin/vite.js build
```

Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
cd ..
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  add ffc/src/pages/PaymentLedgerSheet.tsx
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  commit -m "feat(s056): PaymentLedgerSheet with mark-paid + admin close/reopen"
```

---

## Task 6: Realtime Subscriptions

**Files:**
- Modify: `ffc/src/pages/Payments.tsx`
- Modify: `ffc/src/pages/PaymentLedgerSheet.tsx`

Keep the season overview and ledger sheet live when payments are marked or windows change.

- [ ] **Step 1: Add realtime subscription to `Payments.tsx`**

In `Payments.tsx`, add a second `useEffect` after the data-loading one. This subscribes to `match_payment_records` changes and refetches the summary:

```tsx
// Add this import at the top if not already present:
// import { useCallback } from 'react'

// Replace the load useEffect with a useCallback version so realtime can call it:
// (1) Extract the inner load logic into a useCallback
// (2) Call it from a second useEffect that sets up the realtime sub

// Inside the Payments component, replace the existing useEffect with:

const loadSummary = useCallback(async (targetSeasonId: string) => {
  const [{ data: rows }, { data: approvedMatches }] = await Promise.all([
    supabase.rpc('get_season_payment_summary', { p_season_id: targetSeasonId })
      .returns<SummaryRow[]>(),
    supabase.from('matches').select('id').eq('season_id', targetSeasonId).not('approved_at', 'is', null),
  ])
  setSummary(rows ?? [])
  const matchIds = (approvedMatches ?? []).map((m: { id: string }) => m.id)
  if (matchIds.length) {
    const { data: win } = await supabase
      .from('payment_windows').select('match_id')
      .in('match_id', matchIds).is('closed_at', null).limit(1).maybeSingle()
    setOpenWindow(win ?? null)
  } else {
    setOpenWindow(null)
  }
}, [])

// Initial load effect:
useEffect(() => {
  let cancelled = false
  async function boot() {
    setLoading(true)
    const { data: allSeasons } = await supabase
      .from('seasons').select('id, name, starts_on, ended_at')
      .order('starts_on', { ascending: false }).returns<SeasonRow[]>()
    if (cancelled) return
    const target = (() => {
      if (!allSeasons?.length) return null
      if (seasonIdParam) return allSeasons.find(s => s.id === seasonIdParam) ?? null
      return allSeasons.find(s => s.ended_at == null) ?? allSeasons[0]
    })()
    setSeasons(allSeasons ?? [])
    setSeason(target)
    if (target) await loadSummary(target.id)
    if (!cancelled) setLoading(false)
  }
  boot()
  return () => { cancelled = true }
}, [seasonIdParam, loadSummary])

// Realtime subscription effect:
useEffect(() => {
  if (!season) return
  const channel = supabase
    .channel(`payments-season-${season.id}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'match_payment_records',
    }, () => { loadSummary(season.id) })
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'payment_windows',
    }, () => { loadSummary(season.id) })
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}, [season, loadSummary])
```

> **Important:** The above is a replacement/refactor of the single `useEffect` block. Re-read `Payments.tsx` as written in Task 4, then apply the following:
> - Add `useCallback` to the import line.
> - Replace the single `useEffect` with the three blocks above (`loadSummary`, initial load effect, realtime effect).
> - The `loadSummary` callback and both effects go inside the component body, before the `totalOwed` derivation line.

- [ ] **Step 2: Add realtime subscription to `PaymentLedgerSheet.tsx`**

In `PaymentLedgerSheet.tsx`, after the existing load `useEffect`, add:

```tsx
useEffect(() => {
  const channel = supabase
    .channel(`ledger-${profileId ?? guestId}`)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'match_payment_records',
      filter: profileId ? `profile_id=eq.${profileId}` : `guest_id=eq.${guestId}`,
    }, (payload) => {
      const updated = payload.new as { match_id: string; paid_at: string | null }
      setRows(prev => prev.map(r =>
        r.match_id === updated.match_id ? { ...r, paid_at: updated.paid_at } : r
      ))
    })
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'payment_windows',
    }, (payload) => {
      const updated = payload.new as { match_id: string; closed_at: string | null }
      setRows(prev => prev.map(r =>
        r.match_id === updated.match_id ? { ...r, window_open: updated.closed_at == null } : r
      ))
    })
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}, [profileId, guestId])
```

Add this block inside `PaymentLedgerSheet`, after the existing `useEffect` that loads data.

- [ ] **Step 3: Verify build**

```bash
cd ffc
node ./node_modules/typescript/bin/tsc -b && node ./node_modules/vite/bin/vite.js build
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
cd ..
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  add ffc/src/pages/Payments.tsx ffc/src/pages/PaymentLedgerSheet.tsx
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  commit -m "feat(s056): realtime subscriptions for payments screens"
```

---

## Task 7: Final Verification + Push

- [ ] **Step 1: Full clean build**

```bash
cd ffc
node ./node_modules/typescript/bin/tsc -b && node ./node_modules/vite/bin/vite.js build
```

Expected: exit 0. Check PWA precache entry count is ≥ 12 (should be unchanged; payments is a JS-bundle addition, not a new precached asset).

- [ ] **Step 2: Smoke check — navigate to /payments**

Start the dev server: `node ./node_modules/vite/bin/vite.js`. Open `http://localhost:5173/payments` in the browser (must be logged in). Verify:
- Page renders without console errors.
- Season pill shows the active season name.
- If any matches have been approved, player cards appear.
- AppDrawer 💰 Payments row navigates to `/payments`.

- [ ] **Step 3: Push to main**

```bash
cd ..
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  push origin main
```

Expected: fast-forward push succeeds. Vercel auto-deploys from `main`.

- [ ] **Step 4: Verify Vercel deployment**

Check https://ffc-gilt.vercel.app/payments loads without error after deploy completes (usually ~60s). Open AppDrawer → 💰 Payments should be visible.

---

## Self-Review Notes

**Spec coverage:**
- §3 Rules: fee=60 AED from app_settings ✓ · who owes = match_players (no-show excluded) ✓ · transparency = RLS read_all ✓ · mark paid = admin only ✓ · window auto-close = trigger ✓ · manual close = `close_payment_window` ✓ · override = `reopen_payment_window` ✓
- §4 Data model: both tables, partial unique indexes, RLS ✓
- §5 RPC contracts: all 7 RPCs present ✓
- §6 Auto-close trigger ✓
- §7 Approval trigger ✓
- §8 Frontend: Payments.tsx + PaymentLedgerSheet.tsx + AppDrawer entry + router ✓
- §9 Migration numbering 0055 ✓
- §10 Realtime: both tables in publication + frontend subs ✓
- §11 Non-goals: not attempted ✓

**Type consistency check:**
- `SummaryRow` fields in Payments.tsx match the RPC return columns in migration ✓
- `LedgerRow` fields in PaymentLedgerSheet.tsx match `get_player_payment_ledger` return columns ✓
- `handleMarkPaid` calls `mark_payment_paid` or `mark_guest_payment_paid` — both defined in migration ✓
- `handleCloseWindow` calls `close_payment_window` ✓
- `handleReopenWindow` calls `reopen_payment_window` ✓
- `fmtDate` splits ISO string — consistent with `DATE columns need string-split` lesson in CLAUDE.md ✓
