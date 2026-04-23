# Rules Screen + Friendly Game System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a static League Rules screen inside Settings, auto-flag matchdays as friendly when guest count exceeds format threshold, give admin a confirm/dismiss flow, and record no-show penalties with a 14-day ban.

**Architecture:** One migration adds two columns to `matchdays`, one column to `match_players`, two app_settings values, a DB trigger for auto-flagging, three admin RPCs, and recreates the three views that derive from `v_season_standings`. The Rules screen is a pure static React component; the friendly review panel is a minimal AdminMatches slice that does not block the full §3.18 implementation.

**Tech Stack:** React 19 + TypeScript, Supabase Postgres (SQL migration via `npx supabase db push --linked`), Supabase CLI types gen (`npx supabase gen types typescript --linked 2>/dev/null`).

**Spec:** `docs/superpowers/specs/2026-04-23-rules-and-friendly-game-design.md`

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `supabase/migrations/0013_friendly_game_and_no_show.sql` | Schema, trigger, RPCs, view recreation |
| Regen | `ffc/src/lib/database.types.ts` | Auto-generated — run gen types after push |
| Create | `ffc/src/pages/Rules.tsx` | Static rules screen |
| Modify | `ffc/src/pages/Settings.tsx` | Add League Rules row |
| Modify | `ffc/src/router.tsx` | Add `/settings/rules` route |
| Modify | `ffc/src/pages/Leaderboard.tsx` | Add `no_show_points` to `StandingEmbed` interface |
| Modify | `ffc/src/pages/admin/AdminMatches.tsx` | Friendly review panel (minimal §3.18 slice) |

---

## Task 1: Write and push the DB migration

**Files:**
- Create: `supabase/migrations/0013_friendly_game_and_no_show.sql`

- [ ] **Step 1.1: Create the migration file**

```sql
-- supabase/migrations/0013_friendly_game_and_no_show.sql
-- Friendly game flagging + no-show penalties (spec: 2026-04-23)

-- ── 1. Schema changes ──────────────────────────────────────────────────────

ALTER TABLE matchdays
  ADD COLUMN friendly_flagged_at TIMESTAMPTZ,
  ADD COLUMN is_friendly         BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE match_players
  ADD COLUMN is_no_show BOOLEAN NOT NULL DEFAULT false;

-- ── 2. Extend match_settings with no-show penalty values ───────────────────

UPDATE app_settings
SET value = value || '{
  "no_show_penalty_points": -2,
  "no_show_ban_days":       14
}'::jsonb
WHERE key = 'match_settings';

-- ── 3. Auto-flag trigger ───────────────────────────────────────────────────
-- Fires after any new match_guest row. Counts active (non-cancelled) guests
-- for that matchday, compares to format threshold, sets friendly_flagged_at
-- if threshold is newly crossed.

CREATE OR REPLACE FUNCTION check_friendly_threshold()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_guest_count INT;
  v_format      match_format;
  v_threshold   INT;
BEGIN
  SELECT COUNT(*) INTO v_guest_count
  FROM match_guests
  WHERE matchday_id = NEW.matchday_id AND cancelled_at IS NULL;

  v_format    := effective_format(NEW.matchday_id);
  v_threshold := CASE WHEN v_format = '5v5' THEN 3 ELSE 4 END;

  IF v_guest_count >= v_threshold THEN
    UPDATE matchdays
    SET friendly_flagged_at = NOW()
    WHERE id = NEW.matchday_id
      AND friendly_flagged_at IS NULL
      AND NOT is_friendly;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_friendly_threshold
AFTER INSERT ON match_guests
FOR EACH ROW EXECUTE FUNCTION check_friendly_threshold();

-- ── 4. Admin RPCs ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION confirm_friendly_matchday(p_matchday_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  UPDATE matchdays SET is_friendly = true WHERE id = p_matchday_id;
  PERFORM log_admin_action('matchday', p_matchday_id, 'confirm_friendly', '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION dismiss_friendly_flag(p_matchday_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  UPDATE matchdays
  SET friendly_flagged_at = NULL, is_friendly = false
  WHERE id = p_matchday_id;
  PERFORM log_admin_action('matchday', p_matchday_id, 'dismiss_friendly', '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION record_no_shows(p_match_id UUID, p_profile_ids UUID[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_kickoff_at TIMESTAMPTZ;
  v_admin_id   UUID;
  v_pid        UUID;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  v_admin_id := current_profile_id();

  SELECT md.kickoff_at INTO v_kickoff_at
  FROM matches m
  JOIN matchdays md ON md.id = m.matchday_id
  WHERE m.id = p_match_id;

  UPDATE match_players
  SET is_no_show = true
  WHERE match_id = p_match_id AND profile_id = ANY(p_profile_ids);

  FOREACH v_pid IN ARRAY p_profile_ids LOOP
    INSERT INTO player_bans (profile_id, starts_at, ends_at, reason, imposed_by)
    SELECT v_pid,
           v_kickoff_at,
           v_kickoff_at + INTERVAL '14 days',
           'no_show',
           v_admin_id
    WHERE NOT EXISTS (
      SELECT 1 FROM player_bans
      WHERE profile_id = v_pid AND reason = 'no_show' AND starts_at = v_kickoff_at
    );
  END LOOP;

  PERFORM log_admin_action('match', p_match_id, 'record_no_shows',
    jsonb_build_object('profile_ids', p_profile_ids));
END;
$$;

-- ── 5. Grant RPCs (required per 0012 DEFAULT PRIVILEGES pattern) ───────────

GRANT EXECUTE ON FUNCTION confirm_friendly_matchday(UUID)   TO authenticated;
GRANT EXECUTE ON FUNCTION dismiss_friendly_flag(UUID)       TO authenticated;
GRANT EXECUTE ON FUNCTION record_no_shows(UUID, UUID[])     TO authenticated;
-- check_friendly_threshold is a trigger function, not a callable RPC — no GRANT needed.

-- ── 6. Recreate views (drop dependents first) ──────────────────────────────

DROP VIEW IF EXISTS v_captain_eligibility;
DROP VIEW IF EXISTS v_player_last5;
DROP VIEW IF EXISTS v_season_standings;

CREATE VIEW v_season_standings AS
WITH played AS (
  SELECT m.season_id, mp.profile_id,
    COUNT(*) FILTER (WHERE m.result = 'win_white' AND mp.team = 'white') +
    COUNT(*) FILTER (WHERE m.result = 'win_black' AND mp.team = 'black')  AS wins,
    COUNT(*) FILTER (WHERE m.result = 'draw')                             AS draws,
    COUNT(*) FILTER (WHERE m.result = 'win_white' AND mp.team = 'black') +
    COUNT(*) FILTER (WHERE m.result = 'win_black' AND mp.team = 'white')  AS losses,
    COALESCE(SUM(mp.goals), 0)        AS goals,
    COALESCE(SUM(mp.yellow_cards), 0) AS yellows,
    COALESCE(SUM(mp.red_cards), 0)    AS reds,
    COUNT(*) FILTER (WHERE m.motm_user_id = mp.profile_id) AS motms
  FROM matches m
  JOIN matchdays md ON md.id = m.matchday_id
  JOIN match_players mp ON mp.match_id = m.id
  WHERE m.approved_at IS NOT NULL AND mp.profile_id IS NOT NULL AND NOT md.is_friendly
  GROUP BY m.season_id, mp.profile_id
),
penalties AS (
  SELECT md.season_id, pv.profile_id,
    SUM(CASE
          WHEN pv.cancelled_at IS NULL                                  THEN 0
          WHEN pv.cancelled_at > (md.kickoff_at - INTERVAL '24 hours') THEN -1
          WHEN md.roster_locked_at IS NOT NULL
               AND pv.cancelled_at > md.roster_locked_at               THEN -1
          ELSE 0
        END) AS late_cancel_points
  FROM poll_votes pv
  JOIN matchdays md ON md.id = pv.matchday_id
  WHERE pv.choice = 'yes' AND NOT md.is_friendly
  GROUP BY md.season_id, pv.profile_id
),
no_show_penalties AS (
  SELECT md.season_id, mp.profile_id,
    SUM(CASE WHEN mp.is_no_show THEN -2 ELSE 0 END) AS no_show_points
  FROM match_players mp
  JOIN matches m  ON m.id  = mp.match_id
  JOIN matchdays md ON md.id = m.matchday_id
  WHERE m.approved_at IS NOT NULL AND mp.profile_id IS NOT NULL AND NOT md.is_friendly
  GROUP BY md.season_id, mp.profile_id
)
SELECT p.season_id, p.profile_id, pr.display_name,
       p.wins, p.draws, p.losses, p.goals, p.yellows, p.reds, p.motms,
       COALESCE(pen.late_cancel_points, 0) AS late_cancel_points,
       COALESCE(nsp.no_show_points, 0)     AS no_show_points,
       (p.wins * 3 + p.draws * 1
        + COALESCE(pen.late_cancel_points, 0)
        + COALESCE(nsp.no_show_points, 0)) AS points
FROM played p
JOIN profiles pr ON pr.id = p.profile_id
LEFT JOIN penalties         pen ON pen.season_id = p.season_id AND pen.profile_id = p.profile_id
LEFT JOIN no_show_penalties nsp ON nsp.season_id = p.season_id AND nsp.profile_id = p.profile_id;

CREATE VIEW v_player_last5 AS
WITH ranked AS (
  SELECT m.season_id, mp.profile_id, m.id AS match_id, md.kickoff_at,
    CASE
      WHEN m.result = 'draw' THEN 'D'
      WHEN (m.result = 'win_white' AND mp.team = 'white') OR
           (m.result = 'win_black' AND mp.team = 'black') THEN 'W'
      ELSE 'L'
    END AS outcome,
    ROW_NUMBER() OVER (
      PARTITION BY m.season_id, mp.profile_id ORDER BY md.kickoff_at DESC
    ) AS rn
  FROM matches m
  JOIN matchdays md ON md.id = m.matchday_id
  JOIN match_players mp ON mp.match_id = m.id
  WHERE m.approved_at IS NOT NULL AND mp.profile_id IS NOT NULL AND NOT md.is_friendly
)
SELECT season_id, profile_id, match_id, kickoff_at, outcome, rn
FROM ranked WHERE rn <= 5;

CREATE VIEW v_captain_eligibility AS
WITH season_stats AS (
  SELECT s.season_id, s.profile_id,
         s.wins + s.draws + s.losses AS matches_played,
         s.points, s.motms
  FROM v_season_standings s
),
attendance AS (
  SELECT md.season_id, pv.profile_id,
         COUNT(*) FILTER (WHERE pv.choice = 'yes' AND pv.cancelled_at IS NULL) AS yes_votes,
         COUNT(*) AS total_votes
  FROM poll_votes pv
  JOIN matchdays md ON md.id = pv.matchday_id
  GROUP BY md.season_id, pv.profile_id
),
cooldown AS (
  SELECT m.season_id, mp.profile_id,
         MAX(md.kickoff_at) AS last_captained_at,
         COUNT(DISTINCT m2.matchday_id) AS matchdays_since_captained
  FROM matches m
  JOIN matchdays md ON md.id = m.matchday_id
  JOIN match_players mp ON mp.match_id = m.id AND mp.is_captain = true
  LEFT JOIN matches m2   ON m2.season_id = m.season_id
                         AND m2.matchday_id <> m.matchday_id
                         AND m2.approved_at IS NOT NULL
  LEFT JOIN matchdays md2 ON md2.id = m2.matchday_id
                           AND md2.kickoff_at > md.kickoff_at
  WHERE m.approved_at IS NOT NULL
  GROUP BY m.season_id, mp.profile_id
),
settings AS (
  SELECT
    COALESCE((value->>'captain_min_matches_this_season')::int,  5)   AS min_matches,
    COALESCE((value->>'captain_cooldown_matchdays')::int,       4)   AS cooldown,
    COALESCE((value->>'captain_min_attendance_rate')::float,  0.6)   AS min_attendance
  FROM app_settings WHERE key = 'match_settings'
)
SELECT ss.season_id, ss.profile_id, pr.display_name,
       ss.matches_played, ss.points, ss.motms,
       COALESCE(att.yes_votes::float / NULLIF(att.total_votes, 0), 0) AS attendance_rate,
       COALESCE(cd.matchdays_since_captained, 999)                    AS matchdays_since_captained,
       (ss.matches_played >= s.min_matches)                                                        AS meets_min_matches,
       (COALESCE(att.yes_votes::float / NULLIF(att.total_votes, 0), 0) >= s.min_attendance)        AS meets_attendance,
       (COALESCE(cd.matchdays_since_captained, 999) >= s.cooldown)                                 AS cooldown_ok,
       (ss.matches_played >= s.min_matches
        AND COALESCE(att.yes_votes::float / NULLIF(att.total_votes, 0), 0) >= s.min_attendance
        AND COALESCE(cd.matchdays_since_captained, 999) >= s.cooldown)                             AS is_eligible
FROM season_stats ss
JOIN profiles pr    ON pr.id = ss.profile_id
LEFT JOIN attendance att ON att.season_id = ss.season_id AND att.profile_id = ss.profile_id
LEFT JOIN cooldown   cd  ON cd.season_id  = ss.season_id AND cd.profile_id  = ss.profile_id
CROSS JOIN settings s;
```

- [ ] **Step 1.2: Push migration to Supabase**

```bash
cd ffc && npx supabase db push --linked
```

Expected: migration `0013_friendly_game_and_no_show` applied successfully. No errors.

- [ ] **Step 1.3: Verify schema changes in the DB**

```bash
npx supabase db query --linked "SELECT column_name FROM information_schema.columns WHERE table_name = 'matchdays' AND column_name IN ('friendly_flagged_at','is_friendly') ORDER BY column_name;"
```

Expected output:
```
 column_name
-----------------------
 friendly_flagged_at
 is_friendly
```

```bash
npx supabase db query --linked "SELECT column_name FROM information_schema.columns WHERE table_name = 'match_players' AND column_name = 'is_no_show';"
```

Expected: `is_no_show` returned.

- [ ] **Step 1.4: Verify view has no_show_points column**

```bash
npx supabase db query --linked "SELECT column_name FROM information_schema.columns WHERE table_name = 'v_season_standings' ORDER BY ordinal_position;"
```

Expected: column list includes `late_cancel_points`, `no_show_points`, `points`.

- [ ] **Step 1.5: Commit migration**

```bash
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  add supabase/migrations/0013_friendly_game_and_no_show.sql && \
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  commit -m "feat(db): friendly game flag + no-show penalty — migration 0013"
```

---

## Task 2: Regenerate TypeScript types + update Leaderboard interface

**Files:**
- Regen: `ffc/src/lib/database.types.ts`
- Modify: `ffc/src/pages/Leaderboard.tsx` (lines ~28–47, `StandingEmbed` interface)

- [ ] **Step 2.1: Regenerate types**

```bash
cd ffc && npx supabase gen types typescript --linked 2>/dev/null > src/lib/database.types.ts
```

Expected: file updated with no console output (the `2>/dev/null` suppresses the "Initialising login role..." diagnostic that corrupts the file if not redirected).

- [ ] **Step 2.2: Confirm new columns appear in generated types**

Search `ffc/src/lib/database.types.ts` for `is_friendly` and `no_show_points`. Both must appear in the `matchdays` and `v_season_standings` Row types respectively.

- [ ] **Step 2.3: Add `no_show_points` to `StandingEmbed` in Leaderboard.tsx**

In `ffc/src/pages/Leaderboard.tsx`, locate the `StandingEmbed` interface (~line 28) and add the new field:

```typescript
interface StandingEmbed {
  profile_id: string | null
  display_name: string | null
  wins: number | null
  draws: number | null
  losses: number | null
  goals: number | null
  yellows: number | null
  reds: number | null
  motms: number | null
  late_cancel_points: number | null
  no_show_points: number | null   // ← add this line
  points: number | null
  profile: {
    primary_position: PlayerPosition | null
    secondary_position: PlayerPosition | null
    avatar_url: string | null
    role: UserRoleEnum
    is_active: boolean
  } | null
}
```

- [ ] **Step 2.4: Run TypeScript check**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 2.5: Commit**

```bash
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  add ffc/src/lib/database.types.ts ffc/src/pages/Leaderboard.tsx && \
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  commit -m "chore(types): regen + add no_show_points to StandingEmbed"
```

---

## Task 3: Rules screen — static component

**Files:**
- Create: `ffc/src/pages/Rules.tsx`

- [ ] **Step 3.1: Create Rules.tsx**

```tsx
// ffc/src/pages/Rules.tsx
import { useNavigate } from 'react-router-dom'

export function Rules() {
  const navigate = useNavigate()

  return (
    <div className="page-container" style={{ padding: '0 16px 32px' }}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 0' }}>
        <button
          onClick={() => navigate('/settings')}
          style={{ background: 'none', border: 'none', color: 'inherit', fontSize: 20, cursor: 'pointer', padding: 0 }}
          aria-label="Back to Settings"
        >
          ‹
        </button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>League Rules</h1>
      </div>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, marginBottom: 8 }}>
          Scoring
        </h2>
        <div className="card" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <RuleRow label="Win" value="+3 pts" />
          <RuleRow label="Draw" value="+1 pt" />
          <RuleRow label="Loss" value="0 pts" />
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, marginBottom: 8 }}>
          Late cancellation
        </h2>
        <div className="card" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <RuleRow label="Before roster lock" value="No penalty" />
          <RuleRow label="After lock (outside 24h)" value="−1 pt" />
          <RuleRow label="Within 24h of kickoff" value="−1 pt + 7-day ban" highlight />
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, marginBottom: 8 }}>
          No-show
        </h2>
        <div className="card" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <RuleRow label="On roster, didn't appear" value="−2 pts + 14-day ban" highlight />
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, marginBottom: 8 }}>
          Friendly games
        </h2>
        <div className="card" style={{ padding: '12px 16px' }}>
          <p style={{ margin: 0, lineHeight: 1.5, fontSize: 14, opacity: 0.85 }}>
            If 4 or more external players join a 7v7 matchday, or 3 or more join a 5v5, the match is automatically flagged as a friendly.
          </p>
          <p style={{ margin: '8px 0 0', lineHeight: 1.5, fontSize: 14, opacity: 0.85 }}>
            A confirmed friendly doesn't count toward the season table, player stats, or match history.
          </p>
        </div>
      </section>
    </div>
  )
}

function RuleRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 14, opacity: 0.85 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: highlight ? 'var(--color-red, #e53935)' : 'inherit' }}>
        {value}
      </span>
    </div>
  )
}
```

- [ ] **Step 3.2: Run TypeScript check**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3.3: Commit**

```bash
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  add ffc/src/pages/Rules.tsx && \
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  commit -m "feat(rules): static League Rules screen"
```

---

## Task 4: Wire Rules into Settings and router

**Files:**
- Modify: `ffc/src/pages/Settings.tsx`
- Modify: `ffc/src/router.tsx`

- [ ] **Step 4.1: Add League Rules row to Settings.tsx**

Replace the entire content of `ffc/src/pages/Settings.tsx`:

```tsx
// ffc/src/pages/Settings.tsx
import { useNavigate } from 'react-router-dom'

export function Settings() {
  const navigate = useNavigate()

  return (
    <div className="page-container" style={{ padding: '16px' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Settings</h1>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, marginBottom: 8 }}>
          General
        </h2>
        <div className="card" style={{ padding: 0 }}>
          <button
            onClick={() => navigate('/settings/rules')}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              width: '100%', padding: '14px 16px', background: 'none', border: 'none',
              color: 'inherit', fontSize: 15, cursor: 'pointer', textAlign: 'left',
            }}
          >
            <span>League Rules</span>
            <span style={{ opacity: 0.4 }}>›</span>
          </button>
        </div>
      </section>

      <p style={{ opacity: 0.4, fontSize: 13, textAlign: 'center' }}>
        §3.16 full settings screen coming soon
      </p>
    </div>
  )
}
```

- [ ] **Step 4.2: Add `/settings/rules` route to router.tsx**

In `ffc/src/router.tsx`, add the import and the route. After the existing Settings import line, add:

```typescript
import { Rules } from './pages/Rules'
```

Then inside the `RoleLayout` children array, after `{ path: 'settings', element: <Settings /> }`, add:

```typescript
{ path: 'settings/rules', element: <Rules /> },
```

- [ ] **Step 4.3: Run TypeScript check**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4.4: Start dev server and verify manually**

```bash
cd ffc && node ./node_modules/vite/bin/vite.js
```

1. Navigate to `/settings` — see the Settings page with "League Rules" row
2. Tap "League Rules" — navigates to `/settings/rules`
3. Rules screen shows four sections: Scoring, Late cancellation, No-show, Friendly games
4. Back button (`‹`) returns to `/settings`
5. Direct load of `http://localhost:5174/settings/rules` resolves (SPA catch-all handles it)

- [ ] **Step 4.5: Commit**

```bash
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  add ffc/src/pages/Settings.tsx ffc/src/router.tsx && \
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  commit -m "feat(settings): add League Rules entry point + /settings/rules route"
```

---

## Task 5: AdminMatches — friendly review panel

**Files:**
- Modify: `ffc/src/pages/admin/AdminMatches.tsx`

This task replaces the stub with a minimal screen that lists all matchdays and highlights those pending a friendly review. Full §3.18 phases 1–7 are deferred; this slice only adds the friendly badge + confirm/dismiss flow.

- [ ] **Step 5.1: Replace AdminMatches.tsx stub**

```tsx
// ffc/src/pages/admin/AdminMatches.tsx
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface MatchdayRow {
  id: string
  kickoff_at: string
  season_id: string
  is_friendly: boolean
  friendly_flagged_at: string | null
}

type ActionState = 'idle' | 'loading' | 'error'

export function AdminMatches() {
  const [matchdays, setMatchdays] = useState<MatchdayRow[]>([])
  const [loading, setLoading] = useState(true)
  const [actionState, setActionState] = useState<Record<string, ActionState>>({})

  useEffect(() => {
    supabase
      .from('matchdays')
      .select('id, kickoff_at, season_id, is_friendly, friendly_flagged_at')
      .order('kickoff_at', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        setMatchdays(data ?? [])
        setLoading(false)
      })
  }, [])

  async function confirmFriendly(matchdayId: string) {
    setActionState(s => ({ ...s, [matchdayId]: 'loading' }))
    const { error } = await supabase.rpc('confirm_friendly_matchday', { p_matchday_id: matchdayId })
    if (error) {
      setActionState(s => ({ ...s, [matchdayId]: 'error' }))
      return
    }
    setMatchdays(prev =>
      prev.map(md => md.id === matchdayId ? { ...md, is_friendly: true } : md)
    )
    setActionState(s => ({ ...s, [matchdayId]: 'idle' }))
  }

  async function dismissFriendly(matchdayId: string) {
    setActionState(s => ({ ...s, [matchdayId]: 'loading' }))
    const { error } = await supabase.rpc('dismiss_friendly_flag', { p_matchday_id: matchdayId })
    if (error) {
      setActionState(s => ({ ...s, [matchdayId]: 'error' }))
      return
    }
    setMatchdays(prev =>
      prev.map(md => md.id === matchdayId ? { ...md, friendly_flagged_at: null, is_friendly: false } : md)
    )
    setActionState(s => ({ ...s, [matchdayId]: 'idle' }))
  }

  const pending = matchdays.filter(md => md.friendly_flagged_at && !md.is_friendly)

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Admin: Matches</h1>

      {pending.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, marginBottom: 8 }}>
            Pending Friendly Review
          </h2>
          {pending.map(md => {
            const state = actionState[md.id] ?? 'idle'
            const kickoff = new Date(md.kickoff_at)
            const dateStr = kickoff.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
            return (
              <div key={md.id} className="card" style={{ padding: '12px 16px', marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{dateStr}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: '#f59e0b',
                    background: 'rgba(245,158,11,0.15)', borderRadius: 6, padding: '2px 8px',
                  }}>
                    FRIENDLY?
                  </span>
                </div>
                {state === 'error' && (
                  <p style={{ color: 'var(--color-red, #e53935)', fontSize: 13, margin: '0 0 8px' }}>
                    Action failed — try again.
                  </p>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => confirmFriendly(md.id)}
                    disabled={state === 'loading'}
                    style={{
                      flex: 1, padding: '10px 0', borderRadius: 8, border: 'none',
                      background: 'var(--color-red, #e53935)', color: '#fff',
                      fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: state === 'loading' ? 0.6 : 1,
                    }}
                  >
                    Confirm Friendly
                  </button>
                  <button
                    onClick={() => dismissFriendly(md.id)}
                    disabled={state === 'loading'}
                    style={{
                      flex: 1, padding: '10px 0', borderRadius: 8,
                      border: '1px solid rgba(255,255,255,0.15)', background: 'transparent',
                      color: 'inherit', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                      opacity: state === 'loading' ? 0.6 : 1,
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )
          })}
        </section>
      )}

      <section>
        <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, marginBottom: 8 }}>
          Recent Matchdays
        </h2>
        {matchdays.length === 0 && (
          <p style={{ opacity: 0.4, fontSize: 14 }}>No matchdays yet.</p>
        )}
        {matchdays.map(md => {
          const kickoff = new Date(md.kickoff_at)
          const dateStr = kickoff.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
          return (
            <div key={md.id} className="card" style={{ padding: '12px 16px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14 }}>{dateStr}</span>
              {md.is_friendly && (
                <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', background: 'rgba(156,163,175,0.15)', borderRadius: 6, padding: '2px 8px' }}>
                  FRIENDLY
                </span>
              )}
            </div>
          )
        })}
      </section>

      <p style={{ opacity: 0.4, fontSize: 13, textAlign: 'center', marginTop: 24 }}>
        §3.18 full match management (phases 1–7) coming soon
      </p>
    </div>
  )
}
```

- [ ] **Step 5.2: Run TypeScript check**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5.3: Verify in browser (dev server must be running)**

1. Log in as admin (`m.muwahid@gmail.com`) and navigate to `/admin/matches`
2. Confirm the "Recent Matchdays" list loads
3. To test FRIENDLY? badge: manually insert a `match_guests` row via Supabase Studio for an existing matchday. Add 4+ guests (7v7) and verify the trigger sets `friendly_flagged_at`. The card should appear under "Pending Friendly Review" on refresh.
4. Tap "Confirm Friendly" — card moves out of pending; matchday shows grey "FRIENDLY" chip in the list
5. Tap "Dismiss" on another pending card — it disappears from pending (no chip shown)

- [ ] **Step 5.4: Commit**

```bash
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  add ffc/src/pages/admin/AdminMatches.tsx && \
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" \
  commit -m "feat(admin): friendly matchday review panel in AdminMatches"
```

---

## Task 6: No-show toggles — DEFERRED

**Reason:** No-show toggles live inside the match result entry form, which is Phase 4 of the full §3.18 Admin Matches implementation. The DB column (`match_players.is_no_show`) and the RPC (`record_no_shows`) are already live after Task 1.

**When to implement:** Wire `record_no_shows(match_id, profile_ids[])` into the §3.18 match result entry form when that section is built. The RPC signature is:

```typescript
await supabase.rpc('record_no_shows', {
  p_match_id: matchId,
  p_profile_ids: selectedProfileIds,  // UUID[] of players who didn't show
})
```

Call this after the admin has ticked the no-show checkboxes and before saving the result.

---

## Verification Checklist (end-to-end)

- [ ] `/settings` shows "League Rules" row with `›` chevron
- [ ] `/settings/rules` shows all four sections with correct penalty values
- [ ] Back button on Rules screen returns to Settings
- [ ] `v_season_standings.points` excludes confirmed friendly matchdays
- [ ] `v_player_last5` excludes confirmed friendly matchdays
- [ ] `v_season_standings.no_show_points` reflects `is_no_show = true` rows
- [ ] Leaderboard (`/leaderboard`) still loads with zero TS errors after types regen
- [ ] Admin Matches shows FRIENDLY? badge on auto-flagged matchdays
- [ ] Confirm Friendly → `is_friendly = true` → row excluded from leaderboard view
- [ ] Dismiss → `friendly_flagged_at = NULL` → badge disappears
- [ ] Auto-flag trigger fires when 4th guest is added to a 7v7 matchday
