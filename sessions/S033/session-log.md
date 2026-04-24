# Session Log — 2026-04-24 — Session033 — Season 11 rename + planned_games + §3.1-v2 palette re-theme

**Project:** FFC
**Type:** Data fix + UI polish
**Phase:** Phase 1 Step 4 — §3.1-v2 Captain Helper polish
**BU:** Muwahid Dev
**PC:** Work (UNHOEC03)
**Duration:** ~30 min
**Commits this session:** 1 (S032 polish bundle)

---

## Pre-flight sync (MANDATORY)

- PC: Work (UNHOEC03). `.git` pointer already correct from S032 (`C:/Users/UNHOEC03/FFC-git`).
- `git fetch` clean; `main == origin/main` at `830405b` (S032 Slice C).
- Vercel production `dpl_6XdkNfM8Poij7CfxbpzVBzzNAaim` READY from S032 push.

## What Was Done

### 1. Season 11 + planned_games = 40

DB had a single row named "Season 1" with `planned_games=35`, 3 seeded test matchdays. User clarified real-world league is on **Season 11 · match 33 of 40**, so renamed + updated in one SQL:

```sql
UPDATE seasons SET name='Season 11', planned_games=40
WHERE id='ab60594c-ed7f-4c4d-a18d-6a02c1af42c3';
```

No code change — `Matches.tsx` flashcard banner already reads `seasons.planned_games` and renders `GAME N / TOTAL` per S029's work. Until this update the banner had been showing `GAME N / 35` with stale data.

### 2. §3.1-v2 Captain Helper palette re-theme

Replaced the entire `.ch-*` CSS block (~412 LOC) with a brand-tokenised version. Scope: CaptainHelper screen only (`.ch-root` subtree). Rest of app (leaderboard, profile, admin, poll, etc.) keeps the existing blue/slate theme. Per user request — "CaptainHelper only, low blast radius."

**Palette sources (mockup `mockups/3-1-v2-captain-helper.html` dark tokens):**
- `--paper: #0e1826` · `--ink: #f2ead6` (cream) · `--ink-soft: #c9b699`
- `--accent: #e63349` (brand red) · `--gold: #e5ba5b`
- `--success: #4fbf93` · `--warn: #d7a04a`

**Approach — custom properties on `.ch-root`:**
- 18 tokens declared once on `.ch-root` (`--ch-paper`, `--ch-surface`, `--ch-ink`, `--ch-accent`, etc.)
- Every descendant rule now pulls from tokens. No more hard-coded `rgba(233,236,243,*)` / `rgba(96,165,250,*)` / `#22c55e`.
- Future re-theme can swap the 18 token values without touching rules.

**Role changes:**
- "Use this pair" button: soft-green fill → solid `--ch-accent` red with white text. Primary CTA per mockup.
- "🎲 Roll captains" button: soft-blue → solid `--ch-accent` with accent-weak shadow.
- Mode-toggle active tab: blue tint → accent-red tint with accent-red border.
- Primary suggested-pair card highlight: green border → `--ch-gold-line` with gold-weak glow.
- Roster-locked chip: slate → gold-weak bg + gold text (reinforces "this matchday is frozen").
- Candidate-list section heads: Eligible green → success; Partial amber → warn (both via tokens).
- Sheet action buttons: `.ch-root .ch-sheet-actions .auth-btn--approve` overridden to accent red so the shared auth class doesn't affect login/signup screens.
- Captain `(C)` marker, current-captain row border: gold tokens.
- Gap-warning sub-modal: warn-tokenised (was hardcoded amber).
- Concurrent-admin modal (S032): cyan → gold (gold-weak body, gold border, gold strong text). Since "captains picked by another admin" is informational/advisory, the gold reads as "attention" without the blue "info" connotation.

**Text colour shift:**
- Dominant text: `rgba(233,236,243,*)` (cool white) → `#f2ead6` / `rgba(242,234,214,*)` (cream).
- On-body inherit via `color: var(--ch-ink)` at root; child rules use `--ch-ink-soft`, `--ch-ink-mute`, `--ch-ink-faint` for 3-tier hierarchy.

**Surfaces:**
- Card fills: `rgba(20,34,58,*)` → `rgba(20, 34, 52, *)` variants via `--ch-surface`/`--ch-surface-soft`/`--ch-surface-deep`. Subtle — blends better under warmer ink.
- Sheet background: `#0f1a2e` → `var(--ch-paper)` (`#0e1826`) for consistency.

### Verification
- `node ./node_modules/typescript/bin/tsc -b --force` → EXIT=0.
- `node ./node_modules/vite/bin/vite.js build` → EXIT=0 (PWA 10 entries / 2525 KB precache).
- No live smoke run — Captain Helper is auth + admin + locked-matchday gated; requires production testing by user.

### Files touched
- `ffc/src/index.css` — `.ch-*` block (lines ~3502–3925) fully replaced with tokenised version. +18 token declarations, every rule re-pointed. Net LOC unchanged (~412).

## What Did NOT Work (and why)

- **First `tsc -b` invocation ran from repo root** (shell cwd had reset after earlier SQL run) and failed with MODULE_NOT_FOUND on `node_modules/typescript/bin/tsc`. Re-ran with explicit `cd ffc &&` prefix — clean. Same Windows `&`-in-path class of bug the CLAUDE.md already flags; the fix is to use direct Node invocation from within the `ffc/` directory.

## Next Step

S034 candidates:
1. **Live acceptance of S032 + S033** — triplet click-to-expand + concurrent-admin toast + new palette. User testing on production.
2. **Propagate brand palette to other screens** if S033 re-theme feels right — next likely candidates are Poll and Leaderboard (most-used player-facing screens).
3. **Outstanding carry-over:** Live acceptance triage on S031's 21-item checklist (S030/S029/S028/S026 scope).
4. **Backburner (unchanged):** vector FFC crest SVG; captain reroll modal (blocked on `dropout_after_lock` notification flow).
