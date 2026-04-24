# S037 — Season 11 roster import + §3.15 captain reroll + logo rollout

**Date:** 24/APR/2026
**PC:** Work (`UNHOEC03`)
**Topic:** Boil-the-ocean — wipe test data, import 39 ghost profiles + Season 11 seed stats from external sheet, ship captain reroll modal, finalize PWA logo rollout.
**Outcome:** Complete. Three commits pushed; Vercel deploy green.

## What landed

### Part 1 — Season 11 roster import (commit `53afc0e`)

- **Migration 0026** `0026_season_seed_stats.sql` — new `season_seed_stats` table (per-season-per-profile aggregate seeds: wins/draws/losses/goals/yellows/reds/motms/late_cancel/no_show); `v_season_standings` rewritten to UNION live `match_players` aggregates with seeded aggregates so seed-only players appear in standings. Points formula unchanged. Used `CREATE OR REPLACE VIEW` (not DROP) because `v_captain_eligibility` depends on it.
- **Migration 0027** `0027_season11_roster_import.sql` — transactional cleanup + roster seed:
  - Archived `Test Player` → role=rejected, is_active=false.
  - `TRUNCATE ... RESTART IDENTITY CASCADE` on 15 transactional tables (matchdays, matches, match_players, poll_votes, draft_sessions, draft_picks, formations, match_guests, player_bans, notifications, admin_audit_log, pending_match_entries, pending_match_entry_players, ref_tokens, scheduled_reminders). CASCADE handled child FKs.
  - Inserted 39 ghost profiles (auth_user_id NULL) — 35 players + 4 admins (Ahmed Saleh, Rawad, Abood, Barhoom). Moody in the sheet maps to Mohammed's existing super_admin profile (id `cce905a8…`).
  - Inserted 40 `season_seed_stats` rows for Season 11 (`ab60594c-…`) derived from user's external "FFC Season 11" sheet. Derivations: `draws_seed = max(0, points - 3*wins)` · `losses_seed = GP - wins - draws_seed` · `late_cancel_points_seed = LEAST(0, points - 3*wins - draws_seed)` (caught Murad -1 + Simo -1 penalties).
- Types regenerated: 1916 → 1993 lines (+ season_seed_stats surface).
- Verified on live DB: Karim 44 pts, Firas 40 (46G, 4 MOTM, 1 YC), Mostafa 39, Rawad 38, etc. — exact match to source sheet.

### Part 2 — §3.15 captain reroll modal + logo rollout (commit `0198450`)

**Captain reroll (Poll.tsx + CSS):**
- New state: `dropoutNotif` (latest unactioned `dropout_after_lock` notification for the caller + current matchday) · `rerollConfirmOpen` · `rerollCutoffHours` (from `app_settings.reroll_cutoff_hours_before_kickoff`, default 12).
- `loadAll` extension: queries latest unactioned notification filtered client-side by `payload.matchday_id` (JSON contains filter unreliable across environments); resolves substitute player display_name.
- RPC handlers: `onAcceptSubstitute` → `accept_substitute(matchday_id)` · `onRequestReroll` → `request_reroll(matchday_id)`.
- Rendered card in State 8 (above team headers) when: `dropoutNotif && iAmCaptain && locked && hoursToKick > 0`.
- Within cutoff window: [Accept substitute] + [Request reroll] (triggers confirmation sub-sheet). Past cutoff: single [Acknowledge] button.
- Gold tone (`rgba(229, 186, 91, *)`) — attention/notable register, following S033 concurrent-admin modal precedent.
- `.po-dropout-card` + `.po-dropout-sheet` CSS scoped under `.po-screen`, auto-inherits brand tokens from the S035 scope-override.

**Logo rollout (PWA icon variants):**
- Previously blocked per masterplan V2.8 §2 ("Logo rollout (S014 item 2 — blocked on user asset export)"). Unblocked in S037 by generating from the existing `shared/FFC Logo Transparent Background.png` (1024×1024 RGBA) source that was available.
- Regenerated all canonical PWA icons via `PIL.Image.resize(LANCZOS)`:
  - `ffc-logo-32.png` · `ffc-logo-192.png` · `ffc-logo-512.png` — transparent, direct downscale.
  - `ffc-logo-180.png` (Apple touch) — **opaque** on brand navy `#0e1826` with 140px inset (iOS masks to squircle regardless of transparency).
  - `ffc-logo-maskable-512.png` — **opaque** brand-navy with 308px inset (60% safe zone) for Android adaptive icon masking.
  - `ffc-logo.png` — 512 transparent (generic reference).
- `og-image.png` (NEW) — 1200×630 brand-navy with centered 400×400 logo. For WhatsApp / iMessage / Slack link previews.
- `index.html` gained Open Graph + Twitter card meta tags pointing at `/og-image.png`.

## Verification

### Live DB (via `supabase db query --linked`)
- Profiles: 35 player + 4 admin + 1 super_admin + 2 rejected = 42 total ✓
- Admins: Abood, Ahmed Saleh, Barhoom, Rawad ✓
- `v_season_standings` top 15 matches source sheet exactly (points, wins, goals, MOTM, YC all correct).
- Season 11 seed rows: 40 ✓ (39 new + Mohammed).

### Build + deploy
- `tsc -b --force` EXIT 0
- `vite build` EXIT 0 (PWA 11 entries / 1340 KB — size dropped vs S036's 2541 KB because the new PNGs are more efficient than the stopgap)
- Vercel auto-deploy green

## Patterns + gotchas

### Seed-aggregate table + UNION view (new pattern)
When backfilling historical totals without wanting to fabricate per-match rows:
- Add a seed table keyed on (scope_id, entity_id) with the same aggregate columns the view sums.
- In the view, build a `combined` CTE that UNIONs (season, profile) pairs from the live CTE and the seed table.
- LEFT JOIN live + seed against `combined`; COALESCE each column to 0, then sum.
- Preserves view signature → no downstream TS changes needed.

### `CREATE OR REPLACE VIEW` when dependents exist (not DROP + CREATE)
`DROP VIEW v_season_standings` failed because `v_captain_eligibility` has a reference.
Fix: `CREATE OR REPLACE VIEW` works **iff the column signature is unchanged**. Since we added columns *inside* the body but none exposed externally (we summed into existing column aliases), `REPLACE` succeeded.

### Notifications payload filter — client-side, not `.contains()`
PostgREST's `payload.contains({ matchday_id: X })` filter is unreliable across Supabase JS client versions. Fetch a small bounded result (`.limit(5)`) and filter client-side by `(payload as any).matchday_id === mdId`.

### TRUNCATE ... CASCADE across 15 tables
Single statement with CASCADE cleaned all child FK rows atomically. Order of tables inside the statement didn't matter — CASCADE resolved dependencies. Rollback still applies if the migration errors mid-way (whole migration in implicit transaction via supabase db push).

### Apple touch + maskable opacity pattern
iOS and Android both mask PWA icons into rounded shapes. Transparent icon on those platforms = hole in the corners. The standard treatment:
- Apple touch: opaque bg + ~78% logo inset.
- Maskable: opaque bg + ~60% logo inset (safe zone spec).
- Regular `any` purpose icons: keep transparent for desktop browsers.

### Ghost-profile claim flow (deferred, stubbed)
New ghost profiles have `auth_user_id = NULL`. When a real person signs up (email confirm), Signup Stage 2 should offer a ghost-profile picker: "Which of these players are you?" → admin approves the link → profile's `auth_user_id` + `email` get populated in-place, preserving the player's Season 11 stats + future match history. Not built this session; captured in `tasks/todo.md`.

## What's NOT done
- **Ghost claim flow in Signup.tsx** — next session.
- **Live reroll flow end-to-end test** — requires a real matchday with a post-lock cancel + admin `promote_from_waitlist` call. Will surface naturally once MD31 runs.
- **Poll realtime for notifications** — not subscribed; relies on existing `poll_votes` / `match_players` realtime subs firing `loadAll` which re-checks notifications. Sufficient for Phase 1.

## Commits
- `53afc0e` — season 11 roster import (migrations 0026 + 0027, types regen)
- `0198450` — §3.15 captain reroll modal + logo rollout (Poll.tsx + CSS, all PWA icons, OG image, OG meta tags)

## Live
https://ffc-gilt.vercel.app (hard refresh to pick up new bundle + icons)
