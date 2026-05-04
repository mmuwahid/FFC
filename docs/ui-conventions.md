# FFC UI Conventions

App-wide design rules. Every mockup, screen, and component must comply. Referenced from `CLAUDE.md` Philosophy.

## Dates
- User-facing: **DD/MMM/YYYY** uppercase (e.g. `21/APR/2026`).
- Storage: ISO 8601 (unchanged).

## Colour semantics
- **W-D-L triplets** render green W / grey D / red L everywhere they appear (leaderboard, profile cards, match detail, captain helper).
- **Button colour rule:** green = confirm-safe (`[Keep my spot]`), red = confirm-destructive (`[Cancel anyway]`). App-wide.

## Layout
- **Fixed column widths** preferred over `auto` whenever a column can appear or disappear based on data — row-to-row alignment stability is a first-class design property.
- **Card compression guard:** `.card { flex-shrink: 0 }` on all phone-frame cards (Profile tabbar bug, S011).
- **Defensive child rule:** `.phone-inner > * { flex-shrink: 0 }` on all phone-frame mockups (Formation planner bug, S012).
- **Statusbar contract (safe-area):** hardcode `--safe-top: 59px; --safe-bottom: 34px; --safe-left: 0px; --safe-right: 0px;` on `.phone`. Statusbar = `height: var(--safe-top); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;` — time/battery flank the Dynamic Island on left/right. NEVER `padding-top: var(--safe-top)`. `env(safe-area-inset-*)` resolves to `0px` on desktop and skips the fallback, so hardcoded tokens are mandatory in mockups. See also `docs/platform/iphone-safe-area.md` for production-app implementation.
- **Mockup phone-frame** must include a simulated iPhone-14-Pro Dynamic-Island cutout so notch obstruction is visible at review time.
- **Sticky tabbar:** `position: sticky; margin-top: auto;` (Profile tabbar pattern, S012).

## Information design
- **No data without explanation.** Stats surfaces pair numbers with context (narrative, comparison, trend). The Totals card in §3.14 was deleted specifically for violating this — replaced by Achievements with labeled tiles.

## Debugging
- **CSS specificity collision** is the first suspect when a layout bug reports inconsistent fonts/spacing between element siblings. Canonical example: `.kpi .l` overrode `.wdl-triplet .l` in §3.14. When you see sibling inconsistency, grep for later-defined selectors matching the same class before guessing.

## Naming
- App is **"FFC"** only. Never expand to "Friends FC", "Friends Football Club", etc.

## Tool discipline
- Visual Companion browser is for genuine visuals only — never duplicate terminal text into it.

## Mockup review checklist
Before approving any mockup, verify:
1. `viewport-fit=cover` meta present.
2. Hardcoded `--safe-top/--safe-bottom/--safe-left/--safe-right` tokens on `.phone`.
3. `flex-shrink: 0` on statusbar, cards, and every direct child of `.phone-inner`.
4. Dynamic-Island cutout rendered in phone-frame CSS.
5. Button colours follow the green=safe / red=destructive rule.

## Per-screen brand tokens
All in-app screens (`.po-screen` Poll, `.lb-screen` Leaderboard, `.pf-screen` Profile, `.mt-screen` Matches, `.lr-screen` Rules, `.st-screen` Settings, `.aw-screen` Awards [S053], `.admin-players`, `.admin-matches`, `.as-root` AdminSeasons, `.ah-root` AdminHome, `.ch-root` CaptainHelper, `.mer-screen` MatchEntryReview) declare a 12-token brand block at scope-root: `--bg:#0e1826` paper · `--surface` translucent panel · `--text:#f2ead6` cream ink · `--accent:#e5ba5b` gold · `--danger:#e63349` red · `--success:#4fbf93` · `--warn`/`--warning`. Auth screens (`.auth-screen`) and global `:root` defaults intentionally untouched. When existing CSS is already var()-based with fallbacks, scope-override at the screen root is a 20× better ROI than rule-by-rule editing.
