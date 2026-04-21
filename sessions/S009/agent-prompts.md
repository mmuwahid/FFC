# S009 — Subagent prompts (for resume if in-flight agents timed out)

If S010 opens and subagents A or C didn't complete (check `_wip/` for their scratch files + content dir for modified/created mockups), relaunch using these prompts verbatim.

---

## Subagent A — Settings v2 amendments + mockup update

**Task title:** Settings v2 amendments + mockup update
**Subagent type:** general-purpose
**Deliverables:**
1. `_wip/item-settings-v2-amendments.md` — replacement blocks for §3.16 row 1 (Theme) + row 2 (Push notifications) + ASCII layout for push-notifications section + updated acceptance criteria.
2. Direct edit to `.superpowers/brainstorm/635-1776592878/content/3-16-settings.html`:
   - Primary phone now dark (was light); second phone now light.
   - Active theme chip = Dark (not System).
   - Push-notifications checkbox list: Poll opens · Poll reminder (2 min before close) · Roster locked · +1 slot unlocked · Match result posted · Dropout after lock (exactly 6; `position_changed` removed).
   - Page-header copy mentions new defaults.
   - Replace buggy `.statusbar { padding-top: var(--safe-top); ... }` with correct v2 pattern `height: var(--safe-top); display: flex; justify-content: space-between; align-items: center; padding: 0 calc(28px + var(--safe-right)) 0 calc(28px + var(--safe-left));`.

**Key decisions (apply without re-litigating):**
- Default theme = DARK (was `system`).
- REMOVE `position_changed` entirely.
- `poll_reminder` timing → 2 min before poll close.
- ADD `dropout_after_lock` notification.
- Revised push_prefs shape: `{ master, poll_open, poll_reminder, roster_locked, plus_one_unlocked, match_result_posted, dropout_after_lock }`.

---

## Subagent C — Formation planner §3.19 + mockup

**Task title:** Formation planner §3.19 + mockup
**Subagent type:** general-purpose
**Deliverables:**
1. `_wip/item-formation-planner-spec.md` — full §3.19 Depth-B spec mirroring §3.13/§3.14 structure.
2. `.superpowers/brainstorm/635-1776592878/content/3-19-formation.html` — mockup using `3-14-player-profile.html` phone-frame template; statusbar v2 safe-area pattern (NOT the broken `padding-top` pattern).

**Key decisions (apply without re-litigating):**
- Screen is 7v7 formation planner.
- Patterns: `2-3-1 · 3-2-1 · 2-2-2 · 3-1-2 · 2-1-3 · 1-3-2 · Custom`.
- Entry: 24h before kickoff (captain-only edit; non-captain read-only live view).
- New RPCs: `upsert_formation`, `share_formation`.
- New table: `formations { id, matchday_id, team, pattern, layout_jsonb, last_edited_by, last_edited_at, shared_at }`.
- Realtime via Supabase channel on `formations` row.
- Mockup: light phone = captain editing, dark phone = non-captain read-only.
- New push types: `formation_reminder` · `formation_shared`.

---

## Subagent B — DONE (output at `_wip/item-b-draft-reroll-spec.md`)

Output verified at forced pause — 329 lines. Captures:
- State 6.5 "Draft in progress" for §3.7 states table.
- Post-lock substitution with captain reroll sub-section for §3.7.
- §3.18 touch-up for admin draft-session controls.
- Data model amendments for V2.7 (consolidated).

No need to relaunch. Integrate directly into master spec at S010 open.
