# Phase 3 — WhatsApp Share PNG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a one-tap "Share to WhatsApp" admin action that produces a 1080×1080 PNG of the canonical match result, server-rendered via a Supabase Edge Function and handed to the device's native share sheet via the Web Share API.

**Architecture:** Frontend Share button → POST to new Supabase Edge Function `render-match-card` → EF verifies caller is admin → calls Postgres RPC `get_match_card_payload` for the data → renders Satori JSX → Resvg-WASM rasterises to PNG → uploads to private `match-cards` storage bucket keyed by `match_id` → returns 15-min signed URL. Frontend downloads, wraps as `File`, calls `navigator.share({ files })`. Cache is forever (results immutable post-approval); admin `?force=true` flag bypasses for re-renders.

**Tech Stack:** Supabase Edge Functions (Deno), `npm:satori`, `npm:@resvg/resvg-wasm`, Supabase Storage, Web Share API, Postgres SECURITY DEFINER RPC, React 19 / TypeScript 6 / Vite 8 frontend.

**Spec:** `docs/superpowers/specs/2026-04-29-phase3-share-png-design.md`

---

## File Structure

| Path | Action | Purpose |
|---|---|---|
| `mockups/3-25-phase3-share-png-style-compare.html` | create | A/B preview — Awards-style vs Sports-broadcast. Single-file HTML. |
| `mockups/3-26-phase3-share-png.html` | create | Final approved mockup. Single-file HTML at full 1080×1080 fidelity. |
| `docs/superpowers/specs/2026-04-29-phase3-share-png-design.md` | modify | Replace Section 8 placeholder with finalised layout. |
| `supabase/migrations/0049_match_card_payload_rpc.sql` | create | RPC + storage bucket + bucket-level constraints. Atomic. |
| `supabase/functions/render-match-card/index.ts` | create | EF entry point — auth, RPC call, render orchestration, cache, upload, sign. |
| `supabase/functions/render-match-card/MatchCard.tsx` | create | Satori JSX component for the card layout. |
| `supabase/functions/render-match-card/fonts/Inter-SemiBold.ttf` | create | Bundled font, ~310 KB, SIL OFL. |
| `supabase/functions/render-match-card/fonts/PlayfairDisplay-Bold.ttf` | create | Bundled font, ~210 KB, SIL OFL. |
| `supabase/functions/render-match-card/ffc-crest.svg` | create | Local copy of the crest committed alongside EF source. |
| `supabase/functions/render-match-card/deno.json` | create | Deno import map + compiler hints. |
| `ffc/src/lib/shareMatchCard.ts` | create | Frontend helper — calls EF, downloads blob, invokes Web Share API or download fallback. |
| `ffc/src/pages/admin/MatchEntryReview.tsx` | modify | Replace post-approve `navigate()` with a success state showing Share + Done buttons. |
| `ffc/src/components/MatchDetailSheet.tsx` | modify | Add admin-only Share button to `md-actions` block. |
| `ffc/src/index.css` | modify | Add `.mer-success` + `.md-action-btn--share` styles scoped to existing screen tokens. |

---

## Decomposition Notes

- **Mockups (Tasks 1-3)** land before any code. CLAUDE.md operating rule #1 — no screen built without an approved mockup. The A/B-compare → final pattern was validated in S053 awards.
- **Migration (Task 4) is committed and applied to the live DB before any EF source is written.** Generated types regenerated immediately after — Tasks 5-7 reference real types, not invented ones.
- **EF source (Tasks 5-7) before frontend.** EF must be deployable + smoke-testable in isolation before the UI calls it. Avoids the S048-style "deploy EF and frontend together, debug both at once" trap.
- **Frontend wiring (Tasks 8-10) decomposed into helper → review-screen → detail-sheet.** Each commit produces a working state — helper is reusable, the two call sites use the same helper.
- **No backend test harness exists in this project.** Verification is `npx supabase db query --linked` smoke checks for RPCs and `curl` smoke tests for the EF; frontend uses `tsc -b` + manual review (project has no Vitest/Jest setup, would be wrong to add one for a single feature).

---

## Task 1: Mockup A/B style-compare HTML

**Files:**
- Create: `mockups/3-25-phase3-share-png-style-compare.html`

This task produces ONE file showing both style directions side-by-side at 1080×1080 each, exactly like `mockups/3-23-phase3-awards-style-compare.html` did for the awards page. The user picks elements from each before Task 2 builds the final.

- [ ] **Step 1: Read reference mockups**

Read these files to inherit visual conventions:
- `mockups/3-23-phase3-awards-style-compare.html` — A/B layout structure (two cards in a row with labels)
- `mockups/3-15-match-detail.html` — current in-app match detail visual language
- `ffc/src/pages/Awards.tsx` and find the `.aw-screen` block in `ffc/src/index.css` (around line 5618) — for the gold-serif treatment

- [ ] **Step 2: Build the A/B HTML**

Single self-contained `.html` file. Two cards side-by-side, each rendered at 540×540 in the page (50% of 1080 — fits a desktop screen) with a "View at 100%" zoom toggle. Use sample data:
- Season "Season 11"
- Date "Thu, 24 Apr 2026"
- Venue "Block A pitch"
- White 4 – 2 Black
- White scorers: Mohammed × 2, Ali × 1, Rashid (OG)
- Black scorers: Sam × 2
- MOTM: Mohammed

Style A — Awards-page continuity:
- Background: `#0e1826` paper-navy
- Title typography: serif (use `"Playfair Display", "Fraunces", Georgia, serif`), gold `#e5ba5b`, 48px
- Crest: top-centre, 96×96
- Score: large serif, 144px, cream `#f2ead6`
- Scorer rows: serif, 24px, cream
- MOTM: gold serif italic
- Footer: small caps, muted

Style B — Sports-broadcast:
- Background: gradient `#0e1826 → #1a2740`
- Title typography: sans-serif (system stack), bold uppercase, 32px
- Crest: top-left
- Score: huge sans, 160px, with TEAM WHITE / TEAM BLACK columns separated by a vertical gold divider
- Scorer rows: sans, 22px, tighter line-height
- MOTM: gold pill with sans label
- Footer: monospace timestamp

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>FFC — Phase 3 Share PNG · Style A vs B</title>
<style>
  body { margin: 0; padding: 24px; background: #1a1a1a; font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: #eee; }
  .row { display: flex; gap: 32px; flex-wrap: wrap; justify-content: center; }
  .col { display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .col h2 { margin: 0; font-size: 20px; font-weight: 600; color: #f2ead6; }
  .col p { margin: 0; font-size: 13px; color: #999; max-width: 540px; text-align: center; }
  /* Card frames — render at 540x540 (50% of 1080x1080) */
  .card { width: 540px; height: 540px; position: relative; overflow: hidden; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.5); }

  /* === Style A — Awards continuity === */
  .card--a { background: #0e1826; padding: 32px; box-sizing: border-box;
             display: flex; flex-direction: column; align-items: center; }
  .a-crest { width: 48px; height: 48px; }
  .a-title { margin-top: 8px; font-family: "Playfair Display", "Fraunces", Georgia, serif;
             font-size: 24px; color: #e5ba5b; font-weight: 700; }
  .a-meta  { font-family: "Playfair Display", Georgia, serif; font-size: 13px; color: #c9b88a; margin-top: 2px; }
  .a-score { margin-top: 14px; font-family: "Playfair Display", Georgia, serif; font-size: 72px;
             color: #f2ead6; font-weight: 700; letter-spacing: 0.04em; }
  .a-score em { font-style: normal; color: #e5ba5b; padding: 0 18px; }
  .a-teams { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 14px; width: 100%; }
  .a-team-name { font-family: "Playfair Display", Georgia, serif; font-size: 14px; color: #e5ba5b;
                 letter-spacing: 0.12em; text-transform: uppercase; text-align: center; }
  .a-scorer { font-family: "Playfair Display", Georgia, serif; font-size: 13px; color: #f2ead6; text-align: center; line-height: 1.5; }
  .a-motm { margin-top: auto; padding-top: 12px; font-family: "Playfair Display", Georgia, serif;
            font-size: 14px; color: #e5ba5b; font-style: italic; }
  .a-footer { font-size: 9px; color: #6e6450; letter-spacing: 0.18em; text-transform: uppercase; margin-top: 6px; }

  /* === Style B — Sports broadcast === */
  .card--b { background: linear-gradient(160deg, #0e1826, #1a2740); padding: 28px; box-sizing: border-box;
             display: flex; flex-direction: column; }
  .b-head { display: flex; justify-content: space-between; align-items: center; }
  .b-crest { width: 36px; height: 36px; }
  .b-title { font-family: -apple-system, system-ui, sans-serif; font-size: 16px; font-weight: 800;
             text-transform: uppercase; letter-spacing: 0.18em; color: #e5ba5b; text-align: right; }
  .b-meta { font-family: -apple-system, system-ui, sans-serif; font-size: 11px;
            color: #c9b88a; opacity: 0.85; }
  .b-scoreboard { margin-top: 24px; display: grid; grid-template-columns: 1fr auto 1fr;
                  align-items: center; gap: 12px; }
  .b-team { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .b-team-label { font-family: -apple-system, system-ui, sans-serif; font-size: 12px; font-weight: 700;
                  text-transform: uppercase; letter-spacing: 0.2em; color: #f2ead6; }
  .b-num { font-family: -apple-system, system-ui, sans-serif; font-size: 80px; font-weight: 900;
           line-height: 1; color: #f2ead6; }
  .b-divider { width: 2px; height: 80px; background: linear-gradient(to bottom, transparent, #e5ba5b, transparent); }
  .b-scorers { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 18px; }
  .b-scorer { font-family: -apple-system, system-ui, sans-serif; font-size: 12px; color: #f2ead6;
              text-align: center; line-height: 1.6; }
  .b-motm-pill { margin-top: auto; align-self: center; padding: 4px 12px; border: 1px solid #e5ba5b;
                 border-radius: 999px; font-family: -apple-system, system-ui, sans-serif; font-size: 11px;
                 color: #e5ba5b; text-transform: uppercase; letter-spacing: 0.16em; }
  .b-footer { font-family: ui-monospace, Menlo, monospace; font-size: 9px; color: #6e6450; margin-top: 6px; text-align: center; }
</style>
</head>
<body>
  <div class="row">
    <div class="col">
      <h2>Style A — Awards-page continuity</h2>
      <div class="card card--a">
        <svg class="a-crest" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="none" stroke="#e5ba5b" stroke-width="2"/><text x="32" y="40" text-anchor="middle" fill="#e5ba5b" font-family="Georgia, serif" font-size="20" font-weight="700">FFC</text></svg>
        <div class="a-title">Season 11</div>
        <div class="a-meta">Thu, 24 Apr 2026 · Block A pitch</div>
        <div class="a-score">4<em>—</em>2</div>
        <div class="a-teams">
          <div>
            <div class="a-team-name">White</div>
            <div class="a-scorer">Mohammed × 2<br>Ali × 1<br>Rashid (OG)</div>
          </div>
          <div>
            <div class="a-team-name">Black</div>
            <div class="a-scorer">Sam × 2</div>
          </div>
        </div>
        <div class="a-motm">✨ Man of the Match — Mohammed</div>
        <div class="a-footer">ffc-gilt.vercel.app</div>
      </div>
      <p>Calm, ceremonial. Inherits awards-page typography. Reads as part of the season ledger.</p>
    </div>

    <div class="col">
      <h2>Style B — Sports broadcast</h2>
      <div class="card card--b">
        <div class="b-head">
          <svg class="b-crest" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="none" stroke="#e5ba5b" stroke-width="2"/><text x="32" y="40" text-anchor="middle" fill="#e5ba5b" font-family="Georgia, serif" font-size="20" font-weight="700">FFC</text></svg>
          <div>
            <div class="b-title">Season 11</div>
            <div class="b-meta">Thu, 24 Apr 2026 · Block A</div>
          </div>
        </div>
        <div class="b-scoreboard">
          <div class="b-team"><div class="b-team-label">White</div><div class="b-num">4</div></div>
          <div class="b-divider"></div>
          <div class="b-team"><div class="b-team-label">Black</div><div class="b-num">2</div></div>
        </div>
        <div class="b-scorers">
          <div class="b-scorer">Mohammed × 2<br>Ali × 1<br>Rashid (OG)</div>
          <div class="b-scorer">Sam × 2</div>
        </div>
        <div class="b-motm-pill">✨ MOTM · Mohammed</div>
        <div class="b-footer">ffc-gilt.vercel.app · 2026-04-24</div>
      </div>
      <p>High-energy, broadcast-graphic feel. Diverges from the rest of the in-app brand but reads punchy in chat.</p>
    </div>
  </div>
</body>
</html>
```

- [ ] **Step 3: Open in browser and self-review**

Run: open `mockups/3-25-phase3-share-png-style-compare.html` in a browser. Visually verify both cards render at 540×540 with no layout overflow, no clipped text, and the inline FFC crest placeholder is centred / left-positioned correctly per each style.

- [ ] **Step 4: Show to user for approval**

Pause for user review. Expected: user picks specific elements from each style (e.g. "A's title + B's scoreboard + A's MOTM"). Record the picks for Task 2.

- [ ] **Step 5: Commit**

```bash
git add mockups/3-25-phase3-share-png-style-compare.html
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "$(cat <<'EOF'
mockup(s054): Phase 3 share-PNG A/B style compare (3-25)

Style A (awards-continuity, gold-serif) vs Style B (sports-broadcast, sans).
User picks elements before final mockup 3-26.
EOF
)"
```

---

## Task 2: Final mockup at full fidelity

**Files:**
- Create: `mockups/3-26-phase3-share-png.html`

This task produces ONE file showing the final card at TRUE 1080×1080 (no scale-down) so the user reviews exactly what the PNG will look like. Inherits the user's element-picks from Task 1.

- [ ] **Step 1: Apply user's element picks**

Translate the user's picks from Task 1's review into a single layout. The mockup CSS uses brand tokens identical to those the Satori component will use in Task 6.

- [ ] **Step 2: Build the HTML**

Card rendered at 1080×1080. Surround with a viewport showing it at 50% scale by default with a "100% (real size)" toggle button. Sample data identical to Task 1.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>FFC — Phase 3 Share PNG (Final)</title>
<style>
  :root { --bg:#0e1826; --text:#f2ead6; --accent:#e5ba5b; --muted:#c9b88a; --footer:#6e6450; }
  body { margin: 0; padding: 32px; background: #1a1a1a; font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: #eee; min-height: 100vh; box-sizing: border-box; }
  .controls { text-align: center; margin-bottom: 24px; }
  .controls button { padding: 8px 16px; border: 1px solid #555; background: #2a2a2a; color: #eee; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .controls button.active { border-color: #e5ba5b; color: #e5ba5b; }
  .stage { display: flex; justify-content: center; }
  .frame { transform-origin: top center; transition: transform 200ms; }
  .frame.scale-50 { transform: scale(0.5); margin-bottom: -540px; }
  .frame.scale-100 { transform: scale(1); }

  .card { width: 1080px; height: 1080px; background: var(--bg); padding: 64px; box-sizing: border-box;
          display: flex; flex-direction: column; align-items: center; position: relative; overflow: hidden; }

  /* INSERT FINAL LAYOUT HERE based on user's element picks from Task 1.
     The example below combines Style A's typography with a centred scoreboard
     and Style A's MOTM line. Adapt to match user's actual picks. */

  .card-crest { width: 96px; height: 96px; margin-bottom: 16px; }
  .card-title { font-family: "Playfair Display", "Fraunces", Georgia, serif; font-size: 56px; font-weight: 700; color: var(--accent); letter-spacing: 0.02em; }
  .card-meta  { font-family: "Playfair Display", Georgia, serif; font-size: 28px; color: var(--muted); margin-top: 4px; }
  .card-score { margin-top: 48px; font-family: "Playfair Display", Georgia, serif; font-size: 200px; font-weight: 700; color: var(--text); letter-spacing: 0.04em; line-height: 1; }
  .card-score em { font-style: normal; color: var(--accent); padding: 0 32px; }
  .card-teams { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; margin-top: 48px; width: 100%; max-width: 880px; }
  .card-team-name { font-family: "Playfair Display", Georgia, serif; font-size: 28px; color: var(--accent); letter-spacing: 0.16em; text-transform: uppercase; text-align: center; padding-bottom: 16px; border-bottom: 1px solid rgba(229,186,91,0.3); }
  .card-scorer-list { font-family: "Playfair Display", Georgia, serif; font-size: 28px; color: var(--text); text-align: center; line-height: 1.6; padding-top: 16px; }
  .card-motm { margin-top: auto; font-family: "Playfair Display", Georgia, serif; font-size: 32px; color: var(--accent); font-style: italic; padding-bottom: 12px; }
  .card-footer { font-family: -apple-system, system-ui, sans-serif; font-size: 16px; color: var(--footer); letter-spacing: 0.24em; text-transform: uppercase; }
</style>
</head>
<body>
  <div class="controls">
    <button id="btn50" class="active">50% (fits screen)</button>
    <button id="btn100">100% (real 1080×1080)</button>
  </div>
  <div class="stage">
    <div id="frame" class="frame scale-50">
      <div class="card">
        <svg class="card-crest" viewBox="0 0 96 96"><circle cx="48" cy="48" r="44" fill="none" stroke="#e5ba5b" stroke-width="3"/><text x="48" y="60" text-anchor="middle" fill="#e5ba5b" font-family="Georgia, serif" font-size="32" font-weight="700">FFC</text></svg>
        <div class="card-title">Season 11</div>
        <div class="card-meta">Thu, 24 Apr 2026 · Block A pitch</div>
        <div class="card-score">4<em>—</em>2</div>
        <div class="card-teams">
          <div>
            <div class="card-team-name">White</div>
            <div class="card-scorer-list">Mohammed × 2<br>Ali × 1<br>Rashid (OG)</div>
          </div>
          <div>
            <div class="card-team-name">Black</div>
            <div class="card-scorer-list">Sam × 2</div>
          </div>
        </div>
        <div class="card-motm">✨ Man of the Match — Mohammed</div>
        <div class="card-footer">ffc-gilt.vercel.app</div>
      </div>
    </div>
  </div>
  <script>
    const frame = document.getElementById('frame');
    const b50 = document.getElementById('btn50');
    const b100 = document.getElementById('btn100');
    b50.onclick = () => { frame.className = 'frame scale-50'; b50.classList.add('active'); b100.classList.remove('active'); };
    b100.onclick = () => { frame.className = 'frame scale-100'; b100.classList.add('active'); b50.classList.remove('active'); };
  </script>
</body>
</html>
```

- [ ] **Step 3: Open in browser and self-review**

Run: open `mockups/3-26-phase3-share-png.html` in a browser. Toggle 50%/100%. Verify nothing clips at 1080×1080. Verify scorer lists wrap gracefully if a name is long. Test edge cases by temporarily editing the HTML: a 0-0 result (empty scorer lists), a single-side scoring (one column empty), all-OG scenario.

- [ ] **Step 4: Show to user for approval**

Pause for user review. If user requests changes, revise inline (no need for a separate `3-27`). Once approved, proceed.

- [ ] **Step 5: Commit**

```bash
git add mockups/3-26-phase3-share-png.html
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "$(cat <<'EOF'
mockup(s054): Phase 3 share-PNG final mockup (3-26)

User-approved final layout for the 1080x1080 result card.
Locks in typography, layout, and brand tokens for the Satori
component in Task 6.
EOF
)"
```

---

## Task 3: Update spec Section 8 with finalised layout

**Files:**
- Modify: `docs/superpowers/specs/2026-04-29-phase3-share-png-design.md`

Replace Section 8's placeholder with the actual layout decisions from Task 2.

- [ ] **Step 1: Read the current Section 8 placeholder**

Open `docs/superpowers/specs/2026-04-29-phase3-share-png-design.md` and locate `## 8. Visual design (placeholder — finalised after mockup approval)`.

- [ ] **Step 2: Replace with finalised layout**

Replace from `## 8. Visual design (placeholder — finalised after mockup approval)` through to the next `---` separator. Document:
- Final typography choice (font, size, weight, letter-spacing per region)
- Final layout grid (paddings, gaps, max-widths)
- Final colour application (which brand tokens go where)
- Behaviour on edge cases: 0-0, single-team scoring, soft-deleted players, no MOTM, long scorer names (truncate vs wrap), guest scorers (with crown icon vs plain)
- Reference: "Layout finalised in `mockups/3-26-phase3-share-png.html`."

- [ ] **Step 3: Verify the rest of the spec still aligns**

Re-skim Sections 4 (font choices) and 9 (implementation breakdown). If Section 8's finalised layout introduced new fonts or new image assets, reflect them in Section 4 and the file structure list.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-04-29-phase3-share-png-design.md
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "$(cat <<'EOF'
docs(s054): finalise share-PNG spec Section 8 from approved mockup

Replaces placeholder visual-design section with the actual typography,
layout grid, and edge-case behaviour locked by mockup 3-26.
EOF
)"
```

---

## Task 4: Migration 0049 — RPC + storage bucket

**Files:**
- Create: `supabase/migrations/0049_match_card_payload_rpc.sql`

- [ ] **Step 1: Verify schema assumptions against the live DB**

Run:
```bash
npx supabase db query --linked "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='match_events' ORDER BY ordinal_position;" 2>&1 | tail -20
```

Expected output includes: `id, match_id, event_type, match_minute, match_second, team, profile_id, guest_id, meta, ordinal, created_at`. If anything's missing, STOP and reconcile with spec Section 3.

```bash
npx supabase db query --linked "SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'event_type_enum') ORDER BY enumsortorder;" 2>&1 | tail -10
```

Expected output includes `goal` and `own_goal` (plus possibly `yellow_card`, `red_card`, `motm`, etc.). If `event_type` is text not enum, run:
```bash
npx supabase db query --linked "SELECT DISTINCT event_type FROM match_events;" 2>&1 | tail -20
```

Confirm `'goal'` and `'own_goal'` are real values in production. If they aren't (e.g. project uses `'team_goal'` / `'own_goal'`), update the migration body to match.

- [ ] **Step 2: Write the migration**

```sql
-- 0049_match_card_payload_rpc.sql
-- V3.0:140 — Phase 3 WhatsApp Share PNG.
-- Adds get_match_card_payload(p_match_id uuid) admin RPC + private match-cards storage bucket.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_match_card_payload(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match           record;
  v_matchday        record;
  v_season_name     text;
  v_kickoff_iso     text;
  v_kickoff_label   text;
  v_white_scorers   jsonb;
  v_black_scorers   jsonb;
  v_motm            jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT id, matchday_id, score_white, score_black, motm_user_id, motm_guest_id, approved_at
    INTO v_match
    FROM matches
   WHERE id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found' USING ERRCODE = '22023';
  END IF;

  IF v_match.approved_at IS NULL THEN
    RAISE EXCEPTION 'Match must be approved' USING ERRCODE = '22023';
  END IF;

  SELECT md.kickoff_at, md.venue, md.season_id, s.name AS season_name
    INTO v_matchday
    FROM matchdays md
    JOIN seasons s ON s.id = md.season_id
   WHERE md.id = v_match.matchday_id;

  v_season_name   := v_matchday.season_name;
  v_kickoff_iso   := v_matchday.kickoff_at::text;
  v_kickoff_label := to_char(
    v_matchday.kickoff_at AT TIME ZONE 'Asia/Dubai',
    'Dy, DD Mon YYYY'
  );

  -- Aggregate scorers per team. A 'goal' event credits the event.team's list.
  -- An 'own_goal' event credits the OPPOSITE team's list (with own_goals++).
  -- Group by (profile_id, guest_id), preserve display name with "Deleted player"
  -- substitution for soft-deleted profiles.
  WITH expanded AS (
    SELECT
      CASE WHEN e.event_type = 'goal'     THEN e.team
           WHEN e.event_type = 'own_goal' THEN CASE WHEN e.team = 'white' THEN 'black' ELSE 'white' END
      END                                                              AS credit_team,
      e.profile_id,
      e.guest_id,
      CASE WHEN e.event_type = 'goal' THEN 1 ELSE 0 END                AS goals_inc,
      CASE WHEN e.event_type = 'own_goal' THEN 1 ELSE 0 END            AS own_goals_inc
    FROM match_events e
    WHERE e.match_id = p_match_id
      AND e.event_type IN ('goal', 'own_goal')
  ),
  grouped AS (
    SELECT
      credit_team,
      profile_id,
      guest_id,
      SUM(goals_inc)::int      AS goals,
      SUM(own_goals_inc)::int  AS own_goals
    FROM expanded
    GROUP BY credit_team, profile_id, guest_id
  ),
  named AS (
    SELECT
      g.credit_team,
      COALESCE(
        CASE WHEN p.deleted_at IS NOT NULL THEN 'Deleted player' ELSE p.display_name END,
        mg.display_name,
        'Guest'
      ) AS name,
      g.goals,
      g.own_goals
    FROM grouped g
    LEFT JOIN profiles p     ON p.id  = g.profile_id
    LEFT JOIN match_guests mg ON mg.id = g.guest_id
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object('name', name, 'goals', goals, 'own_goals', own_goals)
                       ORDER BY (goals + own_goals) DESC, name) FILTER (WHERE credit_team = 'white'), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object('name', name, 'goals', goals, 'own_goals', own_goals)
                       ORDER BY (goals + own_goals) DESC, name) FILTER (WHERE credit_team = 'black'), '[]'::jsonb)
    INTO v_white_scorers, v_black_scorers
  FROM named;

  -- MOTM resolution. Profile takes priority over guest.
  IF v_match.motm_user_id IS NOT NULL THEN
    SELECT jsonb_build_object(
             'name',
             CASE WHEN p.deleted_at IS NOT NULL THEN 'Deleted player' ELSE p.display_name END,
             'is_guest', false
           )
      INTO v_motm
      FROM profiles p
     WHERE p.id = v_match.motm_user_id;
  ELSIF v_match.motm_guest_id IS NOT NULL THEN
    SELECT jsonb_build_object('name', mg.display_name, 'is_guest', true)
      INTO v_motm
      FROM match_guests mg
     WHERE mg.id = v_match.motm_guest_id;
  ELSE
    v_motm := NULL;
  END IF;

  RETURN jsonb_build_object(
    'season_name',    v_season_name,
    'kickoff_iso',    v_kickoff_iso,
    'kickoff_label',  v_kickoff_label,
    'venue',          v_matchday.venue,
    'score_white',    v_match.score_white,
    'score_black',    v_match.score_black,
    'white_scorers',  v_white_scorers,
    'black_scorers',  v_black_scorers,
    'motm',           v_motm
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_match_card_payload(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_match_card_payload(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_match_card_payload(uuid) IS
  'Admin-only. Returns the data payload for rendering a match-result share PNG.
   Aggregates goal + own_goal events into per-team scorer lists, resolves MOTM,
   formats kickoff in Asia/Dubai. Used by the render-match-card Edge Function.';

-- Storage bucket. Private. EF service-role context writes; reads via signed URL only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('match-cards', 'match-cards', false, 524288, ARRAY['image/png'])
ON CONFLICT (id) DO NOTHING;

COMMIT;
```

- [ ] **Step 3: Apply migration to live DB**

Run:
```bash
npx supabase db push --linked 2>&1 | tail -10
```

Expected: `Applying migration 0049_match_card_payload_rpc.sql... Finished supabase db push.`

- [ ] **Step 4: Smoke-test the RPC**

Find a real approved match for testing:
```bash
npx supabase db query --linked "SELECT id FROM matches WHERE approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1;" 2>&1 | tail -10
```

If a match exists, call the RPC:
```bash
npx supabase db query --linked "SELECT public.get_match_card_payload('<paste-match-id>'::uuid);" 2>&1 | tail -30
```

Expected: a jsonb object with `season_name`, `score_white`, `score_black`, `white_scorers`, `black_scorers`, `motm`.

If NO approved match exists yet (live DB has 0 approved matches at S054 start), test the guard instead:
```bash
npx supabase db query --linked "SELECT public.get_match_card_payload('00000000-0000-0000-0000-000000000000'::uuid);" 2>&1 | tail -10
```

Expected: error `Admin role required` (because `is_admin()` returns false for the postgres-superuser-via-CLI context — confirms the guard works).

- [ ] **Step 5: Verify storage bucket created**

Run:
```bash
npx supabase db query --linked "SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id='match-cards';" 2>&1 | tail -10
```

Expected: one row, `public: false`, `file_size_limit: 524288`, `allowed_mime_types: {image/png}`.

- [ ] **Step 6: Regenerate TypeScript types**

Run:
```bash
cd ffc && npx supabase gen types typescript --linked 2>/dev/null > src/lib/database.types.ts && cd ..
```

Verify the new RPC appears:
```bash
grep -n "get_match_card_payload" ffc/src/lib/database.types.ts | head -5
```

Expected: at least 1 match in the `Functions` section with `Args: { p_match_id: string }` and `Returns: Json`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0049_match_card_payload_rpc.sql ffc/src/lib/database.types.ts
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "$(cat <<'EOF'
feat(s054): migration 0049 — match card payload RPC + storage bucket

Adds get_match_card_payload(uuid) SECURITY DEFINER RPC that aggregates
goal + own_goal events into per-team scorer lists, resolves MOTM, formats
kickoff in Asia/Dubai. is_admin() guarded; service_role plus authenticated
admins are the only callers.

Adds private 'match-cards' storage bucket (image/png only, 512 KB limit).

Live DB: 48 → 49 migrations applied.
EOF
)"
```

---

## Task 5: Edge Function scaffold + bundled assets

**Files:**
- Create: `supabase/functions/render-match-card/deno.json`
- Create: `supabase/functions/render-match-card/ffc-crest.svg`
- Create: `supabase/functions/render-match-card/fonts/Inter-SemiBold.ttf`
- Create: `supabase/functions/render-match-card/fonts/PlayfairDisplay-Bold.ttf`

This task assembles the static assets the EF will need before any logic is written.

- [ ] **Step 1: Create the EF folder + deno.json**

Run:
```bash
mkdir -p supabase/functions/render-match-card/fonts
```

Create `supabase/functions/render-match-card/deno.json`:
```json
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2",
    "satori": "npm:satori@0.10",
    "@resvg/resvg-wasm": "npm:@resvg/resvg-wasm@2",
    "react": "npm:react@18"
  },
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  }
}
```

- [ ] **Step 2: Copy the FFC crest into the EF folder**

Run (Bash, Windows-friendly):
```bash
cp ffc/public/ffc-crest.svg supabase/functions/render-match-card/ffc-crest.svg
ls -la supabase/functions/render-match-card/ffc-crest.svg
```

Expected: file present, size ~11 KB.

- [ ] **Step 3: Download fonts**

Run:
```bash
curl -L -o supabase/functions/render-match-card/fonts/Inter-SemiBold.ttf \
  https://github.com/rsms/inter/raw/master/docs/font-files/Inter-SemiBold.ttf
curl -L -o supabase/functions/render-match-card/fonts/PlayfairDisplay-Bold.ttf \
  https://github.com/google/fonts/raw/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf
ls -la supabase/functions/render-match-card/fonts/
```

Expected: two `.ttf` files, Inter-SemiBold ~310 KB, PlayfairDisplay ~210 KB. If a URL 404s, check the OFL upstream — Google Fonts repository sometimes restructures paths. As fallback, find the file in `<https://fonts.google.com/specimen/Inter>` or `<https://fonts.google.com/specimen/Playfair+Display>` and download manually.

PlayfairDisplay's variable-font file works fine for fixed Bold weight via Satori's `weight: 700` option. If file size exceeds 1 MB, swap to a static-Bold subset.

- [ ] **Step 4: Verify font files are valid TTF**

Run:
```bash
file supabase/functions/render-match-card/fonts/Inter-SemiBold.ttf
file supabase/functions/render-match-card/fonts/PlayfairDisplay-Bold.ttf
```

Expected: each line includes `TrueType Font data` or `OpenType font data`. If `file` returns "ASCII text" or "HTML document", the curl hit a redirect page — re-download.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/render-match-card/deno.json \
        supabase/functions/render-match-card/ffc-crest.svg \
        supabase/functions/render-match-card/fonts/Inter-SemiBold.ttf \
        supabase/functions/render-match-card/fonts/PlayfairDisplay-Bold.ttf
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "$(cat <<'EOF'
chore(s054): scaffold render-match-card EF folder + assets

Bundles static assets (FFC crest SVG + Inter-SemiBold + PlayfairDisplay-Bold
TTFs) into the EF source tree. No fetch at runtime.
EOF
)"
```

---

## Task 6: Edge Function source — render pipeline

**Files:**
- Create: `supabase/functions/render-match-card/MatchCard.tsx`
- Create: `supabase/functions/render-match-card/index.ts`

Implements the full render pipeline. Layout in `MatchCard.tsx` mirrors mockup `3-26` element-for-element.

- [ ] **Step 1: Write the Satori MatchCard component**

Create `supabase/functions/render-match-card/MatchCard.tsx`. The JSX shape must match the final mockup from Task 2. Use inline `style={{ ... }}` only (Satori does not support classNames or external CSS).

The example below corresponds to the example final mockup. Adapt to match your mockup's actual finalised layout:

```tsx
/** @jsxImportSource react */
type Scorer = { name: string; goals: number; own_goals: number };
type Motm = { name: string; is_guest: boolean } | null;

type Props = {
  season_name: string;
  kickoff_label: string;
  venue: string | null;
  score_white: number;
  score_black: number;
  white_scorers: Scorer[];
  black_scorers: Scorer[];
  motm: Motm;
  crestDataUri: string;
};

const COLORS = {
  bg:     '#0e1826',
  text:   '#f2ead6',
  accent: '#e5ba5b',
  muted:  '#c9b88a',
  footer: '#6e6450',
};

function scorerLine(s: Scorer): string {
  const parts: string[] = [];
  if (s.goals > 0) parts.push(s.goals === 1 ? s.name : `${s.name} × ${s.goals}`);
  if (s.own_goals > 0) parts.push(`${s.name} (OG)`);
  return parts.join(' · ');
}

export function MatchCard(props: Props) {
  const subline = props.venue ? `${props.kickoff_label} · ${props.venue}` : props.kickoff_label;

  return (
    <div style={{
      width: 1080, height: 1080, background: COLORS.bg,
      padding: 64, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      fontFamily: '"Playfair Display"',
    }}>
      <img src={props.crestDataUri} width={96} height={96} style={{ marginBottom: 16 }} />

      <div style={{ fontSize: 56, fontWeight: 700, color: COLORS.accent, letterSpacing: 1 }}>
        {props.season_name}
      </div>
      <div style={{ fontSize: 28, color: COLORS.muted, marginTop: 4 }}>
        {subline}
      </div>

      <div style={{
        marginTop: 48, fontSize: 200, fontWeight: 700, color: COLORS.text,
        letterSpacing: 4, lineHeight: 1, display: 'flex', alignItems: 'center',
      }}>
        <span>{props.score_white}</span>
        <span style={{ color: COLORS.accent, padding: '0 32px' }}>—</span>
        <span>{props.score_black}</span>
      </div>

      <div style={{
        display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
        gap: 64, marginTop: 48, width: '100%', maxWidth: 880,
      }}>
        {(['white', 'black'] as const).map((side) => {
          const list = side === 'white' ? props.white_scorers : props.black_scorers;
          return (
            <div key={side} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{
                fontSize: 28, color: COLORS.accent, letterSpacing: 4, textTransform: 'uppercase',
                paddingBottom: 16, borderBottom: `1px solid ${COLORS.accent}55`, width: '100%', textAlign: 'center',
              }}>{side}</div>
              <div style={{ fontSize: 28, color: COLORS.text, lineHeight: 1.6, paddingTop: 16, textAlign: 'center', display: 'flex', flexDirection: 'column' }}>
                {list.length === 0
                  ? <span style={{ color: COLORS.footer }}>—</span>
                  : list.map((s, i) => <span key={i}>{scorerLine(s)}</span>)}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {props.motm && (
          <div style={{ fontSize: 32, color: COLORS.accent, fontStyle: 'italic', paddingBottom: 12 }}>
            ✨ Man of the Match — {props.motm.name}
          </div>
        )}
        <div style={{ fontSize: 16, color: COLORS.footer, letterSpacing: 4, textTransform: 'uppercase' }}>
          ffc-gilt.vercel.app
        </div>
      </div>
    </div>
  );
}
```

Note: Satori requires every JSX element to have a `display` property compatible with flexbox (it does not support normal block layout). The component above uses `display: flex` everywhere there are multiple children. If a layout misbehaves, check that every container has an explicit display.

- [ ] **Step 2: Write the EF entry point**

Create `supabase/functions/render-match-card/index.ts`:

```ts
// supabase/functions/render-match-card/index.ts
// V3.0:140 — Phase 3 WhatsApp Share PNG.
// Renders a 1080x1080 PNG of an approved match result, caches by match_id
// in the match-cards storage bucket, returns a 15-min signed URL.
//
// Auth model: caller's user JWT verified via supabase.auth.getUser; admin
// gating happens server-side inside get_match_card_payload (RPC raises
// 'Admin role required' on non-admins).
//
// Storage uploads use a service-role client because the bucket's RLS only
// permits service_role writes.

import { createClient } from '@supabase/supabase-js'
import satori from 'satori'
import { Resvg, initWasm } from '@resvg/resvg-wasm'
import { MatchCard } from './MatchCard.tsx'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
// Note (S048 lesson): SUPABASE_SERVICE_ROLE_KEY auto-injected by Supabase
// is the new sb_secret_* format; supabase-js needs the legacy JWT format
// for RLS-bypassing service-role connections. We use a separately-set
// LEGACY_SERVICE_ROLE_JWT env var.
const LEGACY_SERVICE_ROLE_JWT = Deno.env.get('LEGACY_SERVICE_ROLE_JWT')!

// === Module-scope cache ===
const fontInter = await Deno.readFile(new URL('./fonts/Inter-SemiBold.ttf', import.meta.url))
const fontPlayfair = await Deno.readFile(new URL('./fonts/PlayfairDisplay-Bold.ttf', import.meta.url))
const crestSvgBytes = await Deno.readFile(new URL('./ffc-crest.svg', import.meta.url))
const crestDataUri = 'data:image/svg+xml;base64,' + btoa(new TextDecoder().decode(crestSvgBytes))

// Resvg WASM — fetch once at module init.
const resvgWasm = await fetch('https://unpkg.com/@resvg/resvg-wasm@2/index_bg.wasm')
  .then(r => r.arrayBuffer())
await initWasm(resvgWasm)

const FONTS = [
  { name: 'Inter', data: fontInter, weight: 600 as const, style: 'normal' as const },
  { name: 'Playfair Display', data: fontPlayfair, weight: 700 as const, style: 'normal' as const },
]

const SERVICE_CLIENT = createClient(SUPABASE_URL, LEGACY_SERVICE_ROLE_JWT, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// CORS — allow the deployed app origin and localhost dev.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  // 1. Verify caller JWT
  const auth = req.headers.get('Authorization') ?? ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return jsonResponse({ error: 'Missing Authorization header' }, 401)

  const userClient = createClient(SUPABASE_URL, LEGACY_SERVICE_ROLE_JWT, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: userRes, error: userErr } = await userClient.auth.getUser(jwt)
  if (userErr || !userRes.user) return jsonResponse({ error: 'Invalid token' }, 401)

  // 2. Parse body
  let body: { match_id?: string; force?: boolean } = {}
  try { body = await req.json() } catch { /* default {} */ }
  const matchId = body.match_id
  const force = body.force === true
  if (!matchId || !/^[0-9a-f-]{36}$/i.test(matchId)) {
    return jsonResponse({ error: 'Invalid match_id' }, 422)
  }

  // 3. Cache check (skip if force=true)
  const cacheKey = `${matchId}.png`
  if (!force) {
    const { data: existing } = await SERVICE_CLIENT.storage
      .from('match-cards').list('', { search: cacheKey, limit: 1 })
    if (existing && existing.some(o => o.name === cacheKey)) {
      return await signAndReturn(cacheKey)
    }
  }

  // 4. Fetch payload via the user-context client (so is_admin() resolves on the caller)
  const { data: payload, error: rpcErr } = await userClient
    .rpc('get_match_card_payload', { p_match_id: matchId })
  if (rpcErr) {
    const status = /Admin role required/i.test(rpcErr.message) ? 403
                 : /Match not found|Match must be approved/i.test(rpcErr.message) ? 422
                 : 500
    return jsonResponse({ error: rpcErr.message }, status)
  }
  if (!payload || typeof payload !== 'object') {
    return jsonResponse({ error: 'Empty payload' }, 500)
  }

  // 5. Render SVG → PNG
  let pngBytes: Uint8Array
  try {
    const svg = await satori(
      MatchCard({ ...(payload as never), crestDataUri }),
      { width: 1080, height: 1080, fonts: FONTS },
    )
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1080 } }).render().asPng()
    pngBytes = new Uint8Array(png)
  } catch (e) {
    console.error('render failed:', e)
    return jsonResponse({ error: 'Render failed' }, 500)
  }

  // 6. Upload (service-role write)
  const { error: upErr } = await SERVICE_CLIENT.storage
    .from('match-cards')
    .upload(cacheKey, pngBytes, { contentType: 'image/png', upsert: true })
  if (upErr) {
    console.error('upload failed:', upErr)
    return jsonResponse({ error: 'Upload failed' }, 500)
  }

  return await signAndReturn(cacheKey)
})

async function signAndReturn(cacheKey: string): Promise<Response> {
  const { data: signed, error } = await SERVICE_CLIENT.storage
    .from('match-cards').createSignedUrl(cacheKey, 900)
  if (error || !signed) {
    return jsonResponse({ error: 'Sign URL failed' }, 500)
  }
  return jsonResponse({ signed_url: signed.signedUrl }, 200)
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
```

- [ ] **Step 3: Verify it type-checks**

Deno's type-checker runs at deploy time, but a quick smoke check:
```bash
cd supabase/functions/render-match-card && deno check index.ts MatchCard.tsx 2>&1 | tail -10 && cd ../../..
```

If `deno` isn't installed locally, skip this step — `npx supabase functions deploy` does its own type-check. Errors there will surface in Task 7.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/render-match-card/index.ts supabase/functions/render-match-card/MatchCard.tsx
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "$(cat <<'EOF'
feat(s054): render-match-card EF source — Satori + Resvg pipeline

Edge Function entry + Satori MatchCard component. Bundled fonts loaded
at module init; FFC crest inlined as data URI. Cache check by match_id
before render; force=true bypasses cache.

Auth: caller JWT validated via auth.getUser; RPC call uses user-context
client so is_admin() resolves on the caller. Storage uploads use the
service-role client (bucket RLS permits service_role writes only).
EOF
)"
```

---

## Task 7: Deploy EF + remote smoke test

**Files:** none (deploy + verify only)

- [ ] **Step 1: Verify the LEGACY_SERVICE_ROLE_JWT secret is already set**

Run:
```bash
npx supabase secrets list 2>&1 | grep -i legacy
```

Expected: a line `LEGACY_SERVICE_ROLE_JWT` (set in S048). If absent, STOP and follow the S048 setup pattern before continuing — `notify-dispatch` won't work either if this is missing.

- [ ] **Step 2: Deploy the function**

Run:
```bash
npx supabase functions deploy render-match-card --no-verify-jwt 2>&1 | tail -20
```

Note `--no-verify-jwt`: we do JWT verification inside the function (so we can return our own 401 responses). The Functions gateway's built-in JWT check would reject calls before our code runs, breaking the cache-hit path's caller-identification.

Expected: `Deployed Function: render-match-card`. If deploy fails on a Deno error, fix the source per the error and re-run.

- [ ] **Step 3: Smoke-test against a real approved match (if one exists)**

Get a match ID + your user's JWT:

```bash
# Match ID
npx supabase db query --linked "SELECT id FROM matches WHERE approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1;" 2>&1 | tail -10
```

For the JWT: open the live app in browser, sign in as an admin, open DevTools → Application → Local Storage → find the `sb-...auth-token` entry → copy `access_token` field.

Then:
```bash
curl -X POST "https://hylarwwsedjxwavuwjrn.supabase.co/functions/v1/render-match-card" \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"match_id":"<MATCH_ID>"}' \
  | jq .
```

Expected: `{ "signed_url": "https://....supabase.co/storage/v1/object/sign/match-cards/<match_id>.png?token=..." }`. Open the signed URL in a browser — should display the rendered 1080×1080 PNG.

If the PNG looks wrong (clipped, missing fonts, broken crest), iterate on `MatchCard.tsx` and re-deploy. Use `?force=true` body flag on subsequent calls to overwrite cached PNG:
```bash
curl ... -d '{"match_id":"...","force":true}'
```

If NO approved match exists yet, create the storage bucket connection at minimum by calling with a fake UUID and asserting the 422 "Match not found" path:
```bash
curl -X POST "https://hylarwwsedjxwavuwjrn.supabase.co/functions/v1/render-match-card" \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"match_id":"00000000-0000-0000-0000-000000000000"}'
```

Expected: HTTP 422, body `{"error":"Match not found"}`.

- [ ] **Step 4: Smoke-test the auth gate (non-admin)**

If a non-admin user account exists, sign in as them, copy their JWT, and call the EF — expect HTTP 403 with `{"error":"Admin role required"}`. If no non-admin account is available, skip; the same guard is exercised in unit-style by the migration smoke test in Task 4 Step 4.

- [ ] **Step 5: Commit (no code change — verification milestone)**

No commit required if there were no source changes during smoke-testing. If `MatchCard.tsx` was iterated, fold those edits into a new commit:
```bash
git add supabase/functions/render-match-card/MatchCard.tsx
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "fix(s054): render-match-card layout adjustments from remote smoke test"
```

---

## Task 8: Frontend helper `lib/shareMatchCard.ts`

**Files:**
- Create: `ffc/src/lib/shareMatchCard.ts`

- [ ] **Step 1: Write the helper**

```ts
// ffc/src/lib/shareMatchCard.ts
// V3.0:140 — Phase 3 WhatsApp Share PNG.
// Calls the render-match-card Edge Function, downloads the PNG, hands it
// to the device's native share sheet via Web Share API. Falls back to
// browser-download for surfaces without share-files support (desktop,
// older Android Chrome).

import { supabase } from './supabase';

export type ShareResult =
  | { kind: 'shared' }
  | { kind: 'cancelled' }
  | { kind: 'downloaded' }
  | { kind: 'error'; message: string };

export async function shareMatchCard(
  matchId: string,
  opts: { force?: boolean } = {},
): Promise<ShareResult> {
  // 1. Call EF
  const { data, error } = await supabase.functions.invoke<{ signed_url: string }>(
    'render-match-card',
    { body: { match_id: matchId, force: opts.force ?? false } },
  );
  if (error) return { kind: 'error', message: error.message };
  if (!data?.signed_url) return { kind: 'error', message: 'Empty response' };

  // 2. Download blob
  const res = await fetch(data.signed_url);
  if (!res.ok) return { kind: 'error', message: `Failed to fetch card (${res.status})` };
  const blob = await res.blob();
  const filename = `ffc-match-${matchId.slice(0, 8)}.png`;
  const file = new File([blob], filename, { type: 'image/png' });

  // 3. Web Share API path
  const shareData = {
    files: [file],
    title: 'FFC Match Result',
    text: 'Result is in 🏆',
  };
  if (typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return { kind: 'shared' };
    } catch (e) {
      // AbortError = user dismissed share sheet → not an error
      if (e instanceof DOMException && e.name === 'AbortError') {
        return { kind: 'cancelled' };
      }
      // Other errors → fall through to download
    }
  }

  // 4. Download fallback
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { kind: 'downloaded' };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'Download failed' };
  }
}
```

- [ ] **Step 2: Verify it compiles standalone**

Run:
```bash
cd ffc && node ./node_modules/typescript/bin/tsc -b 2>&1 | tail -5 && cd ..
```

Expected: no errors. The helper imports `./supabase` which is the existing `ffc/src/lib/supabase.ts` createClient export.

- [ ] **Step 3: Commit**

```bash
git add ffc/src/lib/shareMatchCard.ts
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "$(cat <<'EOF'
feat(s054): shareMatchCard frontend helper

Calls render-match-card EF, downloads PNG, hands to navigator.share or
falls back to browser download. Discriminated-union ShareResult covers
shared / cancelled / downloaded / error states.
EOF
)"
```

---

## Task 9: Wire into MatchEntryReview success state

**Files:**
- Modify: `ffc/src/pages/admin/MatchEntryReview.tsx`
- Modify: `ffc/src/index.css`

The current flow (lines ~258-266 of `MatchEntryReview.tsx`) navigates away after `approve_match_entry` succeeds. Change to render a success state with Share + Done buttons.

- [ ] **Step 1: Read the current approve handler**

Re-read `ffc/src/pages/admin/MatchEntryReview.tsx` lines 250-300 to confirm the post-approve `navigate('/admin/matches')` is still on line 265 (or near it). If the file has shifted, locate the call by `grep -n "approve_match_entry" ffc/src/pages/admin/MatchEntryReview.tsx`.

- [ ] **Step 2: Find the approved match's id after the RPC succeeds**

The current RPC `approve_match_entry({ p_pending_id, p_edits })` returns the new match id (verify via `npx supabase db query --linked "SELECT pg_get_function_result((SELECT oid FROM pg_proc WHERE proname='approve_match_entry'));"`).

If the RPC returns the new match id, capture it. If not, look up the most recent match for the matchday after approve:

```bash
npx supabase db query --linked "SELECT pg_get_function_result((SELECT oid FROM pg_proc WHERE proname='approve_match_entry'));" 2>&1 | tail -5
```

Note the return type. If it's `uuid`, use `.data` from the RPC result.

- [ ] **Step 3: Add success state to MatchEntryReview**

Add a new state variable and replace the post-approve navigate with state mutation. The exact diff depends on the file's structure, but the pattern is:

```tsx
// Add near the other useState calls:
const [approvedMatchId, setApprovedMatchId] = useState<string | null>(null);
const [shareBusy, setShareBusy] = useState(false);
const [shareError, setShareError] = useState<string | null>(null);

// Replace the existing approve handler section that navigates:
//   const { error } = await supabase.rpc('approve_match_entry', { ... })
//   if (error) throw error
//   openSheet(null)
//   navigate('/admin/matches')
//
// With:
const { data: matchId, error } = await supabase.rpc('approve_match_entry', {
  p_pending_id: id,
  p_edits: edits as unknown as Json,
})
if (error) throw error
openSheet(null)
setApprovedMatchId(matchId as string)

// Then in the component render, gate on approvedMatchId:
if (approvedMatchId) {
  return (
    <div className="mer-screen mer-success">
      <div className="mer-success-icon">✓</div>
      <h1 className="mer-success-title">Match approved</h1>
      <div className="mer-success-score">
        WHITE {/* approved score_white */} – {/* approved score_black */} BLACK
      </div>
      {shareError && <div className="mer-error">{shareError}</div>}
      <button
        className="mer-action-btn mer-action-btn--share"
        onClick={async () => {
          setShareBusy(true); setShareError(null);
          const result = await shareMatchCard(approvedMatchId);
          setShareBusy(false);
          if (result.kind === 'error') setShareError(result.message);
        }}
        disabled={shareBusy}
      >
        {shareBusy ? 'Generating card…' : '📲 Share to WhatsApp'}
      </button>
      <button
        className="mer-action-btn mer-action-btn--secondary"
        onClick={() => navigate('/admin/matches')}
      >
        Done
      </button>
    </div>
  );
}
```

For the score values shown in the success state, capture the approved scores into local state at the same time as `setApprovedMatchId`. Add `useState<{ white: number; black: number } | null>` for `approvedScore`.

If `approve_match_entry` does NOT return the new match id (returns void), look up the match instead:
```ts
const { data: lookup } = await supabase
  .from('matches')
  .select('id, score_white, score_black')
  .eq('matchday_id', data.entry.matchday_id)
  .order('approved_at', { ascending: false })
  .limit(1)
  .maybeSingle();
if (lookup) {
  setApprovedMatchId(lookup.id);
  setApprovedScore({ white: lookup.score_white, black: lookup.score_black });
}
```

Add the `import { shareMatchCard } from '../../lib/shareMatchCard'` at the top of the file.

- [ ] **Step 4: Add CSS for the success state**

Append to `ffc/src/index.css`:

```css
/* === MatchEntryReview success state (S054) === */
.mer-success {
  min-height: 60vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 32px;
  text-align: center;
}
.mer-success-icon {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: var(--success, #4fbf93);
  color: var(--bg, #0e1826);
  display: grid;
  place-items: center;
  font-size: 36px;
  font-weight: 700;
}
.mer-success-title {
  margin: 0;
  color: var(--text, #f2ead6);
}
.mer-success-score {
  font-size: 24px;
  font-weight: 700;
  color: var(--accent, #e5ba5b);
  letter-spacing: 0.04em;
}
.mer-action-btn--share {
  background: var(--accent, #e5ba5b);
  color: var(--bg, #0e1826);
  font-weight: 700;
  padding: 14px 24px;
  border: 0;
  border-radius: 12px;
  font-size: 16px;
  min-height: 52px;
  width: 100%;
  max-width: 360px;
  cursor: pointer;
}
.mer-action-btn--share:disabled { opacity: 0.6; cursor: progress; }
.mer-action-btn--secondary {
  background: transparent;
  color: var(--text, #f2ead6);
  border: 1px solid var(--text, #f2ead6);
  padding: 14px 24px;
  border-radius: 12px;
  font-size: 16px;
  min-height: 52px;
  width: 100%;
  max-width: 360px;
  cursor: pointer;
}
.mer-error {
  color: var(--danger, #e63349);
  font-size: 14px;
  max-width: 360px;
}
```

- [ ] **Step 5: Verify the build**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc -b 2>&1 | tail -5 && node ./node_modules/vite/bin/vite.js build 2>&1 | tail -10 && cd ..
```

Expected: 0 type errors, build succeeds with PWA precache showing 12 entries (existing count + the new helper goes into the same chunk).

- [ ] **Step 6: Commit**

```bash
git add ffc/src/pages/admin/MatchEntryReview.tsx ffc/src/index.css
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "$(cat <<'EOF'
feat(s054): wire share-PNG into MatchEntryReview success state

Replaces post-approve navigate('/admin/matches') with an in-place
success state showing the final score plus a primary 'Share to WhatsApp'
CTA that calls shareMatchCard(matchId). Done button still routes to
the matches list.

Adds .mer-success / .mer-action-btn--share / .mer-action-btn--secondary
to index.css using existing brand tokens.
EOF
)"
```

---

## Task 10: Wire into MatchDetailSheet admin footer

**Files:**
- Modify: `ffc/src/components/MatchDetailSheet.tsx`
- Modify: `ffc/src/index.css`

Add an admin-only Share button to the existing `md-actions` block (around line 256).

- [ ] **Step 1: Find the md-actions block**

Run:
```bash
grep -n "md-actions" ffc/src/components/MatchDetailSheet.tsx
```

Confirm the block starts where the Formation link button currently lives. Read the surrounding lines to confirm the conditional / props the file uses.

- [ ] **Step 2: Read AppContext to find the role check**

```bash
grep -n "role\|isAdmin\|is_admin" ffc/src/lib/AppContext.tsx | head -10
```

Note the field name used (likely `role` with values `'super_admin' | 'admin' | 'player' | ...`). Adapt the snippet below to match the actual field.

- [ ] **Step 3: Add the Share button to md-actions, admin-only**

Inside `MatchDetailSheet.tsx`, locate the `<div className="md-actions">` block. Add a sibling button at the end of the block (still inside the same div), gated on `isAdmin`. Pull the `isAdmin` flag from `useAppContext()` at the top of the component.

```tsx
// At top of file:
import { useState } from 'react';
import { useAppContext } from '../lib/AppContext';
import { shareMatchCard } from '../lib/shareMatchCard';

// Inside the component, near the other hooks:
const { role } = useAppContext();
const isAdmin = role === 'admin' || role === 'super_admin';
const [shareBusy, setShareBusy] = useState(false);

// Inside the existing <div className="md-actions"> ... </div> block,
// after the Formation button, add:
{isAdmin && main.approved_at && (
  <button
    type="button"
    className="md-action-btn md-action-btn--share"
    disabled={shareBusy}
    onClick={async () => {
      setShareBusy(true);
      await shareMatchCard(main.id);
      setShareBusy(false);
    }}
  >
    {shareBusy ? 'Generating card…' : '📲 Share to WhatsApp'}
  </button>
)}
```

The `main.approved_at` guard means the button only shows for already-approved matches. Pre-approval / draft matches don't render Share.

- [ ] **Step 4: Add the share-button variant CSS**

Append to `ffc/src/index.css`:

```css
.md-action-btn--share {
  background: var(--accent, #e5ba5b);
  color: var(--bg, #0e1826);
  font-weight: 700;
}
.md-action-btn--share:disabled { opacity: 0.6; cursor: progress; }
```

- [ ] **Step 5: Verify the build**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc -b 2>&1 | tail -5 && node ./node_modules/vite/bin/vite.js build 2>&1 | tail -10 && cd ..
```

Expected: 0 type errors, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add ffc/src/components/MatchDetailSheet.tsx ffc/src/index.css
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "$(cat <<'EOF'
feat(s054): wire share-PNG into MatchDetailSheet admin footer

Adds admin-only '📲 Share to WhatsApp' button to the MatchDetailSheet's
md-actions block. Visible only when match.approved_at is non-null and
caller's role is admin / super_admin.
EOF
)"
```

---

## Task 11: Final verification + push

**Files:** none

- [ ] **Step 1: Full strict build**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc -b 2>&1 | tail -10 && node ./node_modules/vite/bin/vite.js build 2>&1 | tail -15 && cd ..
```

Expected: zero TypeScript errors, zero build warnings, PWA precache reports 12+ entries with total under 1700 KiB. If `noUnusedLocals` complains about leftover state from earlier scaffolding, drop the unused symbols.

- [ ] **Step 2: End-to-end smoke test on the deployed Vercel preview**

Push the branch and let Vercel auto-deploy:
```bash
git push origin main
```

Wait for Vercel build green (~90 s). Open the live URL, sign in as admin, navigate to a pending match entry, approve it. Verify:
- Success state renders (not navigated away).
- Share button reads "📲 Share to WhatsApp".
- Tapping it shows "Generating card…" (~2 s cold), then opens the device share sheet (on mobile) or downloads the PNG (on desktop).
- Resulting PNG matches mockup `3-26` exactly.
- Re-tapping the button on the same match returns within ~500 ms (cache hit).

- [ ] **Step 3: Verify the PNG is in the storage bucket**

```bash
npx supabase db query --linked "SELECT name, created_at, metadata->>'size' as bytes FROM storage.objects WHERE bucket_id='match-cards' ORDER BY created_at DESC LIMIT 5;" 2>&1 | tail -20
```

Expected: at least one row with the test match's id.png and a sensible byte size (40-80 KB typical).

- [ ] **Step 4: Verify re-share path from Matches list**

Navigate to Matches → tap the row of the just-shared match → MatchDetailSheet opens → admin footer shows the Share button → tap → same flow as above succeeds.

- [ ] **Step 5: Update CLAUDE.md current-state line**

Edit `CLAUDE.md`'s `## Current state` block:
- Bump migration count to 49
- Add `render-match-card` to the deployed Edge Functions list
- Set Phase 3 progress note to mention V3.0:140 shipped

- [ ] **Step 6: Update tasks/todo.md**

Move the "WhatsApp share PNG (V3.0:140)" backburner item to a S054 close-out block. Update `## NEXT SESSION` block to drop the awards-only verification items now that share-PNG is also live.

- [ ] **Step 7: Commit close-out**

```bash
git add CLAUDE.md tasks/todo.md
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "$(cat <<'EOF'
docs(s054): close-out — share-PNG shipped, doc updates

Updates CLAUDE.md current-state + tasks/todo.md NEXT SESSION block to
reflect V3.0:140 shipping (mig 0049, render-match-card EF, Share buttons
on MatchEntryReview success state and MatchDetailSheet admin footer).
EOF
)"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- §1 user flow → covered by Tasks 9 (review-screen) + Task 10 (detail sheet)
- §2 architecture → Tasks 4 (RPC + bucket), 5-6 (EF), 8 (helper)
- §3 data contract (RPC) → Task 4
- §4 EF endpoint contract + render pipeline → Task 6
- §5 frontend wiring → Tasks 8, 9, 10
- §6 auth model — three independent gates → frontend (Tasks 9, 10), EF JWT (Task 6 step 1), RPC body (Task 4 step 2)
- §7 failure modes → Task 6 (cache-bust force flag, RPC error mapping), Task 8 (Web Share fallback)
- §8 visual design → Tasks 1, 2 (mockups), Task 3 (spec update)
- §9 implementation breakdown → matches Tasks 4-10 in this plan
- §10 risks → Satori-crest fallback noted in Task 6 (test in mockup phase first); Web Share standalone-PWA test in Task 11

All sections traced.

**Placeholder scan:** None. Every task has actual code or actual commands.

**Type consistency:** `ShareResult` discriminated union same shape across Tasks 8, 9, 10. RPC arg name `p_match_id` consistent across migration (Task 4), EF (Task 6), helper (Task 8). Bucket name `match-cards` consistent across migration + EF.

**One ambiguity flagged inline (Task 9 Step 2):** The post-approve flow needs the new match's UUID. The plan handles both the case where `approve_match_entry` returns it (use directly) and the case where it doesn't (lookup). Implementer must run the verification command in Task 9 Step 2 to determine which branch applies.

**Plan complete and saved to `docs/superpowers/plans/2026-04-29-phase3-share-png.md`.**

---

## Execution

Per established convention (S053 / brainstorming memory), execution defaults to **Subagent-Driven Development** — fresh subagent per task with two-stage review between tasks. The orchestrator dispatches each task with the spec + this plan + the prior task's commit hash as context; reviews each commit before dispatching the next.

REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`.
