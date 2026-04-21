### 3.19 — Formation planner (NEW in S009 — Phase 1, Depth B)

**Status:** DRAFT — S009, 20/APR/2026 (pending user approval of v1 mockup).

---

**Purpose.**
Give each team's captain a lightweight, top-down tactical board to (a) pick a common 7v7 formation pattern, (b) drag their 6 outfield players + 1 GK into positions, and (c) share the layout with their team. Non-captains on the same team see a read-only, live-updating version so everyone arrives Thursday already knowing their shape. Ship intentionally below FIFA/FPL complexity — this is a pre-match nudge, not a tactical analytics tool.

---

**Entry points.**

1. **Home tab — Matchday card CTA.** `[ Plan formation ]` button on the active matchday card. Captain-only. Visible from `kickoff_at − 24h` until `kickoff_at`. Before 24h window opens, CTA shows as disabled with tooltip "Opens 24h before kickoff".
2. **Push notification `formation_reminder`.** Fired 24h before kickoff to both captains. Tap deep-links to §3.19 in edit mode.
3. **Non-captain entry — Matchday card "View formation" link.** Appears for non-captain team members only after their captain has fired `share_formation` (i.e. `formations.shared_at IS NOT NULL`). Before share, no entry point is shown.
4. **Deep link from §3.15 Match detail (Phase 2 deferred).** For completed matchdays, tapping a team's formation thumbnail opens §3.19 in archival read-only.
5. **Team-chat attachment (Phase 2 deferred).** Attach formation as shareable card when chat feature lands.

---

**Data required (read).**

- `matchdays` — `id`, `kickoff_at`, `captain_white_profile_id`, `captain_black_profile_id`, `teams_locked_at`.
- `match_players` — filtered to the captain's team for this matchday; joined with `profiles` for `display_name`, `avatar_initials`, `preferred_position`.
- `match_guests` — also filtered to captain's team; used so guests appear as draggable tokens too.
- `formations` — **NEW table** (see §2.3 amendment required in S009 masterplan V2.7):
  ```
  formations (
    id                uuid pk,
    matchday_id       uuid fk matchdays,
    team              text check (team in ('white','black')),
    pattern           text check (pattern in ('2-3-1','3-2-1','2-2-2','3-1-2','2-1-3','1-3-2','custom')),
    layout_jsonb      jsonb not null,           -- [{player_id, kind:'member'|'guest', x, y, pos_label}]
    last_edited_by    uuid fk profiles,
    last_edited_at    timestamptz not null default now(),
    shared_at         timestamptz,              -- null until captain hits Share
    created_at        timestamptz not null default now(),
    unique (matchday_id, team)
  );
  ```
  RLS: any member of `match_players` for that matchday can `select`. Only the corresponding captain can `insert/update` (enforced via RPC, not direct write).

---

**Data mutations (write).**

1. **`upsert_formation(p_matchday_id, p_team, p_pattern, p_layout_jsonb) → formations.id`** — NEW `security definer` RPC. Validates: caller is the captain of `p_team` for `p_matchday_id`; layout contains exactly 7 tokens; exactly 1 token has `pos_label='GK'`; no duplicate `player_id` in layout; every `player_id` exists in `match_players` or `match_guests` for this team. On success upserts by `(matchday_id, team)`, bumps `last_edited_by/at`, does NOT touch `shared_at`.
2. **`share_formation(p_formation_id) → void`** — sets `shared_at = now()`, triggers `notify_formation_shared(formation_id)` Edge Function → pushes `formation_shared` notification to every non-captain member of that team (respecting their push prefs from §Settings).
3. **Realtime broadcast.** Row-level postgres_changes on `formations` — app subscribes for UPDATE where matchday_id/team matches.

---

**Layout (ASCII).**

```
┌──────────────────────────────────────────────┐
│ ← Back   Formation · WHITE team         ⇪ ⓘ │  ← top nav. Share icon captain / label non-captain
├──────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────┐ │
│ │ 2-3-1  [3-2-1]  2-2-2  3-1-2  2-1-3  1-3-2│ │  ← pattern chip row, horizontally scrollable
│ │                                    Custom │ │     (bracketed = active)
│ └──────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│ ╔════════════════════════════════════════╗   │
│ ║            ●──── own goal ───●         ║   │  ← pitch SVG, 2:3 ratio, top-down
│ ║                  ( GK )                ║   │     own goal at TOP (defending)
│ ║                                        ║   │
│ ║    ( D )          ( D )    ( D )       ║   │
│ ║                                        ║   │
│ ║       ( M )           ( M )            ║   │
│ ║                                        ║   │
│ ║                ( ST )                  ║   │
│ ║                                        ║   │
│ ║            ●── attack goal ──●         ║   │
│ ╚════════════════════════════════════════╝   │
├──────────────────────────────────────────────┤
│ BENCH / UNASSIGNED                           │
│ [ OK ]  [ BK ]    (tokens waiting to drop)   │
├──────────────────────────────────────────────┤
│ ROSTER (7)                                   │
│ · Omar Khan          DEF    [placed]         │
│ · Bilal Khalid       GK     [placed]         │
│ · Adil Rahman        MID    [unplaced]       │
│ · …                                          │
├──────────────────────────────────────────────┤
│ Captain's notes (optional)                   │
│ ┌──────────────────────────────────────────┐ │
│ │ Press high from kickoff. Omar drops if…  │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ [ Share with team ]             (primary)    │  ← disabled until layout valid
└──────────────────────────────────────────────┘
```

Wide viewport (≥768px, Phase 2): pitch centre column, roster list becomes right sidebar.

---

**Pattern presets — exact coordinates.**

Coordinates are `(x%, y%)` on the pitch SVG, where `(0,0)` is top-left, `(100,100)` bottom-right. Own goal at top (`y=0`), attacking goal at bottom (`y=100`). GK always near y≈8.

| Pattern | GK | Defence row | Midfield row | Attack row |
|---------|----|----|----|----|
| **2-3-1** Defensive | (50, 8) | (35, 28) · (65, 28) | (25, 52) · (50, 52) · (75, 52) | (50, 78) |
| **3-2-1** Balanced def | (50, 8) | (25, 28) · (50, 28) · (75, 28) | (35, 52) · (65, 52) | (50, 78) |
| **2-2-2** Balanced | (50, 8) | (35, 28) · (65, 28) | (35, 52) · (65, 52) | (35, 78) · (65, 78) |
| **3-1-2** Attack from def | (50, 8) | (25, 28) · (50, 28) · (75, 28) | (50, 52) | (35, 78) · (65, 78) |
| **2-1-3** Offensive | (50, 8) | (35, 28) · (65, 28) | (50, 52) | (25, 78) · (50, 78) · (75, 78) |
| **1-3-2** Winger-heavy | (50, 8) | (50, 28) | (20, 52) · (50, 52) · (80, 52) | (35, 78) · (65, 78) |
| **Custom** | free | free | free | free |

**Judgement calls.** (a) GK y=8 rather than y=4 — leaves visual breathing room between token and goal line. (b) Wings pulled to x=20/80 on 1-3-2 rather than 15/85 — avoids token clipping against pitch sideline. (c) Defenders sit at y=28 (not y=20) — a flat deep line looked passive/unrealistic; 28 reads like a modern high line.

---

**Drag-drop behaviour.**

- **Long-press (300ms) lifts** the token — slight scale(1.08), elevated shadow, haptic tick on supported devices.
- **Drag preview** follows pointer/finger. Original position shows dashed outline.
- **Drop-zone highlight.** Under the dragged token, the nearest 5% grid cell glows `--accent` at 0.3 opacity.
- **Release snaps** to that cell. Coordinates clamped to `(5..95, 5..95)`.
- **Auto position label.** On drop, `pos_label` is recomputed from `y`:
  - `y < 15` → `GK` (only allowed if token is the GK; else release rejected with shake)
  - `15 ≤ y < 40` → `DEF`
  - `40 ≤ y < 65` → `MID`
  - `y ≥ 65` → `ATT`
- **Swap on conflict.** Drop on an occupied cell swaps the two tokens.
- **Pattern preset drop.** Tapping a preset chip re-arranges tokens into preset slots, preserving current assignments where possible (GK stays GK; remaining tokens fill by current `y` order). Moves are animated (180ms, ease-out).
- **Custom mode** skips auto-snap refactor when switching patterns — tokens stay wherever the captain left them.

---

**Captain vs non-captain rendering.**

| Surface | Captain | Non-captain (shared) | Non-captain (not yet shared) |
|----|----|----|----|
| Pattern chip row | interactive | hidden | no screen access |
| Pitch tokens | drag-enabled | static, no drag | — |
| Token drop zones | shown on drag | none | — |
| Bench strip | shown if tokens unplaced | hidden if 7 placed | — |
| Roster list | shows `[placed/unplaced]` state | plain list with position label | — |
| Captain's notes | editable textarea, 280 chars | read-only quoted block | — |
| Share button | `[Share with team]` / `[Reshare update]` after first share | replaced with "Shared by Capt {name} · {DD/MMM HH:mm}" header | — |
| Last-edited hint | "Edited {relative time}" | same, pulls from realtime | — |

---

**Realtime.**

App subscribes to Supabase realtime channel `formations:matchday_id={id}:team={team}`. Events handled:
- `UPDATE`: patch local state; animate moved tokens (200ms).
- New `shared_at` value: non-captain auto-transitions from "no access" gate to full read-only view; one-time toast "Captain {name} shared the formation".
- **Target latency: < 2s** from captain save to non-captain visible update.
- **Offline fallback.** Non-captain shows last cached layout with "Last synced {HH:mm}" footer chip until reconnect.

---

**Theme, position, safe-area.**
Cross-ref §3.0.
- Pitch background: `--pitch-bg` (light = `#2d7a3f` muted green; dark = `#1a4529` deeper green).
- Pitch lines: `rgba(255,255,255,0.55)` both themes.
- Token base: team colour — White team tokens = `--paper` with 2px `--ink` border; Black team tokens = `--ink` with 2px `--paper` border (inverted in dark mode).
- GK token: outlined in `--pos-gk` gold regardless of team.
- All fixed/absolute elements (top-nav, tabbar, share sticky CTA) honour `env(safe-area-inset-*)` per S009 Rule #10 retrofit.

---

**Acceptance criteria.**

1. Captain can tap a pattern chip and see all 7 tokens animate into the preset positions within 200ms.
2. Captain can drag any token to any valid cell; GK cannot be dropped outside `y<15`; non-GK cannot be dropped in `y<15`.
3. Share CTA is disabled unless layout is valid (7 tokens, exactly 1 GK, no overlaps).
4. Share CTA writes `shared_at` and fires push to every non-captain team member who has `push_prefs.formation_shared = true`.
5. Non-captain on same team sees the shared layout within 2s of captain save (realtime), validated on flaky 3G.
6. Non-captain cannot drag, cannot change pattern, cannot edit notes.
7. Opposing team (Black viewer on White formation) cannot see any layout — RLS blocks the read.
8. Concurrent edits by the same captain on two devices: last writer wins; the other device receives realtime update within 2s and shows a brief "Updated elsewhere" toast.
9. Captain can reshare after edits; `shared_at` updates, non-captains get an updated toast (throttled — max one toast per 60s).
10. Offline captain sees local edits persisted to IndexedDB; reconnect replays via `upsert_formation`.
11. Every token is reachable and activatable via keyboard (tab + space to lift, arrow keys to move in 5% increments) for accessibility baseline.
12. All safe-area insets respected on iPhone 14 Pro hardware — nothing clips under Dynamic Island or home indicator.

---

**Error / loading states.**

- **Teams not yet locked** (`teams_locked_at IS NULL`): show empty-state "Teams lock after poll closes. Come back then." with clock illustration. Pattern picker and pitch hidden.
- **Roster incomplete** (<7 on captain's team): banner "Only {n}/7 confirmed. You can still plan but share is locked until 7 are set." Share CTA disabled.
- **Captain swap edge case.** If admin reassigns captaincy mid-edit, existing captain's next `upsert_formation` returns `403 not_captain`; screen hot-swaps to read-only with toast "You are no longer captain for this team".
- **Concurrent two-captain edit.** Shouldn't happen (unique captain per team) but guarded: latest `last_edited_at` wins.
- **Network error on save.** Inline banner "Couldn't save — retry" with explicit retry button. Tokens stay in place; no silent loss.
- **Realtime disconnect (non-captain).** Banner "Live updates paused" until reconnect.

---

**Phase-2 deferred.**

- Multiple saved formations per team / template library.
- Formation history browser (view all past formations this season on §3.14 profile).
- Animated transitions between in-match formation changes (e.g. switch from 3-2-1 to 2-3-1 at 20').
- Opposing-team awareness (show opponent's shared formation side-by-side).
- Set-piece markers (corner routines, free-kick walls).
- Preferred-foot indicators on tokens.
- Partner-up/coordination lines between defenders or midfielders.
- Video analysis link-out.
- Captain voice-note instructions.
- Wide viewport (≥768px) two-column layout — ships when web kiosk surface lands.
