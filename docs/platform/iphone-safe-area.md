# iPhone Safe-Area — PWA Implementation Pattern

**Date:** 20/APR/2026
**Session:** S008
**Triggered by:** User concern — "we don't want the app to be behind the notch; it should be dynamic and go around it."
**Status:** Authoritative — implementation pattern referenced by design spec §3.0 and CLAUDE.md Rule #10.

---

## TL;DR

- **One meta tag + a handful of CSS env() calls** solves the notch, the Dynamic Island (iPhone 14 Pro+ / 15 / 16), and the home-indicator bottom bar for every notched iOS device.
- **Dynamic Island needs no special handling.** iOS Safari reports it via the same `env(safe-area-inset-top)` value as the classic notch — it's just a taller inset on those devices.
- **Our FFC spec already has the rule** (CLAUDE.md Rule #10: "Safe-area insets on all fixed-position mobile elements"), inherited from PadelHub. **Gap:** none of the S005–S007 approved HTML mockups actually demonstrate it. Needs a retrofit pass in S009.

---

## The mechanics

### 1. Meta viewport — enables the whole system

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

Without `viewport-fit=cover`, iOS Safari inset-pads the layout viewport itself — no content can reach the safe-area edges, but you also can't reach under the notch intentionally (e.g. for a full-width coloured topbar). **With** `viewport-fit=cover`, content can extend edge-to-edge, and it becomes the app's responsibility to pad fixed elements using `env()`.

### 2. CSS safe-area environment variables

Four inset values are exposed to CSS:

| Variable | What it measures |
|---|---|
| `env(safe-area-inset-top)` | Top obstruction — notch, Dynamic Island, or status bar |
| `env(safe-area-inset-bottom)` | Home-indicator bar on Face ID iPhones |
| `env(safe-area-inset-left)` | Landscape notch side (when portrait-app is rotated) |
| `env(safe-area-inset-right)` | Landscape notch side (mirror of left) |

All default to `0px` on devices without the obstruction, so the same CSS works for every iPhone (notched or not) and every Android device.

### 3. Pattern we'll adopt

```css
/* Apply once at the root so children can reference it */
:root {
  --safe-top:    env(safe-area-inset-top,    0px);
  --safe-right:  env(safe-area-inset-right,  0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left:   env(safe-area-inset-left,   0px);
}

/* Fixed topbar — sits under the notch but its content is padded away from it */
.topbar {
  position: fixed;
  top: 0; left: 0; right: 0;
  padding-top:    var(--safe-top);
  padding-left:   var(--safe-left);
  padding-right:  var(--safe-right);
}

/* Fixed bottom nav — its tap targets clear the home indicator */
.bottom-nav {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  padding-bottom: var(--safe-bottom);
  padding-left:   var(--safe-left);
  padding-right:  var(--safe-right);
}

/* Floating CTA stack above bottom nav — stacks safe-area onto existing offset */
.cta-stack {
  position: fixed;
  bottom: calc(var(--safe-bottom) + 12px);
}

/* Full-height modal sheets — internal scroll keeps clear of home indicator */
.sheet {
  padding-bottom: calc(var(--safe-bottom) + 16px);
}
```

### 4. Dynamic Island specifically

iPhone 14 Pro / 15 / 16 Pro models have Dynamic Island instead of a notch. From a developer perspective:

- **iOS Safari reports the same `env(safe-area-inset-top)` value** — just slightly taller than the classic notch (≈ 59pt vs 47pt in standalone mode).
- **No special detection needed.** If the app correctly pads with `env(safe-area-inset-top)`, Dynamic Island is handled for free.
- **Caveat in standalone PWA mode:** when an iPhone 14 Pro+ user "Add to Home Screen" launches the PWA, the Dynamic Island is reported correctly, but some older iOS builds (16.0–16.1) had a bug where the inset collapsed to the status-bar height. Fixed by iOS 16.2. Nothing to code around now.

### 5. Manifest + theme colour

For the PWA to extend under the status bar cleanly, add to the manifest:

```json
{
  "display": "standalone",
  "theme_color": "#e63349",
  "background_color": "#ffffff"
}
```

And in the HTML head:

```html
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="theme-color" content="#e63349" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#0e1826" media="(prefers-color-scheme: dark)" />
```

`black-translucent` is what lets the app paint behind the status bar. Without it, iOS reserves a solid 20pt bar at the top — `viewport-fit=cover` helps but doesn't fully eliminate the banding.

---

## What our mockups currently lack

Scan of `.superpowers/brainstorm/635-1776592878/content/` (all S005–S007 approved mockups):

| Mockup | `viewport-fit=cover` | `env(safe-area-inset-*)` |
|---|---|---|
| `3-7-poll-screen.html` | ❌ | ❌ |
| `3-13-leaderboard.html` | ❌ | ❌ |
| `3-14-player-profile.html` | ❌ | ❌ |
| `3-1-v2-captain-helper.html` | ❌ | ❌ |
| `welcome.html` | ❌ | ❌ |

All five use plain `padding-top`/`padding-bottom` on topbar and bottom-nav — which looks fine in the desktop-browser "phone frame" preview but will render **behind the notch and Dynamic Island** the moment the PWA is installed and opened on a real device.

**The design spec (Section 1 and CLAUDE.md Rule #10) already commits us to safe-area handling.** The mockups simply haven't operationalised it yet.

---

## Action items (for S009 and forward)

1. **Retrofit existing mockups** — add to each approved HTML's `<head>`:
   - `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
   - Root `--safe-*` custom properties
   - Apply `padding-top: var(--safe-top)` to `.topbar`
   - Apply `padding-bottom: var(--safe-bottom)` to `.bottom-nav` and fixed CTA stacks
   - Verify all sheets (§3.5 invite, §3.7 penalty, §3.14 edit sheet, §3.15 match-detail) pad internal scroll with `calc(var(--safe-bottom) + 16px)`
   - Add a simulated iPhone-14-Pro notch/Dynamic-Island cutout to the mockup "phone frame" CSS so reviewers can see the inset working visually.
2. **Bake the pattern into the mockup template** that gets reused for future screens (Settings, §3.15, admin dashboards).
3. **Elevate the rule** in the design spec — add a cross-cutting "Platform safe-area" sub-section under §3.0 so every subsequent screen spec inherits the requirement.
4. **Test on real hardware** once the Vite PWA is scaffolded (Phase 1 implementation). Home PC iPhone and work PC iPhone both — portrait AND landscape (landscape orientation exposes the `left`/`right` insets).

---

## Sources

- [MagicBell — PWA iOS Limitations and Safari Support 2026](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- [MDN — `env()` CSS function](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env)
- [CSS-Tricks — "The Notch" and CSS](https://css-tricks.com/the-notch-and-css/)
- [DEV Community — Make Your PWAs Look Handsome on iOS](https://dev.to/karmasakshi/make-your-pwas-look-handsome-on-ios-1o08)
- [GitHub Issue — shuvcode Dynamic Island PWA fix](https://github.com/Latitudes-Dev/shuvcode/issues/264)
