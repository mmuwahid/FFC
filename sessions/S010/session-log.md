# Session S010 — 21/APR/2026 (Home PC)

**Focus:** Mockup review round for all S009 deliverables, user amendments via parallel subagent pass, late-session statusbar flex-shrink bug discovery.

**Outcome:** 5 mockup amendments landed. 4 new durable rules saved to memory. One critical layout bug diagnosed but NOT fixed (user deferred to S011). Spec integration + masterplan V2.7 deferred to S011.

---

## Cold start

- Verified `_wip/` contents — all 3 subagent scratch files present (`item-b-draft-reroll-spec.md` · `item-settings-v2-amendments.md` · `item-formation-planner-spec.md`) plus `3-19-formation.html` mockup. Subagent C from S009 completed after forced pause; no relaunch needed.
- Briefing presented to user per resume-session skill contract.
- Visual Companion server started on :5173 pointing at `.superpowers/brainstorm/635-1776592878/content/`.
- User requested review of all 5 new mockups from S009.

## Mockup review outcomes

| Mockup | Status | Notes |
|--------|--------|-------|
| `3-1-v2-captain-helper.html` | ✅ APPROVED | No changes requested (v1 from S007 remains authoritative). |
| `3-13-leaderboard.html` | ✅ APPROVED | No changes requested (v2 from S006 remains authoritative). |
| `3-15-match-detail.html` | ✅ APPROVED | No changes requested (v1 from S009). |
| `3-17-admin-players.html` | ✅ APPROVED | No changes requested (v1 from S009). |
| `3-18-admin-matches.html` | ⚠️ APPROVED WITH AMENDMENT | Tap-to-expand roster → always-visible (see below). |
| `3-19-formation.html` | ❌ REJECTED | Major redesign required (see below). |
| `3-16-settings.html` | ⚠️ APPROVED WITH AMENDMENT | Checkboxes → pill toggles (see below). |
| `3-14-player-profile.html` | ❌ REJECTED | KPI + Achievement tiles "butchered"; late-session also hit by statusbar flex-shrink bug. |
| `3-7-poll-screen.html` | ⚠️ S009 BACKLOG | State 6/7 green/red buttons + State 8 roster redesign + NEW State 6.5 draft-in-progress tile (all per subagent B spec in `_wip/item-b-draft-reroll-spec.md`). |

## Parallel subagent pass (5 agents)

All 5 subagents dispatched simultaneously (no dependencies between files). Results summarised below; full transcripts in per-agent task output files.

### Agent A — Player profile text cutoff
- **Diagnosis:** `.kpi` and `.achievement-tile` had no explicit flex-column layout. Children mixed `<div>` block + `<span>` inline + nested `inline-flex` triplets; default block-flow was unreliable across render engines. Achievement labels also lacked explicit `display: block` + stable `line-height`.
- **Fix:** Added `display: flex; flex-direction: column; align-items: center; gap: 6px; min-height: 52px;` to `.kpi`. Added `display: block` to `.kpi .v`, `.kpi .l`, `.achievement-tile .icon/.big/.lbl/.ctx`. Bumped `.achievement-tile` to `min-height: 96px`. Preserved S007 W-D-L specificity override.
- **Verified** on live DOM post-fix: `.kpi` rendered flex-column at min-height 52px; labels visible at 12px height.
- **BUT** — see late-session bug discovery below. The fix was correct but masked by the flex-shrink issue on the phone frame.

### Agent B — Settings pill toggles
- **Change:** All 12 notification checkbox toggles (6 per phone × 2 phones) replaced with iOS-style capsule pill switches. Master toggle uses same style for consistency.
- **States rendered:** 10/12 ON (accent red `#e63349`, white thumb right), 2/12 OFF (`Poll reminder` on each phone — muted track, thumb left). Proves both visual states.
- **Preserved:** all 6 push-pref keys (no renames), dark palette, safe-area v2 statusbar, master-OFF disabled state (`.checks.disabled { opacity: 0.4 }`).
- **Durable rule captured:** FFC settings toggles are pill switches, not checkboxes (memory: `feedback_pill_toggles_over_checkboxes.md`).

### Agent C — Admin matches always-visible rosters
- **Change:** Tap-to-expand `<div class="roster-more">8 more members hidden · tap to expand</div>` removed. Full 14-player roster rendered inline under match metadata: WHITE team header + 7 rows, BLACK team header + 7 rows.
- **Enhancements:** Team headers have colour swatches + "7 players" count; colour-coded position pills replace text-only `"DEF · CDM"` labels; MOTM ⭐ marker on Mohammed Muwahid (WHITE); guest rows (Samir #7 WHITE, Nabil #14 BLACK) keep italic + gold-tint treatment.
- **Grep confirmed zero** remaining accordion/expand/caret/details tokens.
- **Durable rule captured:** lists ≤14 render inline in FFC (memory: `feedback_always_visible_rosters.md`).

### Agent D — Formation planner redesign
- **Root fixes:** (1) Dynamic Island clearance — `align-items: flex-end` + `padding-bottom: 8px` on `.statusbar` so time/battery sit 8px below island's bottom edge; (2) Team-colour header strip prominent (WHITE on captain phone, BLACK on teammate phone) with orb + "YOU'RE ON {team}" headline + DD/MMM/YYYY meta; (3) Full 7-player roster cards below pitch: avatar · name · position pill · rotation chip (fixed column widths for stable alignment).
- **NEW features spec'd + mocked up:**
  - **Rotating-GK segmented toggle** above pitch — `Dedicated GK` vs `Rotate every 10 min`.
  - **GK-selection radio card** (captain-only) — 4 candidates with time-slot labels (Min 0–10, 10–20, etc.), gold selected-ring.
  - **Rotation badges on pitch tokens** — 18px pill top-right, numeric 1–7 for outfield, gold "GK" for starting keeper.
  - **State tiles ×4** — (A) waiting for captain, (B) rotation ON vs dedicated OFF visual, (C) auto-assignment logic for 1–6 order, (D) realtime share contract with `formations` + `formation_rotation_order` + `share_formation()` RPC chips.
- **Durable rule captured:** FFC rotating-GK gameplay rule (memory: `project_rotating_gk_rule.md`). Real match-day practice; not deferred/hypothetical.
- **Line count:** 1073 → 1384 (+311).

### Agent E — Poll mockup S009 backlog close
- **State 6 (Roster locked):** LOCKED pill + green `[Keep my spot]` + red `[Cancel anyway]` action row.
- **State 7 (24h penalty):** `−1 PT + 7-DAY BAN` info pill + green `[Keep my spot]` + red `[Confirm cancel]` action row.
- **State 8 (Teams revealed):** Restructured from 14-row single-list → 2-section layout. `WHITE TEAM` header (with swatch) + 7 rows (Omar K. = ★ CAPT · 6 members · Ayman +1 gold-italic guest). `BLACK TEAM` header + 7 rows (Saeed B. = ★ CAPT · 6 members · Karim +1 gold-italic). Per-row `[W]/[B]` pill removed (section header IS the team indicator).
- **NEW State 6.5 (Draft in progress):** Inserted between State 6 and State 7 per subagent B spec. LIVE chip with `liveDotPulse` keyframe + `prefers-reduced-motion` disable. Header: `Pick 5 of 14 · ⚪ White picking`. Two-column picks-so-far (White column with picking accent border), gold `C` badge on captains. Available pool of 6 greyed-out players. Footer: `Last pick: Tariq → Black · 2 min ago`.
- **New CSS classes:** `.btn-success` / `.btn-danger` / `.mini .btn-row` / `.team-section` / `.swatch.white|.black` / `.draft-head` / `.live-chip` / `.live-dot` / `.draft-pair` / `.draft-col.picking` / `.pick-item.captain` / `.pool`.
- **Line count:** 807 → 1033 (+226).

## Late-session bug discovery (critical)

After amendments landed, user reported Profile + Formation STILL look broken — "island camera notch issue is sorted on every other screen but failing in these 2." User instructed: no subagent delegation; diagnose personally; defer fix to next session.

**Personal diagnosis via `preview_inspect`:**

```
Phone --safe-top: "59px" ✓ (correctly inherited)
.statusbar computed height: "25px" ✗ (should be 59px)
.statusbar flex-shrink: "1" ← root cause
.phone-inner display: flex, flex-direction: column
```

**Root cause:** `.phone-inner` is a flex column. `.statusbar` is the first flex child. Default `flex-shrink: 1` allows flex to compress it when content overflows the fixed 844px phone height. On Profile + Formation, content is long enough that flex shrinks the statusbar from 59px → 17–25px. Every element shifts up ~40px, and the first content element (team-strip on Formation / topbar on Profile) then sits BEHIND the Dynamic Island cutout. The "butchered UI" / "text cutoff" user perceived was actually **whole-layout upward drift**, not cutoffs in the tiles themselves.

**Why other 8 mockups didn't exhibit it:** Their content fits within 844px, so flex never needed to shrink the statusbar.

**Fix (NOT applied this session — deferred to S011):**

```css
.statusbar {
  /* existing rules… */
  flex-shrink: 0;   /* or: flex: 0 0 var(--safe-top); */
}
```

Apply to ALL 10 phone-frame mockups (not just Profile + Formation) to prevent recurrence on any future content expansion.

**Lessons.md row added** — "Statusbar v2.1 amendment: add `flex-shrink: 0`" with full diagnostic walkthrough.

## Memory saved

4 new memory files written to `~/.claude/projects/.../memory/`:
- `feedback_always_visible_rosters.md` — lists ≤14 render inline; no tap-to-expand
- `feedback_pill_toggles_over_checkboxes.md` — iOS-style pill switches, never checkboxes
- `feedback_text_cutoff_diagnostic.md` — "butchered tile" → first suspect = missing flex-column + min-height on tile parent
- `project_rotating_gk_rule.md` — teams w/o dedicated keeper rotate GK every ~10 min via pre-assigned numbers; Formation Planner must support natively

`MEMORY.md` index updated with 4 new pointer rows.

## Deferred to S011

- **Item 0 (NEW CRITICAL):** Apply `.statusbar { flex-shrink: 0; }` to all 10 phone-frame mockups. Verify Profile + Formation render correctly afterwards.
- **Items 1–3 from S010 plan (all deferred, scope unchanged):** Integrate `_wip/item-b-draft-reroll-spec.md` · `_wip/item-settings-v2-amendments.md` · `_wip/item-formation-planner-spec.md` into master spec.
- **Item 5 from S010 plan:** Update §3.7 spec states table with S010 additions (6.5/8.5 sub-numbering decision pending user input).
- **Item 7:** Masterplan V2.7 — must include new `formations` table row for `formation_rotation_order` + starting-GK pointer (FFC rotating-GK rule support).
- **Item 8:** Close-out was partial this session — S011 finishes it.

## User feedback / corrections log

- "Admin matches — just show the full 14 directly, it's not too much, they can scroll" → memory + spec decision.
- "Settings toggles should be pills not checkboxes" → memory + all future toggle UIs use pills.
- "Player profile is butchered, text cutoff in flash cards" → diagnosed as 2 issues (tile flex-column missing + statusbar flex-shrink); agent fix solved (1), agent fix did NOT solve (2) which user then re-caught.
- "Formation is very bad, notch is blocking everything, need full 7 roster, need team indicator, and here's how our rotating GK actually works…" → whole new feature area captured + redesigned.
- "We sometimes play without a dedicated goalie and rotate every 10 min by numbers; captain picks starter" → new durable gameplay rule.
- "Do not delegate this task to another sub agent. Check it yourself and verify. However add this is a note to tackle in next session." → statusbar flex-shrink diagnosed personally via preview_inspect; fix documented in lessons + queued as S011 item 0 (no code changes this session).

## Files modified this session

- `.superpowers/brainstorm/635-1776592878/content/3-7-poll-screen.html` (+226 lines)
- `.superpowers/brainstorm/635-1776592878/content/3-14-player-profile.html` (CSS fixes on `.kpi` + `.achievement-tile`)
- `.superpowers/brainstorm/635-1776592878/content/3-16-settings.html` (checkboxes → pill toggles ×12)
- `.superpowers/brainstorm/635-1776592878/content/3-18-admin-matches.html` (tap-to-expand → always-visible 14-row rosters ×2 phones)
- `.superpowers/brainstorm/635-1776592878/content/3-19-formation.html` (+311 lines, major redesign)
- `tasks/lessons.md` (+2 rows: statusbar v2 flank-island S009 + statusbar v2.1 flex-shrink S010)
- `sessions/INDEX.md` (S010 row added, S011 next-session line)
- `sessions/S010/session-log.md` (this file)
- `tasks/todo.md` (NEXT SESSION → S011 plan; S010 completed block added)
- `CLAUDE.md` (latest-session block bumped to S010)
- Memory: 4 new files + MEMORY.md index update

## Confidence + open risks

- **High confidence** on the flex-shrink diagnosis. Live-inspected values show `--safe-top` resolves correctly at `.statusbar` level but `height` computes to `25px`. `flex-shrink: 1` is the only remaining lever and matches the symptom pattern exactly (only screens with overflowing content are affected).
- **Risk:** If S011 applies `flex-shrink: 0` but the bug persists, the next suspect is `.phone-inner` overflow behaviour (maybe `overflow-y: auto` on the parent is interacting with flex sizing). If so, wrap content in an inner `.content` div that absorbs overflow, leaving `.phone-inner` to arrange `.statusbar` + `.content` at their natural heights.
- **Risk:** Subagent E's State 6.5 implementation may need alignment polish after S011 merges subagent B's spec — check that mockup matches final spec wording (captain pick-flow labels, `draft_sessions.status` transitions).
