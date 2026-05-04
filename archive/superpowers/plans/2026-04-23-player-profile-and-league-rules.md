# Player Profile + League Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement §3.14 Player Profile (replacing the stub) and §3.16 League Rules static screen (new Settings sub-screen).

**Architecture:** Profile.tsx replaces the stub; reads `?profile_id=&season_id=` query params; runs 5 parallel Supabase queries (profile, seasons, standings, last-5, recent-matches + career aggregates computed client-side). League Rules is a pure static component routed at `/settings/rules`. No new SQL migrations needed — `profiles_update_own` policy in `0009_rls_policies.sql` already covers self-update.

**Tech Stack:** React 19 + TypeScript, Supabase JS client (PostgREST), React Router `useSearchParams`, `index.css` scoped with `pf-*` prefix (same pattern as Leaderboard's `lb-*`).

---

## Pre-flight facts (confirm before starting)

- **RLS for self-update:** `profiles_update_own` in `supabase/migrations/0009_rls_policies.sql` already has `USING (auth_user_id = auth.uid())` + `WITH CHECK` that blocks role escalation. No new migration needed.
- **Route:** Leaderboard navigates to `/profile?profile_id=<uuid>&season_id=<uuid>`. Profile.tsx reads these via `useSearchParams()`. The `/profile/:id` route in router.tsx stays but Profile will ignore the path param (it's only there for future deep-link use).
- **v_season_standings** view columns: `profile_id, display_name, wins, draws, losses, goals, yellows, reds, motms, late_cancel_points, points, season_id`.
- **v_player_last5** view columns: `profile_id, outcome (string 'W'/'D'/'L'), kickoff_at, season_id`.
- **match_players** columns: `profile_id, match_id, team (team_color: 'white'|'black'), goals, yellow_cards, red_cards`.
- **matches** columns: `id, result (match_result), score_white, score_black, motm_user_id, approved_at, season_id`.
- **profiles** columns: `id, display_name, avatar_url, primary_position, secondary_position, theme_preference, leaderboard_sort, role, is_active, joined_on`.
- **seasons** columns: `id, name, starts_on, ended_at, archived_at, created_at`.
- `index.css` ends at line 1537; append `pf-*` CSS after it.
- **W/L-streak computation:** run RLE in app code over the `recentMatches` result set (spec §3.14 Phase 1 note). `v_player_achievements` view is not yet built; defer to Phase 2.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `ffc/src/pages/Profile.tsx` | Replace stub with full profile screen |
| Modify | `ffc/src/index.css` | Append `pf-*` CSS block |
| Modify | `ffc/src/router.tsx` | Add `/settings/rules` route |
| Modify | `ffc/src/pages/Settings.tsx` | Add League Rules row |
| Create | `ffc/src/pages/LeagueRules.tsx` | Static rules screen |

---

## Task 1: CSS scaffolding — append `pf-*` block to `index.css`

**Files:**
- Modify: `ffc/src/index.css` (append after line 1537)

- [ ] **Step 1: Append the `pf-*` CSS block to the end of `index.css`**

```css
/* ============================================================
 * §3.14 Profile screen — pf-* namespace
 * Design tokens: shared with lb-* (--surface, --surface-2,
 *   --border, --text, --text-muted, --accent, --success,
 *   --pos-gk/def/cdm/w/st, --last-w/d/l defined above).
 * ============================================================ */

/* Screen wrapper */
.pf-screen {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding-bottom: calc(var(--safe-bottom, 0px) + 80px);
}

/* Top nav (back + edit) */
.pf-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px 4px;
}
.pf-nav-btn {
  width: 36px; height: 36px; border-radius: 10px;
  display: grid; place-items: center;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  cursor: pointer;
  font-size: 18px;
  font-weight: 700;
  flex-shrink: 0;
}
.pf-nav-btn--edit {
  background: var(--accent);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 4px 14px -4px color-mix(in srgb, var(--accent) 60%, transparent);
}

/* Hero band */
.pf-hero {
  padding: 10px 16px 16px;
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.pf-avatar {
  width: 72px; height: 72px; border-radius: 22px;
  background: var(--accent);
  color: #fff;
  display: grid; place-items: center;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.01em;
  flex-shrink: 0;
  box-shadow: 0 8px 24px -8px color-mix(in srgb, var(--accent) 50%, transparent);
  object-fit: cover;
}
.pf-avatar--other { background: var(--surface-2); color: var(--text); box-shadow: none; }
.pf-identity { flex: 1; min-width: 0; padding-top: 2px; }
.pf-name-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-bottom: 6px;
}
.pf-name {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.01em;
  line-height: 1.1;
}
.pf-role-chip {
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: var(--warning, #f59e0b);
  color: #1a1200;
}
.pf-inactive-chip {
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: var(--surface-2);
  color: var(--text-muted);
}
.pf-banned-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border: 1px solid var(--danger);
  color: var(--danger);
  margin-top: 4px;
}
.pf-joined {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 8px;
  letter-spacing: 0.04em;
}
.pf-pills {
  display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap;
}
.pf-pos {
  height: 28px;
  padding: 0 12px;
  border-radius: 8px;
  display: inline-flex; align-items: center;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.pf-pos--fill-gk  { background: var(--pos-gk);  color: #3b2a00; }
.pf-pos--fill-def { background: var(--pos-def); color: #fff; }
.pf-pos--fill-cdm { background: var(--pos-cdm); color: #fff; }
.pf-pos--fill-w   { background: var(--pos-w);   color: #fff; }
.pf-pos--fill-st  { background: var(--pos-st);  color: #fff; }
.pf-pos--out-gk  { border: 1.5px solid var(--pos-gk);  color: var(--pos-gk); }
.pf-pos--out-def { border: 1.5px solid #9eb3e0; color: #9eb3e0; }
.pf-pos--out-cdm { border: 1.5px solid #5ecba0; color: #5ecba0; }
.pf-pos--out-w   { border: 1.5px solid var(--pos-w);   color: var(--pos-w); }
.pf-pos--out-st  { border: 1.5px solid var(--pos-st);  color: var(--pos-st); }

/* Season picker (same anchored-dropdown pattern as lb-season-chip) */
.pf-season-wrap {
  position: relative;
  display: inline-block;
  margin: 0 16px 12px;
}
.pf-season-chip {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 13px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
}
.pf-season-chip:disabled { opacity: 0.6; cursor: default; }
.pf-season-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--success);
  flex-shrink: 0;
}
.pf-season-dot--archived { background: var(--text-muted); }
.pf-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 220px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 8px 32px -8px rgba(0,0,0,0.5);
  z-index: 200;
  overflow: hidden;
}
.pf-dropdown-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 14px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  gap: 8px;
}
.pf-dropdown-item:last-child { border-bottom: none; }
.pf-dropdown-item:hover { background: var(--surface-2); }
.pf-dropdown-item--active { color: var(--accent); font-weight: 700; }

/* Cards */
.pf-card {
  margin: 0 14px 10px;
  background: var(--surface);
  border-radius: 16px;
  border: 1px solid var(--border);
  overflow: hidden;
  flex-shrink: 0;
}
.pf-card-title {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 11px 14px 5px;
}
.pf-card-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.pf-card-hint {
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
}

/* Season stats KPI grid */
.pf-kpi-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  padding: 4px 10px 12px;
  gap: 4px;
}
.pf-kpi {
  padding: 10px 6px;
  text-align: center;
  border-radius: 10px;
  display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
  gap: 6px;
  min-height: 52px;
  line-height: 1.1;
}
.pf-kpi-v {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.1;
  letter-spacing: -0.02em;
  display: block;
}
.pf-kpi-v--muted { color: var(--text-muted); }
.pf-kpi-v--accent { color: var(--accent); font-size: 30px; }
.pf-kpi-v--mono { font-family: var(--mono); font-size: 17px; }
.pf-kpi-l {
  font-size: 9px; font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--text-muted);
  margin-top: 0; line-height: 1.3; display: block;
}

/* W-D-L triplet (shared semantics — green W / grey D / red L) */
.pf-wdl {
  font-family: var(--mono);
  font-size: 17px; font-weight: 700; letter-spacing: 0.02em;
  display: inline-flex; align-items: baseline; gap: 1px;
}
/* Critical: override any .pf-kpi-l that might inherit into the triplet spans */
.pf-kpi .pf-wdl .pf-w,
.pf-kpi .pf-wdl .pf-d,
.pf-kpi .pf-wdl .pf-l {
  font-size: inherit; font-weight: inherit; letter-spacing: inherit;
  text-transform: none; margin-top: 0; line-height: 1;
}
.pf-w  { color: var(--last-w); }
.pf-d  { color: var(--last-d); }
.pf-l  { color: var(--last-l); }
.pf-sep { color: var(--text-muted); margin: 0 2px; }

/* Last-5 strip */
.pf-last5 {
  padding: 10px 14px;
  display: flex; justify-content: space-between; align-items: center;
}
.pf-last5-strip { display: flex; gap: 6px; }
.pf-circle {
  width: 24px; height: 24px; border-radius: 50%;
  display: grid; place-items: center;
  color: #fff;
  font-size: 11px; font-weight: 800;
  letter-spacing: 0;   /* prevent glyph offset */
  line-height: 1;
}
.pf-circle--W { background: var(--last-w); }
.pf-circle--D { background: var(--last-d); }
.pf-circle--L { background: var(--last-l); }

/* Achievements grid */
.pf-ach-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  padding: 4px 10px 14px;
  gap: 6px;
}
.pf-ach-tile {
  padding: 12px 6px;
  text-align: center;
  border-radius: 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
  gap: 4px;
  line-height: 1.2;
  min-height: 96px;
  flex-shrink: 0;
}
.pf-ach-icon { font-size: 20px; line-height: 1; margin-bottom: 2px; display: block; }
.pf-ach-big {
  font-size: 22px; font-weight: 700;
  color: var(--text); letter-spacing: -0.02em; line-height: 1.1; display: block;
}
.pf-ach-big--pos { color: var(--last-w); }
.pf-ach-big--neg { color: var(--last-l); }
.pf-ach-lbl {
  font-size: 9px; font-weight: 700; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--text-muted); line-height: 1.3; display: block;
}
.pf-ach-ctx { font-size: 10px; font-style: italic; color: var(--text-muted); line-height: 1.25; display: block; }

/* Career-starter CTA (replaces achievements when career_matches = 0) */
.pf-cta-tile {
  margin: 0 14px 10px;
  background: var(--surface);
  border-radius: 16px;
  border: 1px solid var(--border);
  padding: 24px 18px;
  text-align: center;
  flex-shrink: 0;
}
.pf-cta-title { font-size: 16px; font-weight: 700; color: var(--text); margin-bottom: 6px; }
.pf-cta-sub { font-size: 13px; color: var(--text-muted); margin-bottom: 16px; }
.pf-cta-btn {
  display: inline-block;
  padding: 10px 18px;
  background: var(--accent);
  color: #fff;
  border-radius: 10px;
  font-size: 13px; font-weight: 700; letter-spacing: 0.05em;
  text-decoration: none;
}

/* Recent matches */
.pf-recent-head {
  padding: 0 18px 6px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.16em;
  text-transform: uppercase; color: var(--text-muted);
}
.pf-recent-list { margin: 0 10px 12px; }
.pf-recent-row {
  display: grid;
  grid-template-columns: auto 28px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 10px;
  border-radius: 12px;
  margin-bottom: 4px;
  border: 1px solid var(--border);
  background: var(--surface);
  cursor: pointer;
  width: 100%;
  text-align: left;
  font-family: inherit;
  color: inherit;
}
.pf-recent-row:hover { background: var(--surface-2); }
.pf-date-block { min-width: 78px; }
.pf-date { font-family: var(--mono); font-size: 11px; font-weight: 700; color: var(--text); letter-spacing: 0.02em; }
.pf-season-cap { font-size: 9px; color: var(--text-muted); letter-spacing: 0.08em; text-transform: uppercase; margin-top: 1px; }
.pf-result-badge {
  width: 28px; height: 28px; border-radius: 8px;
  display: grid; place-items: center;
  color: #fff; font-size: 12px; font-weight: 800;
}
.pf-result-badge--W { background: var(--last-w); }
.pf-result-badge--D { background: var(--last-d); }
.pf-result-badge--L { background: var(--last-l); }
.pf-match-meta { min-width: 0; }
.pf-team-score-row { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
.pf-team-chip {
  padding: 2px 7px; font-size: 9px; font-weight: 700;
  letter-spacing: 0.08em; border-radius: 4px;
}
.pf-team-chip--white { border: 1px solid var(--border); background: color-mix(in srgb, #fff 15%, transparent); color: var(--text); }
.pf-team-chip--black { background: #0a1628; color: #f2ead6; border: 1px solid #0a1628; }
.pf-score { font-family: var(--mono); font-size: 13px; font-weight: 700; color: var(--text); }
.pf-player-line { font-size: 11px; color: var(--text-muted); letter-spacing: 0.01em; }
.pf-player-line-motm { color: var(--warning, #f59e0b); font-weight: 700; }
.pf-player-line-cardy { color: var(--warning, #f59e0b); font-weight: 700; }
.pf-player-line-cardr { color: var(--danger); font-weight: 700; }
.pf-caret { font-size: 16px; color: var(--text-muted); opacity: 0.6; }

/* Footer */
.pf-footer {
  padding: 4px 18px 20px;
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
}
.pf-footer a { color: var(--accent); font-weight: 700; text-decoration: none; }

/* Skeleton */
.pf-skeleton {
  display: flex; flex-direction: column; gap: 14px; padding: 14px 14px;
}
.pf-skel-block {
  border-radius: 12px;
  background: var(--surface);
  animation: pf-pulse 1.4s ease-in-out infinite;
}
@keyframes pf-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

/* Edit sheet overlay */
.pf-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.55);
  z-index: 300;
  display: flex; align-items: flex-end;
}
.pf-sheet {
  width: 100%; max-height: 80vh;
  background: var(--surface);
  border-radius: 22px 22px 0 0;
  padding: 18px 18px calc(20px + var(--safe-bottom, 0px));
  overflow-y: auto;
  display: flex; flex-direction: column; gap: 0;
}
.pf-sheet::before {
  content: ""; display: block;
  width: 48px; height: 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--text) 20%, transparent);
  margin: 0 auto 14px;
}
.pf-sheet-title {
  font-size: 16px; font-weight: 700; color: var(--text);
  margin-bottom: 4px;
}
.pf-sheet-section {
  font-size: 9px; font-weight: 800; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--text-muted);
  margin: 14px 0 6px;
}
.pf-chip-row { display: flex; gap: 6px; flex-wrap: wrap; }
.pf-chip {
  padding: 7px 11px; font-size: 11px; font-weight: 700;
  letter-spacing: 0.08em; border-radius: 8px;
  background: var(--surface-2); border: 1px solid var(--border);
  color: var(--text); cursor: pointer;
}
.pf-chip--active {
  background: var(--accent); color: #fff; border-color: transparent;
}
.pf-chip--pos-gk.pf-chip--active  { background: var(--pos-gk);  color: #3b2a00; }
.pf-chip--pos-def.pf-chip--active { background: var(--pos-def); color: #fff; }
.pf-chip--pos-cdm.pf-chip--active { background: var(--pos-cdm); color: #fff; }
.pf-chip--pos-w.pf-chip--active   { background: var(--pos-w);   color: #fff; }
.pf-chip--pos-st.pf-chip--active  { background: var(--pos-st);  color: #fff; }
.pf-chip--disabled { opacity: 0.4; text-decoration: line-through; cursor: not-allowed; pointer-events: none; }
.pf-sheet-error { font-size: 11px; color: var(--danger); margin-top: 4px; }
.pf-save-btn {
  margin-top: 18px;
  background: var(--accent); color: #fff;
  border: none; border-radius: 12px;
  padding: 13px; font-size: 14px; font-weight: 700;
  letter-spacing: 0.06em; width: 100%; cursor: pointer;
  box-shadow: 0 8px 24px -12px color-mix(in srgb, var(--accent) 60%, transparent);
}
.pf-save-btn:disabled { opacity: 0.5; cursor: default; }

/* League Rules screen */
.lr-screen { padding: 16px 14px; display: flex; flex-direction: column; gap: 14px; }
.lr-nav { display: flex; align-items: center; gap: 12px; padding: 10px 14px 4px; }
.lr-back-btn {
  width: 36px; height: 36px; border-radius: 10px;
  display: grid; place-items: center;
  background: var(--surface); border: 1px solid var(--border);
  color: var(--text); cursor: pointer; font-size: 18px; font-weight: 700;
}
.lr-title { font-size: 18px; font-weight: 700; color: var(--text); }
.lr-card {
  background: var(--surface); border-radius: 14px;
  border: 1px solid var(--border); overflow: hidden;
}
.lr-card-header {
  padding: 12px 14px 6px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.16em;
  text-transform: uppercase; color: var(--text-muted);
  border-bottom: 1px solid var(--border);
}
.lr-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.lr-table th { padding: 8px 14px; text-align: left; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-muted); border-bottom: 1px solid var(--border); }
.lr-table td { padding: 10px 14px; border-bottom: 1px solid var(--border); color: var(--text); vertical-align: top; }
.lr-table tr:last-child td { border-bottom: none; }
.lr-table td:last-child { text-align: right; font-weight: 700; }
.lr-prose { padding: 12px 14px; font-size: 13px; color: var(--text-muted); line-height: 1.6; }

/* Settings — rows */
.st-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid var(--border);
  cursor: pointer; color: var(--text); text-decoration: none; font-size: 14px;
}
.st-row:last-child { border-bottom: none; }
.st-row:hover { background: var(--surface-2); }
.st-row-chevron { color: var(--text-muted); font-size: 14px; }
```

- [ ] **Step 2: Verify the new CSS classes compile (TypeScript build check)**

```bash
cd ffc && npx --yes vite build --mode development 2>&1 | tail -5
```

Expected: No errors. CSS syntax errors show here. Fix any parse errors before proceeding.

- [ ] **Step 3: Commit**

```bash
git add ffc/src/index.css
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "style(profile): add pf-* + lr-* + st-* CSS block to index.css"
```

---

## Task 2: Profile.tsx — types, data layer, skeleton

**Files:**
- Modify: `ffc/src/pages/Profile.tsx` (replace the stub entirely)

- [ ] **Step 1: Replace Profile.tsx with the full skeleton (types + data fetching)**

Write the full file content below. This step establishes all TypeScript types and the data-fetching `useEffect`. The JSX render will just show a loading spinner or error at this point.

```tsx
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/AppContext'
import type { Database } from '../lib/database.types'

/* §3.14 Player Profile — Phase 1 Depth-B slice (S023).
 * Route: /profile?profile_id=<uuid>&season_id=<uuid>
 * When profile_id is absent, defaults to the logged-in user's own profile.
 * When season_id is absent, defaults to the active season (ended_at IS NULL).
 */

type PlayerPosition = Database['public']['Enums']['player_position']
type ThemePreference = Database['public']['Enums']['theme_preference']
type SortKey = Database['public']['Enums']['leaderboard_sort']
type UserRoleEnum = Database['public']['Enums']['user_role']
type MatchResult = Database['public']['Enums']['match_result']
type TeamColor = Database['public']['Enums']['team_color']

interface ProfileData {
  id: string
  display_name: string
  avatar_url: string | null
  primary_position: PlayerPosition | null
  secondary_position: PlayerPosition | null
  theme_preference: ThemePreference
  leaderboard_sort: SortKey
  role: UserRoleEnum
  is_active: boolean
  joined_on: string
}

interface SeasonRow {
  id: string
  name: string
  starts_on: string
  ended_at: string | null
  archived_at: string | null
  created_at: string
}

interface StandingRow {
  wins: number | null
  draws: number | null
  losses: number | null
  goals: number | null
  yellows: number | null
  reds: number | null
  motms: number | null
  late_cancel_points: number | null
  points: number | null
}

interface Last5Row {
  outcome: string | null
  kickoff_at: string | null
}

interface RecentMatchRow {
  team: TeamColor
  goals: number
  yellow_cards: number
  red_cards: number
  matches: {
    id: string
    result: MatchResult | null
    score_white: number | null
    score_black: number | null
    motm_user_id: string | null
    approved_at: string | null
    matchdays: { kickoff_at: string | null } | null
    seasons: { id: string; name: string } | null
  } | null
}

interface BanRow {
  ends_at: string
  revoked_at: string | null
}

interface CareerStats {
  matches: number
  goals: number
  yellows: number
  reds: number
  motms: number
  bestWStreak: number
  bestWStreakSeasonId: string | null
  worstLStreak: number
  worstLStreakSeasonId: string | null
}

/* Compute longest W-streak and L-streak per season (RLE approach).
 * Spec §3.14 Phase 1 note: run in app code since v_player_achievements is Phase 2. */
function computeStreaks(
  rows: RecentMatchRow[],
  viewProfileId: string,
): { bestW: number; bestWSeasonId: string | null; worstL: number; worstLSeasonId: string | null } {
  /* Group all approved matches by season, sorted oldest-first within each season. */
  type MatchOutcome = { outcome: 'W' | 'D' | 'L'; seasonId: string }
  const outcomes: MatchOutcome[] = rows
    .filter((r) => r.matches?.approved_at != null)
    .map((r) => {
      const result = r.matches!.result
      const seasonId = r.matches!.seasons?.id ?? ''
      const kickoff = r.matches!.matchdays?.kickoff_at ?? ''
      let outcome: 'W' | 'D' | 'L' = 'D'
      if (result === 'draw') outcome = 'D'
      else if ((result === 'win_white' && r.team === 'white') || (result === 'win_black' && r.team === 'black')) outcome = 'W'
      else outcome = 'L'
      return { outcome, seasonId, kickoff }
    })
    .sort((a, b) => {
      // sort by season then by kickoff ascending (oldest match first per season)
      if (a.seasonId !== b.seasonId) return a.seasonId.localeCompare(b.seasonId)
      return (a as any).kickoff.localeCompare((b as any).kickoff)
    })

  let bestW = 0; let bestWSeasonId: string | null = null
  let worstL = 0; let worstLSeasonId: string | null = null
  let curW = 0; let curL = 0
  let prevSeason = ''

  for (const m of outcomes) {
    if (m.seasonId !== prevSeason) { curW = 0; curL = 0; prevSeason = m.seasonId }
    if (m.outcome === 'W') { curW++; curL = 0; if (curW > bestW) { bestW = curW; bestWSeasonId = m.seasonId } }
    else if (m.outcome === 'L') { curL++; curW = 0; if (curL > worstL) { worstL = curL; worstLSeasonId = m.seasonId } }
    else { curW = 0; curL = 0 }
  }

  return { bestW, bestWSeasonId, worstL, worstLSeasonId }
}

/* Derive W/D/L outcome for a recent-match row from the viewing profile's perspective. */
function matchOutcome(row: RecentMatchRow): 'W' | 'D' | 'L' {
  const result = row.matches?.result
  if (!result || result === 'draw') return 'D'
  if ((result === 'win_white' && row.team === 'white') || (result === 'win_black' && row.team === 'black')) return 'W'
  return 'L'
}

/* Format a date string (ISO) to DD/MMM/YYYY uppercase per ui-conventions.md */
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const day = String(d.getUTCDate()).padStart(2, '0')
  const mon = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase()
  const yr = d.getUTCFullYear()
  return `${day}/${mon}/${yr}`
}

/* Initials from display_name for avatar fallback. */
function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

const POSITIONS: PlayerPosition[] = ['GK', 'DEF', 'CDM', 'W', 'ST']

export function Profile() {
  const navigate = useNavigate()
  const { profileId: selfProfileId, role: selfRole } = useApp()
  const [searchParams, setSearchParams] = useSearchParams()

  /* Resolve the profile being viewed. */
  const qProfileId = searchParams.get('profile_id')
  const qSeasonId = searchParams.get('season_id')
  const viewProfileId = qProfileId ?? selfProfileId ?? null

  /* Data state */
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [seasons, setSeasons] = useState<SeasonRow[] | null>(null)
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(qSeasonId)
  const [standing, setStanding] = useState<StandingRow | null>(null)
  const [last5, setLast5] = useState<Last5Row[]>([])
  const [recentMatches, setRecentMatches] = useState<RecentMatchRow[]>([])
  const [career, setCareer] = useState<CareerStats | null>(null)
  const [activeBan, setActiveBan] = useState<BanRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /* Edit sheet state */
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editPrimary, setEditPrimary] = useState<PlayerPosition | null>(null)
  const [editSecondary, setEditSecondary] = useState<PlayerPosition | null>(null)
  const [editTheme, setEditTheme] = useState<ThemePreference>('system')
  const [editSort, setEditSort] = useState<SortKey>('points')
  const [posError, setPosError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  /* Season picker */
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerWrapRef = useRef<HTMLDivElement>(null)

  /* Close picker on outside click */
  useEffect(() => {
    if (!pickerOpen) return
    const handler = (e: MouseEvent) => {
      if (pickerWrapRef.current && !pickerWrapRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pickerOpen])

  /* Load seasons once on mount. */
  useEffect(() => {
    supabase
      .from('seasons')
      .select('id, name, starts_on, ended_at, archived_at, created_at')
      .order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (err) return
        const rows = (data ?? []) as SeasonRow[]
        setSeasons(rows)
        if (!selectedSeasonId && rows.length > 0) {
          const active = rows.find((s) => s.ended_at === null && s.archived_at === null)
          setSelectedSeasonId(active?.id ?? rows[0].id)
        }
      })
    // selectedSeasonId intentionally excluded — first-load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Main data load: fires when viewProfileId OR selectedSeasonId changes. */
  useEffect(() => {
    if (!viewProfileId || !selectedSeasonId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    const profileP = supabase
      .from('profiles')
      .select('id, display_name, avatar_url, primary_position, secondary_position, theme_preference, leaderboard_sort, role, is_active, joined_on')
      .eq('id', viewProfileId)
      .single()

    const standingP = supabase
      .from('v_season_standings')
      .select('wins, draws, losses, goals, yellows, reds, motms, late_cancel_points, points')
      .eq('season_id', selectedSeasonId)
      .eq('profile_id', viewProfileId)
      .maybeSingle()

    const last5P = supabase
      .from('v_player_last5')
      .select('outcome, kickoff_at')
      .eq('season_id', selectedSeasonId)
      .eq('profile_id', viewProfileId)
      .order('kickoff_at', { ascending: true })

    const recentP = supabase
      .from('match_players')
      .select(`
        team, goals, yellow_cards, red_cards,
        matches(
          id, result, score_white, score_black, motm_user_id, approved_at,
          matchdays(kickoff_at),
          seasons(id, name)
        )
      `)
      .eq('profile_id', viewProfileId)

    const banP = supabase
      .from('player_bans')
      .select('ends_at, revoked_at')
      .eq('profile_id', viewProfileId)
      .gt('ends_at', new Date().toISOString())
      .is('revoked_at', null)
      .limit(1)
      .maybeSingle()

    Promise.all([profileP, standingP, last5P, recentP, banP]).then(([p, s, l, r, b]) => {
      if (cancelled) return
      if (p.error) { setError(p.error.message); setLoading(false); return }

      const profileRow = p.data as ProfileData
      setProfile(profileRow)

      setStanding(s.data as StandingRow | null)
      setLast5((l.data ?? []) as Last5Row[])

      const allMatches = ((r.data ?? []) as RecentMatchRow[])
        .filter((row) => row.matches?.approved_at != null)
        .sort((a, b) => {
          const ka = a.matches?.matchdays?.kickoff_at ?? ''
          const kb = b.matches?.matchdays?.kickoff_at ?? ''
          return kb.localeCompare(ka)
        })
      setRecentMatches(allMatches.slice(0, 10))

      /* Career aggregates (computed from full allMatches set) */
      const careerGoals = allMatches.reduce((acc, m) => acc + m.goals, 0)
      const careerYellows = allMatches.reduce((acc, m) => acc + m.yellow_cards, 0)
      const careerReds = allMatches.reduce((acc, m) => acc + m.red_cards, 0)
      const careerMotms = allMatches.filter((m) => m.matches?.motm_user_id === viewProfileId).length
      const { bestW, bestWSeasonId, worstL, worstLSeasonId } = computeStreaks(allMatches, viewProfileId)
      setCareer({
        matches: allMatches.length,
        goals: careerGoals,
        yellows: careerYellows,
        reds: careerReds,
        motms: careerMotms,
        bestWStreak: bestW,
        bestWStreakSeasonId: bestWSeasonId,
        worstLStreak: worstL,
        worstLStreakSeasonId: worstLSeasonId,
      })

      setActiveBan(b.data ? (b.data as BanRow) : null)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [viewProfileId, selectedSeasonId])

  /* Seed edit sheet when opening */
  function openSheet() {
    if (!profile) return
    setEditPrimary(profile.primary_position)
    setEditSecondary(profile.secondary_position)
    setEditTheme(profile.theme_preference)
    setEditSort(profile.leaderboard_sort)
    setPosError(null)
    setSheetOpen(true)
  }

  /* Auto-save theme immediately on chip tap */
  async function handleThemeChange(val: ThemePreference) {
    setEditTheme(val)
    if (!selfProfileId) return
    await supabase.from('profiles').update({ theme_preference: val }).eq('id', selfProfileId)
    // Update html class for immediate live effect
    const root = document.documentElement
    root.classList.remove('theme-light', 'theme-dark', 'theme-auto')
    if (val === 'light') root.classList.add('theme-light')
    else if (val === 'dark') root.classList.add('theme-dark')
    else root.classList.add('theme-auto')
  }

  /* Auto-save sort immediately on chip tap */
  async function handleSortChange(val: SortKey) {
    setEditSort(val)
    if (!selfProfileId) return
    await supabase.from('profiles').update({ leaderboard_sort: val }).eq('id', selfProfileId)
  }

  /* Save positions (explicit save button) */
  async function handleSavePositions() {
    if (!editPrimary) { setPosError('Primary position is required'); return }
    if (editPrimary === editSecondary) { setPosError('Primary and secondary must differ'); return }
    setPosError(null)
    setSaving(true)
    const { error: saveErr } = await supabase
      .from('profiles')
      .update({
        primary_position: editPrimary,
        secondary_position: editSecondary ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', selfProfileId!)
    setSaving(false)
    if (saveErr) { setPosError(saveErr.message); return }
    setProfile((prev) => prev ? { ...prev, primary_position: editPrimary, secondary_position: editSecondary ?? null } : prev)
    setSheetOpen(false)
  }

  const isSelf = viewProfileId !== null && viewProfileId === selfProfileId
  const isAdminViewingOther = !isSelf && (selfRole === 'admin' || selfRole === 'super_admin')

  /* Season lookup helpers */
  const selectedSeason = seasons?.find((s) => s.id === selectedSeasonId) ?? null
  const isActiveSeason = selectedSeason ? (selectedSeason.ended_at === null && selectedSeason.archived_at === null) : false

  /* Rank calculation (client-side from standing + season scope) */
  const rankHint: string | null = null // Phase 1: omit cross-profile rank (no full standings query here)

  if (loading || !profile) {
    return (
      <div className="pf-screen">
        <div className="pf-skeleton">
          <div className="pf-skel-block" style={{ height: 72 }} />
          <div className="pf-skel-block" style={{ height: 140 }} />
          <div className="pf-skel-block" style={{ height: 40 }} />
          <div className="pf-skel-block" style={{ height: 160 }} />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="pf-screen" style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ marginBottom: 12 }}>Couldn't load this profile.</div>
        <button
          style={{ padding: '8px 18px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}
          onClick={() => { setError(null); setLoading(true) }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="pf-screen">
      <p style={{ padding: '20px 16px', color: 'var(--text-muted)' }}>Profile loaded: {profile.display_name}</p>
    </div>
  )
}
```

- [ ] **Step 2: Confirm TypeScript compiles with no errors**

```bash
cd ffc && npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors. Fix any type mismatches.

- [ ] **Step 3: Commit**

```bash
git add ffc/src/pages/Profile.tsx
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(profile): data layer skeleton — types, parallel fetch, streak computation"
```

---

## Task 3: Profile.tsx — Hero band + season picker

**Files:**
- Modify: `ffc/src/pages/Profile.tsx`

Replace the placeholder `<p>Profile loaded...` return with the full JSX. Build the hero band and season picker. Keep the rest as stubs for now.

- [ ] **Step 1: Replace the final `return` in Profile.tsx with the hero + season picker JSX**

```tsx
  return (
    <div className="pf-screen">
      {/* === Top nav === */}
      <div className="pf-nav">
        <button className="pf-nav-btn" aria-label="Back" onClick={() => navigate(-1)}>←</button>
        {isSelf && (
          <button className="pf-nav-btn pf-nav-btn--edit" aria-label="Edit profile" onClick={openSheet}>✎</button>
        )}
      </div>

      {/* === Hero band === */}
      <div className="pf-hero">
        {profile.avatar_url ? (
          <img
            className={`pf-avatar${isSelf ? '' : ' pf-avatar--other'}`}
            src={profile.avatar_url}
            alt=""
          />
        ) : (
          <div className={`pf-avatar${isSelf ? '' : ' pf-avatar--other'}`} aria-hidden>
            {initials(profile.display_name)}
          </div>
        )}
        <div className="pf-identity">
          <div className="pf-name-row">
            <span className="pf-name">{profile.display_name}</span>
            {(profile.role === 'admin' || profile.role === 'super_admin') && (
              <span className="pf-role-chip">{profile.role === 'super_admin' ? 'Super Admin' : 'Admin'}</span>
            )}
            {!profile.is_active && <span className="pf-inactive-chip">Inactive</span>}
          </div>
          {profile.primary_position && (
            <div className="pf-pills">
              <span className={`pf-pos pf-pos--fill-${profile.primary_position.toLowerCase()}`}>
                {profile.primary_position}
              </span>
              {profile.secondary_position && (
                <span className={`pf-pos pf-pos--out-${profile.secondary_position.toLowerCase()}`}>
                  {profile.secondary_position}
                </span>
              )}
            </div>
          )}
          {activeBan && (
            <div className="pf-banned-chip" role="status">
              🚫 Banned through {fmtDate(activeBan.ends_at)}
            </div>
          )}
          <div className="pf-joined">Joined {fmtDate(profile.joined_on)}</div>
        </div>
      </div>

      {/* === Season picker === */}
      {seasons && seasons.length > 0 && (
        <div ref={pickerWrapRef} className="pf-season-wrap">
          <button
            className="pf-season-chip"
            onClick={() => setPickerOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
          >
            <span className={`pf-season-dot${isActiveSeason ? '' : ' pf-season-dot--archived'}`} />
            <span>{selectedSeason?.name ?? 'Season'}</span>
            <span className="lb-caret">▾</span>
          </button>
          {pickerOpen && (
            <div className="pf-dropdown" role="listbox">
              {seasons.map((s) => {
                const isOngoing = s.ended_at === null && s.archived_at === null
                const label = isOngoing ? 'Ongoing' : s.archived_at ? 'Archived' : 'Ended'
                return (
                  <div
                    key={s.id}
                    className={`pf-dropdown-item${s.id === selectedSeasonId ? ' pf-dropdown-item--active' : ''}`}
                    role="option"
                    aria-selected={s.id === selectedSeasonId}
                    onClick={() => {
                      setSelectedSeasonId(s.id)
                      setPickerOpen(false)
                    }}
                  >
                    <span>{s.name}</span>
                    <span className={`lb-sheet-badge lb-sheet-badge--${isOngoing ? 'ongoing' : s.archived_at ? 'archived' : 'ended'}`}>
                      {label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Stubs — filled in Tasks 4–7 */}
      <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 12 }}>
        [Season stats, last-5, achievements, recent matches — Tasks 4–7]
      </div>

      {isAdminViewingOther && (
        <div className="pf-footer">
          <Link to="/admin/players">Edit in Admin → Players</Link>
        </div>
      )}
    </div>
  )
```

- [ ] **Step 2: TypeScript check**

```bash
cd ffc && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 3: Start dev server and verify hero renders for your own profile**

```bash
cd ffc && node ./node_modules/vite/bin/vite.js --port 5174
```

Navigate to `http://localhost:5174/profile` — should see: back button, edit pencil (self-view), avatar disc with initials "MM", name "Mohammed Muwahid", position pills (if set), season picker chip. No console errors.

- [ ] **Step 4: Commit**

```bash
git add ffc/src/pages/Profile.tsx
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(profile): hero band + season picker dropdown"
```

---

## Task 4: Season stats card + Last-5 strip

**Files:**
- Modify: `ffc/src/pages/Profile.tsx`

Replace the stub `[Season stats...]` div with the actual cards.

- [ ] **Step 1: Add the `SeasonStatsCard` and `Last5Strip` helper components** (above the `Profile` function in the file)

```tsx
function SeasonStatsCard({
  standing,
  seasonName,
}: {
  standing: StandingRow | null
  seasonName: string | null
}) {
  const wins = standing?.wins ?? 0
  const draws = standing?.draws ?? 0
  const losses = standing?.losses ?? 0
  const goals = standing?.goals ?? 0
  const motms = standing?.motms ?? 0
  const lcp = standing?.late_cancel_points ?? 0
  const points = standing?.points ?? 0
  const mp = wins + draws + losses

  const noData = !standing

  return (
    <div className="pf-card">
      <div className="pf-card-title">
        <span className="pf-card-label">Season stats</span>
        {seasonName && <span className="pf-card-hint">{seasonName}</span>}
      </div>
      {noData && (
        <div style={{ padding: '10px 14px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
          No matches this season yet
        </div>
      )}
      {!noData && (
        <div className="pf-kpi-grid">
          <div className="pf-kpi">
            <span className={`pf-kpi-v${points === 0 ? ' pf-kpi-v--muted' : ''}`}>{points}</span>
            <span className="pf-kpi-l">Points</span>
          </div>
          <div className="pf-kpi">
            <span className={`pf-kpi-v${mp === 0 ? ' pf-kpi-v--muted' : ''}`}>{mp}</span>
            <span className="pf-kpi-l">MP</span>
          </div>
          <div className="pf-kpi">
            <span className="pf-wdl">
              <span className="pf-w">{wins}</span>
              <span className="pf-sep">–</span>
              <span className="pf-d">{draws}</span>
              <span className="pf-sep">–</span>
              <span className="pf-l">{losses}</span>
            </span>
            <span className="pf-kpi-l">W – D – L</span>
          </div>
          <div className="pf-kpi">
            <span className={`pf-kpi-v${goals === 0 ? ' pf-kpi-v--muted' : ''}`}>{goals}</span>
            <span className="pf-kpi-l">Goals</span>
          </div>
          <div className="pf-kpi">
            <span className={`pf-kpi-v${motms === 0 ? ' pf-kpi-v--muted' : ''}`}>{motms}</span>
            <span className="pf-kpi-l">MOTM</span>
          </div>
          <div className="pf-kpi">
            <span className={`pf-kpi-v${lcp === 0 ? ' pf-kpi-v--muted' : ''}`}>{lcp}</span>
            <span className="pf-kpi-l">Late cancel</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Last5Strip({ rows }: { rows: Last5Row[] }) {
  if (rows.length === 0) return null
  return (
    <div className="pf-card">
      <div className="pf-last5">
        <span className="pf-card-label">Last 5</span>
        <div className="pf-last5-strip" aria-label={`Last ${rows.length} results: ${rows.map((r) => r.outcome ?? '?').join(' ')}`}>
          {rows.map((r, i) => {
            const o = (r.outcome ?? 'D') as 'W' | 'D' | 'L'
            return (
              <div key={i} className={`pf-circle pf-circle--${o}`} aria-hidden>
                {o}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Replace the stub comment with the new cards in the main `return`**

Find:
```tsx
      {/* Stubs — filled in Tasks 4–7 */}
      <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 12 }}>
        [Season stats, last-5, achievements, recent matches — Tasks 4–7]
      </div>
```

Replace with:
```tsx
      {/* === Season stats card === */}
      <SeasonStatsCard standing={standing} seasonName={selectedSeason?.name ?? null} />

      {/* === Last-5 strip === */}
      <Last5Strip rows={last5} />

      {/* Stubs — Tasks 5–7 */}
      <div style={{ padding: '0 16px', color: 'var(--text-muted)', fontSize: 12 }}>
        [Achievements, recent matches — Tasks 5–6]
      </div>
```

- [ ] **Step 3: TypeScript check + visual verify in browser**

```bash
cd ffc && npx tsc --noEmit 2>&1 | head -20
```

In browser at `/profile`: Season stats card should show 6 KPIs (Points, MP, W–D–L, Goals, MOTM, Late cancel). For Mohammed with Season 1 data: Points=3, MP=1, W=1 D=0 L=0, Goals=0, MOTM=1. Last-5 strip should show one W circle.

- [ ] **Step 4: Commit**

```bash
git add ffc/src/pages/Profile.tsx
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(profile): season stats card + last-5 strip"
```

---

## Task 5: Achievements card

**Files:**
- Modify: `ffc/src/pages/Profile.tsx`

- [ ] **Step 1: Add the `AchievementsCard` helper component** (above the `Profile` function)

```tsx
function AchievementsCard({
  career,
  seasons,
}: {
  career: CareerStats
  seasons: SeasonRow[]
}) {
  if (career.matches === 0) {
    return (
      <div className="pf-cta-tile">
        <div className="pf-cta-title">Your career starts here</div>
        <div className="pf-cta-sub">Play your first match to unlock stats</div>
        <Link className="pf-cta-btn" to="/poll">RSVP Thursday →</Link>
      </div>
    )
  }

  const wSeasonName = seasons.find((s) => s.id === career.bestWStreakSeasonId)?.name ?? null
  const lSeasonName = seasons.find((s) => s.id === career.worstLStreakSeasonId)?.name ?? null

  return (
    <div className="pf-card">
      <div className="pf-card-title">
        <span className="pf-card-label">Career highlights</span>
      </div>
      <div className="pf-ach-grid">
        <div className="pf-ach-tile">
          <span className="pf-ach-icon">⭐</span>
          <span className="pf-ach-big">{career.motms}</span>
          <span className="pf-ach-lbl">MOTMs</span>
          <span className="pf-ach-ctx">career</span>
        </div>
        <div className="pf-ach-tile">
          <span className="pf-ach-icon">🔥</span>
          <span className="pf-ach-big pf-ach-big--pos">{career.bestWStreak}</span>
          <span className="pf-ach-lbl">W-streak</span>
          <span className="pf-ach-ctx">{wSeasonName ? `${wSeasonName} · best` : 'best'}</span>
        </div>
        <div className="pf-ach-tile">
          <span className="pf-ach-icon">🎯</span>
          <span className="pf-ach-big">{career.goals}</span>
          <span className="pf-ach-lbl">Goals</span>
          <span className="pf-ach-ctx">career total</span>
        </div>
        <div className="pf-ach-tile">
          <span className="pf-ach-icon">🟨</span>
          <span className="pf-ach-big">{career.yellows}</span>
          <span className="pf-ach-lbl">Yellows</span>
          <span className="pf-ach-ctx">career</span>
        </div>
        <div className="pf-ach-tile">
          <span className="pf-ach-icon">🟥</span>
          <span className="pf-ach-big">{career.reds}</span>
          <span className="pf-ach-lbl">Reds</span>
          <span className="pf-ach-ctx">{career.reds === 0 ? 'career · clean' : 'career'}</span>
        </div>
        <div className="pf-ach-tile">
          <span className="pf-ach-icon">📉</span>
          <span className="pf-ach-big pf-ach-big--neg">{career.worstLStreak}</span>
          <span className="pf-ach-lbl">L-streak</span>
          <span className="pf-ach-ctx">{lSeasonName ? `${lSeasonName} · longest` : 'longest'}</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Replace the achievements stub in the main `return`**

Find:
```tsx
      {/* Stubs — Tasks 5–7 */}
      <div style={{ padding: '0 16px', color: 'var(--text-muted)', fontSize: 12 }}>
        [Achievements, recent matches — Tasks 5–6]
      </div>
```

Replace with:
```tsx
      {/* === Achievements card === */}
      {career && seasons && (
        <AchievementsCard career={career} seasons={seasons} />
      )}

      {/* Stubs — Task 6 */}
      <div style={{ padding: '0 16px', color: 'var(--text-muted)', fontSize: 12 }}>
        [Recent matches — Task 6]
      </div>
```

- [ ] **Step 3: TypeScript check + visual verify**

```bash
cd ffc && npx tsc --noEmit 2>&1 | head -20
```

In browser: achievements card should show 6 tiles. For Mohammed with 1 approved match + MOTM: ⭐ 1 MOTMs, 🔥 1 W-streak (Season 1 · best), 🎯 0 Goals, 🟨 1 Yellows, 🟥 0 Reds (career · clean), 📉 0 L-streak.

- [ ] **Step 4: Commit**

```bash
git add ffc/src/pages/Profile.tsx
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(profile): achievements card with client-side streak computation"
```

---

## Task 6: Recent matches list + footer

**Files:**
- Modify: `ffc/src/pages/Profile.tsx`

- [ ] **Step 1: Add the `RecentMatchesList` helper component** (above the `Profile` function)

```tsx
function RecentMatchesList({
  matches,
  viewProfileId,
  onMatchTap,
}: {
  matches: RecentMatchRow[]
  viewProfileId: string
  onMatchTap: (matchId: string) => void
}) {
  if (matches.length === 0) {
    return (
      <div style={{ padding: '0 14px 12px', fontSize: 13, color: 'var(--text-muted)' }}>
        No match history yet.
      </div>
    )
  }

  return (
    <>
      <div className="pf-recent-head">Recent matches</div>
      <div className="pf-recent-list">
        {matches.map((row, i) => {
          const m = row.matches!
          const outcome = matchOutcome(row)
          const kickoff = m.matchdays?.kickoff_at ?? null
          const score = m.score_white != null && m.score_black != null
            ? `${m.score_white} – ${m.score_black}`
            : '? – ?'

          /* Player-line text: goals / MOTM / cards */
          const parts: string[] = []
          if (row.goals > 0) parts.push(`${row.goals} goal${row.goals > 1 ? 's' : ''}`)
          const isMotm = m.motm_user_id === viewProfileId
          const playerLineJSX = (
            <div className="pf-player-line">
              {parts.length > 0 && <span>{parts.join(' · ')}</span>}
              {isMotm && <span className="pf-player-line-motm">{parts.length > 0 ? ' · ' : ''}MOTM ⭐</span>}
              {row.yellow_cards > 0 && <span className="pf-player-line-cardy"> 🟨{row.yellow_cards}</span>}
              {row.red_cards > 0 && <span className="pf-player-line-cardr"> 🟥{row.red_cards}</span>}
            </div>
          )

          return (
            <button
              key={m.id ?? i}
              className="pf-recent-row"
              onClick={() => onMatchTap(m.id)}
              aria-label={`Match on ${fmtDate(kickoff)}: ${outcome === 'W' ? 'Win' : outcome === 'D' ? 'Draw' : 'Loss'}`}
            >
              <div className="pf-date-block">
                <div className="pf-date">{fmtDate(kickoff)}</div>
                {m.seasons?.name && <div className="pf-season-cap">{m.seasons.name}</div>}
              </div>
              <div className={`pf-result-badge pf-result-badge--${outcome}`}>{outcome}</div>
              <div className="pf-match-meta">
                <div className="pf-team-score-row">
                  <span className={`pf-team-chip pf-team-chip--${row.team}`}>
                    {row.team === 'white' ? 'White' : 'Black'}
                  </span>
                  <span className="pf-score">{score}</span>
                </div>
                {playerLineJSX}
              </div>
              <span className="pf-caret">›</span>
            </button>
          )
        })}
      </div>
    </>
  )
}
```

- [ ] **Step 2: Replace the recent matches stub in the main `return`**

Find:
```tsx
      {/* Stubs — Task 6 */}
      <div style={{ padding: '0 16px', color: 'var(--text-muted)', fontSize: 12 }}>
        [Recent matches — Task 6]
      </div>
```

Replace with:
```tsx
      {/* === Recent matches === */}
      {viewProfileId && (
        <RecentMatchesList
          matches={recentMatches}
          viewProfileId={viewProfileId}
          onMatchTap={(id) => navigate(`/match/${id}`)}
        />
      )}

      {/* === Footer === */}
      <div className="pf-footer">
        Joined {fmtDate(profile.joined_on)}
        {' · '}
        <Link to="/leaderboard">View full leaderboard →</Link>
      </div>
```

- [ ] **Step 3: TypeScript check + visual verify**

```bash
cd ffc && npx tsc --noEmit 2>&1 | head -20
```

In browser: For Mohammed with Season 1 data, one match row should appear: date 23/APR/2026 (or whenever seeded), result W, White team, score 3–1, "MOTM ⭐", then "1 card 🟨1". Footer shows "Joined ..." and leaderboard link. Tapping the row navigates to `/match/<id>` (MatchDetail stub).

- [ ] **Step 4: Commit**

```bash
git add ffc/src/pages/Profile.tsx
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(profile): recent matches list + footer"
```

---

## Task 7: Edit sheet (self-view)

**Files:**
- Modify: `ffc/src/pages/Profile.tsx`

- [ ] **Step 1: Add the `EditSheet` helper component** (above the `Profile` function)

```tsx
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'points', label: 'Points' },
  { value: 'wins', label: 'Wins' },
  { value: 'goals', label: 'Goals' },
  { value: 'motm', label: 'MOTM' },
  { value: 'last5_form', label: 'Last 5' },
]

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

function EditSheet({
  editPrimary,
  editSecondary,
  editTheme,
  editSort,
  posError,
  saving,
  onPrimaryChange,
  onSecondaryChange,
  onThemeChange,
  onSortChange,
  onSave,
  onClose,
}: {
  editPrimary: PlayerPosition | null
  editSecondary: PlayerPosition | null
  editTheme: ThemePreference
  editSort: SortKey
  posError: string | null
  saving: boolean
  onPrimaryChange: (v: PlayerPosition) => void
  onSecondaryChange: (v: PlayerPosition | null) => void
  onThemeChange: (v: ThemePreference) => void
  onSortChange: (v: SortKey) => void
  onSave: () => void
  onClose: () => void
}) {
  return (
    <div className="pf-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="pf-sheet" role="dialog" aria-modal aria-label="Edit profile">
        <div className="pf-sheet-title">Edit profile</div>

        {/* Positions */}
        <div className="pf-sheet-section">Primary position *</div>
        <div className="pf-chip-row">
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              className={[
                'pf-chip',
                `pf-chip--pos-${pos.toLowerCase()}`,
                editPrimary === pos ? 'pf-chip--active' : '',
                pos === editSecondary ? 'pf-chip--disabled' : '',
              ].filter(Boolean).join(' ')}
              disabled={pos === editSecondary}
              onClick={() => onPrimaryChange(pos)}
              aria-pressed={editPrimary === pos}
            >
              {pos}
            </button>
          ))}
        </div>

        <div className="pf-sheet-section">Secondary position (optional)</div>
        <div className="pf-chip-row">
          <button
            className={`pf-chip${editSecondary === null ? ' pf-chip--active' : ''}`}
            onClick={() => onSecondaryChange(null)}
            aria-pressed={editSecondary === null}
          >
            None
          </button>
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              className={[
                'pf-chip',
                `pf-chip--pos-${pos.toLowerCase()}`,
                editSecondary === pos ? 'pf-chip--active' : '',
                pos === editPrimary ? 'pf-chip--disabled' : '',
              ].filter(Boolean).join(' ')}
              disabled={pos === editPrimary}
              onClick={() => onSecondaryChange(pos)}
              aria-pressed={editSecondary === pos}
            >
              {pos}
            </button>
          ))}
        </div>

        {posError && <div className="pf-sheet-error">{posError}</div>}

        {/* Theme (auto-saves) */}
        <div className="pf-sheet-section">Theme</div>
        <div className="pf-chip-row">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`pf-chip${editTheme === opt.value ? ' pf-chip--active' : ''}`}
              onClick={() => onThemeChange(opt.value)}
              aria-pressed={editTheme === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Sort (auto-saves) */}
        <div className="pf-sheet-section">Leaderboard sort preference</div>
        <div className="pf-chip-row">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`pf-chip${editSort === opt.value ? ' pf-chip--active' : ''}`}
              onClick={() => onSortChange(opt.value)}
              aria-pressed={editSort === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button
          className="pf-save-btn"
          onClick={onSave}
          disabled={saving || !editPrimary}
        >
          {saving ? 'Saving…' : 'Save positions'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the `EditSheet` rendering to the main `return`** (just before the closing `</div>` of `pf-screen`)

```tsx
      {/* === Edit sheet === */}
      {sheetOpen && (
        <EditSheet
          editPrimary={editPrimary}
          editSecondary={editSecondary}
          editTheme={editTheme}
          editSort={editSort}
          posError={posError}
          saving={saving}
          onPrimaryChange={setEditPrimary}
          onSecondaryChange={setEditSecondary}
          onThemeChange={handleThemeChange}
          onSortChange={handleSortChange}
          onSave={handleSavePositions}
          onClose={() => setSheetOpen(false)}
        />
      )}
```

- [ ] **Step 3: TypeScript check**

```bash
cd ffc && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Test edit sheet in browser**

On `/profile` (self-view): tap edit pencil → sheet opens at bottom. Test:
- Tapping a Primary position chip selects it (colour fills)
- Tapping the same position as Primary in Secondary is greyed out / disabled
- Theme chip tap changes `<html>` class (visible theme shift) 
- Sort chip tap updates selection
- Save button saves positions (check console — should get no Supabase error)
- Tapping the backdrop closes the sheet

- [ ] **Step 5: Ghost profile auto-open edit sheet**

Add a `useEffect` near the other effects in `Profile.tsx`:

```tsx
  /* Ghost profile: auto-open edit sheet on first self-view if positions not set */
  useEffect(() => {
    if (isSelf && profile && !profile.primary_position && !sheetOpen) {
      openSheet()
    }
    // Only fire once after profile loads; not on every re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])
```

- [ ] **Step 6: Commit**

```bash
git add ffc/src/pages/Profile.tsx
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(profile): edit sheet — positions, theme, leaderboard-sort"
```

---

## Task 8: Wire-up leaderboard row-tap + build check

**Files:**
- No file changes — verify end-to-end

- [ ] **Step 1: Test Leaderboard → Profile row tap**

In browser at `http://localhost:5174/leaderboard`:
1. Season 1 is selected
2. Two ranked rows visible (Mohammed + Test Player)
3. Tap Mohammed's row → navigates to `/profile?profile_id=<mm-id>&season_id=<s1-id>`
4. Profile loads with Mohammed's data, Season 1 picker showing
5. Tap Test Player's row → profile loads for Test Player (no edit pencil, no edit button)
6. Season picker works — switching season updates the stats card

- [ ] **Step 2: Run TypeScript + build**

```bash
cd ffc && npx tsc --noEmit 2>&1 | head -30
cd ffc && node ./node_modules/vite/bin/vite.js build 2>&1 | tail -10
```

Expected: Zero TS errors, build succeeds.

- [ ] **Step 3: Commit (if any fixes made)**

```bash
git add -p
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "fix(profile): wire-up Leaderboard row-tap end-to-end"
```

---

## Task 9: League Rules screen

**Files:**
- Create: `ffc/src/pages/LeagueRules.tsx`
- Modify: `ffc/src/router.tsx`
- Modify: `ffc/src/pages/Settings.tsx`

The content is entirely static — no DB query, no state. The penalty values displayed must match `app_settings` rows.

- [ ] **Step 1: Create `ffc/src/pages/LeagueRules.tsx`**

```tsx
import { useNavigate } from 'react-router-dom'

export function LeagueRules() {
  const navigate = useNavigate()
  return (
    <div>
      <div className="lr-nav">
        <button className="lr-back-btn" aria-label="Back" onClick={() => navigate(-1)}>←</button>
        <span className="lr-title">League Rules</span>
      </div>

      <div className="lr-screen">

        {/* Scoring */}
        <div className="lr-card">
          <div className="lr-card-header">Scoring</div>
          <table className="lr-table">
            <thead>
              <tr>
                <th>Result</th>
                <th>Points</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Win</td><td>3 pts</td></tr>
              <tr><td>Draw</td><td>1 pt</td></tr>
              <tr><td>Loss</td><td>0 pts</td></tr>
            </tbody>
          </table>
        </div>

        {/* Late cancellation */}
        <div className="lr-card">
          <div className="lr-card-header">Late cancellation</div>
          <table className="lr-table">
            <thead>
              <tr>
                <th>Timing</th>
                <th>Penalty</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Before roster lock</td><td>No penalty</td></tr>
              <tr><td>After lock, outside 24h of kickoff</td><td>−1 pt</td></tr>
              <tr><td>Within 24h of kickoff</td><td>−1 pt + 7-day ban</td></tr>
            </tbody>
          </table>
        </div>

        {/* No-show */}
        <div className="lr-card">
          <div className="lr-card-header">No-show</div>
          <table className="lr-table">
            <thead>
              <tr>
                <th>Situation</th>
                <th>Penalty</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Rostered, didn't appear</td>
                <td>−2 pts + 14-day ban</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Friendly games */}
        <div className="lr-card">
          <div className="lr-card-header">Friendly games</div>
          <div className="lr-prose">
            If 4 or more external players join a 7v7 matchday, or 3 or more join a 5v5,
            the match is flagged as a friendly. A friendly game doesn't count toward the
            season table, player stats, or match history.
          </div>
        </div>

      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the route in `router.tsx`**

Add `import { LeagueRules } from './pages/LeagueRules'` at the top with the other page imports.

Then inside the `RoleLayout` children array, after `{ path: 'settings', element: <Settings /> }`, add:

```tsx
      { path: 'settings/rules', element: <LeagueRules /> },
```

- [ ] **Step 3: Add the League Rules row to `Settings.tsx`**

Replace the current stub content of `Settings.tsx` with:

```tsx
import { Link } from 'react-router-dom'
import { StubPage } from '../components/StubPage'

export function Settings() {
  return (
    <div>
      <StubPage section="§3.16" title="Settings">
        Theme, push prefs (6 categories), leaderboard sort, display name, account.
      </StubPage>
      <div style={{ marginTop: 16 }}>
        <Link to="/settings/rules" className="st-row">
          <span>League Rules</span>
          <span className="st-row-chevron">›</span>
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: TypeScript check + build**

```bash
cd ffc && npx tsc --noEmit 2>&1 | head -20
cd ffc && node ./node_modules/vite/bin/vite.js build 2>&1 | tail -8
```

Expected: Zero errors. Build passes.

- [ ] **Step 5: Test in browser**

Navigate to `/settings` — see "League Rules" row with chevron. Tap → navigates to `/settings/rules`. Verify all 4 cards render: Scoring, Late cancellation, No-show, Friendly games. Back button returns to Settings.

- [ ] **Step 6: Commit**

```bash
git add ffc/src/pages/LeagueRules.tsx ffc/src/router.tsx ffc/src/pages/Settings.tsx
git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com" commit -m "feat(settings): League Rules static screen at /settings/rules"
```

---

## Task 10: Deploy + acceptance check

- [ ] **Step 1: Push to origin**

```bash
git push origin main
```

- [ ] **Step 2: Wait for Vercel deploy (usually < 60s)**

Monitor via `vercel:status` or check https://ffc-gilt.vercel.app — look for the new deploy.

- [ ] **Step 3: Run acceptance criteria (spec §3.14)**

On production at https://ffc-gilt.vercel.app:

| # | Test | Pass? |
|---|---|---|
| A1 | Leaderboard row tap lands on correct profile + correct season in picker | |
| A2 | Self-view shows edit pencil; Test Player view does not | |
| A3 | Edit sheet: position save → persists on reload; dismiss rollbacks | |
| A4 | Theme chip changes `<html class>` immediately | |
| A5 | Leaderboard-sort chip persists and reflects on next Leaderboard visit | |
| A6 | Last-5 strip scoped to selected season; 24px circles; hidden when 0 | |
| A7 | Season stats grid shows 6 KPIs including MP; rank NOT a KPI tile | |
| A8 | Achievements: 6 tiles + context lines; W-streak positive-tinted, L-streak negative-tinted | |
| A9 | Career-starter CTA shows when career_matches = 0 (test on a fresh profile row if needed) | |
| A10 | Recent matches: last 10 newest-first; DD/MMM/YYYY format | |
| A11 | `/settings/rules` renders 4 rule cards; back button works | |
| A12 | Build has zero TS errors; no console errors in production | |

- [ ] **Step 3: Close session (session log + index + todo + CLAUDE.md update)**

---

## Self-Review Against Spec

**Spec §3.14 gaps check:**
- [ ] Rank hint in card header (top-3 medal / `#N`) — **Phase 1 scope note:** Plan uses `rankHint: null` placeholder. To compute rank, a full standings query for the selected season is needed. This is deferred for now as the spec says "card-header hint" and Phase 1 has 2 players total — the leaderboard tap already gives the rank implicitly. Add rank hint to a follow-up task.
- [x] Self-edit shortcut: pencil opens sheet
- [x] Ghost profile auto-opens sheet (Task 7 Step 5)
- [x] Banned chip in hero (Task 3 Step 1)
- [x] Admin-viewing-other footer link (Task 3 Step 1)
- [x] Zero-match season: "No matches this season yet" (SeasonStatsCard)
- [x] Zero-match career: CTA tile (AchievementsCard)
- [x] W-D-L specificity override in CSS (`.pf-kpi .pf-wdl .pf-w/d/l` block)
- [x] Last-5 circles `letter-spacing: 0` + `line-height: 1` fix
- [x] `flex-shrink: 0` on `.pf-card` and `.pf-ach-tile`
- [x] League Rules screen covers all 4 sections from new spec

**One known partial deferral:** The rank header hint requires scanning all standings rows for the selected season. This needs a second Supabase query (`v_season_standings` for the whole season, then find the viewed profile's rank). This is a small addition — add it in the same session if time permits, or as a quick follow-up. The spec acceptance criterion AC6 requires it.

To add rank hint: in the main data load, add a parallel query:

```ts
const allStandingsP = supabase
  .from('v_season_standings')
  .select('profile_id, points, wins, motms, goals, display_name')
  .eq('season_id', selectedSeasonId)
```

Then compute rank client-side using the same `compareStandings`-style function from Leaderboard (wins → motms → goals → display_name tiebreak). Expose as a `rankNumber: number | null` derived state. Then in `SeasonStatsCard`, pass `rank` and render `rank 1st 🥇 / rank 2nd 🥈 / rank 3rd 🥉 / #N` in the card-hint slot.
