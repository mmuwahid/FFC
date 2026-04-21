# Session S006 — Section 3 screens: Leaderboard (§3.13) · Player Profile (§3.14) · Match-detail stub (§3.15)

**Dates:** 19/APR/2026 (home PC, scope + §3.13 first draft) + 20/APR/2026 (work PC, resume + all approvals)
**PCs:** Home (partial, unlogged) → Work (resume + close)
**Prior session:** S005 — Masterplan V2.4/V2.5; Section 3.0 + §3.7 approved; positions + theme amended into Section 2 DDL.

---

## Summary

Two-phase session.

**Phase 1 — home PC, 19/APR/2026 (not logged at the time).** Scope stub written; §3.13 Leaderboard spec drafted into the design spec (~110 lines, Depth B) with four open decisions O1–O4; `3-13-leaderboard.html` v1 mockup built (1,389 lines — light + dark phones + 6 state tiles). Home-PC work paused without a session-log update.

**Phase 2 — work PC, 20/APR/2026 (this log).** Cold-start surfaced the unlogged §3.13 deliverables; user chose Option A (inspect → approve). Four leaderboard open decisions resolved · §3.14 Player profile speced + mocked from scratch (~130 spec lines + ~1,100 mockup lines) · mid-review user refinements landed on both screens (W-D-L colour triplet rule, scoped totals card, column-header row, MP column, medal-tint polish, penalty column removal) · §3.15 Match-detail sheet added as a Phase 1 stub. DDL amended with one new enum and one new column to support sort persistence.

Session closes with §3.13 APPROVED, §3.14 APPROVED, §3.15 STUB locked, and guest-player-stats scope (Q1–Q6) decided but not yet implemented.

## What got done

### 1. §3.13 Leaderboard — APPROVED (20/APR/2026)

Speced at Depth B in `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` §3.13 with all four open decisions resolved + seven mid-review refinements.

**Decisions resolved (O1–O4):**
- **O1 tiebreak substitute** — Phase 1 chain: `points DESC → wins DESC → motms DESC → goals DESC → display_name ASC`. Per-player goal-difference deferred to Phase 2 (needs `goals_against` on `match_players`).
- **O2 "Not yet played" group** — keep as separate muted bottom group, alpha-sorted, un-numbered.
- **O3 sort persistence** — persistent per user. DDL amendment: new `leaderboard_sort` enum in §2.1 + new `profiles.leaderboard_sort` column (NOT NULL DEFAULT `'points'`) in §2.2 + S006 migration note.
- **O4 medal icons** — 🥇🥈🥉 on top 3 in current non-archived season only; trophy glyphs on archived seasons; plain numbers otherwise.

**Mid-review refinements (all applied to spec + mockup):**
- W-D-L triplet rendered in green W / grey D / red L everywhere W-D-L appears (§3.13 row, §3.14 cards, zero-match state). Locked as app-wide rule.
- Column-header row `Player · W D L · MP · Pts` added above rank-1. Monospace letters same size as digit rows; each letter sits directly above its number. Sticky.
- Separators (dashes) removed from both header letters and row digits. Flex gap handles spacing.
- MP (Matches Played) column added right of W-D-L. Computed as `wins + draws + losses`. Makes the W-D-L denominator explicit at a glance.
- Fixed column widths (W-D-L 56 px · MP 28 px · Pts 40 px) — numbers stay on a single horizontal line across all 14 rows regardless of penalty presence.
- W-D-L font bumped 11 → 13 px; MP same; Pts 19 → 22 px. All centered within their column.
- Medal tint on top 3 — faded gold/silver/bronze full-width fill + saturated border + inner highlight. Clear podium signal without overpowering row content.
- **Late-cancel penalty column REMOVED** from the leaderboard — squeezed player names too narrow. Penalties still drive the point calculation (`late_cancel_points` component of `v_season_standings.points`); the `−1`/`−2` indicator surfaces on the post-match report (§3.15) instead.

**Artifacts:**
- Spec §3.13 in the design spec — APPROVED status, 4 resolved decisions, updated row composition (9 slots, was 10), updated viewport rules.
- Mockup `3-13-leaderboard.html` v2 — primary light + dark phones + 6 state tiles (position filter · archived season · season picker sheet · "Not yet played" group · season-just-started · dark + GK filter). Callout block summarizes all 7 S006 additions.

### 2. §3.14 Player profile — APPROVED (20/APR/2026)

Depth B spec in design spec §3.14 (~140 lines after all edits).

**Decisions resolved (P1–P5):**
- **P1 Best season finish** — compute live client-side from `v_season_standings` scan across all seasons. Materialize into a view in Phase 2 only if latency becomes painful.
- **P2 Recent matches row tap** — fully tappable; destination = §3.15 read-only match-detail bottom sheet.
- **P3 Email visibility** — edit sheet only; hero stays clean.
- **P4 "You" indicator** — dropped. Self-view is implied by the edit pencil + bottom-nav profile tab.
- **P5 Recent-matches tap destination** — read-only match-detail bottom sheet. Scope captured in §3.15 stub.

**Mid-review refinements:**
- W-D-L colour triplet rule applied to season-stats card, totals card, zero-match state.
- "Last 5 games (season)" copy (was "Last 5 (season)").
- **Totals card** renamed from "Career totals" and given a **scope dropdown** — default `Current season` · each past season · `Entire career`. Scope dropdown is view-only state, doesn't persist, doesn't affect the page-level season chip. Season-scope KPI set ends with `Rank`; career-scope swaps last slot for `Best finish`.

**Data queries documented:**
- Profile row + positions + `theme_preference` + `leaderboard_sort` via `profiles`.
- Season slice via `v_season_standings` (filtered to selected season).
- Last-5 via `v_player_last5` (24 px circles for profile).
- **Recent matches** — new query against `matches + match_players + matchdays + seasons`, last 10 newest-first.
- **Career totals** — aggregate over all approved matches. "Best finish" = client-side scan of `v_season_standings`.

**Edit-sheet spec** — three sections:
1. Positions (primary required + secondary optional · `profiles_positions_differ` CHECK enforced via disabling the matching chip · explicit Save).
2. Theme (3 chips · auto-save on tap).
3. Leaderboard sort (5 chips · auto-save on tap · writes to new column from O3).
Backend = direct `UPDATE profiles` via new RLS `profiles_self_update` policy (added to §2.8 scope). Column whitelist enforced at app layer + defense-in-depth trigger rejects `role`/`is_active`/`auth_user_id` edits from non-admins.

**Self vs other-player vs admin-viewing-other matrix** — only self sees the edit pencil. Admin viewing other sees a footer link "Edit in Admin → Players" routing to the admin family (not yet specced).

**Artifacts:**
- Spec §3.14 APPROVED.
- Mockup `3-14-player-profile.html` v2 (~1,100 lines) — Light self-view (MM · Season 2 · rank 1st) + Dark other-player view (OK · Season 2 · rank 2nd) + 6 state tiles (edit sheet · ghost profile · banned chip · zero-match career starter · season picker sheet · admin-viewing-other with Edit-in-admin footer).

### 3. §3.15 Match-detail sheet — STUB (20/APR/2026)

New Phase 1 scope item triggered by P5 resolution. Read-only bottom sheet reached by tapping a Recent-matches row in §3.14.

**Scope locked in the stub:**
- Data sources mapped (`matches` + `matchdays` + `seasons` + `match_players` + `match_guests`).
- Content layout documented — header strip · MOTM row · White roster · Black roster · **late-cancel penalties strip** (added after penalty was pulled from the leaderboard) · footer line.
- Sheet behaviour — 85% viewport height, drag handle, swipe-dismiss, scroll preservation on return.
- 5 acceptance criteria.
- Out-of-scope items for Phase 1 enumerated (timeline, assists, H2H, share-as-image).

**Full Depth-B spec + mockup deferred** to a later session (probably after admin-dashboards + captain helper).

### 4. Data model amendments (§2.1 + §2.2)

- **New enum** `leaderboard_sort AS ENUM ('points','goals','motm','wins','last5_form')` in §2.1.
- **New column** `profiles.leaderboard_sort leaderboard_sort NOT NULL DEFAULT 'points'` in §2.2.
- **New RLS policy** `profiles_self_update` stubbed in §2.8 scope (full body to be finalized when we revisit RLS).
- **S006 migration note** added inline in §2.2 for the new column.

No ALTER for existing data — greenfield DB, baked into the CREATE.

### 5. Guest-player stats — SCOPE LOCKED (implementation pending)

User raised mid-session: +1 guests need stats so captain-balancing works. Current `match_guests` stores only `display_name` (and inviter / cancellation metadata) — captain-helper gets nothing useful.

**Q1–Q6 decisions (all answered, NOT yet implemented):**
- **Q1** Who fills → **inviter, at +1 time.**
- **Q2** Rating UX → **three-chip** (`weak` · `average` · `strong`).
- **Q3** Stamina + Accuracy UX → **three-chip each** (`low` · `medium` · `high`).
- **Q4** Positions → **same 5-palette as FFC players** (GK · DEF · CDM · W · ST); primary required, secondary optional.
- **Q5** Short description → **optional, 140 char limit, single-line.**
- **Q6** Enum naming → `guest_rating AS ENUM ('weak','average','strong')` + `guest_trait AS ENUM ('low','medium','high')`. New columns will be **nullable at DB level**; app-layer invite form enforces required fields.

**Implementation queued for S007:**
- §2.1 add 2 enums.
- §2.3 amend `match_guests` — 6 new columns (`primary_position`, `secondary_position`, `stamina`, `accuracy`, `rating`, `description`) + positions-differ CHECK constraint.
- §3.5 amend invite flow — add "Tell us about your +1" step with 6 fields.
- §3.7 poll screen mockup — carry position pills + description subtitle + rating chip to guest rows.
- §3.1-v2 captain helper (being drafted S007) — surface guest stats prominently on the pair-balance screen.
- Leaderboard acceptance criterion unchanged — guests still don't appear on the standings.

### 6. §3.1-v2 Captain helper reconciled — SCOPE LOCKED (not yet drafted)

Planned for S006, deferred to S007. User confirmed two design choices before I could draft:
- **One screen with two modes** (formula-primary when season age ≥5 approved matchdays, randomizer-primary when <5) with a visible toggle either way.
- **Pair confirmation sheet** — two candidates side-by-side with position pills + 3-criteria booleans + "White = weaker auto-assigned" reminder + "Use this pair" button. Approved as proposed.

## Files touched

| Path | Change |
|---|---|
| `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` | §2.1 `leaderboard_sort` enum added (S006 block). §2.2 `profiles.leaderboard_sort` column + migration note. §3.13 Leaderboard (~110 lines, APPROVED). §3.14 Player profile (~140 lines, APPROVED). §3.15 Match-detail sheet stub (~50 lines). Viewport rules + row composition table updated for penalty removal. |
| `.superpowers/brainstorm/635-1776592878/content/3-13-leaderboard.html` | New file (home PC, v1), refined to v2 (work PC) — 1,389 lines → ~1,400 after cleanup. Column header, MP column, colour W-D-L triplet, medal tint, penalty column removed. |
| `.superpowers/brainstorm/635-1776592878/content/3-14-player-profile.html` | New file v1 → v2 — ~1,100 lines. Light self + dark other primary phones + 6 state tiles. Scoped-totals card, colour W-D-L, no "You" chip, "Last 5 games" copy. |
| `sessions/S006/session-log.md` | This file (full rewrite of home-PC stub). |
| `sessions/INDEX.md` | S006 row updated (on close). |
| `CLAUDE.md` | Latest session bumped (on close). |
| `tasks/todo.md` | S006 completion section + S007 plan (on close). |

Masterplan not bumped this session — all new data-model amendments are additive and documented in the design spec's §2.1/§2.2 blocks + S006 migration notes. V2.5 remains authoritative. V2.6 will land in S007 when guest-stats DDL + §3.1-v2 captain helper are drafted (meaningful data-model work incoming).

## Decisions locked in S006

1. **§3.13 Leaderboard APPROVED** — O1–O4 resolved; row composition locked at 9 slots; W-D-L colour-triplet rule applies app-wide; column-header row + MP column added; penalty column dropped.
2. **Fixed column widths** for W-D-L / MP / Pts — row-to-row alignment stable regardless of penalty presence.
3. **§3.14 Player profile APPROVED** — P1–P5 resolved; Totals card carries a scope dropdown; no "You" chip in hero; email lives only inside the edit sheet; leaderboard-sort + theme + positions all edit from one sheet.
4. **`profiles.leaderboard_sort`** new column + `leaderboard_sort` enum (new in §2.1).
5. **§3.15 Match-detail sheet** added as Phase 1 scope — stub in the spec, full Depth-B deferred.
6. **Late-cancel penalty surface relocated** — removed from leaderboard column; added to the match-detail sheet. Still drives the `late_cancel_points` component of the leaderboard's point calculation.
7. **W-D-L colour-triplet rule** (green W / grey D / red L) applies everywhere W-D-L renders across the app.
8. **Guest-player-stats scope locked** (Q1–Q6) but implementation deferred to S007.
9. **§3.1-v2 captain-helper layout locked** (one screen, mode toggle, pair-confirmation sheet) but full draft deferred to S007.

## Open items remaining

- P5's sibling still floating: §3.15 full Depth-B spec + mockup.
- §3.1-v2 captain helper reconciled — needs draft (supersedes S002's first-pass §3.1 text).
- Poll screen's "admin pre-assigned team colour" question from S005 — still unanswered.
- Guest-stats DDL + §3.5 amendment + §3.7 guest-row rendering carry-forward — queued for S007.
- Settings screen skeleton — not attempted; S006 filled up on leaderboard/profile polish.
- Admin dashboard family (5 screens) — pending after player-facing screens close out.

## Handoff notes for S007

- **Cold-start files:** `CLAUDE.md`, `sessions/INDEX.md`, `sessions/S006/session-log.md`, `planning/FFC-masterplan-V2.5.md`, the Phase 1 design spec (Section 2 + Section 3.0 locked; §3.7 speced; §3.13 + §3.14 APPROVED; §3.15 stub), `tasks/todo.md` NEXT SESSION block.
- **Visual Companion:** content directory is `.superpowers/brainstorm/635-1776592878/content/`. The two new files (`3-13-leaderboard.html`, `3-14-player-profile.html`) are complete. `3-7-poll-screen.html` carries forward from S005.
- **Immediate S007 work:**
  1. **Guest-stats implementation** — apply Q1–Q6 decisions to §2.1 + §2.3 + §3.5 + §3.7.
  2. **§3.1-v2 captain helper reconciled** — Depth-B spec + mockup with the formula-vs-randomizer mode toggle + pair-confirmation sheet.
  3. **Masterplan V2.6** — capture guest-stats + leaderboard refinements + captain-helper reconciliation.
  4. **Settings screen skeleton** if time — theme + push prefs + position editor re-entry + leaderboard-sort + logout.
- **Mockup-first rule active.** Every new screen still needs an approved HTML mockup before Phase 1 code starts.
- **Auto-load memories:** DD/MMM/YYYY date format + Visual Companion usage rule + (new) W-D-L colour-triplet rule should be applied consistently app-wide.

## User refinements captured as durable preferences

- **W-D-L colour triplet** (green W / grey D / red L) is an app-wide rule, not a leaderboard-specific one. Applies to profile · match-detail · any future W-D-L rendering.
- **Column data should sit on the row's geometric midline** (same horizontal line as position pills), not just the tightly-packed centre of the cell. Use `align-self: stretch` + flex `align-items: center` on the cell.
- **Fixed column widths** preferred over `auto` widths whenever a column can appear or disappear based on data (e.g., penalty column). Stability of row-to-row alignment is a first-class design property.
- **Surface late-cancel accountability in the post-match report**, not the leaderboard — leaderboard prioritizes player-name breathing room.
