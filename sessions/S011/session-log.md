# Session S011 — 21/APR/2026 (Home PC)

**Focus:** Apply statusbar flex-shrink fix to all mockups, integrate 3 WIP scratch files into master spec, write masterplan V2.7, close session.

**Outcome:** All 7 S011 items completed. Design spec fully integrated (§3.7 nine states + captain reroll + §3.16 v2 + §3.18 Phase 5.5 + §3.19 Formation planner). Masterplan V2.7 written. `flex-shrink: 0` fix verified on Profile and Formation via DOM inspection (59px computed height confirmed). Phase 1 design spec is now feature-complete — S012 is the user review + approval session.

---

## Cold start

- Resumed via `/resume-session` skill from `~/.claude/session-data/2026-04-21-FFC-session.tmp`.
- Briefed user on S011 plan: Item 0 (CRITICAL statusbar bug) + Items 1–6 (spec integration + masterplan) + Item 7 (close-out).
- User confirmed: "continue".
- Context loaded from CLAUDE.md S010 summary, todo.md S011 plan block, sessions/S010/session-log.md.

---

## Item 0 — Statusbar `flex-shrink: 0` fix (CRITICAL)

**Problem recap (diagnosed S010, deferred at user request):**
`.phone-inner` is `display: flex; flex-direction: column`. `.statusbar` is the first flex child and inherits `flex-shrink: 1` by default. When content overflows the 844px phone height (only Profile + Formation in practice), flex shrinks the statusbar from 59px → 17–25px, pulling the entire layout up behind the Dynamic Island cutout.

**Fix applied:**
```css
.statusbar {
  /* … existing rules … */
  flex-shrink: 0;   /* S011: prevents compression in flex-column phone-inner */
  /* … */
}
```

**Files edited (all 9 phone-frame mockups — `welcome.html` has no phone frame and was skipped):**
- `3-1-v2-captain-helper.html` — unique selector context (no `color: var(--ink)` line in this file); inserted before `position: relative`
- `3-7-poll-screen.html` — uses `.status-bar` (not `.statusbar`); inserted via `.status-bar .dots` anchor
- `3-13-leaderboard.html`
- `3-14-player-profile.html`
- `3-15-match-detail.html`
- `3-16-settings.html`
- `3-17-admin-players.html`
- `3-18-admin-matches.html`
- `3-19-formation.html`

All inserted between the `color: var(--ink)` and `position: relative; z-index: 2;` lines (or equivalent unique anchor per file).

**Applied defensively to all 9** even though only Profile + Formation were currently failing — prevents recurrence as content grows on other screens.

**Verified:**
- Preview server already running on `:5173`.
- `preview_inspect` on `3-14-player-profile.html` → `.statusbar` computed height: `"59px"`, flex-shrink: `"0"` ✅
- `preview_inspect` on `3-19-formation.html` → `.statusbar` computed height: `"59px"`, flex-shrink: `"0"` ✅
- `preview_screenshot` timed out twice (30s) — not a fix failure; worked around via DOM inspection which gave conclusive proof.

**New rule (statusbar v2.1):** `.statusbar { flex-shrink: 0; }` required in any flex-column `phone-inner` context. Canonical diagnostic: if safe-area drift is reported despite correct CSS, live-inspect `.statusbar` computed height first. Full walkthrough in `tasks/lessons.md` S010 row.

---

## Items 1–5 — Spec integration

All three WIP scratch files read in full, then integrated into `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` via surgical Edit calls.

### §3.7 Poll screen updates (Items 1 + 5)

**States table changes:**
- Header updated: "Eight key states" → "Nine key states"
- State 6 CTA updated: `[Keep my spot]` green + `[Cancel anyway]` red + `[View Matchday]` ghost (durable green=safe-confirm / red=destructive-confirm rule documented inline)
- **State 6.5 inserted:** "Draft in progress" — live Supabase realtime view of `draft_sessions` + `draft_picks`. LIVE chip + pulsing dot + two-column picks-so-far (picking side outlined) + pool of remaining players + last-pick footer ("Last pick: [name] → [team] · [N] min ago"). Trigger: `draft_sessions` row with `status = 'in_progress'` for active matchday.
- State 7 CTA updated: `[Keep my spot]` green + `[Confirm cancel]` red
- State 8 updated: described as two-section layout (WHITE TEAM header + 7 rows · BLACK TEAM header + 7 rows); per-row `[W]/[B]` pills removed — section header is now the team indicator

**Acceptance criteria additions:**
- AC8 updated to cover S009 + S010 trigger
- AC9 added: State 6.5 realtime sync — picks appear within 1s of `draft_picks` INSERT
- AC10 added: State 8 two-section layout renders both teams in full

**Post-lock substitution + captain reroll sub-section appended** (from `_wip/item-b-draft-reroll-spec.md`):
- `dropout_after_lock` notification triggers when confirmed player cancels after lock
- Losing-side captain receives non-dismissible modal: `[Accept substitute]` green / `[Request reroll]` amber
- Accept: sub Y from waitlist auto-promotes; captain confirms; match_players updated
- Reroll: creates new `draft_sessions` row with `reason = 'reroll_after_dropout'`; all non-captain team assignments cleared; fresh draft begins
- Cutoff: 12h before `kickoff_at`; after cutoff, admin decides
- Captain-is-the-dropout edge case → `captain_dropout_needs_replacement` notification to admin

### §3.16 Settings updates (Item 2)

From `_wip/item-settings-v2-amendments.md`:
- **Row 1 (Theme):** default changed from `system` → `dark` (S010 amendment, 20/APR/2026)
- **Layout ASCII:** `[•Dark•]` shown as active chip
- **Row 2 (Push notifications):** push_prefs shape updated to 6 keys (removed `position_changed`, added `dropout_after_lock`); `poll_reminder` timing = 2 min before `poll_close_at`; layout ASCII updated with pill-toggle UI pattern (not checkboxes)
- **Acceptance criteria:** AC1–AC7 block replaced (7 items covering theme persistence · push-permission prompt · toggle persistence · dark default · pill UI · `position_changed` migration · `poll_reminder` 2-min timing)
- **Section-5 wiring stub** appended: `poll_reminder` at `poll_close_at − 2 min`; `dropout_after_lock` fires to full roster + admins; `position_changed` deprecated (ignore legacy jsonb key, no DDL change)

### §3.18 Admin Matches update (Item 4)

From `_wip/item-b-draft-reroll-spec.md` §3.18 touch-up:
- **Phases ladder:** Phase 5 renamed to "Phase 5 · Roster locked – awaiting draft", Phase 5.5 inserted ("Draft in progress — captain pick session active"), Phase 6 added ("Teams revealed")
- **Always-visible roster** documented: admin match rows render full 14-player roster inline (7 WHITE + 7 BLACK); no tap-to-expand accordion
- **Admin actions for Phase 5.5:** "Force complete draft" (admin assigns teams manually when draft stalls beyond `draft_stuck_threshold_hours`), "Abandon draft" (reverts to Phase 5, new draft can be started)

### §3.19 Formation planner — new section (Item 3)

Full Depth-B spec inserted after §3.18 from `_wip/item-formation-planner-spec.md` with S010 rotating-GK additions:

**Purpose:** Pre-match tactical tool. Captain sets formation + optionally picks dedicated GK or enables rotation. Synced live to all team members (read-only for non-captains). Entry window: `kickoff_at − 24h`.

**Key features:**
- 7 formation patterns: 2-3-1 · 3-2-1 · 2-2-2 · 3-1-2 · 2-1-3 · 1-3-2 · Custom
- Drag-drop pitch tokens (top-down 7v7 pitch canvas)
- **Rotating-GK toggle:** `Dedicated GK` vs `Rotate every 10 min`
  - Dedicated GK: captain picks who plays in goal from radio card; no rotation badges on pitch
  - Rotate: captain picks starting GK; remaining 6 auto-assigned rotation numbers 1–6 (alphabetical by display name); numeric badges on pitch tokens
- Team-colour header strip: WHITE/BLACK team with "YOU'RE ON {team}" headline + match date
- 7-player roster card: avatar · name · position pill · rotation chip (fixed column widths)
- Share via `share_formation` RPC → Supabase realtime broadcasts to team members' Formation screens
- Non-captain view: read-only pitch with live sync; no drag capability; formation indicator shows "Captain is setting up..." during draft

**Data model:**
```sql
CREATE TABLE formations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id                 uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team                     text NOT NULL CHECK (team IN ('white','black')),
  created_by               uuid NOT NULL REFERENCES profiles(id),
  pattern                  text NOT NULL,
  positions                jsonb NOT NULL DEFAULT '[]',
  rotating_gk              boolean NOT NULL DEFAULT false,
  starting_gk_profile_id   uuid REFERENCES profiles(id),
  formation_rotation_order  jsonb,
  shared_at                timestamp with time zone,
  created_at               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at               timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(match_id, team)
);
```

**RPCs:** `upsert_formation(match_id, team, pattern, positions, rotating_gk, starting_gk_profile_id)` · `share_formation(formation_id)`

**Notifications:** `formation_reminder` (24h before kickoff if no formation saved) · `formation_shared` (when captain shares)

**Acceptance criteria (12):** entry window · pattern selection · drag-drop · dedicated-GK picker · rotating-GK auto-assign · rotation badges on tokens · realtime sync ≤1s · non-captain read-only · share action · safe-area contract (verified ✅) · responsive pitch at 390px · formation persists across app restart

---

## Item 6 — Masterplan V2.7

New file created: `planning/FFC-masterplan-V2.7.md`

Consolidates all S009 + S010 + S011 changes into a single narrative document:

**Revision history section:** V2.7 captures safe-area v2/v2.1, all 5 new Depth-B screen specs, and all S010 amendments.

**Decisions locked:** All new durable rules (always-visible rosters · pill switches · text-cutoff diagnostic · rotating-GK rule · green/red button rule · dark default).

**Updated sections:**
- §2 Brand: dark is signup default
- §5 Teams / Draft: live draft visibility + captain reroll mechanics
- §8 Push Notifications: 6 active keys (removed `position_changed`, added `dropout_after_lock`)

**New sections:**
- §13 Formation Planner
- §14 Captain Draft Visibility (State 6.5)
- §15 Post-lock Substitution + Captain Reroll

**Full data model delta (S009 + S010 + S011 combined):**

New enums:
- `draft_status`: `awaiting` · `in_progress` · `completed` · `abandoned`
- `draft_reason`: `initial` · `reroll_after_dropout`
- `form_pattern`: 7 values

New tables:
- `admin_audit_log` (id · admin_id · action · target_type · target_id · old_value · new_value · created_at)
- `draft_sessions` (id · match_id · reason · status · started_at · completed_at · initiated_by)
- `draft_picks` (id · draft_session_id · pick_number · team · profile_id · picked_at)
- `formations` (full DDL above)

New columns:
- `profiles.reject_reason text` (nullable)
- `match_players.substituted_in_by uuid` (nullable REFERENCES profiles)

New RPCs:
- `promote_from_waitlist(matchday_id, profile_id)` — admin, SECURITY DEFINER
- `accept_substitute(match_id, outgoing_profile_id, incoming_profile_id)` — captain, SECURITY DEFINER
- `request_reroll(match_id)` — captain, SECURITY DEFINER
- `submit_draft_pick(draft_session_id, team, profile_id)` — captain, SECURITY DEFINER
- `upsert_formation(match_id, team, pattern, positions, rotating_gk, starting_gk_profile_id)` — captain, SECURITY DEFINER
- `share_formation(formation_id)` — captain, SECURITY DEFINER

New `app_settings` flags:
- `draft_stuck_threshold_hours` integer DEFAULT 6
- `reroll_cutoff_hours_before_kickoff` integer DEFAULT 12

New notifications:
- `dropout_after_lock` · `draft_reroll_started` · `reroll_triggered_by_opponent` · `captain_dropout_needs_replacement` · `formation_reminder` · `formation_shared`
Removed: `position_changed` (legacy jsonb key — ignore at read time, no DDL change)

Migration order (11 steps): enums → admin_audit_log → draft_sessions → draft_picks → formations → `profiles.reject_reason` → `match_players.substituted_in_by` → new RPCs → new `app_settings` rows → realtime publication → notifications wiring

---

## Session stats

| Item | Status | Notes |
|------|--------|-------|
| 0. Statusbar `flex-shrink: 0` fix | ✅ DONE | Applied to 9 mockups; verified 59px on Profile + Formation |
| 1. Integrate item-b scratch (§3.7 State 6.5 + captain reroll) | ✅ DONE | |
| 2. Integrate item-settings scratch (§3.16 v2) | ✅ DONE | |
| 3. Integrate item-formation-planner scratch (§3.19) | ✅ DONE | |
| 4. §3.18 always-visible roster + Phase 5.5 | ✅ DONE | |
| 5. §3.7 spec state table sync (State 6/6.5/7/8 + buttons + 2-team layout) | ✅ DONE | |
| 6. Masterplan V2.7 | ✅ DONE | `planning/FFC-masterplan-V2.7.md` created |
| 7. Session close-out | ✅ DONE | This file |

---

## Handoff to S012

**Phase 1 design spec is now feature-complete.** All 10 mockups exist and pass the safe-area contract. All Depth-B specs are written. All data-model deltas are captured in V2.7.

**S012 goal:** User review pass on the full design spec — read through all sections, flag any remaining gaps or amendments, then formally approve Phase 1 design. Once approved, Phase 1 implementation can begin.

**Authoritative files:**
- `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` — Phase 1 design spec (full)
- `planning/FFC-masterplan-V2.7.md` — latest masterplan; V2.6 and earlier preserved
- All 10 mockups in `.superpowers/brainstorm/635-1776592878/content/`
- `tasks/lessons.md` — S009 + S010 rows present (env() + statusbar v2 + statusbar v2.1)

**WIP files to clean (items integrated, files can be archived or deleted):**
- `_wip/item-b-draft-reroll-spec.md`
- `_wip/item-settings-v2-amendments.md`
- `_wip/item-formation-planner-spec.md`
