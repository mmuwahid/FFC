# S027 — Matches flashcard spec + plan (no code)

- **Date:** 2026-04-23
- **PC:** Work (`UNHOEC03`)
- **Topic:** §3.20 Matches flashcard redesign — brainstorm → spec → plan. No code this session; user will execute the plan next session.
- **Branch tip at close:** `db681ba` (`main`, pushed? — no, deferred to S028 open). Two commits this session: `20e8e49` (spec), `db681ba` (plan).

## Summary

User flagged the current single-line Matches rows as visually flat — asked for a "flashcard" inspired by a Liverpool/Tottenham reference + a second International-Friendly reference. Ran brainstorming through superpowers visual-companion at `http://localhost:63305`. Six iterations (A/B/C sweep → C half-height → inline-scorers → separate-rows + total-games + logo fix → combined winner treatment) landed the approved design.

## Decisions locked

- **Layout:** Option C **split-half colour card** — cream (`linear-gradient 135deg, #f4ede2 → #e5ddcd`) left for White, navy (`#0b1220 → #1a2440`) right for Black, FFC crest in a 40×40 circle each side (navy side applies CSS `filter: invert(1) brightness(1.1)` to re-use the same PNG — no second asset needed).
- **Banner:** `GAME N / TOTAL`. `N` = 1-based matchday index in season (already computed client-side). `TOTAL` = new nullable column `seasons.planned_games`; banner degrades to `GAME N` when `NULL`.
- **Scorer footer:** 2-column grid matched to the split. **One scorer per row**, left-aligned on White, right-aligned on Black. `⚽ Name ×N` format; `×3+` appends a pink `HAT` pill. Empty side renders italicised `no goals`.
- **Winner indicator (combined):** loser half `opacity:0.5; filter:saturate(0.55)` **+** 3px green ribbon across the top of the winner half **+** small green `WINNER` label pill. Draws get a neutral centred `DRAW` pill; neither half dimmed.
- **MOTM strip:** only rendered when MOTM is set (amber text `⭐ MOTM · <name>` on amber-tinted strip).
- **Clean-sheet flag:** dropped per user ("no need to track").
- **Card height target:** ~120–145 px (banner 28 + score 64 + scorer ≥28 + optional MOTM 24).
- **Tap target:** whole card opens existing `MatchDetailSheet`; no chevron.

## Deliverables

- Spec: [docs/superpowers/specs/2026-04-23-matches-flashcard-design.md](docs/superpowers/specs/2026-04-23-matches-flashcard-design.md) — 144 lines, committed `20e8e49`, approved by user in chat.
- Plan: [docs/superpowers/plans/2026-04-23-matches-flashcard-plan.md](docs/superpowers/plans/2026-04-23-matches-flashcard-plan.md) — 7 tasks, ~1025 lines, committed `db681ba`, includes full code, SQL, verification steps, and commit messages per step.

## Plan shape (to execute in S028)

| Task | What | Files |
|---|---|---|
| 1 | Migration 0020 — `seasons.planned_games` + `create_season` + `update_season_planned_games` RPCs | `supabase/migrations/0020_seasons_planned_games.sql`, regen types |
| 2 | `AdminSeasons.tsx` — list + create form | `ffc/src/pages/admin/AdminSeasons.tsx` |
| 3 | Inline `planned_games` edit on active seasons | `AdminSeasons.tsx` (modify) |
| 4 | Route `/admin/seasons` + AdminHome link | `router.tsx`, `AdminHome.tsx` |
| 5 | Extend `Matches.tsx` query — `match_players` embed + `planned_games` | `Matches.tsx` (data only) |
| 6 | Replace row markup with flashcard + new `matches.css` stylesheet | `Matches.tsx`, `ffc/src/styles/matches.css` |
| 7 | Preview QA on live, session log, CLAUDE.md status bump | `sessions/`, `CLAUDE.md` |

Each task ends with a per-task git commit. Plan is task-sized so a fresh subagent per task (recommended) or inline batch execution both work.

## Non-obvious context for S028

- **No test framework in `ffc/`** — plan uses TypeScript `tsc --noEmit` + visual preview + SQL verification in place of automated tests (no `vitest`, no `*.test.tsx` in `ffc/src/**`). Acceptable per phase-1 scope; add unit tests as a separate concern later.
- **Brainstorm server** still running on port 63305 if preview assets in `.superpowers/brainstorm/1099-1776946805/content/` are wanted; otherwise `scripts/stop-server.sh <session-dir>` at S028 open.
- **Windows `&`-in-path trap** — plan always uses `node ./node_modules/typescript/bin/tsc --noEmit` and `node ./node_modules/vite/bin/vite.js`, never `npm run tsc`, per S017 lesson.
- **MCP PAT scope trap** — Supabase MCP still scoped to PadelHub org, returns 403 on `hylarwwsedjxwavuwjrn`. Plan uses `npx supabase db query --linked` / `db push` throughout.
- **Schema drifts that could bite this plan:** `seasons.starts_on` (not `started_on`), `profiles.role` enum (not `is_admin` bool), `match_players.team` (not `team_colour`). Plan spells every column correctly; verified against `0002_base_entities.sql` and `0003_match_data.sql`.
- **Existing RPC signature patterns to preserve:** `log_admin_action(text, uuid, text, jsonb)` — 4 args, admin derived via `current_profile_id()` (not passed). Plan's `create_season` and `update_season_planned_games` both conform.

## Not shipped this session

No code, no migrations, no deploys. Intentional per user direction: "I will execute later, just log this session and set a reminder to execute in next session."

## Next session (S028)

**Execute the plan at [docs/superpowers/plans/2026-04-23-matches-flashcard-plan.md](docs/superpowers/plans/2026-04-23-matches-flashcard-plan.md).** Recommended mode: subagent-driven (one subagent per task, review between). Alternative: inline executing-plans skill. See §Plan shape above for task boundaries.
