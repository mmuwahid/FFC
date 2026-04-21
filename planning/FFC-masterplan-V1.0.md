# FFC Masterplan V1.0
**Date:** 2026-04-17
**Session:** S001 (brainstorming, work PC)
**Status:** Phase 1 design in progress — Section 1 (Architecture) approval pending. Sections 2–6 not yet presented.

---

## 1. Concept
A mobile-first PWA for a friends weekly 7v7 football league with 40+ players. Replaces the current Excel + WhatsApp poll workflow with:
- Automated Monday poll with 14-player lock and waitlist
- Captain-driven team draft (Phase 2)
- Match entry with goals, cards, MOTM, attendance
- Leaderboard, seasons, end-of-season awards
- WhatsApp-shareable result cards (PNG)
- Discipline & lateness rule enforcement

## 2. Decisions locked in S001

### Access & Auth
- **Authenticated-only** (same as PadelHub). Email/password + **Google OAuth**.
- Every player has a real account. Admin creates players; players complete signup via invite link.
- WhatsApp share links deep-link into the app; unauthed users hit login first.

### Poll & Roster Lock
- **Hard lock at 14** confirmed players.
- **Waitlist:** overflow tappers go to a tap-ordered waitlist. Auto-promotion on cancellation with push to waitlist #1.
- **Cancellations:** players can cancel anytime; **late cancels incur point penalty + ban** (see Discipline).

### Teams
- Fixed names: **White** (always picks first) vs **Black** (picks last).
- Team customization = NOT a feature. Names are immutable.

### Draft (Phase 2 — deferred from MVP)
- **Async alternating draft** (snake-style: W, B, W, B, …), turn-based with push notifications.
- Captain selection formula: user will define later. Default for MVP: admin picks.

### Match Result Entry
- **Admin enters everything:** final score, per-player goals, yellow/red cards, attendance, MOTM.
- Single-user flow — fastest, matches current Excel habit.

### Scoring Formula
- **3 pts win / 1 pt draw / 0 pt loss** (verified against user's Season 11 leaderboard screenshot).
- Late-cancel penalty subtracts from season points.
- Goals / yellow / red / MOTM shown on leaderboard but do NOT affect points.
- Attendance % = games_attended / total_matchdays_played_by_league_so_far.

### Seasons
- Admin creates a season with preset total matchdays (e.g., 36).
- App counts "Matchday N of 36" automatically.
- Auto-close on final matchday triggers the awards page.
- **Awards:** Best Player, Golden Boot, Best Goalie.
  - MVP: admin picks each at season end (simplest).
  - Schema tracks `played_as_gk` + `goals_conceded_while_gk` per match so stat-based Best Goalie can be added later without migration.

### Discipline & Punctuality (added by user mid-session)
**Kickoff:** 8:15 PM Thursday. Game ends 9:30 PM.

| Offense | Point penalty | Ban |
|---|---|---|
| Drop out after roster locked | −1 pt | — |
| Drop out within 24h of game OR repeat dropout | −1 pt | 1 week |
| Late 8:15–8:29 | −1 pt | 1 week |
| Late 8:30+ or no-show | −2 pts | 2 weeks |

- Banned players are **hidden** from the poll during their ban window (not merely blocked from voting).
- Admin can override any ban.
- **OPEN DECISION:** "Repeat dropout" — is it 2 in a season? Consecutive? Rolling window? User to clarify before Phase 2.

### WhatsApp Integration
- **Share buttons + auto-generated PNG result image** (html-to-image).
- Native share sheet — admin picks the WhatsApp group, taps send.
- No WhatsApp Business API, no ongoing message cost.

### Push Notifications (reuse PadelHub Web Push + Deno Edge Function)
**Full package — all events:**
1. New poll opened (Monday)
2. Only 2 spots left (12/14 confirmed)
3. Roster locked at 14
4. Cancellation → waitlist promotion
5. You're a captain (Phase 2)
6. Your turn to draft (Phase 2)
7. Teams finalized
8. Kickoff reminder (2h before)
9. Result posted
10. MOTM announced
11. Season ending / season awards
- Per-user preferences deferred to v1.1.

### Nice-to-Have Features (in-scope for later phases)
Selected by user:
- Head-to-head player comparison (Phase 4)
- Win streaks / form guide (Phase 4)
- Payment tracking per match (Phase 4)
- Player badges / achievements (Phase 4)
- Injury / unavailable list (Phase 4)

Not selected / deferred:
- ELO / skill rating — not picked
- Per-match photo album — not picked
- Weekly MVP recap cards — not picked

## 3. Approach: 4-Phase MVP (APPROVED)
Reuse PadelHub chassis. Each phase has its own spec → plan → implementation cycle.

- **Phase 1 — Core Weekly Cycle (MVP):** Auth (email + Google), players/profiles, seasons, weekly poll with lock + waitlist, match entry (score, goals, cards, attendance, MOTM), leaderboard, share-to-WhatsApp result PNG. Admin manually enters the two teams after roster lock (no draft yet).
- **Phase 2 — Draft & Discipline:** Captain designation, async alternating draft with push notifications, full discipline/lateness/ban automation.
- **Phase 3 — Seasons & Awards:** Matchday counter, auto season-close, awards page, season archive, winners wall.
- **Phase 4 — Extras:** H2H compare, form guide, payment tracking, badges, injury/unavailable list.

## 4. Open decisions to resolve before Phase 2
1. Captain selection formula (user to define)
2. "Repeat dropout" threshold (see Discipline table)
3. Snake-draft vs simple alternating (both give "Black last", cosmetic choice)
4. Best Goalie mechanism (MVP: admin picks; final: stat-based, voted, or both)
5. Late-cancel point penalty exact number (current assumption: −1 / −2 per Discipline table)

## 5. Next steps
- S002: continue Phase 1 design Sections 2–6 (Data Model, Screens, Key Flows, Notifications & Share, Deferred to Phase 2–4, Open Decisions)
- Then: write `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` (final)
- Then: spec self-review
- Then: user approves spec
- Then: invoke `superpowers:writing-plans` for Phase 1 implementation plan
