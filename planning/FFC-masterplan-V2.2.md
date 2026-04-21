# FFC Masterplan V2.2
**Date:** 2026-04-19
**Session:** S002 (brainstorming, home PC)
**Status:** Phase 1 design in progress. Section 1 approval pending. Section 3 partially locked (3.1 captain helper, 3.2 last-5 strip, 3.3 player self-signup, 3.4 ref entry, 3.5 +1 guest, 3.6 vote-order / waitlist priority). Sections 2, 4, 5, 6 pending.

---

## Revision history

### V2.2 (2026-04-19, S002 — third batch)
- **Poll vote ordering + waitlist priority** — new concept, Section 3.6. Every `poll_votes` row carries a server-side `voted_at` timestamp. Confirmed vs waitlist is derived by sorting active commitments ASC. First 14 = confirmed; 15th+ = waitlist in strict vote-order. Priority = faster voter.
- **S002 assumptions now fully confirmed** — all 5 assumptions from V2.1 approved by user (first-commitment-wins guest rule, rejection email retry, guest-inviter attribution, guests off leaderboard, rejection-email copy).

### V2.1 (2026-04-19, S002 — second batch)
- Last-5 strip corrected to per-season scope.
- Multi-season model with roster policy (fresh / carry forward).
- Player self-signup + admin approval + claim-existing-profile flow.
- Ref entry link + admin approval queue (replaces paper workflow).
- +1 guest mechanic with Wednesday 8:15 PM auto-unlock.
- Nice-to-haves confirmed for Phase 4.

### V2.0 (2026-04-19, S002 — first batch)
- Captain selection formula resolved (5 criteria, White = weaker).
- "Who can captain?" admin helper screen added to Phase 1.
- Last-5 form indicator added to Phase 1.
- Brand palette + logo captured.

### V1.0 (2026-04-17, S001)
- Initial masterplan.

---

## 1. Concept
A mobile-first PWA for a friends weekly 7v7 football league with 40+ players. Replaces the current Excel + WhatsApp poll workflow with:
- Automated Monday poll with **strict vote-order tracking**, 14-player lock, waitlist, and auto-unlocking +1 guest slots
- Self-signup with admin approval and "claim existing profile" path
- Captain-driven team draft (Phase 2)
- Ref-driven match entry with admin approval queue
- Leaderboard with last-5 form indicator, seasons, end-of-season awards
- WhatsApp-shareable result cards (PNG)
- Discipline & lateness rule enforcement (Phase 2)

## 2. Brand
*(unchanged from V2.0 — see `FFC-masterplan-V2.0.md` for full palette and logo reference)*

| Token | Approx. hex | Role |
|---|---|---|
| Black | `#1A1A1A` | Primary ink · Black team |
| White | `#FFFFFF` | White team · high surface |
| Champagne gold | `~#A89D78` | Brand accent · crest frame · laurel |
| Bone | `~#EAE6DD` | Soft secondary surface |

Direction: editorial / classic sport crest.

## 3. Decisions locked

### Access, Auth, Onboarding
*(unchanged from V2.1)*
- Authenticated-only. Email/password + Google OAuth.
- Self-signup is open → "Who are you?" screen (claim existing profile OR new name) → admin approval queue → linked.
- Admin can also create players directly.

### Multi-Season
*(unchanged from V2.1)*
- One FFC league, many seasons. No `league_id` scoping.
- Season creation picks roster policy: fresh or carry-forward.

### Poll, Vote Ordering, Roster Lock
- **Hard lock at 14** confirmed players.
- **Vote ordering (new in V2.2):**
  - Every `poll_votes` row has a server-assigned `voted_at timestamptz`.
  - At any moment, confirmed roster = first 14 active votes sorted by `voted_at` ASC.
  - Waitlist = 15th+ votes in the same sort order.
  - Tiebreaker: ascending `poll_votes.id`.
  - On cancellation, the next waitlist entry is auto-promoted.
  - Re-voting after cancel creates a NEW row with a NEW timestamp — no position reclaim.
- **+1 guest slots:** auto-unlock Wed 8:15 PM if poll < 14. Slot count = `14 − (confirmed + guests)`. Any confirmed player can invite a named guest. Guests commit via `match_guests.invited_at` — part of the same commitment sequence as regular votes. Previously-invited guests are not bumped by later regular votes ("first commitment wins").
- **Cancellations:** players can cancel anytime; late cancels incur point penalty + ban (Phase 2 enforcement).

### Teams
*(unchanged — White picks first, Black picks last, names immutable)*

### Captain Selection Formula
*(unchanged from V2.0)*
- 5 criteria, see V2.0 for the table.
- Phase 1: helper screen (advisory). Phase 2: auto-pick + admin override + async draft.

### Draft
*(unchanged — Phase 2, snake-style async with push notifications)*

### Match Result Entry — Ref Workflow
*(unchanged from V2.1)*
- Admin "Generate ref link" → 6h signed URL → ref enters on any browser → pending queue → admin reviews + confirms → leaderboard recomputes.

### Scoring
*(unchanged — 3 / 1 / 0 + late-cancel penalty)*

### Last-5 Form Indicator
*(unchanged from V2.1 — per-season, Option B letter-in-circle)*

### Seasons & Awards
*(unchanged — Phase 3 ships awards)*

### Discipline & Punctuality
*(unchanged from V1.0 — kickoff 8:15 PM, penalty/ban table)*

### WhatsApp Integration
*(unchanged — share buttons + auto-PNG + native share sheet)*

### Push Notifications
**12 triggers total:**
1. New poll opened (Monday)
2. Only 2 spots left (12/14 confirmed)
3. **Your vote-order position changed** (new in V2.2 — fires to a player whose confirmed/waitlist position changes due to another player cancelling or voting in)
4. +1 slots unlocked (Wednesday 8:15 PM)
5. Roster locked at 14
6. Cancellation → waitlist promotion
7. You're a captain (Phase 2)
8. Your turn to draft (Phase 2)
9. Teams finalized
10. Kickoff reminder (2h before)
11. Result posted
12. MOTM announced
13. Season ending / season awards (Phase 3)

Per-user preferences deferred to v1.1.

### Nice-to-Haves (confirmed for Phase 4)
H2H compare, deep form guide, payment tracking, badges, injury list.

## 4. Approach: 4-Phase MVP (APPROVED)
- **Phase 1 — Core Weekly Cycle:** self-signup + admin approval, seasons with carry-forward, poll with vote-order + lock + waitlist + +1 slots, captain helper screen, ref entry link + approval queue, leaderboard with last-5 indicator, player profile, share PNG. Admin manually enters teams.
- **Phase 2 — Draft & Discipline:** auto captain-pick with override window, async alternating draft, discipline/ban automation.
- **Phase 3 — Seasons & Awards:** archive, awards page, winners wall.
- **Phase 4 — Extras:** H2H, deep form guide, payments, badges, injury list.

## 5. Open decisions remaining (all Phase 2+ blockers)
- ~~Captain selection formula~~ — resolved in S002.
1. "Repeat dropout" threshold.
2. Snake-draft vs simple alternating.
3. Best Goalie mechanism.
4. Late-cancel point penalty exact number.
5. Phase 2 admin override window after auto-captain-pick.
6. Share PNG: reuse last-5 circle treatment?

## 6. Assumptions confirmed by user (V2.1 → V2.2)
All 5 V2.1 assumptions approved:
- ✓ +1 slot collision = first commitment wins.
- ✓ Rejected signups → polite email + retry.
- ✓ Guest attribution = inviter user_id stored on guest row.
- ✓ Guests do NOT appear on leaderboard or earn season points.
- ✓ Rejection email copy = "not a match for FFC right now, reach out if this is a mistake."

## 7. Next steps
- Resume brainstorming walkthrough next session (S003) from **Section 2 — Data Model**.
- Data model needs to formalise vote-ordering columns + index.
- Then Sections 3 (full nav), 4 (key flows), 5 (notifications & share), 6 (open decisions).
- Finalise spec, self-review, user approval, invoke `superpowers:writing-plans`.
