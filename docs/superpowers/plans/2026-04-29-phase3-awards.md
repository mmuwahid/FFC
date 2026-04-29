# Phase 3 Awards Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/awards` screen surfacing 3 season awards (Ballon d'Or · Golden Boot · Most MOTM) plus a tabular Wall of Fame archiving ended-season winners. Entry via gold trophy icon-button in Leaderboard's controls row.

**Architecture:** New SQL view computes winners on demand from `match_players` + `matches` + `profiles`. New `season_awards` snapshot table populated by AFTER UPDATE OF `ended_at` trigger when a season ends. Frontend chooses view (active) or table (ended) based on season state. Wall of Fame reads only the snapshot table.

**Tech Stack:** Postgres view + table + trigger · React 19 + Vite 8 + TypeScript 6 · React Router · Supabase JS client · existing FFC brand tokens (`var(--gold)`, `var(--paper)`, etc.)

**Spec:** [`docs/superpowers/specs/2026-04-29-phase3-awards-design.md`](../specs/2026-04-29-phase3-awards-design.md)
**Approved mockup:** [`mockups/3-24-phase3-awards.html`](../../../mockups/3-24-phase3-awards.html)

**Verification model:** FFC has no JS test framework. Each task gates on:
- DB tasks → spot-check SQL queries via `npx supabase db query --linked`
- Frontend tasks → `node ./node_modules/typescript/bin/tsc -b` EXIT 0 (matches Vercel CI strictness) + `vite build` EXIT 0
- Auth-gated screens → live verification deferred to post-deploy on production

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `supabase/migrations/0047_phase3_awards.sql` | Table `season_awards` + view `v_season_award_winners_live` + AFTER UPDATE trigger on `seasons.ended_at` + GRANTs | new |
| `ffc/src/lib/database.types.ts` | Supabase-generated types covering the new table + view | regen (auto) |
| `ffc/src/pages/Awards.tsx` | The /awards screen — hero cards (active or ended), Wall of Fame, season picker | new |
| `ffc/src/App.tsx` | Add `<Route path="/awards" element={<Awards />} />` inside `RoleLayout` | modify |
| `ffc/src/pages/Leaderboard.tsx` | Add `TrophyIcon` SVG + 3rd `lb-icon-wrap` with awards button | modify |
| `ffc/src/index.css` | Awards page CSS section + `lb-icon-btn--awards` variant | modify |

---

## Task 1: Migration 0047 — table, view, trigger

**Files:**
- Create: `supabase/migrations/0047_phase3_awards.sql`

- [ ] **Step 1.1: Schema verification (read-only check)**

Confirm column names match spec (per CLAUDE.md operating rule #7). Run:
```bash
npx supabase db query --linked "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='match_players' ORDER BY ordinal_position;"
npx supabase db query --linked "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='matches' ORDER BY ordinal_position;"
npx supabase db query --linked "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='seasons' ORDER BY ordinal_position;"
```

Expected: confirm `match_players.profile_id` (not user_id), `matches.motm_user_id`, `matches.approved_at`, `matches.season_id`, `matches.result`, `seasons.ended_at` (timestamptz).

- [ ] **Step 1.2: Write the migration file**

Create `supabase/migrations/0047_phase3_awards.sql`:

```sql
-- 0047_phase3_awards.sql
-- Phase 3 awards (V3.0:139). New season_awards snapshot table + live view +
-- AFTER UPDATE OF ended_at trigger that snapshots winners when a season ends.

-- =============================================================
-- 1. Snapshot table — ended seasons' frozen winners
-- =============================================================
CREATE TABLE season_awards (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id             uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  award_kind            text NOT NULL CHECK (award_kind IN ('ballon_dor', 'golden_boot', 'most_motm')),
  winner_profile_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  runner_up_profile_id  uuid REFERENCES profiles(id) ON DELETE RESTRICT,
  metric_value          numeric NOT NULL,
  runner_up_metric      numeric,
  meta                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  frozen_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, award_kind)
);

CREATE INDEX season_awards_season_idx ON season_awards (season_id);

-- RLS: read-only for authenticated; only the trigger writes (SECURITY DEFINER)
ALTER TABLE season_awards ENABLE ROW LEVEL SECURITY;
CREATE POLICY season_awards_select ON season_awards FOR SELECT TO authenticated USING (true);

-- Default-privileges grant on tables (mig 0012) covers SELECT for authenticated;
-- explicit grant kept for clarity per CLAUDE.md gotcha (default privileges
-- don't cover service_role and view scope can vary).
GRANT SELECT ON season_awards TO authenticated;

-- =============================================================
-- 2. Live computation view — used for ACTIVE seasons
-- =============================================================
-- Awards points formula: wins*3 + draws (NO late_cancel_points term)
-- — celebrates match performance, not roster discipline. Differs from
-- v_season_standings.points by design.
-- Tie-break cascade (applied to all 3 awards):
--   <metric> DESC, wins DESC, total_cards ASC, display_name ASC
-- — single deterministic winner.
CREATE OR REPLACE VIEW v_season_award_winners_live AS
WITH base AS (
  SELECT
    m.season_id,
    mp.profile_id,
    pr.display_name,
    COUNT(*) FILTER (WHERE m.result = 'win_white' AND mp.team = 'white')
      + COUNT(*) FILTER (WHERE m.result = 'win_black' AND mp.team = 'black') AS wins,
    COUNT(*) FILTER (WHERE m.result = 'draw') AS draws,
    COUNT(*) FILTER (WHERE m.result = 'win_white' AND mp.team = 'black')
      + COUNT(*) FILTER (WHERE m.result = 'win_black' AND mp.team = 'white') AS losses,
    COALESCE(SUM(mp.goals), 0)::int AS goals,
    COALESCE(SUM(mp.yellow_cards), 0)::int AS yellows,
    COALESCE(SUM(mp.red_cards), 0)::int AS reds,
    COUNT(*) FILTER (WHERE m.motm_user_id = mp.profile_id)::int AS motms,
    COUNT(*)::int AS matches_played
  FROM matches m
  JOIN match_players mp ON mp.match_id = m.id
  JOIN profiles pr ON pr.id = mp.profile_id
  WHERE m.approved_at IS NOT NULL
    AND mp.profile_id IS NOT NULL
    AND pr.deleted_at IS NULL
  GROUP BY m.season_id, mp.profile_id, pr.display_name
),
scored AS (
  SELECT *,
    (wins * 3 + draws) AS points,
    (yellows + reds) AS total_cards
  FROM base
),
ballon AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY season_id ORDER BY points DESC, wins DESC, total_cards ASC, display_name ASC) AS rn
  FROM scored
),
boot AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY season_id ORDER BY goals DESC, wins DESC, total_cards ASC, display_name ASC) AS rn
  FROM scored
),
motm AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY season_id ORDER BY motms DESC, wins DESC, total_cards ASC, display_name ASC) AS rn
  FROM scored
)
SELECT
  b1.season_id,
  'ballon_dor'::text AS award_kind,
  b1.profile_id AS winner_profile_id,
  b2.profile_id AS runner_up_profile_id,
  b1.points::numeric AS metric_value,
  b2.points::numeric AS runner_up_metric,
  jsonb_build_object(
    'wins', b1.wins, 'draws', b1.draws, 'losses', b1.losses,
    'matches_played', b1.matches_played,
    'win_pct', CASE WHEN b1.matches_played > 0 THEN ROUND((b1.wins::numeric / b1.matches_played) * 100) ELSE 0 END
  ) AS meta
FROM ballon b1
LEFT JOIN ballon b2 ON b2.season_id = b1.season_id AND b2.rn = 2
WHERE b1.rn = 1
UNION ALL
SELECT
  b1.season_id,
  'golden_boot'::text,
  b1.profile_id,
  b2.profile_id,
  b1.goals::numeric,
  b2.goals::numeric,
  jsonb_build_object(
    'matches_played', b1.matches_played,
    'goals_per_match', CASE WHEN b1.matches_played > 0 THEN ROUND(b1.goals::numeric / b1.matches_played, 2) ELSE 0 END
  )
FROM boot b1
LEFT JOIN boot b2 ON b2.season_id = b1.season_id AND b2.rn = 2
WHERE b1.rn = 1
UNION ALL
SELECT
  m1.season_id,
  'most_motm'::text,
  m1.profile_id,
  m2.profile_id,
  m1.motms::numeric,
  m2.motms::numeric,
  jsonb_build_object('matches_played', m1.matches_played)
FROM motm m1
LEFT JOIN motm m2 ON m2.season_id = m1.season_id AND m2.rn = 2
WHERE m1.rn = 1;

GRANT SELECT ON v_season_award_winners_live TO authenticated;

-- =============================================================
-- 3. Snapshot trigger — fires on seasons.ended_at NULL → NOT NULL transition
-- =============================================================
CREATE OR REPLACE FUNCTION snapshot_season_awards_trigger() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO season_awards (season_id, award_kind, winner_profile_id, runner_up_profile_id, metric_value, runner_up_metric, meta)
  SELECT season_id, award_kind, winner_profile_id, runner_up_profile_id, metric_value, runner_up_metric, meta
  FROM v_season_award_winners_live
  WHERE season_id = NEW.id
    AND winner_profile_id IS NOT NULL  -- skip 0-match seasons
  ON CONFLICT (season_id, award_kind) DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS season_awards_snapshot ON seasons;
CREATE TRIGGER season_awards_snapshot
  AFTER UPDATE OF ended_at ON seasons
  FOR EACH ROW
  EXECUTE FUNCTION snapshot_season_awards_trigger();
```

- [ ] **Step 1.3: Apply migration**

Run:
```bash
npx supabase db push --linked
```

Expected output: `Applying migration 0047_phase3_awards.sql...` then `Finished supabase db push.`

- [ ] **Step 1.4: Spot-check view returns 3 rows per active season**

Run:
```bash
npx supabase db query --linked "SELECT season_id, COUNT(*) AS award_rows FROM v_season_award_winners_live GROUP BY season_id;"
```

Expected: every season with ≥ 1 approved match has `award_rows = 3`. Seasons with 0 approved matches absent from result (correct — view returns nothing for them).

- [ ] **Step 1.5: Spot-check Ballon d'Or winner**

Run (substitute the active season id from `SELECT id, name FROM seasons WHERE ended_at IS NULL`):
```bash
npx supabase db query --linked "SELECT v.winner_profile_id, p.display_name, v.metric_value, v.runner_up_metric, v.meta FROM v_season_award_winners_live v JOIN profiles p ON p.id = v.winner_profile_id WHERE v.award_kind = 'ballon_dor' AND v.season_id = '<active-season-id>';"
```

Expected: one row with the player who has highest `wins*3 + draws` (no late-cancel penalty applied — verify against raw match data, not against `v_season_standings.points` which DOES include penalty).

- [ ] **Step 1.6: Spot-check trigger fires (transactional, rolled back)**

Run:
```bash
npx supabase db query --linked "BEGIN; UPDATE seasons SET ended_at = now() WHERE id = (SELECT id FROM seasons WHERE ended_at IS NULL LIMIT 1); SELECT season_id, award_kind, winner_profile_id FROM season_awards WHERE season_id = (SELECT id FROM seasons WHERE ended_at IS NULL LIMIT 1); ROLLBACK;"
```

Expected: 3 rows in `season_awards` for the test season inside the transaction, then ROLLBACK leaves DB unchanged. Verify zero rows after:
```bash
npx supabase db query --linked "SELECT COUNT(*) FROM season_awards;"
```
Expected: 0.

- [ ] **Step 1.7: Commit**

```bash
git add supabase/migrations/0047_phase3_awards.sql
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(s053): mig 0047 — Phase 3 awards table + view + snapshot trigger

V3.0:139. New season_awards snapshot table (3 rows per ended season),
v_season_award_winners_live view (live computation for active season
with deterministic tie-break cascade), AFTER UPDATE OF ended_at
trigger that INSERT … SELECT from view ON CONFLICT DO NOTHING.

Awards points formula intentionally wins*3 + draws (no late-cancel
term) — celebrates match performance, diverges from leaderboard
points by design.

Spot-checks: 3 rows per active season in view; trigger fires + idempotent."
```

---

## Task 2: Regenerate Supabase types

**Files:**
- Modify: `ffc/src/lib/database.types.ts`

- [ ] **Step 2.1: Regenerate types**

Run from repo root:
```bash
npx supabase gen types typescript --linked 2>/dev/null > ffc/src/lib/database.types.ts
```

Note: the `2>/dev/null` redirect is mandatory (CLAUDE.md gotcha — diagnostic on stdout otherwise corrupts file).

- [ ] **Step 2.2: Verify new types are present**

Run:
```bash
grep -c "season_awards" ffc/src/lib/database.types.ts
grep -c "v_season_award_winners_live" ffc/src/lib/database.types.ts
```
Expected: both > 0 (table appears in `Tables`, view in `Views`).

Run:
```bash
node ./node_modules/typescript/bin/tsc -b
```
Expected: EXIT 0 (existing code still compiles against regenerated types).

- [ ] **Step 2.3: Commit**

```bash
git add ffc/src/lib/database.types.ts
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "chore(s053): regen Supabase types for Phase 3 awards table + view"
```

---

## Task 3: Awards page skeleton + route

**Files:**
- Create: `ffc/src/pages/Awards.tsx`
- Modify: `ffc/src/App.tsx`

- [ ] **Step 3.1: Create the skeleton component**

Create `ffc/src/pages/Awards.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Database } from '../lib/database.types'

/* §3.24 Awards page (S053, V3.0:139).
 * Routes:
 *   /awards                            → active season default
 *   /awards?season_id=<uuid>           → specific season (active or ended)
 * Active season:  reads v_season_award_winners_live (live computation)
 * Ended season:   reads season_awards snapshot table
 * Wall of Fame:   reads season_awards table only (ended seasons)
 */

type AwardKind = 'ballon_dor' | 'golden_boot' | 'most_motm'

interface SeasonRow {
  id: string
  name: string
  starts_on: string
  ended_at: string | null
  archived_at: string | null
}

interface WinnerRow {
  award_kind: AwardKind
  winner_profile_id: string | null
  runner_up_profile_id: string | null
  metric_value: number
  runner_up_metric: number | null
  meta: Record<string, number> | null
}

interface ProfileLite {
  id: string
  display_name: string
  avatar_url: string | null
  deleted_at: string | null
}

interface WallOfFameRow {
  season_id: string
  season_name: string
  ballon_dor: ProfileLite | null
  golden_boot: ProfileLite | null
  most_motm: ProfileLite | null
}

export default function Awards() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const seasonIdParam = searchParams.get('season_id')

  const [season, setSeason] = useState<SeasonRow | null>(null)
  const [seasons, setSeasons] = useState<SeasonRow[]>([])
  const [winners, setWinners] = useState<WinnerRow[]>([])
  const [profilesById, setProfilesById] = useState<Record<string, ProfileLite>>({})
  const [wallOfFame, setWallOfFame] = useState<WallOfFameRow[]>([])
  const [loading, setLoading] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)

  const isActiveSeason = season != null && season.ended_at == null

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      // Implementation lands in Task 4
      if (!cancelled) setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [seasonIdParam])

  return (
    <section className="aw-screen">
      <button type="button" className="aw-back" onClick={() => navigate(-1)}>‹ Back</button>
      <h1 className="aw-h1">{season ? `${season.name} Awards` : 'Awards'}</h1>
      <div className="aw-sub">
        {isActiveSeason ? 'PROVISIONAL' : 'FINAL'}
        <span className={`aw-badge ${isActiveSeason ? 'aw-badge--active' : 'aw-badge--ended'}`}>
          {isActiveSeason ? 'Active' : 'Ended'}
        </span>
      </div>
      {loading && <div className="aw-loading">Loading awards…</div>}
      {/* Hero cards land in Task 4, Wall of Fame in Task 5 */}
    </section>
  )
}
```

- [ ] **Step 3.2: Add the route**

Modify `ffc/src/App.tsx`. Find the existing `<Routes>` block inside the `RoleLayout` element (alongside Profile, Settings, Leaderboard).

Find:
```tsx
<Route path="/leaderboard" element={<Leaderboard />} />
```

Add a new line directly after it:
```tsx
<Route path="/awards" element={<Awards />} />
```

Add the import at the top of `App.tsx`:
```tsx
import Awards from './pages/Awards'
```

- [ ] **Step 3.3: Build verify**

Run:
```bash
node ./node_modules/typescript/bin/tsc -b
```
Expected: EXIT 0.

Run:
```bash
node ./node_modules/vite/bin/vite.js build
```
Expected: EXIT 0; PWA precache count incremented (new bundled chunk).

- [ ] **Step 3.4: Commit**

```bash
git add ffc/src/pages/Awards.tsx ffc/src/App.tsx
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(s053): scaffold Awards page + /awards route

Phase 3 V3.0:139 — empty skeleton with header, sub, loading state.
Hero cards (Task 4) and Wall of Fame (Task 5) land next."
```

---

## Task 4: Hero cards + active/ended data fetching + CSS

**Files:**
- Modify: `ffc/src/pages/Awards.tsx`
- Modify: `ffc/src/index.css`

- [ ] **Step 4.1: Replace the empty `useEffect` with full data load**

Replace the placeholder `load()` body in `Awards.tsx` with:

```tsx
useEffect(() => {
  let cancelled = false
  async function load() {
    setLoading(true)

    // 1. Load all seasons for the picker
    const { data: allSeasons } = await supabase
      .from('seasons')
      .select('id, name, starts_on, ended_at, archived_at')
      .order('starts_on', { ascending: false })
      .returns<SeasonRow[]>()
    if (cancelled) return

    // 2. Pick target season
    const targetSeason = (() => {
      if (!allSeasons) return null
      if (seasonIdParam) return allSeasons.find((s) => s.id === seasonIdParam) ?? null
      return allSeasons.find((s) => s.ended_at == null) ?? allSeasons[0] ?? null
    })()
    if (!targetSeason) { setLoading(false); return }

    // 3. Fetch winners — view for active, snapshot table for ended
    const winnersQuery = targetSeason.ended_at == null
      ? supabase.from('v_season_award_winners_live').select('award_kind, winner_profile_id, runner_up_profile_id, metric_value, runner_up_metric, meta').eq('season_id', targetSeason.id)
      : supabase.from('season_awards').select('award_kind, winner_profile_id, runner_up_profile_id, metric_value, runner_up_metric, meta').eq('season_id', targetSeason.id)

    const { data: winnerRows } = await winnersQuery.returns<WinnerRow[]>()
    if (cancelled) return

    // 4. Fetch profiles for all winners + runner-ups in one query
    const profileIds = new Set<string>()
    ;(winnerRows ?? []).forEach((w) => {
      if (w.winner_profile_id) profileIds.add(w.winner_profile_id)
      if (w.runner_up_profile_id) profileIds.add(w.runner_up_profile_id)
    })
    const profileMap: Record<string, ProfileLite> = {}
    if (profileIds.size > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url, deleted_at')
        .in('id', Array.from(profileIds))
        .returns<ProfileLite[]>()
      ;(profiles ?? []).forEach((p) => { profileMap[p.id] = p })
    }
    if (cancelled) return

    setSeasons(allSeasons ?? [])
    setSeason(targetSeason)
    setWinners(winnerRows ?? [])
    setProfilesById(profileMap)
    setLoading(false)
  }
  void load()
  return () => { cancelled = true }
}, [seasonIdParam])
```

- [ ] **Step 4.2: Add the season pill + dropdown JSX**

Insert in the `return` after the `aw-sub` div, before the loading check:

```tsx
<div className="aw-season-pill-row">
  <button
    type="button"
    className="aw-season-pill"
    onClick={() => setPickerOpen((v) => !v)}
    aria-expanded={pickerOpen}
    aria-haspopup="menu"
  >
    {season?.name ?? '…'} · {season?.archived_at ? 'archived' : season?.ended_at ? 'ended' : 'ongoing'}
    <span className="aw-caret" aria-hidden>▾</span>
  </button>
  {pickerOpen && (
    <div className="aw-dropdown" role="menu">
      {seasons.map((s) => (
        <button
          key={s.id}
          type="button"
          role="menuitemradio"
          aria-checked={s.id === season?.id}
          className={`aw-dropdown-item${s.id === season?.id ? ' aw-dropdown-item--selected' : ''}`}
          onClick={() => {
            setPickerOpen(false)
            navigate(`/awards?season_id=${s.id}`)
          }}
        >
          <span>{s.name}</span>
          <span className="aw-dropdown-status">
            {s.archived_at ? 'archived' : s.ended_at ? 'ended' : 'ongoing'}
          </span>
        </button>
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 4.3: Add hero card render helper**

Add this helper function above the `return` statement in `Awards.tsx`:

```tsx
const HERO_META: Record<AwardKind, { trophy: string; title: string; metricLabel: (m: number, meta: Record<string, number> | null) => string }> = {
  ballon_dor: {
    trophy: '🏆',
    title: "Ballon d'Or",
    metricLabel: (m, meta) => {
      const wins = meta?.wins ?? 0
      const draws = meta?.draws ?? 0
      const losses = meta?.losses ?? 0
      const winPct = meta?.win_pct ?? 0
      return `${m} pts · ${wins}W ${draws}D ${losses}L · ${winPct}% win`
    },
  },
  golden_boot: {
    trophy: '⚽',
    title: 'Golden Boot',
    metricLabel: (m, meta) => {
      const gpm = meta?.goals_per_match ?? 0
      return `${m} goals · ${gpm} per match`
    },
  },
  most_motm: {
    trophy: '⭐',
    title: 'Most MOTM',
    metricLabel: (m, meta) => {
      const mp = meta?.matches_played ?? 0
      return `${m} MOTMs · in ${mp} matches`
    },
  },
}

function renderHero(
  row: WinnerRow,
  profilesById: Record<string, ProfileLite>,
  navigate: ReturnType<typeof useNavigate>,
  seasonId: string,
) {
  const winner = row.winner_profile_id ? profilesById[row.winner_profile_id] : null
  const runner = row.runner_up_profile_id ? profilesById[row.runner_up_profile_id] : null
  const heroDef = HERO_META[row.award_kind]
  const initials = winner?.display_name ? winner.display_name[0]?.toUpperCase() ?? '?' : '—'
  const winnerName = winner?.deleted_at ? 'Deleted player' : winner?.display_name ?? '—'
  const isDeleted = winner?.deleted_at != null
  return (
    <div className="aw-hero" key={row.award_kind}>
      <div className="aw-hero-trophy">{heroDef.trophy}</div>
      <div className="aw-hero-body">
        <div className="aw-hero-award">{heroDef.title}</div>
        <button
          type="button"
          className="aw-hero-name"
          disabled={isDeleted || !winner}
          onClick={() => winner && navigate(`/profile?profile_id=${winner.id}&season_id=${seasonId}`)}
        >
          {winnerName}
        </button>
        <div className="aw-hero-meta">
          <strong>{heroDef.metricLabel(Number(row.metric_value), row.meta)}</strong>
          {runner && (
            <span className="aw-hero-runner">
              2nd: <button
                type="button"
                className="aw-hero-runner-link"
                onClick={() => navigate(`/profile?profile_id=${runner.id}&season_id=${seasonId}`)}
              >{runner.deleted_at ? 'Deleted player' : runner.display_name}</button>
              {row.runner_up_metric != null && ` (${row.runner_up_metric})`}
            </span>
          )}
        </div>
      </div>
      <div className={`aw-hero-avatar${isDeleted ? ' aw-hero-avatar--deleted' : ''}`}>
        {winner?.avatar_url ? (
          <img src={winner.avatar_url} alt={winnerName} />
        ) : (
          initials
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4.4: Render hero cards in JSX**

Replace the `{/* Hero cards land in Task 4 ... */}` comment with:

```tsx
{!loading && season && winners.length === 0 && (
  <div className="aw-empty">
    <div className="aw-empty-trophy">🏆</div>
    <p>No matches played yet this season — awards will appear once results are in.</p>
  </div>
)}
{!loading && winners.length > 0 && (
  <div className="aw-heroes">
    {(['ballon_dor', 'golden_boot', 'most_motm'] as AwardKind[]).map((kind) => {
      const row = winners.find((w) => w.award_kind === kind)
      if (!row) return null
      return renderHero(row, profilesById, navigate, season?.id ?? '')
    })}
  </div>
)}
```

- [ ] **Step 4.5: Add awards CSS — hero cards + page chrome**

Append to `ffc/src/index.css`:

```css
/* ============================================================ */
/* §3.24 Awards page (S053, V3.0:139)                           */
/* ============================================================ */
.aw-screen {
  --gold: #e5ba5b;
  --gold-bright: #f7d878;
  --gold-deep: #c8a142;
  --bg: #0e1826;
  --surface: #182437;
  --surface-2: #223251;
  --text: #f2ead6;
  --text-muted: #85929f;
  --line: rgba(242, 234, 214, 0.08);
  --line-strong: rgba(242, 234, 214, 0.2);
  background: linear-gradient(180deg, var(--surface) 0%, var(--bg) 240px, var(--bg) 100%);
  color: var(--text);
  min-height: 100vh;
  padding-bottom: calc(80px + env(safe-area-inset-bottom));
  position: relative;
}
.aw-back {
  display: inline-block;
  padding: 12px 16px 0;
  color: var(--gold);
  font-size: 14px;
  font-weight: 600;
  background: transparent;
  border: 0;
  cursor: pointer;
}
.aw-h1 {
  font-family: "Fraunces", "Playfair Display", Georgia, serif;
  font-size: 26px;
  font-weight: 700;
  text-align: center;
  color: var(--gold-bright);
  padding: 8px 16px 2px;
  text-shadow: 0 2px 12px rgba(229, 186, 91, 0.3);
  margin: 0;
}
.aw-sub {
  text-align: center;
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding-bottom: 12px;
  font-weight: 600;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
}
.aw-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  border: 1px solid;
}
.aw-badge--active {
  background: rgba(229, 186, 91, 0.15);
  color: var(--gold);
  border-color: rgba(229, 186, 91, 0.3);
}
.aw-badge--ended {
  background: rgba(133, 146, 159, 0.15);
  color: var(--text-muted);
  border-color: rgba(133, 146, 159, 0.3);
}

.aw-season-pill-row { text-align: center; padding: 0 16px 16px; position: relative; }
.aw-season-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  font-size: 12px;
  color: var(--text);
  background: var(--surface);
  cursor: pointer;
}
.aw-caret { color: var(--text-muted); font-size: 11px; }
.aw-dropdown {
  position: absolute;
  top: 100%; left: 50%; transform: translateX(-50%);
  margin-top: 4px;
  min-width: 220px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  padding: 6px;
  z-index: 10;
  box-shadow: 0 10px 30px rgba(0,0,0,0.5);
}
.aw-dropdown-item {
  display: flex; justify-content: space-between; align-items: center;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: 0;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}
.aw-dropdown-item:hover { background: var(--surface-2); }
.aw-dropdown-item--selected { background: rgba(229, 186, 91, 0.1); color: var(--gold); }
.aw-dropdown-status { font-size: 10px; color: var(--text-muted); }

.aw-loading {
  text-align: center;
  color: var(--text-muted);
  padding: 32px 16px;
  font-style: italic;
}

.aw-empty {
  text-align: center;
  padding: 32px 16px;
  color: var(--text-muted);
}
.aw-empty-trophy {
  font-size: 48px;
  opacity: 0.3;
  margin-bottom: 12px;
}

.aw-heroes { padding: 0; }

.aw-hero {
  margin: 0 16px 12px;
  background: linear-gradient(135deg, rgba(229, 186, 91, 0.16) 0%, rgba(229, 186, 91, 0.04) 50%, transparent 100%);
  border: 1.5px solid rgba(229, 186, 91, 0.35);
  border-radius: 18px;
  padding: 16px;
  display: flex; align-items: center; gap: 14px;
  position: relative;
  overflow: hidden;
}
.aw-hero::before {
  content: ""; position: absolute; top: -40px; right: -40px;
  width: 140px; height: 140px;
  background: radial-gradient(circle, rgba(229, 186, 91, 0.2), transparent 70%);
  pointer-events: none;
}
.aw-hero-trophy {
  font-size: 44px; line-height: 1;
  filter: drop-shadow(0 4px 12px rgba(229, 186, 91, 0.45));
  flex-shrink: 0;
}
.aw-hero-body { flex: 1; min-width: 0; }
.aw-hero-award {
  font-size: 10px;
  font-weight: 800;
  color: var(--gold);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.aw-hero-name {
  font-family: "Fraunces", Georgia, serif;
  font-size: 22px;
  font-weight: 700;
  color: var(--gold-bright);
  line-height: 1.05;
  margin: 4px 0;
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-align: left;
  display: block;
}
.aw-hero-name:disabled { cursor: default; color: var(--text-muted); }
.aw-hero-meta {
  font-size: 12px;
  color: var(--text);
}
.aw-hero-meta strong { color: var(--text); font-weight: 700; }
.aw-hero-runner {
  display: block;
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 11px;
}
.aw-hero-runner-link {
  background: transparent;
  border: 0;
  color: var(--text-muted);
  text-decoration: underline;
  padding: 0;
  cursor: pointer;
  font-size: 11px;
}
.aw-hero-avatar {
  width: 60px; height: 60px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--gold-bright), var(--gold-deep));
  display: flex; align-items: center; justify-content: center;
  color: var(--bg); font-weight: 800; font-size: 26px;
  border: 3px solid var(--gold);
  box-shadow: 0 4px 16px rgba(229, 186, 91, 0.4);
  flex-shrink: 0;
  overflow: hidden;
}
.aw-hero-avatar img { width: 100%; height: 100%; object-fit: cover; }
.aw-hero-avatar--deleted {
  background: var(--text-muted);
  border-color: var(--text-muted);
  box-shadow: none;
  color: var(--bg);
}
```

- [ ] **Step 4.6: Build verify**

Run:
```bash
node ./node_modules/typescript/bin/tsc -b
```
Expected: EXIT 0.

Run:
```bash
node ./node_modules/vite/bin/vite.js build
```
Expected: EXIT 0.

- [ ] **Step 4.7: Commit**

```bash
git add ffc/src/pages/Awards.tsx ffc/src/index.css
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(s053): Awards page hero cards + season picker + CSS

3 hero cards (Ballon d'Or / Golden Boot / Most MOTM) read from
v_season_award_winners_live for active seasons or season_awards
snapshot for ended ones. Season picker dropdown lets user view any
season's awards. Hero name + runner-up tappable → /profile.
Soft-deleted winners render as 'Deleted player' (no nav). Empty
state when no matches played yet.

Wall of Fame (Task 5) lands next."
```

---

## Task 5: Wall of Fame + CSS

**Files:**
- Modify: `ffc/src/pages/Awards.tsx`
- Modify: `ffc/src/index.css`

- [ ] **Step 5.1: Add Wall of Fame fetch logic**

In `Awards.tsx` `load()` function, after the existing winners + profiles fetch, add a Wall of Fame query (only ENDED seasons, group rows by season client-side):

```tsx
// 5. Wall of Fame — all snapshot rows for ENDED seasons, joined to winner profiles
type WallRowRaw = {
  season_id: string
  award_kind: AwardKind
  winner_profile_id: string
  seasons: { name: string; ended_at: string | null } | null
  profile: { id: string; display_name: string; avatar_url: string | null; deleted_at: string | null } | null
}
const { data: wallRaw } = await supabase
  .from('season_awards')
  .select('season_id, award_kind, winner_profile_id, seasons!inner(name, ended_at), profile:profiles!winner_profile_id(id, display_name, avatar_url, deleted_at)')
  .order('season_id', { ascending: false })
  .returns<WallRowRaw[]>()
if (cancelled) return

const groupedBySeasonId = new Map<string, WallOfFameRow>()
;(wallRaw ?? []).forEach((row) => {
  if (!row.seasons || row.seasons.ended_at == null) return
  let bucket = groupedBySeasonId.get(row.season_id)
  if (!bucket) {
    bucket = {
      season_id: row.season_id,
      season_name: row.seasons.name,
      ballon_dor: null,
      golden_boot: null,
      most_motm: null,
    }
    groupedBySeasonId.set(row.season_id, bucket)
  }
  if (row.profile) bucket[row.award_kind] = row.profile as ProfileLite
})

// Sort by season ended_at desc — re-fetch ended_at to sort
const wallSorted = Array.from(groupedBySeasonId.values()).sort((a, b) => {
  const aEnded = (wallRaw ?? []).find((r) => r.season_id === a.season_id)?.seasons?.ended_at ?? ''
  const bEnded = (wallRaw ?? []).find((r) => r.season_id === b.season_id)?.seasons?.ended_at ?? ''
  return bEnded.localeCompare(aEnded)
})
setWallOfFame(wallSorted)
```

- [ ] **Step 5.2: Render Wall of Fame in JSX**

Append after the heroes block in the `return`:

```tsx
{!loading && (
  <div className="aw-wall-section">
    <div className="aw-wall-title">— Wall of Fame —</div>
    {wallOfFame.length === 0 ? (
      <div className="aw-wall-empty">
        First season — Wall of Fame begins after this season ends.
      </div>
    ) : (
      <div className="aw-wall-table-wrap">
        <div className="aw-wall-row aw-wall-header">
          <span>Season</span>
          <span>🏆 Ballon</span>
          <span>⚽ Boot</span>
          <span>⭐ MOTM</span>
        </div>
        {wallOfFame.map((row) => (
          <div key={row.season_id} className="aw-wall-row">
            <span className="aw-wall-season">{row.season_name}</span>
            {(['ballon_dor', 'golden_boot', 'most_motm'] as AwardKind[]).map((kind) => {
              const p = row[kind]
              if (!p) return <span key={kind} className="aw-wall-cell aw-wall-cell--empty">—</span>
              if (p.deleted_at) return <span key={kind} className="aw-wall-cell aw-wall-cell--deleted">Deleted player</span>
              return (
                <button
                  key={kind}
                  type="button"
                  className="aw-wall-cell aw-wall-cell--link"
                  onClick={() => navigate(`/profile?profile_id=${p.id}&season_id=${row.season_id}`)}
                >
                  {p.display_name}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 5.3: Add Wall of Fame CSS**

Append to `ffc/src/index.css` after the existing `.aw-hero-avatar--deleted` block:

```css
.aw-wall-section {
  margin-top: 18px;
  padding: 16px 16px 4px;
  border-top: 1px solid var(--line-strong);
}
.aw-wall-title {
  font-family: "Fraunces", Georgia, serif;
  font-size: 16px;
  color: var(--text);
  text-align: center;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 700;
  margin-bottom: 10px;
}
.aw-wall-table-wrap { margin: 0; overflow-x: auto; }
.aw-wall-row {
  display: grid;
  grid-template-columns: 50px 1fr 1fr 1fr;
  gap: 6px;
  align-items: center;
  padding: 9px 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  margin-bottom: 4px;
  font-size: 12px;
}
.aw-wall-header {
  background: transparent;
  border: 0;
  color: var(--text-muted);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0 12px 4px;
}
.aw-wall-season {
  color: var(--gold);
  font-weight: 800;
  font-size: 13px;
}
.aw-wall-cell {
  color: var(--text);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  background: transparent;
  border: 0;
  padding: 0;
}
.aw-wall-cell--link { cursor: pointer; }
.aw-wall-cell--link:hover { color: var(--gold); }
.aw-wall-cell--empty { color: var(--text-muted); }
.aw-wall-cell--deleted { color: var(--text-muted); font-style: italic; }
.aw-wall-empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
  padding: 24px 16px;
  font-style: italic;
}
```

- [ ] **Step 5.4: Build verify**

Run:
```bash
node ./node_modules/typescript/bin/tsc -b
```
Expected: EXIT 0.

Run:
```bash
node ./node_modules/vite/bin/vite.js build
```
Expected: EXIT 0.

- [ ] **Step 5.5: Commit**

```bash
git add ffc/src/pages/Awards.tsx ffc/src/index.css
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(s053): Awards Wall of Fame tabular grid

Reads season_awards snapshot table for all ENDED seasons, joined to
winner profiles, grouped client-side into rows of (season, ballon,
boot, motm). Clickable name cells navigate to profile filtered to
that season. Deleted past winners render greyed/italic. Empty state
('First season — Wall of Fame begins after this season ends') for
fresh installs / pre-Phase-3 ledger."
```

---

## Task 6: Leaderboard trophy entry button

**Files:**
- Modify: `ffc/src/pages/Leaderboard.tsx`
- Modify: `ffc/src/index.css`

- [ ] **Step 6.1: Add TrophyIcon component**

In `ffc/src/pages/Leaderboard.tsx`, find the existing `SortIcon` definition (around line 80–95). Add a new component definition immediately after it:

```tsx
const TrophyIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </svg>
)
```

- [ ] **Step 6.2: Add the icon-button to the controls row**

Find the closing `</div>` of the third `lb-icon-wrap` (the one wrapping the SortIcon, around line 668). Insert a new `lb-icon-wrap` block immediately after it but before the closing `</div>` of `lb-controls-row`:

```tsx
<div className="lb-icon-wrap">
  <button
    type="button"
    className="lb-icon-btn lb-icon-btn--awards"
    onClick={() => navigate(`/awards?season_id=${selectedSeasonId ?? ''}`)}
    aria-label="View season awards"
  >
    <TrophyIcon />
  </button>
</div>
```

Note: `selectedSeasonId` is the existing state variable holding the leaderboard's currently-selected season id (already in scope at line 532).

- [ ] **Step 6.3: Add lb-icon-btn--awards CSS variant**

In `ffc/src/index.css`, find the existing `.lb-icon-btn` block (around line 1153). Add the new variant rule immediately after the `.lb-icon-btn-badge` rule (around line 1183):

```css
.lb-icon-btn--awards {
  border-color: rgba(229, 186, 91, 0.4);
  color: var(--accent, #e5ba5b);
  background: rgba(229, 186, 91, 0.06);
  box-shadow: 0 0 12px rgba(229, 186, 91, 0.2);
}
.lb-icon-btn--awards:hover {
  background: rgba(229, 186, 91, 0.12);
}
```

Note: the FFC palette uses `--accent` for the warm gold color.

- [ ] **Step 6.4: Build verify**

Run:
```bash
node ./node_modules/typescript/bin/tsc -b
```
Expected: EXIT 0.

Run:
```bash
node ./node_modules/vite/bin/vite.js build
```
Expected: EXIT 0.

- [ ] **Step 6.5: Commit**

```bash
git add ffc/src/pages/Leaderboard.tsx ffc/src/index.css
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(s053): Leaderboard trophy entry button → /awards

New TrophyIcon SVG + 3rd lb-icon-wrap after Filter + Sort. Gold-tinted
variant (lb-icon-btn--awards) with subtle glow. Tap → navigates to
/awards?season_id=<currently-selected-leaderboard-season>."
```

---

## Task 7: Final verification + push

**Files:** none modified — verification + push only.

- [ ] **Step 7.1: Full repo build verify**

Run:
```bash
node ./node_modules/typescript/bin/tsc -b
node ./node_modules/vite/bin/vite.js build
```
Both EXIT 0. Inspect `dist/sw.mjs` size and PWA precache count — should be incremented from prior baseline.

- [ ] **Step 7.2: Check git log shape**

Run:
```bash
git log --oneline d8c8938..HEAD
```

Expected 7 commits (mockup + spec + plan + 6 feat commits from this implementation):
- `82ae899` docs(s053): Phase 3 awards page mockups — approved
- `134a840` docs(s053): Phase 3 awards page design spec
- `<hash>` docs(s053): Phase 3 awards page implementation plan
- `<hash>` feat(s053): mig 0047 — Phase 3 awards table + view + snapshot trigger
- `<hash>` chore(s053): regen Supabase types for Phase 3 awards table + view
- `<hash>` feat(s053): scaffold Awards page + /awards route
- `<hash>` feat(s053): Awards page hero cards + season picker + CSS
- `<hash>` feat(s053): Awards Wall of Fame tabular grid
- `<hash>` feat(s053): Leaderboard trophy entry button → /awards

- [ ] **Step 7.3: Push**

Run:
```bash
git push origin main
```

Expected: clean fast-forward push, no force needed.

- [ ] **Step 7.4: Verify Vercel deploy queued**

Vercel auto-deploys from `main`. Wait for the deploy to complete, then run live verification checklist (deferred to a follow-up since auth-gated screens can't run in preview):

- [ ] `/leaderboard` shows new gold trophy icon-btn after Filter + Sort
- [ ] Tap trophy → navigates to `/awards?season_id=<current>`
- [ ] Awards page renders with serif gold "Season N Awards" + PROVISIONAL/Active or FINAL/Ended subtitle + season pill
- [ ] 3 hero cards render with correct winners + metrics + runner-ups (cross-check via SQL spot-check)
- [ ] Wall of Fame lists ended seasons (initially empty until S11 ends OR backfill runs)
- [ ] Hero name tap → profile page filtered to that season
- [ ] Season pill switches to a different season + reloads winners
- [ ] Soft-deleted past winner renders muted "Deleted player" (when applicable)

---

## Self-Review

Spec coverage spot-check (full pass per writing-plans skill):

- §1 IA & Routing → Task 3 (route), Task 6 (entry button)
- §2 Layout → Task 3 (skeleton), Task 4 (hero + season pill), Task 5 (Wall of Fame)
- §3 Active vs Ended behavior → Task 4 (view/table branching)
- §4 DB layer → Task 1 (full migration)
- §5 Frontend changes → Tasks 3–6 cover Awards.tsx, App.tsx, Leaderboard.tsx, index.css per spec's file manifest
- §6 Verification → Task 1 (DB spot-checks), Task 7 (build + push + live checklist)
- §7 File manifest → matches Tasks 1–6 exactly
- §8 Risks → backfill explicitly out-of-scope (matches spec); other risks addressed inline (FK RESTRICT for soft-delete, ON CONFLICT for trigger idempotency)
- §9 Acceptance criteria → all checked across Tasks 1–7

Type/method consistency: `WinnerRow.meta` typed `Record<string, number> | null`, accessed in `HERO_META` definitions consistently; `AwardKind` literal union used in both helper and JSX; `WallOfFameRow.season_id` matches the snapshot table schema exactly.

No placeholders, no "implement later" stubs, no missing code blocks. Every step has runnable commands and full code where applicable.

---

## Out-of-scope (post-S053 follow-ups)

- Backfill RPC `backfill_season_awards()` for ended seasons predating this migration. New manual migration `0048` if needed; runs `INSERT … SELECT FROM v_season_award_winners_live WHERE season_id IN (SELECT id FROM seasons WHERE ended_at IS NOT NULL)` + `ON CONFLICT DO NOTHING`. Wall of Fame stays empty until then OR until S11 naturally ends.
- WhatsApp PNG share (V3.0:140)
- Awards-end push notification (when `ended_at` flips, push admins + winners)
- Best Defender / Worst Discipline awards (table CHECK extends without schema change)
