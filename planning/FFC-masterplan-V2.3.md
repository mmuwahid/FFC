# FFC Masterplan V2.3
**Date:** 2026-04-19
**Session:** S003 (Phase 1 design, home PC)
**Status:** Phase 1 design in progress. Section 1 approval still pending. Section 3 sub-sections 3.1–3.6 locked from S002. **Section 2 (Data Model) Parts 1–3 of 5 locked in S003**; Parts 4 & 5 pending. Sections 4, 5, 6 still pending.

---

## Revision history

### V2.3 (2026-04-19, S003)
- **User-role model formalised.** `profiles.is_admin boolean` replaced with `profiles.role user_role` enum (`player` | `admin` | `super_admin`). Super-admin is the only role that can promote / demote other admins.
- **Admin dashboards added to Phase 1 scope.** Includes: add / deactivate / edit players, edit match results post-approval (scores / MOTM / cards), manage roster, create / end / archive seasons.
- **Season archive** via `seasons.archived_at timestamptz`. An archived season remains in the database for history but is hidden from default queries. Archive is only allowed after `ends_on` is set.
- **Edit audit columns** added to `matches` and `match_players` (`updated_by`). Every admin-originated correction is attributable.
- **Scheduled reminders** — new DB-backed table `scheduled_reminders` (kind, cron_expression, enabled, target, payload_template, last_fired_at), driven by Supabase `pg_cron`. Admin-configurable via a dashboard screen.
- **App settings** — new key/value `app_settings` table for runtime configuration (WhatsApp group link, invite copy template, etc.). Super-admin-only write.
- **WhatsApp auto-post strategy = Option A (native share sheet, semi-manual)** for Phase 1. Cron fires → push notification to admins → native share sheet opens with message pre-filled → admin picks WhatsApp group. No Meta Business onboarding required. Options B (WhatsApp Cloud API) and C (whatsapp-web.js unofficial bot) deferred to Phase 3 re-evaluation.
- **Section 2 Data Model decisions locked (Parts 1–3 approved):**
  - Scope depth = **full production DDL** (ready-to-paste).
  - Commitment architecture = **split**. `poll_votes` + `match_guests`, merged via a view.
  - Guest-MOTM = single source on `matches` (`motm_user_id` / `motm_guest_id` with CHECK).
  - Pending queues stay separate.
  - RLS effective roles = 3 (player / admin / super-admin); anonymous ref path via SECURITY DEFINER RPC only.

### V2.2 (2026-04-19, S002 — batch 3)
Poll vote-order and waitlist priority via `voted_at`. All 5 V2.1 assumptions confirmed by user.

### V2.1 (2026-04-19, S002 — batch 2)
Per-season last-5 strip. Multi-season + roster policy. Self-signup + admin approval + claim existing profile. Ref entry link + admin approval queue. +1 guest mechanic. Phase 4 nice-to-haves confirmed.

### V2.0 (2026-04-19, S002 — batch 1)
Captain selection formula, last-5 form indicator, brand palette + logo, editorial crest direction.

### V1.0 (2026-04-17, S001)
Initial masterplan.

---

## 1. Concept
*(unchanged from V2.2)* — Mobile-first PWA for a 40+ player weekly 7v7 friends league. Replaces the current Excel + WhatsApp poll workflow with automated poll + vote-order + waitlist + +1 slots, captain-driven team draft (Phase 2), ref-driven match entry with admin approval queue, leaderboard with last-5 form indicator, seasons with end-of-season awards, WhatsApp-shareable result cards, and discipline/lateness rules enforcement (Phase 2).

## 2. Brand
*(unchanged from V2.0 — see V2.0 doc for full palette and logo reference)*

## 3. Decisions locked (cumulative)

### Access, Auth, Onboarding
*(unchanged from V2.1)*

### Roles & Admin Tier (NEW in V2.3)
Three effective roles:
| Role | Can do |
|---|---|
| `player` | Vote in polls, invite +1 guests, view leaderboard, see own profile. |
| `admin` | Everything a player does, plus: approve signups, approve ref match entries, edit match results post-approval, manage player roster (add / deactivate), create / end / archive seasons, manage scheduled reminders, generate ref links. |
| `super_admin` | Everything an admin does, plus: promote / demote admins, write to `app_settings`. |

Super-admin is seeded via migration (initial: `m.muwahid@gmail.com`). Multiple super-admins are allowed (no DB-enforced singleton) — intended for founder + one delegate.

### Multi-Season
*(unchanged from V2.1)* — plus **V2.3:** seasons may be **archived** (hidden from default queries). Archive requires the season to have already ended (`ends_on IS NOT NULL`).

### Poll, Vote Ordering, Roster Lock
*(unchanged from V2.2)*

### Teams, Captain Selection, Draft
*(unchanged)*

### Match Result Entry — Ref Workflow
*(unchanged from V2.1)* — plus **V2.3:** admins may correct match results after approval via the admin dashboard; every edit is logged via `matches.updated_by` + `match_players.updated_by`.

### Scoring, Last-5 Form Indicator, Seasons & Awards, Discipline & Punctuality
*(unchanged from V2.2)*

### WhatsApp Integration (REVISED in V2.3)
- Share buttons on match-result screens → auto-PNG → native share sheet *(unchanged)*.
- **NEW: Scheduled poll-link auto-post.** Admin configures a `scheduled_reminders` row (e.g., kind=`weekly_poll_reminder`, cron=`0 17 * * 1` for Monday 5:00 PM). When the cron fires, a push notification is sent to all admins with a pre-composed message + the poll URL. Admin taps → phone's native share sheet opens → admin picks the WhatsApp group → message posts. **Semi-manual by design (Phase 1).** Cloud API integration deferred to Phase 3.

### Push Notifications
**13 triggers total** (unchanged count; new `weekly_poll_reminder_sent` added, an existing Phase-2/3 scaffold moved):
1. Poll opened (Mon)
2. Only 2 spots left (12/14 confirmed)
3. Your vote-order position changed
4. +1 slots unlocked (Wed 8:15 PM)
5. Roster locked at 14
6. Cancellation → waitlist promotion
7. Teams finalised
8. Kickoff reminder (2h before)
9. Result posted
10. MOTM announced
11. Weekly poll reminder send (to admins, for share-sheet post) *(NEW)*
12. Captain assigned / Your draft turn *(Phase 2 scaffolds)*
13. Season ending / season awards *(Phase 3)*

Per-user preferences deferred to v1.1.

### Admin Dashboards (NEW in V2.3, Phase 1 scope)
A new admin-only bottom-nav item opens to a dashboard with the following sub-surfaces. All get HTML mockups in `mockups/` before any code.
- **Dashboard root** — weekly-cycle state, pending queue counts.
- **Players** — list, add, deactivate / reactivate, edit full name / display name / avatar.
- **Match results** — list approved matches; edit score / MOTM / cards / late-penalty; edit audit trail.
- **Seasons** — create (with roster policy picker), end, archive, restore from archive.
- **Admins** *(super-admin only)* — list admins, promote player → admin, demote admin → player, with audit trail.
- **Scheduled reminders** — list rows in `scheduled_reminders`; enable / disable / edit cron + payload; manual "fire now" button.

### Nice-to-Haves (confirmed for Phase 4)
H2H compare, deep form guide, payment tracking, badges, injury list.

## 4. Approach: 4-Phase MVP (APPROVED, unchanged)
- **Phase 1 — Core Weekly Cycle** *(scope expanded in V2.3)*: self-signup + admin approval; seasons with carry-forward and archive; poll with vote-order + lock + waitlist + +1 slots; captain helper; ref entry link + approval queue; leaderboard + last-5 + player profile; share PNG; admin dashboards; super-admin tier; scheduled reminders with semi-manual WhatsApp auto-post.
- **Phase 2** — Draft & Discipline.
- **Phase 3** — Seasons & Awards; re-evaluate WhatsApp Cloud API.
- **Phase 4** — Extras.

## 5. Open decisions remaining (Phase 2+ blockers unless noted)
*(unchanged from V2.2)*
1. "Repeat dropout" threshold.
2. Snake-draft vs simple alternating.
3. Best Goalie mechanism.
4. Late-cancel point penalty exact number.
5. Phase 2 admin override window after auto-captain-pick.
6. Share PNG: reuse last-5 circle treatment? *(decide in Section 5)*

## 6. Assumptions confirmed (cumulative)
*(all unchanged from V2.2 — see V2.2 for the full list of 5 S002 assumptions)*
**New in V2.3, all accepted by user 2026-04-19:**
- Admin dashboards in scope for Phase 1.
- Super-admin = role on profiles (enum), not a separate table.
- WhatsApp auto-post = Option A (native share sheet) for Phase 1.
- Scheduled reminders stored in DB (not hard-coded in application code), so schedule can be edited without redeploy.

## 7. Next steps
- **S004 resumes Section 2 at Part 4** (notifications · bans · push · app_settings · scheduled_reminders) then **Part 5** (views + SECURITY DEFINER functions + full RLS), then writes Section 2 into the Phase 1 design spec.
- After spec approval → Section 3 full nav + admin dashboards + mockups → Section 4 flows → Section 5 notifications & share → Section 6 open decisions → finalize → `superpowers:writing-plans`.
