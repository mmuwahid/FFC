# Session Log — 2026-04-24 — Session032 — §3.1-v2 Captain Helper Slice C (polish)

**Project:** FFC
**Type:** Feature polish
**Phase:** Phase 1 Step 4 — §3.1-v2 Captain Helper Slice C
**BU:** Muwahid Dev
**PC:** Work (UNHOEC03)
**Duration:** ~45 min
**Commits this session:** 1 pending (Slice C)

---

## Pre-flight sync (MANDATORY)

- Detected `.git` pointer lagged — was `gitdir: C:/Users/User/FFC-git` (Home PC), rewrote to `C:/Users/UNHOEC03/FFC-git`.
- `git fetch`: behind origin/main by 12 commits (S029 → S031 work landed from Home PC).
- Classic state (b) lag: working tree modifications exactly matched ahead commits (`git diff HEAD origin/main --stat` confirmed). Ran stash → pull --ff-only → drop stash. Now clean at `1357c70`.
- Vercel production `dpl_5FgKYfJBE7uGWbQKAi6JmveXBq7v` READY, `ffc-gilt.vercel.app` 200 OK.

## What Was Done

### §3.1-v2 Captain Helper — Slice C (polish)

Two deferred items from S031's Slice A+B close. Both UI-only, no migrations.

**Item 1 — Criteria-triplet click-to-expand**

`title` attribute on the triplet is hover-only — invisible on touch devices, which is the primary FFC target. Converted to click-to-expand that reveals raw values inline beneath the candidate row.

- `Triplet` component now takes optional `expanded: boolean` + `onToggle: () => void` props.
- When interactive, the outer `<span>` stays a span (nested `<button>` would be invalid HTML inside the row's main button). Pattern: `onClick={(e) => { e.stopPropagation(); onToggle() }}` prevents the parent row's onClick from firing. Accepts the a11y trade-off (keyboard users still activate the row normally; triplet expansion is pointer-only) — Phase 1 polish scope.
- `CandidateRow` holds local `useState` for expansion. When open, renders a `.ch-triplet-detail` pill below the row-button showing: `✓ min-matches N MP · ✓ attendance N% · ✓ cap Nmd ago` with per-check colour coding (green pass / red fail) and strong values.
- Non-interactive Triplet callsites (SuggestedPairCard + ConfirmSheet) keep the `title` tooltip behaviour — those contexts already print raw stats in a sibling line, so the tooltip duplication is fine.
- Visual affordance for interactivity: subtle rounded hover-bg (`rgba(148,163,184,.14)`) plus a "pressed" tint when expanded (`rgba(148,163,184,.22)`).

**Item 2 — Concurrent-admin toast**

Phase 1 scope per spec: last-write-wins, advisory only (not a hard block). Detects the case where another admin sets captains between screen-load and commit, surfaces who + when, lets user Overwrite or Cancel-and-refresh.

- Added state `initialCaptainIds: string[]`, captured in `loadAll` from `match_players.is_captain = true` rows on this match.
- Added state `concurrentWarning: ConcurrentWarning | null` with intended pair + current pair names + last-edit admin name + timestamp.
- Extended `commitPair(white, black, force = false)` with a pre-commit fetch:
  1. Re-read `match_players` captain rows (`is_captain=true` filtered by `match_id`) with `team, profiles:profile_id(display_name)` embed.
  2. Compare captain set vs `initialCaptainIds`. If unchanged, commit silently.
  3. If changed, fetch most-recent `admin_audit_log` entry matching `target_entity='matches' AND target_id=match.id AND action='set_matchday_captains'` with `profiles:admin_profile_id(display_name)`. Set `concurrentWarning` and return without committing.
  4. `force=true` (fired from the modal's Overwrite button) bypasses the check.
- `ConcurrentAdminModal` component — cyan-toned variant of the sheet pattern (`.ch-sheet--concurrent`), renders:
  - Title: `⚡ Captains were picked {time ago}`
  - Current pair (white/black names) + who set them
  - User's intended pair
  - Hint line
  - Actions: `Cancel & refresh` (closes all sheets + re-calls `loadAll`) / `Overwrite anyway` (calls `commitPair(..., true)`)
- `formatTimeAgo(iso)` helper — returns `Ns ago` / `Nm ago` / `Nh ago` per magnitude.
- `admin_audit_log` is admin-select per migration 0009 (`is_admin()` policy), so this query works without additional grants.

### Verification
- `node ./node_modules/typescript/bin/tsc -b --force` → EXIT=0, clean.
- `node ./node_modules/vite/bin/vite.js build` → EXIT=0, CSS 96.20 kB (+3.4 kB), JS 682.84 kB, PWA 10 entries.
- Skipped live preview run per user ("will test later").

### Files touched
- `ffc/src/pages/admin/CaptainHelper.tsx` — JSDoc header (Slice C block), `Triplet` signature + behaviour, new `ConcurrentWarning` interface, new `formatTimeAgo` helper, new state `initialCaptainIds` + `concurrentWarning`, `loadAll` captures captain ids, `commitPair(force)` pre-check + concurrent detection, new `ConcurrentAdminModal` component, render + wiring at root.
- `ffc/src/index.css` — new `.ch-triplet--interactive`, `.ch-triplet--on`, `.ch-triplet-detail`, `.ch-sheet--concurrent`, `.ch-sheet-concurrent-body`, `.ch-concurrent-hint` (~45 lines).

## What Did NOT Work (and why)

- **First pass got the team column wrong.** I wrote `.select('profile_id, profiles:profile_id(display_name, team)')`, assuming `team` lived on `profiles`. It doesn't — `team` is on `match_players`. Caught by reading `ffc/src/lib/database.types.ts` lines 374-390; fixed to `'profile_id, team, profiles:profile_id(display_name)'`. Same class of schema-drift lesson as S025/S026 — always verify column owner before writing embeds.
- **Build was silent first time** — first `tsc -b --force` finished with no output and I wasn't sure if it passed. Re-ran with `; echo "EXIT=$?"` to confirm EXIT=0. Good habit going forward.

## Next Step

S033 candidates:
1. **Live acceptance triage** — S031's 21-item checklist (S030/S029/S028/S026) still in flight; pick up any failures.
2. **Slice C acceptance** — test triplet click-to-expand (mobile) + concurrent-admin detection (requires 2 admin sessions in different browsers).
3. **Set `planned_games` on Season 1** — pending from S031. Until set, `/matches` banner shows `GAME N` with no denominator.
4. **§3.1-v2 mockup palette alignment** — mockup uses khaki/red; `.ch-*` uses live app's blue/slate. If user prefers mockup look, re-theme.
5. **Backburner (unchanged)** — vector FFC crest SVG; global palette re-align (red+navy → khaki-gold + cream).
