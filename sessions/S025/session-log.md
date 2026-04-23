# Session Log — 2026-04-23 — S025 — §3.17 Admin Players full + §3.18 Admin Matches full + polish

**Project:** FFC (Friends FC)
**Type:** Build
**Phase:** Phase 1 Step 4 — UI slices
**PC:** Work (UNHOEC03)
**Duration:** ~3 hours
**Commits:** `fc5d7ee`, `bde8c70`
**Live:** https://ffc-gilt.vercel.app

---

## What Was Done

### Cold-start
- Cross-PC sync protocol: work PC `.git` pointer correct, `main` at `a387d29` (S024 close), `origin/main` clean. No lag, state (a).
- User instruction: skip step-by-step walkthroughs, implement §3.17 full + §3.18 full against approved mockups, deploy, then do a single UI testing pass.

### Migration 0016 — 8 admin RPCs
Written and applied to live DB. All `SECURITY DEFINER`, admin-gated via `is_admin()`, admin-audit-logged via `log_admin_action()`:

- `update_player_profile(profile_id, display_name, primary, secondary, is_active, role?)` — whitelist fields; `positions_identical` guard; role change gated by `is_super_admin()` with `super_admin` elevation blocked. Clears `reject_reason` when flipping role away from rejected.
- `ban_player(profile_id, reason, ends_at)` — reason ≥10 chars, ends_at future, idempotency guard on existing active ban. Inserts `player_bans`, flips `profiles.is_active=false`.
- `unban_player(profile_id)` — revokes all open bans (revoked_at + revoked_by), reactivates profile. Idempotent.
- `reinstate_rejected(profile_id)` — flips role `rejected → player`, clears `reject_reason`, reactivates. Raises if not currently rejected.
- `create_matchday(season_id, kickoff_at, venue, poll_opens_at, poll_closes_at, format?)` — validates poll window ordering and poll-before-kickoff. Empty-string venue normalised to NULL.
- `update_matchday(matchday_id, ...optional fields + venue_explicit_null + format_explicit_null)` — whitelist patch with explicit-NULL flags for venue/format.
- `lock_roster(matchday_id)` — sets `roster_locked_at=now()`. Raises `already_locked` if already set.
- `admin_submit_match_result(matchday_id, score_white, score_black, motm_profile_id, motm_guest_id, players jsonb, notes?, approve=true)` — single-call atomic submit: creates `matches` row + N `match_players` rows. Derives `match_result` enum from scores. Approves by default. Raises `match_exists_use_edit_match_result` if a matches row already exists for that matchday. Payload shape: `[{profile_id? | guest_id?, team, is_captain, goals, yellow_cards, red_cards, is_no_show}, ...]`.

Explicit `GRANT EXECUTE ... TO authenticated` on all 8 (SECURITY DEFINER needs this because DEFAULT PRIVILEGES from 0012 only cover tables/sequences).

### §3.17 AdminPlayers — full replacement
`ffc/src/pages/admin/AdminPlayers.tsx` rewritten from 366 → 953 lines. 4 tabs: Active · Pending · Banned · Rejected.

- **Search** (name + email, client-side, 200ms-free filter via useMemo).
- **Active list** — row-tap opens Edit sheet (display_name input, primary/secondary `<select>`, Active pill toggle, Role chip row when super_admin viewing non-rejected). 🚫 icon button on right → Ban sheet.
- **Edit sheet** — client-side validation (name ≥2 chars, positions ≠). Save disabled until dirty. `secondary` `<select>` auto-filters out the selected primary. Role change args omitted unless `newRole !== profile.role` AND caller is super_admin.
- **Ban sheet** — reason textarea with char counter + duration chips (7 Days / 14 Days after user feedback) + custom days input. "Returns {DD/MMM/YYYY}" live label.
- **Banned list** — shows reason + ends_at via joined `player_bans`. Inline Unban button → simple confirm sheet → `unban_player` RPC.
- **Rejected list** — shows reject_reason inline. Inline Reinstate button → simple confirm sheet → `reinstate_rejected` RPC.

### §3.18 AdminMatches — full replacement
`ffc/src/pages/admin/AdminMatches.tsx` rewritten from 150 → 996 lines. 3 segments: This week · Upcoming · Past.

- Bucketing by `kickoff_at`: past = < now-3h, this_week = ≤ now+7d, upcoming = later.
- **Matchday card** — day-of-week + date header, format chip (7v7 / 5v5 colour-coded), state-derived phase label with 4-tone colour (muted/warn/accent/success), poll window + lock meta, score row with ⚪/⚫ team circles when match exists, result chip (W wins / B wins / Draw).
- **Per-card state-aware actions** — admin options appear based on phase: Edit matchday (always when no result), Lock roster (only if unlocked), Enter result (always), Edit result (when match exists).
- **Create matchday sheet** — datetime-local fields for kickoff / poll_opens / poll_closes + venue + format chips (7v7 default / 5v5). Each datetime shows a preview below: `THU · 30/APR/2026 · 8:15pm`. Default kickoff = next Thursday 8:15pm; poll opens Mon 9am, closes Wed 9pm.
- **Edit matchday sheet** — same fields, pre-filled. Venue/format support explicit-NULL via companion boolean flags.
- **Lock confirm** — simple sheet → `lock_roster` RPC.
- **Result entry sheet** — score inputs side-by-side (WHITE ⚪ / BLACK ⚫), roster builder: `+ WHITE` / `+ BLACK` picker opens a scrollable list of active players (filters out already-added), per-row controls: goals number input, yellow cards (max 2), red cards (max 1), captain `(C)` chip, no-show `NS` chip, ✕ remove button. MOTM `<select>` populated from rostered non-no-show profiles. Notes textarea. "Approve immediately" pill (default on). Single RPC call via `admin_submit_match_result`.
- **Edit result sheet** — only for existing match rows (approved or not). Score / MOTM / notes editable via `edit_match_result` RPC. Per-team roster grid below the score card (⚪ WHITE left, BLACK ⚫ right), filtered to players with events only (scored / carded / no-show / captain / MOTM). MOTM gets ⭐ next to name; captains get `(C)`. Per-player stat edits post-approval explicitly deferred to Phase 2 (requires new `edit_match_players` RPC).
- **Friendly review card** — kept verbatim from S024, sits above the segment tabs when `friendly_flagged_at IS NOT NULL AND is_friendly=false`.

### CSS additions
`ffc/src/index.css` +242 lines across two appends. New class families:

- `.admin-row / .admin-row-main / .admin-row-action / .admin-row-cta` — unified list-row pattern with main button + side action.
- `.admin-field / .admin-field-label / .admin-field--row / .admin-pill / .admin-chip / .admin-chip--on / .admin-chip--sm` — form field vocabulary for sheets.
- `.admin-md-card / .admin-md-head / .admin-md-phase* / .admin-md-fmt* / .admin-md-result-chip*` — matchday card with 4-tone phase colouring.
- `.admin-score-row / .admin-score-field / .admin-score-sep` — 22px-bold score inputs with uppercase labels.
- `.admin-roster-block / .admin-picker / .admin-roster-list / .admin-roster-row / .admin-roster-team / .admin-roster-stats / .admin-roster-remove` — result-entry roster builder.
- `.admin-team-grid / .admin-team-col / .admin-team-col-list / .admin-team-col-row / .admin-team-motm / .admin-team-c` — two-column per-team grid for Edit result sheet (S025 polish).
- `.admin-dt-preview` — muted preview label under datetime-local inputs.
- `.chip-banned / .chip-inactive / .chip-friendly` — status chips.
- `.sheet--wide` — 640px variant of the bottom sheet with 90vh max + scroll.

### Deploy + user testing
- Commit `fc5d7ee` deployed Vercel `dpl_BB6oHJJQT6iYzvHSY28tpBphn57M` READY in 15s. User tested live.
- User feedback: (1) Create matchday returned runtime error `function public.log_admin_action(uuid, unknown, uuid, unknown, jsonb) does not exist`; (2) Ban duration pills too many — keep 7d + 14d, full-word labels; (3) Create matchday date format should show day-of-week + 12h time; (4) Format chips: drop "Inherit", 7v7 default; (5) Edit result roster: two-column per-team grid under score card, only players with events; (6) Team circles ⚪⚫ before WHITE/BLACK labels.

### Polish pass — fix log_admin_action + UI feedback
Commit `bde8c70`.

- **log_admin_action signature** — dumped via `pg_proc`: `(p_target_entity text, p_target_id uuid, p_action text, p_payload jsonb)` — 4 args, admin derived internally via `current_profile_id()`. My RPCs called it with 5 args (leading `v_admin`). Python in-place edit to strip the `v_admin, ` prefix from all 8 call sites (one multi-line + 7 inline). Re-applied migration 0016 to live DB via `db query --linked --file`. All admin RPCs now callable.
- **Ban pills** — reduced `[7, 14, 30, 60, 90]` → `[7, 14]`, labels changed from `7d` → `7 Days`. Custom days input preserved with "days" hint.
- **Create/Edit matchday format** — removed "Inherit" chip, set state default to `seasonDefaultFormat || '7v7'`, always pass `p_format`.
- **Datetime preview** — new helper `dowLabel(iso) → 'THU'`, rewrote `timeLabel(iso)` to 12-hour ("8:15pm"), `fullLabel(iso) → 'THU · 30/APR/2026 · 8:15pm'`. Added `<span className="admin-dt-preview">` under each datetime-local input showing the preview.
- **Matchday card header** — prefixed with `dowLabel(md.kickoff_at)`.
- **Team circles** — ⚪/⚫ added to matchday-card score row, Edit result score row, and RosterColumn titles.
- **Per-team RosterColumn component** — new helper. Filters `hasEvent(p)` = goals>0 OR cards>0 OR no_show OR captain OR MOTM. Renders title + per-row name (with (C) and ⭐ inline) + stats cluster (⚽ goals, 🟨 yellows with count if >1, 🟥 red, NS chip).

### Verification
- `tsc -b --noEmit` clean both passes.
- `vite build` clean (601KB main, 167KB gz; PWA SW regenerated).
- Vercel `dpl_DrQXtFhTRQX2Qf5RMYKSX324t9ns` deployed READY for `bde8c70`.
- User completed full UI test pass and approved all flows.

---

## Files Created or Modified

### Commit `fc5d7ee` — S025 initial bundle (5 files, 2251 insertions)
- `supabase/migrations/0016_admin_rpcs.sql` — NEW · 8 admin RPCs
- `ffc/src/pages/admin/AdminPlayers.tsx` — rewritten 366 → 953 lines
- `ffc/src/pages/admin/AdminMatches.tsx` — rewritten 150 → 996 lines
- `ffc/src/lib/database.types.ts` — regenerated from live schema
- `ffc/src/index.css` — +188 lines of admin styles

### Commit `bde8c70` — S025 polish (4 files, 142 insertions)
- `supabase/migrations/0016_admin_rpcs.sql` — Python in-place edit stripping `v_admin` arg from 8 log_admin_action calls
- `ffc/src/pages/admin/AdminPlayers.tsx` — ban pills 7d/14d full-word
- `ffc/src/pages/admin/AdminMatches.tsx` — dowLabel + 12h time + datetime preview + format pills + team circles + RosterColumn
- `ffc/src/index.css` — +54 lines (.admin-dt-preview, .admin-team-*)

### Hot patches to live DB (not in migration file)
- `_wip/0016_patch_team_color.sql` — fixed `team_colour` → `team_color` enum cast in `admin_submit_match_result` body (plpgsql is lazy-validated; cast failed at first call). Re-run to patch live, then edited migration file to match.
- Second in-place edit to migration 0016: stripped `v_admin` from all 8 `log_admin_action` calls. Re-applied via `db query --linked --file supabase/migrations/0016_admin_rpcs.sql`.

---

## Key Decisions

- **Admin direct-submit over ref-entry flow for Phase 1.** `admin_submit_match_result` creates the match + match_players + approves in one RPC. Bypasses the `match_entries`/`approve_match_entry` ref workflow because there's no ref-entry UI yet and admin effectively IS the ref in early Phase 1.
- **Per-player stat edits post-approval = Phase 2.** `edit_match_result` only handles score/result/MOTM/notes. Editing individual goals/cards after a match is approved would need a dedicated `edit_match_players` RPC — queued for Phase 2. Read-only roster display on the Edit result sheet for now.
- **Time-based bans, not matchday-based.** Spec called for `return_matchday_id` but live `player_bans` schema has `ends_at timestamptz`. Went with live schema; matchday-based bans can be rebuilt on top later.
- **Drop "Inherit" format chip** per user feedback. Simpler mental model — admin picks 7v7 or 5v5 directly; server still stores NULL-means-inherit at the DB level but the UI doesn't expose the semantic.
- **Players-with-events filter on Edit result roster.** User preferred a tight summary over a flat 14-player dump. Rendered only goals/cards/no-show/captain/MOTM rows.

---

## Lessons Learned

### Mistakes
| Date | Mistake | Root Cause | Prevention Rule |
|------|---------|------------|-----------------|
| 2026-04-23 | Called `log_admin_action(v_admin, entity, id, action, payload)` — 5 args — when real signature is `(entity, id, action, payload)` — 4 args, admin derived internally. First user test of every admin RPC failed with `function does not exist`. | Assumed signature from the spec's prose ("log_admin_action(admin_profile_id, target_entity, ...)") without querying `pg_proc`. The 4-arg form is what landed in migration 0008; spec documented the intended shape but implementation was leaner. | **Before writing PL/pgSQL that calls an existing function, query `pg_proc` for `pg_get_function_arguments(oid)` to confirm the real signature.** Spec and prose are not authoritative; the live function is. |
| 2026-04-23 | Used `team_colour` (British) in a `::public.team_colour` cast inside `admin_submit_match_result`. Postgres accepts the CREATE because plpgsql bodies are parsed lazily, then throws at first call. | Guessed the enum name from FFC's British-English vocabulary bias. Actual enum is `team_color` (American). | **Query `pg_type` for enum names before writing casts — especially when the surrounding codebase is inconsistent about British/American spelling.** Same prevention as the UPPERCASE positions lesson from S024. |
| 2026-04-23 | Used `.order('started_on', ...)` on the `seasons` table when the actual column is `starts_on`. TypeScript didn't catch because PostgREST `.order()` takes a string. | Didn't query `information_schema.columns` for `seasons` before writing the query. Schema drift from an older spec revision. | **Query `information_schema.columns` for every table you order/filter on if you haven't read its DDL in the current session.** The S024 schema-drift pattern applies to non-embed uses too. |

### Validated Patterns

- **Hot-patch live function bodies via `supabase db query --linked --file <path>`** — when a `CREATE OR REPLACE FUNCTION` body has a bug and you've already run `db push`, you don't need a new migration. Edit the migration file to match the fix and re-run it as a raw query; `CREATE OR REPLACE` is idempotent. Keep migration file as source of truth so fresh clones produce the correct state. [S025]
- **Python in-place edit for bulk pattern replacement in long SQL files** — when 8+ call sites need identical `v_admin, ` prefix stripped, a one-off Python script with `str.replace` is cleaner than 8 Edit-tool calls. `sed` would work too but mangles multi-line patterns. [S025]
- **Datetime preview label under `<input type="datetime-local">`** — browser-native input renders differently per platform (US vs EU, 12h vs 24h); a muted `<span>` below the input with an explicit formatted preview (day-of-week + DD/MMM/YYYY + 12h time) makes the format unambiguous and matches the rest of the FFC UI. [S025]
- **Admin direct-submit RPC pattern** — `admin_submit_match_result` does `INSERT matches + INSERT match_players x N + log audit` in one transaction, parameterised with a single `jsonb` player array. Avoids the N+1 roundtrip of client-side fan-out and gives atomic rollback on any row failure. Good shape for any "create parent + children" admin workflow. [S025]
- **Per-team column grid with events-only filter** for match summaries — more legible than a flat team-tagged list, especially at small viewport widths. Filter = `(goals>0) OR (yellow>0) OR (red>0) OR no_show OR is_captain OR MOTM`. [S025]
- **User-driven post-deploy feedback round** — shipping the 90% solution and having the user drive a live testing pass caught 6 concrete issues in one round, faster than iterating speculatively on the mockups. User explicitly opted into this model ("go straight into coding everything... ill run a full ui testing once its all updated"). Works when mockups and spec are already approved. [S025]

---

## Next Actions (S026)

- [ ] `git pull` per mandatory session-start sync protocol. Expected tip: `bde8c70` (or S025 close commit).
- [ ] **Friendly-review end-to-end test** — set `friendly_flagged_at = now()` on an existing matchday manually, confirm the review card appears in AdminMatches, test Confirm + Dismiss flows.
- [ ] **§3.5 +1 guest auto-flag trigger** — write SQL trigger or extend RPC to set `friendly_flagged_at` when guest count crosses threshold (4 per 7v7, 3 per 5v5). Blocked on Poll screen guest-add flow actually existing.
- [ ] **§3.7 Poll screen Depth-B** — the next major UI slice. Multi-session, per masterplan §17 order. Consider spawning planner agent.
- [ ] **Leaderboard Depth-B gate** — add realtime subscription on `matches` UPDATE, pull-to-refresh, 150ms skeleton rows.
- [ ] **§3.18 Phase 5.5 — Draft-in-progress card** — exposed when a draft session is stuck (`draft_stuck_threshold_hours`). Requires `draft_sessions` table to actually be populated, which requires the captain-draft flow on §3.1-v2.
- [ ] **Phase 2 seed**: `edit_match_players` RPC + roster edit UI on Edit result sheet (per-player stats post-approval).
- [ ] **Backburner (unchanged):** vector FFC crest SVG if user sources one; palette re-align (red+navy → khaki-gold + cream).

---

## Commits and Deploy
- **Commit `fc5d7ee`** — `feat(admin): §3.17 Players edit/ban/reinstate + §3.18 Matches full CRUD + migration 0016` (5 files, +2251 / −409)
- **Commit `bde8c70`** — `fix(admin): S025 polish — log_admin_action signature + ban/create-md/edit-result UI` (4 files, +142 / −51)
- **Hot-patches to live DB (no commit):** `team_colour → team_color` fix, `log_admin_action` 5-arg → 4-arg strip. Both were also written back into `supabase/migrations/0016_admin_rpcs.sql` so fresh clones materialise correctly.
- **Live:** https://ffc-gilt.vercel.app (Vercel dpl `dpl_DrQXtFhTRQX2Qf5RMYKSX324t9ns`, deployed READY in 17s)
- **Migrations on live DB now:** 16 (0001 → 0016_admin_rpcs)

---
_Session logged: 2026-04-23 | Logged by: Claude (session-log skill adapted to FFC sessions/S###/ convention) | S025_
