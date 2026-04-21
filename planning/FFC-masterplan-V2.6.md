# FFC Masterplan V2.6
**Date:** 20/APR/2026
**Session:** S006 (close) → S007 (work PC)
**Status:** Phase 1 design continues. Section 1 APPROVED. Section 2 Data Model APPROVED with S005 + S006 + S007 amendments. Section 3.0 Navigation + IA APPROVED. Player-side screens: §3.7 Poll APPROVED (spec persisted to the design spec file in S007 after having been drafted-but-never-written in S005) · §3.13 Leaderboard APPROVED (S006) · §3.14 Player profile APPROVED (S006) and REFINED (S007) · §3.15 Match-detail STUB (S006). Admin-side screens: §3.1-v2 Captain helper APPROVED layout (S006) + Depth-B spec + v1 mockup (S007). §3.1 (S002 first-pass) now SUPERSEDED. Sections 3.8–3.12 admin dashboards + Settings + 4 · 5 · 6 pending.

---

## Revision history

### V2.6 (20/APR/2026 — S006 close + S007)

**Data model additions (§2.1 + §2.2 + §2.3).**
- **New enum (S006):** `leaderboard_sort AS ENUM ('points','goals','motm','wins','last5_form')` — persists per-user sort preference on the leaderboard.
- **New column (S006):** `profiles.leaderboard_sort leaderboard_sort NOT NULL DEFAULT 'points'` + migration note inline.
- **New RLS policy stubbed (S006):** `profiles_self_update` on the `profiles` table (app-layer whitelists the editable columns; defense-in-depth trigger rejects role / is_active / auth_user_id escalation from non-admins).
- **New enums (S007):** `guest_rating AS ENUM ('weak','average','strong')` + `guest_trait AS ENUM ('low','medium','high')` — Q1–Q6 guest-stats resolution.
- **6 new nullable columns on `match_guests` (S007):** `primary_position`, `secondary_position` (both `player_position`), `stamina`, `accuracy` (both `guest_trait`), `rating` (`guest_rating`), `description` (text ≤ 140 chars). Plus two new CHECK constraints (`match_guests_positions_differ` + `match_guests_description_length`).

**Player-side screens.**
- **§3.7 Poll Screen — Depth-B spec persisted (S007).** S005 said the spec was complete but the text was never written into the design spec file; S007 reconstructed the full Depth-B spec (purpose · entry points · data read/write · layout diagram · 7 states · member-vs-guest row rendering contract · tap targets · theme/safe-area · acceptance · error/loading · notifications · Phase-2 deferred). Mockup updated with enriched guest rows (S007).
- **§3.13 Leaderboard — APPROVED (S006).** Four open decisions resolved: tiebreak chain `points DESC → wins DESC → motms DESC → goals DESC → display_name ASC`; "Not yet played" as separate muted bottom group; persistent per-user sort preference (new `leaderboard_sort` enum + column); medal icons on current-season top 3 only. Mid-review refinements: W-D-L colour triplet as an app-wide rule, column-header row, MP (matches-played) column added, fixed column widths, medal tint polish, **penalty column removed** from the leaderboard and relocated to §3.15 match-detail sheet.
- **§3.14 Player Profile — APPROVED (S006) + REFINED (S007).**
  - S006 decisions: live client-side best-season-finish; fully-tappable recent-matches rows; email edit-sheet only; no "You" chip; Totals card with scope dropdown.
  - S007 refinements: (R1) W-D-L alignment bug fixed — loss digit previously inherited `.kpi .l` label styling, now explicitly reset to the triplet baseline. (R2) Last-5 circle centering fixed — letter-spacing reset to 0 + explicit line-height. (R3) **MP (matches-played) added** to the Season stats grid; Rank removed from KPI tiles (still surfaces as card-header hint `rank 1st 🥇`). (R4) **Totals card replaced with Achievements card** — career-wide highlights (MOTMs · best W-streak · career goals · yellows · reds · longest L-streak) instead of context-free KPI duplication. Scope dropdown retired.
- **§3.15 Match-detail sheet — STUB (S006).** New Phase 1 scope item. Read-only bottom sheet reached by tapping a §3.14 recent-matches row. Late-cancel penalties surface here, not on the leaderboard.

**Admin-side screens.**
- **§3.1-v2 Captain Helper (reconciled) — APPROVED layout (S006) · Depth-B spec + v1 mockup (S007).** Supersedes §3.1 (S002). Single screen with a visible mode toggle (formula when season has ≥ 5 approved matchdays; randomizer when < 5). Candidate list shows the 14 locked-roster FFC players with a compact three-criteria triplet (`✓ ✓ ✓` · app-wide green/red colour rule). Guests on the roster appear in a separate read-only subsection with S007 stats (position pills · rating chip · stamina/accuracy · description) for pair-balance context — guests cannot captain. Pair-confirmation sheet auto-applies the White=weaker rule and shows a rank-gap ✓/⚠ badge against the 5-position rule (amber warning is NOT a hard block).

**App-wide design rules locked.**
- **W-D-L colour triplet** (green W / grey D / red L) everywhere W-D-L renders. Applies to §3.13 leaderboard, §3.14 profile, §3.15 match-detail, captain-helper candidate rows, and anywhere else the triplet appears.
- **Fixed column widths** preferred over `auto` whenever a column can appear/disappear based on data — row-to-row alignment stability is a first-class design property.
- **Late-cancel accountability** surfaces in the post-match report (§3.15), NOT on the leaderboard.

### V2.5 (19/APR/2026, S005)
*(preserved — see `FFC-masterplan-V2.5.md`)*

### V2.4 (19/APR/2026, S004)
*(preserved — see `FFC-masterplan-V2.4.md`)*

### V2.3 (2026-04-19, S003)
*(preserved — see `FFC-masterplan-V2.3.md`)*

### V2.2 · V2.1 · V2.0 · V1.0
*(preserved in prior files)*

---

## 1. Concept
*(unchanged from V2.2)*

---

## 2. Brand
*(unchanged from V2.5)* — dark-mode palette: `paper #0e1826`, `ink #f2ead6`, accent `#e63349`, gold `#e5ba5b`. Position pill hues constant across light/dark; outlined variants lighten in dark for legibility.

---

## 3. Decisions locked (cumulative)

**From V2.0–V2.5:** *(see prior doc versions)*.

**New in V2.6 (from S006 + S007):**
- Leaderboard tiebreak chain: `points DESC → wins DESC → motms DESC → goals DESC → display_name ASC` (§3.13 O1).
- "Not yet played" players render as a separate muted bottom group on the leaderboard, alpha-sorted, un-numbered (§3.13 O2).
- Leaderboard sort preference persists per user via new `leaderboard_sort` enum + `profiles.leaderboard_sort` column (§3.13 O3).
- Medal icons (🥇🥈🥉) on top 3 only in current non-archived seasons; archived seasons get trophy glyphs; everyone else plain numbers (§3.13 O4).
- W-D-L colour triplet (green W / grey D / red L) locked as app-wide rule.
- Fixed column widths required wherever a column can appear/disappear based on data.
- Late-cancel penalty surface relocated to §3.15 match-detail sheet (driven by `late_cancel_points` component of leaderboard points calculation).
- Player profile IA: Season stats grid = 6 KPIs including **MP**; Rank removed from grid (still shown in card-header hint); **Achievements card** replaces the Totals card.
- Match-detail sheet (§3.15) added to Phase 1 scope as a stub; full Depth-B deferred past S007.
- Guest-stats data model: 2 new enums (`guest_rating`, `guest_trait`) + 6 nullable columns on `match_guests` + positions-differ CHECK + 140-char description CHECK. App-layer invite form enforces required fields; DB nullability keeps Phase 2 "quick invite" paths open.
- §3.5 +1 invite flow amended with "Tell us about your +1" step collecting position(s) + stamina + accuracy + rating + description.
- §3.7 Poll screen guest-row rendering contract: primary/secondary position pills, rating chip, `+1 · invited by <inviter>` subtitle, italic description line (truncated · tap to expand).
- Captain formula simplified (from S004): 3 per-player criteria only — matches ≥ 5 · attendance ≥ 60% · cooldown ≥ 4 matchdays. V2.0's "knows the group" and pair-level criteria dropped.
- Captain helper single-screen mode toggle: formula-primary when season ≥ 5 approved matchdays, randomizer-primary when < 5. Visible toggle.
- Captain pair-confirmation sheet always shows White=weaker auto-assignment and a rank-gap ✓/⚠ badge.
- Guests can never captain. Their stats appear in the captain helper candidate pool (read-only subsection) for pair-balance context only.

---

## 4. Captain Selection Formula
*(unchanged from V2.4 — three per-player criteria + early-season randomizer + White=weaker pair rule.)*

**V2.6 adjacency.** The §3.1-v2 Captain helper screen now renders:
- A **visible mode toggle** (Formula · Randomizer) at the top, pre-selected by `season_matchdays_approved ≥ 5` but admin-overridable.
- A **compact three-criteria triplet** (`✓ ✓ ✓`) on every candidate row; app-wide colour rule applies.
- **Position pills** next to every candidate for positional-coverage awareness.
- **Guest subsection** (S007) — read-only rows showing all S007 stat fields; guests excluded from captain-pick RPCs.
- **Pair-confirmation sheet** — side-by-side candidates · position pills · triplet · rank-gap badge · White=weaker assignment note · Confirm / Cancel.

New RPC required (queued for §2.7 finalization, S008 or earlier): `set_matchday_captains(matchday_id, white_profile_id, black_profile_id)` — SECURITY DEFINER, admin-only, writes `is_captain = true` on the two chosen players' `match_players` rows and audit columns `matches.captain_assigned_at` + `matches.captain_assigned_by`.

---

## 5. Teams, Draft, Match Result Entry
*(unchanged from V2.4)*

---

## 6. Scoring, Last-5, Discipline & Punctuality
*(unchanged from V2.4)* — late-cancel math unchanged (−1 after lock, −1 + 7-day ban within 24h). **V2.6 clarification:** the `−1` / `−2` *visual indicator* moves off the leaderboard row (S006 refinement) and onto the §3.15 match-detail sheet. Leaderboard's point total still reflects `late_cancel_points`.

---

## 7. WhatsApp Integration & Scheduled Reminders
*(unchanged from V2.5)*

---

## 8. Push Notifications
*(unchanged from V2.5)* — existing notification kinds + new deep-link destinations surfaced by S006/S007 screens:
- `match_entry_approved` → §3.14 (Recent matches top row pulse).
- `signup_approved` → §3.14 (edit sheet opens pre-scrolled to positions).
- `roster_locked` → §3.1-v2 Captain helper (for admins) + §3.7 state 6 for players.
- `plus_one_unlocked` → §3.7 state 5 (Bring a +1 CTA active).

---

## 9. Player Positions
*(unchanged from V2.5)* — 5-position palette locked (GK / DEF / CDM / W / ST), CM + CAM intentionally excluded.

**V2.6 additions.**
- Position pills now render on **guest rows** too (S007), drawing from the new `match_guests.primary_position` + `match_guests.secondary_position` columns. Guests with no position data rendered omit the pills gracefully.
- Position pills appear on the **captain-helper candidate list** (§3.1-v2) and on the **pair-confirmation sheet** big candidate cards.

---

## 10. Theme Preference
*(unchanged from V2.5)* — `profiles.theme_preference` stores `light | dark | system`, default `system`, toggled from Settings or the §3.14 profile edit sheet.

---

## 11. Leaderboard Sort Preference (NEW in V2.6)

**Storage.** `profiles.leaderboard_sort leaderboard_sort NOT NULL DEFAULT 'points'`. Enum values: `points · goals · motm · wins · last5_form`.

**Where it's written.** §3.14 profile edit sheet (five-chip row). Writes immediately on tap — no explicit Save. Matches the theme-chip UX.

**Where it's read.** §3.13 Leaderboard — default sort on screen mount; sort chip row also lets the user temporarily reorder without persisting. Explicit "Make this my default" action persists the choice.

**Why persist.** Different players care about different stats. Power users of the leaderboard don't want to re-sort every session.

---

## 12. Guest Player Stats (NEW in V2.6)

**Problem.** Phase 1 allows confirmed players to invite +1 guests when slots are available. Captain-pair balancing (§3.1-v2) needs information about those guests — otherwise the admin is blind to a potentially significant chunk of the roster.

**Solution.** Inviter provides 4 required stats + 1 optional description at invite time.

**Data model (S007 — applied to §2.1 and §2.3).**
- New enums: `guest_rating AS ENUM ('weak','average','strong')`, `guest_trait AS ENUM ('low','medium','high')`.
- 6 new nullable columns on `match_guests`: `primary_position`, `secondary_position` (both `player_position`), `stamina`, `accuracy` (both `guest_trait`), `rating` (`guest_rating`), `description` (text ≤ 140 chars).
- Two new CHECK constraints: positions differ + description length.
- DB nullability keeps Phase 2 "quick invite" flows open; app-layer enforces required fields on the Phase 1 form.

**UX (§3.5 invite flow, amended S007).** Two-step form:
1. Name (required).
2. Stats:
   - Primary position — 5-chip picker (required).
   - Secondary position — 5-chip picker with the primary-matching chip disabled client-side (optional).
   - Stamina — 3-chip picker (required).
   - Accuracy — 3-chip picker (required).
   - Rating — 3-chip picker (required).
   - Description — 140-char single-line input with live counter (optional).

**Rendering.**
- §3.7 Poll screen guest row = position pills + rating chip + italic subtitle `+1 · invited by <inviter>` + italic description line (1-line truncated, tap expands).
- §3.1-v2 Captain helper guest subsection = same pills + rating chip + stamina/accuracy chips + description. Read-only; guests can't be selected as captain.
- Leaderboard (§3.13) unchanged — guests still don't appear on standings.

---

## 13. Open decisions (remaining after V2.6)

*(from V2.5, still open)*
- Position-palette coarseness — is 5 positions (no CM/CAM) too coarse for captain-balance? Revisit if pairings feel off in practice.
- Poll screen's "admin pre-assigned team colour" question from S005 — should the Poll screen show a locked player "you're on Black" chip after roster lock? Still unanswered.
- "Repeat dropout" threshold (Phase 2+).
- Snake-draft vs simple-alternate pick order (Phase 2).
- Best Goalie mechanism.
- Phase 2 admin override window after auto-captain-pick.
- Share PNG: reuse last-5 circle treatment? (Decide in Section 5.)
- V2.0 pair-balance rule ±5 league positions — dropped in S004; current §3.1-v2 treats gap>5 as amber warning, not a block. Revisit if pairings feel unbalanced.
- §3.15 Match-detail sheet full Depth-B spec + mockup — STUB only so far; full draft queued for S008 or later.

---

## 14. Next steps

**Still-open player-side:** §3.15 full Depth-B spec + mockup · Settings screen skeleton (theme · push prefs · position editor re-entry · leaderboard-sort · logout).

**Still-open admin-side:** 5 admin dashboards (Players · Matches · Seasons · Admins · Schedule) + match-results edit screen + super-admin management · pending approvals screens for signups and ref-entries.

**Implementation readiness.** Sections 1–2 done. Section 3.0 + §§3.7 · 3.13 · 3.14 · 3.1-v2 · 3.15-stub at Depth B. When §3.15 and Settings close out, Phase 1 design spec is implementation-ready. Phase 4–6 (Flows · Notifications · Open Decisions + Handoff) can piggyback on the remaining sessions.
