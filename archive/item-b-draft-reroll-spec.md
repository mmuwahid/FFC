# Item B — Draft Visibility + Captain Reroll Spec Amendments

**Session:** S009 · **Date:** 20/APR/2026 · **Status:** DRAFT (scratch, awaiting integration)
**Targets:** design spec `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` §3.7, §3.18 · masterplan V2.7 (queued bump)
**Scope:** Two user-surfaced feature additions — (A) live captain draft visibility, (B) post-lock dropout with captain reroll right.

---

## Amendment 1 — §3.7 State 6.5 "Draft in progress" (NEW)

**Insertion point:** Between existing State 6 (Roster locked) and State 8 (Teams revealed) in the §3.7 "Nine key states" table. Renumber header from "Seven key states" → "Nine key states" (States 6.5 and — see Amendment 2 — 8.5 both new). Existing states 7 and 8 keep their numbers; the new state takes the `.5` slot rather than reflowing the table, because State 7 (Penalty sheet) is conceptually a modal-overlay state rather than a linear progression step.

### Status
DRAFT (S009) — awaiting masterplan V2.7 data-model approval before spec promotion to APPROVED.

### Purpose
Give every logged-in player live visibility into the captain team-selection process between roster-lock and teams-revealed. The draft can take hours across two captains picking in turn; players should see which team they are on as soon as their name is picked rather than waiting for the admin to post a finished roster. Also eliminates the current "dead air" period where the Poll screen shows state 6 unchanged while captains are actively deciding teams off-screen.

### Trigger
- Admin finishes §3.1-v2 Captain helper "Pick captains" flow → clicks **Start draft** on the captain-pair confirmation sheet.
- App creates one row in `draft_sessions` with `status='in_progress'`, `current_picker_team='white'` (White picks first by convention; first-pick team is configurable per matchday via admin override in §3.18 — default White).
- `matchday.phase` advances from `roster_locked` to `draft_in_progress`.
- All logged-in players' Poll screens transition to State 6.5 via realtime subscription within 2s.

### Data read
- `draft_sessions` row (single row per matchday): `id`, `status`, `current_picker_team`, `started_at`.
- `draft_picks` rows (1–N per session, appended as picks happen): `pick_order`, `team`, `profile_id` OR `guest_id`, `picked_at`.
- `match_commitments` roster (same as State 6) — used to derive the "Available" list = `commitments − picks`.
- `matchday_captains` view (from §3.1-v2) — used for captain names in the vote-status card.

### Data write (from this screen)
None from non-captain viewers. Captains write via §3.1-v2 captain-draft screen (not the Poll screen) — this Poll state is read-only for everyone.

### Layout (additions to existing §3.7 layout)

**VOTE STATUS CARD (replaces State 6 card content):**
```
┌──────────────────────────────────────────┐
│ Draft in progress                        │
│ Waiting for [Captain name] to pick · ⚪  │
│ 6 of 14 picked                           │
└──────────────────────────────────────────┘
```
- Line 1: static title.
- Line 2: current picker's display name + team colour circle (⚪ White / ⚫ Black).
- Line 3: pick counter `[n] of 14 picked` (14 = 7 per side excluding captains; guests count as 1 pick each).
- No team pill for the caller yet — team assignment pill only renders once the caller's own row has been picked.
- Once the caller IS picked, line 2 swaps to `You're on ⚪ White / ⚫ Black` (same pattern as State 8 per S008 §3.7 Option A) and the counter continues.

**COMMITMENT LIST SECTIONS (three sections, ordered top-to-bottom):**

1. **⚪ WHITE** section header — pulses (`@keyframes draftPickPulse` · 1.5s ease · opacity 0.6→1.0) when `current_picker_team='white'`.
   - Rows: all players picked to White, in pick order. Grey `[W]` pill right-aligned.
   - Empty state: section header still renders; list body shows `—`.

2. **⚫ BLACK** section header — pulses when `current_picker_team='black'`.
   - Same row contract as White.

3. **Available** section header — static (no pulse).
   - Rows: everyone in the commitment list minus captains minus picked players.
   - Right-aligned subtle indicator: `…waiting` (muted, 13px, `color-text-secondary`).
   - Guests render with existing §3.5/§3.7 guest-row contract (3-line layout from S007).

**CTA stack during draft** (same as State 6):
- `[Cancel — see penalty]` danger (opens §3.7 State 7 penalty sheet)
- `[View Matchday]` ghost (opens §3.15 match-detail)
- Captain-specific `[Make pick]` button is NOT shown here — captains navigate via §3.1-v2 captain-draft screen instead. Poll screen stays a viewer surface for all roles.

### Rendering contract
- Picked-player row transition: `translateY(-4px)` + fade 200ms when moved from Available → WHITE/BLACK section. Respect `prefers-reduced-motion` (skip transform, keep fade).
- Pulse animation on active team header: disabled under `prefers-reduced-motion`; fall back to a static `• picking now` dot left of the header label.
- Realtime: Supabase Realtime channel on `public:draft_picks:draft_session_id=eq.{id}` (INSERT events) + `public:draft_sessions:id=eq.{id}` (UPDATE events on `current_picker_team`, `status`). Client must debounce re-renders at 150ms to batch rapid picks.
- Caller's own row gets a subtle left border accent (`border-left: 3px solid var(--color-accent)`) in whichever section it currently sits (Available or its assigned team).
- Guest rows are pickable but cannot be captains (§3.1-v2 rule persists).
- Disconnect/reconnect: on realtime reconnect, re-fetch full `draft_picks` list to reconcile any missed events before resuming live updates.

### Acceptance criteria
1. When admin starts the draft, all logged-in players' Poll screens transition from State 6 to State 6.5 within 2 seconds of the `draft_sessions` INSERT.
2. Each new `draft_picks` INSERT moves the correct player from Available → the correct team section on all connected clients within 2 seconds, with the pulse animation switching to the opposite team header when `current_picker_team` flips.
3. Pick counter `[n] of 14 picked` increments correctly on every pick and never decrements (picks are append-only; corrections require admin via §3.18 — out of scope for Phase 1 draft UI).
4. The caller's own team pill appears in the vote-status card the instant their name is picked (no manual refresh), and the row gains its team pill `[W]` / `[B]` simultaneously.
5. If the caller's connection drops during the draft and reconnects, the screen reconciles with the true draft state on reconnect — no ghost rows, no duplicate picks, no missed section assignments.
6. `prefers-reduced-motion` disables the pulse animation and the row-transition transform; fade remains.
7. A completed draft (`draft_sessions.status='completed'`) transitions every connected client from State 6.5 to State 8 "Teams revealed" within 2 seconds.
8. A cancelled/abandoned draft (`status='abandoned'`) reverts every connected client to State 6 "Roster locked"; no stale section assignments persist.

### Error states
- **Realtime subscription fails to attach:** show inline banner `Live updates unavailable — pull down to refresh`. Provide pull-to-refresh that re-fetches the full session + picks.
- **`draft_sessions` row deleted mid-draft** (e.g. admin abandoned from §3.18): revert to State 6 with a toast `Captains restarted team selection`.
- **Pick arrives for a `profile_id`/`guest_id` not in the commitment list** (should be impossible via RLS, but guard client-side): ignore the pick and log a client-side warning; do not crash the section render.

### Edge cases
- **Captain disconnects mid-draft:** no automatic action from this screen. The other captain's §3.1-v2 view owns the "waiting for opponent" UX. Poll screen simply keeps showing "Waiting for [disconnected captain] to pick" — the admin resolution is via §3.18 "Force complete draft / abandon".
- **Tied pick count scenario (7–7 with one guest unpicked):** final pick is forced by whichever team's `current_picker_team` is active; pick counter reads `14 of 14 picked` and state auto-transitions to State 8.
- **All-members-picked-before-guests:** no special handling — guests appear in Available just like members, get picked in normal pick order, and follow the same row contract.
- **Player drops out during draft** (rare — State 6 → State 6.5 → dropout): player row vanishes from Available (or from their assigned team if already picked). If already picked, captains get a §3.1-v2 "Pick replacement from waitlist" prompt. Poll screen reflects the change live.

### Phase-2 deferred
- Captain "undo last pick" within a 10-second grace window — pick ordering stays append-only in Phase 1.
- Draft chat / banter thread — out of scope.
- Pick-time analytics (average seconds per pick) — telemetry only, no UI.
- Snake-order draft variants — fixed White-first alternating in Phase 1.

---

## Amendment 2 — §3.7 Post-lock substitution with captain reroll (NEW sub-section)

**Insertion point:** Appends as a new sub-section at the end of §3.7, after the current "Phase-2 deferred" block. Header it `### Post-lock substitution with captain reroll right` under a new H3 inside §3.7.

**Interacts with State 8** (Teams revealed) — treat as behaviour overlay on State 8 rather than a numbered state on its own; if a state number is required for the table, insert as State 8.5 · Post-lock substitute pending captain response.

### Status
DRAFT (S009) — net-new behaviour. Replaces the implicit Phase-1 assumption that "waitlist auto-promote ends the dropout flow". User feedback (S009 framing): auto-promote can unbalance teams; the losing-side captain should have a reroll option.

### Purpose
Preserve team competitive balance when a player cancels within the 24h post-lock window. Give the captain whose team lost the player a unilateral right to either (a) accept the waitlist-promoted substitute and keep teams as-is, or (b) trigger a full reroll of non-captain slots. The opposing captain cannot veto the reroll — this is a deliberate asymmetry favouring the losing side, on the principle that the dropout was not their fault and they should not be further penalised by a worse substitute.

### Trigger
- Player X (on team T, not a captain) taps `[Cancel — see penalty]` from State 8 → confirms cancellation within the 24h post-lock window per §3.7 State 7 penalty sheet.
- Backend applies §3.7 State 7 penalty to X.
- `promote_from_waitlist(matchday_id, departing_profile_id=X)` RPC runs — auto-promotes the first waitlisted player Y (earliest `commitment_time` on waitlist) into the roster and assigns Y to team T with `match_players.substituted_in_by = X.profile_id` for audit.
- Notification `dropout_after_lock` is sent to the captain of team T (push + in-app).

### Data read
- `match_players` roster after promotion (includes Y, excludes X).
- `matchday_captains.{team}_captain_profile_id` — to route the modal to the correct captain.
- `draft_sessions` latest row for the matchday — to check whether a prior reroll session is already open (guard against double-trigger).
- `matchday.kickoff_at` — to compute whether the 12h-before-kickoff reroll window is still open.

### Data write
- On `[Accept substitute]`: no writes beyond dismissing the modal and marking the notification read.
- On `[Request reroll]`: calls `request_reroll(matchday_id)` which:
  - Creates a new `draft_sessions` row with `reason='reroll_after_dropout'` · `triggered_by_profile_id=<captain's profile_id>` · `status='in_progress'` · `current_picker_team` defaulting to the losing-side team (captain who triggered the reroll picks first as partial compensation).
  - Clears all non-captain `match_players.team` assignments for the matchday (sets to NULL), preserving the captain-to-team assignment from the original draft.
  - Broadcasts a `draft_reroll_started` notification to all 16 roster players (14 non-captains + 2 captains).
  - Sends a passive `reroll_triggered_by_opponent` notification to the non-losing-side captain (no action button — informational).

### Layout (modal shown to losing-side captain on next app open after `dropout_after_lock`)

```
┌───────────────────────────────────────┐
│ Team ⚪ White lost a player           │
│                                       │
│ Mohammed dropped out.                 │
│ Ahmed has been promoted from the      │
│ waitlist to take his spot.            │
│                                       │
│ You can accept the substitute, or     │
│ request a reroll of team selection    │
│ (excluding captains).                 │
│                                       │
│ Reroll window closes in 8h 42m        │
│ (12h before kickoff).                 │
│                                       │
│  [ Accept substitute ]  ← primary    │
│  [ Request reroll ]     ← warn amber │
└───────────────────────────────────────┘
```
- Title uses the losing-side team colour and icon.
- Body line 1–2 names the departed and replacement players (no profile chips — plain text for modal compactness).
- Reroll countdown uses `Xh YYm` format; when <1h, switches to `XXm`; when closed, replaces both buttons with a single `[Acknowledge]` button (substitute auto-accepted).
- Modal is non-dismissible (no scrim-tap to close, no close-X) until captain picks an action — forces a decision.
- If captain leaves the app without deciding, modal reappears on next app open until window closes or a choice is made.

### Rendering contract
- Modal size: 320w × auto-h, centred, scrim `rgba(0,0,0,0.6)`.
- `[Accept substitute]` primary green (`--color-success`), `[Request reroll]` warn amber (`--color-warn`).
- Countdown updates every 60s while modal is open.
- Reroll confirmation sub-modal (when captain taps `[Request reroll]`):
  ```
  Trigger full team reroll?

  All 14 non-captain slots will be redrawn.
  Both captains and all roster players will
  be notified. This cannot be undone.

  [ Cancel ]   [ Yes, reroll ]
  ```

### Acceptance criteria
1. When player X cancels within the 24h post-lock window, the losing-side captain receives a push notification within 30 seconds and an in-app modal on next app open within 5 seconds of opening.
2. `[Accept substitute]` dismisses the modal, marks the notification read, and makes no further writes — teams remain with Y replacing X.
3. `[Request reroll]` triggers the confirmation sub-modal; confirming creates a new `draft_sessions` row with `reason='reroll_after_dropout'` and broadcasts notifications to all 16 roster players within 5 seconds.
4. All logged-in roster players' Poll screens transition from State 8 back to State 6.5 within 2 seconds of the reroll session starting (reusing Amendment 1 live-draft UI).
5. If the captain does not respond before the 12h-before-kickoff cutoff, the substitute is auto-accepted — modal replaced with an `[Acknowledge]` button, no reroll possible, teams remain with Y.
6. Only the losing-side captain sees the action modal. The opposing captain gets a passive informational notification only (no buttons, no modal) when a reroll is triggered.
7. Captains cannot be reassigned by a reroll — the two `matchday_captains` rows are preserved; only non-captain `match_players.team` values are cleared and re-drawn.
8. A matchday can have at most one `draft_sessions` row with `status='in_progress'` at any time — a second dropout while a reroll is active does NOT trigger a second reroll modal; instead, the second replacement is quietly added to the in-progress session's Available pool and the losing-side captain of the second dropout gets an informational-only toast.

### Error states
- **`promote_from_waitlist` finds no waitlisted player:** roster goes to 13 players. Modal still fires to losing-side captain but body becomes `Mohammed dropped out. No waitlist substitute available — your team is playing a man down.` Buttons remain `[Accept (play short)]` / `[Request reroll]`. Reroll in this case redraws from the 13 remaining non-captains.
- **Reroll RPC fails mid-write** (new `draft_sessions` created but team assignments not cleared): client shows toast `Reroll could not start — try again` and deletes the orphan session server-side via trigger. Captain can retry.
- **12h window elapses while modal is open:** buttons replaced in-place with `[Acknowledge]`; no abrupt modal close.

### Edge cases
- **Captain IS the dropout:** `dropout_after_lock` is NOT sent to anyone as an actionable modal. Instead, admin is notified via `captain_dropout_needs_replacement` (new notification, flagged for V2.7 but orthogonal to this feature) and must pick a new captain via §3.1-v2. No reroll right applies — new captain + full new draft starts automatically.
- **Two dropouts in the same matchday before first reroll resolves:** first dropout's captain-modal wins the reroll right. Second dropout's captain gets an informational toast `A reroll is already in progress — your substitute has joined the draft pool`. No second modal, no second reroll right.
- **Two dropouts in same matchday AFTER first reroll completes:** second dropout triggers its own `dropout_after_lock` modal to that team's captain as normal — reroll right is per-dropout, not per-matchday.
- **Reroll triggered inside 12h window by admin override** (§3.18 force action): captain's modal is pre-empted; admin-initiated reroll bypasses captain consent. Rare — audit trail captured via `draft_sessions.triggered_by_profile_id = admin.profile_id`.
- **Reroll produces identical team assignments** (statistically unlikely but possible with small rosters): allowed — no re-draw required. Captain who triggered the reroll bears the social cost of the optically wasted action. No "different assignments" guarantee attempted in Phase 1.

### Phase-2 deferred
- Player-initiated "ask captain for reroll" flow — Phase 1 reroll is captain-unilateral.
- Reroll voting (both captains + admin majority) — Phase 1 is captain-unilateral per the rule.
- Multiple-round reroll history with diff view — Phase 1 keeps only the latest draft state; prior draft_sessions rows stay in DB as audit records but aren't user-facing.
- Partial reroll (redraw only one team, keep the other) — Phase 1 redraws all 14 non-captain slots as a single atomic operation.

---

## Amendment 3 — §3.18 Admin Matches touch-up

**Insertion point:** §3.18 Admin Matches "this week card" section. Brief addition — not a full re-spec.

### Status
DRAFT (S009) — informational stub for §3.18 when that section is drafted in a later S-session. Flagged so the admin surface owner doesn't forget the draft-session handle.

### Changes
- **Phases ladder addition:** Add `Phase 5.5 · Draft in progress` between existing Phase 5 (Roster locked) and Phase 6 (Teams revealed) in the §3.18 this-week-card phase badges. Visual: amber dot + label, matches existing ladder styling.
- **Draft-session state surfacing:** "This week" card shows the current draft session's pick progress when active:
  ```
  Phase 5.5 · Draft in progress
  Pick 6 of 14 · White picking · Mohammed
  Started 1h 22m ago
  ```
- **Admin action — "Force complete draft / abandon":** Exposed on the this-week card when a `draft_sessions` row has been in `status='in_progress'` for more than 6 hours (configurable threshold via `app_settings.draft_stuck_threshold_hours`). Two sub-actions:
  - `[Force complete]` — sets `status='completed'` using whatever picks exist; unpicked players are auto-distributed to balance team counts (round-robin by commitment order). Logs `admin_draft_force_completed` event.
  - `[Abandon draft]` — sets `status='abandoned'`; matchday reverts to phase `roster_locked`; captains must restart via §3.1-v2. Logs `admin_draft_abandoned` event.
- **Reroll audit visibility:** When the active `draft_sessions` row has `reason='reroll_after_dropout'`, the card shows an amber warning row: `Reroll triggered by [Captain X] at [DD/MMM/YYYY HH:MM] following [Player Y] dropout`.

### Phase-2 deferred
Full §3.18 Admin Matches Depth-B spec with complete layout, data contracts, and acceptance criteria — to be authored in a dedicated S-session. This amendment captures only the draft-session-specific touch-points so nothing is lost between now and then.

---

## Amendment 4 — Data model changes for masterplan V2.7

Consolidated list of all database and API additions required to support Amendments 1–3. Flag for masterplan V2.7 bump.

### New tables

**`draft_sessions`**
| column | type | notes |
|---|---|---|
| id | uuid PK | default `gen_random_uuid()` |
| matchday_id | uuid FK → matchdays | not null · unique partial index where `status='in_progress'` (one active session per matchday) |
| status | draft_status enum | not null · default `'in_progress'` |
| current_picker_team | team_color enum | not null · default `'white'` |
| reason | draft_reason enum | not null · default `'initial'` |
| triggered_by_profile_id | uuid FK → profiles | nullable (null for admin-triggered; populated for captain reroll) |
| started_at | timestamptz | not null · default `now()` |
| completed_at | timestamptz | nullable |

**`draft_picks`**
| column | type | notes |
|---|---|---|
| id | uuid PK | default `gen_random_uuid()` |
| draft_session_id | uuid FK → draft_sessions | not null |
| pick_order | int | not null · unique per `draft_session_id` |
| team | team_color enum | not null |
| profile_id | uuid FK → profiles | nullable · mutually exclusive with `guest_id` via CHECK |
| guest_id | uuid FK → match_guests | nullable · mutually exclusive with `profile_id` via CHECK |
| picked_at | timestamptz | not null · default `now()` |

CHECK: `(profile_id IS NOT NULL AND guest_id IS NULL) OR (profile_id IS NULL AND guest_id IS NOT NULL)`

### New columns on existing tables

- **`match_players.substituted_in_by`** — `uuid FK → profiles` nullable · points to the profile_id of the player this row replaced. Populated by `promote_from_waitlist`. Audit-only; no UI in Phase 1.

### New enums

- **`draft_status`** — `'in_progress' | 'completed' | 'abandoned'`
- **`draft_reason`** — `'initial' | 'reroll_after_dropout'`
- **`team_color`** — `'white' | 'black'` (if not already defined in §2.1 — verify; likely already exists from team-pill work in §3.7 S007/S008. Add only if missing.)

### New notification types (added to `notification_type` enum + push templates + `app_settings` push-prefs toggles)

- **`dropout_after_lock`** — sent to losing-side captain · actionable (opens modal) · push title `Team {color} lost a player` · push body `{Departed} dropped out. {Replacement} promoted from waitlist.`
- **`draft_reroll_started`** — sent to all 16 roster players · informational · push title `Team selection is being redone` · push body `{Captain} requested a reroll. A new draft is starting.`
- **`reroll_triggered_by_opponent`** — sent to non-losing-side captain · informational passive · push title `Opposing captain triggered a reroll` · push body `{OtherCaptain} called a reroll after {Departed}'s dropout.`
- **`captain_dropout_needs_replacement`** — sent to admin only · orthogonal to main feature but flagged in V2.7 since it's surfaced by the captain-is-the-dropout edge case · push title `Captain dropout — action needed` · push body `{Captain} dropped out of {date} matchday. Pick a replacement captain.`

### New RPCs (§2.7 additions)

- **`promote_from_waitlist(matchday_id uuid, departing_profile_id uuid) returns uuid`** — atomically removes departing player's `match_players` row, promotes first waitlisted player to `match_players` with correct team assignment, sets `substituted_in_by`, and returns the promoted player's `profile_id`. Idempotent-safe: no-op if departing player already absent.
- **`accept_substitute(matchday_id uuid) returns void`** — marks the `dropout_after_lock` notification as actioned with outcome `accepted`; no roster writes (substitute already in place from the earlier `promote_from_waitlist` call).
- **`request_reroll(matchday_id uuid) returns uuid`** — authorises caller is the losing-side captain (RLS check), creates new `draft_sessions` row with `reason='reroll_after_dropout'`, clears non-captain `match_players.team` values for the matchday, fires `draft_reroll_started` + `reroll_triggered_by_opponent` notifications, returns the new `draft_session_id`. Fails if a session with `status='in_progress'` already exists for the matchday.
- **`submit_draft_pick(draft_session_id uuid, profile_id uuid, guest_id uuid) returns draft_picks`** — authorises caller is the `current_picker_team` captain, inserts a `draft_picks` row with next `pick_order`, flips `draft_sessions.current_picker_team` to the opposite team, and if this was the 14th pick sets `status='completed'` + `completed_at=now()` + writes final `match_players.team` assignments for every picked player. Exactly one of `profile_id` / `guest_id` must be provided.

### New app_settings flags

- `draft_stuck_threshold_hours` — int · default `6` · governs when §3.18 admin-override actions appear.
- `reroll_cutoff_hours_before_kickoff` — int · default `12` · governs the post-lock reroll window close.

### Migration note order
1. Enum additions (`draft_status`, `draft_reason`, `team_color` if missing).
2. `draft_sessions` table create.
3. `draft_picks` table create with FK to `draft_sessions`.
4. `match_players.substituted_in_by` column add.
5. `notification_type` enum additions + push template rows + `app_settings` notification-pref toggles.
6. `app_settings` default rows for new threshold flags.
7. RPC definitions + RLS policies (captains-only for `submit_draft_pick` and `request_reroll`; players-only for `accept_substitute`; admin-only for the §3.18 force actions).

### Masterplan V2.7 section impact
- §2.1 enums — 3 new rows (or 2 if `team_color` pre-exists).
- §2.3 tables — 2 new tables, 1 new column on `match_players`.
- §2.5 notifications — 4 new notification types.
- §2.7 RPCs — 4 new RPCs.
- §2.8 app_settings — 2 new flags.
- §3.7 — State 6.5 + State 8.5 sub-section added.
- §3.18 — draft-session surfacing + force actions added.
- New cross-reference diagram: dropout → waitlist promote → captain modal → accept | reroll → draft-session state machine.

---

## Judgement calls captured inline (for user review)

1. **First-pick team in the reroll draft** — spec defaults to losing-side captain picking first as partial compensation for the dropout. Alternative would be always-White-first (no asymmetry). Chose compensation angle because the whole feature exists to protect losing-side team balance.
2. **Identical reroll output** — allowed, not guarded against. Statistical noise; users who reroll and get the same teams bear the social cost. Adding an "ensure-different" guarantee would require tracking prior assignments and re-drawing on match, which adds complexity for negligible gain.
3. **Opposing captain's right to veto** — explicitly none. The rule gives unilateral reroll right to the losing-side captain; the opposing captain only gets a passive info notification. Document as a deliberate rule asymmetry in the spec.
4. **Captain-is-the-dropout** — NOT handled by this feature's reroll modal (no captain is around to trigger it). Routed to admin via separate notification `captain_dropout_needs_replacement`. Flagged as orthogonal V2.7 work.
5. **Two dropouts before first reroll resolves** — first dropout wins the reroll right exclusively; second dropout's substitute joins the in-progress draft's pool silently. Prevents cascading reroll chaos.
6. **State 8.5 vs State 9** — amendment numbers the post-lock-substitution overlay as State 8.5 rather than State 9, on the reasoning that it's a behaviour overlay on State 8 rather than a linear next-step. State 9 remains available for future linear states (e.g. "Match complete / awaiting result entry").
7. **Admin-triggered reroll via §3.18** — allowed; bypasses captain consent. Audit trail via `triggered_by_profile_id` shows admin profile. Rare, intended for stuck drafts only.
8. **Pick-undo in Phase 1** — not included. Append-only picks. Phase 2 deferral.

---

END OF SCRATCH — awaiting integration into design spec and masterplan V2.7.
