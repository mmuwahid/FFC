# Session S007 — Guest-stats DDL · §3.7 spec persisted · §3.14 refined · §3.1-v2 reconciled · Masterplan V2.6

**Date:** 20/APR/2026
**PC:** Work (UNHOEC03)
**Prior session:** S006 — §3.13 APPROVED · §3.14 APPROVED · §3.15 STUB · guest-stats Q1–Q6 decided · §3.1-v2 layout locked.

---

## Summary

Single-session marathon that closed out every piece queued at S006 close and surfaced a significant documentation gap along the way.

**Scope delivered.** (1) Applied the S006 guest-stats Q1–Q6 decisions to the design spec (§2.1 enums · §2.3 `match_guests` columns · §3.5 invite flow · §3.7 poll mockup guest-row rendering). (2) **Discovered the §3.7 Poll screen spec had never been persisted** to the design spec file — S005's "SPEC COMPLETE" only covered the mockup and session-log notes, not the authoritative file. Reconstructed the full Depth-B §3.7 spec as part of this session at the user's direction. (3) Received mid-session §3.14 Player profile feedback from the user (W-D-L alignment bug · last-5 centering bug · Totals card "just data without explanation" · MP missing from Season stats). Applied 6 refinements (R1–R6) fixing bugs + swapping the Totals card for a new Achievements card + adding MP to Season stats. (4) Drafted §3.1-v2 Captain helper reconciled Depth-B spec and built v1 mockup (2 phones + 4 state tiles). (5) Bumped masterplan to V2.6 capturing all of the above.

**Design spec grew ~1,573 → ~1,990 lines** (+417 lines across §2.1 + §2.3 + §3.5 + new §3.7 + §3.14 refinements + new §3.1-v2). Two new mockup files created. One new masterplan version.

## What got done

### 1. Guest-stats DDL + flows — applied S006 Q1–Q6 to §2.1 · §2.3 · §3.5 · §3.7

**§2.1 enums.** Added two new enums:
- `CREATE TYPE guest_rating AS ENUM ('weak','average','strong');`
- `CREATE TYPE guest_trait  AS ENUM ('low','medium','high');`

**§2.3 `match_guests` table.** Added 6 new nullable columns:
- `primary_position   player_position` (reuses §2.1 palette)
- `secondary_position player_position`
- `stamina            guest_trait`
- `accuracy           guest_trait`
- `rating             guest_rating`
- `description        text` (with CHECK `char_length ≤ 140`)

Plus two new CHECK constraints — positions-differ (reusing the pattern from `profiles_positions_differ`) and description-length. Plus an inline S007 migration note block.

**§3.5 invite flow.** Rewrote step 1–3 as a two-step form:
- Step 1: Display name.
- Step 2: "Tell us about your +1" with 6 fields (primary/secondary position · stamina · accuracy · rating · description). App-layer enforces required fields; DB nullability preserved for Phase 2 quick-invite flows. Also reconciled a drift paragraph that referenced obsolete `match_guests` columns (`goals_scored`, `yellow_card`, `red_card`, `is_motm`) by re-pointing to §2.3 authoritative DDL and noting that per-match participation lives on `match_players` via `guest_id` FK. Fixed the stale "Captain formula criterion 1" line (dated to V2.0 5-criteria; S004 simplified to 3).

**§3.7 poll mockup.** Both guest rows (light + dark) restructured from single-line to a three-line guest body:
- Line 1 (name row): name · rating chip · position pills · commitment time.
- Line 2: `+1 · invited by <inviter>` italic subtitle.
- Line 3: italic description (1-line truncated).
New CSS: `.row.guest` multi-line layout · `.rating-chip` with three colour variants (weak = muted grey, avg = slate blue, strong = gold) for light + dark. Header callout updated to flag S007 addition.

### 2. §3.7 Poll screen Depth-B spec — PERSISTED (S007)

**Gap discovered.** S005 session log said the §3.7 Poll screen spec was "SPEC COMPLETE" but the Files-Touched list only showed §2.1 + §2.2 amendments. The spec text was never written into the design spec file — it lived only in the session conversation + the mockup's alternate-state tiles.

User chose option A (write full Depth-B spec from scratch now). Reconstructed ~180 lines of spec covering:
- Purpose + entry points (4 routes).
- Data read (4 queries) + data write (3 RPCs, amended `invite_guest` signature with S007 stats fields).
- Layout diagram (ASCII).
- **7 key states** in a table (pre-open · not-voted · voted-YES-confirmed · voted-YES-waitlisted · +1-unlocked · roster-locked · penalty-sheet-within-24h).
- Commitment-row rendering contract (member vs guest — S007 guest row carries pills · rating chip · description subtitle).
- Tap targets (5 destinations).
- Theme/safe-area conventions.
- 7 acceptance criteria.
- Error / loading states.
- Notification fan-outs.
- Phase-2 deferred items (admin team-colour preview · vote-as-inviter · vote-swap).

### 3. §3.14 Player profile — 6 S007 refinements (R1–R6)

User surfaced four rendering bugs + one scope change + requested a replacement section.

**R1 · W-D-L horizontal alignment bug.** Root cause: CSS specificity collision. `.kpi .l` label rule (`font-size: 9px · letter-spacing: 0.1em · text-transform: uppercase · margin-top: 6px`) was overriding `.wdl-triplet .l` (the loss digit) because both selectors have specificity `0,2,0` and `.kpi .l` was defined later. The W and D digits rendered correctly (17px, serif, no margin) but the L digit rendered as a small uppercase label with a 6px push-down. Fix: added `.kpi .wdl-triplet .w, .d, .l { font-size: inherit; ... margin-top: 0; line-height: 1; }` override block AFTER `.kpi .l`, then re-asserted the colour values. Now all three digits sit on the same baseline at 17px.

**R2 · Last-5 circle centering bug.** Root cause: `letter-spacing: 0.02em` on the circle shifted the glyph right, leaving the letter looking off-centre in the 24px disc. Fix: `letter-spacing: 0` + explicit `line-height: 1` + `font-variant-numeric: tabular-nums`.

**R3 · MP stat added to Season stats grid.** Matches-played = `wins + draws + losses` (same derivation as §3.13 leaderboard MP column). Added as the 2nd KPI tile.

**R4 · Rank removed from Season stats KPI grid.** Previously duplicated the `rank 1st 🥇` card-header hint. Card header hint retained; Season stats grid now has exactly 6 KPIs: Points · MP · W-D-L · Goals · MOTM · Late-cancel.

**R5 · Totals card replaced with Achievements card.** User feedback: "what is this totals section? its just data without explanation delete this section since we have a stats window already." Replaced with a 6-tile Achievements card surfacing career-wide gameplay highlights:
- ⭐ MOTMs (career count) — tile
- 🔥 W-streak (longest in any season) — positive-tinted big number
- 🎯 Goals (career total)
- 🟨 Yellows (career count)
- 🟥 Reds (career count · `career · clean` context when 0)
- 📉 L-streak (longest in any season) — negative-tinted big number

Each tile = emoji icon · big value · small-caps label · italic context line. Scope dropdown retired with the Totals card. Implementation note: best-W / longest-L streaks require run-length encoding over time-ordered match results; queued for a `v_player_achievements` view in S008, RLE in app code as the Phase 1 interim.

**R6 · Zero-match career state.** Updated so the career-starter CTA now replaces the Achievements card (was: replaced the Totals card).

All six refinements applied to **both** the HTML mockup (light + dark + zero-match state tile) AND the §3.14 spec in the design spec file (IA point 3 · IA point 5 · data-sources · edge states · loading · acceptance criteria · S006 decisions block with R1–R6 appended).

### 4. §3.1-v2 Captain helper reconciled — DRAFTED + MOCKED

Supersedes §3.1 (S002 first-pass). §3.1 annotated as SUPERSEDED in place with a pointer to §3.1-v2.

**Depth-B spec** covers:
- Purpose + 3 entry points.
- Data sources: `v_captain_eligibility` (3 per-player booleans + composite `is_eligible`) + `suggest_captain_pairs` + `pick_captains_random` RPCs + season-age count + `match_guests` rows.
- Mode selection rule: `season_matchdays_approved ≥ 5` → formula default; `< 5` → randomizer default. Visible toggle.
- Layout diagrams for both modes.
- Candidate-list rendering contract (3-section ordering: eligible / partial / ineligible; three-criteria triplet with green/red colouring; position pills).
- Guest subsection rendering contract (S007 — pills · rating · stamina/accuracy · description · read-only · cannot captain).
- **Pair-confirmation sheet** full spec: side-by-side candidate cards with White=weaker auto-assignment, rank-gap ✓/⚠ badge (gap>5 = amber warning + sub-modal, NOT a hard block), explicit assignment note, Confirm / Cancel buttons.
- Write path: new `set_matchday_captains` RPC (queued for §2.7 Part 5B).
- Concurrency: last write wins; later admin sees toast.
- Edge cases: fewer than 14 · all fail formula · banned captain post-confirm.
- Accessibility.
- 10 acceptance criteria.
- Phase-2 deferred: auto-pick + override window · async draft entrypoint · goal-difference criterion.

**Mockup v1** (`3-1-v2-captain-helper.html`, ~1,000 lines):
- Light + Formula-mode phone (Matchday 07, Season 2 with 9 matchdays played).
- Dark + Randomizer-mode phone (Matchday 03, Season 3 with 2 matchdays played — formula disabled, candidate list muted for context).
- 4 state tiles: balanced pair-confirmation sheet · rank-gap-warning pair-confirmation sheet · zero-eligible fallback · guest-subsection detail with 2 guests showing all S007 stats.

### 5. Masterplan V2.6 written

`planning/FFC-masterplan-V2.6.md` (~160 lines). V2.5 preserved. V2.6 captures:
- S006 leaderboard decisions (O1–O4 + W-D-L app-wide rule + MP column + penalty surface relocation).
- S006 + S007 player-profile decisions (P1–P5 + R1–R6).
- §3.15 match-detail stub.
- §3.7 spec persistence note.
- §3.1-v2 captain helper reconciliation.
- Guest-stats data model additions.
- Two new numbered sections: §11 Leaderboard Sort Preference + §12 Guest Player Stats.
- Updated open-decisions list.
- Updated next-steps.

## Files touched

| Path | Change |
|---|---|
| `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` | §2.1 +2 enums (guest_rating, guest_trait). §2.3 match_guests +6 columns +2 CHECKs +migration note. §3.5 invite flow rewritten (step 2 "Tell us about your +1"); data-model-notes paragraph reconciled with §2.3 DDL; captain-formula drift line fixed. §3.7 Poll screen — full Depth-B spec reconstructed (~180 lines). §3.1 SUPERSEDED annotation added. §3.1-v2 Captain helper full Depth-B spec (~180 lines). §3.14 IA point 3 (MP added · Rank removed) · IA point 5 (Totals → Achievements) · data-sources (career query → achievements queries) · edge states · loading · acceptance criteria · S006 decisions block + new S007 refinements R1–R6 block. |
| `.superpowers/brainstorm/635-1776592878/content/3-7-poll-screen.html` | v2 → v3. Guest rows (light + dark) restructured to 3-line layout; new `.row.guest .guest-body` + `.rating-chip` CSS with 3 colour variants per theme. Header subtitle updated. |
| `.superpowers/brainstorm/635-1776592878/content/3-14-player-profile.html` | v2 → v3. R1: `.kpi .wdl-triplet .w/.d/.l` specificity override block added. R2: last-5 circle `letter-spacing: 0` + `line-height: 1`. R3: MP KPI added to both phones + zero-match state. R4: Rank KPI removed from both phones + zero-match state. R5: Totals card deleted from both phones; Achievements card added with 6 tiles + new `.achievements-grid` + `.achievement-tile` CSS (positive/negative tints). R6: zero-match state copy updated. Callout list updated with R1–R6 entries. Page header subtitle + title tag updated. |
| `.superpowers/brainstorm/635-1776592878/content/3-1-v2-captain-helper.html` | **NEW** (~1,000 lines). Light formula-mode phone + dark randomizer-mode phone + 4 state tiles (balanced pair sheet · rank-gap warning pair sheet · zero-eligible fallback · guest subsection detail). Full CSS system with mode-toggle · pair cards · candidate list with 3-section ordering · guest subsection · pair-confirmation sheet · randomizer card. |
| `planning/FFC-masterplan-V2.6.md` | **NEW** (~160 lines). V2.5 preserved. |
| `sessions/S007/session-log.md` | This file. |
| `sessions/INDEX.md` | S007 row added (on close). |
| `CLAUDE.md` | Latest-session block bumped (on close). |
| `tasks/todo.md` | S007 completion section + S008 plan (on close). |

## Decisions locked in S007

1. **§3.7 Poll screen Depth-B spec written** — closes a documentation gap inherited from S005. §3.7 APPROVED status now reflects both spec + mockup.
2. **§3.7 guest-row rendering contract** — 3-line layout: name + rating chip + pills + time · subtitle · description (1-line truncated, tap expands).
3. **Guest-stats DDL locked** — `guest_rating` + `guest_trait` enums + 6 columns on `match_guests` + 2 CHECKs.
4. **§3.5 invite flow** — two-step form: name → 6-field guest-stats step. App-layer enforces required; DB nullable.
5. **§3.14 R1–R6 refinements applied** — W-D-L alignment fix · last-5 centering fix · MP added · Rank removed from KPI grid · Totals card replaced with Achievements card · zero-match state updated.
6. **§3.14 Achievements card** — 6 tiles: MOTMs · W-streak · Goals · Yellows · Reds · L-streak. Career-wide only; no scope dropdown.
7. **§3.1-v2 Captain helper reconciled** — Depth-B spec + v1 mockup. Supersedes §3.1. Mode toggle (formula / randomizer) · 3-criteria triplet · guest subsection (read-only, S007 stats visible) · pair-confirmation sheet with White=weaker auto-assignment + rank-gap ✓/⚠ badge.
8. **Rank-gap > 5 rule** — amber warning, NOT a hard block. Admin can override via sub-modal.
9. **Guests never captain** — cannot be selected in candidate list; appear only in read-only guest subsection for pair-balance context.
10. **Masterplan bumped V2.5 → V2.6.**

## Open items remaining

- `set_matchday_captains(matchday_id, white_profile_id, black_profile_id)` RPC — to be added to §2.7 Part 5B when admin-matchday screens are specced (S008 or later).
- `update_guest_stats(guest_id, ...)` RPC — also queued for §2.7 when admin-matchday screens land (allows admin to correct stats the inviter got wrong).
- `v_player_achievements` view — Phase 2 materialization target for achievement aggregates (W-streak / L-streak). Phase 1 runs RLE in app code.
- `profiles_self_update` RLS policy — full body finalization pending revisit of RLS (scope captured in §2.8; stub written in S006).
- §3.15 Match-detail sheet full Depth-B spec + mockup — still deferred (S008 or later).
- Admin dashboard family (5 screens) — pending.
- Settings screen skeleton — pending.
- Poll screen "admin pre-assigned team colour" question from S005 — still unanswered.

## Handoff notes for S008

- **Cold-start files:** `CLAUDE.md`, `sessions/INDEX.md`, `sessions/S007/session-log.md`, `planning/FFC-masterplan-V2.6.md`, `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` (§1 ✓ · §2 ✓ with S005+S006+S007 amendments · §3.0 ✓ · §3.1 SUPERSEDED · **§3.1-v2 ✓** · §3.2–§3.6 from S002 carry · **§3.7 ✓ · §3.13 ✓ · §3.14 ✓ with S007 R1–R6 · §3.15 STUB**), `tasks/todo.md` NEXT SESSION block.
- **Visual Companion:** content directory is `.superpowers/brainstorm/635-1776592878/content/`. Four approved mockups: `welcome.html` · `3-7-poll-screen.html` (v3) · `3-13-leaderboard.html` (v2) · `3-14-player-profile.html` (v3) · `3-1-v2-captain-helper.html` (v1).
- **Immediate S008 work candidates (priority order):**
  1. **Settings screen skeleton** (theme · push prefs · position editor re-entry · leaderboard-sort · logout) — small scope, closes a near-final Phase 1 gap.
  2. **§3.15 Match-detail sheet** full Depth-B + mockup — adjacent to §3.14 recent-matches rows, closes the last Phase 1 player-side stub.
  3. **Admin dashboard family** — 5 screens (Players · Matches · Seasons · Admins · Schedule) + match-results edit + super-admin management. Big batch; may span S008 + S009.
  4. **§2.7 Part 5B follow-up** — add `set_matchday_captains` + `update_guest_stats` RPCs when the admin-matchday screen is designed.
  5. **Poll screen team-colour-preview decision** — small UX call; land it or explicitly defer to Phase 2.
- **Mockup-first rule active.** Every new screen still needs an approved HTML mockup before Phase 1 code starts.
- **Auto-load memories:** DD/MMM/YYYY date format · W-D-L colour-triplet rule · fixed column widths rule · Visual Companion usage rule.

## User refinements captured as durable preferences (carried into memory)

- **No data without explanation.** The Totals card was deleted specifically because it was "just data without explanation." Future stats surfaces should pair numbers with context (narrative, comparison, or trend) — a design constraint, not just a one-off fix.
- **Rendering-bug diagnostics.** When a layout bug is reported (glyph off-centre, font sizes inconsistent), CSS specificity collision should be the first suspect. The `.kpi .l` vs `.wdl-triplet .l` collision is the canonical example.
- **Achievement tile format** — emoji icon · big value · small-caps label · italic context line, with positive-tinted and negative-tinted variants. Reusable whenever we surface gameplay highlights.
