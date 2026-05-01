# Session Log — 2026-05-01 — S063 — Live Match-Day Hardening + Share PNG

**Project:** FFC
**Type:** Build/Fix
**Phase:** Phase 2/3 polish — first live match-day diagnostics
**Duration:** ~3 hours
**HEAD at start:** `120accc` (S062 close, post-fast-forward sync)
**HEAD at end:** `36b2963`
**Commits this session:** 17 (includes 1 spec doc, 1 plan doc, 3 migrations, 5 EF deploys)
**Live DB:** 65 → 68 migrations (mig 0066, 0067, 0068)
**Live EF deploys:** `render-match-card` redeployed 5× (final: ScorerColumn + emojis + cache versioning)
**Open GitHub at end:** 0 PRs · 1 open issue (#43 dark-mode, deferred)

---

## What Was Done

### Cross-PC sync (work PC startup)
- `.git` pointer was wrong (pointed home PC `C:/Users/User/FFC-git`); rewrote to `C:/Users/UNHOEC03/FFC-git`. Working tree was 14 commits behind origin/main with mods matching commits-ahead — scenario (b) from cross-PC protocol. Stashed → fast-forwarded → dropped stash. Clean at `120accc`.

### NumberInput component (#3 — spec + plan only, execution deferred)
- Brainstormed the global "backspace does nothing in number inputs" UX bug. Root cause: every `<input type="number">` follows `value={n}` + `onChange={(e) => Math.max(0, Number(e.target.value) || 0)}` — `Number('')` is 0 so the controlled input snaps back before the user can re-type.
- Spec written + committed: [docs/superpowers/specs/2026-05-01-number-input-component-design.md](docs/superpowers/specs/2026-05-01-number-input-component-design.md). Plan written + committed: [docs/superpowers/plans/2026-05-01-number-input-component.md](docs/superpowers/plans/2026-05-01-number-input-component.md). 13 call sites identified across `AdminMatches.tsx`, `AdminPlayers.tsx`, `MatchEntryReview.tsx`. Execution deferred — live blockers took priority.

### Live ref-entry submit failure (#5)
- User triggered first real ref submit on `wutyuneed`-named entry. Toast read "Submit failed". Investigation: `match_result` enum is `{win_white, win_black, draw}` but RefEntry sent bare `'white' | 'black' | 'draw'` (drives CSS class names). `(p_payload->>'result')::match_result` raised PG `22P02`, transaction rolled back, token NOT burned (UPDATE happens after the failing INSERT — retry possible).
- Fix at the boundary: translate winner → result in `buildSubmitPayload`. Reference `Database['public']['Enums']['match_result']` so future enum changes propagate via TS. Bonus: surface `PostgrestError.message` in the toast (it isn't `instanceof Error` so the real message was being swallowed).
- Commit: `e6cd218`.

### AdminMatches "Final · Black Team Wins" (#6)
- Tiny `B WINS` / `W WINS` pill beside the score replaced with full text on the FINAL phase line. Removed dead `resultLabel()` helper, `MatchResult` type alias, and 4 `.admin-md-result-chip--*` CSS rules.
- Commit: `68517f9`.

### RefEntry live event strip — show scorer name
- Bottom-tab strip during a live match was rendering `0' ⚽ Goal (B)` with no participant name. Plumbed the `payload` prop into `EventStrip` and appended `describeParticipant(e, payload)` (same lookup the post-match review screen has been using). Now reads `0' ⚽ Goal (B) · Rawad`.
- Commit: `d8b1b8a`.

### MatchEntryReview Approve/Reject (#7) — UI hidden + error obfuscation + visuals
- **Hidden behind bottom nav.** `.mer-actions` was `position: fixed; bottom: 0` with no z-index; `.app-bottom-nav` is `position: fixed; bottom: 0; z-index: 10`. Bottom nav painted over the buttons. Dropped fixed positioning; row now sits inline at the end of the document. `app-main` already pads `safe-bottom + 72px`. Commit: `61c153d`.
- **"[object Object]" toast.** Same root cause as #5 — `e instanceof Error ? e.message : String(e)` falls to `String(plainObject)` = `"[object Object]"`. Added `extractErrMessage()` helper, used everywhere (Approve / Reject / DropEvent). Diagnostic-only fix at first; revealed the real cause below. Commit: `3ac36ef`.
- **Real PG cause: `column "kind" is of type notification_kind but expression is of type text`.** S058's mig 0057 introduced `INSERT INTO notifications (...) SELECT DISTINCT ..., 'match_entry_approved', ...`. PG normally infers a string literal's type from the target INSERT column, but with `SELECT DISTINCT` (and CTE chains feeding INSERT) the projection's types are locked BEFORE the INSERT context is considered. The literal resolved as `text` and the cast to `notification_kind` failed. Never surfaced during S058 because the path was only DOM-tested at the preview server.
- Mig 0066: explicit `::notification_kind` casts in `approve_match_entry`, `notify_matchday_created`, `snapshot_and_diff_ranks`, `submit_ref_entry` (defensive). Live DB 65 → 66. Commit: `7f39c2b`.
- **Visuals.** Reject filled red, Approve filled green (was outline-style, hard to tell apart). MOTM card now gold + ⭐ inline (was plain text — last `mer-*` screen still using non-brand styling). Player Aggregates 2-col side-by-side WHITE | BLACK with vertical divider; only non-zero stat icons render (was: ⚽0 🟨0 🟥0 on every row). Commits: `e23740f`, `cf93728`, `9205f9b`.

### Matches tab — ⚽ back in goal badge
- User flagged the football emoji was missing on player rows. Added `<span className="mt-ps-goals-ball">⚽</span>` inside `.mt-ps-goals` so rows read `⚽×3 Moe Hamdan`. `.mt-player-row--no-goal { visibility: hidden }` already suppresses non-scorers' badge so column alignment preserved. Commit: `c93b1ab` (paired with EF fix).

### Share PNG — full layout overhaul
First failure was the EF render: `Edge Function returned a non-2xx status code`. Dashboard logs showed:
- `render failed: Error: Expected <div> to have explicit "display: flex" or "display: none"...`
- `Warning: Each child in a list should have a unique "key" prop.`

Both root causes in `MatchCard.tsx`:
- `<></>` Fragments inside `.map` — Satori v0.10 silently rewraps as `<div>` with no `display`. Replaced both `.map` blocks with explicit sibling JSX + lifted scorer column to its own `ScorerColumn` component.
- Several text-bearing `<div>`s had no `display`. Added `display: 'flex'` to all of them.

Commit `c93b1ab` (EF redeployed). Then user reported subsequent issues:
- Match number off by `games_seeded` (PNG showed "Match 2 of 40" while Matches tab showed "Game 32 / 40"). Mig 0067 adds `COALESCE(games_seeded, 0) +` to the COUNT in `get_match_card_payload`. Live DB 66 → 67.
- Wording: "Match" → "Game" everywhere.
- MOTM treatment: bottom gold pill removed; MOTM rendered inline in scorer column (gold + bold + ⭐ prefix).
- `force: true` on the success-state share so first post-approval share regenerates regardless of stale cache.
- Stale PNG bucket wiped via `npx supabase storage rm` + added `RENDER_VERSION` constant (now 3) so future renderer changes auto-invalidate.
- ⭐ rendered as tofu `[]` because Inter has no glyph. Wired Satori's `graphemeImages` option with twemoji SVGs pre-fetched at module init. 4 graphemes total: ⭐⚽🟨🟥. Added Inter 700 weight for MOTM bold.
- Layout overhaul (mig 0068 + MatchCard rewrite): 200px crest, single-line "Season 11 — Game 32 of 40" Playfair 56pt, date subtitle, scorer columns side-aligned (white left, black right via row-reverse), inline ⚽×N badge + 🟨🟥 cluster + ⭐ on each row. Live DB 67 → 68.

Commits: `8cfdaa8` (mig 0067 + force=true + MOTM inline), `fb5a241` (RENDER_VERSION), `659e105` (layout + emojis + mig 0068).

### MatchDetailSheet — side-by-side rosters + Game-N footer
- Roster sections were stacked vertically (~14 rows of scroll on a phone). Re-laid as 1fr|1fr grid; section heads "WHITE TEAM 2" / "BLACK TEAM 5" with team-tinted gradient backgrounds (cream wash for white, navy wash for black). Each row switches from 4-col grid to flex-wrap so positions + stats sit on the same line as name when there's room. Avatar 36px → 28px, name 14px → 13px to fit narrower column. Commit: `ad152dd`.
- Footer was reading "Matchday 2 · Season 11" while everything else labelled the same match "Game 32 / 40". Two bugs: wording ("Matchday" → "Game") and numbering (raw 1-based index ignored `is_friendly` filter and `games_seeded` offset). Fix mirrors `Matches.tsx:210` and mig 0067. Commit: `8461ad1`.

### GH issue sweep — 4 issues closed (#44 #45 #46 #47), #43 deferred
- **#44 (Loading splash crest):** `.app-splash` and `.app-splash__crest` had zero CSS — bare `<img>` rendered at intrinsic file size top-left. New rules: full-viewport flex-centered, `clamp(96px, 28vw, 160px)`, subtle pulse animation respecting `prefers-reduced-motion`.
- **#45 (Leaderboard W/D/L colours):** `.lb-cell--w/d/l` classes were on the JSX but no CSS rules existed. Added bold green/grey/red mirroring the Last-5 pill palette.
- **#46 (Bottom nav bobbing):** `.app-bottom-nav` and `.app-topbar` now use `transform: translateZ(0)` + `will-change: transform` to force GPU compositing layers (prevents subpixel jitter from iOS toolbar transitions). `.app-topbar-inner` got explicit `min-height: 48px` so the dynamic-island gutter doesn't shift between routes loading avatar/bell at different times.
- **#47 (Leaderboard sticky header columns):** Header sticky cells (rank, Player) had the same z-index as the non-sticky header cells; the moving cells appeared on top of the fixed columns when horizontally scrolling. Bumped `.lb-table-grid--header .lb-cell--sticky-{1,2}` to z-index 5 (above the body's z-index 2) with explicit opaque background.
- **#43 (Dark/light mode):** Deferred. Every per-screen scope override (.po-screen, .lb-screen, .mt-screen, .pf-screen, .lr-screen, .st-screen, .aw-screen, .mer-screen, .rs-screen, .py-screen, .ch-root, .admin-players, .admin-matches, .as-root, .ah-root) hardcodes the dark cream-on-navy palette per S036 brand spec. The root `:root.theme-light` flip works for topbar/bottom-nav but not inner screens. A real light mode means inverting all 15 scope-overrides — design work, not a CSS-only fix. Posted comment on issue.

Commit: `36b2963`.

---

## Files Created or Modified

### Migrations
- `supabase/migrations/0066_notification_kind_casts.sql` — explicit `::notification_kind` casts
- `supabase/migrations/0067_match_card_payload_seeded_games.sql` — COUNT + games_seeded
- `supabase/migrations/0068_match_card_payload_cards.sql` — per-team scorers from `match_players` + cards

### Edge Function
- `supabase/functions/render-match-card/MatchCard.tsx` — full layout overhaul, ScorerColumn, emojis, side-alignment
- `supabase/functions/render-match-card/index.ts` — twemoji `graphemeImages`, Inter 700, RENDER_VERSION

### Frontend
- `ffc/src/pages/RefEntry.tsx` — winner→result enum translation; PostgrestError surfacing; EventStrip carries payload
- `ffc/src/pages/admin/AdminMatches.tsx` — FINAL phase line (Black Team Wins); resultLabel deleted
- `ffc/src/pages/admin/MatchEntryReview.tsx` — extractErrMessage; force=true on share; MOTM gold+⭐; aggregates 2-col
- `ffc/src/pages/Matches.tsx` — ⚽ back in goal badge
- `ffc/src/components/MatchDetailSheet.tsx` — side-by-side rosters; Game-N footer with games_seeded
- `ffc/src/styles/match-entry-review.css` — actions inline; reject red / approve green; MOTM gold+star; PA grid
- `ffc/src/styles/matches.css` — `.mt-ps-goals-ball`
- `ffc/src/index.css` — splash; W/D/L; sticky header z-index; nav GPU compositing

### Docs
- `docs/superpowers/specs/2026-05-01-number-input-component-design.md` (new spec — execution deferred)
- `docs/superpowers/plans/2026-05-01-number-input-component.md` (new plan — execution deferred)

## Key Decisions
- **Mockup-first relaxed for emergency UX fixes.** Live ref entry was failing on actual match day — straight-to-fix on RefEntry submit, MatchEntryReview Approve, share PNG. Mockup workflow preserved for net-new features (Scorer Picker, slot reorder, RefEntry scorer redesign — still on the queue with mockups required).
- **Cache versioning constant beats manual storage wipes.** `RENDER_VERSION` in `render-match-card/index.ts`. Bumping the integer auto-invalidates every cached PNG. Legacy `<matchId>.png` keys orphaned but harmless.
- **`force: true` on success-state share.** First post-approval share regenerates the PNG regardless of cache. Cheap (~1.5s) trade for "what I see is what I share". MatchDetailSheet hero path keeps cached read.
- **Defensive enum casts in all 4 notification-emitting RPCs.** Even `submit_ref_entry` (which works today without a cast) gets one — bulletproof against future SELECT-chain edits.
- **Light-mode (#43) deferred.** A 15-scope rewrite is a full design exercise, not a one-line var swap. Decision logged on the GH issue.

## Open Questions
- None blocking.

## Lessons Learned

### Mistakes
| Date | Mistake | Root Cause | Prevention Rule |
|------|---------|------------|-----------------|
| 2026-05-01 | RefEntry submit shipped with `winner: 'white' | 'black' | 'draw'` going straight into a `match_result` enum cast. Never failed before because no real ref had submitted yet. | Two type universes in the codebase: UI string ('white'/'black' for CSS class names) vs DB enum (win_white/win_black). The bare value was sent without translation. | **Whenever a frontend type and a DB enum diverge by name, translate at the supabase.rpc(...) boundary, not anywhere else. Reference `Database['public']['Enums']['xxx']` from generated types so TS prevents the drift on next change.** |
| 2026-05-01 | "[object Object]" toast obscured every real PG error in MatchEntryReview Approve. | `e instanceof Error ? e.message : String(e)` — Supabase `PostgrestError` is a plain object with `.message`, not an Error instance. `String(plainObject)` returns `"[object Object]"`. | **For any Supabase RPC error path, use an `extractErrMessage()` helper that probes `.message` on plain objects too. Same pattern bit RefEntry submit and MatchEntryReview within 30 minutes of each other.** |
| 2026-05-01 | `INSERT INTO notifications (...) SELECT DISTINCT ..., 'match_entry_approved', ...` failed at runtime with `text → notification_kind` cast error. Worked in S058 plan-mode but never on a real approve. | PG normally infers a string literal's type from the target INSERT column. `SELECT DISTINCT` (and CTE chains feeding INSERT) lock projection types BEFORE the INSERT context is resolved. | **Always cast string literals to enum types explicitly when the SELECT uses DISTINCT, GROUP BY, or feeds through a CTE. `'val'::enum_type` defensively, not just where you "need to". The 5-second cast prevents a transaction-blocking surprise.** |
| 2026-05-01 | Share PNG showed "Match 2 of 40" while every other surface said "Game 32 / 40". | `get_match_card_payload` did a raw COUNT but never added `games_seeded`. Matches.tsx, MatchDetailSheet, AdminMatches all already added it. | **For any "match number" / "game number" derivation, the `games_seeded` offset is mandatory. Add a single SQL helper or write a comment in the RPC that anyone refactoring "match number" code reads first.** |
| 2026-05-01 | Cached PNGs in `match-cards` storage didn't refresh after EF code changes. | Cache key was `<matchId>.png` with no version segment. Manual `supabase storage rm` was the only way out. | **Whenever an Edge Function's output is cached by a stable key, include a `RENDER_VERSION` integer in the key. Bumping it on layout/payload changes invalidates the cache automatically.** |
| 2026-05-01 | Bottom nav painted on top of MatchEntryReview Approve/Reject buttons; admin scrolled to the end of the review and saw nothing actionable. | `.mer-actions` was `position: fixed; bottom: 0` with no z-index. `.app-bottom-nav` was `position: fixed; bottom: 0; z-index: 10`. | **Any new `position: fixed; bottom: 0` element MUST grep the codebase for sibling fixed-bottom elements and reason about z-index. When in doubt, default to inline + use `app-main`'s `padding-bottom: safe-bottom + 72px` clearance.** |

### Validated Patterns
- [2026-05-01] **Surface the real PG error in the toast first, then diagnose.** `extractErrMessage()` turned every "[object Object]" mystery into a one-line root cause for the rest of the session.
- [2026-05-01] **Pre-fetch twemoji SVGs at module init for Satori PNG rendering.** Inter has no emoji glyphs; without `graphemeImages` every emoji renders as tofu. Module-init fetch (4 emojis here) keeps the per-request render fast.
- [2026-05-01] **Single-line title with date subtitle reads cleaner than stacked banner + meta.** "Season 11 — Game 32 of 40" + "Thu, 30 Apr 2026" is two clean Playfair lines instead of a 3-line stack.
- [2026-05-01] **Side-aligned mirrored columns reinforce team identity better than centered.** White-left / black-right (with row-reverse) on both the share PNG and the MatchDetailSheet roster grid mirrors the score boxes and reads instantly.
- [2026-05-01] **GPU compositing layer + explicit min-height fix iOS bottom-nav and topbar bobbing.** `transform: translateZ(0)` + `will-change: transform` is a 2-line fix that's been needed since launch.

## Next Actions
- [ ] Execute the NumberInput plan (#3) — 5 tasks, ~13 mechanical migrations
- [ ] Brainstorm RefEntry live event strip per-team split (#8) — Option A picked but not yet executed
- [ ] Brainstorm Scorer Picker tap-to-increment sheet (#1)
- [ ] Brainstorm slot reorder UI in AdminRosterSetup (#2)
- [ ] Brainstorm RefEntry scorer picker redesign (#4) — current 7-name list is confusing as 2 columns
- [ ] GH #43 light-mode coverage — scoped redesign, ~15 screen overrides to invert
- [ ] Live verification owed Thursday matchday: most S063 changes (admin/auth-gated) need real match flow

---

## Commits and Deploy
- **Spec/plan:** `427ad33` (NumberInput spec)
- **Live blockers:** `e6cd218` (RefEntry submit cast), `61c153d` (MatchEntryReview Approve hidden), `3ac36ef` (PG error visibility), `7f39c2b` (mig 0066 enum casts)
- **UX polish:** `68517f9` (FINAL Black Team Wins), `e23740f` (Reject red/Approve green), `cf93728` (MOTM gold+star), `9205f9b` (PA 2-col), `d8b1b8a` (event-strip names), `c93b1ab` (⚽ + EF Satori), `ad152dd` (rosters side-by-side), `8461ad1` (Game-N footer)
- **Share PNG overhaul:** `8cfdaa8` (Game-N + force=true + MOTM inline + mig 0067), `fb5a241` (RENDER_VERSION), `659e105` (layout + emojis + mig 0068)
- **GH issue sweep:** `36b2963` (#44 #45 #46 #47)
- **Live URL:** https://ffc-gilt.vercel.app
- **Live DB:** 68 migrations
- **EF deploys:** `render-match-card` redeployed 5×

---
_Session logged: 2026-05-01 | Logged by: Claude (session-log skill) | S063_
