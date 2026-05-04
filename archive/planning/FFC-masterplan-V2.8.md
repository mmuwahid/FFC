# FFC Masterplan V2.8

**Date:** 21/APR/2026
**Session:** S013 (home — full spec walkthrough + 5v5/7v7 multi-format + drift reconciliation + WIP archive)
**Status:** Phase 1 design spec **feature-complete and drift-free**. Awaiting formal approval (S014+) before implementation kickoff. §1 + §2.1–§2.9 + §3.0–§3.19 all reviewed and locked. Sections 4, 5, 6 of the masterplan remain pending (operational runbook, rollout plan, post-Phase-1 roadmap).

**Spec stats at V2.8:** ~3,100 lines · 20 tables · 20 RPCs · 18 enums · 19 notification kinds · 7 seeded `app_settings` keys · 9 approved phone-frame mockups.

---

## Revision history

### V2.8 (21/APR/2026 — S013)

This revision consolidates S013's outcomes on top of V2.7. Five delta groups:

1. **Section 1 non-goal fix** — the "automated captain pick on lock" non-goal was rewritten to correctly scope *auto-pick* to Phase 2 while recognising that the captain helper, the live manual draft (§3.7 State 6.5), and the post-lock reroll are all Phase 1. Stale top-of-spec status block was refreshed (it had drifted ~9 sessions behind reality).

2. **§2 Data Model walkthrough** — all S009–S011 deltas promised in V2.7 have now physically landed in the design spec, plus a few naming/convention corrections:
   - 3 new enums (`user_role` += `rejected` · `draft_status` · `draft_reason`)
   - 6 new `notification_kind` values (`dropout_after_lock` · `draft_reroll_started` · `reroll_triggered_by_opponent` · `captain_dropout_needs_replacement` · `formation_reminder` · `formation_shared`)
   - 2 new columns (`profiles.reject_reason` + scope CHECK · `match_players.substituted_in_by` + partial index)
   - 4 new tables (`admin_audit_log` · `draft_sessions` · `draft_picks` · `formations`)
   - 3 new `app_settings` keys (`draft_stuck_threshold_hours=6` · `reroll_cutoff_hours_before_kickoff=12` · `poll_reminder_offset_minutes=-2`)
   - 7 new RPCs (13 → 20 total): `edit_match_result` + 6 captain-draft/formation RPCs
   - private `log_admin_action` helper + admin-audit convention paragraph
   - 4 new RLS policy blocks
   - `formations` conditional SELECT policy (`is_admin() OR shared_at IS NOT NULL OR last_edited_by = current_profile_id()`)
   - Naming correction: V2.7 referred to `profile_role`; authoritative enum name is `user_role`.

3. **§3.0 + §3.2–§3.6 drift reconciliation** — 10 fixes against the authoritative §2 DDL. S002 sub-designs were written *before* §2 existed and had accumulated drift (column names, enum shapes, table layouts). All reconciled. Full delta table in the "Drift reconciliations" subsection below.

4. **5v5/7v7 multi-format feature spec** — new in V2.8 (scope was locked in S012; spec landed in S013). Season default + per-matchday override. 4 open decisions resolved (all "keep unified" or "keep simple"). 10 surfaces parameterised by `roster_cap()`. See §16 below.

5. **§3.14 + §3.19 CSS contract persistence** — the S012 mockup bug fixes (`.card { flex-shrink: 0 }` · `.tabbar` sticky · `.phone-inner > * { flex-shrink: 0 }` defensive rule · native `<select>` GK picker) are now captured in the acceptance criteria of the relevant Depth-B sections, with diagnostic cross-references to `tasks/lessons.md` S012 entries.

Additional housekeeping: 3 integrated WIP files archived (`item-b-draft-reroll-spec.md` · `item-formation-planner-spec.md` · `item-settings-v2-amendments.md`); `_wip/` is empty.

### V2.7 (21/APR/2026 — S009 + S010 + S011)
*(preserved — see `FFC-masterplan-V2.7.md`)*

### V2.6 · V2.5 · V2.4 · V2.3 · V2.2 · V2.1 · V2.0 · V1.0
*(preserved in prior files)*

---

## 1. Concept
*(unchanged from V2.2)*

---

## 2. Brand
*(unchanged from V2.5 / V2.7 — default theme `dark`)*

**Brand asset discovery (S012 — noted in V2.8):** `shared/FF_LOGO_FINAL.pdf` holds the authoritative shield crest; `shared/COLORS.pdf` shows the official 4-colour palette (black / white / khaki-gold `#AEA583` / cream `#EDE9E1`). Mockups currently use red + navy — user explicitly chose to keep the current mockup palette and swap crest only. **Palette re-alignment remains deferred.**

**Logo rollout (S014 item 2 — blocked on user asset export):** once user delivers transparent PNG at 512 / 192 / 180 / 32 + SVG master + WhatsApp OG 1200×630 into `shared/`, wire into `welcome.html` + all 9 phone-frame mockups (replacing the JPG stopgap on `3-7-poll-screen.html`).

---

## 3. Decisions locked (cumulative)

**From V2.0–V2.7:** *(see prior doc versions)*.

**New in V2.8 (from S013):**

- **Captain-draft scoping (§1 non-goal fix).** Automated captain *pick* on roster lock remains Phase 2. Phase 1 includes (a) the captain advisory helper, (b) manual captain draft with live realtime visibility via §3.7 State 6.5, and (c) post-lock captain reroll on dropout. Three Phase-1 deliverables, one Phase-2 non-goal.
- **Authoritative enum name is `user_role`** (not `profile_role` — V2.7 used the wrong name in the Section 2 appendix). All spec + migration files use `user_role`.
- **Admin-audit convention.** Every admin-role RPC calls the private SECURITY DEFINER helper `log_admin_action(target_entity, target_id, action, payload)` before returning. Helper is not granted to anon/authenticated; writes `admin_audit_log` rows. `admin_audit_log` has admin-only SELECT; there is no direct INSERT path.
- **`formations` SELECT policy is conditional.** `is_admin() OR shared_at IS NOT NULL OR last_edited_by = current_profile_id()`. A captain's in-progress draft stays private until they tap Share; admins always see everything.
- **5v5/7v7 multi-format: season default + per-matchday override.** `seasons.default_format NOT NULL DEFAULT '7v7'`; `matchdays.format NULL` — nullable means "inherit from season".
- **Captain min-matches threshold = 5 regardless of format.** (Decision A(i).) Simpler; revisit if nobody qualifies mid-season.
- **Leaderboard is unified across formats.** (Decision B(i).) Points = 3W + 1D + penalties regardless of whether the match was 7v7 or 5v5.
- **Player profile stats are unified across formats.** (Decision C(i).)
- **Season default format is stored per-season only.** (Decision D(i).) No global `app_settings` fallback; a new season must pick a format (defaults to `'7v7'` at row-create).
- **`formations_pattern_valid` CHECK enumerates both format supersets.** 7v7 patterns (`2-3-1 · 3-2-1 · 2-2-2 · 3-1-2 · 2-1-3 · 1-3-2 · custom`) + 5v5 patterns (`1-2-1 · 2-1-1 · 1-1-2 · custom`). The `custom` sentinel is shared. Pattern-picker UI filters client-side by `effective_format()`.
- **WhatsApp share templates parameterised by `{{roster_cap}}`.** Rendered at share time; no need to branch template keys per format.

---

## 4. Captain Selection Formula
*(unchanged from V2.4 — 3-criteria formula; season-age gate; White=weaker pair-assignment. Threshold of 5 matches holds across formats per decision A(i) above.)*

---

## 5. Teams, Draft, Match Result Entry
*(unchanged from V2.7)*

---

## 6. Scoring, Last-5, Discipline & Punctuality
*(unchanged from V2.6)*

---

## 7. WhatsApp Integration & Scheduled Reminders
*(unchanged from V2.5 — with one V2.8 note below.)*

**V2.8 note:** the `whatsapp_share_templates.plus_one_unlock` template uses `{{roster_cap}}` placeholder (substituted at render time). This keeps one template row serving both 7v7 and 5v5 matchdays.

---

## 8. Push Notifications
*(unchanged from V2.7 — 19 notification kinds total; see V2.7 §8 for the 6 new kinds added in V2.7 and the `position_changed` removal.)*

---

## 9. Player Positions
*(unchanged from V2.5)*

---

## 10. Theme Preference
*(unchanged from V2.7 — default `dark`.)*

---

## 11. Leaderboard Sort Preference
*(unchanged from V2.6 — applied uniformly across 7v7 + 5v5 matches per decision B(i).)*

---

## 12. Guest Player Stats
*(unchanged from V2.6)*

---

## 13. Formation Planner
*(V2.7 §13 plus V2.8 5v5 extensions below.)*

**5v5 additions (V2.8).**
- Pattern chip picker is filtered client-side by `effective_format(matchday_id)`. 7v7 matches show the 6 7v7 patterns + Custom; 5v5 matches show the 3 5v5 patterns + Custom.
- Rotating-GK rotation numbers are `1..roster_cap(format)/2 − 1` — i.e. 1–6 for 7v7, 1–4 for 5v5.
- `upsert_formation` resolves `effective_format()` server-side and validates pattern membership against that format's permitted set. Layout bounds check (x/y within pitch SVG) unchanged.

---

## 14. Captain Draft Visibility
*(unchanged from V2.7 — State 6.5 live view; `submit_draft_pick` completion check resolves `roster_cap(format)` so 5v5 drafts complete at the 10th pick, 7v7 at the 14th.)*

---

## 15. Post-lock Substitution + Captain Reroll
*(unchanged from V2.7 — 12h pre-kickoff cutoff governed by `app_settings.reroll_cutoff_hours_before_kickoff`.)*

---

## 16. 5v5 / 7v7 Multi-Format Support (NEW in V2.8)

**Motivation.** Early-season or small-turnout weeks may drop to 5v5 to keep the league playable. Storing format per-matchday (with a season default) keeps the stats comparable (decision B(i) · C(i)) while allowing operational flexibility.

**Four decisions locked.**

| # | Decision | Locked to | Reasoning |
|---|---|---|---|
| A | Captain min-matches threshold in 5v5 | **(i) Keep at 5 regardless of format** | Simpler; revisit if nobody qualifies mid-season. |
| B | Leaderboard across formats | **(i) Unified** | Points logic (3W + 1D + penalties) works identically; fewer screens. Keeps §3.13 intact. |
| C | Player profile stats — format split? | **(i) Unified** | Same reasoning as B. No "view by format" dropdown in V2.8. |
| D | Season default format storage | **(i) Per-season only** | No global `app_settings` fallback. A new season must pick (defaults to `'7v7'`). |

**Data model.**

| Surface | Shape |
|---|---|
| Enum | `match_format AS ENUM ('7v7', '5v5')` |
| `seasons.default_format` | `match_format NOT NULL DEFAULT '7v7'` |
| `matchdays.format` | `match_format NULL` — `NULL` means "inherit from `seasons.default_format`" |
| Helper | `effective_format(matchday_id) RETURNS match_format` — `COALESCE(matchdays.format, seasons.default_format)` |
| Helper | `roster_cap(format) RETURNS int` — IMMUTABLE · 14 for `'7v7'`, 10 for `'5v5'` |
| CHECK | `formations_pattern_valid` extended to include 5v5 patterns (`1-2-1 · 2-1-1 · 1-1-2` + the shared `custom` sentinel) |

**§2.7 format-awareness convention.** RPCs that depend on roster size resolve format server-side via `effective_format(matchday_id)`. The spec enumerates which ones do and what they use it for:

| RPC | Role of `effective_format` |
|---|---|
| `#2 create_match_draft` | Array sizing at draft creation |
| `#10 pick_captains_random` | Captain-eligibility scope resolves `roster_cap/2` (early-season randomizer) |
| `#11 pick_captains_from_formula` | Same as #10 for the formula path |
| `#12 set_matchday_captains` | Validates both captain_ids refer to confirmed players within `roster_cap` |
| `#18 submit_draft_pick` | Completes draft on the `roster_cap`-th pick (14 for 7v7, 10 for 5v5) |
| `#19 upsert_formation` | Validates layout pattern membership against `formations_pattern_valid` for that format |

**UI surfaces parameterised by `roster_cap()`.**

| Section | Parameterisation |
|---|---|
| §3.5 +1 guest | Guest slot count = `max(0, roster_cap − confirmed − guests)`; Wed 8:15 PM unlock condition reads the same threshold |
| §3.6 Vote order + waitlist | Waitlist boundary = first `roster_cap` `committed_at`; `v_match_commitments` is unchanged (it orders; caller derives the cap) |
| §3.7 Poll screen | Status card copy: "You're in — spot #N of `{roster_cap}`"; State 8 roster splits `roster_cap/2` per team |
| §3.18 Admin Matches | Format chip next to matchday date; Phase 2/4 confirmation text and drag-form enforce `roster_cap/2`; Phase 5.5 pick count reads `[n] of {roster_cap}` |
| §3.19 Formation planner | Roster size, rotation number range, and pattern picker all resolved from `effective_format()` |
| WhatsApp templates | `plus_one_unlock` template uses `{{roster_cap}}` placeholder |

**Admin UX.** Matchday-creation card in §3.18 gains a **Format chip** picker (7v7 / 5v5). Default = season default; admin can override per matchday. If the format is changed mid-poll (after any vote exists), admin gets a confirmation warning — changing format shifts the waitlist boundary and may promote/demote confirmed players.

---

## Section 2 — Data model amendments (V2.8 delta from V2.7)

This section documents only what's new in V2.8 beyond V2.7's delta appendix. For V2.7's deltas (draft_sessions, draft_picks, formations, admin_audit_log, etc.), see `FFC-masterplan-V2.7.md`.

### New enum
- `match_format AS ENUM ('7v7', '5v5')`

### Enum naming authority
- **`user_role`** (V2.7 called this `profile_role` — that was drift; `user_role` is authoritative everywhere in the spec + migrations). The `'rejected'` value added in S013 is on `user_role`.

### New columns on existing tables
- `seasons.default_format match_format NOT NULL DEFAULT '7v7'`
- `matchdays.format match_format NULL` (inherits from season when `NULL`)

### New helper functions (§2.5)

```sql
CREATE OR REPLACE FUNCTION effective_format(p_matchday_id uuid)
RETURNS match_format
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(m.format, s.default_format)
  FROM matchdays m
  JOIN seasons s ON s.id = m.season_id
  WHERE m.id = p_matchday_id;
$$;

CREATE OR REPLACE FUNCTION roster_cap(p_format match_format)
RETURNS int
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_format WHEN '7v7' THEN 14 WHEN '5v5' THEN 10 END;
$$;
```

Both are granted EXECUTE to `authenticated`.

### Private admin-audit helper (§2.5)

```sql
CREATE OR REPLACE FUNCTION log_admin_action(
  p_target_entity text,
  p_target_id uuid,
  p_action text,
  p_payload jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO admin_audit_log (admin_profile_id, target_entity, target_id, action, payload_jsonb)
  VALUES (current_profile_id(), p_target_entity, p_target_id, p_action, p_payload);
END;
$$;
-- No grants to anon/authenticated; callable only by SECURITY DEFINER RPCs.
```

Admin-role RPCs call this before returning. Convention is documented in §2.7 prologue.

### CHECK expansion on `formations`

```sql
-- Supersedes V2.7 CHECK (which only enumerated 7v7 patterns).
ALTER TABLE formations DROP CONSTRAINT formations_pattern_valid;
ALTER TABLE formations ADD CONSTRAINT formations_pattern_valid
  CHECK (pattern IN (
    -- 7v7
    '2-3-1', '3-2-1', '2-2-2', '3-1-2', '2-1-3', '1-3-2',
    -- 5v5
    '1-2-1', '2-1-1', '1-1-2',
    -- shared
    'custom'
  ));
```

### Drift reconciliations (§3.2–§3.6 — spec text only, no DDL delta)

S002 sub-designs predated §2 by several sessions. 10 drift points reconciled against authoritative §2 DDL:

| # | Section | Drift | Fix |
|---|---|---|---|
| 1 | §3.2 | Example query referenced `home_score` / `away_score` / `played_at` / `user_id` (never existed) | Rewrite to query `v_player_last5` view |
| 2 | §3.3 | `pending_signups` column list referenced `intent` / `target_profile_id` (never existed) | Rewrite to match §2.2: `auth_user_id` · `claim_profile_hint` · `resolution` |
| 3 | §3.3 | Role model said `profiles.is_admin boolean` | Replace with `role user_role` enum |
| 4 | §3.3 | Rejected flow deleted the pending row (no audit trail) | Update: `reject_signup` creates `profiles` ghost row with `role='rejected'` + `reject_reason`; resolves pending to `resolution='rejected'` |
| 5 | §3.4 | `pending_match_entries` shape had `home_score` / `away_score` / `ref_token_id` | Rewrite to match §2.4: `score_white` / `score_black` / `submitted_by_token_id` + status enum |
| 6 | §3.4 | `ref_tokens.used_at` | Rename to `consumed_at` |
| 7 | §3.5 | "Per-guest goals on `match_guests.goals_scored`" (Section 2 prologue flagged this in S003 — never fixed until S013) | Rewrite: stats live on `match_players` rows with `guest_id` set, per §2.3 XOR CHECK |
| 8 | §3.5 | "`update_guest_stats` RPC to be added" | Remove qualifier; RPC exists (§2.7 #13), admin screen exists (§3.18) |
| 9 | §3.6 | `voted_at` / `status` enum / `bigserial PK` / `invited_at` — 4 column-name drifts | Wholesale rewrite of §3.6 data-model block to match §2.4: `committed_at` / `cancelled_at` soft-delete / uuid PK / `match_guests.created_at` |
| 10 | §3.6 | "Your position changed" notification | Remove — never landed in `notification_kind` enum; Phase-2 opportunity paragraph added |

---

## Migration order (V2.8 — supersedes V2.7)

This is the authoritative 11-file migration layout for Phase 1 bootstrap. See §2.9 of the design spec for file-by-file details; this is the summary.

| # | File | Contents |
|---|---|---|
| 1 | `0001_enums.sql` | All custom types: `user_role` · `notification_kind` · `draft_status` · `draft_reason` · `match_format` · `guest_rating` · `guest_trait` · `leaderboard_sort` · `player_position` · `theme_preference` · `team_color` · plus ref-token + signup + match-entry status enums |
| 2 | `0002_base.sql` | `seasons` (with `default_format`) · `profiles` (with `reject_reason` + CHECK + `role` · `theme_preference` · positions · `leaderboard_sort`) · `matchdays` (with `format` nullable) |
| 3 | `0003_match_data.sql` | `match_players` (with `substituted_in_by` + partial index) · `match_guests` (with S007 guest-stats columns + CHECKs) |
| 4 | `0004_poll_ref.sql` | `poll_votes` · `ref_tokens` · `pending_signups` · `pending_match_entries` |
| 5 | `0005_operational.sql` | `app_settings` (with seed rows) · `admin_audit_log` · `draft_sessions` · `draft_picks` · `formations` (with expanded `formations_pattern_valid` CHECK covering both formats) · `notifications` |
| 6 | `0006_views.sql` | `v_match_commitments` · `v_season_standings` · `v_player_last5` · `v_captain_eligibility` |
| 7 | `0007_helpers.sql` | `current_profile_id` · `is_admin` · `is_super_admin` · `effective_format` · `roster_cap` · `log_admin_action` |
| 8 | `0008_rpcs.sql` | All 20 SECURITY DEFINER RPCs |
| 9 | `0009_rls.sql` | All RLS policies (per-table blocks); `formations` conditional SELECT included |
| 10 | `0010_grants.sql` | GRANT EXECUTE on RPCs + helpers; table-level grants through RLS |
| 11 | `0011_seed_super_admin.sql` | Seed `m.muwahid@gmail.com` as super_admin + create `season_2026` row |

**Seeded `app_settings` keys:**
- `draft_stuck_threshold_hours = 6` (governs §3.18 admin force-complete / abandon actions)
- `reroll_cutoff_hours_before_kickoff = 12` (governs captain reroll window)
- `poll_reminder_offset_minutes = -2` (governs `poll_reminder` notification timing — 2 min before close)
- `whatsapp_share_templates` (jsonb — including `plus_one_unlock` with `{{roster_cap}}` placeholder)

---

## Implementation sequencing notes (for S014+ kickoff)

This is the suggested execution order once Phase 1 design is formally approved. Each step lists its acceptance criterion.

### Step 0 — Repo + infrastructure
1. **GitHub repo** `mmuwahid/FFC` — private until MVP. Enforce committer identity `Mohammed Muwahid <m.muwahid@gmail.com>` (not the work-PC default — Vercel Hobby rejects unknown committers).
2. **Supabase project** — separate org from PadelHub's `nkvqbwdsoxylkqhubhig`. Record `project_ref` + anon key + service role key.
3. **Vercel project** — reuse team `team_HYo81T72HYGzt54bLoeLYkZx`; new project linked to the GitHub repo. Env vars: `SUPABASE_URL` · `SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` (Edge Function use only).

**Acceptance:** `git push` triggers Vercel preview build on a blank Vite scaffold; env vars resolve.

### Step 1 — Vite scaffold
Use PadelHub boot patterns:
- Vite + React 18 + PWA plugin (service worker + `manifest.webmanifest`).
- Inline splash screen HTML (visible before JS hydrates — kills the cold-start flash).
- `index.css` global safe-area CSS + dark-theme default.
- Plain-object React Context (no `useMemo` cascades — CLAUDE.md Rule #8).
- `ErrorBoundary` at the route layout level.
- Supabase client singleton + `onAuthStateChange` subscription.

**Acceptance:** welcome screen renders; auth state changes (mock `signInWithPassword`) flip route layouts.

### Step 2 — Run migrations
Execute the 11 migration files in order via `npx supabase db push` (work PC — global install is broken; always use `npx`). Verify on the Supabase SQL editor: 20 tables present, 20 RPC functions present, RLS enabled on every table, 7 `app_settings` rows seeded, super-admin row present.

**Acceptance:** `SELECT * FROM seasons` returns one row; `SELECT * FROM profiles WHERE role='super_admin'` returns `m.muwahid@gmail.com`.

### Step 3 — First feature slice
Auth + welcome + self-signup pending flow → admin approval → ref entry unlock → Poll screen. This slice exercises:
- Route layouts (auth-aware)
- `pending_signups` INSERT + admin approval via `approve_signup` RPC
- `ref_tokens` generation + SMS stub (Phase 2 = real SMS)
- §3.7 Poll screen state machine up to State 3 (voted, pre-lock)

**Acceptance:** super-admin approves a pending signup; approved player signs in and commits a poll vote; committed_at row visible in `poll_votes` with correct ordering.

### Step 4+ — Remaining Phase 1 screens
Follow §3 section order: §3.13 Leaderboard · §3.14 Profile · §3.15 Match-detail · §3.16 Settings · §3.17 Admin players · §3.18 Admin matches · §3.19 Formation planner · §3.1-v2 Captain helper. Each slice ends with a Vercel preview deploy + smoke test.

---

## Deferred to post-V2.8

| Item | Why | When to revisit |
|---|---|---|
| Brand palette re-alignment | User chose to keep red+navy in S012 | If user surfaces it |
| Masterplan Sections 4 · 5 · 6 | Operational runbook · rollout plan · post-Phase-1 roadmap | After Phase 1 implementation begins |
| Captain auto-pick on lock | Explicit Phase 2 | Season 2 planning |
| Wide-viewport Formation two-column | §3.19 Phase-2 deferred | If user requests desktop-first flow |
| Leaderboard format filter | Decision B(i) kept it unified for V2.8 | If format split is useful post-launch |
| Profile format split | Decision C(i) kept it unified for V2.8 | Same as above |

---

## Close-out

V2.8 is the consolidation doc for everything S009–S013 added on top of V2.7. The design spec itself (`docs/superpowers/specs/2026-04-17-ffc-phase1-design.md`) remains the single authoritative source of truth — V2.8 is the condensed handoff-to-implementation view.

Next authoritative actions (S014 continuation):
1. **Formal Phase 1 approval** — flip CLAUDE.md status header from "Brainstorming (pre-implementation)" to "Design Phase 1 APPROVED — implementation ready".
2. **Logo rollout** — blocked on user asset export.
3. **Implementation kickoff** — Steps 0–2 above; probably its own session given scope.
