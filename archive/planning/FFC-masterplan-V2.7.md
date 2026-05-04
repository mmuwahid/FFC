# FFC Masterplan V2.7
**Date:** 21/APR/2026
**Session:** S009 (home, marathon) + S010 (home, mockup review) + S011 (home, spec integration)
**Status:** Phase 1 design continues. Section 1 APPROVED. Section 2 APPROVED (with S005–S011 amendments). Section 3.0 APPROVED. Player-side screens through §3.15 APPROVED. Admin screens §3.17 + §3.18 DRAFT (mockup approved S010). §3.16 Settings DRAFT (mockup amended S010). §3.19 Formation planner DRAFT (mockup approved S010 after S010 rotating-GK redesign). Sections 4 · 5 · 6 pending.

---

## Revision history

### V2.7 (21/APR/2026 — S009 + S010 + S011)

**Safe-area pattern (S009 + S010).**
- **v2 pattern:** hardcode `--safe-top: 59px; --safe-bottom: 34px; --safe-left: 0px; --safe-right: 0px;` on `.phone`. Statusbar = `height: var(--safe-top); display: flex; justify-content: space-between;` — time/battery FLANK the island, NEVER `padding-top: var(--safe-top)`.
- **v2.1 amendment (S010):** `.statusbar { flex-shrink: 0; }` required in any flex-column `phone-inner` context. Without this, flex compresses the statusbar when content overflows 844px. Applied to all 9 mockups in S011 item 0.
- Cross-cutting §3.0 Platform safe-area sub-section added to design spec in S009.

**New and upgraded screen specs (S009).**
- **§3.15 Match-detail sheet** — upgraded from STUB → full Depth-B. Read-only bottom sheet (85% viewport height). W/D/L chip from profile-owner perspective. Guest rows lighter (goals/cards only, no rating chip/description). Wide viewport: 640w × 80vh above 768px.
- **§3.16 Settings** — new Depth-B spec. Six rows locked: Theme · Push notifications · Leaderboard sort · Positions re-entry · Display name · Account. Two state tiles (push-permission-prompt · push-denied fallback). Auth-gated.
- **§3.17 Admin Players** — new Depth-B spec. Player list · filter · invite · edit · deactivate · position override · role assign.
- **§3.18 Admin Matches** — new Depth-B spec. Full match lifecycle: roster lock → captain picking → team assignment → result entry → admin approval → post-approval editing + guest-stats correction.
- **§3.19 Formation planner** — new Depth-B spec (S009 + S010). Top-down 7v7 tactical board. Captain picks formation pattern + drags tokens. Non-captains see read-only live-synced view. Entry window: `kickoff_at − 24h` to `kickoff_at`.

**§3.16 Settings — S010 amendments.**
- **Theme default changed from `system` to `dark`.** FFC's visual direction skews low-ambient (evening football, WhatsApp-first culture). Stored cross-device on `profiles` AND mirrored to `localStorage.ffc_theme` to prevent cold-start flash.
- **Push prefs shape updated:** 6 keys (removed `position_changed`, added `dropout_after_lock`). `poll_reminder` timing re-specified as `poll_close_at - 2 minutes` (intentionally tight — last-call nudge; Phase 2 may expose this as user-configurable).
- **Pill-switch UI:** checkboxes replaced with iOS-style pill switches (S010 durable rule — applies app-wide to all toggle surfaces in FFC settings).

**§3.7 Poll screen — S010 additions.**
- **Nine key states** (up from eight): State 6.5 "Draft in progress" inserted between State 6 (Roster locked) and State 7 (Penalty sheet).
- **State 6 CTA updated:** `[Keep my spot]` green (safe-confirm) + `[Cancel anyway]` red (destructive). Durable FFC rule: green = safe-confirm, red = destructive-confirm (app-wide).
- **State 6.5 "Draft in progress":** Status card shows picker name + team colour + pick counter "N of 14 picked". Confirmed list splits into ⚪ WHITE · ⚫ BLACK · Available sections; active team's header pulses. Powered by Supabase realtime on `draft_sessions` + `draft_picks`. Caller's row gets left-border accent when picked.
- **State 7 CTA updated:** `[Keep my spot]` green + `[Confirm cancel]` red.
- **State 8 restructured:** Two-section layout — ⚪ WHITE TEAM header + 7 rows · ⚫ BLACK TEAM header + 7 rows. Section header is the team indicator; per-row `[W]/[B]` pills removed.
- **Post-lock substitution + captain reroll** — new sub-section in §3.7. Losing-side captain gets non-dismissible modal on next app open after dropout: `[Accept substitute]` green or `[Request reroll]` amber. Reroll triggers new `draft_sessions` row (`reason='reroll_after_dropout'`), clears non-captain team assignments, broadcasts notifications. 12h-before-kickoff cutoff.

**§3.18 Admin Matches — S010 amendments.**
- **Always-visible full roster** (S010 durable rule — lists ≤14 render inline, no tap-to-expand accordion). WHITE TEAM header + 7 rows · BLACK TEAM header + 7 rows.
- **Phase 5.5 · Draft in progress** added to phases ladder. Shows pick progress + admin force-complete/abandon actions when draft is stuck > `draft_stuck_threshold_hours` (default 6h).

**§3.19 Formation planner — S010 rotating-GK feature.**
- **Segmented toggle:** `Dedicated GK` (default if any player has `primary_position='GK'`) vs `Rotate every 10 min`.
- **Rotating-GK:** captain selects starting GK from radio-card; remaining 6 players auto-assigned rotation numbers 1–6 (alphabetical by display_name in Phase 1). Rotation numbers render as 18px badges on pitch tokens. Stored in `formations.formation_rotation_order` jsonb + `formations.starting_gk_profile_id`.
- Team-colour header strip: "YOU'RE ON WHITE/BLACK · {DD/MMM/YYYY}" prominent above pitch.
- Roster card: avatar · name · position pill · rotation chip (fixed column widths).

**FFC naming rule (S009).**
- App is "FFC" only. Never expand to "Friends FC" or "Friends Football Club". Corrected in all Phase 1 files.

---

### V2.6 (20/APR/2026 — S006 close + S007)
*(preserved — see `FFC-masterplan-V2.6.md`)*

### V2.5 · V2.4 · V2.3 · V2.2 · V2.1 · V2.0 · V1.0
*(preserved in prior files)*

---

## 1. Concept
*(unchanged from V2.2)*

---

## 2. Brand
*(unchanged from V2.5)* — dark-mode palette: `paper #0e1826`, `ink #f2ead6`, accent `#e63349`, gold `#e5ba5b`. Default theme is now **dark** at signup (V2.7 change — was `system`). Position pill hues constant across light/dark; outlined variants lighten in dark for legibility.

---

## 3. Decisions locked (cumulative)

**From V2.0–V2.6:** *(see prior doc versions)*.

**New in V2.7 (from S009 + S010 + S011):**
- Safe-area pattern v2: hardcode `--safe-top: 59px` etc. on `.phone`; statusbar flanks island (never padded-below).
- Safe-area pattern v2.1: `.statusbar { flex-shrink: 0; }` required in all flex-column phone-inner layouts.
- Theme default at signup = `dark` (was `system`). S010 amendment.
- Push prefs shape: 6 keys (no `position_changed`, + `dropout_after_lock`). `poll_reminder` at `poll_close_at − 2 min`.
- Pill switches over checkboxes for all FFC settings toggle surfaces (S010 durable rule).
- Always-visible roster: lists ≤ 14 render fully inline — no tap-to-expand accordions (S010 durable rule).
- Green/red button colour rule: safe-confirm = green, destructive-confirm = red. App-wide (S010 durable rule).
- Rotating-GK: teams without a dedicated GK rotate keeper every ~10 min; captain picks starter; auto-assigns rotation numbers 1–6. Supported natively in Formation planner (S010 durable rule — real match-day practice).
- §3.7 Nine key states (State 6.5 "Draft in progress" added S010).
- §3.7 State 8 = two-section layout (WHITE TEAM + BLACK TEAM, each 7 rows); no per-row W/B pills.
- Post-lock substitution + captain reroll: losing-side captain has unilateral reroll right within 12h-before-kickoff window.
- §3.18 Phase 5.5 · Draft in progress added to admin phases ladder.
- §3.19 Formation planner added to Phase 1 scope.
- FFC naming: "FFC" only, never expand.

---

## 4. Captain Selection Formula
*(unchanged from V2.4)*

---

## 5. Teams, Draft, Match Result Entry
*(S009/S010 additions below; rest unchanged from V2.4)*

**Captain draft visibility (S010).**
When admin starts team selection, a `draft_sessions` row is created. The Poll screen (§3.7) transitions all connected clients to State 6.5 within 2s. Players see picks flow live via Supabase realtime on `draft_picks`. Draft completes → State 8 (Teams revealed) within 2s.

**Post-lock dropout + reroll (S010).**
When a player cancels within the 24h post-lock window: `promote_from_waitlist` auto-promotes first waitlisted player; losing-side captain receives `dropout_after_lock` notification and gets a decision modal (accept substitute or request reroll). Reroll = new `draft_sessions` row, clears non-captain team assignments, restarts State 6.5 for all connected clients.

---

## 6. Scoring, Last-5, Discipline & Punctuality
*(unchanged from V2.6)*

---

## 7. WhatsApp Integration & Scheduled Reminders
*(unchanged from V2.5)*

---

## 8. Push Notifications
*(S009/S010 additions — rest from V2.6)*

**New notification types (V2.7):**
- `dropout_after_lock` — sent to losing-side captain (actionable modal) + all confirmed-roster players + admins (informational). Fires when player cancels post-lock AND substitute is promoted.
- `draft_reroll_started` — sent to all 16 roster players. Fires when captain triggers a reroll.
- `reroll_triggered_by_opponent` — sent to opposing captain passively. Informational only.
- `captain_dropout_needs_replacement` — sent to admin only when a captain drops out.
- `formation_reminder` — sent to both captains 24h before kickoff.
- `formation_shared` — sent to all non-captain team members when captain shares formation.

**Updated notification: `poll_reminder`** — now fires at `matchday.poll_close_at − 2 minutes` (S010 amendment from `24h before`). Intentionally tight last-call nudge.

**Removed notification: `position_changed`** — no longer user-facing. Admin-approval events handled via admin channel. Legacy `push_prefs.position_changed` jsonb key silently ignored on read, stripped on next write.

---

## 9. Player Positions
*(unchanged from V2.5)*

---

## 10. Theme Preference
*(V2.7 update)*

`profiles.theme_preference` stores `light | dark | system`. **Default at signup is now `dark`** (was `system` in V2.6). Toggled from Settings row 1. Stored cross-device on `profiles` AND mirrored to `localStorage.ffc_theme` to prevent cold-start flash of wrong theme while auth hydrates.

---

## 11. Leaderboard Sort Preference
*(unchanged from V2.6)*

---

## 12. Guest Player Stats
*(unchanged from V2.6)*

---

## 13. Formation Planner (NEW in V2.7)

**Purpose.** Pre-match tactical board for captains. 7 formation patterns + drag-drop token placement + share with team.

**Entry.** Captain-only, `kickoff_at − 24h` window. Non-captains see read-only view after captain shares.

**Patterns.** 2-3-1 · 3-2-1 · 2-2-2 · 3-1-2 · 2-1-3 · 1-3-2 · Custom. Preset coordinates in design spec §3.19.

**Rotating-GK.** Toggle `Dedicated GK` vs `Rotate every 10 min`. When rotating: captain picks starter; remaining 6 assigned rotation numbers 1–6 (alphabetical). Numbers render on pitch tokens and roster cards.

**Realtime.** Supabase realtime on `formations` table. Non-captains see updates within 2s of captain save. Offline fallback: cached layout with "Last synced HH:mm" chip.

**Phase-2 deferred.** Template library · formation history · opposing-team side-by-side · set-piece markers · wide viewport two-column layout · drag-reorder rotation numbers.

---

## 14. Captain Draft Visibility (NEW in V2.7)

**State 6.5** in the §3.7 Poll screen. Live view of captain team-selection.

**Data model:** `draft_sessions` + `draft_picks` tables (see §2 amendment below).

**Flow:** Admin starts draft → `draft_sessions` INSERT → all connected poll screens → State 6.5 within 2s. Each pick fires `draft_picks` INSERT → clients move player Available → WHITE/BLACK section within 2s. Draft completes → `draft_sessions.status='completed'` → State 8 within 2s.

---

## 15. Post-lock Substitution + Captain Reroll (NEW in V2.7)

**Trigger.** Player X cancels within 24h of kickoff → `promote_from_waitlist` promotes waitlist player Y → `dropout_after_lock` notification to losing-side captain.

**Captain decision modal.** `[Accept substitute]` green (no further writes) or `[Request reroll]` amber → confirmation sub-modal → `request_reroll` RPC creates new `draft_sessions` row (`reason='reroll_after_dropout'`), clears non-captain team assignments, poll screens → State 6.5.

**Reroll window.** 12h before kickoff (configurable via `app_settings.reroll_cutoff_hours_before_kickoff`).

**Captain-is-dropout edge case.** Routed to admin via `captain_dropout_needs_replacement` notification — no reroll modal fires.

---

## Section 2 — Data model amendments (V2.7 delta from V2.6)

### New enums (§2.1)
- `draft_status AS ENUM ('in_progress', 'completed', 'abandoned')`
- `draft_reason AS ENUM ('initial', 'reroll_after_dropout')`
- `team_color AS ENUM ('white', 'black')` — add if not already present from team-pill work.

### New tables (§2.3)

**`draft_sessions`**
```sql
draft_sessions (
  id                      uuid pk default gen_random_uuid(),
  matchday_id             uuid fk matchdays not null,
  status                  draft_status not null default 'in_progress',
  current_picker_team     team_color not null default 'white',
  reason                  draft_reason not null default 'initial',
  triggered_by_profile_id uuid fk profiles nullable,
  started_at              timestamptz not null default now(),
  completed_at            timestamptz nullable,
  unique partial index where status='in_progress'  -- one active session per matchday
)
```

**`draft_picks`**
```sql
draft_picks (
  id                uuid pk default gen_random_uuid(),
  draft_session_id  uuid fk draft_sessions not null,
  pick_order        int not null,
  team              team_color not null,
  profile_id        uuid fk profiles nullable,
  guest_id          uuid fk match_guests nullable,
  picked_at         timestamptz not null default now(),
  unique (draft_session_id, pick_order),
  CHECK ((profile_id IS NOT NULL AND guest_id IS NULL) OR (profile_id IS NULL AND guest_id IS NOT NULL))
)
```

**`formations`** (§3.19)
```sql
formations (
  id                        uuid pk default gen_random_uuid(),
  matchday_id               uuid fk matchdays not null,
  team                      text check (team in ('white','black')),
  pattern                   text check (pattern in ('2-3-1','3-2-1','2-2-2','3-1-2','2-1-3','1-3-2','custom')),
  layout_jsonb              jsonb not null,   -- [{player_id, kind:'member'|'guest', x, y, pos_label}]
  formation_rotation_order  jsonb nullable,   -- [{profile_id, rotation_number, is_starting_gk}]
  starting_gk_profile_id    uuid fk profiles nullable,
  last_edited_by            uuid fk profiles,
  last_edited_at            timestamptz not null default now(),
  shared_at                 timestamptz nullable,
  created_at                timestamptz not null default now(),
  unique (matchday_id, team)
)
```

**`admin_audit_log`** (§3.17/§3.18 — surfaced in S009)
```sql
admin_audit_log (
  id                uuid pk default gen_random_uuid(),
  admin_profile_id  uuid fk profiles not null,
  target_entity     text not null,
  target_id         uuid nullable,
  action            text not null,
  payload_jsonb     jsonb,
  created_at        timestamptz not null default now()
)
```

### New columns on existing tables
- **`profiles.reject_reason`** — `TEXT` nullable (surfaced in §3.17 Admin Players — S009).
- **`match_players.substituted_in_by`** — `uuid FK → profiles` nullable. Populated by `promote_from_waitlist` for audit.
- **`profile_role` enum** — add `'rejected'` value (§3.17 — S009).

### New RPCs (§2.7 — additions to existing 14)
- **`promote_from_waitlist(matchday_id uuid, departing_profile_id uuid) → uuid`** — removes departing player, promotes first waitlisted, sets `substituted_in_by`. Idempotent.
- **`accept_substitute(matchday_id uuid) → void`** — marks `dropout_after_lock` notification actioned with outcome `accepted`.
- **`request_reroll(matchday_id uuid) → uuid`** — authorises losing-side captain, creates new `draft_sessions` row (`reason='reroll_after_dropout'`), clears non-captain `match_players.team` values, fires notifications. Returns `draft_session_id`.
- **`submit_draft_pick(draft_session_id uuid, profile_id uuid, guest_id uuid) → draft_picks`** — authorises current-picker-team captain, inserts pick, flips `current_picker_team`, completes draft on 14th pick.
- **`upsert_formation(p_matchday_id, p_team, p_pattern, p_layout_jsonb, p_rotation_order, p_starting_gk_profile_id) → uuid`** — validates captain role + layout rules, upserts `formations` row.
- **`share_formation(p_formation_id) → void`** — sets `shared_at`, fires `formation_shared` push to non-captain team members.

### New `app_settings` flags
- `draft_stuck_threshold_hours` — int · default `6` — governs when §3.18 admin override actions appear.
- `reroll_cutoff_hours_before_kickoff` — int · default `12` — governs post-lock reroll window.

### Migration order
1. New enums: `draft_status`, `draft_reason`, `team_color` (if missing).
2. `profile_role` enum: add `'rejected'`.
3. `profiles.reject_reason` column add.
4. `admin_audit_log` table create.
5. `draft_sessions` table create.
6. `draft_picks` table create (FK to `draft_sessions`).
7. `match_players.substituted_in_by` column add.
8. `formations` table create.
9. `notification_type` enum: add `dropout_after_lock`, `draft_reroll_started`, `reroll_triggered_by_opponent`, `captain_dropout_needs_replacement`, `formation_reminder`, `formation_shared`. Remove `position_changed` from user-facing prefs (no DDL needed — jsonb key is passive).
10. `app_settings` default rows: `draft_stuck_threshold_hours=6`, `reroll_cutoff_hours_before_kickoff=12`.
11. RPC definitions + RLS policies.
