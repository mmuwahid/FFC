# Session Log — 20/APR/2026 — S009 — Safe-area v2 + 5 new Depth-B screens + 3 new features spec'd

**Project:** FFC
**Type:** Execution (pre-implementation Phase 1 design)
**Phase:** Phase 1 Design (Depth B)
**PC:** Home PC
**Duration:** Long (multiple batched waves across the afternoon)
**Commits:** N/A (non-git OneDrive workspace; no code yet)
**Status at close:** PARTIAL — 2 subagents still running at forced pause (tokens low); scratch files for 1 finished subagent not yet integrated; remaining 3-7 mockup updates pending.

---

## Summary

Marathon execution session. Delivered on S008's 7-item plan (items 0–6) then absorbed a large user-feedback scope expansion (new state 8 redesign, new feature: captain reroll, new feature: live draft visibility, new feature: formation planner, settings v2 amendments). Also shipped and then re-fixed a safe-area bug (two iterations — env() fallback semantic + status-bar-should-flank-island semantic).

**What got done (items from S008 plan — ALL DONE):**
- **Item 0** — Safe-area retrofit on all 5 approved mockups + 4 new ones. Took 2 iterations: v1 used `env(safe-area-inset-top, 59px)` expecting fallback to apply in desktop preview (it doesn't — `env()` resolves to `0px` on rectangular viewports, which is a defined value, so the fallback is never used). v2 fix: hardcode `--safe-top: 59px` etc. directly in `.phone`, and set `.statusbar { height: var(--safe-top); display: flex; justify-content: space-between; }` so time/battery FLANK the island on left/right, not pushed BELOW it. **That's the real iPhone pattern the user called out.** Final state: all 7 phone-frame mockups retrofitted; 3-16 being retrofitted by in-flight subagent; 3-19 will be created with correct pattern baked in. Welcome.html needed only viewport-meta update (card layout, no phone frame).
- **Item 1** — §3.16 Settings Depth-B spec + `3-16-settings.html` mockup (subagent, integrated into master spec).
- **Item 2** — §3.15 Match-detail upgraded from STUB to full Depth-B spec + `3-15-match-detail.html` mockup (subagent, integrated).
- **Item 3** — §2.7 new RPCs `set_matchday_captains` + `update_guest_stats` + `match_guests` audit cols `updated_by`/`updated_at` (subagent, integrated).
- **Item 4** — §3.17 Admin Players + §3.18 Admin Matches Depth-B specs + `3-17-admin-players.html` + `3-18-admin-matches.html` mockups (subagent, integrated). Surfaced data-model amendments: new `admin_audit_log` table, new `rejected` profile_role enum value, new `profiles.reject_reason` column, new `edit_match_result` RPC.
- **Item 5** — §3.7 Poll State 8 "Teams revealed" added to spec + states table + acceptance criteria + Phase-2-deferred line deleted (mine). State 8 mini-tile added to mockup with team-pill CSS. **Partial:** state 7 button colours (green/red) + state 8 roster redesign (2-team × 7 layout) NOT YET DONE at pause.
- **Item 6** — `_wip/iphone-safe-area-research.md` promoted to `docs/platform/iphone-safe-area.md`; §3.0 "Platform safe-area" cross-cutting sub-section added; CLAUDE.md Rule #10 expanded (subagent, all done).
- **Item 7 — S009 close-out** — NOT STARTED. This log is partial.

**Scope additions landed mid-session (user feedback):**
- **FFC naming correction.** Forward-facing "Friends FC" / "Friends Football Club" references removed from CLAUDE.md line 1, poll-mockup crest text (2 occurrences). Historical session logs (S001, S008) preserved as audit record. User memory saved: `user_app_name.md`. Subagent prompts going forward must use "FFC" only.
- **FFC crest logo enhancement.** Poll mockup crest widened to 34×34 shield-ish shape with "FFC" monogram (was single "F" letter). Placeholder until a real logo asset exists.
- **State 7 button colour rule** (PARTIAL — spec amendment still pending): safe-action button = GREEN, destructive-action button = RED. Applies to the penalty sheet modal — `[Keep my spot]` green, `[Confirm cancel]` red.
- **State 8 roster redesign** (PARTIAL — not yet done): when teams are revealed the "Confirmed 14/14" single list should split into two sections — `WHITE TEAM` header + 7 rows, `BLACK TEAM` header + 7 rows. Current mockup only shows a 3-row mini-tile as proof-of-concept.
- **NEW FEATURE — Live captain draft visibility.** Subagent B drafted spec for a new §3.7 State 6.5 "Draft in progress" — all logged-in players see team picks happening live via Supabase realtime on new `draft_sessions` + `draft_picks` tables. Scratch at `_wip/item-b-draft-reroll-spec.md` (329 lines). **Not yet integrated into master spec.**
- **NEW FEATURE — Captain reroll on post-lock dropout.** Subagent B drafted spec for §3.7 "Post-lock substitution with captain reroll right" sub-section — when player cancels after roster lock, captain of the losing team gets a modal: `[Accept substitute]` (green, straight sub) OR `[Request reroll]` (warn amber, re-draft all 14 non-captain slots). Reroll window closes 12h before kickoff; past that, substitute auto-accepted. Scratch at `_wip/item-b-draft-reroll-spec.md`. **Not yet integrated.**
- **NEW FEATURE — Formation planner §3.19.** Subagent C IN FLIGHT at pause — drafting Depth-B spec for a 7v7 formation picker screen: captain picks pattern (2-3-1 / 3-2-1 / 2-2-2 / 3-1-2 / 2-1-3 / 1-3-2 / Custom), drag-drop player tokens on top-down pitch SVG, shares to team via `share_formation` RPC, non-captains see read-only live-synced layout. 24h-before-kickoff entry window. Scratch file + `3-19-formation.html` mockup expected.
- **Settings v2 amendments.** Subagent A IN FLIGHT at pause — applying user-feedback to §3.16 + 3-16-settings.html:
  - Default theme = DARK (was `system`).
  - REMOVE `position_changed` notification entirely from push_prefs.
  - CHANGE `poll_reminder` default timing: fires **2 minutes before poll close** (was 24h before). User confirmed this is intentional — "last call to vote" pattern.
  - ADD new notification `dropout_after_lock` (fires to all confirmed + admins when post-lock cancel promotes a waitlist sub).
  - Also apply the statusbar v2 safe-area fix to 3-16-settings.html.

---

## Files modified this session

### Master design spec (`docs/superpowers/specs/2026-04-17-ffc-phase1-design.md`)
- §2.1 Decisions Locked item 11: RPC count bumped 11 → 13 (after items 3+4 drafts added `edit_match_result`, now 14 expected).
- §2.3 `match_guests`: + `updated_by uuid REFERENCES profiles(id)` + `updated_at timestamptz` (audit cols) + migration note block.
- §2.7 Part 5B: + `set_matchday_captains(matchday_id, white_profile_id, black_profile_id)` + `update_guest_stats(guest_id, ...)` RPCs; header "Eight" → "Thirteen" privileged RPCs; GRANT EXECUTE statements added. `edit_match_result` RPC referenced but still needs its own §2.7 entry (drafted in item-4 scratch but may not have made the integration cut — verify at S010 open).
- §3.0 Platform safe-area (NEW cross-cutting sub-section) — lines 1026-1043. 5 CSS checkpoints + mockup review contract + testing requirement.
- §3.7 Poll: State 8 "Teams revealed (S009)" added to states table; acceptance criterion #8 added; Phase-2-deferred team-colour line DELETED and replaced with a closure note.
- §3.15 Match-detail: STUB replaced with full Depth-B (~130 lines) — sheet container behaviour, W/D/L perspective rule, MOTM row, roster rendering contract, late-cancel strip, footer, 13 acceptance criteria.
- §3.16 Settings (NEW Depth-B, ~115 lines).
- §3.17 Admin Players (NEW Depth-B, ~130 lines).
- §3.18 Admin Matches (NEW Depth-B, ~130 lines).
- S009 V2.7 migration-notes block appended before `## Section 4` — consolidates all data-model deltas.

### Mockups (`.superpowers/brainstorm/635-1776592878/content/`)
- `welcome.html` — viewport meta updated (minimal — card layout, no phone frame).
- `3-7-poll-screen.html` — v3 → v4: safe-area hardcoded, statusbar v2 flex-flank-island pattern, FFC crest upgraded to shield-monogram, State 8 tile added with team pills, "Friends FC" crest text removed.
- `3-13-leaderboard.html` — v2 → v3: safe-area hardcoded, statusbar v2, Dynamic Island upsized to 124×37 (was 120×28).
- `3-14-player-profile.html` — v3 → v4: safe-area hardcoded, statusbar v2, phone-inner now `overflow-y: auto` + `padding-bottom: 110px` so all 6 Achievement tiles + full Recent matches render (was clipped by `overflow: hidden`).
- `3-1-v2-captain-helper.html` — v1 → v2: safe-area hardcoded, statusbar v2.
- `3-15-match-detail.html` — NEW (~770 lines).
- `3-16-settings.html` — NEW (~720 lines). BEING UPDATED by subagent A at pause.
- `3-17-admin-players.html` — NEW (~660 lines).
- `3-18-admin-matches.html` — NEW (~680 lines).
- `3-19-formation.html` — BEING CREATED by subagent C at pause.

### Other files
- `CLAUDE.md` line 1 — "# FFC — Friends Football Club" → "# FFC". Rule #10 expanded with doc link + 5-checkpoint reminder.
- `tasks/lessons.md` — new S009 row documenting the `env()` fallback semantic (fallback is for unrecognised vars, not zero-resolved values).
- `docs/platform/iphone-safe-area.md` — promoted from `_wip/iphone-safe-area-research.md`. Updated heading + status line.
- `_wip/iphone-safe-area-research.md` — REMOVED (promoted).
- `_wip/item-1-settings-spec-draft.md` — REMOVED after integration.
- `_wip/item-2-match-detail-spec-draft.md` — REMOVED after integration.
- `_wip/item-4-admin-spec-draft.md` — REMOVED after integration.
- `_wip/item-b-draft-reroll-spec.md` — PRESENT (329 lines; not yet integrated).
- `~/.claude/projects/.../memory/user_app_name.md` — NEW memory: "App name is FFC only. Never Friends FC or Friends Football Club."

---

## Decisions LOCKED in S009

1. **Safe-area pattern for mockups** — hardcode simulation values (`--safe-top: 59px; --safe-bottom: 34px; --safe-left: 0px; --safe-right: 0px;`) on `.phone`. Do NOT rely on `env(safe-area-inset-*, <fallback>)` — the fallback is only used when the variable is UNRECOGNISED, not when it resolves to 0 (desktop browsers do resolve it, just to 0). Production app stylesheet will use real `env()` — kept as a separate concern from mockup files.
2. **Statusbar is the safe-area-top zone, not above/below it.** `.statusbar { height: var(--safe-top); display: flex; justify-content: space-between; align-items: center; }` — time on left, battery on right, island centered between them. NOT `padding-top: var(--safe-top)` (which pushes time/battery below the notch — the bug this session caught).
3. **Dynamic Island simulation dimensions** — 124×37 px pill at `top: 11px` (for phones without outer padding, e.g. 3-7) or `top: 21px` (for phones with 10px outer bezel padding, e.g. 3-13, 3-14, 3-1-v2, 3-15, 3-16, 3-17, 3-18, 3-19), z-index 100, `pointer-events: none`.
4. **§3.7 state count** — "Eight key states" after State 8 landed. With subagent B's in-flight State 6.5 and State 8.5 additions, this will renumber again in S010 → "Nine key states" or retain sub-numbering ("6.5 / 8.5") per subagent B's recommendation.
5. **§3.7 State 7 button colour rule** (DECIDED; NOT YET APPLIED to spec/mockup):
   - `[Keep my spot]` — **success-green**, default focus, safe-action.
   - `[Confirm cancel]` — **danger-red**, destructive confirmation.
   - Durable rule across the app: green = confirm safe, red = confirm destructive.
6. **§3.7 State 8 roster layout** (DECIDED; NOT YET APPLIED):
   - Single `Confirmed 14/14` list splits into two stacked sections: `WHITE TEAM` header + 7 rows, `BLACK TEAM` header + 7 rows. Each row shows avatar + name + position pills (+ guest gold-italic treatment unchanged).
7. **NEW — Live captain draft visibility (State 6.5)** (DECIDED by subagent-B scratch; NOT YET INTEGRATED).
   - Trigger: admin completes §3.1-v2 "Pick captains" → draft session created.
   - Players see picked players moving into WHITE/BLACK sections in realtime; unpicked pool grey.
   - Current-picker team indicator with subtle pulse.
   - Supabase realtime subscription on `draft_picks` + `draft_sessions.current_picker_team`; sync within 2s.
8. **NEW — Captain reroll right on post-lock dropout** (DECIDED by subagent-B scratch; NOT YET INTEGRATED).
   - Player X on team T cancels within 24h → penalty applied, waitlist sub Y auto-promoted.
   - Captain of T gets `dropout_after_lock` push + in-app modal: `[Accept substitute]` (green) OR `[Request reroll]` (amber).
   - Accept → teams unchanged with Y replacing X.
   - Reroll → new `draft_sessions` row (`reason='reroll_after_dropout'`), all 14 non-captain slots re-picked; opposing captain cannot veto.
   - 12h before kickoff cutoff; past that, substitute auto-accepted.
   - Captain-is-the-dropout → separate admin flow, routed via `captain_dropout_needs_replacement` notification.
9. **NEW — Formation planner §3.19** (DECIDED; DRAFTING in flight by subagent C).
   - 7v7 formations: `2-3-1 · 3-2-1 · 2-2-2 · 3-1-2 · 2-1-3 · 1-3-2 · Custom` (user said "suggest" — these are the standard 7v7 patterns; formations research pointed to same top-down-pitch-with-draggable-tokens UI that Fantasy Premier League, OneFootball, FIFA FUT use — not reinventing).
   - Entry: 24h before kickoff; captain-only edit; non-captain read-only live view.
   - Realtime via Supabase on new `formations` table.
   - New RPCs: `upsert_formation` + `share_formation`.
10. **Settings v2 amendments** (DECIDED; APPLYING in flight by subagent A).
    - Default theme: `dark` (was `system`).
    - REMOVE `position_changed` from push prefs entirely.
    - `poll_reminder` timing: **2 min before poll close** (last-call pattern; user confirmed this aggressive timing is intentional).
    - ADD new `dropout_after_lock` notification to push prefs.
11. **FFC naming rule** — app is "FFC" only. Never "Friends FC", never "Friends Football Club". The acronym is not disclosed as anything. Applies to user-facing copy, mockup text, spec descriptions, subagent prompts, session logs forward.

---

## Data model amendments queued for masterplan V2.7

Consolidated across items 3, 4, 8, 9 and Settings v2:

**§2.1 enums**
- `profile_role`: add `'rejected'` enum value.
- New enum `draft_status` ('in_progress' | 'completed' | 'abandoned').
- New enum `draft_reason` ('initial' | 'reroll_after_dropout').
- Verify `team_color` ('white' | 'black') exists; if not, create it.

**§2.2 `profiles`**
- Add `reject_reason TEXT` (nullable).

**§2.3 tables (new + modified)**
- `match_guests` — `updated_by uuid REFERENCES profiles(id)` + `updated_at timestamptz` (LANDED in S009 item 3).
- `match_players` — `substituted_in_by uuid REFERENCES profiles(id)` (nullable; audit for post-lock sub).
- NEW table `admin_audit_log { id bigserial PK, admin_profile_id uuid FK, target_entity text, target_id uuid, action text, payload_jsonb jsonb, created_at timestamptz DEFAULT now() }`.
- NEW table `draft_sessions { id uuid PK, matchday_id uuid FK, status draft_status, current_picker_team team_color, reason draft_reason, triggered_by_profile_id uuid FK, started_at timestamptz, completed_at timestamptz }`.
- NEW table `draft_picks { id uuid PK, draft_session_id uuid FK, pick_order int, team team_color, profile_id uuid FK nullable, guest_id uuid FK nullable, picked_at timestamptz, CHECK: exactly one of profile_id/guest_id is NOT NULL }`.
- NEW table `formations { id uuid PK, matchday_id uuid FK, team team_color, pattern text, layout_jsonb jsonb, last_edited_by uuid FK, last_edited_at timestamptz, shared_at timestamptz }`.

**§2.7 Part 5B RPCs** (13 landed in S009 item 3; adding more now):
- `set_matchday_captains(matchday_id, white, black)` — LANDED.
- `update_guest_stats(guest_id, ...)` — LANDED.
- `edit_match_result(match_id, patch JSONB)` — drafted in item 4 scratch; verify present in master spec.
- `promote_from_waitlist(matchday_id, departing_profile_id)` — NEW from subagent B scratch.
- `accept_substitute(matchday_id)` — NEW.
- `request_reroll(matchday_id)` — NEW.
- `submit_draft_pick(draft_session_id, profile_id | guest_id)` — NEW.
- `upsert_formation(matchday_id, team, pattern, layout_jsonb)` — NEW from subagent C (in-flight).
- `share_formation(formation_id)` — NEW from subagent C (in-flight).
- Post-integration RPC count: ~20 (to verify after full integration).

**New notification types** (Section 5 — not yet written; consolidated list to carry forward):
- `dropout_after_lock` (NEW; replaces nothing).
- `draft_reroll_started` (NEW).
- `reroll_triggered_by_opponent` (NEW).
- `captain_dropout_needs_replacement` (NEW; admin-facing).
- `formation_reminder` (NEW; 24h before kickoff, captain-only).
- `formation_shared` (NEW; fires to all team members when captain shares).
- REMOVED from push prefs: `position_changed` (no longer a setting option).

**New `app_settings` keys**
- `draft_stuck_threshold_hours` (default 6).
- `reroll_cutoff_hours_before_kickoff` (default 12).
- `poll_reminder_offset_minutes` (default `-2`; fires 2 min BEFORE poll_close_at).

---

## Subagent status at forced pause

| ID | Task | Status |
|---|---|---|
| A (aba42dd572d165747) | Settings v2 amendments + mockup update | **IN FLIGHT** — not yet notified |
| B (aa71f916dec3ab08b) | Captain reroll + live draft specs | **COMPLETE** — scratch at `_wip/item-b-draft-reroll-spec.md` (329 lines). Not yet integrated into master spec. |
| C (a4979e9ea650b1c47) | Formation planner §3.19 + mockup | **IN FLIGHT** — not yet notified |

**Important.** When S010 resumes, the two in-flight subagents' completion notifications will either have fired (check `_wip/` for their scratch files + `.superpowers/brainstorm/.../content/` for 3-16 updates and 3-19 creation) or they'll need to be relaunched. Prompts for A + C are captured in `sessions/S009/agent-prompts.md` (TO BE WRITTEN — see NEXT SESSION checklist below).

---

## Open items / NOT DONE at forced pause

High priority to finish BEFORE anything else in S010:

1. **Integrate subagent B scratch** (`_wip/item-b-draft-reroll-spec.md`) into master spec:
   - Insert State 6.5 "Draft in progress" into §3.7 states table + rendering contract.
   - Append "Post-lock substitution with captain reroll" sub-section to §3.7 (after current state table).
   - Update §3.18 Admin Matches with draft-session admin controls (Phase 5.5 in phases ladder).
   - Append data-model amendments to the existing V2.7 migration-notes block.

2. **Wait for / integrate subagent A** (Settings v2):
   - If scratch file exists at `_wip/item-settings-v2-amendments.md`, integrate the row 1 + row 2 replacements into §3.16.
   - Verify `3-16-settings.html` was updated (dark default, 6-checkbox list, statusbar v2 fix).

3. **Wait for / integrate subagent C** (Formation planner):
   - If scratch file exists at `_wip/item-formation-planner-spec.md`, insert full §3.19 into master spec after §3.18.
   - Verify `3-19-formation.html` was created.

4. **Finish 3-7 poll mockup updates:**
   - State 7 mini-tile: replace "Confirm?" pill with green `[Keep my spot]` + red `[Confirm cancel]` buttons. Add `.btn-success` + `.btn-danger` button styling.
   - State 8 mini-tile: expand to show 2-team roster layout (WHITE header + 7 rows, BLACK header + 7 rows).
   - Add new State 6.5 mini-tile for "Draft in progress" (pending subagent B integration).

5. **Update spec §3.7 state table** to:
   - Explicitly document green/red button colour rule on State 7.
   - Add State 6.5 "Draft in progress" row (from subagent B).
   - Update State 8 row to mention 2-team sections layout.
   - Update header count from "Eight" to "Nine" (or use 6.5 / 8.5 sub-numbering per subagent B).
   - Update acceptance criteria accordingly.

6. **Update lessons.md with the S009 v2 follow-up lesson** (first fix with `padding-top: var(--safe-top)` on statusbar was ALSO wrong — it pushed time/battery below the notch instead of flanking it. Correct pattern: statusbar IS the safe-top zone via `height: var(--safe-top)` + flex space-between). Add a third row to the lessons table.

7. **Write masterplan V2.7** (`planning/FFC-masterplan-V2.7.md`): consolidate all S009 data-model deltas, new screens §3.0/§3.15 upgrade/§3.16/§3.17/§3.18/§3.19, new features (live draft / captain reroll / formation planner), Settings v2 defaults (dark/2-min/no position_changed/+dropout_after_lock).

8. **Close-out** (item 7 from S008 plan):
   - Bump `CLAUDE.md` latest-session block to S009 (currently still S008).
   - Update `sessions/INDEX.md` with S009 row.
   - Write `tasks/todo.md` NEXT SESSION block for S010 (use this log's open-items list).

---

## NEXT SESSION (S010) — cold-start checklist

When you resume in S010:

1. **Read in this order:**
   - `CLAUDE.md` (note: latest-session block still says S008 at pause; needs S009 bump).
   - `sessions/INDEX.md` (needs S009 row).
   - `sessions/S009/session-log.md` (this file).
   - `tasks/todo.md` NEXT SESSION block (not yet written at pause).
   - `tasks/lessons.md` (S008 + S009 env() rows present; S009 statusbar-flank row PENDING).

2. **Check subagent residue:**
   - `_wip/item-b-draft-reroll-spec.md` (329 lines) — PRESENT, ready to integrate.
   - `_wip/item-settings-v2-amendments.md` — check if subagent A finished.
   - `_wip/item-formation-planner-spec.md` — check if subagent C finished.
   - `.superpowers/brainstorm/635-1776592878/content/3-16-settings.html` — check if subagent A modified it (dark default, 6 checkboxes, statusbar v2).
   - `.superpowers/brainstorm/635-1776592878/content/3-19-formation.html` — check if subagent C created it.
   - If scratch files missing + mockups unchanged, relaunch those two subagents using prompts captured in this log (scroll up to the prompts).

3. **Execute in priority order (items 1–8 from "Open items" list above):**
   - Integrate subagent B scratch → §3.7 + §3.18 + V2.7 notes.
   - Integrate subagent A / C outputs.
   - Finish 3-7 poll mockup updates (state 7 + state 8 + state 6.5).
   - Update lessons.md + masterplan V2.7 + session close-out.

4. **Verify at end:**
   - Run the Grep for `Friends FC|Friends Football Club` across the whole project — should return only historical session-log occurrences (S001, S008) which are intentionally preserved.
   - Run Grep for `padding-top:\s*var\(--safe-top\)` on `.statusbar` in any mockup — should return ZERO (the wrong pattern); if any found, apply the v2 fix.
   - Count safe-area markers across mockups (expect ~20 after 3-19 lands).

---

## Lessons learned this session (captured in lessons.md + memory)

1. **`env(safe-area-inset-*)` fallback semantic.** The second arg to `env()` is used ONLY when the environment variable is unrecognised (not when it resolves to 0). Desktop browsers DO recognise `safe-area-inset-*`; they just return `0px` on rectangular viewports. Hardcode simulation values in mockups. Logged in lessons.md S009 row 1.

2. **Safe-area padding direction matters.** `padding-top: var(--safe-top)` on a status bar element pushes ITS CONTENT below the notch — wrong pattern. The status bar itself IS the safe-area-top zone; its content (time / battery) should flank the notch horizontally. Correct pattern: `height: var(--safe-top)` + `display: flex; justify-content: space-between; align-items: center;` — time left, battery right, island visible in the middle via the absolute-positioned `.phone::after`. TO LOG in lessons.md at S010 open.

3. **Frame decisions before drafting when multiple downstream artifacts depend on them.** (Carried from S008.) Confirmed again this session — subagent prompts were crafted once all decisions locked, producing clean spec drafts first try.

4. **Parallelism via scratch files.** Three parallel spec-drafting subagents writing to `_wip/` scratch files (one .md per subagent) avoided any design-spec file collisions. Main thread integrated afterwards sequentially. This is a reusable pattern when multiple subagents have work targeting the same file.

5. **Scope-expansion handling.** User delivered a large scope bundle mid-session (new state redesign + 3 new features + settings v2). Instead of sequential draft-or-die, parallelized via 3 more subagents to _wip/ + new mockup files. Key: new mockup files never collide (different filenames); spec amendments go to scratch first.

---

_Session logged: 20/APR/2026 | Logged by: Claude (forced pause — low tokens) | S009_
