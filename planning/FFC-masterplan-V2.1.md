# FFC Masterplan V2.1
**Date:** 2026-04-19
**Session:** S002 (brainstorming, home PC)
**Status:** Phase 1 design in progress. Section 1 approval pending. Section 3 partially locked (3.1 captain helper, 3.2 last-5 strip, 3.3 player self-signup, 3.4 ref entry, 3.5 +1 guest). Sections 2, 4, 5, 6 pending.

---

## Revision history

### V2.1 (2026-04-19, S002 — second batch)
- **Last-5 form indicator** — corrected scope from "rolling across seasons" to **per-season only**.
- **Multi-season support** — explicit: one FFC league, many seasons. At season creation, admin picks "fresh roster" or "carry forward previous season's active players."
- **Player onboarding** — changed from invite-link-only to **self-signup + admin approval + claim-existing-profile** flow.
- **Ref workflow** — new Phase 1 deliverable: "Ref Entry Link" with admin approval queue. Replaces paper hand-off.
- **+1 guest mechanic** — new Phase 1 deliverable: auto-unlocking guest slots when the poll is short, any confirmed player can invite, guests recorded on the match but not on the leaderboard.
- **Nice-to-haves** — all 5 confirmed for Phase 4 (H2H, deep form guide, payments, badges, injury list).

### V2.0 (2026-04-19, S002 — first batch)
- Resolved open decision #1 — captain selection formula (5 criteria + White=weaker rule).
- Added "Who can captain?" admin helper screen to Phase 1 scope.
- Added last-5 form indicator to Phase 1 scope.
- Captured brand (logo + 4-colour palette).

### V1.0 (2026-04-17, S001)
- Initial masterplan. All S001 decisions baselined here.

---

## 1. Concept
A mobile-first PWA for a friends weekly 7v7 football league with 40+ players. Replaces the current Excel + WhatsApp poll workflow with:
- Automated Monday poll with 14-player lock, waitlist, and auto-unlocking +1 guest slots
- Self-signup with admin approval and "claim existing profile" path
- Captain-driven team draft (Phase 2)
- Ref-driven match entry with admin approval queue
- Leaderboard with last-5 form indicator, seasons, end-of-season awards
- WhatsApp-shareable result cards (PNG)
- Discipline & lateness rule enforcement (Phase 2)

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

### Access, Auth, Onboarding
- **Authenticated-only** (same as PadelHub). Email/password + **Google OAuth**.
- **Self-signup is open.** New user taps "Sign up," authenticates, then lands on a **"Who are you?"** screen to either claim an existing unclaimed placeholder profile (admin-seeded) OR add a new display name.
- **Admin approval gate.** Submission goes into admin's "Pending approvals" queue. Admin approves → auth user linked to profile and player can use the app. Admin can reject with a polite email; user can retry.
- **Admin can also create players directly** (bulk-seed placeholders carried over from Excel, or add a single new player).

### Multi-Season
- One FFC league, many seasons. No `league_id` scoping — season is the organisational unit.
- Admin creates a new season with: target matchday count (e.g., 36) + **roster policy**:
  - **Fresh roster** — starts empty; players self-signup or admin adds them as the season progresses.
  - **Carry forward** — duplicates the active-player set from the prior season.
- Each season has its own leaderboard, last-5 strip, and matchday counter.

### Poll & Roster Lock
- **Hard lock at 14** confirmed players.
- **Waitlist:** overflow tappers go to a tap-ordered waitlist. Auto-promotion on cancellation with push to waitlist #1.
- **+1 guest slots:** auto-unlock **Wednesday 8:15 PM** (24h before Thursday kickoff) if the poll is < 14. Slot count = `14 − current_confirmed`. Any player already confirmed in the poll can invite a named guest. Inviter's user_id is stored against the guest record.
  - Slot-collision rule (default — subject to review): first commitment wins. A regular who votes in after guest slots have filled the gap to 14 goes to the waitlist; previously-invited guests are not bumped.
- **Cancellations:** players can cancel anytime; **late cancels incur point penalty + ban** (Phase 2 enforcement).

### Teams
- Fixed names: **White** (always picks first) vs **Black** (picks last).
- Team customization = NOT a feature. Names are immutable.

### Captain Selection Formula (resolved in S002)
The formula is used by:
- **Phase 1** — the "Who can captain?" admin helper screen (advisory; admin still picks manually and types the teams).
- **Phase 2** — the automatic captain-pick that runs on roster lock and kicks off the async draft.

| # | Criterion | Scope | Definition |
|---|---|---|---|
| 1 | Knows the group | per-player | Has played ≥ 1 match this season with every other FFC member (excluding +1 guests) who has played ≥ 1 match this season. |
| 2 | Captain cooldown | per-player | ≥ 4 matchdays have passed since they last captained. |
| 3 | Recent activity | per-player | Played in at least one of the last 2 matchdays as a locked-roster player (waitlist does not count). |
| 4 | Pair balance | per-pair | The two picked captains must be within ± 5 positions of each other on the current season league table. |
| 5 | White = weaker | assignment | The lower-ranked of the chosen pair (higher position number) captains White and picks first. |

### Draft (Phase 2)
- **Async alternating draft** (snake-style: W, B, W, B, …), turn-based with push notifications.
- **Captain selection on roster lock:** automatic using the formula above; admin gets an override window (exact window TBD in Phase 2 design) before draft invites go out.

### Match Result Entry — Ref Workflow (new in V2.1)
Replaces the paper hand-off today.

1. After admin locks teams, a **"Generate ref link"** action mints a 6-hour signed URL.
2. Admin hands phone to ref, or texts the link. No ref account needed.
3. Ref opens link in any browser and sees the **Ref Entry screen** pre-populated with the 14 locked players (+ any guests) sorted into their teams.
4. Ref fills in: final score, per-player goals (+ / − counters), yellow / red card toggles, MOTM dropdown.
5. Submit → lands in admin's **"Pending match entries"** queue. Nothing is written to the live leaderboard yet.
6. Admin reviews (all fields visible), edits inline if needed, one-tap confirm.
7. On confirm: match saved, leaderboard recomputes, share PNG becomes available, push notifications fire (result posted, MOTM announced).

Admin retains full editorial control. Ref gets a purpose-built entry surface. Paper is optional — ref can use the link live or as a post-game entry.

### Scoring Formula
- **3 pts win / 1 pt draw / 0 pt loss** (verified against user's Season 11 leaderboard screenshot).
- Late-cancel penalty subtracts from season points.
- Goals / yellow / red / MOTM shown on leaderboard but do NOT affect points.
- Attendance % = games_attended / total_matchdays_played_by_league_so_far.

### Last-5 Form Indicator (corrected in V2.1)
- Shows the player's **last 5 actual matches played this season only**. Skips weeks they were waitlisted or absent.
- At the start of a new season the strip is empty; it fills as matches are played.
- If the player has fewer than 5 matches this season, the strip is shorter — no placeholders, no empty circles.
- **Order:** oldest on the left → most recent on the right.
- **Colour mapping:** W = green, D = grey, L = red.
- **Style:** 18 px filled circle with the W/D/L letter in white (Option B — colorblind-safe).
- **Surfaces:** Leaderboard row + Player profile screen (Phase 1). Share PNG can reuse the treatment (decision deferred to Section 5).

### Seasons & Awards
- Admin creates a season with preset total matchdays (e.g., 36).
- App counts "Matchday N of 36" automatically.
- Auto-close on final matchday triggers the awards page.
- **Awards:** Best Player, Golden Boot, Best Goalie. Admin-picked at season end. **Ships in Phase 3.**
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
- **OPEN:** "Repeat dropout" definition — 2 in a season? Consecutive? Rolling window? Resolve before Phase 2.

### WhatsApp Integration
- **Share buttons + auto-generated PNG result image** (html-to-image).
- Native share sheet — admin picks the WhatsApp group, taps send.
- No WhatsApp Business API, no ongoing message cost.

### Push Notifications (reuse PadelHub Web Push + Deno Edge Function)
**Full package — all events:**
1. New poll opened (Monday)
2. Only 2 spots left (12/14 confirmed)
3. +1 slots unlocked (Wednesday 8:15 PM if poll < 14)
4. Roster locked at 14
5. Cancellation → waitlist promotion
6. You're a captain (Phase 2)
7. Your turn to draft (Phase 2)
8. Teams finalized
9. Kickoff reminder (2h before)
10. Result posted
11. MOTM announced
12. Season ending / season awards (Phase 3)

Per-user preferences deferred to v1.1.

### Nice-to-Haves (confirmed for Phase 4)
- Head-to-head player comparison
- Win streaks / deep form guide (the last-5 indicator ships in Phase 1; Phase 4 adds the drill-down / streak analytics)
- Payment tracking per match
- Player badges / achievements
- Injury / unavailable list

Not selected / deferred:
- ELO / skill rating
- Per-match photo album
- Weekly MVP recap cards

## 4. Approach: 4-Phase MVP (APPROVED)
Reuse PadelHub chassis. Each phase has its own spec → plan → implementation cycle.

- **Phase 1 — Core Weekly Cycle (MVP):** Self-signup with admin approval, player profiles, seasons with carry-forward option, weekly poll with lock + waitlist + auto-unlocking +1 slots, "Who can captain?" admin helper screen, ref entry link + admin approval queue, leaderboard with last-5 form indicator, player profile screen, share-to-WhatsApp result PNG. Admin manually enters the two teams after roster lock (no draft yet).
- **Phase 2 — Draft & Discipline:** Auto captain-pick on lock with admin override window, async alternating draft with push notifications, full discipline/lateness/ban automation.
- **Phase 3 — Seasons & Awards:** Season archive, awards page (Best Player, Golden Boot, Best Goalie), winners wall.
- **Phase 4 — Extras:** H2H compare, deep form guide (streaks + drill-downs), payment tracking, badges, injury/unavailable list.

## 5. Open decisions remaining (all Phase 2+ blockers, none blocking Phase 1)
- ~~Captain selection formula~~ — **RESOLVED in S002.**
1. "Repeat dropout" threshold.
2. Snake-draft vs simple alternating (cosmetic).
3. Best Goalie mechanism (MVP: admin picks; final: stat-based, voted, or both).
4. Late-cancel point penalty exact number (current: −1 / −2 per Discipline table).
5. Phase 2: exact admin override window after auto-captain-pick.
6. Share PNG — does it reuse the last-5 circle treatment? (Decide in Section 5.)

## 6. Assumptions flagged for spec review
- **+1 slot collision:** default is "first commitment wins" — guests stay, late-voting regulars go to waitlist. Alternative = guests get bumped by late-voting regulars.
- **Rejected signups:** user gets a polite email and can retry with different info.
- **Guest attribution:** inviter's user_id stored on each guest record for accountability. Alternative = anonymous guests.
- **Guest visibility on leaderboard:** guests are NOT on the leaderboard (they're not FFC members). Their goals count toward the match score but not toward any season ranking.

## 7. Next steps
- S002 (continuing): present Phase 1 spec Sections 2–6 (Data Model, full Screens & Navigation, Key Flows, Notifications & Share, Open Decisions).
- Finalize `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md`.
- Spec self-review.
- User approves spec.
- Invoke `superpowers:writing-plans` to produce the Phase 1 implementation plan.
