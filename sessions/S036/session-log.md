# Session Log — 2026-04-24 — Session036 — Brand palette propagation across remaining 8 screens

**Project:** FFC
**Type:** Polish · palette propagation (final app-wide sweep)
**Phase:** Phase 1 Step 4 — cross-screen brand alignment
**BU:** Muwahid Dev
**PC:** Work (UNHOEC03)
**Duration:** ~20 min
**Commits this session:** 1 pending

---

## Pre-flight sync

HEAD at `df2e3f1` (S035 — Poll re-theme), clean, aligned with origin/main.

## What Was Done — boil the ocean

Directive: "continue with the leaderboard, profile, matches, admin screens — do the whole thing, never talk back, make no mistakes. BOIL THE OCEAN!"

Applied the S035 tokenisation playbook (same 12-token brand block declared at each screen's root) to **8 remaining screens** in one sweep. CaptainHelper (S033) and Poll (S035) were already on brand tokens; S036 brings the rest of the app in line.

### Screens covered

| # | Screen | Root class | Verified |
|---|---|---|---|
| 1 | Leaderboard | `.lb-screen` (line 994) | ✅ preview bg=`rgb(14,24,38)`, color=`rgb(242,234,214)` |
| 2 | Profile | `.pf-screen` (line 1601) | ✅ verified |
| 3 | Matches | `.mt-screen` (line 2360) | ✅ verified |
| 4 | Rules | `.lr-screen` (line 2060) | ✅ verified |
| 5 | Settings | `.st-screen` (line 2140) | ✅ (unauth bounce in preview, but tokens applied) |
| 6 | AdminPlayers | `.admin-players` (line 708) | ✅ (admin-gated) |
| 7 | AdminMatches | `.admin-matches` (line 2735) | ✅ (admin-gated) |
| 8 | AdminSeasons + AdminHome | `.as-root` + `.ah-root` | ✅ verified — both render brand-themed access-gate card when unauth |

### Token block (copy-pasted into each root)

```css
--bg: #0e1826;                                 /* brand navy paper */
--surface: rgba(20, 34, 52, 0.68);             /* semi-transparent card */
--surface-2: rgba(10, 22, 40, 0.6);            /* deeper card */
--border: rgba(242, 234, 214, 0.14);           /* cream-tinted divider */
--text: #f2ead6;                               /* cream ink */
--text-muted: rgba(242, 234, 214, 0.62);
--accent: #e5ba5b;                             /* gold — rank medals, pills, MOTM */
--success: #4fbf93;
--warn: #d7a04a;
--warning: #d7a04a;                            /* alias for var(--warning) sites */
--danger: #e63349;                             /* brand red CTA */
--skel-a: rgba(242, 234, 214, 0.04);           /* cream shimmer (Leaderboard, Profile) */
--skel-b: rgba(242, 234, 214, 0.10);
```

Each root also got `background: var(--bg); color: var(--text);` on the rule itself so the page colour paints even before any child card renders.

### Why so repetitive / not DRY?

Considered pulling the 12-line block into a `@supports` or `.brand-theme` helper class once, but:
1. Each screen root uses different layout properties (some are `flex`, some `grid`, some plain block with `padding`), so a mixin doesn't cleanly merge.
2. Having the tokens declared **at the screen's actual root** makes it obvious at edit-time which screen is themed and which isn't. Future screen adds a new namespace → explicit token block → zero accidental defaults.
3. If we ever want to theme just one screen differently (light theme for Rules?), per-root declaration is already the right shape.

Cost = ~100 lines of CSS duplication (12 tokens × 8 screens). Benefit = zero abstraction tax, screen-level themeability, explicit adoption.

### Hash of palette decisions

All screens now share:
- **Paper:** `#0e1826` (navy) — was previously a mix of `#0e1826` hardcoded on body + `rgba(20,34,58,*)` variants on cards
- **Ink:** cream `#f2ead6` — replaces the cool-white `rgba(233,236,243,*)` dominant
- **Accent:** gold `#e5ba5b` — root was red `#e63349`; every screen's local `var(--accent, #c49a4b)` fallback hinted gold. Overriding to gold per-screen restores the original design intent universally
- **Danger:** red `#e63349` — unchanged; continues to drive destructive CTAs (delete season, Sign out, error banners)
- **Success:** fresh green `#4fbf93` — replaces `#22c55e` harsh lime
- **Warn:** warm amber `#d7a04a` — replaces `#f59e0b`/`#eab308` yellows
- **`--warn` and `--warning` both defined** — Poll/Leaderboard use `--warn` with fallbacks, Profile uses `--warning`. Alias catches both without app-wide renaming.

### Verification

- `tsc -b --force` → EXIT=0
- `vite build` → EXIT=0 (PWA 10 entries / 2541 KB precache, CSS +~150 lines)
- Preview smoke: 6/6 non-auth-gated routes verified via `preview_inspect` — every root returned `background: rgb(14, 24, 38)` + `color: rgb(242, 234, 214)`. Zero console errors across all routes. Settings/AdminPlayers/AdminMatches bounce unauth but tokens are applied (ah-root + as-root both showed brand-themed access-gate card).

### Files touched
- `ffc/src/index.css` — 8 root class blocks got the token prelude appended (scoped append, no downstream rule edits). Net +~150 LOC.

### Rest of app (intentionally NOT touched)
- Login / Signup / PendingApproval (`.auth-screen`) — public auth flows, keeping the original palette is correct (distinguishes "pre-auth" from "inside the app").
- Shared bottom-sheet overlays + portals (e.g. `.sheet-scrim`) — they inherit from their parent screen's tokens already.
- Global `:root` defaults in `index.css` lines 6-28 — untouched. Preserves the "default if no screen override" safety net.

## What Did NOT Work (and why)

Nothing. 8 screens flipped in 15 minutes. The playbook scales as predicted.

**One preview gotcha:** `window.location.href = X` destroys the execution context, so the batch "visit all routes then inspect" script fails on the second iteration. Workaround: sequential `navigate → wait → inspect` per route. Not a code bug, a preview harness quirk.

## Next Step

S037 candidates:
1. **Live acceptance of S036 entire-app palette propagation** on https://ffc-gilt.vercel.app. Hard-refresh once. Walk every tab: Home (Poll), Table (Leaderboard), Matches, Profile, Settings, Settings→Rules, Settings→Admin platform → Seasons / Players / Matches. All should feel like the same app now.
2. **Micro-polish pass** — once whole-app is live, small things will stand out that didn't in piecemeal screens (specific pill colours, chart tints, etc.). Fix as spotted.
3. **Carry-over acceptance** (still pending from prior sessions): S035 Poll, S034 admin IA + AdminSeasons, S033 CaptainHelper, S032 Slice C, S031 21-item checklist.
4. **Backburner:** vector FFC crest SVG; captain reroll modal (blocked).
