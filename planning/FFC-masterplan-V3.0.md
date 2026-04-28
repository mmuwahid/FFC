# FFC Masterplan V3.0 — Phase 2

**Status:** Phase 2 brainstorming approved 26/APR/2026 (S039). Two-track scope locked. Phase 1 fully shipped and operational on https://ffc-gilt.vercel.app at Season 11 match 33/40.

**Authoritative inputs:**
- Phase 1 masterplan: `planning/FFC-masterplan-V2.8.md` (consolidation of V2.0–V2.7)
- Phase 1 design spec: `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` (§3.4 ref-entry spec lives here — V3 enhancement layered on top)
- Phase 2 detailed spec: `docs/superpowers/specs/2026-04-26-phase2-design.md` (this masterplan's twin — covers both Track 2A and 2B in implementation depth)

**Operational frame.** Season 11 has 7 games left when Phase 2 build begins (~late April → end of season ≈ mid-June 2026). Phase 2 must not destabilise the live weekly cycle. Every track ships behind feature flags or as additive surfaces, never replacing what works today. Acceptance is run on real Thursday matchdays — not synthetic test runs.

---

## Phase 2 scope — two tracks

### Track 2A — Poll → Lock → Captain automation

**Pain solved:** weekly admin nag-cycle. Today the admin manually chases votes in WhatsApp, manually locks the roster, manually picks captains, and manually handles dropouts. Track 2A removes all four manual steps.

**Components (bundle — ship together):**

1. **Push notification delivery wired end-to-end.**
   - Settings UI + `profiles.push_prefs` jsonb already shipped in S024 (master + 6 child pills covering 6 notification kinds: poll_open · vote_reminder · roster_locked · teams_posted · result_posted · motm_announced).
   - Backend already inserts to `notifications` table on every relevant event.
   - **Phase 2A wires the actual delivery layer** — Web Push (VAPID) + service worker subscription + a `notify-dispatch` Edge Function that reads new `notifications` rows (or is triggered via Postgres webhook) and calls each subscribed endpoint.
   - Includes an unsubscribe / re-subscribe lifecycle when `Notification.permission` toggles.

2. **Vote-reminder schedule.** Three pushes to non-voters: T-24 h, T-3 h, T-15 min before lock. Re-targets only `poll_votes` rows where `vote IS NULL`. Configurable in `app_settings`.

3. **Auto-lock at deadline.** A pg_cron job (or Edge Function on a cron trigger) runs at the configured lock time, calls a new `auto_lock_matchday(matchday_id)` RPC. Fires `roster_locked` notification with payload `{your_status: 'confirmed' | 'waitlist', position: N}`. Admin gets an `admin_lock_complete` push.

4. **Captain auto-pick on lock.** Currently the admin opens `/matchday/:id/captains` and picks. After auto-lock, the same job calls `pick_captains_random(matchday_id)` (already exists, used by the Helper screen's Roll mode) OR `suggest_captain_pairs(matchday_id)[0]` and writes the result via `set_matchday_captains`. Admin gets a notification: *"Captains auto-picked: White=Mohammed, Black=Ahmed. Tap to override."* Tapping opens Captain Helper for one-tap reroll. Toggle in `app_settings.auto_pick_captains` (default ON).

5. **Dropout-after-lock real-time flow.** When a confirmed player taps **Cancel** after `roster_locked_at` is set:
   - `cancel_my_vote` RPC inserts a `dropout_after_lock` notification kind (must be added to enum) targeted to admins + both captains.
   - Captain Helper screen subscribes to this notification kind and surfaces a dropout banner: *"Mohammed cancelled. Promote from waitlist?"* with one-tap promote → `promote_from_waitlist` RPC (needs to be written) → fills slot from top of waitlist → fires `you_are_in` push to promoted player.
   - If the dropout was a **captain**, the existing `accept_substitute` / `request_reroll` flow (S037) takes over — already wired, just needs the new notification kind to fire correctly.

**Migration delta:** `0028_phase2a_automation.sql` — adds `dropout_after_lock` to `notification_kind` enum, `auto_lock_matchday` + `promote_from_waitlist` RPCs, `app_settings.auto_pick_captains` row, pg_cron job for auto-lock + reminder schedule.

**No mockup needed.** Track 2A is invisible automation — UX surfaces (Captain Helper banner, push notifications) extend existing screens.

---

### Track 2B — Live Match Console (§3.4-v2)

**Pain solved:** post-match transcription from paper. Today the ref writes scores on paper, the admin (Mohammed) later types every player's goals/cards/MOTM into AdminMatches. Phase 2B replaces the paper with a phone-native console the ref runs LIVE during the match.

**Why §3.4-v2 not §3.4-v1.** V1 was specced in S002 (`docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` §3.4) but never implemented. `RefEntry.tsx` is a one-line stub today. V2 keeps the V1 token-based architecture (anonymous link, no ref account, 6 h expiry, single-matchday scope) and adds:

- **Live match clock** with 1st half / break / 2nd half progression. Timing configurable per format.
- **Pause/Resume** for fouls/injuries → automatic stoppage time accumulation.
- **Time-stamped goal/card events** captured at the moment the ref taps, persisted in a new `pending_match_events` table.
- **Three-mode UX** on a single URL: pre-match → live → post-match summary.

**Authoritative spec:** §3.4-v2 detailed design lives in `docs/superpowers/specs/2026-04-26-phase2-design.md` §B (this masterplan's twin doc). Mockup at `mockups/3-4-v2-ref-console.html`.

**Migration delta:** `0029_phase2b_match_events.sql` — new `pending_match_events` table (event_type · match_minute · participant_id · team · recorded_at), `pending_match_entries` extension (kickoff_at · halftime_at · fulltime_at · stoppage_h1_seconds · stoppage_h2_seconds — all nullable for back-compat), `submit_ref_entry` RPC extended to accept the event log payload, new `regenerate_ref_token(matchday_id)` admin RPC.

**Promotion semantics.** `approve_match_entry` (already exists) extends to also copy event log into a new `match_events` table on promotion. Goal events become `match_players.goals++` aggregated; the event log is preserved for postmortem stats (e.g. Profile screen "all 5 of Mohammed's goals were 2nd half").

---

## Out of Phase 2 scope

| Item | Status | Why deferred |
|---|---|---|
| Photo-OCR backup for ref entry | Considered, rejected by user | Not needed once live console is in ref's hand |
| Email notification on signup approve/reject | Backlog | Push covers signed-in users; email needed for not-yet-onboarded; deferred to Phase 3 |
| Season-end awards / Ballon d'Or page | Backlog | Will land for Season 12 launch, not mid-S11 |
| WhatsApp share PNG of result | Backlog | Existing share-as-text works for now |
| Wide-viewport Formation two-column | Phase 1 deferred | Mobile-first stays |
| Real SMS for ref tokens | Phase 1 stub | WhatsApp/manual share works for the league's small ref pool; SMS gateway cost not justified |

---

## Build sequencing

**Order: 2B first, then 2A.** Reasoning:

- **2B is concrete and self-contained** — single new screen, single new admin review surface, well-defined data shape. One contiguous build.
- **2A is infrastructure-heavy** — Web Push subscription dance, service worker delivery, pg_cron jobs, multiple RPCs. Each piece can land independently and start delivering value (e.g. push delivery first → reminders next → auto-lock next → auto-pick last).
- Shipping 2B first means the ref console gets soak-tested across multiple Thursday matchdays before Phase 2 closes, which is where bugs will surface.

**Slice plan (each slice ends with a Vercel deploy + a real-matchday acceptance pass):**

| Slice | Track | Deliverable |
|---|---|---|
| **2B-A** | 2B | Backend: migration 0029 + `submit_ref_entry` extension + `regenerate_ref_token` RPC + types regen. No UI yet. |
| **2B-B** | 2B | Admin "Generate ref link" button on `/admin/matches` matchday card → token URL → copy-to-clipboard + WhatsApp share intent. Token-regeneration UI. |
| **2B-C** | 2B | RefEntry pre-match mode: rosters confirmation + KICK OFF button + screen-wake lock. |
| **2B-D** | 2B | RefEntry live mode: clock + score + scorer picker + pause/resume + cards. Client-side timer. |
| **2B-E** | 2B | RefEntry post-match mode: event log review + edit affordances + SUBMIT TO ADMIN. |
| **2B-F** | 2B | Admin review screen `/admin/match-entries/:id` — pre-fills the existing approve flow with submitted data. Approve promotes pending → matches + match_events. |
| **2A-A** | 2A | Migration 0028 (enum + RPCs + settings rows + cron jobs). No UI. |
| **2A-B** | 2A | Web Push subscription dance: VAPID keys in Edge Function env, service-worker subscribe on Settings master-toggle ON, persist subscription server-side. |
| **2A-C** | 2A | `notify-dispatch` Edge Function reading `notifications` table → push fan-out. Wire to existing notification inserts. |
| **2A-D** | 2A | Auto-lock job + dropout-after-lock notification + Captain Helper banner. |
| **2A-E** | 2A | Captain auto-pick on lock + admin override surface. |

**Estimate.** ~6–10 sessions for 2B (one slice per session, sometimes two). ~5–7 sessions for 2A. Phase 2 close ≈ S045–S050.

---

## Risks + open decisions

| Risk | Mitigation |
|---|---|
| **Web Push browser support on iOS** — iOS Safari Web Push requires PWA install (Add to Home Screen). | Already documented in S038; Apple touch icon shipped. Add an in-app prompt for non-installed users when they enable push. |
| **Service worker push delivery on iOS PWA backgrounded** — historically flaky. | Provide a fallback: if push silent for >2 min, surface in-app toast on next foreground. |
| **Live match clock drift** when phone backgrounds (WhatsApp, calls). | Use `performance.now()` + persisted start-timestamp in `localStorage`; recompute on visibilitychange. Survives backgrounding. |
| **Network drops at the venue** during live match. | Client-side state is authoritative; events queue locally; submit on reconnect. Token validity 6 h is enough buffer. |
| **Admin auto-pick override window** — what if admin doesn't see the auto-pick notification in time? | One-tap reroll from the Captain Helper banner is always available pre-kickoff. After kickoff the auto-pick is committed and the existing reroll flow handles dropouts. |
| **`pg_cron` availability on Supabase free tier** — supported but limited. | Free tier supports it; if limits hit, fall back to Vercel cron + Edge Function trigger. |

---

## Acceptance criteria for Phase 2 close

Phase 2 is "done" when, on a single Season-11 Thursday matchday:

- [ ] No vote-chasing in WhatsApp — push reminders alone cover non-voters.
- [ ] Roster locks itself at the deadline; players get push immediately.
- [ ] Captain pair is auto-set on lock; admin gets a notification with one-tap override.
- [ ] If a confirmed player drops after lock, the captains see a banner and one-tap promote works.
- [ ] The ref runs the entire match on the console — no paper.
- [ ] Goals / cards / MOTM are time-stamped at the moment of capture.
- [ ] After full-time, ref taps SUBMIT and the admin gets a push within 30 seconds.
- [ ] Admin opens the review screen, verifies, taps APPROVE — leaderboard updates without a single field of manual entry.

When all 8 boxes tick on a real matchday, Phase 2 is closed and Phase 3 planning opens.

---

## Phase 3 (post-Phase-2, no commitment yet)

Things on the radar but not committed:

- Season-end awards page (Ballon d'Or, Golden Boot, Wall of Fame) — for Season 12 launch.
- WhatsApp share PNG generator (server-side render of result card).
- Email notification for unconfirmed signups (complements push).
- Photo-OCR fallback (only if live console proves unreliable).
- Multi-season comparison stats.
- Match highlights / video clip attachments.
- **Player analytics page** — per-player deep stats (form curve, goal/MOTM/card trends, win-rate by partner/opponent, streaks). Originally scoped under "Phase 4 — Extras" in V1.0–V2.4; restored 28/APR/2026 (S050 prep) after user flagged it had dropped out of V2.5+ consolidation.
- **Head-to-head (H2H) comparison** — pick two players, surface side-by-side career stats and direct match-up record (games shared a side, games on opposing sides, win-rate when together vs apart, goal differentials). Same provenance as player analytics; restored 28/APR/2026.

---

## Close-out

V3.0 is the Phase 2 commit point. Detailed UX + DDL + RPC contracts live in `docs/superpowers/specs/2026-04-26-phase2-design.md`. Implementation plans for each slice land via the writing-plans skill once V3.0 + design spec are user-approved.
