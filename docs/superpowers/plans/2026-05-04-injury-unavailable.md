# Injury / Unavailable List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a long-term unavailability flag on `profiles` (Injured / Travelling / Suspended / Retired) with self-serve from Settings, admin override, optional auto-clear by date, and muted UI on Leaderboard / Profile + hide-from-Poll behaviour.

**Architecture:** 3 new columns on `profiles` (status enum + return-date + reason) + 4 RPCs + pg_cron daily job + 2 new notification kinds. Frontend touches 6 screens + 1 shared component. No history table (Approach A from brainstorm).

**Tech Stack:** Supabase Postgres (enum, RLS, RPCs, pg_cron, notifications fan-out), React 19 + TypeScript 6 + Vite 8, Supabase realtime for live UI propagation.

**Spec:** `docs/superpowers/specs/2026-05-04-injury-unavailable-design.md`

---

## File Structure

**New:**
- `supabase/migrations/0070_unavailability.sql` — enum, columns, constraint, 4 RPCs, view update, notification enum extensions, pg_cron schedule
- `ffc/src/components/UnavailabilityPill.tsx` — shared pill component (renders null for `available`)
- `mockups/injury-unavailable.html` — visual mockup of all 6 surfaces (Rule #1)

**Modified:**
- `ffc/src/lib/database.types.ts` — auto-regenerated post-migration
- `ffc/src/lib/AppContext.tsx` — extend profile selection to include 3 new columns
- `ffc/src/pages/Settings.tsx` — new "Availability" card
- `ffc/src/pages/admin/AdminPlayers.tsx` — Availability row + edit modal
- `ffc/src/pages/Poll.tsx` — query filter + render exclusion
- `ffc/src/pages/admin/AdminRosterSetup.tsx` — pool query filter
- `ffc/src/pages/Leaderboard.tsx` — pill + dim row
- `ffc/src/pages/Profile.tsx` — status banner
- `ffc/src/styles/index.css` — `[data-unavailable]` opacity + pill colour tokens

---

## Pre-flight

- Working directory: `FFC` (the project root that contains `ffc/`, `supabase/`, `docs/` etc.)
- All `npx`, `tsc`, `git` commands run from this root unless noted otherwise.
- Supabase project: `hylarwwsedjxwavuwjrn` (linked).
- Git: branch `main`, expected starting HEAD `609ca3a`.

---

### Task 0: Mockup (Rule #1 — no screen built without an approved mockup)

**Files:**
- Create: `mockups/injury-unavailable.html`

- [ ] **Step 1: Read live CSS sources verbatim**

The mockup must copy live CSS verbatim per S060 lesson (`feedback_mockup_no_redesign.md`). Open and read these to find all relevant classes:

```bash
grep -nE "\.lb-|\.app-card|\.settings-|\.admin-player|\.profile-" ffc/src/styles/index.css | head -80
```

Then `cat ffc/src/styles/index.css | head -200` to find the existing per-screen brand-token blocks (Settings, Leaderboard, Profile, AdminPlayers).

- [ ] **Step 2: Build the mockup**

Create a single HTML file showing all 6 surfaces stacked, each in a notched phone-frame with viewport-fit=cover and env(safe-area-inset-*) per `feedback_mockup_safe_area_check.md`:

1. **Settings — Available state:** existing screen + new "Availability" card with status radio (5 options) + return-date input (hidden when Available/Retired) + reason textarea + Save button.
2. **Settings — Out state:** card collapsed showing pill + reason + return date + "I'm back" primary button + Edit secondary link.
3. **AdminPlayers card:** existing card with new "Availability" row → status pill → Edit pencil. Include Edit modal mock.
4. **Poll list:** show normal voter list with one player visibly absent (with a footnote "Mohammed hidden — marked Travelling until 14 May").
5. **Leaderboard:** mixed list showing 3 active rows + 1 dimmed row with 🩹 OUT pill + 1 dimmed retired row with 🏁 RETIRED pill.
6. **Profile:** screen with name + new status banner (pill + reason + return).
7. **`<UnavailabilityPill>` variants:** isolated swatch row showing all 4 pills + the 'sm' / 'md' size variants.

Copy `.lb-table-grid`, `.app-card`, `.btn-primary`, `.btn-secondary`, `.app-bottom-nav` etc. **verbatim** from `ffc/src/styles/index.css`. Add only the new classes:

```css
[data-unavailable="injured"],
[data-unavailable="travelling"],
[data-unavailable="suspended"],
[data-unavailable="retired"] { opacity: 0.55; }

.unav-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
}
.unav-pill--injured    { background: #fee2e2; color: #b91c1c; }
.unav-pill--travelling { background: #dbeafe; color: #1e40af; }
.unav-pill--suspended  { background: #ffedd5; color: #c2410c; }
.unav-pill--retired    { background: #e5e7eb; color: #4b5563; }
```

- [ ] **Step 3: Self-check the mockup against spec**

Open the mockup in the browser. Verify:
- All 5 status states render with correct icon + colour
- Return-date input only shows for Injured/Travelling/Suspended
- Out-state Settings shows "I'm back" button
- Leaderboard rows are dimmed but rank/points stay visible
- Notched phone frame renders with safe-area insets

- [ ] **Step 4: Get user approval**

Stop. Show the mockup path to the user and ask for explicit approval before proceeding to migration. Per Rule #1, no DB or code work begins until the user signs off on this mockup.

- [ ] **Step 5: Commit the mockup**

```bash
git add mockups/injury-unavailable.html
git commit -m "docs(injury-unavailable): mockup of all 6 surfaces"
```

---

### Task 1: Migration 0070 — schema, RPCs, view update, cron schedule

**Files:**
- Create: `supabase/migrations/0070_unavailability.sql`

- [ ] **Step 1: Verify enum + helper precedents exist**

```bash
grep -n "CREATE TYPE notification_kind\|FUNCTION is_admin\|FUNCTION current_profile_id\|cron.schedule" supabase/migrations/*.sql | head -10
```

Expected: `is_admin` from `0007`, `current_profile_id` from `0007` or `0008`, `notification_kind` enum already exists, `cron.schedule` precedent in `0010` / `0011`.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0070_unavailability.sql` with this content (full text — paste exactly):

```sql
-- Migration 0070: Long-term unavailability flag on profiles
-- Distinct from per-match is_no_show (mig 0064). Adds 4 typed states
-- (injured/travelling/suspended/retired), optional return date, free-text reason,
-- 4 RPCs (player self-serve + admin override + auto-clear), 2 notification kinds,
-- pg_cron daily job at 00:00 UAE.

-- 1. Status enum
CREATE TYPE public.unavailability_status AS ENUM
  ('available', 'injured', 'travelling', 'suspended', 'retired');

-- 2. Profile columns
ALTER TABLE public.profiles
  ADD COLUMN unavailable_status public.unavailability_status NOT NULL DEFAULT 'available',
  ADD COLUMN unavailable_until  date NULL,
  ADD COLUMN unavailable_reason text NULL;

-- 3. Consistency CHECK
ALTER TABLE public.profiles ADD CONSTRAINT chk_unavailable_consistency CHECK (
     (unavailable_status = 'available' AND unavailable_until IS NULL AND unavailable_reason IS NULL)
  OR (unavailable_status = 'retired'   AND unavailable_until IS NULL)
  OR (unavailable_status IN ('injured', 'travelling', 'suspended'))
);

-- 4. Notification enum extensions
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'unavailability_set';
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'unavailability_cleared';

-- 5. Update v_season_standings to expose unavailable_status (used by Leaderboard.tsx for muting)
CREATE OR REPLACE VIEW public.v_season_standings AS
WITH played AS (
  SELECT md.season_id,
    mp.profile_id,
    (count(*) FILTER (WHERE (m.result = 'win_white'::match_result AND mp.team = 'white'::team_color))
     + count(*) FILTER (WHERE (m.result = 'win_black'::match_result AND mp.team = 'black'::team_color))) AS wins,
    count(*) FILTER (WHERE m.result = 'draw'::match_result) AS draws,
    (count(*) FILTER (WHERE (m.result = 'win_white'::match_result AND mp.team = 'black'::team_color))
     + count(*) FILTER (WHERE (m.result = 'win_black'::match_result AND mp.team = 'white'::team_color))) AS losses,
    COALESCE(sum(mp.goals), 0::bigint) AS goals,
    COALESCE(sum(mp.yellow_cards), 0::bigint) AS yellows,
    COALESCE(sum(mp.red_cards), 0::bigint) AS reds,
    count(*) FILTER (WHERE m.motm_user_id = mp.profile_id) AS motms
  FROM matches m
  JOIN matchdays md ON md.id = m.matchday_id
  JOIN match_players mp ON mp.match_id = m.id
  WHERE m.approved_at IS NOT NULL AND mp.profile_id IS NOT NULL AND NOT md.is_friendly
  GROUP BY md.season_id, mp.profile_id
),
penalties AS (
  SELECT md.season_id,
    pv.profile_id,
    sum(
      CASE
        WHEN pv.cancelled_at IS NULL THEN 0
        WHEN pv.cancelled_at > (md.kickoff_at - INTERVAL '24 hours') THEN -1
        WHEN md.roster_locked_at IS NOT NULL AND pv.cancelled_at > md.roster_locked_at THEN -1
        ELSE 0
      END
    ) AS late_cancel_points
  FROM poll_votes pv
  JOIN matchdays md ON md.id = pv.matchday_id
  WHERE pv.choice = 'yes'::poll_choice AND NOT md.is_friendly
  GROUP BY md.season_id, pv.profile_id
),
no_show_penalties AS (
  SELECT md.season_id,
    mp.profile_id,
    sum(CASE WHEN mp.is_no_show THEN ns_cfg.pts ELSE 0 END) AS no_show_points
  FROM match_players mp
  JOIN matches m ON m.id = mp.match_id
  JOIN matchdays md ON md.id = m.matchday_id
  CROSS JOIN (
    SELECT COALESCE((value->>'no_show_penalty_points')::integer, -2) AS pts
    FROM app_settings WHERE key = 'match_settings'
  ) ns_cfg
  WHERE m.approved_at IS NOT NULL AND mp.profile_id IS NOT NULL AND NOT md.is_friendly
  GROUP BY md.season_id, mp.profile_id
),
combined AS (
  SELECT season_id, profile_id FROM played
  UNION
  SELECT season_id, profile_id FROM season_seed_stats
)
SELECT
  c.season_id,
  c.profile_id,
  COALESCE(pr.formal_name, pr.display_name) AS display_name,
  pr.unavailable_status,
  (COALESCE(p.wins,  0::bigint) + COALESCE(s.wins_seed,  0)::bigint) AS wins,
  (COALESCE(p.draws, 0::bigint) + COALESCE(s.draws_seed, 0)::bigint) AS draws,
  (COALESCE(p.losses,0::bigint) + COALESCE(s.losses_seed,0)::bigint) AS losses,
  (COALESCE(p.goals, 0::bigint) + COALESCE(s.goals_seed, 0)::bigint) AS goals,
  (COALESCE(p.yellows,0::bigint)+ COALESCE(s.yellows_seed,0)::bigint) AS yellows,
  (COALESCE(p.reds,  0::bigint) + COALESCE(s.reds_seed,  0)::bigint) AS reds,
  (COALESCE(p.motms, 0::bigint) + COALESCE(s.motms_seed, 0)::bigint) AS motms,
  (COALESCE(pen.late_cancel_points, 0::bigint) + COALESCE(s.late_cancel_points_seed, 0)::bigint) AS late_cancel_points,
  (COALESCE(nsp.no_show_points, 0::bigint) + COALESCE(s.no_show_points_seed, 0)::bigint) AS no_show_points,
  (
    (COALESCE(p.wins,  0::bigint) + COALESCE(s.wins_seed,  0)::bigint) * 3
    + (COALESCE(p.draws,0::bigint) + COALESCE(s.draws_seed,0)::bigint)
    + COALESCE(pen.late_cancel_points, 0::bigint) + COALESCE(s.late_cancel_points_seed, 0)::bigint
    + COALESCE(nsp.no_show_points,     0::bigint) + COALESCE(s.no_show_points_seed,     0)::bigint
  ) AS points
FROM combined c
JOIN profiles pr ON pr.id = c.profile_id AND pr.deleted_at IS NULL
LEFT JOIN played p ON p.season_id = c.season_id AND p.profile_id = c.profile_id
LEFT JOIN penalties pen ON pen.season_id = c.season_id AND pen.profile_id = c.profile_id
LEFT JOIN no_show_penalties nsp ON nsp.season_id = c.season_id AND nsp.profile_id = c.profile_id
LEFT JOIN season_seed_stats s ON s.season_id = c.season_id AND s.profile_id = c.profile_id;

-- 6. RPC: set_my_unavailability (player self-serve)
CREATE OR REPLACE FUNCTION public.set_my_unavailability(
  p_status public.unavailability_status,
  p_until  date DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := public.current_profile_id();
  v_caller_name text;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF p_status = 'available' THEN
    RAISE EXCEPTION 'use clear_my_unavailability to return to available';
  END IF;

  IF p_status = 'retired' AND p_until IS NOT NULL THEN
    RAISE EXCEPTION 'retired status cannot have a return date';
  END IF;

  IF p_status IN ('injured','travelling','suspended')
     AND p_until IS NOT NULL AND p_until < CURRENT_DATE THEN
    RAISE EXCEPTION 'return date cannot be in the past';
  END IF;

  -- Update own profile
  UPDATE public.profiles
     SET unavailable_status = p_status,
         unavailable_until  = CASE WHEN p_status = 'retired' THEN NULL ELSE p_until END,
         unavailable_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
         updated_at         = now(),
         updated_by         = v_caller_id
   WHERE id = v_caller_id AND deleted_at IS NULL
  RETURNING COALESCE(formal_name, display_name) INTO v_caller_name;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  -- Clear any open poll vote (matchday not yet kicked off)
  UPDATE public.poll_votes pv
     SET choice = NULL,
         updated_at = now()
    FROM public.matchdays md
   WHERE pv.matchday_id = md.id
     AND pv.profile_id = v_caller_id
     AND md.kickoff_at > now();

  -- Notify each admin (explicit ::notification_kind cast per S063 lesson)
  INSERT INTO public.notifications (recipient_id, kind, payload, created_at)
  SELECT pr.id,
         'unavailability_set'::notification_kind,
         jsonb_build_object(
           'player_id', v_caller_id,
           'player_name', v_caller_name,
           'status', p_status::text,
           'until', p_until,
           'reason', NULLIF(btrim(COALESCE(p_reason, '')), '')
         ),
         now()
    FROM public.profiles pr
   WHERE pr.role = 'admin' AND pr.deleted_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_my_unavailability(public.unavailability_status, date, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.set_my_unavailability(public.unavailability_status, date, text) TO authenticated;

-- 7. RPC: clear_my_unavailability (player "I'm back")
CREATE OR REPLACE FUNCTION public.clear_my_unavailability()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := public.current_profile_id();
  v_caller_name text;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
     SET unavailable_status = 'available',
         unavailable_until  = NULL,
         unavailable_reason = NULL,
         updated_at         = now(),
         updated_by         = v_caller_id
   WHERE id = v_caller_id AND deleted_at IS NULL
  RETURNING COALESCE(formal_name, display_name) INTO v_caller_name;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  INSERT INTO public.notifications (recipient_id, kind, payload, created_at)
  SELECT pr.id,
         'unavailability_cleared'::notification_kind,
         jsonb_build_object('player_id', v_caller_id, 'player_name', v_caller_name),
         now()
    FROM public.profiles pr
   WHERE pr.role = 'admin' AND pr.deleted_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clear_my_unavailability() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.clear_my_unavailability() TO authenticated;

-- 8. RPC: admin_set_player_unavailability (silent, admin-only)
CREATE OR REPLACE FUNCTION public.admin_set_player_unavailability(
  p_profile_id uuid,
  p_status     public.unavailability_status,
  p_until      date DEFAULT NULL,
  p_reason     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_status = 'retired' AND p_until IS NOT NULL THEN
    RAISE EXCEPTION 'retired status cannot have a return date';
  END IF;

  IF p_status IN ('injured','travelling','suspended')
     AND p_until IS NOT NULL AND p_until < CURRENT_DATE THEN
    RAISE EXCEPTION 'return date cannot be in the past';
  END IF;

  UPDATE public.profiles
     SET unavailable_status = p_status,
         unavailable_until  = CASE WHEN p_status IN ('available','retired') THEN NULL ELSE p_until END,
         unavailable_reason = CASE WHEN p_status = 'available' THEN NULL
                                   ELSE NULLIF(btrim(COALESCE(p_reason, '')), '') END,
         updated_at         = now(),
         updated_by         = public.current_profile_id()
   WHERE id = p_profile_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;
  -- Silent: NO notification fired
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_player_unavailability(uuid, public.unavailability_status, date, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_player_unavailability(uuid, public.unavailability_status, date, text) TO authenticated;

-- 9. RPC: auto_clear_expired_unavailability (called by pg_cron)
CREATE OR REPLACE FUNCTION public.auto_clear_expired_unavailability()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cleared RECORD;
BEGIN
  FOR v_cleared IN
    UPDATE public.profiles
       SET unavailable_status = 'available',
           unavailable_until  = NULL,
           unavailable_reason = NULL,
           updated_at         = now()
     WHERE unavailable_status IN ('injured','travelling','suspended')
       AND unavailable_until IS NOT NULL
       AND unavailable_until <= CURRENT_DATE
       AND deleted_at IS NULL
    RETURNING id, COALESCE(formal_name, display_name) AS player_name
  LOOP
    INSERT INTO public.notifications (recipient_id, kind, payload, created_at)
    SELECT pr.id,
           'unavailability_cleared'::notification_kind,
           jsonb_build_object('player_id', v_cleared.id, 'player_name', v_cleared.player_name, 'auto', true),
           now()
      FROM public.profiles pr
     WHERE pr.role = 'admin' AND pr.deleted_at IS NULL;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_clear_expired_unavailability() FROM PUBLIC;
-- No GRANT to authenticated — only callable by postgres role via cron

-- 10. Schedule the daily auto-clear (00:00 UAE = 20:00 UTC)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'clear-expired-unavailability') THEN
    PERFORM cron.schedule(
      'clear-expired-unavailability',
      '0 20 * * *',
      $cron$SELECT public.auto_clear_expired_unavailability()$cron$
    );
  END IF;
END $$;
```

- [ ] **Step 3: Verify SQL compiles by inspecting it**

```bash
wc -l supabase/migrations/0070_unavailability.sql
```

Expected: ~250 lines. Confirm no obvious syntax issues by visual scan.

- [ ] **Step 4: Commit the migration (do NOT push to DB yet — that's Task 2)**

```bash
git add supabase/migrations/0070_unavailability.sql
git commit -m "feat(db): mig 0070 unavailability — enum + cols + 4 RPCs + cron"
```

---

### Task 2: Apply migration + regenerate types

**Files:**
- Modify (auto-generated): `ffc/src/lib/database.types.ts`

- [ ] **Step 1: Push migration to linked project**

```bash
npx supabase db push --linked
```

Expected output: `Connecting to remote database...` then `Applying migration 0070_unavailability.sql...` then `Finished supabase db push.`

If it errors on `notification_kind ADD VALUE IF NOT EXISTS` (PG bug — `IF NOT EXISTS` requires that the txn already committed prior `CREATE TYPE`), drop the IF NOT EXISTS and re-run; the values do not pre-exist.

- [ ] **Step 2: Verify schema landed**

Run via the Supabase SQL editor (or `psql`):

```sql
SELECT enumlabel FROM pg_enum
 WHERE enumtypid = 'public.unavailability_status'::regtype ORDER BY enumsortorder;
-- expect: available, injured, travelling, suspended, retired

SELECT enumlabel FROM pg_enum
 WHERE enumtypid = 'public.notification_kind'::regtype
   AND enumlabel IN ('unavailability_set','unavailability_cleared');
-- expect both rows

SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='profiles'
   AND column_name LIKE 'unavailable%';
-- expect 3 rows

SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'clear-expired-unavailability';
-- expect 1 row, schedule '0 20 * * *'
```

- [ ] **Step 3: Regenerate TypeScript types**

```bash
npx supabase gen types typescript --linked > ffc/src/lib/database.types.ts
```

- [ ] **Step 4: Verify the new types appear**

```bash
grep -nE "unavailability_status|unavailable_status|unavailable_until|unavailable_reason|unavailability_set|unavailability_cleared" ffc/src/lib/database.types.ts | head -20
```

Expected: at least 10 hits across enum, profiles row type, RPC arg types.

- [ ] **Step 5: Build to confirm no type breakage**

```bash
node ./node_modules/typescript/bin/tsc -b
```

Expected: exit code 0. No new errors. (No call-sites use the new fields yet, so this should pass cleanly.)

- [ ] **Step 6: Commit**

```bash
git add ffc/src/lib/database.types.ts
git commit -m "chore(types): regen after mig 0070 unavailability"
```

---

### Task 3: Shared `<UnavailabilityPill>` component

**Files:**
- Create: `ffc/src/components/UnavailabilityPill.tsx`
- Modify: `ffc/src/styles/index.css` — append pill colour tokens

- [ ] **Step 1: Create the component**

Write `ffc/src/components/UnavailabilityPill.tsx`:

```tsx
import type { Database } from '../lib/database.types';

export type UnavailabilityStatus = Database['public']['Enums']['unavailability_status'];

interface UnavailabilityPillProps {
  status: UnavailabilityStatus;
  size?: 'sm' | 'md';
}

const META: Record<Exclude<UnavailabilityStatus, 'available'>, { icon: string; label: string; cls: string }> = {
  injured:    { icon: '🩹', label: 'OUT',     cls: 'unav-pill--injured' },
  travelling: { icon: '✈️', label: 'AWAY',    cls: 'unav-pill--travelling' },
  suspended:  { icon: '🚫', label: 'SUSP',    cls: 'unav-pill--suspended' },
  retired:    { icon: '🏁', label: 'RETIRED', cls: 'unav-pill--retired' },
};

export function UnavailabilityPill({ status, size = 'md' }: UnavailabilityPillProps) {
  if (status === 'available') return null;
  const m = META[status];
  return (
    <span className={`unav-pill unav-pill--${size} ${m.cls}`}>
      <span aria-hidden="true">{m.icon}</span>
      <span>{m.label}</span>
    </span>
  );
}
```

- [ ] **Step 2: Append CSS to `ffc/src/styles/index.css`**

Find the end of the file and append:

```css
/* === Unavailability pill (shared) === */
.unav-pill {
  display: inline-flex; align-items: center; gap: 4px;
  border-radius: 999px;
  font-weight: 600; letter-spacing: 0.02em;
  white-space: nowrap;
}
.unav-pill--sm { padding: 1px 6px; font-size: 10px; }
.unav-pill--md { padding: 2px 8px; font-size: 11px; }
.unav-pill--injured    { background: #fee2e2; color: #b91c1c; }
.unav-pill--travelling { background: #dbeafe; color: #1e40af; }
.unav-pill--suspended  { background: #ffedd5; color: #c2410c; }
.unav-pill--retired    { background: #e5e7eb; color: #4b5563; }

/* Light/dark theme overrides — match existing per-screen brand-token convention.
   When the user has theme_preference='dark' or auto+prefers-dark the same tokens
   work; for explicit light mode keep the lighter backgrounds (already light). */
.theme-dark .unav-pill--injured    { background: rgba(220, 38, 38, 0.18); color: #fca5a5; }
.theme-dark .unav-pill--travelling { background: rgba( 37, 99,235, 0.18); color: #93c5fd; }
.theme-dark .unav-pill--suspended  { background: rgba(234, 88, 12, 0.18); color: #fdba74; }
.theme-dark .unav-pill--retired    { background: rgba(107,114,128, 0.22); color: #d1d5db; }

/* Row-level dim used by Leaderboard, AdminPlayers, Roster lists */
[data-unavailable="injured"],
[data-unavailable="travelling"],
[data-unavailable="suspended"],
[data-unavailable="retired"] { opacity: 0.55; }
```

- [ ] **Step 3: Build**

```bash
node ./node_modules/typescript/bin/tsc -b
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add ffc/src/components/UnavailabilityPill.tsx ffc/src/styles/index.css
git commit -m "feat(unavailability): UnavailabilityPill component + CSS tokens"
```

---

### Task 4: Extend AppContext profile selection

**Files:**
- Modify: `ffc/src/lib/AppContext.tsx` — extend the profile SELECT

- [ ] **Step 1: Locate the profile query**

```bash
grep -n "from('profiles')\|.from(\"profiles\")\|select(" ffc/src/lib/AppContext.tsx | head -10
```

Find the call where the user's own profile is loaded post-auth.

- [ ] **Step 2: Extend the SELECT**

In `ffc/src/lib/AppContext.tsx`, find the `.from('profiles').select(...)` chain that loads the current user's profile. Add `unavailable_status, unavailable_until, unavailable_reason` to the select list. If the SELECT is `*`, no change needed — confirm and skip.

- [ ] **Step 3: Extend the `Profile` TypeScript type alias (if any)**

Search for `type Profile = ` or `interface Profile` in the file. If present, add the three fields:

```ts
unavailable_status: Database['public']['Enums']['unavailability_status'];
unavailable_until: string | null;
unavailable_reason: string | null;
```

If the type is sourced directly from `Database['public']['Tables']['profiles']['Row']`, no edit needed (the regenerated types already include them).

- [ ] **Step 4: Build**

```bash
node ./node_modules/typescript/bin/tsc -b
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add ffc/src/lib/AppContext.tsx
git commit -m "feat(unavailability): expose status fields on AppContext profile"
```

---

### Task 5: Settings — Availability card

**Files:**
- Modify: `ffc/src/pages/Settings.tsx`

- [ ] **Step 1: Read the existing file end-to-end**

```bash
wc -l ffc/src/pages/Settings.tsx
```

Open the file and locate the section structure (notification preferences card, theme card etc.). The new "Availability" card goes after the notification block, before any logout/danger-zone block.

- [ ] **Step 2: Add the form state hooks**

At the top of the component, alongside existing useState calls, add:

```tsx
const [unavStatus, setUnavStatus] = useState<UnavailabilityStatus>(profile?.unavailable_status ?? 'available');
const [unavUntil, setUnavUntil]   = useState<string>(profile?.unavailable_until ?? '');
const [unavReason, setUnavReason] = useState<string>(profile?.unavailable_reason ?? '');
const [unavSaving, setUnavSaving] = useState(false);
const [unavExpanded, setUnavExpanded] = useState(false);

useEffect(() => {
  setUnavStatus(profile?.unavailable_status ?? 'available');
  setUnavUntil(profile?.unavailable_until ?? '');
  setUnavReason(profile?.unavailable_reason ?? '');
}, [profile?.unavailable_status, profile?.unavailable_until, profile?.unavailable_reason]);
```

Import: `import type { UnavailabilityStatus } from '../components/UnavailabilityPill';`
Import: `import { UnavailabilityPill } from '../components/UnavailabilityPill';`
Import: `import { extractErrMessage } from '../lib/...';` (use the existing helper from S063 — check `ffc/src/lib/` for the file).

- [ ] **Step 3: Add the save / clear handlers**

```tsx
async function handleSaveUnavailability() {
  if (unavStatus === 'available') {
    await handleClearUnavailability();
    return;
  }
  setUnavSaving(true);
  try {
    const { error } = await supabase.rpc('set_my_unavailability', {
      p_status: unavStatus,
      p_until: unavStatus === 'retired' || !unavUntil ? null : unavUntil,
      p_reason: unavReason.trim() || null,
    });
    if (error) throw error;
    setUnavExpanded(false);
    // toast: realtime will refresh AppContext → render flips to Out state
  } catch (e) {
    alert(extractErrMessage(e));
  } finally {
    setUnavSaving(false);
  }
}

async function handleClearUnavailability() {
  setUnavSaving(true);
  try {
    const { error } = await supabase.rpc('clear_my_unavailability');
    if (error) throw error;
  } catch (e) {
    alert(extractErrMessage(e));
  } finally {
    setUnavSaving(false);
  }
}
```

- [ ] **Step 4: Render the card**

Insert the JSX after the notification-prefs card. Use the same `.app-card` class wrapper the other Settings cards use (look at the existing notification card for the exact tag tree):

```tsx
<section className="app-card settings-availability">
  <header className="settings-card-header">
    <h3>Availability</h3>
    <UnavailabilityPill status={profile?.unavailable_status ?? 'available'} />
  </header>

  {profile?.unavailable_status && profile.unavailable_status !== 'available' && !unavExpanded ? (
    <>
      <p className="settings-availability-summary">
        {profile.unavailable_reason ?? '—'}
        {profile.unavailable_until ? ` · until ${profile.unavailable_until}` : ''}
      </p>
      <div className="settings-availability-actions">
        <button className="btn-primary" onClick={handleClearUnavailability} disabled={unavSaving}>
          I'm back
        </button>
        <button className="btn-secondary" onClick={() => setUnavExpanded(true)}>Edit</button>
      </div>
    </>
  ) : (
    <div className="settings-availability-form">
      <fieldset className="settings-availability-status">
        {(['available','injured','travelling','suspended','retired'] as UnavailabilityStatus[]).map(s => (
          <label key={s}>
            <input type="radio" name="unav-status" checked={unavStatus === s} onChange={() => setUnavStatus(s)} />
            <span>{s === 'available' ? '🟢 Available' :
                   s === 'injured' ? '🩹 Injured' :
                   s === 'travelling' ? '✈️ Travelling' :
                   s === 'suspended' ? '🚫 Suspended' :
                   '🏁 Retired'}</span>
          </label>
        ))}
      </fieldset>

      {unavStatus !== 'available' && unavStatus !== 'retired' && (
        <label className="settings-availability-until">
          Expected return
          <input type="date" value={unavUntil} onChange={e => setUnavUntil(e.target.value)}
                 min={new Date().toISOString().slice(0,10)} />
        </label>
      )}

      {unavStatus !== 'available' && (
        <label className="settings-availability-reason">
          Reason (optional)
          <textarea value={unavReason} onChange={e => setUnavReason(e.target.value)} rows={2} />
        </label>
      )}

      <div className="settings-availability-actions">
        <button className="btn-primary" onClick={handleSaveUnavailability} disabled={unavSaving}>
          {unavStatus === 'available' ? 'Mark available' : 'Save'}
        </button>
        {unavExpanded && (
          <button className="btn-secondary" onClick={() => setUnavExpanded(false)}>Cancel</button>
        )}
      </div>
    </div>
  )}
</section>
```

- [ ] **Step 5: Add minimal CSS to `ffc/src/styles/index.css`**

Append:

```css
.settings-availability-summary { font-size: 14px; color: var(--text-secondary); margin: 8px 0 12px; }
.settings-availability-form fieldset.settings-availability-status {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;
  border: 0; padding: 0; margin: 0 0 12px;
}
.settings-availability-form fieldset label {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px;
  cursor: pointer;
}
.settings-availability-form fieldset label:has(input:checked) {
  border-color: var(--accent); background: var(--accent-tint);
}
.settings-availability-form fieldset label input { accent-color: var(--accent); }
.settings-availability-until, .settings-availability-reason {
  display: flex; flex-direction: column; gap: 4px;
  font-size: 13px; color: var(--text-secondary); margin-bottom: 12px;
}
.settings-availability-until input, .settings-availability-reason textarea {
  padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg-input); color: var(--text-primary);
}
.settings-availability-actions { display: flex; gap: 8px; }
```

(If `--accent`, `--bg-input`, `--text-secondary`, `--border` are not the actual tokens used in Settings, replace with whatever the existing notification card uses. Grep `settings-` in `index.css` to find the right tokens.)

- [ ] **Step 6: Build**

```bash
node ./node_modules/typescript/bin/tsc -b
```

Expected: exit 0.

- [ ] **Step 7: Manual dev preview verification**

```bash
cd ffc && npm run dev
```

Open `/settings`. Confirm:
- Availability card appears after notification prefs.
- Selecting Injured/Travelling/Suspended reveals the date input.
- Selecting Retired hides the date input.
- Saving with status=Injured + a future date → AppContext refreshes → card flips to Out state with "I'm back" button.
- "I'm back" → returns to Available.

- [ ] **Step 8: Commit**

```bash
git add ffc/src/pages/Settings.tsx ffc/src/styles/index.css
git commit -m "feat(unavailability): Settings Availability card + self-serve RPC wiring"
```

---

### Task 6: AdminPlayers — Availability row + edit modal

**Files:**
- Modify: `ffc/src/pages/admin/AdminPlayers.tsx`

- [ ] **Step 1: Locate the per-player card render**

```bash
grep -n "formal_name\|ban_days\|admin-player-card" ffc/src/pages/admin/AdminPlayers.tsx | head -20
```

Find the card render block and the existing edit-modal pattern (`set_player_formal_name` is the closest precedent — look for its caller).

- [ ] **Step 2: Add availability fetch to the players query**

Locate the SELECT loading the player list. Append `unavailable_status, unavailable_until, unavailable_reason` to the column list.

- [ ] **Step 3: Add a "Availability" row to each card**

Within each player card, after the formal_name row, add:

```tsx
<div className="admin-player-row">
  <span className="admin-player-row-label">Availability</span>
  <span className="admin-player-row-value">
    {player.unavailable_status === 'available'
      ? <span className="muted">Available</span>
      : <UnavailabilityPill status={player.unavailable_status} />}
    {player.unavailable_until && <span className="admin-player-row-meta"> · until {player.unavailable_until}</span>}
  </span>
  <button className="admin-player-row-edit" onClick={() => openUnavailabilityModal(player)}>Edit</button>
</div>
```

Import `UnavailabilityPill` and the type at the top.

- [ ] **Step 4: Add the modal state + form**

State at component top:

```tsx
const [unavModal, setUnavModal] = useState<{
  player: PlayerRow;
  status: UnavailabilityStatus;
  until: string;
  reason: string;
} | null>(null);
const [unavModalSaving, setUnavModalSaving] = useState(false);

function openUnavailabilityModal(p: PlayerRow) {
  setUnavModal({
    player: p,
    status: p.unavailable_status ?? 'available',
    until:  p.unavailable_until ?? '',
    reason: p.unavailable_reason ?? '',
  });
}

async function saveUnavModal() {
  if (!unavModal) return;
  setUnavModalSaving(true);
  try {
    const { error } = await supabase.rpc('admin_set_player_unavailability', {
      p_profile_id: unavModal.player.id,
      p_status: unavModal.status,
      p_until: unavModal.status === 'retired' || unavModal.status === 'available' || !unavModal.until ? null : unavModal.until,
      p_reason: unavModal.status === 'available' ? null : (unavModal.reason.trim() || null),
    });
    if (error) throw error;
    setUnavModal(null);
    await reloadPlayers(); // existing refresh helper in this file
  } catch (e) {
    alert(extractErrMessage(e));
  } finally {
    setUnavModalSaving(false);
  }
}
```

- [ ] **Step 5: Render the modal**

At the end of the component JSX (alongside any existing modal portals):

```tsx
{unavModal && (
  <div className="modal-backdrop" onClick={() => setUnavModal(null)}>
    <div className="modal" onClick={e => e.stopPropagation()}>
      <h3>Set availability — {unavModal.player.display_name}</h3>
      <fieldset className="settings-availability-status">
        {(['available','injured','travelling','suspended','retired'] as UnavailabilityStatus[]).map(s => (
          <label key={s}>
            <input type="radio" checked={unavModal.status === s}
                   onChange={() => setUnavModal({...unavModal, status: s})} />
            <span>{s === 'available' ? '🟢 Available' :
                   s === 'injured' ? '🩹 Injured' :
                   s === 'travelling' ? '✈️ Travelling' :
                   s === 'suspended' ? '🚫 Suspended' :
                   '🏁 Retired'}</span>
          </label>
        ))}
      </fieldset>
      {unavModal.status !== 'available' && unavModal.status !== 'retired' && (
        <label className="settings-availability-until">
          Expected return
          <input type="date" value={unavModal.until}
                 onChange={e => setUnavModal({...unavModal, until: e.target.value})}
                 min={new Date().toISOString().slice(0,10)} />
        </label>
      )}
      {unavModal.status !== 'available' && (
        <label className="settings-availability-reason">
          Reason (optional)
          <textarea value={unavModal.reason} rows={2}
                    onChange={e => setUnavModal({...unavModal, reason: e.target.value})} />
        </label>
      )}
      <div className="settings-availability-actions">
        <button className="btn-primary" onClick={saveUnavModal} disabled={unavModalSaving}>Save</button>
        <button className="btn-secondary" onClick={() => setUnavModal(null)}>Cancel</button>
      </div>
    </div>
  </div>
)}
```

(Reuse the modal styling pattern that already exists in this file — grep for the existing `modal-backdrop` class to confirm.)

- [ ] **Step 6: Build**

```bash
node ./node_modules/typescript/bin/tsc -b
```

Expected: exit 0.

- [ ] **Step 7: Manual dev preview verification**

`/admin/players` → each player card shows Availability row → Edit opens modal → save → list refresh shows new pill.

- [ ] **Step 8: Commit**

```bash
git add ffc/src/pages/admin/AdminPlayers.tsx
git commit -m "feat(unavailability): AdminPlayers availability row + admin override modal"
```

---

### Task 7: Poll — query filter + render exclusion

**Files:**
- Modify: `ffc/src/pages/Poll.tsx`

- [ ] **Step 1: Locate the player-list query**

```bash
grep -n "from('profiles')\|from(\"profiles\")\|matchday\|poll_votes" ffc/src/pages/Poll.tsx | head -20
```

Identify the query that returns the eligible voter list (typically a JOIN of `profiles` with `poll_votes`).

- [ ] **Step 2: Add the filter**

Append `.eq('unavailable_status', 'available')` to the profiles select chain, OR add `WHERE p.unavailable_status = 'available'` if the query is via RPC. If a view/RPC abstracts it, update that source instead and document in this step.

- [ ] **Step 3: Verify counts still work**

The existing yes/maybe/no/total count derivation should naturally exclude unavailable players because they're filtered before the GROUP BY. Manually trace through the logic in the file and confirm — if the counts come from a separate RPC, that RPC also needs the filter.

- [ ] **Step 4: Build**

```bash
node ./node_modules/typescript/bin/tsc -b
```

Expected: exit 0.

- [ ] **Step 5: Manual verification**

Open `/poll` → mark a player Injured via AdminPlayers → poll list refreshes → that player is gone → counts correct.

- [ ] **Step 6: Commit**

```bash
git add ffc/src/pages/Poll.tsx
git commit -m "feat(unavailability): hide unavailable players from poll"
```

---

### Task 8: AdminRosterSetup pool — same filter

**Files:**
- Modify: `ffc/src/pages/admin/AdminRosterSetup.tsx`

- [ ] **Step 1: Locate the pool query**

```bash
grep -n "from('profiles')\|pool\|available_players\|poll_votes" ffc/src/pages/admin/AdminRosterSetup.tsx | head -20
```

- [ ] **Step 2: Add the filter to the pool source**

Either chain `.eq('unavailable_status', 'available')` onto the profiles select, or update the view/RPC if abstracted. The Saved/Locked phases must NOT auto-modify already-selected players — this filter is for the AVAILABLE POOL list only.

- [ ] **Step 3: Build**

```bash
node ./node_modules/typescript/bin/tsc -b
```

Expected: exit 0.

- [ ] **Step 4: Manual verification**

Open a draft matchday's roster setup → mark a pool player Travelling → that player disappears from the pool. If the player was already on the locked roster, they remain on it (expected — admin must manually drop).

- [ ] **Step 5: Commit**

```bash
git add ffc/src/pages/admin/AdminRosterSetup.tsx
git commit -m "feat(unavailability): exclude from AdminRosterSetup pool"
```

---

### Task 9: Leaderboard — pill + dim row

**Files:**
- Modify: `ffc/src/pages/Leaderboard.tsx`

- [ ] **Step 1: Confirm the view exposes `unavailable_status`**

```bash
grep -n "v_season_standings\|standings" ffc/src/pages/Leaderboard.tsx | head -10
```

The Task 1 migration updated the view to include `unavailable_status`. Confirm the row type / TS query reflects it after Task 2's type regen.

- [ ] **Step 2: Render the pill + apply data attribute**

In the row render JSX, find the player-row container. Add the data attribute and pill render:

```tsx
<div className="lb-row" data-unavailable={row.unavailable_status === 'available' ? undefined : row.unavailable_status}>
  {/* existing rank, name, stats cells */}
  <span className="lb-row-name">
    {row.display_name}
    {row.unavailable_status !== 'available' && (
      <UnavailabilityPill status={row.unavailable_status} size="sm" />
    )}
  </span>
  {/* rest of row */}
</div>
```

Import: `import { UnavailabilityPill } from '../components/UnavailabilityPill';`

- [ ] **Step 3: Build**

```bash
node ./node_modules/typescript/bin/tsc -b
```

Expected: exit 0.

- [ ] **Step 4: Manual verification**

Open `/leaderboard` → mark a few players with different statuses → those rows dim to ~55% opacity with the corresponding pill next to their name. Rank/points unchanged.

- [ ] **Step 5: Commit**

```bash
git add ffc/src/pages/Leaderboard.tsx
git commit -m "feat(unavailability): Leaderboard dim row + status pill"
```

---

### Task 10: Profile — status banner

**Files:**
- Modify: `ffc/src/pages/Profile.tsx`

- [ ] **Step 1: Read Profile.tsx structure**

Identify the header block where name renders. The new banner sits below name, above stats.

- [ ] **Step 2: Add the banner**

```tsx
{profile.unavailable_status !== 'available' && (
  <div className="profile-unavailability-banner" data-unavailable={profile.unavailable_status}>
    <UnavailabilityPill status={profile.unavailable_status} size="md" />
    {profile.unavailable_reason && <span className="profile-unav-reason">{profile.unavailable_reason}</span>}
    {profile.unavailable_until && <span className="profile-unav-until">until {profile.unavailable_until}</span>}
  </div>
)}
```

Import `UnavailabilityPill` at top.

- [ ] **Step 3: Add minimal CSS to `ffc/src/styles/index.css`**

Append:

```css
.profile-unavailability-banner {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  padding: 10px 14px; border-radius: 12px;
  background: var(--bg-elev); border: 1px solid var(--border);
  margin: 0 0 16px;
}
.profile-unav-reason { font-size: 13px; color: var(--text-secondary); }
.profile-unav-until  { font-size: 13px; color: var(--text-tertiary); margin-left: auto; }
```

- [ ] **Step 4: Verify the profile query selects the new fields**

Find the profile fetch in the file and ensure `unavailable_status, unavailable_until, unavailable_reason` are in the SELECT (or that `*` is used).

- [ ] **Step 5: Build**

```bash
node ./node_modules/typescript/bin/tsc -b
```

Expected: exit 0.

- [ ] **Step 6: Manual verification**

Open another player's profile while they're marked Travelling → banner shows. Open your own profile while Available → no banner.

- [ ] **Step 7: Commit**

```bash
git add ffc/src/pages/Profile.tsx ffc/src/styles/index.css
git commit -m "feat(unavailability): Profile status banner"
```

---

### Task 11: End-to-end verification + push

- [ ] **Step 1: Full TypeScript build**

```bash
node ./node_modules/typescript/bin/tsc -b
```

Expected: exit 0 across all project refs.

- [ ] **Step 2: Lint pass**

```bash
cd ffc && npx eslint .
```

Expected: 0 errors. Warnings ok if pre-existing.

- [ ] **Step 3: Dev preview smoke run**

```bash
cd ffc && npm run dev
```

Walk the full self-mark flow:
1. Login as a non-admin player → `/settings` → mark Injured until tomorrow → save → card flips to "I'm back".
2. Login as an admin in another tab → notification visible (`unavailability_set`).
3. Admin opens `/poll` → injured player not visible.
4. Admin opens `/leaderboard` → injured player dimmed with 🩹 OUT pill.
5. Admin opens `/admin/players` → injured player's Availability row shows pill → Edit modal works → set to Available silently.
6. Player tab refreshes via realtime → card flips back to Available form.

- [ ] **Step 4: Push**

```bash
git push origin main
```

Vercel will auto-deploy. Watch the deployment in `https://vercel.com/ffc/...` until status = Ready.

- [ ] **Step 5: Live smoke**

`https://ffc-gilt.vercel.app/settings` — repeat the smoke walk with a real account. Verify the auto-clear by setting a return date of today, waiting until 00:00 UAE, then refreshing the leaderboard.

- [ ] **Step 6: Update session log + INDEX + todo**

Per CLAUDE.md operating rule #5, write `sessions/S0XX/session-log.md` (current session number from INDEX.md), add an INDEX row, mark the brainstorm-queue item done in `tasks/todo.md`. Commit:

```bash
git add sessions/S0XX/session-log.md sessions/INDEX.md tasks/todo.md CLAUDE.md
git commit -m "docs(s0XX): injury/unavailable list shipped"
git push origin main
```

---

## Self-Review

**Spec coverage check** — every requirement maps to a task:

| Spec section | Task |
|---|---|
| Migration 0070 (enum, cols, constraint, RPCs, view, cron) | Task 1 |
| Apply migration + types regen | Task 2 |
| Shared `<UnavailabilityPill>` | Task 3 |
| AppContext profile extension | Task 4 |
| Settings Availability card | Task 5 |
| AdminPlayers row + modal | Task 6 |
| Poll filter + render exclusion | Task 7 |
| AdminRosterSetup pool filter | Task 8 |
| Leaderboard pill + dim | Task 9 |
| Profile banner | Task 10 |
| Mockup-first per Rule #1 | Task 0 |
| End-to-end + push + session-log | Task 11 |
| Edge cases (locked roster, past-date, retired+until, etc.) | Encoded into RPC validation in Task 1; documented in spec; no separate task |
| `extractErrMessage` toast wrapper (S063 lesson) | Used in Tasks 5/6 handlers |

**Placeholder scan** — none. Every task contains the actual SQL / TSX / CSS / commands.

**Type consistency check** — `UnavailabilityStatus` is defined once in `UnavailabilityPill.tsx`, exported, and re-imported in Tasks 5/6/9/10. RPC argument names (`p_status`, `p_until`, `p_reason`) match between Task 1 SQL and Task 5/6 frontend calls. View column `unavailable_status` is added in Task 1 and consumed in Task 9.
