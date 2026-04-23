# S024 Session Log — 23/APR/2026 (Work PC)

## Summary

Long multi-slice session. S023 acceptance pass completed end-to-end (Profile, Rules, Matches friendly panel). League Rules content expanded into 6 cards (Scoring restructured + Dropping out with 5-tier penalty table + new Kick-off, Cards, Awards cards). Two new screens shipped: §3.20 Matches list (new bottom-nav tab) + §3.15 Match Detail bottom-sheet overlay. §3.16 Settings full Depth-B replacement (6 rows + 2 permission tiles, with new migration 0015 for profiles.push_prefs jsonb). AdminPlayers Active+Rejected tabs enriched (position pills, reject reasons).

## What Was Done

### Slice 0 — S023 acceptance pass
A1–A9 ALL PASSED against prod.
- A1: Leaderboard row tap → `/profile?profile_id=&season_id=` correct params ✓
- A2: Self-view edit pencil → sheet saves positions/theme/sort ✓
- A3: Other-view no pencil; Admin-view shows "Edit in Admin → Players" footer link ✓
- A4: Season picker dropdown opens + rank hint shows ✓
- A5: Last-5 strip scoped correctly ✓
- A6: Achievements card 6 tiles with contextual subtitles ("career · clean" vs "career"; "best" vs "Season 1 · best") ✓
- A7: Recent matches — correct W/D/L, score, goals, MOTM, cards per-player ✓
- A8: Rules screen rendered then EXPANDED with user feedback mid-session
- A9: AdminMatches friendly-review panel end-to-end — seeded flag → amber chip → Dismiss RPC → clean state ✓

### Slice 1 — Rules expansion
Commits `0c027df` + `840b572`. Content changes to `Rules.tsx` + CSS:
- Scoring: 2-col table → 3-col horizontal grid (Win/Draw/Loss labels over point values)
- Late cancellation → renamed "Dropping out", expanded to 5-tier table
- NEW Kick-off card (8:15pm/9:30pm, arrival penalties, waiting-list note)
- NEW Cards card (1st yellow warning / 2nd yellow / straight red)
- NEW Awards card (8 awards incl. Ballon d'Or = most MOTMs)
- Friendly games card retained
- Follow-up tweaks: `.lr-card-header { text-align: center }` + `.lr-table th:last-child { text-align: right }`

### Slice 2 — §3.20 Matches + §3.15 Match Detail sheet
Commit `e1e9d19`. Two new screens:
- **Matches.tsx** — new `/matches` route, season picker (anchored dropdown), chronological list, tap → sheet. Empty state + loading skeleton. Friendly matchdays excluded client-side.
- **MatchDetailSheet.tsx** — read-only bottom-sheet overlay (createPortal). WHITE + BLACK rosters with captain (C) markers, position pills, inline goals/yellows/reds/MOTM star. Guest rows italic + gold avatar + "+1 · invited by" subtitle. Optional W/D/L chip when `profileId` prop passed. Dismiss via scrim/grabber/Esc. Safe-area aware.
- **Wire-ups:** new `/matches` route in router.tsx; new Matches tab in RoleLayout (5th player / 6th admin); Profile.tsx Recent Matches refactored `navigate('/match/:id')` → `setOpenMatchId()` sharing same sheet component.
- **Mockup:** `mockups/3-20-matches.html` new; `mockups/3-15-match-detail.html` reused from S012.
- **Schema drift handled:** `matchdays.venue` (not `venue_label`); matchday_number computed client-side from season matchdays ordered asc; `match_players.late_cancel_*` columns absent — late-cancel strip deferred to when columns land.

### Slice 3 — §3.16 Settings full
Commit `590fcc0`. Migration 0015 + full Settings replacement.
- **Migration 0015** (`profiles.push_prefs jsonb NOT NULL DEFAULT`) — 7 keys (master + 6 events). Existing rows auto-fill. Applied via `supabase db push`.
- **Settings.tsx** replaces stub with Depth-B:
  - Row 1 Theme (Light · Dark · System) — auto-save + `<html>` class swap
  - Row 2 Push notifications — master pill + 6 child pills. Master OFF greys children but preserves values (spec AC5). First toggle-ON while `permission=default` fires `requestPermission()`. Legacy `position_changed` key normalised out on read.
  - Row 3 Leaderboard sort (Points · W · Goals · MOTM) — auto-save
  - Row 4 Positions — inline primary/secondary dropdowns; secondary auto-clears when equals new primary (matches DB CHECK)
  - Row 5 Display name — input + Save, regex `[A-Za-z0-9 .'\-]{2,30}`, case-insensitive uniqueness ILIKE pre-check, shake + inline error on conflict
  - Row 6 Account — email read-only, Sign out button, Delete (coming-soon toast)
  - Bottom link preserved: League Rules → `/settings/rules`
- **State tiles:**
  - Tile 1 (permission=default, session-dismissible): Enable / Not now
  - Tile 2 (permission=denied, persistent): forces master OFF + disabled
- **CSS:** `.st-*` namespace expanded extensively.

### Slice 4 — AdminPlayers enrichment
Commit `c8cb463`. Read-only polish — no new RPCs.
- Active tab rows: position pills (primary filled / secondary outlined) + amber `inactive` chip when `is_active=false`.
- Rejected tab rows: show `reject_reason` inline (italic muted) below the name.
- Full edit/ban admin flow (needs `update_player_profile` + `ban_player` RPCs in migration 0016) scoped for S025.

## Commits (5 this session)
```
c8cb463 feat(admin-players): enrich Active + Rejected rows
590fcc0 feat(settings): §3.16 full Settings — 6 rows + push-permission tiles
e1e9d19 feat(matches): §3.20 Matches list + §3.15 Match Detail sheet
840b572 style(rules): center card headers + right-align penalty/consequence th
0c027df feat(rules): expand League Rules — 6 cards incl. Kick-off, Cards, Awards
```

## Live state after S024
- Live: https://ffc-gilt.vercel.app
- Tip of `main`: `c8cb463` (+ close commit)
- Migrations on live DB: 15 (0001 → 0015_push_prefs)
- Active routes: `/poll` · `/leaderboard` · `/matches` (NEW) · `/profile` · `/settings` (full Depth-B now) · `/settings/rules` · `/admin/*`
- Player bottom-nav: 5 tabs (Home · Table · Matches · Profile · Settings)
- Admin bottom-nav: 6 tabs (+ Admin)

## Deferred (open for S025)
- **Acceptance pass** of all S024 screens on prod — user explicitly asked for a dedicated session to test everything at once.
- **§3.17 AdminPlayers full edit/ban** — needs migration 0016 with `update_player_profile` + `ban_player` + `unban_player` RPCs (all calling `log_admin_action` into `admin_audit_log`). Then wire edit sheet (name/positions/is_active/role elevation) + ban action (reason + end matchday picker).
- **§3.18 AdminMatches full matchday CRUD** — 7 phases: create matchday (format chip 7v7/5v5 · venue · kickoff_at · poll window) → open/close poll → roster lock → result entry (score_white/score_black + goals per player + yellows/reds) → MOTM pick → approve. Plus per-row no-show toggle on result entry (data model already live from 0013).
- **§3.5 +1 guest slot auto-friendly flag** — write `friendly_flagged_at = now()` when guest count crosses threshold (4 per 7v7, 3 per 5v5). Blocked on Poll screen guest-add flow.
- **§3.7 Poll Depth-B** — multi-session; blocked on §3.18 admin-create-matchday tooling.
- **Palette re-align** (red+navy → khaki-gold + cream).
- **Vector FFC crest SVG** (user exports from Illustrator/Figma).

## Notes / gotchas reinforced
- **`.claude/launch.json` mockup preview path** — rooted at `mockups/`, so preview URL is `http://localhost:5173/3-20-matches.html` NOT `/mockups/3-20-matches.html`.
- **S011 statusbar `flex-shrink: 0` fix** applied verbatim in new Matches mockup.
- **Supabase MCP still PadelHub-scoped** → `npx --yes supabase@latest db query --linked` / `db push --linked` throughout.
- **`supabase gen types typescript --linked 2>/dev/null`** — stderr suppression still mandatory.
- **Schema drift discovery pattern** — always query `information_schema.columns` BEFORE writing PostgREST embeds. This session caught three drifts (venue vs venue_label, no matchday_number column, no late_cancel_* columns).
- **Positions enum uses UPPERCASE values** (`GK`, `DEF`, `CDM`, `W`, `ST`) — TS caught the lowercase attempt in Settings.tsx build.
- **Leaderboard sort enum value is `motm` not `motms`** — TS caught this too.
