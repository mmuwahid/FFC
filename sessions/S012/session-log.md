# Session S012 — 21/APR/2026 (Home PC)

**Focus:** User review pass on Phase 1 design. Bug fixes surfaced during review. Partial review; formal approval deferred to S013.

**Outcome:**
- **7 of 9 mockups approved:** Poll · Admin Matches · Admin Players · Settings · Match Details · Leaderboard · Captain Helper.
- **2 buggy mockups fixed and re-verified:** Player Profile (3 separate bugs) · Formation planner (5 bugs in one go).
- **FFC brand logo integrated** into Poll mockup (JPG stopgap).
- **Brand palette gap discovered** but explicitly deferred.
- **New scope: 5v5 / 7v7 multi-format support** — locked direction (season default + per-matchday override), spec work deferred to S013.
- **Review not complete:** §2 data model + §3.0 platform safe-area + §3.2–§3.6 text-only sub-designs not walked through. Formal Phase 1 approval deferred to S013.

---

## Cold start

- Resumed via `session-resume` skill. Briefed user on S012 plan: section-by-section spec review + mockup verification → approval.
- Preview server started on `:5173` serving mockups from `.superpowers/brainstorm/635-1776592878/content/`.
- Walked through Section 1 (Architecture & Stack) — user approved implicitly by moving on.
- Before Section 2, user jumped ahead to give bulk approval on 7 mockups + flag 2 as still broken + request a new feature (5v5 / 7v7 format support).

---

## User feedback captured this session

### Approved mockups (no changes needed)
1. **Poll screen** (`3-7-poll-screen.html`) — incl. 9 states + State 6.5 draft-in-progress tile + 2-team State 8
2. **Admin Matches** (`3-18-admin-matches.html`) — incl. Phase 5.5 + always-visible 14-player roster
3. **Admin Players** (`3-17-admin-players.html`)
4. **Settings** (`3-16-settings.html`) — incl. pill toggles + dark default + 6 push keys
5. **Match Details** (`3-15-match-detail.html`)
6. **Leaderboard** (`3-13-leaderboard.html`)
7. **Captain Helper** (`3-1-v2-captain-helper.html`)

### Bugs reported and fixed this session
- **Player Profile** — Season stats + Achievements cards were clipped to thin strips; "everything locked out, not aligned." Root cause + fix below.
- **Formation planner** — pitch squished to ~22% of natural size; pattern pills cut off; team-strip header cut off; GK picker was a radio-card list instead of a dropdown. Root cause + fix below.

### New feature request — 5v5 / 7v7 multi-format support
- Default remains **7v7**.
- Admin can run a **5v5 matchday** when short on players, OR run an **entire season in 5v5** as a separate league.
- Format scope decision locked: **Both — season default + per-matchday override.**
- Use case: resilience when <14 commit (avoids cancelling the whole Thursday game).
- **Spec work deferred to S013** — affects §2 data model (new `match_format` enum + column on `matchdays` and/or `seasons`), §3.5 (+1 guest cap drops from 14 to 10 in 5v5), §3.7 (poll slot count + waitlist priority), §3.19 (new formation patterns for 5v5: e.g. 1-2-1, 2-1-1, 1-1-2 + shorter rotation cycles), §3.18 (admin matchday creation UI).

### Brand discovered — FFC logo + colours
- Found in `shared/`: `FF_LOGO_FINAL.pdf`, `COLORS.pdf`, `PHOTO-2026-04-18-09-28-04.jpg`.
- **Logo** is a classic football crest: split black/white shield, gold monogram "FF" inside a circle, gold laurel wreath + 3 gold stars. Very elegant / understated / Juventus-era.
- **Palette (CMYK → RGB approximations):** black `#000000` · white `#FFFFFF` · muted khaki-gold `#AEA583` (C33/M31/Y48/K1) · cream `#EDE9E1` (C6/M6/Y10/K1).
- **Gap:** mockups use `--accent: #c8102e/#e63349` (red) + `--ink: #0a1628` (navy). Neither is in the official brand palette. Real accent is the khaki-gold.
- **User decision:** **keep current palette** for now (red stays, navy stays) · only swap the crest. Palette re-alignment explicitly deferred.

### Logo integration done this session (stopgap)
- Copied `shared/PHOTO-2026-04-18-09-28-04.jpg` → `.superpowers/brainstorm/635-1776592878/content/ffc-logo.jpg`.
- Replaced CSS-gradient shield placeholder (`.crest` class with `::before` inline lines) with `<img class="crest" src="ffc-logo.jpg">` in Poll mockup (both light + dark phone instances).
- **Known defect (user flagged, S013 fix):** JPG has white background baked in — renders a visible white box around the crest when placed on dark-mode paper. **Requires a transparent PNG / SVG export.**
- **Scope expansion (user flagged, S013):** the logo should appear on **every screen that currently shows an FFC avatar** (currently only Poll, but welcome.html + any splash / sign-in + app icon / favicon / OG share image all need it).

---

## Item 1 — Player Profile bug (`3-14-player-profile.html`)

### Problem (user screenshot + inspection)

Three layered bugs:

**Bug A — Cards clipped to thin strips.**
Season stats card rendered at 49px (natural 185px). Achievements card rendered at 71px (natural 272px). Last-5 strip rendered at 14px (natural 48px). Content was in the DOM — just not visible.

**Bug B — Bottom tab bar appeared in middle of scroll area.**
User reported (with screenshot): "the footer tabs home/poll/table/profile are in the middle of the screen followed by recent matches after it." Tabbar should be fixed at the viewport bottom.

### Root cause

**Bug A** — `.phone-inner` is `display: flex; flex-direction: column; height: 824px; overflow-y: auto`. The `.card` children inherit `flex-shrink: 1` (default). When total natural content (~1100px) exceeds the 824px container, flex compresses the cards. `.card` also has `overflow: hidden`, which triggers the flex spec rule "auto min-height → 0" on flex items, enabling the compression to 0.

**Bug B** — `.tabbar` used `position: absolute; bottom: 0`. That worked when content was compressed to fit inside 824px (scroll content bottom == scroll viewport bottom). After Bug A's fix uncompressed the cards, content became ~1318px and the absolute-positioned tabbar sat at y=1318 (bottom of scroll CONTENT) rather than the viewport bottom — so it appeared mid-screen when scrolled to top.

### Fix

```css
/* Bug A fix — .card rule */
.card {
  /* … existing rules … */
  flex-shrink: 0;  /* S012: prevent flex-column phone-inner from compressing cards */
}

/* Bug B fix — .tabbar rule */
.tabbar {
  position: sticky;       /* was: absolute */
  bottom: 0; left: 0; right: 0;
  margin-top: auto;       /* pushes tabbar to end of flex column when content is short */
  z-index: 10;
  flex-shrink: 0;
  /* … rest unchanged … */
}

/* .phone-inner rule — removed the now-redundant padding-bottom: 110px
   that existed to reserve space for the absolute-positioned tabbar */
```

### Verified via DOM inspection
- Season stats card: h=187 (natural 185) ✓
- Last-5 card: h=49 (natural 48) ✓
- Achievements card: h=273 (natural 272) ✓
- Tabbar bottom: 2413 (== phone-inner.getBoundingClientRect().bottom) at scroll top AND scroll bottom — distance from viewport bottom = 0 ✓

### User re-verified: **APPROVED** (implicit in "close out" request)

---

## Item 2 — Formation planner bugs (`3-19-formation.html`)

### Problem

Live DOM inspection:

| Element | Natural height (scrollH) | Rendered height | User complaint |
|---|---|---|---|
| WHITE team header strip | 50px | 34px | "header for white/black team also cut out" |
| Formation pattern pills | 37px | 19px | "pill for 2-3-1 3-2-1 … is cut out" |
| **Pitch** | **505px** | **112px** | **"pitch is very squished — need entire field with both goals"** |
| GK picker card | 180px | 41px | "should be a drop-down menu" |
| 7-player roster | 372px | 83px | (implicit — barely visible) |

On top of that, the GK picker was a 4-row radio-card control (user wanted a native dropdown), and the SVG pitch needed verification that both goals were drawn (they were — `<rect class="goal" x="42" y="0"/>` top + `<rect class="goal" x="42" y="148"/>` bottom).

### Root cause

**Same flex-compression family as Player Profile Bug A**, but hitting every direct child of `.phone-inner` because Formation has more content than Profile (~1490px natural vs 824px container).

### Fix

**CSS:**
```css
/* Defensive rule covering all direct flex children of the scroll container */
.phone-inner > * { flex-shrink: 0; }

/* New rule for the native <select> GK picker */
.gk-select {
  display: block;
  width: calc(100% - 28px);
  margin: 0 14px 12px;
  padding: 10px 32px 10px 12px;
  border-radius: 10px;
  border: 1.5px solid var(--line-strong);
  background: var(--paper);
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path d='M1 1l5 5 5-5' stroke='%23888' stroke-width='1.5' fill='none' stroke-linecap='round'/></svg>");
  background-repeat: no-repeat;
  background-position: right 12px center;
  cursor: pointer;
}
.gk-select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.dark .gk-select { background: var(--paper-dim); }
```

**HTML:**
```html
<!-- Old: .gk-card with 4x .radio divs (~180px) -->
<!-- New: .gk-card shell + native <select class="gk-select"> (~87px) -->
<div class="gk-card">
  <div class="head">
    <span class="lbl">Who starts in goal?</span>
    <span class="mode-tag">Rotation · 10 min</span>
  </div>
  <select class="gk-select" aria-label="Starting goalkeeper">
    <option value="" disabled>Select starting GK…</option>
    <option value="omar" selected>Omar Khan (DEF) — rotation 1 · min 0–10</option>
    … 6 more …
  </select>
</div>
```

**Pitch** — no HTML change needed. SVG already draws both goals, halfway line, centre circle, both penalty boxes. Just needed flex-unlock.

### Verified via DOM inspection
- team-strip: 73 (natural 70) ✓ (was 34)
- pattern-row: 52 (natural 52) ✓ (was 19)
- **pitch-wrap: 506 (natural 505) ✓** (was 112 — 4.5× bigger)
- roster: 374 (natural 372) ✓ (was 83 — 4.5× bigger)
- gk-card: 87 ✓ (native select, compact)
- `.gk-select` computed height 40px ✓, background-color cream `rgb(246,241,228)` ✓
- Pitch SVG: 2 goals at y=0 and y=148 ✓, viewBox `0 0 100 150` ✓ (portrait, goals top + bottom)

### User re-verified: **APPROVED** ("formation is perfect now its rendering perfect")

---

## Item 3 — FFC logo integration (`3-7-poll-screen.html`)

### What was done

1. **Copied asset** — `shared/PHOTO-2026-04-18-09-28-04.jpg` → `.superpowers/brainstorm/635-1776592878/content/ffc-logo.jpg` (1117×1280, 119KB). Preview server serves from `content/` so no symlink needed.
2. **Replaced CSS-only shield placeholder** — old `.crest` class was a gradient div with `::before` pseudo to mimic a shield shape and "FFC" text. Replaced with `<img class="crest" src="ffc-logo.jpg">` + simplified `.crest` CSS block (`width/height: 36px; object-fit: contain; display: block; flex-shrink: 0`).
3. **Updated both phone header instances** (light + dark) with single replace-all Edit.
4. **Verified** — both `<img>` elements loaded (`.complete: true`), natural 1117×1280, rendered 36×36.

### Known defect (flagged by user for S013)

- JPG has baked-in white background. On the dark-mode phone, the crest appears inside a visible white box against the cream-paper backdrop. Needs either:
  - Transparent PNG (user exports from PDF via screenshot-with-bg-removal OR Adobe Reader "Export As → Image PNG" OR any free PDF→PNG converter set to preserve alpha)
  - SVG export from original Illustrator source (infinitely scalable, perfect vector — best option)

### Scope expansion (flagged by user for S013)

- Logo should appear on **every screen that currently shows an FFC avatar**. Currently only Poll has the crest. Need to:
  - Audit the rest of the mockup set (welcome.html is text-only; 8 phone mockups have no crest currently).
  - Add to: landing / sign-in splash (once drafted), app icon, favicon, WhatsApp invite OG image.

### Asset pipeline needed for implementation
| Asset | Size | Purpose | Status |
|---|---|---|---|
| `ffc-logo.jpg` | 1117×1280 | Mockup crest stopgap | ✅ in use |
| `ffc-logo.svg` | vector | Master for UI | ⏳ S013 |
| `icon-512.png` | 512×512 | PWA manifest + WhatsApp OG | ⏳ S013 |
| `icon-192.png` | 192×192 | Android home-screen | ⏳ S013 |
| `apple-touch-icon.png` | 180×180 | iOS home-screen | ⏳ S013 |
| `favicon-32.png` | 32×32 | Browser tab | ⏳ S013 |

---

## Item 4 — Review of Section 1 (Architecture & Stack)

Only spec section actually walked through this session. User gave implicit approval by moving to mockup review.

**One inconsistency flagged but not yet edited in the spec:**
- Line 43–44 says "Captain **draft** flow (Phase 2)" as a Phase-1 non-goal, but S009 + S011 added live captain-draft visibility (§3.7 State 6.5) + captain reroll mechanics to Phase 1 scope. The line needs rewording to: *"Captain **auto-pick** on lock remains Phase 2 — Phase 1 does include the captain helper, manual captain draft with live visibility, and post-lock reroll."*
- **Deferred to S013.**

---

## Session stats

| Item | Status |
|------|--------|
| Player Profile — Bug A (card compression) | ✅ FIXED + VERIFIED |
| Player Profile — Bug B (tabbar mid-scroll) | ✅ FIXED + VERIFIED |
| Formation — pitch + header + pills + roster compression | ✅ FIXED + VERIFIED |
| Formation — GK picker → native select | ✅ FIXED + VERIFIED |
| FFC logo integration on Poll (JPG stopgap) | ✅ DONE |
| Brand palette gap | 🟡 DEFERRED (user keeps current palette) |
| 5v5 / 7v7 format feature spec | ⏳ S013 (direction locked) |
| §3.14 + §3.19 spec text updates | ⏳ S013 |
| statusbar v2.2 + sticky-tabbar lesson rows in lessons.md | ✅ DONE |
| Section 1 inconsistency fix | ⏳ S013 |
| Transparent PNG / SVG logo | ⏳ S013 |
| Logo on every screen with FFC avatar | ⏳ S013 |
| §2 + §3.0 + §3.2–§3.6 section reviews | ⏳ S013 |
| Formal Phase 1 approval | ⏳ S013 |
| WIP file archive (3 files) | ⏳ S013 |
| Session close-out (log + INDEX + CLAUDE.md + todo.md + lessons.md) | ✅ DONE |

---

## Durable rules learned this session

### Statusbar v2.2 amendment — extend flex-shrink:0 to all scroll-container children
S011 added `flex-shrink: 0` to `.statusbar` only. S012 discovered that the same flex-compression hits `.card` in Player Profile and **every direct child** in Formation (team-strip, pattern-row, pitch-wrap, gk-card, roster). The general rule is: **`.phone-inner` is a scroll container, not a stretch container. Every direct child needs `flex-shrink: 0`.** The defensive CSS rule `.phone-inner > * { flex-shrink: 0; }` covers this in one line. Especially important when a child has `overflow: hidden/auto` because the flex spec forces `min-height: auto → 0` on flex items with those overflow values, enabling full compression to 0.

### Sticky-tabbar pattern for bottom nav inside scroll containers
Never use `position: absolute; bottom: 0` for a bottom nav inside a scroll container. It pins to the bottom of the CONTENT, not the viewport. Correct pattern: **`position: sticky; bottom: 0; margin-top: auto; flex-shrink: 0; z-index: 10;`** — and remove any leftover `padding-bottom: Npx` on the scroll container that existed to reserve space for the absolute nav (sticky is in-flow and reserves its own space).

### When the app content expands, revisit positioning
Bug B (tabbar) only surfaced AFTER Bug A was fixed — compressed content had been masking the tabbar bug by coincidence. Rule: **after any fix that changes the total content height, re-inspect any `position: absolute` or `position: fixed` children of the scroll container.** They may have been relying on the old (broken) layout.

---

## Handoff to S013

**Carry-over from S012 (unfinished):**
1. **Section 1 inconsistency** — fix the "Captain draft flow (Phase 2)" non-goal line in the design spec.
2. **Section 2 + §3.0 + §3.2–§3.6 review pass** — walk through text-only sub-designs.
3. **5v5 / 7v7 format feature spec update** — affects §2 (enum + column), §3.5 (guest cap), §3.7 (poll cap), §3.18 (admin UI), §3.19 (new 5v5 formation patterns).
4. **Spec patches** for S012 fixes — §3.14 + §3.19 text + lessons.md reference.
5. **Transparent PNG / SVG logo** — user to export; then wire into all mockups.
6. **Logo on every FFC avatar surface** — audit welcome.html + all phone mockups.
7. **Formal Phase 1 approval** after sections above are walked through.
8. **Archive 3 WIP files** (`_wip/item-b-draft-reroll-spec.md` · `_wip/item-settings-v2-amendments.md` · `_wip/item-formation-planner-spec.md`).
9. **Brand palette re-alignment** — explicitly deferred by user. May revisit.

**Authoritative files at S012 close:**
- `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` — Phase 1 design spec (unchanged in S012)
- `planning/FFC-masterplan-V2.7.md` — latest masterplan (unchanged)
- All 9 phone-frame mockups in `.superpowers/brainstorm/635-1776592878/content/` — Profile + Formation + Poll updated in S012
- `tasks/lessons.md` — statusbar v2.2 row + sticky-tabbar row added this session
