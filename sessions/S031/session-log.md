# Session Log — 2026-04-24 — Session031 — Live acceptance pass on S026+S028+S029+S030 scope

**Project:** FFC
**Type:** Verification / acceptance
**Phase:** Phase 1 Step 4 — post-build acceptance
**BU:** Muwahid Dev
**PC:** Home (User) — worktree `gracious-colden-c36fec`
**Duration:** In progress
**Commits this session:** pending (documentation-only expected)

---

## Pre-flight verification (automated)

- **Worktree HEAD:** `e446fe1` — identical to `origin/main`. `git fetch` confirms no drift.
- **Vercel latest production deploy:** `dpl_5FgKYfJBE7uGWbQKAi6JmveXBq7v` (commit `e446fe1`, S030 close) — **state: READY**.
- **Production URL (https://ffc-gilt.vercel.app/) HTTP head:** `200 OK`. Latest bundle `/assets/index-l8_chq9D.js` + `/assets/index-DFUkxSSz.css` advertised in served HTML.
- **Vercel runtime error logs (last 6 h, level=error|fatal):** none.
- **todo.md S031 agenda item 1 "Push to deploy"** — already complete. S030's push confirmed in S030 log; reconfirmed here by `git log origin/main -5`.

All three automated checks green. **Auth-gated UI acceptance handed to user** (see checklist below).

---

## Live acceptance checklist — hand-off to user

Captain on live DB: `m.muwahid@gmail.com` (super_admin). Hard-refresh (Ctrl+Shift+R) once after opening — PWA service worker may cache an older bundle.

### A. S030 scope (just shipped)

| # | Feature | Where | Pass criterion |
|---|---|---|---|
| A1 | Captain's notes persist | `/match/:id/formation` as captain → type in notes textarea → Save → reload page | Text re-appears on reload. |
| A2 | Share to team | Same screen → `Share to team` button (visible once formation saved once) | Footer flips from "Draft · not yet shared" → "Shared · last synced HH:MM"; button relabels to `Re-share`. |
| A3 | Realtime to teammates | Captain edits on device 1 → Save. Team member (same team) opens on device 2 | Device 2's pitch + notes update without reload. |
| A4 | Notes read-only for non-captains | Teammate opens `/match/:id/formation` | Textarea disabled / read-only styling. |
| A5 | Poll State 8 entry link | `/poll` after teams are revealed, as captain / teammate | Captain sees `🧩 Plan formation`; teammate sees `🧩 View team formation`; click navigates to formation screen. |
| A6 | AdminMatches Formation button | `/admin/matches` → any matchday card with a `matches` row | `🧩 Formation` action visible; click routes to formation. |
| A7 | MatchDetailSheet View formation | `/matches` → tap any approved match row | Sheet footer has `🧩 View formation`; click dismisses sheet + navigates. |

### B. S029 scope

| # | Feature | Where | Pass criterion |
|---|---|---|---|
| B1 | AdminSeasons list + create | `/admin/seasons` | Existing seasons listed; `+ New season` works. |
| B2 | Edit `planned_games` inline | Same page → season row | Input updates `seasons.planned_games`; save feedback visible. |
| B3 | Matches flashcard banner `GAME N / TOTAL` | `/matches` after setting `planned_games` on Season 1 | Banner shows `GAME N / TOTAL`. If `planned_games IS NULL`, banner shows `GAME N` only. |
| B4 | Split-colour flashcard layout | `/matches` on approved match row | WHITE + BLACK halves, winner bright / loser dim, `WINNER` ribbon on winning side; `DRAW` pill on tie. |
| B5 | Scorers per team + HAT pill | Flashcard scorer columns | One row per scorer per team; hat-trick renders pink `HAT` pill. |

### C. S028 scope

| # | Feature | Where | Pass criterion |
|---|---|---|---|
| C1 | Phase 5.5 Force complete | `/admin/matches` with a `draft_sessions.status='in_progress'` seeded older than the stuck threshold | `Force complete` button enabled; click auto-distributes unpicked players alternately. |
| C2 | Phase 5.5 Abandon | Same card | `Abandon` flips status + keeps draft_picks audit trail. |
| C3 | Formation Slice A (pattern picker) | `/match/:id/formation` as captain | 9 presets selectable (6 × 7v7 + 3 × 5v5); pitch updates. |
| C4 | Formation Slice B (drag + custom) | Same screen | Pointer-drag slot token; pattern chip auto-flips to `custom`; `Reset to {named}` returns to last preset. |
| C5 | Formation Slice C (rotating GK) | Same screen | Toggle `Rotate every 10 min` → native select shows only `profiles` (guests excluded); GK badge + rotation numbers appear on tokens + roster. |

### D. S026 scope

| # | Feature | Where | Pass criterion |
|---|---|---|---|
| D1 | Poll 9 states render | `/poll` on a sampled matchday — pre-open / not-voted / confirmed #N / waitlisted / roster-locked / State 6.5 draft-in-progress / State 8 teams-revealed / penalty sheet | Each state matches spec §3.7 Depth-B. |
| D2 | Guest invite flow | Poll → `+1 guest` (when guest-slot available) | 5 chip groups required + optional description; inserts `match_guests` row. |
| D3 | Leaderboard realtime / PTR / skeleton | `/leaderboard` → admin approves a new match from another tab | Row animates without page reload. Pull-to-refresh works with resistance curve. Skeleton rows show for ≥150 ms on initial load. |
| D4 | edit_match_players toggle | `/admin/matches` → past matchday → Edit result → `✎ Edit player stats` | Reveals per-player goals/🟨/🟥/(C)/NS inputs; dirty counter; Save calls `edit_match_players`. |
| D5 | Phase 5.5 card appears | `/admin/matches` with seeded `draft_sessions.status='in_progress'` | Amber pulsing card with elapsed time. |
| D6 | Friendly auto-flag | Insert 4 active guests on a 7v7 matchday (or 3 on 5v5) | `matchdays.friendly_flagged_at` stamped automatically; AdminMatches review card appears amber. |

---

## Protocol

After each section, report results to me ("A1 PASS", "A2 FAIL — describe what happened"). I'll triage failures live, file fix commits as needed, then update this log with the outcomes and close to `origin/main`.

---

## What Was Done

### Live acceptance pass (user-driven, in flight)
Checklist handed off at [sessions/S031/acceptance-checklist.md](./acceptance-checklist.md). 21 checks across 4 scope buckets (A · S030 · 7 items; B · S029 · 5; C · S028 · 5; D · S026 · 6). Results populated as user reports them.

### §3.1-v2 Captain Helper — Slice A (parallel build while user tests)
- **New page** `ffc/src/pages/admin/CaptainHelper.tsx` (684 lines) at route `/matchday/:id/captains`, admin-gated.
  - Topbar + matchday strip + `Roster locked` chip.
  - Mode toggle (Formula / Randomizer) — default resolved from `COUNT(matches WHERE season_id=X AND approved_at IS NOT NULL) >= 5`. User toggle sticky.
  - **Formula mode:** Suggested pair cards rendered from `suggest_captain_pairs(p_matchday_id)` — top primary + one alt. Each card shows name · `#rank` pill · position pills · three-criteria `✓✓✓/✗` triplet · MP/attend/cap-cooldown subtitle · `Rank gap N · ✓ within 5` badge · `Use this pair` button.
  - **Randomizer mode:** big `🎲 Roll captains` button → `pick_captains_random(p_matchday_id)` → pair-confirmation sheet with an extra `Re-roll` action.
  - **Candidate list** sectioned Eligible / Partial / Ineligible; each row taps open confirm sheet pre-selecting the tapped candidate as anchor and the best-other eligible as partner.
  - **Pair-confirmation sheet** portal: side-by-side white/black cards (big avatar · name · pills · triplet · stats), balance badge (`✓ within 5` / `⚠ exceeds 5`), auto-assignment note, Confirm → `set_matchday_captains(matchday_id, white_profile_id, black_profile_id)` → navigate back to `/admin/matches`.
  - **White = weaker rule** enforced by sorting on `rank` (higher number = lower on leaderboard = white).
  - **Access gate** — admins only. Non-admin sees a permission card.
  - **Roster-not-locked gate** — show "Roster isn't set for this matchday" card if `matchdays.roster_locked_at IS NULL` or no `matches` row exists yet.
- **Router** `ffc/src/router.tsx` — new `{ path: 'matchday/:id/captains', element: <CaptainHelper /> }` under `RoleLayout`.
- **Entry point** in `ffc/src/pages/admin/AdminMatches.tsx` — `MatchdayCard` gains `onPickCaptains` prop; `👔 Pick captains` button renders when `locked && md.match` (i.e. roster_locked_at set AND match row exists).
- **CSS** `ffc/src/index.css` — new `.ch-*` namespace (~305 lines): root page, matchday strip, mode toggle, pair cards (primary / alt), candidate rows with triplet, sheet scrim + sheet + white/black cards + balance badge + assignment note + actions.

### Verification
- **Strict Vercel-equivalent build (`node ./node_modules/typescript/bin/tsc -b --force`)** — EXIT=0, no output. Clean.
- `node_modules` shared via Windows junction from main FFC worktree (PowerShell `New-Item -ItemType Junction`) — avoids full `npm install` in the worktree.
- No `console.*` calls in new code.

### §3.1-v2 Captain Helper — Slice B (guests + rank-gap advisory)
Commit `a689ba3`. Two acceptance items from Slice A's deferred list:
- **Guests-on-roster subsection** — queries `match_guests` for active rows (`cancelled_at IS NULL`), rendered below the candidate list with `+1` glyph · name · position pills · ⭐ rating chip (strong/average/weak colour-toned) · stamina/accuracy trait chips · click-to-expand description note. Read-only, not tappable.
- **Rank-gap > 5 "Proceed anyway?" sub-modal** — when `onConfirm` fires with `abs(whiteRank − blackRank) > 5`, a gap-warning dialog stacks in front of the confirmation sheet. Advisory only per spec (not a hard block) — admin commits with an explicit second tap. Refactored commit path to `commitPair(white_id, black_id)` so both confirm flows share one code path.
- **Enum drift caught** — `guest_rating` values are `weak | average | strong`, not `avg`. `tsc -b` strict build flagged it; fixed before commit.

### Verification (Slice B)
- `tsc -b --force` EXIT=0, clean. No console.* in new code.

### Deferred to Slice C
- Criteria-triplet click-to-expand tooltip (title attr currently works on hover).
- Concurrent-admin toast — Phase 1 accepts last-write-wins.

---

## What Did NOT Work (and why)

_Populated during / after the acceptance pass._

---

## What Did NOT Work (and why)

- **Preview-browser live acceptance impossible** — preview browser is sandboxed to localhost; external URLs (https://ffc-gilt.vercel.app) don't navigate. Handed off UI acceptance to user manually instead.
- **Worktree's `core.worktree` was misconfigured** — initially pointed at the main FFC tree, not the `.claude/worktrees/gracious-colden-c36fec/` dir. `git status` showed unrelated main-tree changes and missed all my edits. Fixed with `git config --worktree core.worktree <worktree-abs-path>`.
- **Worktree had no `node_modules`** — can't install on OneDrive without pain. Created a Windows junction via PowerShell `New-Item -ItemType Junction` pointing at the main FFC's `node_modules`. Bash `cmd //c mklink` failed due to the `&` in "11 - AI & Digital" path (same bug CLAUDE.md flags for `.bin/*.cmd` wrappers).
- **Heredoc to append CSS via Bash** — failed because heredoc substitution tripped on `$` in CSS. Used Edit tool with full old-string → new-string swap instead.
- **`guest_rating` enum value** — I guessed `avg`; actual is `average`. `tsc -b` strict build caught it on the first Slice B run. Same class of schema-drift lesson FFC already tracks.

## Next Step

S032 candidates:
1. **Live acceptance pass results** — user still testing S030/S029/S028/S026 scope + the new §3.1-v2 captain helper. Fix items as they surface.
2. **§3.1-v2 Slice C** (optional polish): criteria-triplet click-to-expand tooltip, concurrent-admin toast.
3. **§3.1-v2 mockup visual alignment** — the mockup uses a slightly different palette (khaki/red) than the live FFC app (blue/slate). Current ch-* CSS uses the app's live tokens. If user prefers the mockup look, re-theme.
4. **Backburner unchanged:** vector FFC crest SVG; palette re-align (red+navy → khaki-gold + cream).
