# Session S001 — 2026-04-17 (Work PC, UNHOEC03)

## Summary
Project kickoff for FFC (Friends Football Club) — a mobile-first PWA for a 40+ player 7v7 weekly football league. Replaces current Excel + WhatsApp workflow. User asked to apply lessons from PadelHub and The Forge. Session conducted as a structured brainstorming walkthrough using `superpowers:brainstorming`. Session paused at Phase 1 design Section 1 (Architecture) awaiting approval — user wants to continue from home PC in S002.

## What got done
- Loaded PadelHub lessons (`Padel Battle APP/tasks/lessons.md`) for pattern reuse.
- Verified scope: 8-subsystem app, large. Drove toward phased MVP.
- Walked through 8 clarifying-question rounds with user (via `AskUserQuestion`).
- Extracted & verified user's points formula (3/1/0) from the attached Season 11 leaderboard screenshot.
- Captured Discipline & Punctuality rules the user added mid-session.
- Proposed 3 build approaches; user picked Approach A (4-phase MVP).
- Scaffolded workspace folder structure matching PadelHub.
- Drafted `planning/FFC-masterplan-V1.0.md` with every locked decision.
- Started `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` — Section 1 of 6 written, Sections 2–6 placeholders.
- Created `tasks/todo.md`, `tasks/lessons.md`, `sessions/INDEX.md`, `CLAUDE.md`.

## Decisions locked (full list in masterplan V1.0)
- **Stack:** React+Vite PWA + Supabase + Vercel (reuse PadelHub chassis entirely).
- **Auth:** email/password + Google OAuth. Authenticated-only.
- **Poll:** hard lock at 14 + waitlist auto-promotion on cancellation.
- **Cancellations:** point penalty + potential ban (Discipline table).
- **Teams:** fixed names **White** (picks first) vs **Black** (picks last).
- **Draft:** async alternating, snake-style, push-notification driven. → **Phase 2**.
- **Captain selection:** formula TBD by user; MVP default = admin picks.
- **Match entry:** admin enters everything including MOTM.
- **Scoring:** 3 win / 1 draw / 0 loss + late-cancel penalty. Goals/cards/MOTM displayed but don't affect points.
- **Seasons:** admin creates with target matchday count (e.g., 36); auto-close at final matchday → awards.
- **Awards:** Best Player, Golden Boot, Best Goalie. MVP: admin picks at season end.
- **Discipline (kickoff 8:15 PM):**
  - Dropout after lock: −1 pt
  - Dropout <24h or repeat dropout: −1 pt + 1-week ban
  - Late 8:15–8:29: −1 pt + 1-week ban
  - Late 8:30+ or no-show: −2 pts + 2-week ban
- **WhatsApp:** share button + auto-generated PNG result card. No API cost.
- **Notifications:** full package (11 triggers). Per-user prefs = v1.1.
- **Nice-to-haves for Phase 4:** H2H compare, form guide, payment tracking, badges, injury list.

## Approach approved
**Approach A — 4-phase MVP, reuse PadelHub chassis.**
- Phase 1 — Core Weekly Cycle (detailed design in progress)
- Phase 2 — Draft & Discipline
- Phase 3 — Seasons & Awards
- Phase 4 — Extras (H2H, form, payments, badges, injury)

Draft moved from Phase 1 → Phase 2. Phase 1 ships with admin manually entering both teams.

## Open decisions (user to resolve before Phase 2)
1. Captain selection formula
2. "Repeat dropout" threshold (2 in a season? Consecutive? Rolling window?)
3. Snake-draft vs simple-alternate order (both give "Black last")
4. Best Goalie mechanism (MVP: admin-picked; final: stat, vote, or both)
5. Exact late-cancel point penalty value

## Where to pick up in S002 (home PC)
**Continue brainstorming walkthrough** from Phase 1 design Section 2 (Data Model). Remaining sections to present + get approval on:
- Section 2 — Data Model (Postgres tables, RLS, relationships)
- Section 3 — Screens & Navigation (mockup plan, routes, locked nav bar)
- Section 4 — Key Flows (poll, roster lock, match entry, leaderboard recompute)
- Section 5 — Notifications & Share (which trigger fires what, share PNG layout)
- Section 6 — Open Decisions & Phase 2 handoff

Then:
- Finalize `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md`.
- Run spec self-review.
- Ask user to approve written spec.
- Invoke `superpowers:writing-plans` to create Phase 1 implementation plan.

## Handoff notes
- Workspace lives at OneDrive path — will sync to home PC automatically.
- Nothing committed to git yet (no repo created yet — Phase 1 implementation will create `github.com/mmuwahid/FFC`).
- OneDrive sync is the transport for now. Verify presence of `planning/FFC-masterplan-V1.0.md` at home before resuming.
- Memory written to `C:/Users/UNHOEC03/.claude/projects/C--Users-UNHOEC03-OneDrive---United-Engineering-Construction-11---AI---Digital-Works-In-Progress-FFC/memory/` — on home PC, the corresponding memory folder path will differ. Memory will need to be seeded on first cold-start at home (copy/paste from work PC memory, or re-explore briefly).

## Attachments referenced
- User's Season 11 leaderboard screenshot (Matchday 29 of 36) — used to reverse-engineer the 3/1/0 scoring formula. Stored at `FFC/PHOTO-2026-04-14-13-09-59.jpg`.
