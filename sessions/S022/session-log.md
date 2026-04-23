# S022 — 23/APR/2026 · Work PC

**Topic:** Step 4 of V2.8 — first UI slice. §3.13 Leaderboard shipped Depth-B end-to-end: ranked table, Not-yet-played group, anchored dropdown controls (season / filter / sort), last-5 strip, cards column, MOTM chip, medal icons, persisted sort preference.

**Commits shipped (origin/main tip → `d3cdcf8` → close commit):**
1. `59889f1` feat(leaderboard): Step 4 slice — §3.13 ranked table + Not-yet-played + picker
2. `9d5c3c2` feat(leaderboard): compact filter + sort icons with popover dropdowns
3. `c33b781` refactor(leaderboard): season picker becomes anchored dropdown from pill
4. `5c97867` feat(leaderboard): last-5 form strip per ranked row
5. `d3cdcf8` feat(leaderboard): cards column + MOTM chip + pin last-5 to grid row 2
6. `[this-close]` [Session022] close — session log + index + todo + lessons + CLAUDE.md

---

## 1 · Cold start — cross-PC sync protocol's first real run

Session opened on work PC. `.git` pointer said `gitdir: C:/Users/User/FFC-git` (home-PC path) — OneDrive had synced the pointer file from last session without git itself catching up. Classic state (b) from the protocol added in S021.

Fix followed the 5-step protocol verbatim:
1. Rewrote pointer to `gitdir: C:/Users/UNHOEC03/FFC-git`.
2. `git fetch` → 4 commits behind origin/main.
3. `git stash push --include-untracked -m "work-sync-s022"` — captured the S021 commits (icons, Signup confirm-email handler, admin-audit-sql.md, sessions/S021/).
4. `git pull --ff-only` → fast-forwarded `5791a77 → 028834f`.
5. `git stash drop` — stash content identical to pulled tree.

Protocol worked. **This is the first time the S021 protocol was exercised end-to-end** and it was clean on the first try.

---

## 2 · Step 4 pick — planner agent chose Leaderboard over Poll

Spawned `Plan` subagent with the brief "compare §3.7 Poll Depth-B vs §3.13 Leaderboard on 7 axes, recommend one, produce an executable acceptance criterion."

Verdict: **Leaderboard** on three load-bearing reasons:
1. Masterplan §17 Step 4+ order explicitly says Leaderboard first.
2. Zero new SQL — `v_season_standings` + `v_player_last5` already exist, typed, granted.
3. Renders meaningfully against the current 3-profile / 0-match DB via "Season starts here" + "Not yet played" states. Poll State 1 renders empty but States 2–8 need §3.18 admin-create-matchday tooling first → multi-session pull-forward.

---

## 3 · Pre-flight verification (SQL)

Before writing code, verified three load-bearing DB facts via `npx supabase db query --linked`:

| Check | Query | Result |
|---|---|---|
| View GRANTs | `information_schema.role_table_grants` for `v_season_standings` + `v_player_last5` | `authenticated` has `SELECT, INSERT, UPDATE, DELETE` on both (inherited from 0012's `GRANT ... ON ALL TABLES`). ✅ |
| `profiles.leaderboard_sort` column | `information_schema.columns` | exists, `udt_name=leaderboard_sort`, default `'points'`. ✅ |
| `leaderboard_sort` enum values | `pg_enum` | `points, goals, motm, wins, last5_form` (5 values). ✅ |
| Season seed | `SELECT * FROM seasons` | Season 1 (`ab60594c-…`), 7v7, not-ended, not-archived. ✅ |

Lesson #93 from S019 (RLS ≠ GRANT) primed me to check this before writing any query — saved wasted cycles on silent-empty.

---

## 4 · Initial slice — 2 files / +1,033 lines / Commit `59889f1`

Shipped in one pass:
- `ffc/src/pages/Leaderboard.tsx` (stub → 490 lines): season picker bottom sheet, position filter chip row, sort `<select>`, sticky column header, ranked rows with medal icons top-3 current, Not-yet-played muted group, "Season starts here" empty tile, tiebreak chain (points → wins → motms → goals → display_name ASC), sort persistence to `profiles.leaderboard_sort`, row-tap routes to `/profile?profile_id=&season_id=`.
- `ffc/src/index.css` (+469 lines of `.lb-*` classes).

Deferred past this slice: last-5 strip · GF column · Cards column · realtime refetch · pull-to-refresh.

Acceptance verified automatically: `tsc -b --noEmit` silent · `vite build` in 4.55s · `curl /leaderboard` HTTP 200 (SPA rewrite intact) · anon error-path renders cleanly with zero console errors.

Deploy `dpl_DwwZNf…` READY in 13s. **User confirmed happy path on production**: Season 1 · ongoing chip, Not-yet-played group showing both active profiles (super_admin + Test Player), "Season starts here" tile, 5-tab bottom nav (Admin visible).

---

## 5 · Polish round 1 — compact icons + dropdowns / Commit `9d5c3c2`

User feedback after initial prod test:

> for the sort pill i want it to be instead just the sort logo and once pressed you see the drop down menu in this order Points/Wins/Goals/MOTM/Last 5 and no need to have it written in the drop down menu as Sort:Points etc just the word Points is enough. also there is no need to have the full filter options for the player positions you can also make it into a filter icon next to the sort with a drop down menue of the positions

Changes:
- Replaced the `<select>` pill + position chip row with two 38×38 icon buttons (inline SVGs for filter funnel + sort up/down arrows — `currentColor` for theme).
- Filter popover: All positions / GK / DEF / CDM / W / ST (multi-select, palette colour when selected, active-count badge on trigger).
- Sort popover: Points / Wins / Goals / MOTM / Last 5 (reordered, simplified labels). Single-select with ✓.
- Click-outside closes; opening one closes the others.
- `aria-expanded` + `role=menuitemcheckbox/radio` + `aria-checked`.

---

## 6 · Polish round 2 — season dropdown anchored too / Commit `c33b781`

User follow-up:

> also for the season drop down instead of it popping up from bottom of screen just let it drop down from that same pill at the top so its all neat in same location without having to divert eyes or fingers to click in another location on screen

Refactored the season picker from a bottom sheet (full-screen backdrop + bottom-anchored panel) to an anchored dropdown that shares the new `.lb-dropdown` primitive with filter/sort. Added `.lb-dropdown--wide` variant that anchors from the LEFT and fills the trigger width (since the season chip is the wide-left element).

All three popovers (season, filter, sort) now share: one component, one click-outside effect, "opening any one closes the others." Deleted ~90 lines of dead bottom-sheet CSS.

**User:** *"tested they are perfect much more clean this way"* — saved `feedback_anchored_dropdowns.md` to memory as a durable rule for future FFC screens (Poll, Admin, Settings).

---

## 7 · User chose "close S022 cleanly" over Profile/Poll — polish + seed

After the polish approval I offered three paths: Profile §3.14 (natural per §17, heavy), Leaderboard polish + close, or Poll Depth-B kickoff (multi-session). User picked polish + close.

**7a. Last-5 strip wiring** — queried `v_player_last5` alongside standings+profiles with `.order('kickoff_at', { ascending: true })`; indexed by `profile_id` into a Map; rendered up to 5 18×18 W/D/L discs per ranked row. Empty when player has 0 matches.

**7b. Seed one approved match** — needed to exercise the ranked-list branch. Schema discovery via `information_schema.columns` for `matchdays`/`matches`/`match_players`. Three errors hit on first-pass SQL:

| Error | Root cause | Fix |
|---|---|---|
| `invalid input value for enum match_result: "WHITE_WIN"` | Guessed enum values | Queried `pg_enum` — actual: `win_white, win_black, draw` |
| `column "profile_id" is of type uuid but expression is of type text` | CTE UNION ALL with literal uuids doesn't coerce | Added `::uuid` on every literal, every branch |
| `FK violation: profile_id=(ca3181b2-aec5-4b70-a99d-c10541a7ba35) not present in profiles` | CLAUDE.md truncated Test Player's UUID to `ca3181b2…`; I filled the rest from memory and got it wrong | Queried `profiles` — actual: `ca3181b2-ca3b-426e-8ae9-690962128530` |

Final seed: matchday + match (`win_white` 3-1, `approved_at` set, `motm_user_id` = super_admin) + 2 `match_players` rows (super_admin WHITE 2 goals, Test Player BLACK 1 goal). `v_season_standings` post-seed: Mohammed 1W 2g 1motm 3pts · Test Player 1L 1g 0pts. `v_player_last5` post-seed: W for Mohammed, L for Test Player.

Shipped: `5c97867` feat(leaderboard): last-5 form strip per ranked row.

---

## 8 · User review of last-5 slice — three misses / Commit `d3cdcf8`

After refresh user reported:

> its been updated but the last 5 hasnt been updated nor do i see the players red or yellow cards or motm awards in leaderboards

Three issues, three fixes in one commit:

**8a. Last-5 not rendering.** Root cause: `.lb-last5` had `grid-column: 3 / -1` expecting CSS grid auto-placement to drop it onto row 2 (since cols 3-6 were occupied on row 1). In the 7-col grid with mixed child types and pinned last-5 spanning cols 3 through -1, auto-placement landed in a collapsed slot instead of row 2. **Fix:** pin explicitly with `grid-row: 2`. Deterministic regardless of sibling order. Added a temporary `console.info` diagnostic that confirmed the data was loading correctly — strip was present in DOM but grid-placed invisibly.

**8b. Cards column missing.** I had deliberately dropped the spec's slot-7 cards cluster when first translating mockup→code (grid was tight). User wanted them. **Fix:** new grid column (`28px 32px 1fr 60px 28px 50px 44px`), `.lb-cards` cell showing `🟨N` and `🟥M` chiclets, each hidden when count = 0, column blank when both are 0. Header row gets a "CARDS" label.

**8c. MOTM not shown.** Spec §3.13 put MOTM in the tiebreak chain and sort dropdown but NOT as a visible column. User wanted it on-row. **Fix:** compact gold `⭐N` chip added to the name-block position-pills row (inline with primary/secondary position pills), hidden when `motms = 0`. Matches the "information density beside the name" pattern used elsewhere.

**Seed update:** the initial match had zero cards so even the fixed Cards column would have rendered empty. Added `UPDATE match_players SET yellow_cards = 1` for Mohammed and `yellow_cards = 1, red_cards = 1` for Test Player — gives the column something to show.

After hard-refresh (service worker cached the prior bundle for the first refresh attempt), user confirmed:

> its rendering now working perfectly

With MOTM ⭐1 chip on Mohammed, 🟨1 for him in cards column, 🟨1 🟥1 for Test Player, last-5 strip intact for both.

---

## 9 · Close artifacts

This session logged the diagnostic `console.info` as "remove next slice" — removed here (one-line cleanup alongside close).

Updated:
- `sessions/S022/session-log.md` — this file.
- `sessions/INDEX.md` — new S022 row, Next-session pointer → S023.
- `tasks/todo.md` — S023 agenda + S022 completed block.
- `tasks/lessons.md` — four entries (UUID literal casts in UNION ALL, session-log UUID truncation, grid auto-placement needs pinning, mockup→code column-drop discipline).
- `CLAUDE.md` — status header refresh; live operational gotchas unchanged.
- `feedback_anchored_dropdowns.md` — memory file added mid-session at polish-round-2 approval.

---

## Scope delta vs plan

**In scope + shipped:**
- Season picker (dropdown, not bottom sheet — user-driven refinement)
- Position filter (dropdown, not chip row — user-driven refinement)
- Sort dropdown + persistence to `profiles.leaderboard_sort`
- Sticky column header
- Ranked rows: rank / medal / avatar / name+position+MOTM / W-D-L / MP / cards / Pts
- Last-5 strip (second grid row, 18×18 W/D/L discs)
- Not-yet-played muted group
- "Season starts here" empty tile
- Tiebreak chain (points → wins → motms → goals → name)
- Row tap → Profile route (which is still a stub; §3.14 is next)
- Dark theme works; light theme inherits `--bg`/`--surface`/`--text` tokens
- Medal icons top 3 current; trophy glyphs for archived (untested — no archived season to flip)

**Deferred past this slice (spec's Phase-1 Depth-B gate, still unchecked):**
- [ ] Realtime subscription on `matches` UPDATE (`approved_at` flip) with fade-in background refetch
- [ ] Pull-to-refresh (mobile)
- [ ] Skeleton rows for ≥150ms load

**Not in spec but shipped on user request:**
- MOTM chip on leaderboard row (⭐N)

---

## S023 handoff

Default path per §17: **§3.14 Player Profile**. Row taps on leaderboard already route to `/profile?profile_id=&season_id=` — currently hits the Profile stub. Section 3.14 spec lives at `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md:2042+`. Mockup at `mockups/3-14-player-profile.html`.

Expected shape (≈ S007 refined + S012 approved):
- Identity hero: avatar, name, positions, self-edit shortcut
- Season stats card (6 KPIs): Points, MP, W-D-L, Goals, MOTM, Late-cancel
- Last-5 form strip
- Achievements card (6 tiles): ⭐ MOTMs, 🔥 W-streak, 🎯 Goals, 🟨 Yellows, 🟥 Reds, 📉 L-streak
- Recent matches list (up to 10 across all seasons, newest first, tap → `/match/:id`)
- Settings shortcut (self-view only)

Data already available: `v_season_standings` (season row), `v_player_last5` (strip), `profiles` (identity), recent-matches SQL (see spec line 2060-2072), 3 achievements-aggregate SQL queries (spec line 2073+).

Nothing to add DB-side. It's a pure UI build.

**Side-items still on backburner:** vector FFC crest SVG (user-exported asset), palette re-align (khaki-gold + cream brand vs current red+navy), Poll Depth-B kickoff (multi-session, blocked on §3.18 admin-create-matchday tooling).

**Estimated scope:** Profile is heavier than Leaderboard (more data, more layout, achievements calculations). Likely 1 long session or 1.5 sessions. Plan via planner-agent at S023 open if scope is uncertain.
