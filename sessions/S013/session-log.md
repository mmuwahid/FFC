# Session S013 — 21/APR/2026 (Home PC)

**Focus:** Section-by-section review of the Phase 1 design spec + 5v5/7v7 multi-format feature spec + drift reconciliation + WIP archive.

**Outcome — partial close:**
- **All 10 section reviews completed.** §1 · §2 (all 9 subsections) · §3.0 · §3.2–§3.6 walked through with user; 23 spec edits applied.
- **5v5/7v7 multi-format spec LANDED** across 10 surfaces (enum, 2 cols, 2 helpers, 1 CHECK expansion, RPC convention table, §3.5/§3.6/§3.7/§3.18/§3.19 text + AC + template).
- **S012 CSS contracts persisted** into §3.14 + §3.19 acceptance criteria (flex-shrink:0 defensive rule · sticky-tabbar pattern · native select GK picker).
- **3 WIP files archived** — all content already integrated into the master spec.
- **Formal Phase 1 approval DEFERRED** to S014 (masterplan V2.8 should land first).
- **Logo rollout DEFERRED** — user still to export transparent PNG/SVG from `shared/FF_LOGO_FINAL.pdf`.

---

## Item 1 — Section 1 non-goal inconsistency fix

**Problem (flagged at S012 close).** Line 43–44 of the design spec had two overlapping non-goals:
- "Captain draft flow (Phase 2)"
- "Automated captain **pick** on roster lock (Phase 2 — Phase 1 only provides the advisory helper screen; admin still picks and types the two teams in manually)"

Both contradicted S009–S011 additions — live manual captain draft (§3.7 State 6.5 via `draft_sessions` + `draft_picks` realtime) and post-lock captain reroll — which landed as Phase 1 scope.

**Fix.** Combined into one non-goal that correctly scopes auto-pick to Phase 2 while acknowledging captain helper + manual draft (with live visibility) + reroll as Phase 1. Added a trailing "S013 note" paragraph explaining the revision.

Also refreshed the stale top-of-file status block (lines 3–8 still claimed Sections 2 + 3.x were "not yet written" / "partial" — outdated by ~9 sessions).

---

## Item 2 — §2 Data Model walkthrough + S009–S011 delta consolidation

Walked subsection by subsection with user approval at each. All pre-existing DDL approved as-is; all S009–S011 deltas from masterplan V2.7 landed.

### §2.1 Enums
- Added `'rejected'` to `user_role` enum (§3.17 Admin Players rejected tab). V2.7 called this enum `profile_role` — that's naming drift; `user_role` is authoritative.
- Extended `notification_kind` with 6 new values: `dropout_after_lock` · `draft_reroll_started` · `reroll_triggered_by_opponent` · `captain_dropout_needs_replacement` · `formation_reminder` · `formation_shared`. (`position_changed` never made it into §2.1 so nothing to remove.)
- Added `draft_status` enum (`in_progress|completed|abandoned`) and `draft_reason` enum (`initial|reroll_after_dropout`) for live captain-draft sessions (§3.7 State 6.5).

### §2.2 Base entities
- Added `profiles.reject_reason TEXT` (nullable) + scope CHECK (`role='rejected' OR reject_reason IS NULL`). Populated by `reject_signup` RPC; surfaced in §3.17 Admin Players rejected tab.

### §2.3 Match data
- Added `match_players.substituted_in_by uuid REFERENCES profiles(id)` (nullable) + partial index (`WHERE substituted_in_by IS NOT NULL`). Populated by `promote_from_waitlist` RPC for post-lock dropout audit.

### §2.4 Poll + ref workflow
- No edits. Clean as-is.

### §2.5 Operational tables — **4 new tables landed**
- **`admin_audit_log`** — admin-only SELECT, append-only via `log_admin_action` helper. Admin_profile_id + target_entity + target_id + action + payload_jsonb + created_at. Two indexes: admin-recent + target-lookup.
- **`draft_sessions`** — live manual captain draft per matchday. Unique partial index enforces one active session per matchday. CHECK enforces completed_at consistency with status.
- **`draft_picks`** — line items for a draft session. Participant XOR (profile_id / guest_id). Pick_order unique per session.
- **`formations`** — captain-authored lineup + rotation plan per (matchday, team). `formations_pattern_valid` CHECK enumerates 7v7 patterns now (5v5 added in item 4 below).
- **3 new app_settings keys** seeded: `draft_stuck_threshold_hours` (6) · `reroll_cutoff_hours_before_kickoff` (12) · `poll_reminder_offset_minutes` (-2).

### §2.6 Views
- No edits. `v_match_commitments`, `v_season_standings`, `v_player_last5`, `v_captain_eligibility` all clean. Format-aware concerns (slot cap, captain min_matches) deferred to item 4.

### §2.7 SECURITY DEFINER RPCs — **7 new RPCs landed (13 → 20)**
- **#14 `edit_match_result(match_id, edits jsonb)`** — post-approval correction (S004 Phase-1 backlog item that had no home).
- **#15 `promote_from_waitlist(matchday_id, departing_profile_id)`** — idempotent post-lock substitution.
- **#16 `accept_substitute(matchday_id)`** — captain ack.
- **#17 `request_reroll(matchday_id)`** — captain-triggered reroll. Validates cutoff + single-active-session rule.
- **#18 `submit_draft_pick(draft_session_id, profile_id, guest_id)`** — captain-turn pick. Flips current_picker_team. Completes draft at roster_cap-th pick.
- **#19 `upsert_formation(matchday_id, team, pattern, layout_jsonb, rotation_order, starting_gk_profile_id)`** — captain-only.
- **#20 `share_formation(formation_id)`** — sets shared_at + fires `formation_shared` push. 10-min duplicate guard.
- **Admin-audit convention paragraph** added: every admin-role RPC calls the private `log_admin_action(target_entity, target_id, action, payload)` helper before returning. Helper is SECURITY DEFINER, not granted to anon/authenticated.
- **Error code matrix** — 14 ERRCODE values enumerated across the 7 new RPCs for app-layer routing.
- **Grants** block extended with 7 new function grants.

### §2.8 RLS policies — **4 new tables wired**
- `admin_audit_log` — admin-only SELECT (no direct writes; helper runs elevated).
- `draft_sessions` + `draft_picks` — public SELECT (drives §3.7 State 6.5 live visibility for the whole roster), writes RPC-only.
- `formations` — conditional player SELECT (`is_admin() OR shared_at IS NOT NULL OR last_edited_by = current_profile_id()`) — captain's draft stays private until Share; admin always sees everything.

### §2.9 Migration file layout
- Note added that the 4 new tables land in `0005_operational.sql` rather than spawning a new migration file (FK dependencies all resolve to prior files). RPC count ballooned from 13 → 20.

---

## Item 3 — §3.0 + §3.2–§3.6 walkthrough + 10 drift fixes

§3.0 Safe-area was clean (no edits). §3.2–§3.6 were approved in S002 **before** §2 DDL existed, and 10 drift points had accumulated. All fixed against the authoritative §2 DDL (Section 2 is authoritative per CLAUDE.md Rule #7).

| # | Section | Drift | Fix |
|---|---|---|---|
| 1 | §3.2 | Example query used `home_score/away_score/played_at/user_id` (never existed) | Rewrite to query `v_player_last5` view |
| 2 | §3.3 | `pending_signups` column list had `intent`/`target_profile_id` (never existed) | Rewrite to match §2.2 (`auth_user_id`, `claim_profile_hint`, `resolution`, etc.) |
| 3 | §3.3 | Role model said `profiles.is_admin boolean` | Replace with `role user_role` enum |
| 4 | §3.3 | Rejected flow deleted pending row | Update: `reject_signup` creates `profiles` ghost row with `role='rejected'` + `reject_reason` for audit, resolves pending to `resolution='rejected'` |
| 5 | §3.4 | `pending_match_entries` shape had `home_score/away_score/ref_token_id` | Rewrite to match §2.4 (`score_white/score_black/submitted_by_token_id` + status enum) |
| 6 | §3.4 | `ref_tokens.used_at` | Rename to `consumed_at` |
| 7 | §3.5 | "Per-guest goals stored on `match_guests.goals_scored`" (wrong — Section 2 prologue flagged this in S003; never fixed until now) | Rewrite: stats live on `match_players` rows with `guest_id` set, per §2.3 XOR CHECK |
| 8 | §3.5 | "`update_guest_stats` RPC to be added" | Remove qualifier; RPC exists (§2.7 #13), admin screen exists (§3.18) |
| 9 | §3.6 | `voted_at`/`status` enum/`bigserial PK`/`invited_at` — 4 column-name drifts | Wholesale rewrite of data-model notes block to match §2.4 (`committed_at`/`cancelled_at` soft-delete/uuid PK/`match_guests.created_at`) |
| 10 | §3.6 | "Your position changed" notification | Remove — never landed in enum; add Phase-2 opportunity paragraph explaining the deliberate cut |

---

## Item 4 — 5v5/7v7 multi-format feature spec

User-approved plan: season default + per-matchday override. 10 edit surfaces touched.

### 4 open decisions resolved
| # | Decision | Locked |
|---|---|---|
| A | Captain min-matches threshold in 5v5 | **(i) Keep at 5 regardless** — simpler; revisit if nobody qualifies mid-season |
| B | Leaderboard across formats | **(i) Unified** — points = 3W+1D+penalties regardless of format; keeps §3.13 intact |
| C | Player profile stats — format split? | **(i) Unified** — same reasoning as B |
| D | Season default format storage | **(i) Per-season only** (no global app_settings fallback) |

### Edits applied (10 surfaces)
| Surface | Edit |
|---|---|
| §2.1 | `CREATE TYPE match_format AS ENUM ('7v7','5v5')` |
| §2.2 | `seasons.default_format` (NOT NULL DEFAULT '7v7') + `matchdays.format` (nullable — inherit) |
| §2.5 | 2 new helper functions: `effective_format(matchday_id) → match_format` (COALESCE of matchday override → season default) · `roster_cap(format) → int` (14 for 7v7, 10 for 5v5, IMMUTABLE). Extended `formations_pattern_valid` CHECK to include `1-2-1 · 2-1-1 · 1-1-2` (5v5 patterns) as well as `custom`. |
| §2.7 | Format-awareness convention paragraph + table enumerating which RPCs resolve format via the helper (#2 create_match_draft array sizing · #10/#11 captain picker scope · #12 captain validation · #18 submit_draft_pick completion check · #19 formation pattern validation). Grants extended for both helpers. |
| §3.5 | Guest slot count parameterised: `slots = max(0, roster_cap − confirmed − guests)`. Wed 8:15 PM unlock condition parameterised. |
| §3.6 | Waitlist boundary parameterised: "first N confirmed" where N = `roster_cap`. `v_match_commitments` unchanged (it orders; caller derives cap). |
| §3.7 | State table amended for state 3/4/5/6.5/8 — status card copy "You're in — spot #N of {roster_cap}"; state 8 roster split into `roster_cap/2` rows per team. Rendering contract amended (rank range 1..roster_cap). |
| §3.18 | Phase 1 gets a Format chip on the matchday card (next to date). Phases 2/4 confirmation text and drag-form enforce `roster_cap/2`. Phase 5.5 pick count shows `[n] of {roster_cap}`. New Matchday-creation sub-section documenting the Format chip + mid-poll format-change warning. |
| §3.19 | 5v5 pattern coordinate table added (1-2-1 · 2-1-1 · 1-1-2). Pattern chip picker filtered client-side by `effective_format`. Roster size parameterised in Purpose / upsert_formation / rotating-GK (rotation 1..roster_cap/2 − 1 = 1–6 for 7v7, 1–4 for 5v5). 13th acceptance criterion added. |
| app_settings seed | `whatsapp_share_templates.plus_one_unlock` template uses `{{roster_cap}}` placeholder (substituted at render time). |

---

## Item 5 — §3.14 + §3.19 S012 CSS contract persistence

S012 fixed two mockup bug families mechanically but the DDL-proximate specs never captured the contracts. Added now:

- **§3.14 acceptance criteria** — 2 new checklist items: (a) `.card { flex-shrink: 0 }` to prevent flex-column compression on long content; (b) `.tabbar { position: sticky; bottom: 0; margin-top: auto; flex-shrink: 0 }` with a hard-no on `position: absolute; bottom: 0` (pins to scroll content, not viewport). Plus the rule "no hard-coded `.phone-inner { padding-bottom: Npx }`" — sticky reserves its own space.
- **§3.19** — 2 paragraphs appended under theme/safe-area:
  - **Layout contract:** defensive `.phone-inner > * { flex-shrink: 0 }` rule covering every direct child (team-strip, pattern row, pitch wrapper, GK card, roster, share CTA). Explained the flex-spec pathology (`overflow: hidden` on a flex item triggers `min-height: auto → 0` which enables compression to 0).
  - **GK-picker contract:** native `<select class="gk-select">` dropdown (S012 replaced the S010 radio-card list) — 87 px tall vs 180 px, keeps the GK card within flex budget regardless of roster.

Both sections point to `tasks/lessons.md` S012 entries for diagnostic walkthroughs.

---

## Item 8 — WIP file archive

3 files moved from `_wip/` to `archive/` (`cp` + `rm` instead of `mv` because OneDrive locks `mv`):
- `item-b-draft-reroll-spec.md` (329 lines — §3.7 State 6.5 + captain reroll)
- `item-formation-planner-spec.md` (§3.19 Depth-B)
- `item-settings-v2-amendments.md` (§3.16 dark default + pill toggles)

All three had their content integrated into the master spec during S011. `_wip/` is now empty.

---

## Deferred to S014

| # | Item | Why deferred |
|---|---|---|
| 6 | Logo rollout | User has not yet exported transparent PNG/SVG from `shared/FF_LOGO_FINAL.pdf` |
| 7 | Formal Phase 1 approval | Cleaner to land after V2.8 masterplan |
| 9 | Masterplan V2.8 | Substantial consolidation doc (350–500 lines est.); deserves a fresh-session focus |
| 10 | Phase 1 implementation kickoff | GitHub repo + Supabase project + Vite scaffold — full session's worth |
| 11.a | Brand palette re-alignment | User deferred in S012; still on the backburner |

---

## Durable rules learned this session

No new durable UI/CSS rules (S012 captured them already). **One new feedback rule surfaced** mid-session and was saved to memory:

- **`feedback_table_presentation.md`** — when presenting DB/spec tables or multi-field decisions, render as markdown tables, not prose walls. Surfaced during §2.4 review ("a wall of text is hard to read").

---

## Authoritative files at S013 close

- `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` — Phase 1 design spec. Feature-complete + drift-free as of S013. §1 ✅ · §2.1–§2.9 ✅ + S013 additions · §3.0–§3.19 ✅.
- `planning/FFC-masterplan-V2.7.md` — latest; V2.8 queued for S014.
- 9 phone-frame mockups in `.superpowers/brainstorm/635-1776592878/content/` — unchanged this session.
- `tasks/lessons.md` — unchanged this session (S012 rules still authoritative).
- `archive/` — 3 integrated WIP files moved here.
- `_wip/` — empty.

**Stats (approx):**
- Design spec grew from ~2,940 lines (S012 close) to ~3,100 lines (S013 close).
- 23 distinct edits applied this session (3 item-1 + 14 item-2 + 10 item-3 + 14 item-4 + 4 item-5 across 7 subsections — some edits counted in multiple items).
- RPC count: 13 → 20.
- Table count: 16 → 20.
- Enum count: 15 → 18.

---

## Handoff to S014

**Cold-start checklist:**
- Read CLAUDE.md (S013 summary at top), `sessions/INDEX.md` (S013 row), `sessions/S013/session-log.md` (this file).
- Memory auto-loads: all prior rules + new `feedback_table_presentation.md`.

**S014 agenda (priority order):**

1. **Write masterplan V2.8** — consolidate all S013 deltas on top of V2.7. ~350–500 lines expected. The doc is the condensed handoff-to-implementation view; the spec itself remains authoritative.
2. **Logo rollout** (only if user has exported the assets to `shared/`):
   - Transparent PNG at 512/192/180/32 + SVG master
   - Wire into welcome + all FFC-avatar surfaces across the 9 mockups
   - PWA manifest icon set note in V2.8
   - WhatsApp OG image 1200×630 note
3. **Formal Phase 1 approval** — flip CLAUDE.md status from "Brainstorming" to "Design Phase 1 APPROVED — implementation ready". Requires user "approved".
4. **Phase 1 implementation kickoff** (if scope permits — probably its own session):
   - Create GitHub repo `mmuwahid/FFC`
   - Create Supabase project (separate from PadelHub's `nkvqbwdsoxylkqhubhig`)
   - Scaffold Vite React PWA inside `ffc/` using PadelHub boot patterns
   - Env vars on Vercel (new project, reuse team `team_HYo81T72HYGzt54bLoeLYkZx`)
5. **Brand palette re-alignment** — still deferred. Revisit if the user surfaces it.
6. **Close S014** — session log · INDEX · CLAUDE.md · todo.md S015 plan.
