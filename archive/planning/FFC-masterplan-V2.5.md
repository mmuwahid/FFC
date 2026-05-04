# FFC Masterplan V2.5
**Date:** 19/APR/2026
**Session:** S005 (Phase 1 design, home PC)
**Status:** Phase 1 design in progress. Section 1 APPROVED. Section 2 Data Model APPROVED with S005 amendments (player positions + theme preference). Section 3.0 Navigation + IA APPROVED. Section 3.7 Poll Screen spec + mockup approved pending theme/pill refinement review. Sections 3.1 captain helper reconciliation, 3.7–3.11 admin dashboards, 3.12+ remaining player-side screens, 4, 5, 6 pending.

---

## Revision history

### V2.5 (19/APR/2026, S005)
- **Player positions added** to the data model. New enum `player_position` with 5 values: `GK` · `DEF` · `CDM` · `W` · `ST`. Each has a locked colour token for UI pills (gold / deep blue / dark green / orange / FFC accent red).
- **Primary + secondary position columns** added to `profiles`. Primary is required at signup; secondary is optional. A CHECK constraint prevents the two being identical.
- **Central-midfielder (CM) role intentionally excluded** — in 7v7, all-rounders map to CDM (defensive lean) or W (attacking lean) as primary. Can be re-added later if the 5-position palette feels too coarse.
- **Light / Dark theme toggle** added to the app. New enum `theme_preference` with values `light` · `dark` · `system`. Stored on `profiles.theme_preference` (default `system`) so preference syncs across devices.
- **Signup form** gains a position picker (primary required, secondary optional) and a theme-preference default that respects `prefers-color-scheme`.
- **Section 2.2 `profiles` table amended** via ALTER statements documented inline in the spec (greenfield DDL also updated in the same file).
- **Section 3.0 Navigation + Information Architecture approved** — 4-tab player nav + 5th admin tab, full route list, deep-link map, auth-aware layout rules.
- **Section 3.7 Poll Screen** speced and mockup approved pending v2 review (position pills + dark mode rendered side-by-side; 5 alternate states annotated).

### V2.4 (19/APR/2026, S004)
*(preserved — see `FFC-masterplan-V2.4.md`)*

### V2.3 (2026-04-19, S003)
*(preserved — see `FFC-masterplan-V2.3.md`)*

### V2.2 · V2.1 · V2.0 · V1.0
*(preserved in prior files)*

---

## 1. Concept
*(unchanged from V2.2)*

## 2. Brand
*(unchanged from V2.0)* — V2.5 adds a dark-mode palette that inverts `paper ↔ ink`, uses deep navy `#0e1826` as the dark surface (same hue family as the V2.0 matchday hero card), and slightly brightens both the FFC accent red (`#c8102e → #e63349`) and gold (`#d4a84a → #e5ba5b`) for legibility against dark backgrounds.

---

## 3. Decisions locked (cumulative)

**From V2.0–V2.4:** *(see prior doc versions)*.

**New in V2.5 (from S005):**
- Player positions = 5 codes (`GK`, `DEF`, `CDM`, `W`, `ST`) with locked colour tokens. CM excluded.
- Primary position required at signup; secondary optional; both nullable on existing ghost profiles.
- Light / Dark / System theme preference stored on `profiles.theme_preference` (default `system`).
- Section 3.0 navigation and routing locked.

---

## 4. Captain Selection Formula
*(unchanged from V2.4 — three per-player criteria + early-season randomizer + White=weaker pair rule.)*

**V2.5 adjacency:** the captain-helper screen (Section 3.1 reconciliation, pending S006) will surface **position pills** next to every candidate so the admin can balance positional coverage when picking the pair.

---

## 5. Teams, Draft, Match Result Entry
*(unchanged from V2.4)*

## 6. Scoring, Last-5, Discipline & Punctuality
*(unchanged from V2.4)*

## 7. WhatsApp Integration & Scheduled Reminders
*(unchanged from V2.4)*

## 8. Push Notifications
*(unchanged from V2.4)*

---

## 9. Player Positions (NEW in V2.5)

### 9.1 Catalogue (locked)

| Code | Name | Colour token | Hex |
|---|---|---|---|
| `GK` | Goalkeeper | `--pos-gk` | `#d4a84a` (gold) |
| `DEF` | Defender (CB / FB) | `--pos-def` | `#1e3a8a` (deep blue) |
| `CDM` | Defensive midfielder | `--pos-cdm` | `#065f46` (dark green) |
| `W` | Winger | `--pos-w` | `#ea580c` (orange) |
| `ST` | Striker | `--pos-st` | `#c8102e` (FFC accent red) |

### 9.2 UI rendering rule
- **Primary** position renders as a solid-filled pill.
- **Secondary** position renders as an outlined pill (same hue, no fill).
- **Guests** (`match_guests` rows) get no position pill — position isn't tracked for +1s.
- In dark mode, outline pills use a slightly lightened hue for legibility.

### 9.3 Where position pills appear
- Poll screen commitment list (§3.7) — both light and dark mockup approved.
- Captain-helper screen (§3.1 reconciliation, S006) — prominent for position-balance picking.
- Player profile (§3.14, S006) — primary + secondary shown larger.
- Admin Players dashboard (§3.7-admin, S006) — inline edit.
- Leaderboard (§3.13, S006) — optional filter chip.

### 9.4 Settings change flow
- Players can edit their own positions from Settings at any time (not only at signup).
- Admins can edit any player's positions from the Players dashboard.

---

## 10. Theme Preference (NEW in V2.5)

### 10.1 Storage
- Column: `profiles.theme_preference theme_preference NOT NULL DEFAULT 'system'`.
- Enum values: `light` · `dark` · `system`.
- First-run default: `system` (respects OS / browser `prefers-color-scheme`).

### 10.2 Toggle location
- Settings screen (§3.x, S006) — three-chip selector: ☀️ Light · 🌙 Dark · ⚙️ System.
- Selection persists on every device the user signs into (server-stored).
- Change takes effect immediately — no reload needed.

### 10.3 Palette
- Light paper: `#f6f1e4`. Dark paper: `#0e1826` (deep navy — same hue family as V2.0 matchday card).
- Light ink: `#0a1628`. Dark ink: `#f2ead6`.
- Accent in dark mode: `#e63349` (brighter than light `#c8102e`).
- Gold in dark mode: `#e5ba5b` (brighter than light `#d4a84a`).
- Position pill hues stay constant across both modes; only outline pills are lightened in dark mode.

### 10.4 Implementation sketch (for Phase 1 code stage)
- Root element class toggle (`<html class="light">` or `<html class="dark">`).
- All component CSS uses CSS custom properties resolved per class.
- Client boot reads `profiles.theme_preference`; if `system`, reads `prefers-color-scheme` and subscribes to changes.

---

## 11. Open decisions (unchanged from V2.4)
1. "Repeat dropout" threshold (Phase 2+).
2. Snake-draft vs simple alternating order (Phase 2).
3. Best Goalie mechanism.
4. Phase 2 admin override window after auto-captain-pick.
5. Share PNG style — reuse 3.2 last-5 circle treatment? (Section 5.)
6. Pair-balance rule (V2.0 criterion 4, ±5 positions) — dropped in S004; revisit if pairings feel unbalanced.
7. **NEW:** CAM / generalist CM role — excluded in V2.5; revisit if the 5-position palette feels too coarse for captain balancing.

---

## 12. Next steps
- S006 (new window): (a) spec + mockup Leaderboard (§3.13) — includes last-5 form strip + optional position filter. (b) Spec + mockup Player Profile (§3.14) — larger last-5 strip, position pills prominent, stats breakdown. (c) Section 3.1 captain-helper reconciliation — mockup with position pills.
- S007+: admin-dashboard family (5 screens), Settings screen (theme + push prefs), Match-result screen + share PNG placement, Signup/Onboarding refresh with position picker.
- After Section 3 complete: Section 4 (Key Flows), Section 5 (Notifications & Share PNG), Section 6 (Open Decisions handoff).
- Phase 1 implementation plan via `superpowers:write-plan` only after full spec approval.
