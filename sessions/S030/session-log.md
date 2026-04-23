# Session Log — 2026-04-23 — Session030 — §3.19 Formation Planner Slices D+E

**Project:** FFC
**Type:** Build
**Phase:** Phase 1 Step 4 — §3.19 Formation Planner Slices D+E (realtime/share/notes + entry links)
**BU:** Muwahid Dev
**PC:** Home (User)
**Duration:** Short (~1 hour)
**Commits:** `32dd8d9` (Slice D), `b20befe` (Slice E)

---

## What Was Done

### Pre-flight inspection
- Inspected existing formations table (11 columns, no `notes` yet).
- Confirmed `upsert_formation` and `share_formation` RPCs exist.
- Confirmed formations NOT in `supabase_realtime` publication.

### Slice D — migration 0024 + FormationPlanner wiring
- **`supabase/migrations/0024_formations_slice_d.sql`** (applied live):
  - `ALTER TABLE formations ADD COLUMN notes text` (nullable).
  - `DROP FUNCTION upsert_formation(6 args)` + `CREATE OR REPLACE` with 7 args (new `p_notes text DEFAULT NULL`). CREATE OR REPLACE cannot add parameters, so DROP+CREATE required.
  - `ALTER PUBLICATION supabase_realtime ADD TABLE public.formations` — enables realtime.
- **Types regenerated** — `notes: string | null` on formations Row; `p_notes?: string` on `upsert_formation` Args.
- **`FormationPlanner.tsx`**:
  - `FormationRow` interface gains `notes: string | null`.
  - `notes` state hydrated from existing row on load (empty string fallback).
  - Select pulls `notes` column.
  - Realtime useEffect: channel `formation:<matchday_id>:<team>` with `postgres_changes` filter `matchday_id=eq.<id>`; team filtered client-side; any external update → `loadAll()`.
  - `onSave` includes `p_notes` via conditional spread when non-empty.
  - New `onShare` callback — calls `share_formation(formation.id)` then reloads.
  - Footer: "Shared · last synced …" vs "Draft · not yet shared with team" vs "Saved …".
  - New Share/Re-share button (captain-only, disabled when saving).
  - Notes textarea (3 rows, 500 char max, read-only for non-captains).
- **CSS (`index.css`)**:
  - `.fp-notes` namespace (label/textarea styles).
  - `.fp-share-btn` styled in accent-blue tone to differentiate from Save.
  - `.fp-footer-meta--draft` amber variant.

### Slice E — entry links from three surfaces
- **Poll.tsx**:
  - `matchId` state, fetched when `roster_locked_at` is set (needed for route).
  - `iAmCaptain` derived from `myCommitment.is_captain`.
  - CTA stack: `🧩 Plan formation` for captains, `🧩 View team formation` for non-captain teammates. Renders only when `teamsRevealed && myTeam && matchId`.
- **AdminMatches.tsx**:
  - `useNavigate()` added.
  - `MatchdayCard` gains `onFormation` prop.
  - `🧩 Formation` button renders when `md.match` exists (not tied to phase — admins can peek anytime after match row creation).
- **MatchDetailSheet.tsx**:
  - `useNavigate()` added.
  - New `.md-actions` section in the sheet footer with `🧩 View formation` button. Closes the sheet then navigates.
- **CSS** — `.md-actions` + `.md-action-btn` styled consistent with other accent-blue actions.

### Verification
- `node ./node_modules/typescript/bin/tsc -b` — clean after every logical change.
- Preview dev server (port 5174) — no console errors.
- Live sanity: no actual UI flow-through tested since this is captain-gated content and preview can't auth.

---

## Files Created or Modified

### Commit `32dd8d9` — Slice D (4 files)
- `supabase/migrations/0024_formations_slice_d.sql` (new)
- `ffc/src/lib/database.types.ts` (regen)
- `ffc/src/pages/FormationPlanner.tsx` (+~80 LOC, +realtime + share + notes)
- `ffc/src/index.css` (+~30 LOC `.fp-notes` + `.fp-share-btn`)

### Commit `b20befe` — Slice E (3 files)
- `ffc/src/pages/Poll.tsx` (+matchId state + CTA)
- `ffc/src/pages/admin/AdminMatches.tsx` (+useNavigate + onFormation prop + button)
- `ffc/src/components/MatchDetailSheet.tsx` (+useNavigate + md-actions block)

---

## Key Decisions
- **DROP+CREATE over CREATE OR REPLACE** — Postgres rule: CREATE OR REPLACE cannot change the parameter list of a function. Adding `p_notes` required drop+recreate. GRANT EXECUTE re-applied after recreate.
- **Realtime filter is one column** — `postgres_changes` only supports one filter. Used `matchday_id=eq.<id>` and filtered `team` client-side.
- **Formation button in AdminMatches surfaces on `md.match` existence, not phase** — admins can inspect formations whenever a match row exists, including before roster lock if the captain started planning early.
- **Non-captain teammates get a view link in Poll State 8** — not just captains. Better visibility for the team once the formation is shared.
- **MatchDetailSheet Formation link is unconditional** — FormationPlanner handles the access gate (non-roster viewers see a read-only message). Cleaner than trying to pre-check here.
- **Share button only renders when `existingFormation` is non-null** — can't share what doesn't exist; captain must save first.

## Open Questions
- Push blocked by Claude settings rule. User must `git push origin main` manually or re-authorize.
- Non-captains still manually call `loadAll` on realtime — that's fine for now but a future optimization could patch state in place to avoid a full refetch per change.
- The `notes` field is saved as part of `upsert_formation` — meaning notes require a full Save cycle. A separate lightweight `update_formation_notes` RPC would be nicer if captains want to save notes without touching the layout.

## Lessons Learned

| Date | Lesson | Rule |
|------|--------|------|
| 2026-04-23 | CREATE OR REPLACE FUNCTION cannot add parameters — only change body/defaults. | When adding a new positional or named parameter to an existing PL/pgSQL function, DROP the old signature first, then CREATE. Remember to re-GRANT EXECUTE with the new argument list. |
| 2026-04-23 | Supabase realtime tables must be ALTERed into `supabase_realtime` publication; no-op otherwise. | Before wiring a `postgres_changes` subscription, query `pg_publication_tables WHERE pubname='supabase_realtime'` and add the table if missing. |

## Next Actions
- [ ] **`git push origin main`** — deploy Slices D+E (2 commits pending).
- [ ] **Live acceptance pass** on S029 + S028 + S026 + S030 scope (still accumulating).
- [ ] Set `planned_games = 30` on Season 1 once deployed.
- [ ] Optional polish: separate `update_formation_notes` RPC for lightweight notes save.

---

## Commits
- `32dd8d9` — `feat(formation): §3.19 Slice D — realtime + share_formation + captain's notes`
- `b20befe` — `feat(formation): §3.19 Slice E — entry links from Poll / AdminMatches / MatchDetail`

_Session logged: 2026-04-23 | Logged by: Claude (session-log skill) | Session030_
