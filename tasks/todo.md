# FFC Todo

## NEXT SESSION — S041

**Cold-start checklist:**
- **MANDATORY session-start sync** per CLAUDE.md Cross-PC protocol.
- Expected tip: `<S040 close commit>` or later (S040 slice 2B-A close).
- Migrations on live DB: **28** (Phase 2B foundation landed).

**S041 agenda:**

1. **Slice 2B-B** — admin "Generate ref link" button on AdminMatches matchday cards. Wire to `regenerate_ref_token` RPC; show URL once with copy-to-clipboard + WhatsApp share-intent button + 🔄 regenerate button. Token-expires-in countdown chip.
2. Carry-over backlog still pending acceptance: S031 21-item checklist, S032/33/34/35 acceptance items.
3. Captain reroll live test — deferred until MD31 runs in-app.
4. **Backburner unchanged.**

**Backburner:**

- **Email notification on approve/reject** — when admin approves or rejects a signup, send a transactional email to the player so they know to open the app (or that their application was declined). Implementation path: Supabase Edge Function (`notify-signup-outcome`) triggered by a database webhook on `pending_signups.resolution` changing from `pending` → `approved`/`rejected`. Email provider: [Resend](https://resend.com) free tier (100 emails/day, no card). Approved email: "Welcome to FFC — you're in, open the app and start voting." Rejected email: "Your FFC signup wasn't approved — contact an admin." Edge Function needs `RESEND_API_KEY` env var in Supabase project settings.

## Completed in S040 (26/APR/2026, Home PC)

### Slice 2B-A — Live Match Console backend foundation

- [x] **Migration 0028 `0028_phase2b_match_events.sql`** authored, code-review fixed, applied to live DB.
  - `match_event_type` enum (8 values: goal · own_goal · yellow_card · red_card · halftime · fulltime · pause · resume).
  - `pending_match_events` + `match_events` tables with participant XOR + minute non-negative checks, ordinal index.
  - 5 timing columns added to `pending_match_entries` + `matches` (nullable on matches; default 0 stoppage on pending).
  - RLS: pending events admin-select; permanent events authenticated-select (USING true).
  - `regenerate_ref_token(matchday_id)` admin RPC — burns active tokens (advisory-locked), mints fresh 6h, returns raw base64url string.
  - `submit_ref_entry` rewritten (DROP+CREATE) to read `events` + `timing` payload keys (backwards-compatible).
  - `approve_match_entry` rewritten with sentinel-guarded timing copy + event-log promotion.
- [x] **Code review fixes** (`08ddfbf`) on top of authoring commit `a8c23b5`:
  - `approve_match_entry` timing-overwrite guard (CASE WHEN v_pme.kickoff_at IS NOT NULL) prevents nulling matches.* timing on admin-direct approval.
  - `regenerate_ref_token` advisory lock (`pg_advisory_xact_lock(hashtext('regenerate_ref_token:' || p_matchday_id::text))`) prevents dual-token mint under concurrent admin calls.
- [x] Types regenerated: `ffc/src/lib/database.types.ts` (2183 lines, was 1916).
- [x] Build clean: tsc -b EXIT 0 + vite build EXIT 0.
- [x] No UI changes — `RefEntry.tsx` still stub (slice 2B-B opens that work).
- [x] **Migrations on live DB: 28 (0001 → 0028).**

### S040 gotchas / lessons (additive)

- **Migration number renumber pattern.** Phase 2 design spec hardcoded "0029" for Track 2B because it was authored before build-order locked. Build-order locked Track 2B FIRST (concrete, single screen, soak-test on real matchdays), so 2B's migration claimed 0028 instead. Resolved with one-line spec patch in the same commit as the migration. Pattern: when a spec hardcodes a migration number, confirm build-order before applying.
- **`gen_random_bytes` → base64url for tokens.** Postgres `encode(..., 'base64')` produces base64 with `+`, `/`, `=` chars. Three `replace()` calls turn it into URL-safe base64url. (`gen_random_uuid()` is simpler but produces 36 chars including hyphens; 24 random bytes → ~32 base64url chars feels more "token-like".)
- **Two-statement burn-then-mint needs an advisory lock.** Under snapshot isolation, two simultaneous calls to `regenerate_ref_token` could both see the same unconsumed row, both UPDATE it (idempotent), both INSERT a new row → two active tokens. `pg_advisory_xact_lock` per-matchday-per-transaction serialises the pair. Caught by code review before going live.
- **Approve-path timing copy needs a sentinel.** Admin-direct match submissions don't carry timing; the `approve_match_entry` rewrite was unconditionally writing pending's NULL timing into matches.*, nulling out any existing values. Fix: `CASE WHEN v_pme.kickoff_at IS NOT NULL` as sentinel — copy all 5 timing cols if pending has timing data, otherwise leave matches.* alone. Caught by code review before applying.
- **`DROP FUNCTION IF EXISTS` before `CREATE OR REPLACE` for rewrites.** Even when signature is unchanged, dropping first ensures no shadow function sticks around if param defaults change in a future revision. Costs a microsecond at apply time, removes a class of bugs.

## Completed in S038 (25/APR/2026, Work PC)

### P1 — Cream-bg PWA + share-preview polish (`a44f1fb`)

- [x] Generator script `_wip/gen_cream_assets_s038.py` (PIL 12.2; bbox + LANCZOS pattern; gitignored).
- [x] `og-image.png` 1200×630 cream `#f2ead6` bg + 80% inset full FFC crest. Was dark navy with cropped shield.
- [x] `ffc-logo-180.png` Apple touch — cream bg + 78% inset (was brand navy).
- [x] `ffc-logo-maskable-512.png` Android adaptive — cream bg + 60% safe-zone inset.
- [x] `index.html` meta updates: `og:description` + `twitter:description` → "The official Home of the FFC." + `?v=2` cache-buster on og:image (forces WhatsApp scrape refresh) + added `<meta name="twitter:description">`.
- [x] `PublicLayout.tsx` topbar stripped — auth screens already render own crest; topbar from `3573761` was redundant on Login/Signup/PendingApproval.
- [x] Transparent `any`-purpose icons (`ffc-logo-32/192/512.png` + `ffc-logo.png`) untouched, as planned.
- [x] Build clean: tsc -b EXIT 0 + vite build EXIT 0 (PWA 11 entries / 1483 KiB).
- [x] Vercel deploy `dpl_13J5zwtKekvJaQBmUQsr6fd4NxkW` READY ~17s.

### P2 — Ghost-claim routing fix for Barhoom (`4de4b05`)

- [x] **Diagnosis during code-read** revealed full claim infra ALREADY EXISTED (`Signup.tsx` Stage 2 ghost-picker + `pending_signups.claim_profile_hint` + migration 0008 `approve_signup(p_pending_id, p_claim_profile_id)`). Initial planned 7-step rebuild → reduced to 3-line routing fix.
- [x] `router.tsx` HomeRoute: `session && !role` → `<Navigate to="/signup" replace />` instead of `<PendingApproval />`. PendingApproval import removed.
- [x] `RoleLayout.tsx` defensive role-gate: `loading || profileLoading` → splash; `!session || !role` → `<Navigate to="/" replace />`. Prevents direct URL hits on `/poll`/etc. from rendering blank.
- [x] `AdminPlayers.tsx` ApproveSheet: green ✓ "Email matches" / amber ⚠ "Expected X, got Y" sanity banner when `ghost.email` is populated. Case-insensitive comparison.
- [x] **Pre-claim email seed via `DO $$ BEGIN ... END $$` block** (CLI rejects raw multi-statement query):
  - Barhoom (`0cc871e8…`) → `ahmed.abdallahh@hotmail.com`
  - Abood (`8dc6d6ba…`) → `amakkawi89@gmail.com`
  - Ahmed Saleh (`fc2b7ea6…`) → `ahmed_msaleh@hotmail.com`
  - Rawad (`c984bdce…`) → `rawadbn@gmail.com`
- [x] PendingApproval.tsx kept on disk but dead code (no import).
- [x] Build clean: tsc -b EXIT 0 + vite build EXIT 0 (PWA 1484 KiB).
- [x] Vercel deploy `dpl_Ge8bwT6Thc7kKbHgv2XJ67jDWeKX` READY ~22s.

## S038 gotchas / lessons (additive)

- **"Read existing code before designing the fix"** — initial P2 plan was a full feature build with new migration + new `claim_requests` table + 3 RPCs + new `Claim.tsx` page + AdminPlayers tab augmentation. Reading `Signup.tsx` (S019) + `AdminPlayers.tsx` (S025) revealed the entire flow was already 80% built. Final fix was 3 routing edits + 4-row UPDATE. Re-usable rule: when a user reports a bug in code you haven't touched in days, read relevant files end-to-end BEFORE designing the fix.
- **Multi-statement SQL via Supabase CLI requires DO block** — `npx supabase db query --linked "UPDATE ...; UPDATE ...;"` errors out with `String must contain at least 1 character(s)`. Wrap in `DO $$ BEGIN ... END $$` (single PL/pgSQL statement).
- **PIL bbox+LANCZOS asset-regen pattern** — `getbbox()` first to trim transparent padding, then scale preserving aspect, then centre on canvas. Inset percentages stay meaningful regardless of source padding. Re-usable for future PWA icon refreshes.
- **OG image cache-buster `?v=N`** is the safest way to force WhatsApp's scraper to re-fetch. WhatsApp aggressively caches by URL — old preview can stick for hours/days even after redeploy.
- **ApproveSheet email-match sanity banner pattern** — when admin UI confirms a destructive bind between two identity sources (auth email vs ghost expected email), surface both with colour-coded match indicator (✓ green / ⚠ amber). Cheap to implement, prevents wrong-claim binding which is permanent.

## Completed in S037 (24/APR/2026, Work PC)

- [x] **Migration 0026** `season_seed_stats` table + `v_season_standings` `CREATE OR REPLACE VIEW` rewrite UNIONing live aggregates with seeds. `CREATE OR REPLACE` (not DROP) required because `v_captain_eligibility` depends on the view.
- [x] **Migration 0027** — archived Test Player (role=rejected), `TRUNCATE ... RESTART IDENTITY CASCADE` across 15 transactional tables, inserted 39 ghost profiles (auth_user_id NULL) + 4 admins, inserted 40 Season 11 seed rows from user's external sheet.
- [x] Types regen 1916→1993 lines.
- [x] Verified live DB: 35 player + 4 admin + 1 super_admin + 2 rejected; top-15 leaderboard matches source sheet exactly.
- [x] **§3.15 Captain reroll modal** — Poll.tsx dropout card for captains in State 8 + confirmation sub-sheet + RPC wiring for `accept_substitute` + `request_reroll`; gold-tinted (S033 "attention" register). CSS under `.po-dropout-card` / `.po-dropout-sheet`.
- [x] **Logo rollout** — regenerated all PWA icons from `shared/FFC Logo Transparent Background.png`: `ffc-logo-32/180/192/512.png` + `ffc-logo-maskable-512.png` (60% safe zone) + Apple touch opaque with inset + generic `ffc-logo.png` + NEW `og-image.png` 1200×630 for WhatsApp/iMessage/Slack previews + OG + Twitter card meta tags in index.html.
- [x] Build clean: `tsc -b --force` + `vite build` (PWA 11 entries / 1340 KB, size dropped from 2541 KB).
- [x] 2 commits pushed (`53afc0e` + `0198450`); Vercel deploy green.

## S037 gotchas / lessons (additive)

- **Seed-aggregate table + UNION view pattern (new reusable)** — when backfilling historical totals without fabricating per-event rows: add a seed table keyed on (scope_id, entity_id) with the same aggregate columns the view sums, then in the view build a `combined` CTE UNIONing live CTE with seed table, LEFT JOIN both, COALESCE-sum each column. Preserves view signature → zero downstream TS changes.
- **`CREATE OR REPLACE VIEW` when dependents exist** — `DROP VIEW` failed because `v_captain_eligibility` depends. `CREATE OR REPLACE` works iff the column signature is unchanged (we summed into existing aliases, didn't add exposed columns).
- **Notifications payload filter client-side, not `.contains()`** — PostgREST's jsonb-contains filter is unreliable across Supabase JS client versions. Fetch a small bounded result (`.limit(5)`) and filter in JS.
- **TRUNCATE ... CASCADE across 15 tables** — single statement; CASCADE resolved child FKs. Order inside statement didn't matter. Atomic rollback on error preserved.
- **Apple touch + maskable PWA icon opacity pattern** — iOS masks to squircle, Android to circle. Transparent icon = hole in corners. Use opaque brand-bg + ~78% logo inset for Apple touch, ~60% inset for Android maskable (PWA "safe zone" spec). Regular `any` purpose icons stay transparent.
- **Ghost profiles as first-class entities** — `auth_user_id IS NULL` profiles are leaderboard-visible + rosterable but can't log in. Claim flow in S038 will merge auth into ghost row in-place (preserves stats + future history).

## Completed in S036 (24/APR/2026, Work PC)

- [x] 8 screens tokenised in one sweep: `.lb-screen` (Leaderboard), `.pf-screen` (Profile), `.mt-screen` (Matches), `.lr-screen` (Rules), `.st-screen` (Settings), `.admin-players`, `.admin-matches`, `.as-root` (AdminSeasons) + `.ah-root` (AdminHome).
- [x] Each root got the 12-token brand block (`--bg / --surface / --surface-2 / --border / --text / --text-muted / --accent / --success / --warn / --warning / --danger / --skel-a / --skel-b`) plus `background: var(--bg); color: var(--text);` anchor. Rest of app (auth screens, global root, portal overlays) intentionally untouched.
- [x] `tsc -b --force` EXIT=0; `vite build` EXIT=0 (PWA 2541 KB).
- [x] Preview smoke: 6/6 non-auth-gated routes render with brand tokens; AdminSeasons/AdminHome access-gate also on brand.
- [x] Session docs + commit/push + deploy.

## S036 gotchas / lessons (additive)

- **Per-root token declaration vs shared helper class** — considered abstracting the 12-line block into a `.brand-theme` helper, rejected: (a) each screen root has different layout properties that don't cleanly merge, (b) per-root declaration makes screen-level themeability explicit at edit-time, (c) zero abstraction tax. ~100 LOC of duplication is the correct trade-off for explicit adoption.
- **`--warn` + `--warning` dual alias** — screens use different naming conventions (`--warn` in Poll/Leaderboard, `--warning` in Profile). Defining both at the root scope means no app-wide rename needed; each screen's existing rules resolve correctly.
- **Preview harness quirk** — `window.location.href = X` destroys the JS execution context, so batched-visit scripts fail on the second iteration. Sequential `navigate → wait → inspect` per route is the correct pattern.


## Completed in S035 (24/APR/2026, Work PC)

- [x] Poll `.po-screen` brand tokenisation — 10-line scope-override at top of Poll CSS block.
- [x] Semantic-intent fix: Poll `--accent` overridden to gold `#e5ba5b` (was red via root), restoring original design intent for me-tag / avatar-self / guest-rating-strong / novote border / team-header-active.
- [x] `--warn` alias added (root has `--warning`, Poll uses `--warn`).
- [x] `.po-screen` root explicitly sets `background: var(--bg); color: var(--text);` to anchor the page colour.
- [x] `tsc -b --force` EXIT=0; `vite build` EXIT=0 (PWA 2539 KB).
- [x] Preview smoke: `.po-screen` computed `bg: rgb(14,24,38)` / `color: rgb(242,234,214)` — tokens resolving correctly. No console errors.

## S035 gotchas / lessons (additive)

- **Tokenisation playbook scales cleanly across screens** when the existing CSS is already var()-driven. Poll was a ~95-rule / 220-line surface; S035 touched 10 lines at the top of that block to flip the whole thing. This is a 20× better ROI than CaptainHelper's re-theme, which had to touch every rule.
- **Root `--accent` vs per-screen `--accent` intent diverged.** Root sets `--accent: #e63349` (red) which wins at every `var(--accent)` lookup. Poll's fallback `#c49a4b` (gold) suggested the original design wanted gold-for-accent. For Poll, overriding accent to gold inside `.po-screen` restored the intended semantic. Lesson: when root tokens and per-screen fallback hints disagree, trust the local fallback and override at the screen scope.
- **`--warn` vs `--warning` naming mismatch** — Poll uses `--warn` with fallbacks throughout; root defines `--warning`. Without explicit aliasing the fallback would fire. Worth normalising app-wide eventually but scope-local alias is fine.


**Known gotchas (unchanged + additions from S026):**
- **Session-start sync protocol** mandatory on cross-PC resume.
- **`ffc/vercel.json` SPA rewrite is load-bearing.**
- **Supabase email validator** rejects `example.com`. Use `m.muwahid+s###<role>@gmail.com`.
- **Supabase MCP PAT is PadelHub-scoped.** Use `npx --yes supabase@latest db query --linked "..."`.
- **`supabase gen types typescript --linked 2>/dev/null`** — stderr redirect mandatory.
- **Windows `&`-in-path bug** — Node direct-invocation pattern.
- **Terminal roles** auto-signOut in AppContext.
- **CLAUDE.md truncates UUIDs** — query `profiles` first when seeding SQL.
- **PWA service worker caches previous bundle** — hard refresh (Ctrl+Shift+R) after deploy if UI looks stale.
- **Mockup preview server rooted at `mockups/`** (S024) — URL is `http://localhost:5173/3-XX-xxx.html` (NOT `/mockups/3-XX-xxx.html`).
- **Schema drift discovery pattern** (S024+) — always query `information_schema.columns` BEFORE writing PostgREST embeds / order / filter clauses or plpgsql column refs. S024 caught `matchdays.venue` (not `venue_label`), no `matchday_number` column, no `late_cancel_*` columns. S025 caught `seasons.starts_on` (not `started_on`). **S026 caught:** `profiles.banned_until_matchday_id` doesn't exist (ban is `public.player_bans` table with `starts_at`/`ends_at`/`revoked_at`); `v_match_commitments` view exposes `guest_display_name` but NOT `match_guests.id` — caller must join client-side by display_name.
- **Position enum is UPPERCASE** (`GK`/`DEF`/`CDM`/`W`/`ST`) — TS will catch lowercase.
- **Leaderboard sort enum is `motm` not `motms`** — singular. TS will catch.
- **`team_color` not `team_colour`** — enum is American-spelling. plpgsql lazy-parses bodies so a `::public.team_colour` cast passes CREATE but fails at first call.
- **`log_admin_action` signature is 4-arg** — `(target_entity, target_id, action, payload)`. Admin is derived via `current_profile_id()` inside the function.
- **`edit_match_result` requires `approved_at IS NOT NULL`** — raises `FFC_EDIT_NOT_APPROVED` on pending matches. Top-level fields only (score/result/motm/notes), NOT nested `players`. For per-player post-approval corrections use `edit_match_players` (**NEW S026**) which whitelists goals/yellow_cards/red_cards/is_no_show/is_captain/team.
- **`admin_submit_match_result` raises `match_exists_use_edit_match_result`** if a matches row already exists for the matchday — the UI correctly swaps in the Edit result flow after first submit.
- **NEW (S026): `cast_poll_vote(matchday_id, choice)`** — `choice` is `'yes'|'no'|'maybe'|'cancel'`. The enum `poll_choice` has only yes/no/maybe; the RPC branches on the string before cast. Re-voting yes after cancel resets `committed_at` (anti-seat-hoarding per §3.6).
- **NEW (S026): `invite_guest(...)` 8-arg signature** — `(matchday_id, display_name, primary_position, secondary_position, stamina, accuracy, rating, description)`. Raises `FFC_INVITER_NOT_CONFIRMED` / `FFC_NO_GUEST_SLOT` / `FFC_POSITIONS_MUST_DIFFER`.
- **NEW (S026): `guest_friendly_thresholds` is in `app_settings`** — key value `{"7v7": 4, "5v5": 3}`. Trigger `trg_match_guests_friendly_flag` stamps `matchdays.friendly_flagged_at` on threshold cross (INSERT or cancel-reactivation). Short-circuits on already-flagged or already-confirmed matchdays.
- **NEW (S028): Vercel builds with `tsc -b` (project-refs mode), local `tsc --noEmit` is more lenient.** Four TS errors slipped through local `--noEmit` and broke deploy `dpl_CDVKY...`. Rule: before pushing, run `node ./node_modules/typescript/bin/tsc -b` (same as `npm run build` first half) — catches unused vars + stricter Supabase RPC arg typing.
- **NEW (S028): Supabase generated RPC arg types reject `null` for optional params.** Optional args show as `T | undefined`, not `T | null`. Passing `null as unknown as null` compiles locally but fails strict-build. Rule: omit the field via conditional spread (`...(x ? { p_field: x } : {})`) when you'd have passed null. For JSON-typed args coming from typed local objects, add `as unknown as Json` widening.
- **NEW (S028): Migration number collisions between parallel planning sessions.** S027 reserved 0020 in a plan file but never executed it; S028 grabbed 0020 for a different migration. Rule: before picking a migration number, also grep `docs/superpowers/plans/` for unexecuted plans referencing `NNNN_*.sql`.
- **NEW (S028): `v_match_commitments` now exposes `guest_id uuid`** — Poll.tsx maps guest commitments to match_guests rows by pk. Extension landed in `0020_v_match_commitments_guest_id.sql`; view re-created via `CREATE OR REPLACE VIEW` so existing grants preserved.
- **NEW (S028): `admin_draft_force_complete` + `admin_draft_abandon` RPCs.** Phase 5.5 override buttons now wired. Force-complete auto-distributes unpicked match_players alternating teams from `current_picker_team` (ordered by `created_at` for reproducibility); raises `FFC_ALREADY_AT_CAP` if invoked at roster cap. Abandon leaves draft_picks intact for audit.
- **NEW (S028): §3.19 Formation route lives at `/match/:id/formation`** (NOT `/admin/matches/:id/formation` — that route no longer exists). Captain-editable, team-readable; non-team-members see an access-gate card.
- **NEW (S028): `starting_gk_profile_id` FKs profiles** — guests cannot be starting GK. UI excludes guests from the GK pool; rotation_number sequence skips them entirely.

---

## Completed in S034 (24/APR/2026, Work PC)

- [x] Cold-start sync clean — HEAD at `578e03a`, origin/main aligned.
- [x] **Migration 0025** `update_season` (full edit with `COALESCE`/NULL optional semantics + `p_clear_ends_on` signal + auto-stamp `ended_at` on past `ends_on`), `delete_season` (guarded by `FFC_SEASON_HAS_MATCHDAYS`, audits before DELETE), `create_season` DROP+CREATE with `planned_games` now required (was optional). All SECURITY DEFINER + `is_admin()` + GRANT EXECUTE.
- [x] Migration applied live via `supabase db push --linked`. Types regenerated (1916 → 1960 lines).
- [x] **Admin IA restructure** — `RoleLayout.tsx` drops conditional 5th Admin tab; `Settings.tsx` gains role-gated `🛠 Admin platform` red pill at bottom; `AdminHome.tsx` rebuilt from stub → 3-card hub (Season / Player / Matches).
- [x] **§3 AdminSeasons.tsx** full rewrite (~380 LOC) — topbar with back + title + red `+ New season` pill · bottom sheet for create AND edit (shared `SeasonSheet`) · row layout with format chip + status pill + labelled meta `Start / End / Games / Matchdays` (DD/MMM/YYYY dates via inline `fmtDate` string-split) · edit + delete icon buttons per row · delete disabled when `matchday_count > 0`.
- [x] CSS: ~180 LOC under `.as-*` (AdminSeasons) + `.ah-*` (AdminHome hub) + `.st-admin-link` (Settings red pill).
- [x] `tsc -b --force` EXIT=0; `vite build` EXIT=0 (PWA 10 entries / 2539 KB precache).
- [x] Dev-server smoke: `/admin/seasons` + `/admin` both render; 5 tabs in bottom nav; no console errors.

## S034 gotchas / lessons (additive)

- **`CREATE OR REPLACE FUNCTION` cannot change default-arg position.** Making `p_planned_games` required in `create_season` required DROP + CREATE (same class as S030's `upsert_formation` 7-arg rebuild). Re-GRANT EXECUTE after CREATE.
- **DATE columns need string-split, not `new Date(iso)`** — `new Date('2026-04-21')` parses as UTC midnight, which renders as 20/APR on any negative-offset timezone. Inline helper `fmtDate(iso)` splits the `YYYY-MM-DD` and uses component parts directly.
- **"Leave alone vs explicitly clear" is a fundamentally 3-state signal for nullable DB columns.** Added `p_clear_ends_on boolean` alongside `p_ends_on date DEFAULT NULL`. NULL = leave alone; non-NULL = set; `clear_ends_on=true` = erase. Alternative sentinel patterns (e.g. `'1970-01-01'::date`) are hacks; explicit boolean is cleaner and the TS client side matches cleanly via conditional spread.
- **Audit BEFORE DELETE.** `log_admin_action` writes to `admin_audit_log` which has an FK to `profiles(admin_profile_id)` only, NOT to the target entity — so the row survives even after the target is gone. But the `target_id` column still holds the UUID of the deleted row. Useful postmortem trail.
- **Access gates at component level in admin-gated routes** — `AdminSeasons` / `AdminHome` both check `useApp().role` and return an access-denied panel if non-admin. Belt-and-braces; router-level protection would be cleaner but this is the pattern we've used throughout Phase 1.

## Completed in S033 (24/APR/2026, Work PC)

- [x] Cold-start sync clean — HEAD at `830405b`, origin/main aligned, no drift.
- [x] **DB data fix** — `UPDATE seasons SET name='Season 11', planned_games=40 WHERE id='ab60594c-…'` via `npx supabase db query --linked`. No code change needed; `Matches.tsx` banner already reads the column (S029).
- [x] **§3.1-v2 Captain Helper palette re-theme** — replaced `.ch-*` CSS block (~412 LOC) with brand-tokenised version scoped to `.ch-root`.
  - 18 custom properties declared at root: `--ch-paper / --ch-surface / --ch-surface-soft / --ch-surface-deep / --ch-ink / --ch-ink-soft / --ch-ink-mute / --ch-ink-faint / --ch-border / --ch-border-strong / --ch-divider / --ch-accent / --ch-accent-weak / --ch-accent-line / --ch-accent-ink / --ch-gold / --ch-gold-weak / --ch-gold-line / --ch-success / --ch-success-weak / --ch-warn / --ch-warn-weak / --ch-warn-line / --ch-danger`.
  - Role changes: Use-this-pair + Roll → accent red CTA; Mode-toggle active → accent tint; Primary pair card → gold border+glow; Locked chip → gold-weak; Concurrent-admin modal (S032) → gold (informational, not cyan "info"); gap-warning → warn tokens; current-captain row border → gold.
  - Shared `.auth-btn--approve` overridden inside `.ch-root .ch-sheet-actions` only — login/signup screens unaffected.
  - Text dominant: cool `rgba(233,236,243,*)` → cream `#f2ead6`/`rgba(242,234,214,*)` via 3-tier `--ch-ink*` hierarchy.
- [x] Strict `tsc -b --force` EXIT=0; `vite build` EXIT=0 (PWA 10 entries / 2525 KB precache).

## S033 gotchas / lessons (additive)

- **Tokenisation strategy for single-screen re-theme** — declare 18-ish custom properties once on the screen's root (`.ch-root`), then point every rule at `var(--ch-*)`. Rules stay structurally unchanged; future palette swaps touch only the token declarations. Pattern worth repeating when re-theming Poll + Leaderboard next.
- **Scoping shared classes inside a themed subtree** — `.auth-btn--approve` is used across the app (login, signup, etc.) with a default green. To override just for captain-helper sheets without breaking auth, use `.ch-root .ch-sheet-actions .auth-btn--approve {...}`. Selector specificity does the work.
- **Gold > cyan for "another admin did X" modals** — cyan reads as "neutral info" (like a toast). Gold reads as "attention, notable." The concurrent-admin case is advisory but worth a tighter eyebrow-raise than a passing toast; gold strikes the right register.

## Completed in S032 (24/APR/2026, Work PC)

- [x] Cross-PC sync on cold start — `.git` pointer rewritten from `C:/Users/User/FFC-git` to `C:/Users/UNHOEC03/FFC-git`; state (b) lag resolved via stash-pull-drop, advanced HEAD by 12 commits to `1357c70`.
- [x] **§3.1-v2 Slice C Item 1 — triplet click-to-expand.** `Triplet` gains optional `expanded`/`onToggle` props. CandidateRow holds expansion state and renders `.ch-triplet-detail` below the row-button when open, with per-check pass/fail colour-coded raw values. `stopPropagation` on the span prevents the row's main button from firing when the triplet is tapped (avoids nested-button a11y violation).
- [x] **§3.1-v2 Slice C Item 2 — concurrent-admin toast.** `initialCaptainIds` captured in `loadAll`. `commitPair(w, b, force=false)` pre-checks `match_players.is_captain` vs initial set; if changed, fetches most-recent `admin_audit_log` entry (admin name via `profiles:admin_profile_id(display_name)` embed) and surfaces `ConcurrentAdminModal` with current pair + intended pair + time ago + Cancel-and-refresh / Overwrite-anyway. `force=true` bypasses.
- [x] `formatTimeAgo(iso)` helper (`Ns/Nm/Nh` ago per magnitude).
- [x] CSS Slice C namespace: `.ch-triplet--interactive`, `.ch-triplet--on`, `.ch-triplet-detail`, `.ch-sheet--concurrent`, `.ch-sheet-concurrent-body`, `.ch-concurrent-hint` (~45 lines).
- [x] JSDoc header moved Slice C items from "Deferred" → active Slice C block.
- [x] Build green: `tsc -b --force` EXIT=0, `vite build` EXIT=0 (CSS 96.20 kB, JS 682.84 kB, PWA 10 entries).
- [x] Schema-drift caught: first pass embedded `team` on `profiles:`; fixed to `'profile_id, team, profiles:profile_id(display_name)'` after reading `database.types.ts`.

## S032 gotchas / lessons (additive)

- **Nested button is invalid HTML inside React** — put `onClick` on a sibling span with `e.stopPropagation()` to give the inner element its own tap behaviour without breaking a11y. Trade-off: keyboard users still activate the parent via Enter; the inner tap is pointer-only. Acceptable for Phase 1 polish.
- **`match_players.team` is on `match_players`, not `profiles`.** Same schema-drift pattern FFC has hit since S025 — always open `database.types.ts` before writing an embed.
- **`admin_audit_log` is admin-SELECT only** per migration 0009 (`is_admin()` policy). Safe to query from admin-gated screens without extra grants.
- **`.ch-concurrent-hint` required `!important` on `color`** to beat the surrounding `.ch-sheet-concurrent-body` rule's cascaded `color` on child `<p>`. Alternative would be a more specific selector; chose `!important` for brevity in a single-purpose class.

## Completed in S031 (24/APR/2026, Home PC — worktree `gracious-colden-c36fec`)

- [x] S030 push verified in-flight — `origin/main` at `e446fe1`, Vercel `dpl_5FgKYfJBE7uGWbQKAi6JmveXBq7v` READY, production 200, zero runtime errors in 6 h
- [x] Service-worker cache diagnosis — live CSS bundle `/assets/index-DFUkxSSz.css` contains all 14 `splitc-*` classes; Matches flashcard code IS deployed. User just needs to unregister SW + hard-refresh to see it.
- [x] Acceptance checklist written (`sessions/S031/acceptance-checklist.md`) — 21 items across S030/S029/S028/S026
- [x] Worktree `core.worktree` misconfiguration diagnosed + fixed (was pointing at main tree)
- [x] Shared `node_modules` junction via PowerShell `New-Item -ItemType Junction` (avoided full npm install in worktree)
- [x] **§3.1-v2 Captain Helper — Slice A** (`0f2b820`): new page `CaptainHelper.tsx` (684 LOC), route `/matchday/:id/captains`, admin gate, Formula + Randomizer modes, suggested pair card from `suggest_captain_pairs`, candidate list sectioned Eligible/Partial/Ineligible with ✓✓✓ triplet, confirm sheet with White=weaker auto-assignment, `set_matchday_captains` RPC, AdminMatches `👔 Pick captains` entry button, full `.ch-*` CSS namespace
- [x] **§3.1-v2 Captain Helper — Slice B** (`a689ba3`): guests-on-roster subsection with S007 stats (pills, rating chip, trait chips, expandable description), rank-gap >5 "Proceed anyway?" advisory sub-modal (not a hard block per spec), `commitPair()` refactor for shared commit path, enum-drift fix (`guest_rating` is `average` not `avg`)
- [x] Strict `tsc -b --force` clean at every checkpoint
- [x] 3 commits pushed to `origin/main` at close (Slice A, Slice B, docs)

## S031 gotchas (new lessons)

- **Git-worktree `core.worktree` must match the physical worktree path.** Claude Code's `isolation: "worktree"` feature sometimes writes the wrong `core.worktree` into `config.worktree`, making `git status` blind to edits. Check via `git rev-parse --show-toplevel` — if it returns the main tree's path, run `git config --worktree core.worktree <abs-worktree-path>` to fix.
- **Windows `cmd //c mklink /J` fails inside the FFC path** because of the `&` in "11 - AI & Digital" (same bug CLAUDE.md flags for `.bin/*.cmd`). Use PowerShell `New-Item -ItemType Junction -Path ... -Target ...` instead.
- **Bash heredoc with CSS content trips on `$`** even inside single-quoted sentinel. Use the Edit tool with explicit old-string → new-string when appending CSS blocks.
- **`guest_rating` enum values are `weak | average | strong`** — not `avg`. Schema-drift discovery pattern (CLAUDE.md) still applies.
- **Preview browser is sandboxed to localhost** — can't navigate to external URLs for live production testing. For auth-gated production flows, hand off to user.

---

## Completed in S030 (23/APR/2026, Home PC)

- [x] Inspected existing formations table/RPCs/publication state
- [x] Migration 0024 — `formations.notes` column + `upsert_formation` extended with `p_notes` + `formations` added to realtime publication
- [x] FormationPlanner Slice D — notes state/textarea + realtime subscription + Share to team button + last-synced chip + CSS
- [x] Poll.tsx Slice E — matchId state + State 8 Plan/View formation CTA
- [x] AdminMatches Slice E — MatchdayCard Formation button (when md.match exists)
- [x] MatchDetailSheet Slice E — footer View formation button
- [x] `tsc -b` strict build clean
- [x] 2 commits staged: `32dd8d9` (Slice D) + `b20befe` (Slice E) — awaiting push

---

## Completed in S029 (23/APR/2026, Home PC)

- [x] Session-start sync — home PC `.git` pointer fixed, stash-pull-drop to advance 41 commits to `b106a8d`
- [x] Migration renumber — S027 plan's 0020 → executed as 0022 (S028 took 0020+0021)
- [x] Migration 0022 `seasons.planned_games` + `create_season` + `update_season_planned_games` RPCs applied live
- [x] Migration 0023 patch — adds `DEFAULT NULL` to both RPCs; regen types → `p_planned_games?: number`
- [x] `AdminSeasons.tsx` — list + create form + inline edit for `planned_games`
- [x] Route `/admin/seasons` + AdminHome link
- [x] `Matches.tsx` query extended — scorers embed + `planned_games`
- [x] Flashcard markup + `ffc/src/styles/matches.css` — split-colour scoreboard, banner, winner indicators, scorer columns, MOTM strip
- [x] `tsc -b` strict build clean (5 commits: 977a9b8 → 46e08b1)

---

## Completed in S028 (23/APR/2026, Work PC)

- [x] Cold-start — work PC `.git` pointer correct, `main = origin/main` clean at `c8815bc`
- [x] Slice 1 — migration 0020_v_match_commitments_guest_id applied live; Poll.tsx refactored to pk lookup
- [x] Slice 2 — migration 0021_admin_draft_override_rpcs applied live; AdminMatches Phase 5.5 buttons wired (SimpleConfirmSheet pattern)
- [x] §3.19 Slice A — FormationPlanner scaffold + pattern presets (9 layouts) + captain-accessible route + 177 LOC CSS
- [x] §3.19 Slice B — drag-drop tokens + custom pattern mode + Reset-to-preset button
- [x] §3.19 Slice C — rotating GK toggle + starting-GK select + rotation_order + gk_profile_id persistence + token rotation badges + roster rot chips
- [x] Fix — 4 strict-build TS errors caught by Vercel's `tsc -b` (unused selectedPreset memo, null-vs-undefined on Supabase RPC args); commit `7e9a890`
- [x] 6 commits pushed: `8a753cd`, `c6bfb89`, `03bbcf5`, `e78ee99`, `f489c14`, `7e9a890`
- [x] Vercel deploy `dpl_A2LF7PLNjw2oVB9wbdcYDaixzRva` READY on production
- [x] Migrations on live DB: 21
- [x] Session log + INDEX + todo.md + lessons.md + CLAUDE.md updates

## Completed in S026 (23/APR/2026, Work PC)

- [x] Cold-start — work PC `.git` pointer correct, `main = origin/main` clean at `d1ec173`
- [x] Migration 0017 — `app_settings.guest_friendly_thresholds` + `match_guests_friendly_flag_trg()` + `trg_match_guests_friendly_flag` trigger
- [x] Migration 0018 — `edit_match_players(match_id, players jsonb)` admin-only whitelist patch
- [x] Migration 0019 — `cast_poll_vote(matchday_id, choice)` + `invite_guest(...8-arg...)`
- [x] All 3 migrations applied to live DB + types regen (1895 → 1916 lines)
- [x] §3.7 Poll.tsx — stub (9L) → Depth-B (765L) with all 9 states + realtime + guest invite + penalty sheet
- [x] Leaderboard Depth-B gate — `loadSeason(mode)` callback, realtime on matches+match_players, PTR with resistance, 6-row skeleton with shimmer, 150ms min hold
- [x] AdminMatches Edit result sheet — `[✎ Edit player stats]` toggle + inline per-row stat editor + batched `edit_match_players` call
- [x] AdminMatches Phase 5.5 card — `DraftInProgressCard` with pulsing amber dot, pick count, picker team, captain, elapsed; stuck-threshold override buttons (disabled)
- [x] CSS +347 lines (po-* namespace + admin-draft-* + admin-mp-* + lb-skel/ptr)
- [x] TypeScript clean · Vite build clean (72 KB CSS / 629 KB JS / PWA precache 10 entries)
- [x] Commit `45383bc` pushed to main (+2047/-74 across 8 files)
- [x] Vercel deployment `dpl_4pL9QyCsipwsF6ZVAeXdLWXYEr1a` READY on production
- [x] Post-deploy smoke via preview server — Poll route loads, PostgREST queries fire with correct column sets, no 500s / schema errors (401s expected, unauthenticated preview)
- [x] Session close: session log · INDEX.md · todo.md · lessons.md · CLAUDE.md

---

## Completed in S025 (23/APR/2026, Work PC)

- [x] Cold-start — work PC `.git` pointer correct, `main = origin/main` clean at `a387d29`
- [x] Migration 0016: 8 admin RPCs — `update_player_profile` / `ban_player` / `unban_player` / `reinstate_rejected` / `create_matchday` / `update_matchday` / `lock_roster` / `admin_submit_match_result`
- [x] Migration 0016 applied to live DB + types regen (1816 → 1895 lines)
- [x] §3.17 AdminPlayers full replacement — 4 tabs · search · edit sheet · ban sheet · unban · reinstate (`fc5d7ee`)
- [x] §3.18 AdminMatches full replacement — 3 segments · create matchday sheet · edit matchday sheet · lock roster · result entry sheet · edit result sheet · friendly review kept (`fc5d7ee`)
- [x] CSS +242 lines across .admin-* / .sheet--wide / .admin-md-* / .admin-roster-* / .admin-team-grid namespaces
- [x] Vercel deployment `dpl_BB6oHJJQT6iYzvHSY28tpBphn57M` READY in 15s
- [x] User live testing round caught 6 issues
- [x] Polish commit `bde8c70` — log_admin_action signature fix + ban pills simplified + 7v7/5v5 chips + datetime preview + team circles + per-team roster grid + events-only filter
- [x] Hot-patches to live DB: `team_colour → team_color` enum cast, `log_admin_action` 5-arg → 4-arg strip (applied via `db query --linked --file supabase/migrations/0016_admin_rpcs.sql`)
- [x] Vercel deployment `dpl_DrQXtFhTRQX2Qf5RMYKSX324t9ns` READY
- [x] User full UI acceptance pass — all flows approved
- [x] Session log · INDEX.md · todo.md · lessons.md · CLAUDE.md close-out

---

## Completed in S024 (23/APR/2026, Work PC)

- [x] S023 acceptance A1–A9 all PASSED end-to-end on prod
- [x] Rules expansion: Scoring restructured + "Dropping out" 5-tier table + NEW Kick-off/Cards/Awards cards + alignment polish (`0c027df`, `840b572`)
- [x] Mockup `mockups/3-20-matches.html` for §3.20 Matches
- [x] §3.20 Matches.tsx + `/matches` route + Matches nav tab
- [x] §3.15 MatchDetailSheet.tsx portal-rendered overlay (with optional W/D/L chip via `profileId` prop)
- [x] Profile.tsx Recent Matches refactored to use shared sheet
- [x] `e1e9d19` feat(matches): §3.20 Matches list + §3.15 Match Detail sheet
- [x] Migration 0015: `profiles.push_prefs jsonb NOT NULL DEFAULT` applied to live DB
- [x] TypeScript types regen (`push_prefs` present)
- [x] §3.16 Settings full — 6 rows + state tiles + `.st-*` CSS expanded (`590fcc0`)
- [x] AdminPlayers Active + Rejected enrichment (position pills + inactive chip + reject_reason) (`c8cb463`)
- [x] Session log · INDEX.md · todo.md · CLAUDE.md close-out

---

## Completed in S023 (23/APR/2026, Work PC)

- [x] Spec approved: `docs/superpowers/specs/2026-04-23-rules-and-friendly-game-design.md` (League Rules + Friendly Game system + No-show penalty)
- [x] Plan written: `docs/superpowers/plans/2026-04-23-player-profile-and-league-rules.md`
- [x] Migration 0013: `matchdays.friendly_flagged_at`, `matchdays.is_friendly`, `match_players.is_no_show`, `app_settings` no-show keys, `v_season_standings` recreated with `AND NOT is_friendly` + `no_show_penalties` CTE
- [x] Migration 0014: `search_path` fix + dead config cleanup
- [x] TypeScript types regenerated; `no_show_points` added to `StandingEmbed`
- [x] `pf-*` + `lr-*` + `st-*` CSS block appended to `index.css` (503 lines)
- [x] `Profile.tsx` fully implemented (977 lines) — §3.14 Depth-B complete
- [x] `Rules.tsx` created (static League Rules, 4 cards) and migrated to `lr-*` namespace
- [x] Router `/settings/rules` wired; Settings.tsx League Rules row added
- [x] AdminMatches: amber FRIENDLY? badge + Confirm/Dismiss modal for flagged matchdays
- [x] Deployed — 11 commits, live at https://ffc-gilt.vercel.app

---

## NEXT SESSION — S023 (§3.14 Player Profile — Phase 1 Depth-B slice)

**Cold-start checklist:**
- **MANDATORY session-start sync** per CLAUDE.md Cross-PC protocol → "Session-start sync protocol" subsection:
  1. `echo $USERNAME` → confirm PC. Home = `User`, Work = `UNHOEC03`.
  2. `cat FFC/.git` → must say `gitdir: C:/Users/<this-pc>/FFC-git`; rewrite if stale.
  3. `git fetch && git status -sb && git log --oneline -5`.
  4. If behind origin with working-tree "modifications" matching the ahead commits: `git stash push --include-untracked` → `git pull --ff-only` → `git stash drop`.
  5. If genuinely uncommitted WIP: ask user.
- Expected tip: S022 close commit or later (S022 shipped 5 commits + 1 close — `59889f1`, `9d5c3c2`, `c33b781`, `5c97867`, `d3cdcf8`, close).
- **Phase 1 Step 4 SLICE 1 COMPLETE** — Leaderboard live end-to-end at https://ffc-gilt.vercel.app/leaderboard. First seeded match in Season 1 (Mohammed 3pts · Test Player 0pts · cards + MOTM populated for visual test).

**S023 agenda:**

1. **§3.14 Player Profile — Phase 1 Depth-B.** Default next per masterplan §17 order. Leaderboard row-taps already route to `/profile?profile_id=&season_id=` — currently hits the Profile stub, so this closes a visible navigation loop.
   - Spec: `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md:2042+`
   - Mockup: `mockups/3-14-player-profile.html` (S012 approved after S010 Bug A/B fixes)
   - **Shape:**
     - Identity hero: avatar · display_name · primary/secondary position pills · MOTM chip · self-edit shortcut (self-view only)
     - Season stats card (6 KPIs per S007 R3): Points · MP · W-D-L · Goals · MOTM · Late-cancel
     - Last-5 form strip (24px W/D/L circles per §3.2)
     - Achievements card (6 tiles per S007 R5): ⭐ MOTMs · 🔥 W-streak · 🎯 Goals · 🟨 Yellows · 🟥 Reds · 📉 L-streak
     - Recent matches list: last 10 newest across all seasons, per-row W/D/L chip from profile-owner perspective, tap → `/match/:id` (which is still a stub; that's OK for this slice)
     - Settings shortcut link (self-view only, routes to `/settings`)
   - **Data:** `v_season_standings` (season row) · `v_player_last5` (strip) · `profiles` (identity) · one recent-matches SQL (spec line 2060-2072 — already written) · three achievements-aggregate SQL queries (spec line 2073+ — already written). **Zero new SQL, zero new RPCs.**
   - Acceptance: self-view renders for super_admin w/ Season 1 Match 1 showing; public-view from Leaderboard tap renders Test Player's view; zero-match state renders cleanly when switching to a profile with no matches (use `m.muwahid+s020reject@gmail.com` → oh wait that's rejected and filtered out, so rebuild the empty state via a non-seeded user later if needed); dark + light both render; TS + build clean; curl /profile 200; anon error-state cleanly formatted.
   - **Estimated scope:** 1 long session or 1.5 sessions. Profile is heavier than Leaderboard. Consider planner-agent at open if uncertain.

2. **Side-items still backburner:**
   - Vector FFC crest SVG — when user exports from Illustrator/Figma
   - Palette re-align (red+navy → khaki-gold + cream per brand) — still low priority
   - Poll Depth-B kickoff (§3.7) — multi-session, blocked on §3.18 admin-create-matchday tooling
   - Leaderboard realtime subscription + pull-to-refresh + skeleton rows (Depth-B acceptance gate still open but not user-facing issues)

**Known gotchas still live (unchanged from S022):**
- **Session-start sync protocol** (from S021). Never skip it on a cross-PC resume.
- **Google consent screen shows `hylarwwsedjxwavuwjrn.supabase.co`.** Pro + custom domain = $25/mo to fix — deferred indefinitely.
- **`ffc/vercel.json` SPA rewrite is load-bearing.**
- **Supabase email validator** rejects `example.com`. Use `m.muwahid+s###<role>@gmail.com`.
- **Supabase MCP PAT is PadelHub-scoped.** Use `npx --yes supabase@latest db query --linked "..."`.
- **`supabase gen types typescript --linked 2>/dev/null`** — stderr redirect mandatory.
- **Windows `&`-in-path bug** (`11 - AI & Digital`) — Node direct-invocation pattern.
- **Terminal roles** auto-signOut in AppContext.
- **CLAUDE.md truncates UUIDs.** When seeding SQL or cross-referencing a specific profile/auth_user_id, query `profiles` first — don't fill-in from memory (S022 seed hit this).
- **PWA service worker caches previous bundle** — hard refresh (Ctrl+Shift+R) after a Vercel deploy if the UI looks stale.

---

## Completed in S022 (23/APR/2026, Work PC — full close)

- [x] Cross-PC cold-start sync: rewrote `FFC/.git` pointer work-PC→work-PC (was pointing home), stash-pull-drop `5791a77 → 028834f` (first real-world run of S021 protocol — clean first try)
- [x] Planner agent spawned: compared Poll (§3.7) vs Leaderboard (§3.13) on 7 axes, recommended Leaderboard (masterplan §17 order + zero new SQL + renders against 0-match DB)
- [x] Pre-flight SQL checks: view GRANTs ✅ · `profiles.leaderboard_sort` column+enum ✅ · Season 1 seed ✅
- [x] Leaderboard initial slice (`59889f1`): 490-line `Leaderboard.tsx` + 469-line `.lb-*` CSS. Season picker, position filter chips, sort dropdown w/ persistence, sticky header, ranked rows w/ medal icons, Not-yet-played group, empty-state tile, tiebreak chain, row-tap → profile route
- [x] Deploy 1 READY in 13s, user verified happy path on prod (Season 1 · ongoing, Not-yet-played group showing 2 profiles, empty-state tile)
- [x] User UX feedback round 1 (`9d5c3c2`): sort pill + position chip row → compact 38×38 icon buttons opening anchored dropdowns. Sort order reordered Points/Wins/Goals/MOTM/Last 5; labels simplified. Filter is multi-select w/ active-count badge
- [x] User UX feedback round 2 (`c33b781`): season picker bottom sheet → anchored dropdown too ("same location, no eye/finger divert"). All 3 popovers share one component + one click-outside effect. Dead bottom-sheet CSS deleted (~90 lines)
- [x] User approval of dropdown pattern: "tested they are perfect much more clean this way" — saved `feedback_anchored_dropdowns.md` to memory as durable rule for future FFC screens
- [x] User chose "polish + close" over Profile/Poll for S023 handoff
- [x] Last-5 strip wired (`5c97867`): `v_player_last5` query alongside standings, indexed by profile_id, rendered below main row
- [x] Seed one approved match via SQL (1 matchday + 1 match `win_white` 3-1 + 2 match_players rows, super_admin MOTM). SQL hit 3 errors: enum value wrong (`WHITE_WIN` → `win_white`), UUID literal UNION ALL needs explicit `::uuid` casts, CLAUDE.md truncated Test Player UUID and fill-in from memory was wrong
- [x] Three miss-fixes after user review (`d3cdcf8`): last-5 pinned `grid-row: 2` (auto-placement was landing in collapsed slot) · cards column added (7th grid col, `🟨N 🟥M` hidden when 0) · MOTM chip `⭐N` added to name-block (hidden when 0)
- [x] Seed updated with cards: Mohammed 1y, Test Player 1y+1r
- [x] User verified end-to-end post-hard-refresh: "its rendering now working perfectly"
- [x] Removed temporary `console.info` diagnostic (in close commit)
- [x] Session log `sessions/S022/session-log.md` written
- [x] `sessions/INDEX.md` S022 row added, Next-session pointer → S023
- [x] `tasks/todo.md` S023 agenda block (this)
- [x] `tasks/lessons.md` +4 entries (UUID literal casts in UNION ALL, session-log UUID truncation, CSS grid auto-placement needs pinning, mockup→code column-drop discipline)
- [x] `CLAUDE.md` status header refresh
- [x] `feedback_anchored_dropdowns.md` memory file (saved mid-session at polish-round-2 approval)
- [x] Close commit pushed + deployed

---

## Completed in S021 (22/APR/2026, Home PC — full close)

- [x] Cross-PC cold-start: rewrote `FFC/.git` pointer to home-PC path, stash-pull-dropped to sync HEAD `f10f138 → 5791a77`
- [x] Baked mandatory session-start sync protocol into CLAUDE.md (commit `0ed3499`)
- [x] Google OAuth Path B retest: curl probe 302→Google with correct client_id + scopes; playwright verified UI→Google handoff; user click-through on real Chrome; DB confirmed `auth.identities` for Test Player now has `[email, google]`, 3 profiles / 3 unique auth_user_ids / 0 ghosts — no duplicate forked
- [x] Discovered `ffc/public/favicon.svg` was a purple-bolt Vite/shadcn placeholder, NOT FFC branding
- [x] Pillow one-shot generated 5 FFC crest PNG variants from `shared/FFC Logo Transparent Background.png`: 32 (2195B), 180 (30461B), 192 (33955B), 512 (173555B), maskable-512 (121050B, 80% safe zone on `#0e1826`)
- [x] Revised scope: "SVG master via Pillow" not feasible (raster-only) — deferred until user sources vector crest
- [x] `manifest.webmanifest` icons array rewritten (any/192 + any/512 + maskable/512)
- [x] `index.html`: favicon → 32px PNG, apple-touch-icon → 180px PNG, splash text-tile → `<img>` (128×128 w/ drop-shadow)
- [x] `ffc/public/favicon.svg` deleted; `.gitignore` gained `.playwright-cli/`
- [x] TS check + Vite build clean; PWA plugin precache 10 entries (2270 KiB)
- [x] Vercel deploy + live smoke-test (all 5 PNGs + manifest + index head verified via curl)
- [x] Commit `ff82978` (PWA icons) pushed
- [x] `Signup.tsx` confirm-email handler: widened Stage type, added session-null branch in handleStage1, handleResendConfirm via `auth.resend({type:'signup'})`, new render branch with ⧗ icon + resend + "Use a different email"
- [x] Stage-derivation effect preserves `confirm_email` across renders
- [x] `auth-banner--success` (green) CSS variant added
- [x] `admin_audit_log` schema inspected via `information_schema.columns` (columns: id, admin_profile_id, target_entity, target_id, action, payload_jsonb, created_at); sample rows confirmed 2 entries from S020
- [x] `docs/admin-audit-sql.md` cheat-sheet created (schema + 4 common queries + known actions)
- [x] `tasks/lessons.md` S021 row added (target_entity vs target_table + per-table cheat-sheet convention)
- [x] Commit `a39f56f` (Signup + docs + lessons) pushed
- [x] Live Signup Stage 1 verified on production via Playwright — no regression
- [x] Session log `sessions/S021/session-log.md` written
- [x] `sessions/INDEX.md` S021 row added + Next-session pointer flipped to S022
- [x] `tasks/todo.md` (this file) updated
- [x] CLAUDE.md status header bumped to "Phase 1 Step 3 COMPLETE + S021 polish items LIVE"

---

## Completed in S020 (22/APR/2026, Home PC — full close)

- [x] `git add` + commit + push S019 uncommitted work (`8f8668e`, 24 files incl. logos + `0012_grants.sql`)
- [x] Vercel auto-deploy `dpl_4jfVSFMBKw7P7bKggqsACyyBcSzS` READY; curl-smoke-tested `/`, `/ffc-logo.png`, `/manifest.webmanifest`, `/sw.js`
- [x] D2 retry: disable email confirmations in Supabase dashboard → delete stuck `m.muwahid05@gmail.com` auth row → retry via UI → **PASS** (Stage 1 → Stage 2 "Who are you?" → Stage 3 "Waiting for approval")
- [x] Google Cloud Console project "FFC App" created (ID `ffc-app-494112`)
- [x] Google OAuth consent screen configured (External + Testing, FFC branding, m.muwahid@gmail.com contact)
- [x] Python Pillow installed via `pip install --user --quiet` → generated `_wip/ffc-logo-google-120.png` (16.7 KB, 120×120 transparent)
- [x] Logo uploaded to Google Branding page
- [x] OAuth 2.0 Web Client "FFC Web" created with correct JS origins + redirect URI (Client ID `991515683563-ncjuidcn08psinv7oq8jb9kevp4k6g32.apps.googleusercontent.com`)
- [x] Test users allowlisted (`m.muwahid@gmail.com` + `m.muwahid05@gmail.com`) despite Google's "Ineligible accounts not added" red-herring modal
- [x] Supabase Google OAuth provider enabled with Client ID + Secret
- [x] Supabase URL Configuration: Site URL `https://ffc-gilt.vercel.app` + Redirect URLs `https://ffc-gilt.vercel.app/**` + `http://localhost:5174/**`
- [x] Google OAuth probe via REST returns `302 → accounts.google.com/o/oauth2/v2/auth` with Client ID embedded — **config is correct**
- [x] D3: super-admin approved Test Player from `/admin/players` Pending tab → DB verify: `profiles` row `ca3181b2…` with role=player + `auth_user_id` bound, `pending_signups.resolution` = approved, `resolved_at` + `resolved_profile_id` correct
- [x] D4: Test Player signed in fresh Incognito → landed on `/poll` → 4-tab bottom nav (NO Admin) ✅
- [x] D5: Full DB chain verified via SQL
- [x] D6 attempt 1: created reject test signup → super-admin rejected via `/admin/players` with 10+ char reason "Testing reject path — not a real signup (fine)" → DB PASS but UX BROKEN (rejected user stuck on Stage 3, refresh bounced to signup Stage 1)
- [x] D6 diagnosis: `AppContext.tsx` sets role=rejected but has no side-effect; router's `if (!role)` check doesn't catch truthy `'rejected'` string
- [x] D6 fix (`dca48cf`): `AppContext` profile select expanded to include `reject_reason`; new branch when role==='rejected' stashes reason in sessionStorage + signOut + hard redirect to `/login?err=rejected`; `Login.tsx` banner useEffect reads sessionStorage and includes reason in body
- [x] TS compile check (`tsc -b --noEmit`) exit 0
- [x] Vercel deploy `dpl_AduHCNq7xAxVJqx9qdTGsatQSitG` READY
- [x] D6 fix verified locally via preview_eval (sessionStorage set + redirect simulated; banner DOM inspected — correct text + class + sessionStorage consumed)
- [x] D6 fix verified on production by user (screenshot showed banner with exact reject reason)
- [x] SPA 404 bug discovered: `/login`, `/signup`, `/poll`, `/admin/players`, everything except `/` returned HTTP 404 from Vercel edge (not the React NotFound page — the Vercel-level 404 page with `bom1::…` ID)
- [x] SPA fix (`0e62ffd`): `ffc/vercel.json` with `{"rewrites":[{"source":"/(.*)","destination":"/"}]}` — Vercel's static-file precedence handles assets automatically
- [x] Smoke-test post-deploy: all 6 probed paths returned 200 (login, signup, poll, admin/players, xyz-nonexistent, match/abc) + assets still served directly (sw.js, manifest.webmanifest, ffc-logo.png)
- [x] Session log `sessions/S020/session-log.md` written
- [x] INDEX.md S020 row added + Next session pointer flipped to S021
- [x] tasks/todo.md (this file) updated
- [x] tasks/lessons.md — 3 new mistakes + 6 new validated patterns
- [x] CLAUDE.md status header bumped to "Phase 1 Step 3 COMPLETE"

---

## NEXT SESSION — S020 (SUPERSEDED — see S021 above)

> **Note:** S019 (22/APR/2026, Home) implemented Step 3 auth flow end-to-end, passed D1, but stopped at D2 on a Supabase email-validator blocker. **All S019 work is uncommitted on disk.** See `sessions/S019/session-log.md` for full detail including the critical GRANTs bug discovered + fixed via `0012_grants.sql`.

**Cold-start checklist:**
- `git pull` at session start (should be clean — nothing pushed while you were away).
- `git status` — expect ~15 files uncommitted from S019: code (11 modified / 2 new / 1 deleted) + mockups (3 new / 1 deleted) + shared logos (2 new) + `ffc/public/ffc-logo.png` + `supabase/migrations/0012_grants.sql`.
- Memory auto-loads all prior rules + S019's critical new lesson: **RLS ≠ GRANT** — every SELECT/INSERT/UPDATE/DELETE requires an explicit table-level GRANT to `authenticated` because Supabase "automatic table exposure" is OFF on this project; `0012_grants.sql` sets DEFAULT PRIVILEGES so new tables pick it up automatically.
- **Supabase CLI** already linked; use `npx supabase db query --linked "SQL"` for remote queries, `npx supabase db push` for new migrations.
- **Home-PC workspace** = OneDrive working tree + `C:/Users/User/FFC-git/` external `.git/`. Identity: `m.muwahid@gmail.com`.

**Status at S019 close:**
- Phase A (mockups) · Phase B (code) · Phase C (super_admin bootstrap) all DONE.
- Phase D (acceptance): **D1 PASS** (super_admin signs in → /poll with 5-tab admin nav); **D2 BLOCKED** (Supabase rejected `test.s019@example.com` as invalid email — need a real-world test address); D3–D6 pending after D2 unblocks.
- Super_admin `m.muwahid@gmail.com` is bound (`auth_user_id = 67d8219c-6086-4f23-a2fa-deeb3fcc28bf`, profile id `cce905a8-8f42-48c4-bf9e-65a3cb301757`, role `super_admin`).
- Migration `0012_grants.sql` applied live.

### S020 agenda

1. **Commit + push S019 work in ONE commit** — `feat(auth): Step 3 — auth flow + GRANT fix + bottom-nav icons + transparent logo`. Include session-log + INDEX + CLAUDE.md + todo + lessons (this file). Vercel auto-deploys. Smoke-test the production URL (curl `/` for 200, load `/login` in browser, verify transparent crest renders).
2. **Retry D2** with a valid throwaway email. Options: your own `+tag` alias (e.g. `m.muwahid+s019test@gmail.com`) — Gmail accepts + tags and forwards to main inbox; OR any secondary real domain you control. Avoid `example.com` / made-up domains — Supabase Auth rejects them.
3. **D3** — as super_admin, open `/admin/players` Pending tab, approve the D2 signup, verify the bottom sheet copy for "new profile" (no claim hint) renders correctly, confirm approve.
4. **D4** — on the D2 browser, refresh → should land on `/poll` with 4-tab player nav (no Admin).
5. **D5** — SQL verification: `SELECT role, auth_user_id FROM profiles WHERE email = '<test-email>';` returns role=player, auth_user_id set. `SELECT resolution, resolved_profile_id FROM pending_signups WHERE email = ...` returns approved.
6. **D6** — reject path: do a second throwaway signup, reject with a reason (≥10 chars), verify `SELECT role, reject_reason FROM profiles WHERE email = ...` returns role=rejected + reason. Sign in as the rejected user → AppContext detects rejected → auto signOut + banner on `/login?err=rejected`.
7. **Google OAuth config (OPTIONAL if you want to ship "Continue with Google"):** open Supabase dashboard → Authentication → Providers → Google → enable, paste OAuth Client ID + Secret from a Google Cloud Console OAuth 2.0 app. Redirect URI: Supabase gives you one, paste it into Google Cloud. Test: tap "Continue with Google" on `/login` → Google consent screen → back to app → signed in. If you skip this today, "Continue with Google" silently fails until configured.
8. **Logo optimization (optional polish):** the transparent PNG is 1.44 MB — fine for dev but heavy for PWA install. Consider 512/192/180/32 PNG variants + SVG master; wire into `ffc/public/manifest.webmanifest` icons array.
9. **Close S020** — session log · INDEX row · CLAUDE.md status bump ("Phase 1 Step 3 COMPLETE") · todo.md S021 plan (Step 4? or UI polish?) · lessons.md if warranted.

### Known gotchas carried from S019
- **Supabase dashboard "Add User" auto-confirmed** the super_admin — `email_confirmed_at` is set. For D2 throwaways going through `/signup`, email confirmation MAY be required depending on project settings (check `supabase_auth_admin.identities` or the dashboard Settings → Auth → Email → confirmations). If it is, the test user will get `Banner B (Unconfirmed email)` on sign-in. Workaround: dashboard-add + skip confirmation, or disable email confirmation project-wide for Phase 1.
- **`.claude/launch.json` Mockup Preview dir** = `mockups` (fixed this session; was pointing at obsolete superpowers scratch dir).
- **OneDrive stale-stat bug** — if http.server serves an old file despite edits, re-write (forces materialisation). Alternative: touch the file.

## Previous NEXT SESSION — S019 plan [SUPERSEDED — see S020 above]

**Cold-start checklist:**
- Read `CLAUDE.md` (S017 summary — status now `Steps 1 & 2 of V2.8 COMPLETE`), `sessions/INDEX.md` (S017 row), session tmp at `~/.claude/session-data/2026-04-21-ffc-s017-session.tmp`.
- Memory auto-loads all prior rules plus S016/S017 lessons (`.npmrc` peer-dep fix; Windows `&`-in-path `node ./node_modules/` bypass; `supabase gen types 2>/dev/null`; `supabase db query --linked` not `--remote`).
- **Home-PC workspace:** OneDrive working tree + `C:/Users/User/FFC-git/` external `.git/`. Run `git status` / `git log` / `git push` from the OneDrive path.
- **`git pull` before starting** — sync from work PC if anything was pushed.
- **Supabase CLI:** `supabase` globally installed (v2.90.0). `supabase link` already done — no re-link needed on same machine. Use `supabase db query --linked "SQL"` for remote queries.

**Status at S017 close:**
- Steps 1 & 2 of V2.8 **FULLY COMPLETE.** Database live at `hylarwwsedjxwavuwjrn`: 20 tables, 11 migrations applied, 20 RPCs, RLS on all tables, 7 app_settings, 5 scheduled_reminders, Season 1 + super_admin seeded.
- `ffc/src/lib/database.types.ts` — 1816 lines, generated from live schema, zero TS errors.
- `ffc/src/lib/supabase.ts` — typed `createClient<Database>()`.
- `ffc/package.json` build script — Windows-safe `node ./node_modules/...` invocation.
- 2 commits this session: `3cd2677` (CRLF .gitattributes) · `cab85b9` (Step 2 complete, 16 files, 4260 insertions).
- Live app still showing Step 1 shell (DB-only step has no UI change).
- **`auth_user_id` on super_admin profile is NULL** — Step 3 auth flow will claim it via `approve_signup` RPC.

### S018 agenda

1. **`git pull` + `git status`** at session start.

2. **Wire `onAuthStateChange` → profile lookup in `AppContext.tsx`:**
   - After `setSession(session)`, if `session.user` exists: call `supabase.from('profiles').select('id, role').eq('auth_user_id', session.user.id).maybeSingle()`.
   - Set `role` in context from the result (currently always null).
   - Handle null result (approved users only have `auth_user_id` set; pending/rejected have none yet).

3. **Login page (`ffc/src/pages/Login.tsx`):**
   - Email/password sign-in: `supabase.auth.signInWithPassword({ email, password })`.
   - Google OAuth: `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })`.
   - On success, router navigates to `/poll` (AppContext wakes up via `onAuthStateChange`).
   - Error states: wrong credentials, unconfirmed email, blocked user.

4. **Signup page (`ffc/src/pages/Signup.tsx`):**
   - `supabase.auth.signUp({ email, password, options: { data: { display_name } } })`.
   - On success: INSERT to `pending_signups` — `supabase.from('pending_signups').insert({ email, display_name, requested_at: new Date().toISOString() })`.
   - Show "Awaiting approval" state — do NOT navigate to `/poll` (user has no profile yet).

5. **Welcome screen (`ffc/src/pages/Welcome.tsx`):**
   - Port real content from `mockups/welcome.html`.
   - FFC crest (CSS-gradient placeholder until logo exported) + "Friends, football, Thursdays." headline + Sign in → `/login` CTA + Request to join → `/signup` CTA.
   - Safe-area aware (top/bottom insets on fixed elements).

6. **Admin approval — `AdminPlayers.tsx` pending tab:**
   - List `pending_signups WHERE resolution='pending'` via Supabase select.
   - "Approve" button calls `approve_signup(signup_id, null)` RPC (null = create new profile, not claim ghost).
   - "Reject" button calls `reject_signup(signup_id, reason)` RPC.
   - After approval, the `pending_signups.resolution` flips to `'approved'` and a new `profiles` row appears.

7. **Step 3 acceptance test (manual):**
   - New browser tab → `/signup` → fill form → submit.
   - Super-admin browser tab → `/admin/players` pending tab → approve the signup.
   - Approved-user browser tab → `/login` → sign in → lands on `/poll` with correct role in context.
   - `SELECT role, auth_user_id FROM profiles` on approved user shows role='player' and non-null auth_user_id.

8. **(Optional) Wire `auth_user_id` on super_admin profile:** After `m.muwahid@gmail.com` signs in for the first time via Supabase Auth, the `onAuthStateChange` handler will find no matching profile (since `auth_user_id IS NULL`). The `approve_signup` RPC's `p_claim_profile_id` parameter handles this — run `approve_signup(signup_id, <super_admin_profile_id>)` to bind auth user to the ghost super_admin profile. OR: manual SQL `UPDATE profiles SET auth_user_id = '<auth-uuid>' WHERE email = 'm.muwahid@gmail.com'`.

9. **Logo rollout** (if user has exported from `shared/FF_LOGO_FINAL.pdf`) — 512/192/180/32 PNG + SVG master + WhatsApp OG 1200×630. Wire into `ffc/public/` + `manifest.webmanifest` icons + Welcome screen.

10. **Close S018** — session log · INDEX row · CLAUDE.md bump · todo.md S019 plan · lessons.md row.

## Completed in S016 (21/APR/2026, Home PC — full close)
- [x] Cold-start briefing produced (resume-session skill); INDEX + S015 log + todo.md NEXT SESSION read; user chose "start with Step 1 of V2.8".
- [x] **Home-PC workspace alignment** — moved a temp clone's `.git/` to `C:/Users/User/FFC-git/`, set `core.worktree` to the OneDrive path, rewrote `<OneDrive>/.git` pointer from `C:/Users/UNHOEC03/FFC-git` → `C:/Users/User/FFC-git`, set `core.autocrlf=true`, removed duplicate clone working tree. Verified: `git status` runs from OneDrive path, 24 "modifications" are pure CRLF drift (zero content diff via `--ignore-cr-at-eol`).
- [x] **Step 1 — runtime deps** installed: `@supabase/supabase-js@^2.104.0`, `react-router-dom@^7.14.2`. Dev deps: `vite-plugin-pwa@^1.2.0` + `workbox-window@^7.4.0` (with `--legacy-peer-deps` — peer decl still caps at vite@^7, scaffold is on vite@8.0.9).
- [x] **Step 1 — library layer** — `ffc/src/lib/{supabase.ts, env.d.ts, AppContext.tsx, ErrorBoundary.tsx}`.
- [x] **Step 1 — layouts** — `ffc/src/layouts/{PublicLayout,RoleLayout,RefLayout}.tsx`.
- [x] **Step 1 — page stubs (14)** — `ffc/src/pages/{Welcome,Login,Signup,Poll,Leaderboard,Profile,MatchDetail,Settings,RefEntry,NotFound}.tsx` + `ffc/src/pages/admin/{AdminHome,AdminPlayers,AdminMatches,FormationPlanner}.tsx`. Shared `components/StubPage.tsx` helper.
- [x] **Step 1 — router** — `ffc/src/router.tsx` with `createBrowserRouter`, auth-aware index route, three layouts nesting.
- [x] **Step 1 — global CSS rewrite** — `ffc/src/index.css` (safe-area tokens, dark default, light via `:root.theme-light` opt-in, layout primitives).
- [x] **Step 1 — `index.html` rewrite** — `viewport-fit=cover`, apple-mobile-web-app meta, light+dark theme-color meta, inline `#ffc-splash`.
- [x] **Step 1 — PWA wiring** — `ffc/public/manifest.webmanifest` + `ffc/vite.config.ts` with `VitePWA` (`generateSW`, `manifest:false`, `cacheId=ffc-<ISO-timestamp>` bumps per build).
- [x] **Step 1 — entry points** — `ffc/src/App.tsx` reduced to Error/Provider/Router tree; `ffc/src/main.tsx` dropped Step-0 logs, imports supabase for fail-fast, PROD-only SW register via workbox-window with `messageSkipWaiting`.
- [x] **Deleted Vite template cruft** — `src/App.css`, `src/assets/*`, `public/icons.svg`.
- [x] **Local build verified** via `node ./node_modules/typescript/bin/tsc -b && node ./node_modules/vite/bin/vite.js build` — 327 KB JS gzip 98 KB + PWA SW + 5 precached entries. `npm run build` broke on Windows `&`-in-path issue — workaround documented.
- [x] **Local preview acceptance** via `preview_start ffc-dev` on port 5174 — Welcome + Poll + login routed correctly, 4-tab bottom nav on authed routes, zero console errors. Screenshots captured.
- [x] **First commit `c7b2b74`** — Step 1 scaffold (36 files, +8,344/−422). Required explicit user authorisation for direct-to-main push; verified established workflow.
- [x] **First Vercel deploy ERRORED** — 7s fail with ERESOLVE on vite-plugin-pwa peer dep.
- [x] **Second commit `dd0c00b`** — `ffc/.npmrc` with `legacy-peer-deps=true`. Redeploy Ready in 15s.
- [x] **Live verification via curl** — `/` 200 (2088B), `/manifest.webmanifest` 200, `/sw.js` 200. HTML contains all expected meta tags + inline splash.
- [x] **`gh` CLI retraction** — confirmed `gh auth status` shows `mmuwahid` auth'd with `repo`/`workflow`/`gist`/`read:org` scopes on home PC; user confirmed same on work PC. S015 Go-binary TLS lesson is network-specific, not tool-wide.
- [x] **User asked about URLs matching planning mockups** — clarified Step 1 scope (shell only; real screens in Step 3+).
- [x] S016 session log · INDEX row · CLAUDE.md bump · todo.md S017 plan · lessons.md update — (this block).
- [ ] Logo rollout — DEFERRED (asset export still pending).
- [ ] Step 2 (11 migrations) — DEFERRED to S017 per user instruction.
- [ ] CRLF renormalisation of 47 drift files — DEFERRED to S017 as its own chore commit.
- [ ] `gh` CLI lesson retraction in `lessons.md` — DEFERRED to S017.
- [ ] `package.json` build script Windows workaround — DEFERRED to S017.
- [ ] Brand palette re-alignment — continues deferred.

---

## (Previous) NEXT SESSION — S016 (logo rollout + Step 1 scaffold elaboration + Step 2 migrations) [SUPERSEDED — see S017 above]

**Cold-start checklist:**
- Read `CLAUDE.md` (S015 summary at top — status now reads `Phase 1 implementation — Step 0 infrastructure LIVE`), `sessions/INDEX.md` (S015 row), `sessions/S015/session-log.md` (full close — Step 0 complete, 5 commits, https://ffc-gilt.vercel.app live).
- Memory auto-loads all prior rules plus S015 additions (Windows `echo | pipe` newline trap, Go-binary TLS issue, Vercel preview empty-branch arg).
- **Workspace location changed.** All work now happens in `C:/Users/UNHOEC03/FFC/` (NOT the OneDrive path). The OneDrive copy is read-only snapshot.
- **`git pull` before starting** and `git commit && git push` when stopping — git is now the cross-PC + collaborator sync mechanism.
- If you haven't reconnected the Supabase MCP with FFC-scoped PAT, do it early (Claude settings → MCP connectors) or plan to use `npx supabase` CLI exclusively.

**Status at S015 close:**
- Step 0 of V2.8 sequencing **FULLY COMPLETE**. GitHub + Supabase + Vercel all wired; `ffc-gilt.vercel.app` live; 6 env vars verified resolving in production build (lengths 40 / 46, no newline drift).
- Workspace migrated OneDrive → `C:/Users/UNHOEC03/FFC/`.
- GitHub: `mmuwahid/FFC` (private), 5 commits on `main`.
- Supabase: project `hylarwwsedjxwavuwjrn` (`ffc` on new FFC org, region `ap-south-1` Mumbai, Healthy). Legacy JWT anon key retired in favour of `sb_publishable_EbFLhm6kXbTJBqrge-A7vw_0LswX2EB`.
- Vercel: `prj_2NszuyOepArCTUAJCOxH8NsAAeSv` (`ffc` on `team_HYo81T72HYGzt54bLoeLYkZx`), Git-connected, Root Directory `ffc`, framework Vite, Node 24.x.
- Stack correction: React 19.2.5 (not 18 — Vite scaffold default). CLAUDE.md Stack line bumped.
- `_wip/` empty. Design spec unchanged at ~3,100 lines.
- Brand palette re-alignment still on backburner.

### S016 agenda

1. **Logo rollout** (unblocks when user delivers assets to `shared/`):
   - Transparent PNG at 512 · 192 · 180 · 32 + SVG master (from `shared/FF_LOGO_FINAL.pdf`).
   - Wire into `welcome.html` + all 9 phone-frame mockups (replacing JPG stopgap on `3-7-poll-screen.html`).
   - Add PWA manifest `icons[]` block to `public/manifest.webmanifest`.
   - Prep WhatsApp OG image 1200×630 at `ffc/public/og-image.png`.
   - If logo not yet exported at session start: skip and proceed to item 2; revisit later in session.

2. **Step 1 of V2.8 — Elaborate Vite scaffold with PadelHub boot patterns:**
   - **Install deps:**
     - `@supabase/supabase-js` (runtime)
     - `vite-plugin-pwa` + `workbox-window` (PWA / service worker)
     - `react-router-dom` (routing)
     - `@types/node` already in scaffold
   - **`ffc/src/lib/supabase.ts`** — client singleton. Reads `import.meta.env.VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. Export `supabase` singleton; never construct a second one.
   - **`ffc/src/lib/env.d.ts`** — typed `ImportMetaEnv` for VITE_ vars.
   - **Inline splash HTML** in `index.html` body — kills cold-start flash; hides itself when React mounts.
   - **`ffc/src/index.css`** — global safe-area CSS (hardcoded simulation values for dev, `env(safe-area-inset-*)` for PWA). Follow `docs/platform/iphone-safe-area.md` pattern.
   - **Plain-object React Context** for app state (CLAUDE.md Rule #8 — no `useMemo` cascades).
   - **`ErrorBoundary`** at route layout level.
   - **Route skeleton** — auth-aware layouts per §3.0 IA: 4-tab player / 5-tab admin / anon ref shells; 16 routes.
   - **`onAuthStateChange`** subscription flips layouts on login/logout.
   - **Replace** the Step-0 temp console.logs in `main.tsx` with actual Supabase client init.
   - **Service worker** via `vite-plugin-pwa` — cache-first, bump `CACHE_NAME` on every deploy (Rule #19).
   - **Acceptance (Step 1):** welcome screen renders on `ffc-gilt.vercel.app`; mock auth state change flips route layouts; service worker registers; no console errors.

3. **Step 2 of V2.8 — 11 migration files + super-admin seed:**
   - **Reconnect Supabase MCP** (optional — Claude settings → MCP connectors → Supabase → PAT with FFC-org scope) to unlock `generate_typescript_types` + `apply_migration`. Otherwise use `npx supabase db push`.
   - **`npx supabase link --project-ref hylarwwsedjxwavuwjrn`** (will prompt for DB password from password manager).
   - Write SQL files in `supabase/migrations/` per V2.8 §2.9 order (copy from design spec §2):
     - `0001_enums.sql` (18 enums)
     - `0002_base.sql` (profiles, seasons, app_settings)
     - `0003_match_data.sql` (matchdays, match_players, match_guests, match_events)
     - `0004_poll_ref.sql` (poll_votes, ref_tokens, pending_signups)
     - `0005_operational.sql` (admin_audit_log, draft_sessions, draft_picks, formations, notifications)
     - `0006_views.sql` (v_match_commitments, v_captain_eligibility, etc.)
     - `0007_helpers.sql` (effective_format, roster_cap, log_admin_action)
     - `0008_rpcs.sql` (20 SECURITY DEFINER RPCs)
     - `0009_rls.sql` (RLS policies — 3 roles)
     - `0010_grants.sql` (`GRANT ... TO authenticated, anon;`)
     - `0011_seed_super_admin.sql` (insert `m.muwahid@gmail.com` as super_admin, seed 7 app_settings rows)
   - **`npx supabase db push`** (or apply migrations via MCP).
   - **Generate TS types:** `npx supabase gen types typescript --linked > ffc/src/lib/database.types.ts` (or via MCP `generate_typescript_types`).
   - **Verify on Supabase Studio:**
     - 20 tables in `public` schema
     - RLS enabled on every table (there's a CLI assertion too)
     - 20 RPC functions visible under Database → Functions
     - 7 `app_settings` rows seeded
     - `profiles` has 1 row with `role='super_admin'`, email `m.muwahid@gmail.com`
   - **Smoke-test Edge Function:** deploy `supabase/functions/hello/index.ts` via `npx supabase functions deploy hello`; invoke via `curl`.
   - **Acceptance (Step 2):** `SELECT * FROM seasons` returns one row; `SELECT role, email FROM profiles` returns `super_admin | m.muwahid@gmail.com`; typescript types file exists and compiles.

4. **(Optional) Step 3 of V2.8 — First feature slice** (only if scope permits; likely its own session):
   - Auth (email/password + Google OAuth via Supabase Auth).
   - Welcome screen as React component — port from `mockups/welcome.html`.
   - Self-signup pending flow — `pending_signups` INSERT.
   - Admin approval via `approve_signup` RPC.
   - Ref tokens generation (SMS stub for Phase 2).
   - §3.7 Poll screen state machine up to State 3 (voted, pre-lock).
   - **Acceptance (Step 3):** super-admin approves a pending signup; approved player signs in and commits a poll vote; `committed_at` row visible in `poll_votes`.

5. **Brand palette re-alignment** — still deferred unless user surfaces it.

6. **Close S016** — session log · INDEX row · CLAUDE.md bump · todo.md S017 plan.

## Completed in S015 (21/APR/2026, Home PC — full close)
- [x] Cold-start briefing produced (session-resume skill); INDEX + S014 log + todo.md NEXT SESSION read; 5-item agenda presented
- [x] **Framing decisions locked** — Supabase org (user created new FFC org manually) · git repo location (separate path outside OneDrive for git-only sync) · repo scope (everything — fullest context for future collaborator) · migration safety (copy + keep OneDrive as snapshot)
- [x] **Workspace migration** — `cp -r` OneDrive FFC folder → `C:/Users/UNHOEC03/FFC/` (32 MB, 77 files, verified counts match)
- [x] **Repo scaffolding** — `.gitignore` + `README.md` written; 10 approved mockups copied from `.superpowers/` to `mockups/` (fixes gitignored path in README)
- [x] **`git init` + initial commit `1c03b7b`** — 52 files, 20,746 insertions; committer `Mohammed Muwahid <m.muwahid@gmail.com>`
- [x] **GitHub repo** created at `github.com/mmuwahid/FFC` (private, via Chrome — `gh` CLI blocked by TLS cert wall on Go binaries); remote wired + first push succeeded via `schannel` backend
- [x] **Supabase project** `ffc` created by user in new FFC org — ref `hylarwwsedjxwavuwjrn`, region `ap-south-1` Mumbai, Free tier, Data API on, automatic RLS on, automatic table-exposure OFF
- [x] **Supabase keys saved** to password manager — DB password · publishable key · legacy anon JWT · secret key · legacy service_role JWT
- [x] **Vite scaffold `caa3e0a`** — `npm create vite@latest ffc -- --template react-ts` → React 19.2.5 + Vite 8.0.9 + TypeScript 6.0.2 (18 files)
- [x] **`npx vercel login`** via device OAuth worked first try (Node's HTTP client reads Windows cert store for npm registry calls, unlike Go binaries)
- [x] **`npx vercel link --yes --project ffc`** (rejected `FFC` uppercase, retried lowercase) — Vercel project `prj_2NszuyOepArCTUAJCOxH8NsAAeSv` created on `team_HYo81T72HYGzt54bLoeLYkZx`
- [x] **`npx vercel git connect <url> --yes`** connected the GitHub repo for auto-deploy
- [x] **`npx vercel --yes`** first CLI deploy — production READY in 30s at `ffc-gilt.vercel.app`
- [x] **Root Directory `ffc`** set via Vercel dashboard (required for GitHub push-triggered builds with subdirectory Vite app)
- [x] **Env vars wired** — first attempt via `echo | pipe` contaminated values with trailing `\n`; recovered via interactive re-entry + discovered `vercel env add --value --yes` flag combo (with `""` positional arg for preview branch)
- [x] **Step 0 first acceptance `9f6fb76`** — console logs verify env vars resolve in GitHub-triggered production build (legacy JWT format)
- [x] **Anon key swap** — retired legacy JWT, moved all 3 environments to new publishable `sb_publishable_EbFLhm6kXbTJBqrge-A7vw_0LswX2EB` format via `--value --yes` + empty-branch CLI pattern
- [x] **Step 0 re-acceptance `22a3209`** — added value-length canary to console logs; verified exact lengths 40 (URL) + 46 (anon key) — zero newline drift, publishable key resolving cleanly
- [x] **`b0579d8`** — `.vercel/` added to `ffc/.gitignore` (auto-added by `vercel link`)
- [x] S015 session log written · INDEX row added · CLAUDE.md bumped · lessons.md updated · todo.md S016 plan (this block)
- [ ] **Logo rollout** — DEFERRED to S016 (still blocked on user asset export)
- [ ] **Step 1 (scaffold elaboration)** — DEFERRED to S016 (clean handoff)
- [ ] **Step 2 (11 migrations)** — DEFERRED to S016 (substantial session of its own)
- [ ] **Brand palette re-alignment** — continues deferred

---

## (Previous) NEXT SESSION — S015 (Phase 1 implementation kickoff) [SUPERSEDED — see S016 above]

### Previously-planned S015 agenda (Step 0 executed; Steps 1–2 + logo deferred — see "Completed in S015" block above):
1. Logo rollout — **DEFERRED** (user asset export still pending)
2. Step 0 of V2.8 (GitHub + Supabase + Vercel wiring) — **DONE** ✅
3. Step 1 of V2.8 (scaffold elaboration) — **DEFERRED to S016** (minimal Vite scaffold landed; full boot patterns in next session)
4. Step 2 of V2.8 (11 migrations) — **DEFERRED to S016**
5. Close S015 — **DONE** ✅

## Completed in S014 (21/APR/2026, Home PC — full close)
- [x] Cold-start briefing produced (session-resume skill); INDEX + S013 log + todo.md NEXT SESSION read; 5-item agenda presented
- [x] **Item 1 — Masterplan V2.8 written** (`planning/FFC-masterplan-V2.8.md` · 378 lines · within 350–500 target). Revision history (5 S013 delta groups) · §§1–15 carryover · **§16 NEW 5v5/7v7** (decisions + data model + format-awareness + UI parameterisation tables) · Section 2 delta with SQL for `effective_format` + `roster_cap` + `log_admin_action` + CHECK expansion · 10-drift reconciliation table · 11-file migration order (supersedes V2.7) · implementation sequencing notes (Steps 0–3 each with acceptance criterion). V2.7 preserved.
- [x] **Item 2 — Phase 1 design FORMALLY APPROVED.** CLAUDE.md status header flipped (`Brainstorming` → `Design Phase 1 APPROVED — implementation ready`). Memory file `project_ffc.md` updated (4 edits: frontmatter description · opening paragraph · masterplan reference · Latest/Next session blocks).
- [x] **Item 3 — Collaborator Word brief built** (`docs/FFC-Collaborator-Brief.docx` · 14.2 MB · 305 paragraphs · 33 archive files · **all 10 approved mockup PNGs embedded**). Sections: Cover · Executive Summary · What We're Building · Core Features · Tech Stack · Current Progress · Data Model Snapshot · 10-page mockup gallery · What's Next. Built via `docs/build-collaborator-brief.js` (Node · docx-js · reusable). Pivoted from `preview_screenshot` (timed out) to headless Chrome (`chrome.exe --headless=new --screenshot`) for direct-to-disk PNGs. 10 PNGs saved to `docs/brief-screenshots/` (~13 MB total).
- [x] **Bash path bug fix** — mixed forward/back slashes broke `${f}` expansion; fixed by using forward slashes end-to-end.
- [x] **Docx validation** — skill's `validate.py` crashed on Windows cp1252 console encoding (its own Unicode arrow output); sanity-checked via `python -c zipfile + xml.etree` — archive opens cleanly · document.xml valid XML · 305 paragraphs · all 10 media files present at expected sizes.
- [x] S014 session log written · INDEX row added · CLAUDE.md bumped · todo.md S015 plan (this block)
- [ ] **Logo rollout** — DEFERRED to S015 (still blocked on user asset export)
- [ ] **Implementation kickoff** — DEFERRED to S015 (clean handoff for fresh-focus session)
- [ ] **Brand palette re-alignment** — continues deferred

---

## (Previous) NEXT SESSION — S014 (masterplan V2.8 + logo rollout + formal Phase 1 approval + optional implementation kickoff) [SUPERSEDED — see S015 above]

### Previously-planned S014 agenda (all items executed or explicitly deferred — see "Completed in S014" block above):
1. Write masterplan V2.8 — **DONE**
2. Logo rollout — **DEFERRED** (user asset export still pending)
3. Formally approve Phase 1 design — **DONE**
4. Kick off Phase 1 implementation — **DEFERRED** (scope; cleanest as own session)
5. Close S014 — **DONE**

## Completed in S013 (21/APR/2026, Home PC — partial close)
- [x] Cold-start briefing produced (session-resume skill); INDEX + S012 log + todo.md read; agenda presented
- [x] **Item 1** — §1 non-goal inconsistency fix (captain-draft / auto-pick scoping); stale top-of-file status block refreshed
- [x] **Item 2** — §2 Data Model full walkthrough, S009–S011 deltas from V2.7 all landed: 3 new enums (`user_role+=rejected`, `draft_status`, `draft_reason`), 6 new `notification_kind` values, 2 new columns (`profiles.reject_reason`, `match_players.substituted_in_by`), 4 new tables (`admin_audit_log`, `draft_sessions`, `draft_picks`, `formations`), 3 new `app_settings` keys, 7 new RPCs (#14–20; RPC count 13 → 20) + `log_admin_action` helper + admin-audit convention + ERRCODE matrix + grants, 4 new RLS policy blocks (with `formations` shared_at gating), §2.9 migration layout notes updated
- [x] **Item 3** — §3.0 clean; §3.2–§3.6 10 drift fixes reconciling S002 sub-designs against §2 DDL (voted_at→committed_at, is_admin→user_role, match_guests.goals_scored→match_players, pending_match_entries shape, ref_tokens.used_at→consumed_at, rejected ghost-profile audit, "your position changed" cut)
- [x] **Item 4** — 5v5/7v7 multi-format feature spec: 4 decisions locked (A/B/C/D all option (i)); `match_format` enum + `seasons.default_format` + `matchdays.format` + `effective_format()` + `roster_cap()` helpers + `formations_pattern_valid` CHECK expanded to 5v5 patterns; §2.7 format-awareness convention table; §3.5 guest cap parameterised; §3.6 waitlist parameterised; §3.7 state table amended (5 states); §3.18 Format chip + Matchday-creation sub-section; §3.19 5v5 pattern coordinates + rotation 1..N-1 + 13th AC; WhatsApp `{{roster_cap}}` placeholder
- [x] **Item 5** — §3.14 AC gained 2 S012 CSS contract items (.card flex-shrink:0 + sticky-tabbar); §3.19 gained Layout contract + GK-picker contract paragraphs
- [x] **Item 8** — 3 WIP files moved from `_wip/` to `archive/` (`cp+rm` due to OneDrive `mv` lock); `_wip/` now empty
- [x] New feedback memory saved: `feedback_table_presentation.md` (DB/spec tables render as tables, not prose)
- [x] `project_ffc.md` memory refreshed to S013 close
- [x] MEMORY.md index updated
- [x] S013 session log written · INDEX row added · CLAUDE.md bumped · todo.md S014 plan (this block)
- [ ] **Masterplan V2.8** — DEFERRED to S014 (substantial consolidation doc deserving fresh-session focus)
- [ ] **Logo rollout** — DEFERRED to S014 (blocked on user asset export)
- [ ] **Formal Phase 1 approval** — DEFERRED to S014 (cleaner after V2.8)
- [ ] **Implementation kickoff** — DEFERRED to S014 (or its own session)
- [ ] **Brand palette re-alignment** — continues deferred

---

## (Previous) NEXT SESSION — S013 (finish Phase 1 review + 5v5/7v7 feature spec + logo rollout + approval) [SUPERSEDED — see S014 above]

**Cold-start checklist:**
- Read `CLAUDE.md` (S012 summary at top), `sessions/INDEX.md` (S012 row added at bottom), `sessions/S012/session-log.md` (full walkthrough incl. 2 bug diagnoses + brand discovery + 5v5/7v7 scope lock).
- Memory auto-loads DD/MMM/YYYY · W-D-L colour triplet · fixed column widths · no data without explanation · CSS specificity first · FFC naming rule · always-visible rosters · pill switches · rotating-GK rule. **Add in S013 cold-start:** statusbar v2.2 defensive rule (`.phone-inner > * { flex-shrink: 0; }`) + sticky-tabbar pattern + "re-inspect positioning after content-height changes."

**Status at S012 close:**
- Phase 1 design spec **mostly complete**, but Sections 2, 3.0, 3.2–3.6 not walked through with user yet.
- All 9 phone mockups render correctly. **7 approved** · **2 fixed this session** (Player Profile · Formation) — user re-verified and approved ("formation is perfect now", Profile tabbar fix acknowledged in close-out request).
- Brand logo integrated as JPG stopgap on Poll; user flagged 2 follow-ups (transparent PNG/SVG export · use on every FFC-avatar surface).
- Brand palette re-alignment explicitly deferred (user chose to keep current red/navy mockup palette).
- **New scope locked:** 5v5/7v7 multi-format (season default + per-matchday override). Spec work deferred to S013.

### S013 agenda

1. **User review of Section 2 (Data Model).** Walk §2.1 enums → §2.9 migration layout. Flag any remaining DDL questions.

2. **User review of §3.0 Platform safe-area + §3.2 Last-5 + §3.3 Self-signup + §3.4 Ref entry + §3.5 +1 guest + §3.6 Vote order & waitlist.** Text-only sub-designs; no new mockups needed.

3. **Draft 5v5/7v7 format feature spec additions** across the design spec:
   - **§2.1 Enums** — new `match_format` enum: `'7v7' | '5v5'`.
   - **§2.2 Base entities** — `seasons.default_format match_format NOT NULL DEFAULT '7v7'` (new column).
   - **§2.3 Match data** — `matchdays.format match_format NULL` (inherits from season if null; explicit override if set).
   - **§3.5 +1 guest mechanic** — guest cap becomes 4 in 5v5 (10 total players = 10 commitments; roster-lock threshold drops from 14 to 10; auto-unlock timing unchanged).
   - **§3.7 Poll screen** — poll caps vary by matchday format; status card shows "You're confirmed #N of {10|14}"; waitlist behaviour same.
   - **§3.18 Admin Matches** — matchday creation UI gets a Format chip (7v7 / 5v5), defaulting to season default; admin can override per matchday.
   - **§3.19 Formation planner** — 5v5 patterns added: 1-2-1 · 2-1-1 · 1-1-2 · Custom; rotation uses 4 outfield slots instead of 6; dedicated-GK option unchanged; auto-assign rotation numbers 1–4 in 5v5.
   - **§2.7 RPCs** — `v_match_commitments`, `v_captain_eligibility`, `pick_captains_random`, `approve_match_entry`, `create_match_draft` all need format-aware logic for slot counts and captain-eligibility thresholds (`min 5 matches` scales? user decision needed).
   - **§2.5 app_settings** — consider `default_season_format` flag, or keep it per-season only.
   - **§3.13 Leaderboard** — stats comparable across formats? Or split leaderboards per format? (user decision).
   - **§3.14 Player profile** — filter season stats by format? (user decision).

4. **Fix Section 1 inconsistency** — line 43–44 "Captain draft flow (Phase 2)" non-goal contradicts S009+ Phase 1 additions. Rewrite to: *"Captain **auto-pick** on lock remains Phase 2 — Phase 1 includes the captain helper, manual captain draft with live visibility (§3.7 State 6.5), and post-lock reroll."*

5. **Patch §3.14 + §3.19 spec** to reference S012 CSS fixes (flex-shrink:0 on all phone-inner children + sticky tabbar pattern). Add a short implementation note in each section pointing to lessons.md S012 rows.

6. **Logo rollout (user delivers transparent PNG/SVG; I wire it):**
   - User exports from `FF_LOGO_FINAL.pdf` → transparent PNG 512×512, 192×192, 180×180, 32×32 + SVG. Drop in `shared/` with kebab-case filenames.
   - Wire into mockups that need an FFC crest: audit welcome.html + any sign-in/splash/landing state tile across the 9 mockups.
   - Add PWA manifest `icons[]` stub to masterplan V2.8 migration notes (or to a new §1.x Brand Assets subsection).
   - Document WhatsApp Open Graph image requirements (1200×630 with logo + "Join FFC — Weekly 7v7 poll" copy).

7. **Formally approve Phase 1 design.** User says "approved" after sections 2-6 above clear. Update CLAUDE.md status from "Design Phase 1 not yet fully approved" to "Design Phase 1 APPROVED — implementation ready".

8. **Archive 3 WIP files** → move `_wip/item-b-draft-reroll-spec.md` · `_wip/item-settings-v2-amendments.md` · `_wip/item-formation-planner-spec.md` to `archive/`.

9. **Write masterplan V2.8** if 5v5/7v7 lands in S013 (it's a material data-model addition).

10. **Kick off Phase 1 implementation** if scope permits: GitHub repo creation + Supabase project + Vite scaffold.

11. **Close S013** — session log · INDEX row · CLAUDE.md bump · todo.md S014 plan (or mark Phase 1 design APPROVED).

## Completed in S012 (21/APR/2026, Home PC — partial close, review deferred to S013)
- [x] Cold-start briefing produced (session-resume skill format); preview server started; Section 1 walked through
- [x] User bulk-approved 7 mockups (Poll · Admin Matches · Admin Players · Settings · Match Details · Leaderboard · Captain Helper)
- [x] **Player Profile bug diagnosed + fixed** — Bug A (`.card` compressed from `overflow: hidden` triggering flex auto→0 min-height) → `.card { flex-shrink: 0 }`. Bug B (tabbar mid-scroll after cards uncompressed) → `.tabbar { position: sticky; margin-top: auto }` + removed leftover `padding-bottom: 110px` on `.phone-inner`. DOM-verified.
- [x] **Formation mockup bugs diagnosed + fixed** — every direct `.phone-inner` child compressed; fixed with defensive `.phone-inner > * { flex-shrink: 0; }`. Pitch went 112→506px (4.5×), roster 83→374px, team-strip 34→73px, pattern row 19→52px.
- [x] **GK picker converted** from 4-row radio-card list to native `<select class="gk-select">` with 7 player options (position + rotation slot + minute range), styled for light + dark modes.
- [x] **FFC brand discovered** in `shared/` (FF_LOGO_FINAL.pdf + COLORS.pdf + PHOTO-...jpg). Logo inspected (classic shield crest, gold monogram, laurel + stars). Palette captured (black, white, khaki-gold #AEA583, cream #EDE9E1).
- [x] **Brand palette gap flagged** — mockups use red + navy, neither in brand. User explicitly chose "keep current palette, swap crest only." Deferred palette re-alignment.
- [x] **Logo wired into Poll mockup** — copied `PHOTO-...jpg` → `content/ffc-logo.jpg`; replaced CSS-only shield placeholder with `<img class="crest" src="ffc-logo.jpg">` on both light + dark phone headers. Known defect: JPG has white bg baked in, visible on dark mode.
- [x] **New feature scope locked** — 5v5/7v7 multi-format support. Default 7v7, admin can override per matchday, entire season can be 5v5. Spec work deferred to S013.
- [x] Added 2 new durable rules to `tasks/lessons.md`: statusbar v2.2 (extend flex-shrink:0 to all phone-inner children) + sticky-tabbar pattern + positioning-audit-after-content-change rule.
- [x] S012 session log written · INDEX row added · CLAUDE.md latest-session bumped · todo.md S013 plan (this block)
- [ ] Section 1 inconsistency fix (captain-draft non-goal line) — DEFERRED to S013
- [ ] §2 + §3.0 + §3.2–§3.6 section reviews — DEFERRED to S013
- [ ] 5v5/7v7 feature spec additions — DEFERRED to S013
- [ ] §3.14 + §3.19 spec patches referencing S012 fixes — DEFERRED to S013
- [ ] Transparent PNG/SVG logo (user export) — DEFERRED to S013
- [ ] Logo on every FFC-avatar surface — DEFERRED to S013
- [ ] Formal Phase 1 approval — DEFERRED to S013
- [ ] Archive 3 WIP files — DEFERRED to S013

---

## (Previous) NEXT SESSION — S012 (Phase 1 design review + approval) [SUPERSEDED — see S013 above]

**Cold-start checklist:**
- Read `CLAUDE.md` (S011 latest-session summary), `sessions/INDEX.md` (S011 row added), `sessions/S011/session-log.md` (full handoff — all items complete).
- Memory auto-loads DD/MMM/YYYY · W-D-L colour-triplet · fixed-column-widths · no-data-without-explanation · CSS-specificity-first diagnostic · Visual Companion usage · FFC naming rule · Always-visible rosters (≤14 inline) · Pill switches over checkboxes · Text-cutoff diagnostic order · FFC rotating-GK rule.

**Status:** Phase 1 design spec is **feature-complete**. All 10 mockups exist and pass the safe-area contract. All Depth-B specs written. Masterplan V2.7 captures all data-model deltas. S012 is a review + approval session — no new feature design work expected.

### S012 agenda

1. **User review of full design spec.** Read `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` section by section. User flags any remaining gaps, inconsistencies, or amendments.

2. **Mockup review pass.** If user wants to re-verify any screen after S011 fixes: start preview server on `.superpowers/brainstorm/635-1776592878/content/`, navigate to each screen, confirm layout is correct.

3. **Resolve any gaps surfaced.** Apply spec amendments and mockup tweaks as needed.

4. **Formally approve Phase 1 design.** User says "approved" on the full spec. Update `CLAUDE.md` status from "Design Phase 1 not yet fully approved" to "Design Phase 1 APPROVED — implementation ready".

5. **Archive WIP files.** Move `_wip/item-b-draft-reroll-spec.md` · `_wip/item-settings-v2-amendments.md` · `_wip/item-formation-planner-spec.md` to `archive/` since all content has been integrated into the master spec.

6. **Kick off Phase 1 implementation.** Begin the Phase 1 backlog at the bottom of this file. Recommended starting point: GitHub repo creation + Supabase project + Vite scaffold.

7. **Close S012.** Session log · INDEX row · CLAUDE.md status bump · todo.md S013 plan.

## Completed in S011 (21/APR/2026, Home PC — full close)
- [x] Cold-start briefing produced; continued immediately on user "continue"
- [x] **Item 0 CRITICAL** — `flex-shrink: 0` applied to `.statusbar` in all 9 phone-frame mockups; Profile + Formation verified at 59px computed height via DOM inspection
- [x] **Item 1** — `_wip/item-b-draft-reroll-spec.md` integrated: §3.7 State 6.5 "Draft in progress" inserted; captain reroll sub-section appended; §3.18 Phase 5.5 + always-visible roster added
- [x] **Item 2** — `_wip/item-settings-v2-amendments.md` integrated: §3.16 dark default, 6 push keys, pill-toggle UI, AC1–AC7, Section-5 wiring stub
- [x] **Item 3** — `_wip/item-formation-planner-spec.md` integrated: §3.19 full Depth-B spec inserted with rotating-GK toggle, formations DDL, 12 acceptance criteria
- [x] **Item 4** — §3.18 always-visible roster documented; tap-to-expand text removed
- [x] **Item 5** — §3.7 spec states table fully synced: "Nine key states" header; State 6/6.5/7/8 all updated; AC9 + AC10 added
- [x] **Item 6** — `planning/FFC-masterplan-V2.7.md` created (full S009+S010+S011 consolidation)
- [x] **Item 7** — S011 close-out: session log created · INDEX row added · CLAUDE.md bumped · todo.md S012 plan written

---

## NEXT SESSION — S011 (continuation of S010 — close-out deferred) [SUPERSEDED — see S012 above]

### 0. CRITICAL — statusbar `flex-shrink: 0` fix (diagnosed S010, deferred at user request)

User reported Profile + Formation still render with layout shifted up behind Dynamic Island despite all other S010 fixes. Diagnosed personally via `preview_inspect`: `.phone-inner` is `display: flex; flex-direction: column` so the first flex child `.statusbar` inherits default `flex-shrink: 1`. When content overflows the 844px phone height (only on Profile + Formation — longest-content mockups), flex compresses the statusbar from 59px → 17–25px. All content drifts up, topbar/team-strip sits BEHIND the Dynamic Island cutout. Other 8 mockups are unaffected because their content fits.

**Fix:**
```css
.statusbar {
  /* existing rules… */
  flex-shrink: 0;   /* or: flex: 0 0 var(--safe-top); */
}
```

**Apply to ALL 10 phone-frame mockups** (not just Profile + Formation) to prevent the bug recurring on any future content expansion:
- `welcome.html`
- `3-1-v2-captain-helper.html`
- `3-7-poll-screen.html`
- `3-13-leaderboard.html`
- `3-14-player-profile.html`
- `3-15-match-detail.html`
- `3-16-settings.html`
- `3-17-admin-players.html`
- `3-18-admin-matches.html`
- `3-19-formation.html`

**Verify in preview** after each edit — `.statusbar` computed height should equal `--safe-top` (59px) regardless of content length. Hard-reload with `?v=${Date.now()}` to bypass cache. If Profile or Formation still drift after the fix, next suspect is `.phone-inner` interaction with `overflow-y: auto` — wrap content in an inner `.content` div so `.phone-inner` arranges `.statusbar` + `.content` at their natural heights.

**Update lesson row already landed** — reference `tasks/lessons.md` S010 row for diagnostic walkthrough.

### 1. Integrate subagent B scratch (`_wip/item-b-draft-reroll-spec.md`) into master spec

- **§3.7 states table:** insert new State 6.5 "Draft in progress" between current State 6 (Roster locked) and State 8 (Teams revealed). Preserve sub-numbering (6.5 / 8.5) per subagent B's recommendation rather than renumbering 7→8→9.
- **§3.7 new sub-section:** append "Post-lock substitution with captain reroll right" after the current Phase-2-deferred block. Covers `dropout_after_lock` notification · captain modal `[Accept substitute]` green / `[Request reroll]` amber · reroll triggers new `draft_sessions` row with `reason='reroll_after_dropout'` · 12h-before-kickoff cutoff · captain-is-the-dropout routed via `captain_dropout_needs_replacement` to admin.
- **§3.18 Admin Matches touch-up:** add "Phase 5.5 · Draft in progress" to phases ladder + admin action "Force complete draft / abandon" for stuck sessions (threshold from `app_settings.draft_stuck_threshold_hours`, default 6).
- **V2.7 migration-notes block:** append new tables `draft_sessions` + `draft_picks` + `match_players.substituted_in_by` column + new enums `draft_status` + `draft_reason` + RPCs `promote_from_waitlist` · `accept_substitute` · `request_reroll` · `submit_draft_pick` + notifications `dropout_after_lock` · `draft_reroll_started` · `reroll_triggered_by_opponent` · `captain_dropout_needs_replacement` + app_settings keys.

### 2. Integrate subagent A scratch (`_wip/item-settings-v2-amendments.md`) into §3.16 master spec

- Replace §3.16 row 1 (Theme): **default = dark** (was `system`); document 2026-04-20 preference change.
- Replace §3.16 row 2 (Push notifications): updated push_prefs shape (6 keys, no `position_changed`, + `dropout_after_lock`); layout ASCII updated; `poll_reminder` timing = 2 min before poll close.
- Replace §3.16 acceptance criteria block with scratch's AC3–AC7 additions.
- Add Section-5 wiring note (from scratch): `poll_reminder` fires at `poll_close_at - 2 min`; `dropout_after_lock` fires to full roster + admins on cancel-after-lock trigger; `position_changed` removed (migration: ignore legacy jsonb key, no DDL change).
- Update §3.16 to reflect **pill-toggle UI** (not checkbox) per S010 user feedback — see `feedback_pill_toggles_over_checkboxes.md` memory.
- **Flag for user review:** subagent A documented 2-min `poll_reminder` is intentionally aggressive — if post-launch feedback pushes back, Section 5 could expose timing as a Phase-2 user-configurable preference.

### 3. Integrate subagent C scratch (`_wip/item-formation-planner-spec.md`) into master spec

- Insert full **§3.19 Formation planner (NEW in S009)** after §3.18. Update spec to reflect S010 additions:
  - **Rotating-GK gameplay rule** — captain picks starter + toggle `Dedicated GK` vs `Rotate every 10 min` + auto-assign 1–6 rotation numbers for outfield swaps.
  - Team-colour header strip contract (WHITE/BLACK with "YOU'RE ON {team}" headline).
  - Roster card: avatar · name · position pill · rotation chip (fixed column widths).
- Append V2.7 migration notes: new `formations` table + **`formation_rotation_order`** jsonb column + starting-GK pointer + `upsert_formation` / `share_formation` RPCs + `formation_reminder` / `formation_shared` notifications.
- §3.19 mockup safe-area contract already verified by subagent D (6-point checklist passed), but re-verify AFTER item 0 `flex-shrink: 0` fix lands.

### 4. Admin matches spec touch-up

- §3.18 master spec must document always-visible-roster pattern (S010 user feedback) per `feedback_always_visible_rosters.md` memory. Remove any spec text about tap-to-expand behaviour.

### 5. Update §3.7 spec state table to reflect S010 additions (all mockup work DONE in S010, spec still needs sync)

- State 6 row: document green+red button row (`[Keep my spot]` safe-confirm green · `[Cancel anyway]` destructive-confirm red). Call out as durable app-wide rule: green = safe-confirm, red = destructive-confirm.
- State 7 row: same green+red rule. `[Keep my spot]` + `[Confirm cancel]`.
- State 8 row: update to describe 2-team section layout (WHITE TEAM header + 7 rows · BLACK TEAM header + 7 rows) — NOT single-list + per-row pills. Remove per-row `[W]/[B]` pill contract (section header is the team indicator).
- Add State 6.5 row: "Draft in progress" — live Supabase realtime view of `draft_sessions` + `draft_picks`. Live chip + two-column picks-so-far + pool + last-pick footer.
- Header count: "Eight key states" → "Nine key states" OR keep 6.5/8.5 sub-numbering per subagent B — user to decide.
- Acceptance criteria: add criterion for 2-team layout render + criterion for State 6.5 realtime sync.

### 6. Write masterplan V2.7

`planning/FFC-masterplan-V2.7.md` — consolidate S009+S010 deliverables: §3.0 / §3.15 upgrade / §3.16 / §3.17 / §3.18 / §3.19 + safe-area pattern v2.1 + live draft visibility + captain reroll + formation planner + rotating-GK rule + Settings v2 defaults + data-model deltas (see S009 log + item 1–3 above for consolidated list).

### 7. Close S011

Session log · INDEX row · CLAUDE.md latest-session bump · todo.md S012 plan (or mark Phase 1 design APPROVED if no new gaps surface).

---

## Completed in S010 (21/APR/2026, Home PC — partial close, spec integration deferred)
- [x] Cold-start briefing produced (resume-session skill format)
- [x] 5 new S009 mockups reviewed with user; 4 approved (Captain helper · Leaderboard · Match detail · Admin players); 5 amendments requested
- [x] **5 parallel subagents dispatched + completed** — amendments applied to Profile · Settings · Admin matches · Formation · Poll
- [x] **Admin matches** — full 14-player roster always-visible (7 WHITE + 7 BLACK), tap-to-expand removed
- [x] **Settings** — 12 pill toggles (10 ON red, 2 OFF muted) replacing checkboxes; dark variant verified
- [x] **Player profile** — `.kpi` + `.achievement-tile` flex-column + min-height fix applied (agent fix correct; rendered visible in isolation)
- [x] **Formation planner** — major redesign: Dynamic Island clearance (`align-items: flex-end` + `padding-bottom: 8px`), team-colour header strip, 7-player roster with rotation chips, rotating-GK toggle, GK-selection radio card, rotation numbers 1–7 on pitch tokens, 4 state tiles
- [x] **Poll mockup S009 backlog closed** — State 6 + State 7 green/red action buttons, State 8 restructured to 2-section (WHITE 7 rows · BLACK 7 rows), NEW State 6.5 "Draft in progress" tile with live-chip + pulsing dot + two-column picks + pool + last-pick footer
- [x] 4 memory files saved + MEMORY.md index updated: `feedback_always_visible_rosters.md` · `feedback_pill_toggles_over_checkboxes.md` · `feedback_text_cutoff_diagnostic.md` · `project_rotating_gk_rule.md`
- [x] **Late-session statusbar flex-shrink bug diagnosed personally** (no subagent) via `preview_inspect` — `.phone-inner` flex-column compresses `.statusbar` from 59px → 17–25px when content overflows 844px; only Profile + Formation hit it
- [x] lessons.md updated with 2 new rows (S009 statusbar v2 flank-island · S010 statusbar v2.1 flex-shrink)
- [x] sessions/S010/session-log.md written (~180 lines with diagnostic walkthrough)
- [x] sessions/INDEX.md S010 row added + S011 next-session line
- [x] tasks/todo.md updated (this block) — S011 plan with item 0 CRITICAL bug fix
- [x] CLAUDE.md latest-session bumped to S010
- [ ] Item 0–6 above (bug fix + 3 scratch integrations + admin matches spec touch-up + §3.7 spec update + masterplan V2.7) — all DEFERRED to S011
- [ ] S011 close-out

---

## NEXT SESSION — S010 (continuation of S009 — forced pause on tokens)

**Cold-start checklist:**
- Read `CLAUDE.md`, `sessions/INDEX.md` (S009 row added), `sessions/S009/session-log.md` (full handoff detail), `sessions/S009/agent-prompts.md` (subagent prompts to relaunch if needed), `tasks/lessons.md` (S008 + S009 env() rows present; add statusbar-v2 row).
- Memory auto-loads DD/MMM/YYYY · W-D-L colour-triplet · fixed-column-widths · no-data-without-explanation · CSS-specificity-first diagnostic · Visual Companion usage · **FFC naming rule** (app is "FFC" only — never "Friends FC" or "Friends Football Club").

**Items 1–6 of S008 plan = DONE in S009.** S009 hit a forced pause with subagent C (formation planner) still in-flight and 3 scratch files awaiting integration. S010 is an integration + mockup-finishing + close-out session.

### 0. Check subagent residue (do first)

- `ls _wip/` — expect: `item-b-draft-reroll-spec.md` (329 lines, DONE by subagent B) · `item-settings-v2-amendments.md` (138 lines, DONE by subagent A) · `item-formation-planner-spec.md` (check if subagent C finished after pause).
- `ls .superpowers/brainstorm/635-1776592878/content/` — expect: all 8 existing mockups + `3-19-formation.html` if subagent C finished.
- If `item-formation-planner-spec.md` or `3-19-formation.html` MISSING, relaunch subagent C using the prompt in `sessions/S009/agent-prompts.md`.

### 1. Integrate subagent B scratch (`_wip/item-b-draft-reroll-spec.md`) into master spec

- **§3.7 states table:** insert new State 6.5 "Draft in progress" between current State 6 (Roster locked) and State 8 (Teams revealed). Preserve sub-numbering (6.5 / 8.5) per subagent B's recommendation rather than renumbering 7→8→9.
- **§3.7 new sub-section:** append "Post-lock substitution with captain reroll right" after the current Phase-2-deferred block. Covers `dropout_after_lock` notification · captain modal `[Accept substitute]` green / `[Request reroll]` amber · reroll triggers new `draft_sessions` row with `reason='reroll_after_dropout'` · 12h-before-kickoff cutoff · captain-is-the-dropout routed via `captain_dropout_needs_replacement` to admin.
- **§3.18 Admin Matches touch-up:** add "Phase 5.5 · Draft in progress" to phases ladder + admin action "Force complete draft / abandon" for stuck sessions (threshold from `app_settings.draft_stuck_threshold_hours`, default 6).
- **V2.7 migration-notes block:** append new tables `draft_sessions` + `draft_picks` + `match_players.substituted_in_by` column + new enums `draft_status` + `draft_reason` + RPCs `promote_from_waitlist` · `accept_substitute` · `request_reroll` · `submit_draft_pick` + notifications `dropout_after_lock` · `draft_reroll_started` · `reroll_triggered_by_opponent` · `captain_dropout_needs_replacement` + app_settings keys.

### 2. Integrate subagent A scratch (`_wip/item-settings-v2-amendments.md`) into §3.16 master spec

- Replace §3.16 row 1 (Theme): **default = dark** (was `system`); document 2026-04-20 preference change.
- Replace §3.16 row 2 (Push notifications): updated push_prefs shape (6 keys, no `position_changed`, + `dropout_after_lock`); layout ASCII updated; `poll_reminder` timing = 2 min before poll close.
- Replace §3.16 acceptance criteria block with scratch's AC3–AC7 additions.
- Add Section-5 wiring note (from scratch): `poll_reminder` fires at `poll_close_at - 2 min`; `dropout_after_lock` fires to full roster + admins on cancel-after-lock trigger; `position_changed` removed (migration: ignore legacy jsonb key, no DDL change).
- **Flag for user review:** subagent A documented 2-min `poll_reminder` is intentionally aggressive — if post-launch feedback pushes back, Section 5 could expose timing as a Phase-2 user-configurable preference.

### 3. Integrate subagent C scratch (`_wip/item-formation-planner-spec.md`) into master spec

- If scratch file exists: insert full **§3.19 Formation planner (NEW in S009)** after §3.18. Otherwise relaunch subagent C first (see item 0).
- Append V2.7 migration notes: new `formations` table + `upsert_formation` / `share_formation` RPCs + `formation_reminder` / `formation_shared` notifications.
- Verify `3-19-formation.html` mockup uses correct statusbar v2 safe-area pattern (NOT `padding-top: var(--safe-top)`).

### 4. Finish 3-7 poll mockup updates (not yet applied at S009 pause)

- **State 7 mini-tile:** replace current `<span class="pill danger">−1 PT + 7-DAY BAN</span><span>Confirm?</span>` with actual `[Keep my spot]` green + `[Confirm cancel]` red action buttons. Add `.btn-success { background: var(--success); color: #fff; ... }` + `.btn-danger { background: var(--danger); color: #fff; ... }` button styles.
- **State 8 mini-tile:** expand to show 2-team roster layout — `WHITE TEAM` header + 7 rows, `BLACK TEAM` header + 7 rows (currently only shows 3 proof-of-concept rows). Each row = avatar + name + position pills. Guest rows keep gold-italic treatment.
- **Add State 6.5 mini-tile:** "Draft in progress" — visualisation of picked/unpicked players while captains pick (after subagent B integrated).

### 5. Update §3.7 spec state table to reflect S010 additions

- State 7 row: document button colour rule (`[Keep my spot]` success-green default focus · `[Confirm cancel]` danger-red destructive). Call out as durable app-wide rule: green = safe-confirm, red = destructive-confirm.
- State 8 row: update to describe 2-team section layout (was single-list + per-row pills).
- Header count: "Eight key states" → "Nine key states" OR keep 6.5/8.5 sub-numbering per subagent B — user to decide.
- Acceptance criteria: add criterion for 2-team layout render + criterion for State 6.5 realtime sync.

### 6. Log new lessons

- `tasks/lessons.md` — add 3rd row for S009 v2 statusbar-flank lesson: `padding-top: var(--safe-top)` on statusbar was wrong (pushes content below notch); correct pattern is `height: var(--safe-top) + display: flex + justify-content: space-between` so time/battery flank the island on left/right. TWO iOS pattern mistakes from one retrofit.

### 7. Write masterplan V2.7

`planning/FFC-masterplan-V2.7.md` — consolidate S009 deliverables: §3.0 / §3.15-upgrade / §3.16 / §3.17 / §3.18 / §3.19 + safe-area pattern + live draft visibility + captain reroll + formation planner + Settings v2 defaults + data-model deltas (consolidated list already in S009 log).

### 8. Close S010

Session log · INDEX row · CLAUDE.md latest-session bump · todo.md S011 plan.

---

## Completed in S009 (20/APR/2026, Home PC — forced pause)
- [x] **Item 0 v1 + v2** — Safe-area retrofit on all 5 approved mockups (took 2 iterations — env() fallback semantic + statusbar-flank-island semantic)
- [x] **Item 3** — §2.7 new RPCs `set_matchday_captains` + `update_guest_stats` + §2.3 `match_guests` audit cols landed
- [x] **Item 6** — `_wip/iphone-safe-area-research.md` → `docs/platform/iphone-safe-area.md` · §3.0 Platform safe-area cross-cutting sub-section · CLAUDE.md Rule #10 expanded
- [x] **Item 5 (partial)** — §3.7 State 8 "Teams revealed" added + acceptance criterion #8 + Phase-2-deferred line deleted + State 8 mini-tile added to mockup. STATE 7 BUTTONS + STATE 8 ROSTER REDESIGN NOT DONE.
- [x] **Item 1** — §3.16 Settings Depth-B spec + `3-16-settings.html` mockup (integrated)
- [x] **Item 2** — §3.15 Match-detail upgraded STUB → Depth-B + `3-15-match-detail.html` mockup (integrated)
- [x] **Item 4** — §3.17 Admin Players + §3.18 Admin Matches Depth-B specs + 2 mockups (integrated)
- [x] Safe-area v2 fix applied to 7 phone mockups (statusbar `height: var(--safe-top)` flex-flank pattern)
- [x] FFC naming corrected — "Friends FC" / "Friends Football Club" removed from CLAUDE.md + poll crest (historical session logs preserved as audit record)
- [x] User memory saved — `user_app_name.md` (FFC only, never expand)
- [x] FFC crest logo upgraded — poll-mockup crest widened to shield-monogram "FFC"
- [x] lessons.md S009 env() fallback row added
- [x] **Subagent B** — captain reroll + live draft scratch DONE at `_wip/item-b-draft-reroll-spec.md` (329 lines, not yet integrated)
- [x] **Subagent A** — Settings v2 scratch DONE at `_wip/item-settings-v2-amendments.md` (138 lines, not yet integrated); `3-16-settings.html` directly updated (dark default, 6 checkboxes, statusbar v2)
- [ ] **Subagent C** — Formation planner in-flight at forced pause (check S010 open)
- [ ] Integrate 3 scratch files into master spec → see S010 item 1–3 above
- [ ] Finish 3-7 poll mockup updates (state 7 green/red buttons, state 8 roster redesign, state 6.5 tile) → see S010 item 4
- [ ] Update §3.7 spec states table with S010 additions → see S010 item 5
- [ ] Log lessons.md v2 statusbar-flank row → see S010 item 6
- [ ] Masterplan V2.7 → see S010 item 7
- [ ] Session close-out (S009 close was partial; S010 completes it)

---

## NEXT SESSION — S009 (home PC, continuation of S008)

**Cold-start checklist:**
- Read `CLAUDE.md`, `sessions/INDEX.md`, `sessions/S008/session-log.md` (→ S007 log only if decision context is fuzzy), `planning/FFC-masterplan-V2.6.md`, `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` (Section 1 ✓ · Section 2 ✓ w/ S005+S006+S007 amendments · Section 3.0 ✓ · **§3.7 Poll APPROVED** · §3.1 SUPERSEDED · **§3.1-v2 Captain helper APPROVED** · §3.2–§3.6 from S002 carry · **§3.13 Leaderboard APPROVED** · **§3.14 Player profile APPROVED v3 with S007 R1–R6** · **§3.15 Match-detail STUB**).
- Memory auto-loads DD/MMM/YYYY date format + W-D-L colour-triplet rule + fixed-column-widths rule + **no-data-without-explanation rule** + **CSS-specificity-first diagnostic rule** + Visual Companion rule.
- Continue working in Depth B (screen spec + mockup gate).

**Decisions already LOCKED in S008 (no framing work needed in S009 — go straight to execution):**
1. **§3.7 Poll team-colour preview = Option A.** Full state 8 — status card row `You're on ⚪/⚫` + per-row `[W]/[B]` pills on all members + guests. Delete the Phase-2-deferred line 1512 from §3.7.
2. **§3.15 Match-detail:** W/D/L chip = profile-owner's perspective · guest rows lighter (goals/cards only, no S007 rating chip / description) · wide-viewport = max 640w × 80vh above 768px (user to verify in mockup).
3. **Settings screen = 6 rows.** Theme · Push prefs · Leaderboard sort · Positions re-entry · **Display name (new)** · Account. State tile #2 = first-visit push-permission-prompt (signed-out dropped, screen auth-gated).
4. **NEW — iPhone notch / Dynamic Island.** Research complete in `_wip/iphone-safe-area-research.md`. Pattern = `viewport-fit=cover` meta + CSS `env(safe-area-inset-*)`. Dynamic Island uses same `safe-area-inset-top` as classic notch. **GAP:** all 5 approved mockups need retrofit (they currently don't reference safe-area).

### 0. MOCKUP SAFE-AREA RETROFIT (new S009 priority — do first before any new mockups)

- Retrofit all 5 approved mockups: `3-7-poll-screen.html` · `3-13-leaderboard.html` · `3-14-player-profile.html` · `3-1-v2-captain-helper.html` · `welcome.html`.
- Add to `<head>`: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.
- Add CSS root custom props (`--safe-top/right/bottom/left` bound to `env(safe-area-inset-*)`).
- Apply `padding-top: var(--safe-top)` to `.topbar`; `padding-bottom: var(--safe-bottom)` to `.bottom-nav` and fixed CTA stacks.
- Sheets (§3.5 invite, §3.7 penalty, §3.14 edit sheet) pad internal scroll with `calc(var(--safe-bottom) + 16px)`.
- **Add an iPhone-14-Pro Dynamic-Island cutout** to the phone-frame CSS so safe-area padding is visually obvious at mockup review.
- Bake the pattern into the mockup template for future screens.

### 1. Settings screen — Depth B + mockup

**Scope locked (6 rows):**

**Session plan (priority order):**

### 1. Settings screen skeleton — Depth B + mockup

Small scope; closes a near-final Phase 1 gap and gives the profile edit sheet a sibling entry point.

- **Theme row** — three chips `Light · Dark · System`. Writes to `profiles.theme_preference` (same handler as §3.14 edit sheet).
- **Push prefs** — master toggle + category toggles (poll, match, admin events). v1.1 per-notification controls explicitly deferred.
- **Leaderboard sort row** — five chips `Points · Goals · MOTM · Wins · Last-5`. Writes to `profiles.leaderboard_sort` (same handler as §3.14).
- **Positions entry point** — text row routing to §3.14 edit sheet positions section (not duplicated).
- **Display name row (S008 addition)** — text row opening an inline rename sheet. Writes to `profiles.display_name`. Validation: 1–40 chars, no pure-whitespace, unique? (confirm during spec — probably not required since it's a social label).
- **Account section** — email (read-only), change password link, logout.
- Mockup: light + dark phones side-by-side; 2 state tiles — **push-permission-prompt (first-visit)** + **push-permission-denied fallback**. Signed-out tile dropped (screen is auth-gated).

### 2. §3.15 Match-detail sheet — full Depth-B + mockup

Last Phase 1 player-side stub. Scope locked in S006, S008 sub-decisions applied:

- Read-only bottom sheet (85% viewport height on mobile, **640w × 80vh max above 768px** — user to verify), drag handle, swipe-dismiss, scroll-preserved on return.
- Data sources: `matches` + `matchdays` + `seasons` + `match_players` + `match_guests`.
- Content layout: header strip (**W/D/L chip from profile-owner's perspective** — S008 decision) · MOTM row (guest MOTM italic + gold avatar) · White roster · Black roster · **late-cancel penalties strip** · footer line.
- **Guest rows = lighter rendering** (S008 decision): goals/cards inline same as members, italic + gold avatar preserved for visual distinction, **no S007 rating chip or description** (those stay poll-screen recruitment context only).
- Entry: tap any §3.14 Recent-matches row.
- Acceptance criteria (5 items from S006 stub); Phase-1 out-of-scope items enumerated (timeline, assists, H2H, share-as-image).
- Mockup: light + dark phones + ≥2 state tiles (game with late-cancels, game with no MOTM). **Apply safe-area retrofit from item 0.**

### 3. §2.7 Part 5B RPC follow-up

Finalize the RPCs queued during S007:
- **`set_matchday_captains(matchday_id, white_profile_id, black_profile_id) → record`** (admin, SECURITY DEFINER). Validates roster membership + non-guest + non-banned. Writes `is_captain` flags + `matches.captain_assigned_at` + `matches.captain_assigned_by`. Concurrency: last write wins.
- **`update_guest_stats(guest_id, primary_position, secondary_position, stamina, accuracy, rating, description) → record`** (admin, SECURITY DEFINER). Allows admin to correct guest stats if the inviter got them wrong. Enforces the CHECKs defensively. Audit trail via a new `match_guests.updated_by` + `.updated_at` pair (to be added in the same edit).

### 4. Admin dashboard family — start

5-screen family (Players · Matches · Seasons · Admins · Schedule) + match-results edit screen + super-admin management. Big batch; may span S008 + S009. For S008, focus:

- **Players admin screen** (list · filter · invite · edit · deactivate · position override · role assign). Entry via admin tab.
- **Matches admin screen** (list by matchday · approve pending · edit approved results with audit trail · override MOTM).

Other three screens (Seasons · Admins · Schedule) queued for S009.

### 5. §3.7 Poll spec amendment — Option A (State 8 "Teams revealed")

S008 locked Option A. Execute in S009:
- **Delete** the Phase-2-deferred line in §3.7 spec (currently line 1512: "Admin's team-colour pre-assignment preview on this screen once roster is locked (still-open S005 decision)").
- **Add State 8 to the 7-state table** — "Teams revealed" — trigger: `match_players` rows exist for active matchday AND viewer's `profile_id` is among them. Status card gains `You're on ⚪ White` or `You're on ⚫ Black` row (tiny chip, same visual weight as rank). Roster list gains `[W]` / `[B]` pill next to position pills on every member + guest row.
- **Amend acceptance criteria** (add #8 or similar: "State 8 renders viewer's team chip within 500ms of `match_players` materialisation for the matchday").
- **Update `3-7-poll-screen.html` mockup** — add a State 8 alternate-state tile (both light and dark variants). Captain identity NOT revealed here — reserved for match-prep (Phase-2-deferred). **Apply safe-area retrofit from item 0.**
- Mark the S005 open decision as CLOSED in the design spec's "Open Decisions" section + in CLAUDE.md.

### 6. §3.0 Platform safe-area sub-section + research doc promotion

- Add a new numbered sub-section to §3.0 Navigation + IA called "Platform safe-area (notch / Dynamic Island / home indicator)". Content: the CSS pattern + why it matters + reference to source file. Every subsequent screen spec inherits this implicitly.
- Bump CLAUDE.md Rule #10 from one line to a short paragraph that points to the research doc.
- Promote `_wip/iphone-safe-area-research.md` out of `_wip/` into either `docs/platform/` or `docs/superpowers/specs/` (probably the latter as a companion doc to the Phase 1 design spec).

### 7. Close S009

Session log · INDEX row · CLAUDE.md latest-session bump · todo.md S010 plan · masterplan V2.7 if data-model amendments (e.g., new RPCs in §2.7, audit columns on `match_guests`).

## Completed in S008 (20/APR/2026, Work PC — decisions locked + safe-area research)
- [x] Cold-start briefing produced (CLAUDE.md + INDEX + S007 log + design-spec §3.7/§3.15 read)
- [x] **§3.7 poll team-colour-preview LOCKED = Option A** (full state 8). Closes S005 open item.
- [x] **§3.15 match-detail sub-decisions LOCKED:** W/D/L = profile-owner perspective · guest rows = lighter (goals/cards only) · wide-viewport = 640w × 80vh provisional
- [x] **Settings screen scope LOCKED = 6 rows** (display-name added; extras deferred; push-permission-prompt tile replaces signed-out)
- [x] **iPhone notch / Dynamic Island researched** — `_wip/iphone-safe-area-research.md` written. Gap discovered: all 5 approved mockups lack safe-area CSS. Retrofit added as S009 item 0.
- [x] Lesson logged: mockup review never enforced CLAUDE.md Rule #10.
- [x] S008 session log written; INDEX row added; CLAUDE.md latest-session bumped; todo.md S009 plan written
- [ ] *(No design-spec edits or mockup edits — all drafting deferred to S009 on home PC.)*

## Completed in S007 (20/APR/2026)
- [x] §2.1 amended with `guest_rating` + `guest_trait` enums
- [x] §2.3 `match_guests` amended with 6 new columns + positions-differ CHECK + description-length CHECK + S007 migration note
- [x] §3.5 invite flow rewritten with "Tell us about your +1" 2-step form
- [x] §3.5 data-model-notes paragraph reconciled with §2.3 DDL (drift fixed)
- [x] §3.5 "Captain formula criterion 1" line fixed (S004 simplification drift)
- [x] §3.7 Poll screen full Depth-B spec written (~180 lines — closed S005 gap)
- [x] §3.7 poll mockup v3 — guest rows restructured with pills, rating chip, description (light + dark)
- [x] §3.14 mockup v3 — R1 W-D-L alignment fix + R2 last-5 centering fix + R3 MP added + R4 Rank removed from KPI grid + R5 Totals → Achievements + R6 zero-match state updated (light + dark + zero-match tile + callout list + header + title)
- [x] §3.14 spec — all R1–R6 applied (IA point 3, IA point 5, data-sources, loading, acceptance, decisions, section header)
- [x] §3.1 annotated as SUPERSEDED with pointer to §3.1-v2
- [x] §3.1-v2 Captain helper Depth-B spec (~180 lines)
- [x] `3-1-v2-captain-helper.html` v1 mockup (~1,000 lines: light formula-mode + dark randomizer-mode + 4 state tiles)
- [x] Masterplan V2.6 written (2 new numbered sections §11 + §12); V2.5 preserved
- [x] Session log S007 written; INDEX row added; CLAUDE.md latest-session bumped; todo.md S008 plan written

## Completed in S006 (19/APR/2026 home + 20/APR/2026 work)
- [x] §3.13 Leaderboard spec (Depth B) drafted home PC, APPROVED work PC with 4 open decisions (O1–O4) resolved
- [x] `3-13-leaderboard.html` v1 → v2 mockup (light + dark primary phones + 6 state tiles + callout)
- [x] W-D-L colour-triplet rule locked as app-wide (green/grey/red)
- [x] Column-header row + MP column added to leaderboard rows
- [x] Fixed column widths applied to numeric cells for stable row-to-row alignment
- [x] Medal tint polish on top-3 leaderboard rows
- [x] Late-cancel penalty removed from leaderboard column, relocated to §3.15 match-detail sheet
- [x] §3.14 Player profile spec (Depth B) APPROVED with 5 open decisions (P1–P5) resolved
- [x] `3-14-player-profile.html` v1 → v2 mockup (light self + dark other primary phones + 6 state tiles)
- [x] §3.14 Totals card scope dropdown — *retired in S007 R5*
- [x] §3.14 Edit-sheet spec (positions + theme + leaderboard-sort in one slide-up sheet)
- [x] §3.15 Match-detail sheet STUB added to spec (Phase 1 scope, full Depth-B deferred)
- [x] §2.1 new enum `leaderboard_sort`
- [x] §2.2 new column `profiles.leaderboard_sort` NOT NULL DEFAULT `'points'` + S006 migration note
- [x] RLS `profiles_self_update` policy stubbed in §2.8 scope
- [x] Guest-player-stats scope Q1–Q6 all answered (implementation applied in S007)
- [x] §3.1-v2 captain helper layout locked (drafted in S007)
- [x] Session log S006 written; INDEX, CLAUDE.md, todo.md updated

## Completed in S006 (19/APR/2026 home + 20/APR/2026 work)
- [x] §3.13 Leaderboard spec (Depth B) drafted home PC, APPROVED work PC with 4 open decisions (O1–O4) resolved
- [x] `3-13-leaderboard.html` v1 → v2 mockup (light + dark primary phones + 6 state tiles + callout)
- [x] W-D-L colour-triplet rule locked as app-wide (green/grey/red)
- [x] Column-header row + MP column added to leaderboard rows
- [x] Fixed column widths applied to numeric cells for stable row-to-row alignment
- [x] Medal tint polish on top-3 leaderboard rows
- [x] Late-cancel penalty removed from leaderboard column, relocated to §3.15 match-detail sheet
- [x] §3.14 Player profile spec (Depth B) APPROVED with 5 open decisions (P1–P5) resolved
- [x] `3-14-player-profile.html` v1 → v2 mockup (light self + dark other primary phones + 6 state tiles)
- [x] §3.14 Totals card scope dropdown (current season / past seasons / entire career)
- [x] §3.14 Edit-sheet spec (positions + theme + leaderboard-sort in one slide-up sheet)
- [x] §3.15 Match-detail sheet STUB added to spec (Phase 1 scope, full Depth-B deferred)
- [x] §2.1 new enum `leaderboard_sort`
- [x] §2.2 new column `profiles.leaderboard_sort` NOT NULL DEFAULT `'points'` + S006 migration note
- [x] RLS `profiles_self_update` policy stubbed in §2.8 scope
- [x] Guest-player-stats scope Q1–Q6 all answered (implementation deferred to S007)
- [x] §3.1-v2 captain helper layout locked (1-screen mode toggle + pair-confirmation sheet — draft deferred to S007)
- [x] Session log S006 written; INDEX, CLAUDE.md, todo.md updated

## Completed in S005 (19/APR/2026)
- [x] Masterplan V2.4 written (captures S004 refinements)
- [x] Section 3.0 Navigation + IA approved (4-tab/5-tab/anon modes, 16 routes, auth-aware layouts)
- [x] §3.7 Poll screen spec (Depth B)
- [x] §3.7 Poll screen mockup v2 (light + dark + alternate-state tiles)
- [x] Player positions data model amended (enum + 2 columns + CHECK + index)
- [x] Light/Dark theme preference data model amended (enum + column + default 'system')
- [x] Poll screen mockup updated with position pills
- [x] Masterplan V2.5 written (positions + theme + CM exclusion + Section 3.0 lock)
- [x] Session log S005 written; INDEX, CLAUDE.md, todo.md updated

## Completed in S004 (19/APR/2026)
- [x] Part 4 DDL approved — notifications, player_bans, push_subscriptions, app_settings, scheduled_reminders
- [x] Part 5A DDL approved — views (v_match_commitments, v_season_standings, v_player_last5, v_captain_eligibility)
- [x] Part 5B DDL approved — SECURITY DEFINER RPCs (11 total incl. captain-pick helpers)
- [x] Part 5C DDL approved — RLS policies per table per role + anon RPC-only boundary
- [x] Self-review: column-name drift reconciled (Section 2 authoritative)
- [x] Self-review: create_match_draft RPC added (separates team-entry INSERT from approval UPDATE)
- [x] Self-review: pgcrypto + pg_cron extensions noted
- [x] Self-review: Decisions Locked expanded to 13 enumerated items
- [x] Section 1 (Architecture & Stack) formally approved
- [x] Cron schedule revised (5 seeded reminders Mon 17:00 / Tue 21:00 / Wed 20:00 / Wed 22:00 / Thu 12:00)
- [x] Late-cancel penalties revised (−1 after lock; −1 + 7d ban within 24h)
- [x] Captain formula simplified (3 per-player criteria + randomizer + White=weaker)
- [x] Full Section 2 written into `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` (~580 spec lines)
- [x] `sessions/S004/session-log.md` written
- [x] `sessions/INDEX.md`, `CLAUDE.md`, `tasks/todo.md` updated

## Completed in S003 (2026-04-19)
- [x] Scope locked: Section 2 depth = full production DDL (Option A)
- [x] Architecture decision: split commitment tables (poll_votes + match_guests)
- [x] Architecture decision: MOTM single source on `matches` (motm_user_id XOR motm_guest_id)
- [x] Architecture decision: pending queues stay separate
- [x] Architecture decision: 3 effective RLS roles; anon ref via SECURITY DEFINER RPC only
- [x] Part 1 DDL approved — types + base entities (profiles, pending_signups, seasons, matchdays)
- [x] Part 2 DDL approved — match data (match_guests, matches, match_players)
- [x] Part 3 DDL approved — poll + ref workflow (poll_votes, ref_tokens, pending_match_entries, pending_match_entry_players)
- [x] Super-admin tier added: `profiles.is_admin` → `profiles.role user_role` enum
- [x] Season archive added: `seasons.archived_at` + CHECK constraint
- [x] Admin edit audit columns: `matches.updated_by` + `match_players.updated_by`
- [x] Admin dashboards added to Phase 1 scope (players / matches / seasons / admins / schedule)
- [x] Scheduled reminders + app_settings tables queued for Part 4
- [x] WhatsApp auto-post strategy = Option A (native share sheet, semi-manual)
- [x] Masterplan V2.3 written; V2.2 preserved
- [x] S003 session log written; INDEX.md updated; CLAUDE.md updated
- [x] Memories saved: DD/MMM/YYYY date format + Visual Companion browser-usage rule

## Completed in S002 (2026-04-18 / 19)
- [x] Captain selection formula — 5 criteria locked (resolves Open Decision #1)
- [x] "Who can captain?" admin helper screen (Section 3.1)
- [x] Last-5 form indicator — per-season, Option B letter-in-circle (Section 3.2)
- [x] Player self-signup + admin approval + claim-existing-profile (Section 3.3)
- [x] Ref entry link + admin approval queue (Section 3.4)
- [x] +1 guest mechanic — auto-unlock 24h before kickoff if < 14 (Section 3.5)
- [x] Poll vote order + waitlist priority by `voted_at` timestamp (Section 3.6)
- [x] Multi-season with roster policy (fresh | carry forward)
- [x] Nice-to-haves confirmed for Phase 4
- [x] Brand palette + logo captured
- [x] Masterplan V2.0 → V2.1 → V2.2 written
- [x] All 5 S002 assumptions approved
- [x] Phase 1 design spec updated with Sections 3.1–3.6
- [x] S002 session log + INDEX.md updates

## Phase 1 backlog (will become the implementation plan after spec approval)
- [ ] Create GitHub repo `mmuwahid/FFC`
- [ ] Create Supabase project + set env vars on Vercel
- [ ] Scaffold Vite React PWA inside `ffc/` (copy boot pattern from PadelHub)
- [ ] Copy inline splash, safe-area CSS, service worker, ErrorBoundary from PadelHub
- [ ] Shared `formatDate()` helper enforcing DD/MMM/YYYY display format
- [ ] Auth: email/password + Google OAuth with `redirectTo` preserving query params
- [ ] Self-signup flow: landing "Sign up" → auth → "Who are you?" screen → pending queue
- [ ] Admin "Pending approvals" screen + claim/new approval mutation
- [ ] Supabase schema v1 (full Section 2 tables + RLS + SECURITY DEFINER helpers)
- [ ] Seed super-admin row for `m.muwahid@gmail.com`
- [ ] Season-creation admin screen with roster policy picker (fresh | carry forward)
- [ ] Season lifecycle UI: end + archive + restore from archive
- [ ] Weekly poll screen + vote / cancel actions + waitlist display
- [ ] Wednesday 8:15 PM cron job for +1 slot unlock + notification
- [ ] "Bring a +1" action + `match_guests` insert
- [ ] Roster-lock flow (admin action when 14 confirmed)
- [ ] Manual team entry screen (admin types White/Black rosters)
- [ ] "Who can captain?" helper screen + eligibility query
- [ ] "Generate ref link" admin action + signed token issuance (sha256 storage)
- [ ] Ref entry screen (token-gated, no auth) + submit to `pending_match_entries`
- [ ] Admin "Pending match entries" review screen + approve / edit / reject
- [ ] Admin **match-results edit** screen (post-approval corrections with audit trail)
- [ ] Admin **players** screen (add / deactivate / edit)
- [ ] **Super-admin** admin-management screen (promote / demote with audit)
- [ ] **Scheduled reminders** admin screen (list / enable / edit cron / fire now)
- [ ] Supabase `pg_cron` hookup for scheduled reminders
- [ ] Weekly poll reminder notification → admin push → native share sheet to WhatsApp
- [ ] Leaderboard recompute on approval (view or trigger-maintained)
- [ ] Last-5 form indicator component (stateless, Option B letter-in-circle)
- [ ] Leaderboard screen (incl. last-5 strip) + Player profile screen (larger last-5 strip)
- [ ] Mockups in `mockups/` for EVERY screen before coding it
- [ ] Result PNG generator + native share sheet integration
- [ ] Web Push Edge Function (port PadelHub version) + 13-trigger notification map
- [ ] Deploy to Vercel, smoke-test on iPhone Safari PWA install

## Open decisions remaining (not blocking Phase 1)
- [x] ~~Captain selection formula~~ — resolved in S002, **simplified in S004** (3 criteria + randomizer + White=weaker)
- [x] ~~Commitment architecture~~ — resolved in S003 (split)
- [x] ~~Guest-MOTM dual storage~~ — resolved in S003 (single source on matches)
- [x] ~~Admin role model~~ — resolved in S003 (role enum with super_admin)
- [x] ~~WhatsApp auto-post mechanism~~ — resolved in S003 (Option A native share sheet)
- [x] ~~Late-cancel point penalty values~~ — resolved in S004 (−1 after lock; −1 + 7d ban within 24h)
- [x] ~~Player positions catalogue + colors~~ — resolved in S005 (5 codes: GK/DEF/CDM/W/ST)
- [x] ~~Theme toggle storage model~~ — resolved in S005 (DB-stored on profiles, default `system`)
- [ ] "Repeat dropout" threshold (Phase 2+)
- [ ] Snake-draft vs simple-alternate order (Phase 2)
- [ ] Best Goalie mechanism
- [ ] Phase 2: admin override window after auto-captain-pick
- [ ] Share PNG: reuse the last-5 circle treatment? (decide in Section 5)
- [ ] Pair-balance rule (V2.0 criterion 4, ±5 league positions) — dropped in S004; revisit if pairings feel unbalanced in practice
- [ ] CAM / generalist CM role — excluded in V2.5; revisit if the 5-position palette feels too coarse (S005)
- [ ] Does the Poll screen pre-show the admin's team-colour assignment once roster is locked? (S005, still open through S006)
- [ ] §3.15 Match-detail sheet — STUB only in S006; full Depth-B spec + mockup pending (probably S008 or later)

## Assumptions confirmed by user
**S002 (2026-04-19):**
- ✓ Last-5 strip = per-season.
- ✓ +1 slot collision = first commitment wins.
- ✓ Rejected signups = polite email + retry.
- ✓ Guest attribution = inviter user_id on guest row.
- ✓ Guests do NOT appear on leaderboard.
- ✓ Rejection email copy = "not a match for FFC right now, reach out if this is a mistake."

**S003 (2026-04-19):**
- ✓ Admin dashboards in scope for Phase 1.
- ✓ Super-admin implemented as role enum value (not a separate table).
- ✓ Multiple super-admins allowed (no singleton constraint).
- ✓ Season archive requires prior end date.
- ✓ WhatsApp auto-post = Option A (native share sheet, semi-manual).
- ✓ Scheduled reminders stored in DB (editable without redeploy).

**S004 (19/APR/2026):**
- ✓ Captain formula: 3 per-player criteria only (matches ≥5, attendance ≥60%, cooldown ≥4); red/yellow-card and positive-points criteria dropped.
- ✓ Early-season randomizer: `pick_captains_random` picks 2 from locked-14 when season has <5 approved matchdays.
- ✓ White = weaker captain (pair-level app logic, not a view column).
- ✓ Late-cancel: before lock = 0 · after lock outside 24h = −1 · within 24h = −1 + 7d ban row (enforcement Phase 2).
- ✓ 5 scheduled reminders seeded (Mon 17:00 · Tue 21:00 · Wed 20:00 · Wed 22:00 · Thu 12:00, Asia/Dubai).
- ✓ Section 1 Architecture & Stack approved.
- ✓ matches lifecycle = `create_match_draft` inserts draft at team-entry; `approve_match_entry` only ever UPDATEs existing draft.

**S005 (19/APR/2026):**
- ✓ Section 3 depth = Depth B (screen spec + mockup gate per screen).
- ✓ Section 3.0 navigation = 4-tab player / 5-tab admin / anon ref (single-screen token).
- ✓ 16 routes documented; 13 notification kinds mapped to deep links.
- ✓ §3.7 Poll screen = 7 states, primary = "you're confirmed #N of 14" with cancel + "Bring a +1" CTAs.
- ✓ 5 positions: `GK` (gold) · `DEF` (deep blue) · `CDM` (dark green) · `W` (orange) · `ST` (FFC accent red). CM excluded.
- ✓ Primary position required at signup · secondary optional.
- ✓ Guests get no position pill.
- ✓ Theme preference = DB-stored on `profiles.theme_preference`, default `system`.
- ✓ Dark palette: paper `#0e1826`, ink `#f2ead6`, accent `#e63349`, gold `#e5ba5b`.
- ✓ Root-class toggle architecture (`<html class="light|dark">`).

## Deferred (Phase 2+)
- Captain draft flow (Phase 2)
- Automated discipline/ban enforcement (Phase 2)
- Season awards page + archive display + winners wall (Phase 3)
- WhatsApp Cloud API integration (re-evaluate Phase 3)
- H2H compare, deep form guide, payment tracking, badges, injury list (Phase 4)
- Per-user notification preferences (v1.1)
