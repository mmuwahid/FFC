# FFC Masterplan V2.0
**Date:** 2026-04-19
**Session:** S002 (brainstorming, home PC)
**Status:** Phase 1 design in progress — Section 1 (Architecture) approved, captain formula and last-5 indicator locked. Sections 2–6 of the Phase 1 spec still pending.

---

## Revision history

### V2.0 (2026-04-19, S002)
- **Resolved open decision #1** — captain selection formula is now fully defined (was "user will define later").
- **Added to Phase 1 scope:** "Who can captain?" admin helper screen.
- **Added to Phase 1 scope:** last-5 form indicator on Leaderboard and Player profile.
- **Brand captured and locked:** logo `FF_LOGO_FINAL.pdf` and 4-colour palette in `shared/`. Visual direction = editorial / classic European football crest.

### V1.0 (2026-04-17, S001)
- Initial masterplan. All decisions below were locked in S001.

---

## 1. Concept
A mobile-first PWA for a friends weekly 7v7 football league with 40+ players. Replaces the current Excel + WhatsApp poll workflow with:
- Automated Monday poll with 14-player lock and waitlist
- Captain-driven team draft (Phase 2)
- Match entry with goals, cards, MOTM, attendance
- Leaderboard with last-5 form indicator, seasons, end-of-season awards
- WhatsApp-shareable result cards (PNG)
- Discipline & lateness rule enforcement
- "Who can captain?" admin helper screen (Phase 1) → auto-captain-pick + async draft (Phase 2)

## 2. Brand

**Logo:** `shared/FF_LOGO_FINAL.pdf` — shield crest, vertical White | Black split, laurel wreath, "FF" monogram, three stars at base.

**Palette:** `shared/COLORS.pdf`
| Token | Approx. hex | CMYK | Role |
|---|---|---|---|
| Black | `#1A1A1A` | 0 / 0 / 0 / 100 | Primary ink · Black team |
| White | `#FFFFFF` | 0 / 0 / 0 / 0 | White team · high surface |
| Champagne gold | `~#A89D78` | 33 / 31 / 48 / 1 | Brand accent · crest frame · laurel |
| Bone | `~#EAE6DD` | 6 / 6 / 10 / 1 | Soft secondary surface |

**Direction:** editorial / classic sport crest. Two-tone with one warm metallic accent. Club programme aesthetic, not SaaS dashboard.

## 3. Decisions locked

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

### Captain Selection Formula (resolved in S002)
A candidate is a **fully-qualifying captain** if and only if **all 5** criteria hold. The formula is used by:
- **Phase 1** — the "Who can captain?" admin helper screen (advisory; admin still picks manually).
- **Phase 2** — the automatic captain-pick that runs on roster lock and kicks off the async draft.

| # | Criterion | Definition |
|---|---|---|
| 1 | Knows the group | Has played ≥ 1 match **this season** with every other FFC member (excluding +1s) who has played at least one match this season. |
| 2 | Captain cooldown | ≥ 4 matchdays since they last captained. |
| 3 | Recent activity | Played in at least one of the **last 2 matchdays** (must have been on the locked 14 — waitlist doesn't count). |
| 4 | Pair balance | The two picked captains must be within **± 5 positions** of each other on the current season league table. |
| 5 | White = weaker | Of the picked pair, the **lower-ranked** captain (higher position number) captains **White** and picks first. |

**Helper screen behaviour:**
- Always shows a ranked candidate list.
- Fully-qualifying candidates sit at the top.
- If no pair fully qualifies, partial-qualifying candidates are shown below with small badges indicating which criteria each one misses (e.g., *"missed rank gap"*, *"captained 3wk ago"*, *"didn't play last 2"*).
- Admin picks two regardless of qualification — screen is guidance, not a gate.

### Draft (Phase 2)
- **Async alternating draft** (snake-style: W, B, W, B, …), turn-based with push notifications.
- **Captain selection on roster lock:** automatic using the formula above; admin can override before draft invites go out (decision to confirm in Phase 2 design).

### Match Result Entry
- **Admin enters everything:** final score, per-player goals, yellow/red cards, attendance, MOTM.
- Single-user flow — fastest, matches current Excel habit.

### Scoring Formula
- **3 pts win / 1 pt draw / 0 pt loss** (verified against user's Season 11 leaderboard screenshot).
- Late-cancel penalty subtracts from season points.
- Goals / yellow / red / MOTM shown on leaderboard but do NOT affect points.
- Attendance % = games_attended / total_matchdays_played_by_league_so_far.

### Last-5 Form Indicator (resolved in S002)
- Shows the player's **last 5 actual matches played** (skips weeks they were waitlisted or absent). Shorter strip if they have fewer than 5 career matches.
- **Order:** oldest on the left → most recent on the right.
- **Colour mapping:** W = green, D = grey, L = red.
- **Style:** 18 px filled circle with the W/D/L letter in white (Option B — colorblind-safe).
- **Surfaces:** Leaderboard row + Player profile screen (Phase 1). Share PNG design can reuse the same treatment (Phase 1 or later at our discretion).

### Seasons
- Admin creates a season with preset total matchdays (e.g., 36).
- App counts "Matchday N of 36" automatically.
- Auto-close on final matchday triggers the awards page.
- **Awards:** Best Player, Golden Boot, Best Goalie.
  - MVP: admin picks each at season end (simplest).
  - Schema tracks `played_as_gk` + `goals_conceded_while_gk` per match so stat-based Best Goalie can be added later without migration.

### Discipline & Punctuality
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

Per-user preferences deferred to v1.1.

### Nice-to-Have Features (in-scope for later phases)
Selected:
- Head-to-head player comparison (Phase 4)
- Win streaks / form guide (Phase 4 — extended form drill-down; the last-5 indicator itself ships in Phase 1)
- Payment tracking per match (Phase 4)
- Player badges / achievements (Phase 4)
- Injury / unavailable list (Phase 4)

Not selected / deferred:
- ELO / skill rating — not picked
- Per-match photo album — not picked
- Weekly MVP recap cards — not picked

## 4. Approach: 4-Phase MVP (APPROVED)
Reuse PadelHub chassis. Each phase has its own spec → plan → implementation cycle.

- **Phase 1 — Core Weekly Cycle (MVP):** Auth (email + Google), players/profiles, seasons, weekly poll with lock + waitlist, match entry (score, goals, cards, attendance, MOTM), leaderboard **with last-5 form indicator**, Player profile screen, share-to-WhatsApp result PNG, **"Who can captain?" admin helper screen**. Admin manually enters the two teams after roster lock (no draft yet).
- **Phase 2 — Draft & Discipline:** Auto captain-pick on lock using the S002 formula, async alternating draft with push notifications, full discipline/lateness/ban automation.
- **Phase 3 — Seasons & Awards:** Matchday counter, auto season-close, awards page, season archive, winners wall.
- **Phase 4 — Extras:** H2H compare, form guide (deep), payment tracking, badges, injury/unavailable list.

## 5. Open decisions remaining (5 items, all Phase 2-blocking, none Phase 1-blocking)
- ~~Captain selection formula~~ — **RESOLVED in S002.**
1. "Repeat dropout" threshold (see Discipline table).
2. Snake-draft vs simple alternating (both give "Black last" — cosmetic choice).
3. Best Goalie mechanism (MVP: admin picks; final: stat-based, voted, or both).
4. Late-cancel point penalty exact number (current assumption: −1 / −2 per Discipline table).
5. Phase 2: does admin get an override window after auto-captain-pick, before draft invites go out? (New, surfaced in S002.)

## 6. Next steps
- S002 (continuing): present Phase 1 spec Sections 2–6 (Data Model, Screens & Navigation including captain helper screen and last-5 indicator, Key Flows, Notifications & Share, Open Decisions).
- Finalize `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md`.
- Spec self-review.
- User approves spec.
- Invoke `superpowers:writing-plans` to produce the Phase 1 implementation plan.
