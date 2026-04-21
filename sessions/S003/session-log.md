# Session S003 — 2026-04-19 (Home PC)

## Summary
Resumed Phase 1 design walkthrough from the S002 handoff. Section 2 (Data Model) opened and taken through **Parts 1–3 of 5** of full-production DDL. Four architectural decisions locked at the start. A mid-session requirements batch (admin dashboards, super-admin tier, season archive, scheduled WhatsApp-outbound reminders) was added and rolled into the DDL via amendments to Parts 1 & 2 and new tables queued for Part 4. Masterplan bumped **V2.2 → V2.3**. Two durable project memories saved (browser-usage rule, date-format preference). Session closed cleanly; S004 will resume at Part 4.

## What got done
- **Cold-started** via the `anthropic-skills:session-resume` skill. Read `CLAUDE.md`, `sessions/INDEX.md`, `sessions/S002/session-log.md`, `planning/FFC-masterplan-V2.2.md`, Phase 1 design spec, todo.
- **Invoked `superpowers:brainstorming`** with the Visual Companion running at `http://localhost:51677` (persisted to `.superpowers/brainstorm/3642-1776546200/`). Used the visuals for plain-English table cards (Parts 2 & 3), the weekly-cycle timeline, the 17-slot vote-order illustration, and the inter-table ERDs.
- **Scope lock (Q1):** Section 2 depth = **A — full production DDL** (ready-to-paste migration SQL).
- **Architecture locks (4 decisions, batched):**
  1. **Commitment architecture = split.** `poll_votes` (regulars) + `match_guests` (+1s), merged via a view for 14-slot ordering.
  2. **MOTM single source of truth.** Two nullable pointers on `matches` (`motm_user_id` / `motm_guest_id`) with `CHECK (motm_user_id IS NULL OR motm_guest_id IS NULL)`. The S002-flagged `match_guests.is_motm` is removed.
  3. **Pending queues stay separate.** `pending_signups` (onboarding) vs `pending_match_entries` (ref submissions).
  4. **RLS effective roles = 3.** authenticated-player / authenticated-admin / authenticated-super-admin. The anonymous ref path uses a SECURITY DEFINER RPC gated by `ref_tokens`, not a Postgres anon role.
- **Part 1 — Types + Base Entities (approved):** 9 enums (later extended to 10 with `user_role`), plus `profiles`, `pending_signups`, `seasons`, `matchdays`. Partial unique index enforces single-active-season. Matchday cron ordering enforced at DB level.
- **Part 2 — Match Data (approved):** `match_guests`, `matches`, `match_players`. Lifecycle: match row is created at admin team-entry (draft, `is_approved=false`) and flipped to `is_approved=true` on ref-entry approval. Guest-MOTM consolidation landed here.
- **Part 3 — Poll + Ref Workflow (approved):** `poll_votes`, `ref_tokens`, `pending_match_entries`, `pending_match_entry_players`. Sha256-only token storage. Vote-order index `(matchday_id, voted_at ASC, id ASC) WHERE status='active'` on poll_votes; mirror on match_guests. Approval is reconciliation over the existing draft `matches` row, not a copy.
- **Mid-session requirements batch (all approved, user request):**
  - **Admin dashboards** — add/delete/edit players, edit match results (scores, MOTM, cards) post-approval, manage roster, create/end/archive seasons.
  - **Super-admin tier** — promote/demote admins. Implemented as `profiles.role user_role` enum (`player` | `admin` | `super_admin`) replacing `profiles.is_admin boolean`.
  - **Season archive** — `seasons.archived_at timestamptz` with `CHECK (archived_at IS NULL OR ends_on IS NOT NULL)`. Archive hides a season from default queries while retaining all history.
  - **Audit trail for admin edits** — `matches.updated_by` and `match_players.updated_by` (FKs to `profiles`).
  - **Scheduled reminders** — new table `scheduled_reminders` (kind, cron_expression, enabled, target, payload_template, last_fired_at) driven by Supabase `pg_cron`. Admin dashboard screen edits rows. New table `app_settings` (key/value JSON) stores the WhatsApp group link and other runtime config.
  - **WhatsApp auto-post strategy = Option A (native share sheet, semi-manual).** Cron fires → push notification to admins "Tap to share this week's poll link" → native share sheet opens with message pre-filled → admin picks WhatsApp group. Zero Meta Business onboarding in Phase 1. B/C options left as Phase 3 upgrade paths.
- **Amendments applied to Parts 1 & 2 via ALTER statements:** new `user_role` enum, `profiles.role`, `seasons.archived_at` + its CHECK, audit `updated_by` columns on matches + match_players.

## Memories saved (persist across sessions)
- `feedback_browser_companion_usage.md` — Visual Companion browser is for genuine visuals only (mockups, ERDs, side-by-side layouts, etc.). Never duplicate terminal-style A/B/C text into the browser. User feedback after the Q1 scope prompt was pushed both to chat and browser.
- `user_date_format.md` — All user-facing dates render as **DD/MMM/YYYY** (e.g. `04/APR/2026`) via a single shared `formatDate()` helper. DB columns remain `date` / `timestamptz`; API payloads remain ISO 8601. Presentation-layer rule only.

## Parts remaining in Section 2 (for S004)
- **Part 4** — `notifications`, `player_bans`, `push_subscriptions`, `app_settings`, `scheduled_reminders`.
- **Part 5** — views (`v_match_commitments`, leaderboard, last-5 form strip), SECURITY DEFINER functions (ref-submit RPC, leaderboard recompute, admin approval helper, promote/demote admin, create/end/archive season), full RLS policies per table per role.
- **Then:** write Section 2 into `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md`, spec self-review, user approval.
- **Beyond:** Section 3 (Screens & Navigation — full nav + admin-dashboard family + mockups before code), Section 4 (Key Flows), Section 5 (Notifications + Share PNG), Section 6 (Open Decisions handoff).

## Open decisions remaining (unchanged from S002)
1. "Repeat dropout" threshold (Phase 2+)
2. Snake-draft vs simple alternating (Phase 2)
3. Best Goalie mechanism
4. Late-cancel point penalty exact number
5. Phase 2 admin override window
6. Share PNG: reuse last-5 circle treatment? (Section 5)

## Handoff notes for S004
- Visual Companion content persists at `.superpowers/brainstorm/3642-1776546200/`. Server stopped on close. Restart with the start-server script when S004 opens.
- Resume at **Part 4** of Section 2 DDL. Parts 1–3 SQL is in this session's chat transcript plus the persisted visuals (`welcome.html`, `q1-scope-depth.html`, `part2-match-data-visual.html`, `part3-poll-ref-visual.html`).
- `FFC-masterplan-V2.3.md` is now the authoritative masterplan.
- The project memory system (`C:\Users\User\.claude\projects\...\memory\`) has the browser-usage rule and date-format preference — these will auto-apply in S004.
- No git repo yet — OneDrive sync remains the transport.
