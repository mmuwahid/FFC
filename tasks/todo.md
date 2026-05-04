# FFC Todo

## NEXT SESSION — S068

**Cold-start checklist:**
- **MANDATORY session-start sync** per CLAUDE.md Cross-PC protocol.
- Expected HEAD: `main` at `9e4cb8a` (or its descendant). Live DB: 69 migrations. 0 open PRs · 0 open issues.
- **S066 close (04/MAY/2026, AM):** Token-efficiency audit shipped (closes #50). 3 chore commits `f6c674b..609ca3a`. ~72K tokens saved per session start. Active working set 359 KB → 79 KB. Session log backfilled in S067.
- **S067 close (04/MAY/2026, PM):** Injury / Unavailable list — design spec + 12-task implementation plan written. No code. Spec at `docs/superpowers/specs/2026-05-04-injury-unavailable-design.md`. Plan at `docs/superpowers/plans/2026-05-04-injury-unavailable.md`. H2H comparison decomposed into a follow-up spec/plan.

**S068 agenda — execute injury/unavailable list, then brainstorm H2H:**

1. **Execute the injury/unavailable plan** via subagent-driven-development:
   - [ ] **Task 0 (mockup, Rule #1 gate)** — build `mockups/injury-unavailable.html` showing all 6 surfaces (Settings card available + out states · AdminPlayers row + modal · Poll exclusion footnote · Leaderboard mixed list · Profile banner · `<UnavailabilityPill>` swatch row). Verbatim live-CSS copy per S060 lesson. **STOP for user approval before any DB or code work.**
   - [ ] **Task 1** — write `supabase/migrations/0070_unavailability.sql` (enum + 3 cols + CHECK + 4 RPCs + view update + 2 notification kinds + pg_cron 00:00 UAE schedule).
   - [ ] **Task 2** — `npx supabase db push --linked`; verify schema landed; regen `ffc/src/lib/database.types.ts`; `tsc -b` EXIT 0.
   - [ ] **Task 3** — create `ffc/src/components/UnavailabilityPill.tsx` + CSS tokens (light/dark variants).
   - [ ] **Task 4** — extend AppContext profile selection with the 3 new columns.
   - [ ] **Task 5** — Settings Availability card (self-serve form + "I'm back" button).
   - [ ] **Task 6** — AdminPlayers Availability row + edit modal (silent admin override).
   - [ ] **Task 7** — Poll query filter + render exclusion + clear poll vote on OUT-flip.
   - [ ] **Task 8** — AdminRosterSetup pool filter (locked rosters NOT auto-modified).
   - [ ] **Task 9** — Leaderboard `[data-unavailable]` dim + status pill.
   - [ ] **Task 10** — Profile status banner.
   - [ ] **Task 11** — full `tsc -b` + `eslint .` + dev-preview smoke walk + push to main + Vercel auto-deploy + live smoke.

2. **Then brainstorm + spec H2H comparison** (V3.0:144):
   - Independent subsystem from injury list. Picks two players, surfaces side-by-side career stats + direct match-up record (games shared a side · games on opposing sides · win-rate together vs apart · goal differentials).
   - Mockup-first per Rule #1.

3. **Carry-over brainstorm queue (push to S069 unless time permits):**
   - [ ] **RefEntry live event-strip per-team split** (#8 in S063 backlog) — Option A picked: white/black columns + full-width row for halftime/fulltime/pause/resume/own-goal. Mockup pending.
   - [ ] **Scorer Picker tap-to-increment sheet** (#1 in S063 backlog) — S058 mockup tile B; reuses `<NumberInput stepper>`.
   - [ ] **AdminRosterSetup manual slot reorder UI** (#2 in S063 backlog) — S059 added `slot_index` column; UI for drag/swap on Saved-state team lists.
   - [ ] **RefEntry scorer-picker redesign** (#4 in S063 backlog) — current 7-name 2-column list reads as 2 teams; user wants a dropdown of the existing team + Goal/Own-Goal toggle.

3. **GH issues: 0 open.**

4. **Live verification owed Thursday matchday** — most S063 changes admin/auth-gated, only confirmable on a real Thursday matchday:
   - [ ] **S063 RefEntry submit pipeline** — ref types name → KICK OFF → goals/cards → END MATCH → SUBMIT → admin gets push (no enum cast error) → ref sees "Submitted ✓".
   - [ ] **S063 MatchEntryReview Approve pipeline** — admin opens review → 2-col Player Aggregates render with non-zero stats only → MOTM gold+star → Approve filled green → tap Approve → mig 0066 enum-cast holds → leaderboard updates → notifications fan out (per-match-players, not per-active-profile per S058).
   - [ ] **S063 share PNG** — admin taps Share to WhatsApp on success state → first share regenerates with force=true → "Season 11 — Game 32 of 40" + "Thu, 30 Apr 2026" + 200px crest + side-aligned scorers + twemoji ⚽🟨🟥⭐ + inline gold MOTM (no bottom pill).
   - [ ] **S063 MatchDetailSheet** — tap any approved match in Matches tab → side-by-side WHITE | BLACK rosters with team-tinted heads → footer reads "Game N · Season 11" with games_seeded offset → Share to WhatsApp on hero opens cached PNG (uses cached path via getMatchCardUrl, NOT force=true).
   - [ ] **S063 GH polish (#44 #45 #46 #47)** — splash crest centered + clamp-sized + pulse animation; W/D/L counts coloured green/grey/red; bottom-nav + topbar don't bob between routes; Leaderboard sticky header columns stay above horizontally-scrolled cells.

5. **Carried matchday verification (still owed from S058–S062):**
   - [ ] **S060 payment tracker pipeline (mig 0055)** — admin approves match → `payment_windows` row + 14 `match_payment_records` → `/payments` summary strip + cards → ledger sheet → "Mark paid ✓" → auto-close window.
   - [ ] **S059 ref-link mint** — admin generates ref link → ref opens `/ref/<token>` → KICK OFF runs live timer + goal/card capture → SUBMIT → admin gets push → admin reviews → approves → leaderboard updates.
   - [ ] **S059 slot_index ordering** — Poll team list order matches Roster Setup; new matches inherit correct order.
   - [ ] **S059 captain pill** — admin sets captain via CaptainHelper → Poll renders gold filled "C" badge.
   - [ ] **S059 topbar Delete** — Roster Setup 🗑 button reachable from Pool/Teams/Saved phases; type-DELETE confirm; admin_delete_matchday cascades through unapproved drafts.
   - [ ] **S058 #25 PNG hero** — open Profile → tap recent match → PNG hero loads at top of MatchDetailSheet (cached path via getMatchCardUrl).
   - [ ] **S058 #25 friendlies in Matches tab** — friendly matches appear with yellow `FRIENDLY` chip; leaderboard standings unaffected.
   - [ ] **S058 #23 notifications** — admin approves match → only the 14 players in that match get `match_entry_approved`; matchday creation → other admins (NOT the creator) get `📅 Matchday created`; ranking changes → players whose rank moved get `📈` notification with `{old_rank, new_rank, points}` payload.
   - [ ] **S058 #21 admin match management** — past approved match card shows 4 buttons (Edit result · Formation · Pick captains · Edit roster · Delete match); Edit roster opens with 14 current players + per-team cap chips; Delete match type-DELETE confirm.

6. **Phase 2 close: V3.0:122 8-box acceptance** (still pending from S052/S053/S054/S055/S057):
   - [ ] No vote-chasing in WhatsApp — push reminders alone cover non-voters.
   - [ ] Roster locks itself at the deadline; confirmed/waitlist players get `roster_locked` push.
   - [ ] Captain pair auto-set on lock; admin gets `captain_auto_picked` push with override deeplink.
   - [ ] Confirmed player drops post-lock → admins + captains see CaptainDropoutBanner appear realtime.
   - [ ] Ref runs entire match on console (no paper).
   - [ ] Goals / cards / MOTM time-stamped at moment of capture.
   - [ ] After full-time, ref taps SUBMIT → admin gets push within 30 seconds.
   - [ ] Admin opens review screen, taps APPROVE → leaderboard updates without manual entry.

**Backburner:**
- **Awards backfill RPC** — admin-triggered `backfill_season_awards()` to populate `season_awards` for ended seasons predating mig 0047.
- **Awards push notification** — when `seasons.ended_at` flips, push admins + winners ("Season N awards are in!").
- **Resend custom sender domain** — verify a domain in Resend, set `NOTIFY_FROM` env on `notify-signup-outcome` EF.
- **Phase 3 backlog (post-S060):** ~~payment tracker~~ (S060 done) · multi-season comparison stats · player analytics · H2H comparison · player badges / achievements · injury / unavailable list. Mockups in `mockups/` first per Rule #1.
- **Player analytics + H2H** (V3.0:145–146) — first attempt rejected in S053; re-attempt with different style direction if user wants.

## Completed in S063 (01/MAY/2026, Work PC)

**17 commits between `120accc..36b2963`. 3 migrations applied (0066/0067/0068). Live DB: 65 → 68. 5 EF redeploys. 4 GH issues closed (#44 #45 #46 #47). 1 deferred (#43).**

See `sessions/S063/session-log.md` for full per-commit narrative. Highlights:

- **NumberInput spec + plan written** (`427ad33`) — execution deferred to S064.
- **First-real-match-day diagnostic cascade fixed:**
  - `e6cd218` RefEntry submit — translated `winner` ('white'/'black'/'draw') → `result` enum (win_white/win_black/draw) at the supabase.rpc boundary.
  - `61c153d` MatchEntryReview Approve/Reject row was hidden behind `.app-bottom-nav` — dropped fixed positioning, row now sits inline at end of document.
  - `3ac36ef` "[object Object]" toast — `extractErrMessage()` helper probes `.message` on plain objects (Supabase `PostgrestError` isn't an Error instance).
  - `7f39c2b` mig 0066 — explicit `::notification_kind` casts in `approve_match_entry`, `notify_matchday_created`, `snapshot_and_diff_ranks`, `submit_ref_entry`. PG locks projection types BEFORE INSERT context when SELECT uses DISTINCT or CTE chains.
- **MatchEntryReview UX polish:**
  - `e23740f` Reject filled red, Approve filled green (was outline-style).
  - `cf93728` MOTM gold + star (last `.mer-*` screen still using non-brand styling).
  - `9205f9b` Player Aggregates 2-col side-by-side; only non-zero stat icons render.
- **Matches tab + MatchDetailSheet:**
  - `c93b1ab` ⚽ back in goal badge; render-match-card EF Satori `<></>` Fragment + `display:flex` fixes.
  - `ad152dd` MatchDetailSheet rosters side-by-side WHITE | BLACK with team-tinted heads.
  - `8461ad1` Footer "Matchday 2 · Season 11" → "Game 32 · Season 11" with `games_seeded` offset.
- **Share PNG overhaul (mig 0067 + 0068, 5 EF redeploys, 3 commits):**
  - `8cfdaa8` mig 0067 adds `games_seeded` to match-number COUNT; success-state Share passes `force: true`; MOTM rendered inline gold + ⭐ in scorer column instead of bottom pill.
  - `fb5a241` `RENDER_VERSION` constant in EF — bumping it auto-invalidates all cached PNGs.
  - `659e105` Layout overhaul — 200px crest, single-line "Season 11 — Game 32 of 40" Playfair 56pt, date subtitle, scorer columns side-aligned (white left, black right via row-reverse), twemoji `graphemeImages` for ⭐⚽🟨🟥, inline ⚽×N badge + 🟨🟥 cluster + ⭐. Mig 0068 sources scorer rows from `match_players` (per-actual-team) + `own_goals` join, includes `yellow_cards` + `red_cards`. Cards-only players now appear in the list.
- **Other UX:**
  - `68517f9` AdminMatches FINAL phase line spells out winner ("Final · Black Team Wins"); B WINS pill removed.
  - `d8b1b8a` RefEntry live event-strip — added `describeParticipant()` so live rows read `0' ⚽ Goal (B) · Rawad`.
- **GH sweep (`36b2963`):**
  - **#44** splash CSS: full-viewport flex-centered, crest `clamp(96px, 28vw, 160px)`, pulse animation respecting prefers-reduced-motion.
  - **#45** W/D/L count cells coloured green/grey/red bold (matches Last-5 pill palette).
  - **#46** `.app-bottom-nav` + `.app-topbar` use `transform: translateZ(0)` + `will-change: transform` for GPU compositing layer; `.app-topbar-inner` gets explicit `min-height: 48px`.
  - **#47** Leaderboard `.lb-table-grid--header` sticky cells bumped to z-index 5 (above body z-index 2) with explicit opaque background.

### S063 patterns / lessons (additive — see also lessons.md)

- **Translate frontend types ↔ DB enums at the supabase.rpc boundary, not anywhere else.** Reference `Database['public']['Enums']['xxx']` from generated types so TS prevents the drift on next change.
- **Surface real PG errors in toasts via `extractErrMessage()` helper.** Supabase `PostgrestError` isn't `instanceof Error` — `String(plainObject)` returns `"[object Object]"`.
- **Cast string literals to enum types explicitly when SELECT uses DISTINCT, GROUP BY, or feeds through a CTE.** PG locks projection types BEFORE INSERT context.
- **`games_seeded` offset is mandatory for any match-number derivation.** Mid-season import seasons (Season 11 = 30 historic) break naive 1-based indices. Frontend Matches.tsx + MatchDetailSheet + share-PNG RPC all need it.
- **Cache versioning constant beats manual storage wipes.** `RENDER_VERSION` in EF — bumping auto-invalidates every cached PNG. Legacy keys orphaned but harmless.
- **Pre-fetch twemoji SVGs at module init for Satori PNG rendering.** Inter has no emoji glyphs; without `graphemeImages` every emoji renders as tofu. Module-init fetch (4 emojis) keeps per-request render fast.
- **Single-line title with date subtitle reads cleaner than stacked banner + meta.**
- **Side-aligned mirrored columns reinforce team identity better than centered.** White-left / black-right (with row-reverse) on both share PNG and MatchDetailSheet roster grid mirrors the score boxes.
- **`transform: translateZ(0)` + `will-change: transform` is the iOS bottom-nav and topbar bobbing fix.** Forces a GPU compositing layer; subpixel jitter from iOS toolbar transitions stops visibly affecting fixed elements.
- **Bottom-fixed sheet rows MUST grep the codebase for sibling `position: fixed; bottom: 0` elements before shipping.** When in doubt, default to inline + use `app-main`'s `padding-bottom: safe-bottom + 72px` clearance.

---

## Earlier session history (archived)

S049–S063 completed-block details live in `tasks/_archive/todo-history-s049-s063.md`. S001–S049 history is in `tasks/_archive/todo-history-pre-s049.md`. Both rotated to keep this file focused on the active agenda — re-rotate when this file crosses 30 KB again.
