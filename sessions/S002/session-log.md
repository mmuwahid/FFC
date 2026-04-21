# Session S002 — 2026-04-18 / 19 (Home PC)

## Summary
Phase 1 brainstorming resumed from the S001 handoff. Six Phase-1 sub-designs locked in three batches. Masterplan revised V1.0 → V2.0 → V2.1 → V2.2. Phase 1 design spec now has six locked sub-sections (3.1–3.6) under Section 3. Sections 2, 4, 5, 6 remain pending. Session closed with user approval of all 5 S002 assumptions and a final concept (vote-order tracking) added as Section 3.6. Next session (S003) will pick up from Section 2 (Data Model).

## What got done
- **Cold-started** on home PC from OneDrive-synced workspace. Read CLAUDE.md, S001 log, todo, lessons, masterplan V1.0, Phase 1 design spec.
- **Captured brand:** logo (`shared/FF_LOGO_FINAL.pdf`) + 4-colour palette (`shared/COLORS.pdf`) now recorded in V2.0 onward. Visual direction = editorial / classic sport crest.
- **Invoked `superpowers:brainstorming`** with the Visual Companion running at `http://localhost:50583`. Pushed three visuals during the session: brand anchor, last-5-style options (A/B/C/D), ref-workflow flow diagram + mockup.
- **Batch 1 decisions (→ V2.0):**
  - Captain selection formula locked (5 criteria + assignment rule). Resolves Open Decision #1.
  - "Who can captain?" admin helper screen (Section 3.1) added to Phase 1.
  - Last-5 form indicator, Option B letter-in-circle (Section 3.2) added to Phase 1.
- **Batch 2 decisions (→ V2.1):**
  - Last-5 scope corrected to per-season (was "rolling across seasons").
  - Multi-season confirmed: one FFC league, many seasons. Roster policy picker on season creation (fresh | carry forward).
  - Self-signup + admin approval + claim-existing-profile flow (Section 3.3) replacing invite-only onboarding.
  - Ref entry link + admin approval queue (Section 3.4) — streamlines paper-to-app handoff. Reviewed via browser mockup.
  - +1 guest mechanic (Section 3.5) — auto-unlock Wed 8:15 PM if poll < 14, any confirmed player can invite.
  - End-of-season awards stay in Phase 3.
  - Phase 4 nice-to-haves all confirmed.
- **Batch 3 decisions (→ V2.2):**
  - Poll vote-order + waitlist priority (Section 3.6). Server-assigned `voted_at` timestamp; confirmed vs waitlist derived by sorted commitments; cancellation triggers promotion; re-vote creates a new row with new timestamp (no position reclaim).
  - All 5 V2.1 assumptions approved by user.
- **Documentation:**
  - `planning/FFC-masterplan-V2.0.md`, `V2.1.md`, `V2.2.md` — all three written; V1.0 preserved per versioning rule.
  - `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` — updated in place with six new sub-sections + expanded Section 2 foreshadowed queries.
  - `tasks/todo.md` — S002 completions recorded, Phase 1 backlog expanded, NEXT SESSION points to Section 2.

## Decisions locked in S002 (full list in V2.2)
1. Captain selection formula (5 criteria, White = weaker, helper-screen behaviour).
2. Last-5 form indicator (per-season, Option B letter-in-circle, on Leaderboard + Player profile).
3. Player self-signup + admin approval + claim-existing-profile.
4. Ref entry link (6h signed URL, no ref account) + admin approval queue.
5. +1 guest mechanic (Wed 8:15 PM auto-unlock, any confirmed player invites, first-commitment-wins).
6. Poll vote ordering + waitlist priority derived by `voted_at` timestamp.
7. Multi-season support with fresh-or-carry-forward roster policy.
8. Brand palette + logo + visual direction locked.

## Assumptions approved by user
- +1 slot collision = first commitment wins.
- Rejected signups → polite email + retry link.
- Guest attribution = inviter's user_id stored on guest row.
- Guests do NOT appear on leaderboard, do NOT earn season points.
- Rejection email copy = polite "not a match for FFC right now, reach out if this is a mistake."

## Open decisions remaining (all Phase 2+ blockers)
1. "Repeat dropout" threshold definition.
2. Snake-draft vs simple alternating order.
3. Best Goalie mechanism (MVP: admin picks).
4. Exact late-cancel point penalty number.
5. Phase 2: admin override window after auto-captain-pick.
6. Share PNG style: does it reuse Section 3.2 last-5 circle treatment? (Decide in Section 5.)

## Where to pick up in S003
Continue the brainstorming walkthrough from **Phase 1 design Section 2 — Data Model**. Remaining work:
- Section 2 — Data Model (all tables, RLS, indexes, consolidating the guest-MOTM dual-storage flag).
- Section 3 — Full nav + remaining screen list (sub-sections 3.1–3.6 already locked).
- Section 4 — Key Flows (end-to-end walkthrough from Monday poll open to Friday leaderboard).
- Section 5 — Notifications & Share (map 13 triggers, PNG layout, decide on last-5 treatment reuse).
- Section 6 — Open Decisions & Phase 2 handoff.
- Then: finalize spec, spec self-review, user approval, invoke `superpowers:writing-plans`.

## Handoff notes
- Workspace on OneDrive; home PC resumed cleanly. No git repo yet — OneDrive sync is the transport.
- Brainstorm Visual Companion server ran at `http://localhost:50583` during the session. Mockup content persisted in `.superpowers/brainstorm/` (survives restart). Reminder: add `.superpowers/` to `.gitignore` when the repo is created.
- Three visuals produced this session (`brand-anchor.html`, `last5-styles.html`, `ref-workflow.html`) persist in that folder for reference.
- When S003 opens a new window, the anthropic-skills:session-resume skill plus this log + the FFC `CLAUDE.md` + `tasks/todo.md` NEXT SESSION block will cold-start the context cleanly.

## Attachments referenced
- `shared/FF_LOGO_FINAL.pdf` — FFC crest (shield, laurel, FF monogram, three stars).
- `shared/COLORS.pdf` — 4-colour palette (black, white, champagne gold, bone).
- `shared/PHOTO-2026-04-18-09-28-04.jpg` — logo photo reference.
- User's S001 Season 11 leaderboard screenshot remains at `FFC/PHOTO-2026-04-14-13-09-59.jpg`.
