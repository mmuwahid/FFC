# Matches Flashcard Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current one-line Matches row with a split-colour flashcard per [docs/superpowers/specs/2026-04-23-matches-flashcard-design.md](docs/superpowers/specs/2026-04-23-matches-flashcard-design.md), and add a minimal AdminSeasons page so admins can set `planned_games` for the `GAME N / TOTAL` banner.

**Architecture:** One new migration adds the nullable `seasons.planned_games` column + `create_season` / `update_season_planned_games` SECURITY DEFINER RPCs. One new React page (`AdminSeasons.tsx`) wired into the admin router. One rewrite of `Matches.tsx` replacing the `mt-row` markup with `splitc-*` markup driven by an extended matches query (`match_players` embed for scorers + `seasons.planned_games` for the denominator).

**Tech Stack:** Supabase Postgres + PostgREST embeds · React 19 / Vite 8 · TypeScript 6 · `npx supabase` CLI.

---

## File Structure

Files this plan creates or touches:

| Path | Responsibility |
|---|---|
| `supabase/migrations/0020_seasons_planned_games.sql` | Adds `seasons.planned_games`, `create_season` RPC, `update_season_planned_games` RPC. |
| `ffc/src/pages/admin/AdminSeasons.tsx` | Admin UI — list seasons, create a new one, edit `planned_games` on active seasons, archive ended ones. |
| `ffc/src/pages/admin/AdminHome.tsx` | One-line edit: add `<Link to="/admin/seasons">`. |
| `ffc/src/router.tsx` | One-line edit: register `/admin/seasons` route. |
| `ffc/src/pages/Matches.tsx` | Rewrite row markup to the flashcard; extend query with `match_players` embed + `planned_games`. |
| `ffc/src/styles/matches.css` | **New** — `splitc-*` classes per the mockup. `Matches.tsx` imports it. Keeps the existing `mt-*` classes intact during the rewrite (they're replaced in Matches.tsx but we won't rip them out until after QA — Match Detail and other pages don't use `mt-*` today, so deletion in a follow-up is safe). |
| `ffc/src/lib/database.types.ts` | Regenerated via `supabase gen types typescript --linked 2>/dev/null` after the migration applies. |

The scoreboard markup inside `Matches.tsx` is pulled into a local component (`MatchCard`) in the same file — keeps the list-rendering loop small. We do **not** create a separate component file; `Matches.tsx` is the only consumer and the file stays under 400 lines.

No test framework is set up in the FFC frontend today (verified: no `vitest`, no `*.test.tsx` in `ffc/src/**`). This plan therefore uses **visual verification via the Vite preview** and **SQL verification via `npx supabase db query --linked`** in place of automated tests. Each task ends with a concrete verification step and a commit.

---

## Task 1: Migration — add `seasons.planned_games` + season RPCs

**Files:**
- Create: `supabase/migrations/0020_seasons_planned_games.sql`

- [ ] **Step 1: Write the migration file**

Write `supabase/migrations/0020_seasons_planned_games.sql` with the full content below. All three statements (column add, `create_season`, `update_season_planned_games`) go in one file — they ship together.

```sql
-- 0020_seasons_planned_games.sql
-- Adds planned_games column + admin RPCs for creating/editing seasons.
-- Driven by Matches flashcard spec (2026-04-23).

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- 1. seasons.planned_games
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE seasons
  ADD COLUMN planned_games int
    CHECK (planned_games IS NULL OR planned_games >= 1);

COMMENT ON COLUMN seasons.planned_games IS
  'Total number of games planned for the season. Nullable = not set yet; Matches banner then renders "GAME N" with no denominator.';

-- ═══════════════════════════════════════════════════════════════
-- 2. create_season(name, starts_on, planned_games, default_format, roster_policy)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION create_season(
  p_name           text,
  p_starts_on      date,
  p_planned_games  int,
  p_default_format match_format DEFAULT '7v7',
  p_roster_policy  roster_policy DEFAULT 'carry_forward'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_id uuid;
  v_season_id uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  v_caller_id := current_profile_id();

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Season name required' USING ERRCODE = '22023';
  END IF;

  IF p_starts_on IS NULL THEN
    RAISE EXCEPTION 'Season starts_on required' USING ERRCODE = '22023';
  END IF;

  IF p_planned_games IS NOT NULL AND p_planned_games < 1 THEN
    RAISE EXCEPTION 'planned_games must be >= 1' USING ERRCODE = '22023';
  END IF;

  INSERT INTO seasons (name, starts_on, planned_games, default_format, roster_policy, created_by)
  VALUES (trim(p_name), p_starts_on, p_planned_games, p_default_format, p_roster_policy, v_caller_id)
  RETURNING id INTO v_season_id;

  PERFORM log_admin_action('seasons', v_season_id, 'create_season',
    jsonb_build_object(
      'name', trim(p_name),
      'starts_on', p_starts_on,
      'planned_games', p_planned_games,
      'default_format', p_default_format,
      'roster_policy', p_roster_policy
    ));

  RETURN v_season_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_season(text, date, int, match_format, roster_policy) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 3. update_season_planned_games(season_id, planned_games)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_season_planned_games(
  p_season_id     uuid,
  p_planned_games int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  IF p_planned_games IS NOT NULL AND p_planned_games < 1 THEN
    RAISE EXCEPTION 'planned_games must be >= 1' USING ERRCODE = '22023';
  END IF;

  UPDATE seasons
     SET planned_games = p_planned_games
   WHERE id = p_season_id
     AND ended_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season not found or already ended' USING ERRCODE = '22023';
  END IF;

  PERFORM log_admin_action('seasons', p_season_id, 'update_season_planned_games',
    jsonb_build_object('planned_games', p_planned_games));
END;
$$;

GRANT EXECUTE ON FUNCTION update_season_planned_games(uuid, int) TO authenticated;

COMMIT;
```

- [ ] **Step 2: Apply the migration**

Run:
```
cd "C:/Users/UNHOEC03/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC"
npx supabase db push --linked
```
Expected output: `Applying migration 0020_seasons_planned_games.sql... ✓` and the migration count reported as 20.

- [ ] **Step 3: Verify column + RPCs exist**

Run:
```
npx supabase db query --linked <<'SQL'
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='seasons' AND column_name='planned_games';

SELECT proname, pg_get_function_arguments(oid)
  FROM pg_proc
 WHERE proname IN ('create_season','update_season_planned_games');
SQL
```
Expected: one row for `planned_games | integer | YES`; two rows in `pg_proc` with the argument signatures from the migration.

- [ ] **Step 4: Smoke-test the RPCs against the live DB**

Run (substitute `<SUPER_ADMIN_PROFILE_ID>` with `cce905a8...` from `CLAUDE.md`):
```
npx supabase db query --linked <<'SQL'
-- As the super-admin session. Using SET ROLE is not available in hosted
-- projects, so instead verify via the seeded super-admin session:
-- exercise the RPC by calling it via the dashboard SQL editor with role=authenticated
-- and user_id set to m.muwahid@gmail.com, OR skip and rely on manual UI test in Task 4.
SELECT 'manual UI test required' AS note;
SQL
```
Expected: returns the note row. The RPC will be exercised end-to-end in Task 4 (AdminSeasons UI) and Task 5 (Matches.tsx renders banner with/without denominator).

- [ ] **Step 5: Regenerate TypeScript types**

Run:
```
npx supabase gen types typescript --linked 2>/dev/null > ffc/src/lib/database.types.ts
```
Then open `ffc/src/lib/database.types.ts` and verify it contains both:
- `planned_games: number | null` on the `seasons` Row type
- `create_season` and `update_season_planned_games` entries under `Database['public']['Functions']`

- [ ] **Step 6: Commit**

```
cd "C:/Users/UNHOEC03/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC"
git add supabase/migrations/0020_seasons_planned_games.sql ffc/src/lib/database.types.ts
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(db): seasons.planned_games + create_season / update_season_planned_games RPCs

Migration 0020. planned_games is nullable so existing seasons stay valid;
create_season RPC is admin-only, audited. update_season_planned_games lets
admins edit only while a season is active (ended_at IS NULL)."
```

---

## Task 2: AdminSeasons page — list + create form

**Files:**
- Create: `ffc/src/pages/admin/AdminSeasons.tsx`

Full page in one go — list of seasons and a "new season" form at the top. No bottom sheet, no separate edit screen. Edit of `planned_games` is inline (Task 3 adds it).

- [ ] **Step 1: Write the page skeleton with season list**

Write `ffc/src/pages/admin/AdminSeasons.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

type SeasonRow = Pick<
  Database['public']['Tables']['seasons']['Row'],
  'id' | 'name' | 'starts_on' | 'ends_on' | 'planned_games' |
  'default_format' | 'roster_policy' | 'ended_at' | 'archived_at'
>

type MatchFormat = Database['public']['Enums']['match_format']
type RosterPolicy = Database['public']['Enums']['roster_policy']

function statusLabel(row: SeasonRow): string {
  if (row.archived_at) return 'ARCHIVED'
  if (row.ended_at) return 'ENDED'
  return 'ACTIVE'
}

export function AdminSeasons() {
  const [seasons, setSeasons] = useState<SeasonRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // Create form state
  const [newName, setNewName] = useState('')
  const [newStartsOn, setNewStartsOn] = useState('')
  const [newPlanned, setNewPlanned] = useState<string>('')
  const [newFormat, setNewFormat] = useState<MatchFormat>('7v7')
  const [newPolicy, setNewPolicy] = useState<RosterPolicy>('carry_forward')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    const { data, error } = await supabase
      .from('seasons')
      .select('id, name, starts_on, ends_on, planned_games, default_format, roster_policy, ended_at, archived_at')
      .order('starts_on', { ascending: false })
    if (error) { setErr(error.message); setLoading(false); return }
    setSeasons((data ?? []) as SeasonRow[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const onCreate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (!newName.trim() || !newStartsOn) { setErr('Name and start date are required'); return }
    const planned = newPlanned.trim() === '' ? null : Number(newPlanned)
    if (planned !== null && (!Number.isInteger(planned) || planned < 1)) {
      setErr('Planned games must be a whole number ≥ 1'); return
    }
    setCreating(true)
    const { error } = await supabase.rpc('create_season', {
      p_name: newName,
      p_starts_on: newStartsOn,
      p_planned_games: planned,
      p_default_format: newFormat,
      p_roster_policy: newPolicy,
    })
    setCreating(false)
    if (error) { setErr(error.message); return }
    setNewName(''); setNewStartsOn(''); setNewPlanned('')
    setNewFormat('7v7'); setNewPolicy('carry_forward')
    await load()
  }, [newName, newStartsOn, newPlanned, newFormat, newPolicy, load])

  return (
    <div style={{ padding: '16px', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Admin · Seasons</h1>

      <form onSubmit={onCreate} style={{
        background: '#152038', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10, padding: 14, marginBottom: 20,
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
      }}>
        <div style={{ gridColumn: '1 / -1', fontWeight: 700, fontSize: 13, letterSpacing: 0.12, textTransform: 'uppercase', color: '#60a5fa' }}>New season</div>
        <label>Name
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Season 2" style={{ width: '100%' }} />
        </label>
        <label>Starts on
          <input type="date" value={newStartsOn} onChange={e => setNewStartsOn(e.target.value)} style={{ width: '100%' }} />
        </label>
        <label>Planned games (optional)
          <input type="number" min={1} value={newPlanned} onChange={e => setNewPlanned(e.target.value)} placeholder="e.g. 30" style={{ width: '100%' }} />
        </label>
        <label>Format
          <select value={newFormat} onChange={e => setNewFormat(e.target.value as MatchFormat)} style={{ width: '100%' }}>
            <option value="7v7">7v7</option>
            <option value="5v5">5v5</option>
          </select>
        </label>
        <label>Roster policy
          <select value={newPolicy} onChange={e => setNewPolicy(e.target.value as RosterPolicy)} style={{ width: '100%' }}>
            <option value="carry_forward">carry_forward</option>
            <option value="fresh">fresh</option>
          </select>
        </label>
        <div style={{ gridColumn: '1 / -1' }}>
          <button type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create season'}
          </button>
          {err && <span style={{ color: '#f87171', marginLeft: 10 }}>{err}</span>}
        </div>
      </form>

      {loading ? (
        <div>Loading…</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#8b97ad', fontSize: 11, letterSpacing: 0.1, textTransform: 'uppercase' }}>
              <th style={{ padding: '6px 4px' }}>Name</th>
              <th style={{ padding: '6px 4px' }}>Starts</th>
              <th style={{ padding: '6px 4px' }}>Planned</th>
              <th style={{ padding: '6px 4px' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {seasons.map(s => (
              <tr key={s.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <td style={{ padding: '8px 4px', fontWeight: 600 }}>{s.name}</td>
                <td style={{ padding: '8px 4px' }}>{s.starts_on}</td>
                <td style={{ padding: '8px 4px' }}>{s.planned_games ?? '—'}</td>
                <td style={{ padding: '8px 4px' }}>{statusLabel(s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify the page compiles**

Run:
```
cd "C:/Users/UNHOEC03/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC/ffc"
node ./node_modules/typescript/bin/tsc --noEmit
```
Expected: exit code 0, no errors involving `AdminSeasons.tsx`. (The page is not yet routed, so it will be tree-shaken — this is just a type check.)

- [ ] **Step 3: Commit**

```
cd "C:/Users/UNHOEC03/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC"
git add ffc/src/pages/admin/AdminSeasons.tsx
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(admin): AdminSeasons page — list + create form

Calls create_season RPC (admin-only). Lists all seasons with status
(ACTIVE / ENDED / ARCHIVED). Inline planned_games edit added in next commit."
```

---

## Task 3: AdminSeasons — inline `planned_games` edit for active seasons

**Files:**
- Modify: `ffc/src/pages/admin/AdminSeasons.tsx`

- [ ] **Step 1: Add editing state + the save helper**

In `AdminSeasons.tsx`, immediately after the existing `const [creating, setCreating] = useState(false)` line inside the component, add:

```tsx
  // Inline edit state for planned_games on an active season
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [savingEdit, setSavingEdit] = useState(false)

  const beginEdit = useCallback((row: SeasonRow) => {
    setEditingId(row.id)
    setEditValue(row.planned_games?.toString() ?? '')
    setErr(null)
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setEditValue('')
  }, [])

  const saveEdit = useCallback(async (seasonId: string) => {
    setErr(null)
    const val = editValue.trim() === '' ? null : Number(editValue)
    if (val !== null && (!Number.isInteger(val) || val < 1)) {
      setErr('Planned games must be a whole number ≥ 1'); return
    }
    setSavingEdit(true)
    const { error } = await supabase.rpc('update_season_planned_games', {
      p_season_id: seasonId,
      p_planned_games: val,
    })
    setSavingEdit(false)
    if (error) { setErr(error.message); return }
    setEditingId(null)
    setEditValue('')
    await load()
  }, [editValue, load])
```

- [ ] **Step 2: Replace the `Planned` cell with an editable one**

Inside the table's `<tbody>` map, replace the current `<td style={{ padding: '8px 4px' }}>{s.planned_games ?? '—'}</td>` cell with:

```tsx
                <td style={{ padding: '8px 4px' }}>
                  {editingId === s.id ? (
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="number"
                        min={1}
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        style={{ width: 80 }}
                        autoFocus
                      />
                      <button type="button" disabled={savingEdit} onClick={() => saveEdit(s.id)}>
                        {savingEdit ? '…' : 'Save'}
                      </button>
                      <button type="button" onClick={cancelEdit}>Cancel</button>
                    </span>
                  ) : (
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <span>{s.planned_games ?? '—'}</span>
                      {!s.ended_at && (
                        <button type="button" onClick={() => beginEdit(s)} style={{ fontSize: 11 }}>Edit</button>
                      )}
                    </span>
                  )}
                </td>
```

- [ ] **Step 3: TypeScript check**

Run:
```
cd "C:/Users/UNHOEC03/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC/ffc"
node ./node_modules/typescript/bin/tsc --noEmit
```
Expected: exit code 0.

- [ ] **Step 4: Commit**

```
cd "C:/Users/UNHOEC03/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC"
git add ffc/src/pages/admin/AdminSeasons.tsx
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(admin): inline planned_games edit on AdminSeasons

Edit button on each active season row. Ended seasons are read-only."
```

---

## Task 4: Route AdminSeasons + add to AdminHome nav

**Files:**
- Modify: `ffc/src/router.tsx`
- Modify: `ffc/src/pages/admin/AdminHome.tsx`

- [ ] **Step 1: Register the route**

Edit `ffc/src/router.tsx`. After the existing `import { AdminMatches } from './pages/admin/AdminMatches'` line (line 22), add:

```tsx
import { AdminSeasons } from './pages/admin/AdminSeasons'
```

After the existing `{ path: 'admin/matches', element: <AdminMatches /> },` line (line 64), add:

```tsx
      { path: 'admin/seasons', element: <AdminSeasons /> },
```

- [ ] **Step 2: Add the link to AdminHome**

Edit `ffc/src/pages/admin/AdminHome.tsx`. Inside the `<div>` that holds the existing admin links, add a third `<Link>` below the Matches link:

```tsx
        <Link to="/admin/seasons">Seasons</Link>
```

- [ ] **Step 3: Run the dev server and click through**

Using preview_start (per Claude's preview tooling) or `node ./node_modules/vite/bin/vite.js`:

1. Open the app, log in as super-admin `m.muwahid@gmail.com`.
2. Go to `/admin` — verify the "Seasons" link is visible.
3. Click it → AdminSeasons page loads with "Season 1" in the list (already seeded via migration 0011).
4. In the "New season" form: leave planned_games blank, submit → a row appears with `—` under Planned.
5. Click Edit on the new season, enter `30`, Save → cell updates to `30`.
6. Confirm via SQL:
   ```
   npx supabase db query --linked <<'SQL'
   SELECT name, planned_games FROM seasons ORDER BY starts_on DESC LIMIT 3;
   SQL
   ```
   Expected: the new season shows `planned_games = 30`; Season 1 still shows `NULL`.

- [ ] **Step 4: Revert test data**

The test season created in Step 3 should be archived or deleted to keep the Matches list clean for the next tasks. If it has no matchdays attached, delete it:

```
npx supabase db query --linked <<'SQL'
DELETE FROM seasons WHERE name = 'Season 2' AND ends_on IS NULL;
SQL
```

Expected: `DELETE 1`. Season 1 (with matches) is untouched.

**Then, to keep banners informative during this test pass, set `planned_games` on Season 1:**

```
npx supabase db query --linked <<'SQL'
UPDATE seasons SET planned_games = 30 WHERE name = 'Season 1';
SELECT name, planned_games FROM seasons;
SQL
```

Expected: Season 1 now has `planned_games = 30`.

- [ ] **Step 5: Commit**

```
cd "C:/Users/UNHOEC03/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC"
git add ffc/src/router.tsx ffc/src/pages/admin/AdminHome.tsx
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(admin): route AdminSeasons at /admin/seasons + AdminHome link"
```

---

## Task 5: Matches.tsx — extend the query with scorers + planned_games

**Files:**
- Modify: `ffc/src/pages/Matches.tsx`

At this point the banner, scoreboard, and winner treatment still use the old markup. This task only updates the data layer so we have what we need to render. Markup rewrite is Task 6.

- [ ] **Step 1: Extend the `SeasonRow` and `MatchRow` types**

Edit [ffc/src/pages/Matches.tsx](ffc/src/pages/Matches.tsx). In the `SeasonRow` interface (currently lines 12–18), add `planned_games`:

```tsx
interface SeasonRow {
  id: string
  name: string
  ended_at: string | null
  archived_at: string | null
  created_at: string
  planned_games: number | null
}
```

In the `MatchRow` interface (currently lines 20–34), add a `scorers` field:

```tsx
interface ScorerRow {
  team: 'white' | 'black'
  goals: number
  profile: { display_name: string } | null
  guest: { display_name: string } | null
}

interface MatchRow {
  id: string
  result: 'win_white' | 'win_black' | 'draw'
  score_white: number
  score_black: number
  approved_at: string
  matchday_id: string
  matchday: {
    id: string
    kickoff_at: string
    is_friendly: boolean
  } | null
  motm_member: { display_name: string } | null
  motm_guest: { display_name: string } | null
  scorers: ScorerRow[]
}
```

- [ ] **Step 2: Update the seasons query to pull `planned_games`**

Inside the `useEffect` that loads seasons, change the `.select(...)` call from:

```tsx
      .select('id, name, ended_at, archived_at, created_at')
```

to:

```tsx
      .select('id, name, ended_at, archived_at, created_at, planned_games')
```

- [ ] **Step 3: Update the matches query to embed scorers**

Inside the `Promise.all` in the matches `useEffect`, change the `matches` select template-string to:

```tsx
        supabase
          .from('matches')
          .select(`
            id, result, score_white, score_black, approved_at, matchday_id,
            matchday:matchdays!inner(id, kickoff_at, is_friendly),
            motm_member:profiles!matches_motm_user_id_fkey(display_name),
            motm_guest:match_guests!matches_motm_guest_id_fkey(display_name),
            scorers:match_players(team, goals, profile:profiles(display_name), guest:match_guests(display_name))
          `)
          .eq('season_id', activeSeasonId)
          .not('approved_at', 'is', null)
          .order('approved_at', { ascending: false })
          .limit(50),
```

- [ ] **Step 4: TypeScript check + dev-server smoke check**

```
cd "C:/Users/UNHOEC03/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC/ffc"
node ./node_modules/typescript/bin/tsc --noEmit
```
Expected: exit code 0.

Then in the running Vite preview, open `/matches`. The old single-row layout still renders (we haven't touched markup yet), but confirm in browser console or network tab:
- The `/rest/v1/matches?...` request payload contains a `scorers` array per match.
- No runtime errors in the console.

- [ ] **Step 5: Commit**

```
cd "C:/Users/UNHOEC03/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC"
git add ffc/src/pages/Matches.tsx
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(matches): extend query — match_players scorers + seasons.planned_games

Pure data-layer change; markup still renders old mt-row. Flashcard markup lands next commit."
```

---

## Task 6: Matches.tsx — replace row markup with flashcard

**Files:**
- Modify: `ffc/src/pages/Matches.tsx`
- Create: `ffc/src/styles/matches.css`

- [ ] **Step 1: Create the stylesheet**

Write `ffc/src/styles/matches.css`:

```css
/* Matches flashcard — 2026-04-23 redesign (spec: matches-flashcard-design) */

.mt-card {
  background: #0f1a30;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  overflow: hidden;
  color: #e7ecf5;
  margin-bottom: 14px;
  position: relative;
  width: 100%;
  max-width: 440px;
  cursor: pointer;
  text-align: left;
}

.mt-card-banner {
  background: rgba(96,165,250,0.08);
  border-bottom: 1px solid rgba(96,165,250,0.18);
  padding: 6px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.mt-card-banner-title { font-weight: 700; letter-spacing: 0.12em; font-size: 11px; color: #60a5fa; }
.mt-card-banner-date { font-size: 10px; color: #8b97ad; letter-spacing: 0.08em; }

/* Scoreboard row */
.splitc { display: grid; grid-template-columns: 1fr 1fr; position: relative; min-height: 64px; }
.splitc-half { padding: 8px 12px; display: flex; align-items: center; gap: 10px; transition: opacity 0.2s, filter 0.2s; }
.splitc-white { background: linear-gradient(135deg, #f4ede2 0%, #e5ddcd 100%); color: #0b1220; }
.splitc-black {
  background: linear-gradient(135deg, #0b1220 0%, #1a2440 100%);
  color: #f4ede2;
  border-left: 1px solid rgba(255,255,255,0.12);
  flex-direction: row-reverse;
}
.splitc-logo { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 3px; box-sizing: border-box; }
.splitc-logo img { width: 100%; height: 100%; object-fit: contain; display: block; }
.splitc-logo-white { background: #f4ede2; box-shadow: 0 0 0 2px rgba(244,237,226,0.45); }
.splitc-logo-black { background: #0b1220; box-shadow: 0 0 0 2px rgba(244,237,226,0.5); border: 1px solid #3b4358; }
.splitc-logo-black img { filter: invert(1) brightness(1.1); }
.splitc-team-label { font-size: 11px; letter-spacing: 0.14em; font-weight: 700; opacity: 0.75; flex: 1; }
.splitc-team-label.right { text-align: right; }
.splitc-score { font-size: 30px; font-weight: 800; letter-spacing: 0.03em; line-height: 1; }
.splitc-score-white { color: #0b1220; }
.splitc-score-black { color: #f4ede2; }
.splitc-vs {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  background: #0f1a30; color: #60a5fa; width: 26px; height: 26px;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-weight: 800; font-size: 9px; letter-spacing: 0.08em;
  border: 2px solid rgba(96,165,250,0.35);
}

/* Winner indicator */
.splitc-loser { opacity: 0.5; filter: saturate(0.55); }
.mt-winner-ribbon {
  position: absolute;
  top: 24px;
  height: 3px;
  background: linear-gradient(90deg, #22c55e 0%, #4ade80 100%);
  z-index: 2;
  box-shadow: 0 0 8px rgba(34,197,94,0.55);
}
.mt-winner-ribbon.left  { left: 0; width: 50%; }
.mt-winner-ribbon.right { right: 0; width: 50%; }
.mt-winner-label {
  position: absolute;
  top: 28px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.15em;
  color: #22c55e;
  background: #0f1a30;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid rgba(34,197,94,0.45);
  z-index: 3;
}
.mt-winner-label.left  { left: 10px; }
.mt-winner-label.right { right: 10px; }
.mt-draw-banner {
  position: absolute;
  top: 26px; left: 50%; transform: translateX(-50%);
  font-size: 9px; font-weight: 800; letter-spacing: 0.2em;
  color: #8b97ad; background: #0f1a30;
  padding: 2px 8px; border-radius: 4px;
  border: 1px solid rgba(139,151,173,0.3);
  z-index: 3;
}

/* Scorer footer */
.splitc-footer { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.2); }
.splitc-footer-half { padding: 8px 12px; display: flex; flex-direction: column; gap: 3px; min-height: 28px; justify-content: center; }
.splitc-footer-half.right { align-items: flex-end; border-left: 1px solid rgba(255,255,255,0.06); }
.mt-scorer-row { font-size: 11px; line-height: 1.35; color: #c7d0df; display: inline-flex; align-items: center; gap: 5px; }
.mt-scorer-ball { opacity: 0.6; font-size: 10px; }
.splitc-footer-half.empty .mt-scorer-row { opacity: 0.4; font-style: italic; }
.mt-hat-badge { display: inline-block; margin-left: 3px; padding: 1px 5px; border-radius: 999px; background: rgba(236,72,153,0.2); color: #f472b6; font-size: 9px; font-weight: 700; letter-spacing: 0.05em; }

/* MOTM strip */
.mt-motm-strip {
  padding: 5px 12px;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: #facc15;
  background: rgba(250,204,21,0.06);
  border-top: 1px solid rgba(250,204,21,0.12);
  text-align: center;
  font-weight: 600;
}
```

- [ ] **Step 2: Import the stylesheet in Matches.tsx**

At the top of `ffc/src/pages/Matches.tsx`, below the existing imports, add:

```tsx
import '../styles/matches.css'
```

- [ ] **Step 3: Add helpers — scorer grouping + banner label**

After the existing `formatDate` helper in `Matches.tsx`, add:

```tsx
interface GroupedScorer {
  name: string
  goals: number
}

function groupScorers(scorers: ScorerRow[], team: 'white' | 'black'): GroupedScorer[] {
  const byName = new Map<string, number>()
  for (const s of scorers) {
    if (s.team !== team || s.goals <= 0) continue
    const name = s.profile?.display_name ?? s.guest?.display_name ?? '—'
    byName.set(name, (byName.get(name) ?? 0) + s.goals)
  }
  return Array.from(byName.entries())
    .map(([name, goals]) => ({ name, goals }))
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name))
}

function bannerLabel(matchdayNumber: number, total: number | null): string {
  return total ? `GAME ${matchdayNumber} / ${total}` : `GAME ${matchdayNumber}`
}
```

- [ ] **Step 4: Replace the list `<button>` markup with the flashcard**

Inside the `{matches.map(m => { ... })}` block, replace the entire returned `<button className="mt-row" ...>` element (currently lines 189–219) with:

```tsx
              const whiteScorers = groupScorers(m.scorers, 'white')
              const blackScorers = groupScorers(m.scorers, 'black')
              const motmName = m.motm_member?.display_name ?? m.motm_guest?.display_name ?? null
              const isDraw = m.result === 'draw'
              const whiteWon = m.result === 'win_white'
              const blackWon = m.result === 'win_black'
              const n = matchdayNumber[m.matchday_id] ?? 0
              const total = activeSeason?.planned_games ?? null

              return (
                <button
                  key={m.id}
                  type="button"
                  className="mt-card"
                  onClick={() => setOpenMatchId(m.id)}
                >
                  <div className="mt-card-banner">
                    <span className="mt-card-banner-title">{bannerLabel(n, total)}</span>
                    <span className="mt-card-banner-date">{formatDate(m.matchday?.kickoff_at ?? m.approved_at)}</span>
                  </div>

                  {isDraw && <div className="mt-draw-banner">DRAW</div>}
                  {whiteWon && <>
                    <div className="mt-winner-ribbon left" />
                    <div className="mt-winner-label left">WINNER</div>
                  </>}
                  {blackWon && <>
                    <div className="mt-winner-ribbon right" />
                    <div className="mt-winner-label right">WINNER</div>
                  </>}

                  <div className="splitc">
                    <div className={`splitc-half splitc-white ${blackWon ? 'splitc-loser' : ''}`}>
                      <div className="splitc-logo splitc-logo-white">
                        <img src="/ffc-logo.png" alt="FFC" />
                      </div>
                      <span className="splitc-team-label">WHITE</span>
                      <span className="splitc-score splitc-score-white">{m.score_white}</span>
                    </div>
                    <div className={`splitc-half splitc-black ${whiteWon ? 'splitc-loser' : ''}`}>
                      <div className="splitc-logo splitc-logo-black">
                        <img src="/ffc-logo.png" alt="FFC" />
                      </div>
                      <span className="splitc-team-label right">BLACK</span>
                      <span className="splitc-score splitc-score-black">{m.score_black}</span>
                    </div>
                    <div className="splitc-vs">VS</div>
                  </div>

                  <div className="splitc-footer">
                    <div className={`splitc-footer-half ${whiteScorers.length === 0 ? 'empty' : ''}`}>
                      {whiteScorers.length === 0 ? (
                        <span className="mt-scorer-row">no goals</span>
                      ) : whiteScorers.map(s => (
                        <span key={`w-${s.name}`} className="mt-scorer-row">
                          <span className="mt-scorer-ball">⚽</span>
                          {s.goals > 1 ? `${s.name} ×${s.goals}` : s.name}
                          {s.goals >= 3 && <span className="mt-hat-badge">HAT</span>}
                        </span>
                      ))}
                    </div>
                    <div className={`splitc-footer-half right ${blackScorers.length === 0 ? 'empty' : ''}`}>
                      {blackScorers.length === 0 ? (
                        <span className="mt-scorer-row">no goals</span>
                      ) : blackScorers.map(s => (
                        <span key={`b-${s.name}`} className="mt-scorer-row">
                          <span className="mt-scorer-ball">⚽</span>
                          {s.goals > 1 ? `${s.name} ×${s.goals}` : s.name}
                          {s.goals >= 3 && <span className="mt-hat-badge">HAT</span>}
                        </span>
                      ))}
                    </div>
                  </div>

                  {motmName && (
                    <div className="mt-motm-strip">⭐ MOTM · {motmName}</div>
                  )}
                </button>
              )
```

- [ ] **Step 5: Remove the now-unused skeleton row styles (but keep the skeleton loader working)**

The existing `mt-skel-*` classes are still referenced by the loader at lines 158–170. Leave them. We only replace the match-row rendering.

The old `mt-row`, `mt-row-date`, `mt-row-date-main`, `mt-row-date-sub`, `mt-row-main`, `mt-score`, `mt-score-num`, `mt-score-dash`, `mt-score-loser`, `mt-team-chip`, `mt-team-white`, `mt-team-black`, `mt-team-loser`, `mt-draw-tag`, `mt-motm`, `mt-motm-star`, `mt-row-chev` CSS classes were only used by the markup we just replaced and are not referenced elsewhere (verified via grep of `ffc/src/**`). They can be deleted in a follow-up; leave them for now to keep this diff focused on the new markup.

- [ ] **Step 6: TypeScript check**

```
cd "C:/Users/UNHOEC03/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC/ffc"
node ./node_modules/typescript/bin/tsc --noEmit
```
Expected: exit code 0.

- [ ] **Step 7: Visual verification in the Vite preview**

Start the dev server (via preview_start or `node ./node_modules/vite/bin/vite.js`). Navigate to `/matches`. With the test data from Task 4 Step 4 (Season 1, `planned_games = 30`, 3 matches), confirm:

| Scenario | Expected |
|---|---|
| Card 1 (MATCH 3 of 3 — 30/APR/2026 White 3–0) | Banner "GAME 3 / 30". Black half dim. Green ribbon + "WINNER" on White side. White scorers under White half, "no goals" italicised under Black. MOTM strip at bottom shows Mohammed Muwahid. |
| Card 2 (MATCH 2 — 30/APR/2026 White 2–1) | Banner "GAME 2 / 30". Black half dim. Green ribbon + "WINNER" on White side. No MOTM strip (this match has no MOTM). |
| Card 3 (MATCH 1 — 16/APR/2026 White 4–1) | Banner "GAME 1 / 30". Black half dim. Green ribbon + "WINNER" on White side. MOTM Mohammed Muwahid shown. |

Also confirm in browser console: no React key-warnings, no image 404s on `/ffc-logo.png`. Open DevTools Network tab → the PNG returns 200 and is ~45 KB.

Click any card → MatchDetailSheet opens (unchanged behaviour).

- [ ] **Step 8: Verify `planned_games IS NULL` fallback**

```
npx supabase db query --linked <<'SQL'
UPDATE seasons SET planned_games = NULL WHERE name = 'Season 1';
SQL
```
Refresh `/matches` — banners should read `GAME 1`, `GAME 2`, `GAME 3` with no denominator. Then restore:

```
npx supabase db query --linked <<'SQL'
UPDATE seasons SET planned_games = 30 WHERE name = 'Season 1';
SQL
```

- [ ] **Step 9: Commit**

```
cd "C:/Users/UNHOEC03/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC"
git add ffc/src/pages/Matches.tsx ffc/src/styles/matches.css
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(matches): flashcard redesign — split-colour scoreboard + winner indicator

Replaces mt-row markup with splitc-* flashcard per spec
(docs/superpowers/specs/2026-04-23-matches-flashcard-design.md).

- Banner shows GAME N / TOTAL (falls back to GAME N when planned_games is NULL)
- Split-half scoreboard with FFC logo (inverted on black side)
- Green WINNER ribbon + label on winner half; loser half dimmed; neutral DRAW pill
- Per-team scorer columns, one row per scorer, ×N suffix, HAT pill at 3+ goals
- MOTM strip at the bottom, only when MOTM is set"
```

---

## Task 7: Final push + session wrap

- [ ] **Step 1: Full manual QA pass on preview deployment**

Push the branch:

```
cd "C:/Users/UNHOEC03/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC"
git push origin main
```

Wait for Vercel auto-deploy to finish, then open https://ffc-gilt.vercel.app/matches logged in as super-admin and repeat the Task 6 Step 7 checks on the live site. Also:

- `/admin/seasons` loads, shows Season 1 with `planned_games = 30`.
- Edit button still works on Season 1.

- [ ] **Step 2: Session log entry**

Add a session-log entry under `sessions/S###/session-log.md` per CLAUDE.md operating rule #5. Include: commits shipped, migrations applied, decisions locked (flashcard spec, planned_games column, combined winner treatment), any remaining cleanup (deleting old `mt-row`/`mt-team-chip` CSS in a future slice).

- [ ] **Step 3: Update `CLAUDE.md` status line**

Under the `## Current state` section (or top-of-file `Status:` banner), append a line noting migration 20 and the Matches flashcard shipped at this session.

- [ ] **Step 4: Final commit**

```
cd "C:/Users/UNHOEC03/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC"
git add sessions/ CLAUDE.md
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "docs: session log + CLAUDE.md status bump — matches flashcard + migration 0020"
git push origin main
```

---

## Self-review notes (internal check, not a task)

**Spec coverage:**
- Banner `GAME N / TOTAL` → Task 5 (query `planned_games`) + Task 6 (banner label helper + JSX). ✓
- Split-half scoreboard + inverted-black logo → Task 6. ✓
- Combined winner treatment (dim + ribbon + WINNER label + DRAW pill) → Task 6 (CSS) + Task 6 Step 4 (JSX conditionals). ✓
- Scorer footer, per-team columns, one-per-row, `×N`, HAT pill → Task 6 (`groupScorers` helper + footer JSX). ✓
- MOTM strip, only when MOTM set → Task 6 conditional. ✓
- New `seasons.planned_games` column → Task 1. ✓
- `create_season` RPC + `update_season_planned_games` RPC + audit → Task 1. ✓
- AdminSeasons page (list + create + edit planned_games + status) → Tasks 2, 3. Archive via existing `archive_season` RPC is not yet wired — the spec listed it as a want but the existing RPC can be called from SQL for now; out of scope here to keep the slice tight. Noted as a follow-up.
- Router + AdminHome nav → Task 4. ✓
- Match Detail untouched → Task 6 tap-target keeps `setOpenMatchId`. ✓
- Friendly matchdays still filtered → unchanged in Matches.tsx. ✓

**Follow-ups (not in this plan):**
- Wire "End season" + "Archive season" buttons on AdminSeasons (calls existing `archive_season` RPC; needs an `end_season` RPC too).
- Delete unused legacy `mt-row`, `mt-team-chip`, `mt-motm` CSS classes from `Matches.tsx`.
