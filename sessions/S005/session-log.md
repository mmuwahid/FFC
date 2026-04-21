# Session S005 — Masterplan V2.4/V2.5 · Section 3.0 Nav · Section 3.7 Poll screen + positions + theme

**Date:** 19/APR/2026 (continuing same day as S003/S004)
**PC:** Home
**Prior session:** S004 — Section 2 Data Model closed; Section 1 approved; 4 user refinements applied.

---

## Summary
Opened Section 3 (Screens & Navigation). Wrote masterplan V2.4 capturing all S004 refinements. Section 3.0 navigation + information architecture approved. Speced and delivered first screen mockup — §3.7 Poll Screen — in primary state (YES voted, confirmed #7 of 14) with 5 annotated alternate-state tiles. Two mid-session user additions landed: player positions (5-position palette with colour-coded pills) and light/dark theme toggle. Both applied as amendments to the approved Section 2 DDL and carried forward in masterplan V2.5.

## What got done

### 1. Masterplan V2.4 written
- Captures all four S004 refinements (cron schedule, late-cancel penalties, simplified captain formula, Section 1 approval).
- V2.3 preserved unchanged.

### 2. Section 3.0 — Navigation & Information Architecture (APPROVED)
- **Three app modes:** player (4-tab bottom nav), admin (5-tab with Admin tab), ref (anon, token-gated single-screen).
- **Full route list** — 16 routes documented including `/signup/pending`, `/admin/*` dashboard family, and anon `/ref/:token`.
- **Onboarding state machine** — anon → pending → approved player.
- **Notification deep-link targets** — mapped all 13 notification kinds to routes.
- **Auth-aware layout** — 4 layout states (anon / unapproved / player / admin).
- **Information-density rules** — player-facing = mobile-first single column; admin allowed tables and horizontal scroll.
- **Badge + indicator system** — admin tab badge from pending queues; home tab dot if poll open and unvoted; bell icon count.

### 3. Section 3.7 — Poll Screen (SPEC COMPLETE; MOCKUP v2 PENDING USER REVIEW)
- Depth B spec: purpose, data required, 7 key states, key actions, acceptance criteria, error/loading states, notification fan-outs.
- **Primary state** (voted YES, confirmed #7 of 14) rendered in both light and dark mode as 390×844 phone frames.
- **5 alternate-state tiles**: pre-open · waitlist · +1 unlocked · roster locked · penalty sheet · theme-toggle chip row.
- Position pills render on every commitment row (primary filled, secondary outlined).
- Guest rows render italic with gold avatar, no position pill, no deep-link.
- Penalty copy contract: always read from `app_settings.match_settings` at screen open, never hardcoded.

### 4. Mid-session addition — Player Positions
- User requested position tags surfaced throughout the app.
- **5-position palette locked** (CM intentionally excluded):
  - `GK` gold · `DEF` deep blue · `CDM` dark green · `W` orange · `ST` FFC accent red
- **Data model amendment** applied to §2.1 (new `player_position` enum) and §2.2 (`profiles.primary_position` + `profiles.secondary_position` + `profiles_positions_differ` CHECK + `profiles_primary_pos_idx` index). Both as CREATE-baked columns with the equivalent ALTER documented inline.
- **Primary required at signup · secondary optional.** Both columns nullable for legacy ghost profiles.
- Self-signup form tweak recorded for S006 (position picker UI).
- Captain-helper screen (§3.1 reconciliation, S006) gets prominent position pills for pair-balance.

### 5. Mid-session addition — Light / Dark theme toggle
- User requested theme toggle in Settings; noted mockup was "all in white".
- **Enum `theme_preference`** added with values `light` · `dark` · `system`.
- **Column** `profiles.theme_preference theme_preference NOT NULL DEFAULT 'system'` added.
- Stored on profile so preference syncs across devices.
- First-run default `system` reads `prefers-color-scheme`.
- **Dark palette** defined with `paper → #0e1826` (deep navy — same hue family as V2.0 matchday hero), `ink → #f2ead6`, accent `#e63349`, gold `#e5ba5b`. Position pill hues stay constant across modes; outline pills lighten in dark for legibility.
- Root-class toggle architecture (`<html class="light|dark">`) with all styling via CSS custom properties.

### 6. Masterplan V2.5 written
- Captures position catalogue (§9), theme preference (§10), Section 3.0 locking, and two new open decisions (position-palette coarseness, pair-balance rule from V2.4).
- V2.4 preserved unchanged.

## Files touched
- `planning/FFC-masterplan-V2.4.md` — **new**.
- `planning/FFC-masterplan-V2.5.md` — **new**.
- `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` — §2.1 enums extended (`player_position`, `theme_preference`), §2.2 `profiles` amended with 3 new columns + CHECK + index + inline ALTER note.
- `.superpowers/brainstorm/635-1776592878/content/welcome.html` — **new** (Companion welcome card).
- `.superpowers/brainstorm/635-1776592878/content/3-7-poll-screen.html` — **new, v2** (light + dark phone frames side-by-side with position pills + alternate-state tiles).
- `sessions/S005/session-log.md` — this file.
- `sessions/INDEX.md` — S005 row added (on close).
- `CLAUDE.md` — Latest session bumped (on close).
- `tasks/todo.md` — S005 completion section + S006 plan (on close).

## Decisions locked in S005
1. **Section 1 confirmation** carried from S004 — re-acknowledged at S005 kickoff.
2. **Section 3.0 navigation + IA** — 4-tab player / 5-tab admin / anon ref; 16 routes; auth-aware layouts.
3. **Player positions = 5 codes** (GK/DEF/CDM/W/ST) with locked colour tokens. CM excluded.
4. **Primary position required at signup**, secondary optional, both nullable for legacy profiles.
5. **Theme preference enum** with `light/dark/system`; DB-stored on `profiles.theme_preference` (default `system`).
6. **Depth B** for Section 3 (screen spec + mockup gate per screen).

## Open decisions opened in S005
1. Decide in S006: should the Poll screen also show the admin's team-colour pre-assignment once roster is locked (i.e. does the player see "you're on Black" before Thursday)?
2. CAM / generalist CM role — excluded in V2.5; revisit if 5-position palette feels too coarse for captain balancing.

## Handoff notes for S006
- **Cold-start files:** `CLAUDE.md`, `sessions/INDEX.md`, `sessions/S005/session-log.md`, `planning/FFC-masterplan-V2.5.md`, the Phase 1 design spec (Section 2 amendments + Section 3.0 locked + §3.7 speced), `tasks/todo.md` NEXT SESSION block.
- **Visual Companion:** S005's content directory is `.superpowers/brainstorm/635-1776592878/content/`. The server is stopped at session close; restart via `scripts/start-server.sh --project-dir "<FFC root>"` to show new mockups.
- **Next screen specs (Depth B + mockup):** Leaderboard (§3.13) · Player profile (§3.14) · Captain helper reconciled to V2.4 formula (§3.1-v2).
- **After player-side core screens:** admin-dashboard family (5 screens), Settings screen (theme + push prefs + position editor), Match-result screen with share PNG.
- **Mockup-first rule active** — every screen needs an approved HTML mockup before Phase 1 code starts.
- **Auto-load memories:** DD/MMM/YYYY date format + Visual Companion usage rule.
