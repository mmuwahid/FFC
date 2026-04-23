# Session Log — 2026-04-23 — Session028 — S027 backend items + §3.19 Formation Slices A+B+C

**Project:** FFC
**Type:** Build/Fix
**Phase:** Phase 1 Step 4 — Depth-B slices (S027 carry-over backend + §3.19 new screen, Slices A+B+C shipped)
**BU:** Muwahid Dev
**Duration:** Deep (45 min+)
**Commits:** `8a753cd`, `c6bfb89`, `03bbcf5`, `e78ee99`, `f489c14`, `7e9a890`

---

## What Was Done

### Cold-start sync (work PC)
- Confirmed work PC (`UNHOEC03`), `.git` pointer correct, clean tree, up to date with `origin/main` (`c8815bc`).
- Noted S027 was a Matches-flashcard planning session (two commits `20e8e49`+`db681ba` already landed) — this session is S028.
- User directive: skip S026 live acceptance pass; proceed straight to implementation.

### Slice 1 — `v_match_commitments` view extension
- Migration `0020_v_match_commitments_guest_id.sql` — `CREATE OR REPLACE VIEW` adds trailing `guest_id uuid` column (NULL on player branch, `match_guests.id` on guest branch). Preserves existing grants.
- `Poll.tsx:172` — select list now pulls `guest_id`; slot-to-row mapping switched from `display_name` string match to pk lookup (`r.guest_id ? guestMdRows.find(g => g.id === r.guest_id) : null`).
- Types regenerated via `npx supabase gen types typescript --linked 2>/dev/null` (1917 LOC → `guest_id` visible on view row).
- Applied live. Note: folder confusion — the parallel S027 session planned a DIFFERENT migration 0020 for `seasons.planned_games`. **Migration numbering conflict already landed** — my 0020 is `v_match_commitments_guest_id`; if/when S028 plan executes, it will need renumber to 0022.

### Slice 2 — Draft override RPCs + Phase 5.5 UI wire-up
- Migration `0021_admin_draft_override_rpcs.sql` — two SECURITY DEFINER admin RPCs:
  - `admin_draft_abandon(p_matchday_id uuid, p_reason text DEFAULT NULL)` → flips `draft_sessions.status` to `'abandoned'`, leaves picks intact for audit.
  - `admin_draft_force_complete(p_matchday_id uuid, p_reason text DEFAULT NULL)` → iterates unpicked `match_players` rows (ordered by `created_at`), inserts `draft_picks` alternating teams from `current_picker_team`, updates `match_players.team`, flips status to `'completed'`. Raises `FFC_ALREADY_AT_CAP` if already at roster cap.
  - Both audited via `log_admin_action`; both `GRANT EXECUTE TO authenticated`.
- `AdminMatches.tsx` — Sheet union gets `draft_force_complete` / `draft_abandon` kinds; `MatchdayCard` + `DraftInProgressCard` accept callbacks; previously-disabled stuck buttons swapped for live `SimpleConfirmSheet` openers with toast + refresh.
- Applied live. DB now at migration 21.

### Slice 3 — §3.19 Formation Planner Slice A (foundation)
- `src/lib/formationPresets.ts` (new, 170 LOC) — preset data for all 9 patterns (6 × 7v7 + 3 × 5v5) + `CUSTOM_PATTERN` sentinel + `presetsForFormat` / `getPreset` / `rosterSizeForFormat` helpers. Coordinates percent-based on portrait pitch viewBox `0 0 100 150`.
- `src/pages/FormationPlanner.tsx` (new) — loads matches + matchdays + `effective_format` RPC + match_players + profiles + guests + existing `formations` row. Access gate: captain vs non-captain vs outsider. Team-coloured header strip, kickoff countdown, format chip, pattern chip picker (disabled for non-captains), pitch SVG with auto-populated tokens (GK-preference slot 0 fills), roster list with position pills, save button calling `upsert_formation`.
- `router.tsx` — moved `/admin/matches/:id/formation` to `/match/:id/formation` (captain-accessible, not admin-only); deleted 11-line admin stub.
- `index.css` (+177 LOC) — full `.fp-*` CSS namespace.
- Verification: `tsc --noEmit` clean, `vite build` clean.

### Slice 4 — §3.19 Slice B (drag-drop + custom pattern)
- Added `liveSlots: FormationSlot[]` state — initialized from preset via `useEffect`, mutated in place by pointer handlers. Left alone in custom mode so drag edits persist.
- `lastNamedPattern` state + `pitchRef` (HTMLDivElement) + `dragStateRef` (ref-based so pointermove doesn't re-render on every frame).
- `onTokenPointerDown` captures pointer, records `{ slotIdx, pointerId }`. No-op for non-captains.
- `onTokenPointerMove` maps `(clientX, clientY)` → container percent → viewBox coords with bounds clamping (x 2..98, y 4..146). First movement auto-switches `pattern` to `CUSTOM_PATTERN`.
- `touch-action: none` inline on draggable tokens suppresses default mobile scroll-on-touch.
- `onSave` now serializes `liveSlots` (not preset). Pattern sent is the current state.
- Load path: when `fRow.pattern === 'custom'` and `layout_jsonb` is an array, hydrate `liveSlots` directly from saved rows (the preset-sync useEffect short-circuits on custom).
- Custom chip made interactive; "Reset to {last named}" button rendered beneath pitch when in custom mode.
- CSS: `.fp-tok--draggable` (grab cursor + active:scale 1.06).

### Slice 5 — §3.19 Slice C (rotating GK + starting-GK picker + rotation persistence)
- New types: `GkMode = 'dedicated' | 'rotate'`, `RotationRow { profile_id, rotation_number, is_starting_gk }`.
- State: `gkMode` (default `'dedicated'`) + `startingGkProfileId` (string | null). Both hydrated from existing formation row on load: rotate iff `formation_rotation_order` is non-empty array; starter pulled from the explicit column.
- Auto-default on fresh rotate toggle: slot-0 player if they are a profile member, else first profile member on the team. Guests excluded (FK constraint on `starting_gk_profile_id`).
- Derived: `profileMembers` (roster filtered to `kind='member'`), `rotationRows` (starter at 1, others 2..N in roster order), `rotByProfileId` Map for O(1) lookup.
- UI: segmented toggle (Dedicated / Rotate) + native `<select>` per S012 GK-picker redesign. Tokens: slot 0 always shows gold "GK" corner badge; in rotate mode, non-GK profile-member tokens show a dark rotation-number badge (inverted to light on BLACK team tokens). Roster list in rotate mode: trailing chip per row (GK gold / number / em-dash for guests).
- Save: `onSave` computes `rotationJsonb` (null in dedicated mode) + `gkProfileId` (profile-member slot-0 fallback when dedicated) and passes both to `upsert_formation`.
- CSS (+72 LOC): `fp-tok-gk-badge`, `fp-tok-rot-badge`, `fp-gk-mode`, `fp-gk-seg`, `fp-gk-card`, `fp-gk-select`, `fp-rot-chip`.

### Fix — deploy of Slice C failed, recovered in same session
- Vercel deploy `dpl_CDVKY7n8bPGmsgnruc4if4wYh6ZG` (commit `f489c14`) ERRORED — 4 TS errors that local `tsc --noEmit` missed but Vercel's `tsc -b` caught:
  1. `selectedPreset` memo left over from Slice A — Slice B moved to `liveSlots` as source of truth. Removed memo + unused `FormationPreset` type import.
  2. `upsert_formation` args — generated Supabase types use `Json | undefined` / `string | undefined` (not `null`). The `as unknown as null` cast compiled locally but failed strict-build. Switched to conditional spread (`...(rotationJsonb ? { p_rotation_order: ... } : {})`) + explicit `as unknown as Json` for `RotationRow[] → Json` widening (Json's index signature can't auto-satisfy RotationRow).
  3. `admin_draft_force_complete` + `admin_draft_abandon` calls in `AdminMatches.tsx` — same `null` vs `undefined` issue on `p_reason`. Removed the field entirely (RPC has DEFAULT NULL server-side, so omitting is equivalent).
- Fix commit `7e9a890` pushed; Vercel deploy `dpl_A2LF7PLNjw2oVB9wbdcYDaixzRva` READY. Live at https://ffc-gilt.vercel.app.

---

## Files Created or Modified

### Commit `8a753cd` — Slice 1 — 3 files
- `supabase/migrations/0020_v_match_commitments_guest_id.sql` (new)
- `ffc/src/pages/Poll.tsx` (2 small edits)
- `ffc/src/lib/database.types.ts` (regenerated)

### Commit `c6bfb89` — Slice 2 — 3 files
- `supabase/migrations/0021_admin_draft_override_rpcs.sql` (new)
- `ffc/src/pages/admin/AdminMatches.tsx` (Sheet union + MatchdayCard props + 2 new SimpleConfirmSheet branches)
- `ffc/src/lib/database.types.ts` (regenerated)

### Commit `03bbcf5` — §3.19 Slice A — 5 files
- `ffc/src/lib/formationPresets.ts` (new)
- `ffc/src/pages/FormationPlanner.tsx` (new)
- `ffc/src/pages/admin/FormationPlanner.tsx` (deleted — 11-line stub)
- `ffc/src/router.tsx` (route moved)
- `ffc/src/index.css` (+177 LOC)

### Commit `e78ee99` — §3.19 Slice B — 3 files
- `ffc/src/pages/FormationPlanner.tsx` (drag-drop state + pointer handlers + custom mode)
- `ffc/src/index.css` (+3 LOC)
- `ffc/src/router.tsx` (comment tweak — HMR cache-bust)

### Commit `f489c14` — §3.19 Slice C — 2 files
- `ffc/src/pages/FormationPlanner.tsx` (gkMode + startingGkProfileId + rotationRows + UI)
- `ffc/src/index.css` (+72 LOC)

### Commit `7e9a890` — deploy fix — 2 files
- `ffc/src/pages/FormationPlanner.tsx` (removed unused memo + fixed args types)
- `ffc/src/pages/admin/AdminMatches.tsx` (removed `p_reason: null`)

## Key Decisions
- **Skip S026 live acceptance.** User directive: "skip testing will test later once app is ready move on to implementation." Backend items prioritized.
- **Order: #4 then #3 then #5.** View extension first (fastest win, zero UI), draft override RPCs second (unblocks Phase 5.5 buttons), §3.19 Formation third (multi-session, largest scope).
- **§3.19 route moved out of /admin.** Formation is captain-editable + team-readable, not admin-only. Route changed from `/admin/matches/:id/formation` → `/match/:id/formation`. Old admin stub deleted.
- **§3.19 scope split into 5 slices.** A (foundation) + B (drag-drop + custom) + C (rotating GK) all shipped this session; D (realtime + share_formation + notes) + E (entry links from Poll/AdminMatches/MatchDetail) deferred.
- **Guests excluded from GK pool.** `starting_gk_profile_id` FKs `profiles`, so guests never rotate into goal — they stay outfield only. Matches V2.7 §13 data model.
- **Reset button surfaces only in custom mode.** Prevents accidental preset re-selection when the captain just wants to save a custom drag layout.

## Open Questions
- **Migration 0020 conflict** — S027's plan at `docs/superpowers/plans/2026-04-23-matches-flashcard-plan.md` designates migration `0020_seasons_planned_games.sql`. This session already landed `0020_v_match_commitments_guest_id.sql`. Whoever executes the Matches flashcard plan next must renumber to `0022_seasons_planned_games.sql`. — Mohammed/next-session — Urgent (before plan execution).
- Should `formation_rotation_order` JSON shape be validated via DB CHECK? Currently JSON only by convention. — Mohammed — When Possible.
- Should the GK mode choice persist as its own column on `formations`, or is inferring from `formation_rotation_order IS NULL` sufficient? Current code infers; works fine. — Mohammed — When Possible.

## Lessons Learned

### Mistakes
| Date | Mistake | Root Cause | Prevention Rule |
|------|---------|------------|-----------------|
| 2026-04-23 | Vercel deploy of `f489c14` (Slice C) failed with 4 TS errors that local `tsc --noEmit` missed. | Local single-project `tsc --noEmit` doesn't run the `-b` / project-references path that `npm run build` triggers (`tsc -b && vite build`). Strict-build is stricter: unused variables, Supabase RPC arg types. | **Before pushing, run `node ./node_modules/typescript/bin/tsc -b` (project-refs build, same as Vercel) — not just `tsc --noEmit`.** |
| 2026-04-23 | Used `null as unknown as null` to pass nullable RPC args. | Generated Supabase types use `Json \| undefined` / `string \| undefined` for optional RPC parameters — `null` is never accepted. | **For optional Supabase RPC args with DEFAULT NULL server-side, always *omit* the field via conditional spread rather than passing `null`. For JSON-typed args that come from strongly-typed local types, use `as unknown as Json` to widen.** |
| 2026-04-23 | Used migration number 0020 without checking the pending plan in `docs/superpowers/plans/`. | Parallel S027 session had committed a plan referencing 0020 but never executed it. | **Before picking a migration number, `ls supabase/migrations/` AND grep `docs/superpowers/plans/` for unexecuted plans referencing `NNNN_*.sql`.** |

### Validated Patterns
- [2026-04-23] Extract-to-module for coordinate-heavy data — `formationPresets.ts` keeps 170 LOC of coordinates out of the page component. **Why:** data-in-page would have exploded FormationPlanner.tsx past 800 LOC; component stays focused on state + render.
- [2026-04-23] Ref-based drag state — `dragStateRef` holds `{ slotIdx, pointerId }` mutated at every pointermove. **Why:** useState would trigger a re-render cycle on every pointer move; ref keeps renders limited to slot-position updates only.
- [2026-04-23] Slice-size discipline on big features — §3.19 Formation is a multi-session spec; splitting into A/B/C/D/E with explicit "deferred to later slices" in each slice's file-header doc comment makes progress legible and lets each slice land with green builds + clean commit messages.
- [2026-04-23] Conditional spread for optional RPC args — `...(gkProfileId ? { p_starting_gk_profile_id: gkProfileId } : {})` is cleaner than a type-cast workaround and produces the right runtime JSON (key absent vs key: null). **Why:** matches generated types exactly without `as`-cast escape hatches.

## Next Actions
- [ ] **Migration renumber** — if/when S027 plan executes, rename `0020_seasons_planned_games.sql` → `0022_seasons_planned_games.sql`. — Mohammed / next session — Urgent.
- [ ] **Live acceptance pass on S026 scope items** (still deferred from S027 agenda) — Poll §3.7 nine states, Leaderboard gate, AdminMatches stat-edit toggle, Phase 5.5 card, friendly auto-flag trigger.
- [ ] **Live acceptance pass on S028 (this session) shipped items** — Poll guest-id refactor, Phase 5.5 override buttons, §3.19 Formation Slices A+B+C (captain can open /match/:id/formation, pick a pattern, drag tokens, toggle rotating GK, pick starting GK, save).
- [ ] **§3.19 Slice D** — realtime subscription on `formations` table + `share_formation` RPC + "last synced" chip + captain's notes persistence.
- [ ] **§3.19 Slice E** — entry links from Poll State 8 / AdminMatches matchday card / MatchDetail sheet.
- [ ] **Captain reroll modal** (S010 subagent-B spec, `_wip/item-b-draft-reroll-spec.md`) — still blocked on Phase-1 notifications surface for `dropout_after_lock`.
- [ ] **§3.1-v2 Captain helper screen** — multi-session; once shipped, Phase 5.5 + Poll State 6.5 get real data to exercise.
- [ ] Backburner unchanged: vector FFC crest SVG (user export); palette re-align (red+navy → khaki-gold+cream).

---

## Commits and Deploy
- **Commit 1:** `8a753cd` — `refactor(poll): use v_match_commitments.guest_id instead of display_name join`
- **Commit 2:** `c6bfb89` — `feat(admin): §3.18 Phase 5.5 draft override RPCs — unblock stuck-draft buttons`
- **Commit 3:** `03bbcf5` — `feat(formation): §3.19 Slice A — planner scaffold + pattern presets + route`
- **Commit 4:** `e78ee99` — `feat(formation): §3.19 Slice B — drag-drop tokens + custom pattern mode`
- **Commit 5:** `f489c14` — `feat(formation): §3.19 Slice C — rotating GK + starting-GK picker + rotation persistence`
- **Commit 6:** `7e9a890` — `fix(build): TypeScript strict-build errors on Vercel deploy of Slice C`
- **Deploy:** `dpl_A2LF7PLNjw2oVB9wbdcYDaixzRva` READY (commit `7e9a890`)
- **Live:** https://ffc-gilt.vercel.app
- **Migrations on live DB:** 21 (0001 → 0021_admin_draft_override_rpcs)

---
_Session logged: 2026-04-23 | Logged by: Claude (session-log skill) | Session028_
