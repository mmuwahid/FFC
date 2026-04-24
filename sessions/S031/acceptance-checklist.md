# S031 Live Acceptance Checklist

**Site:** https://ffc-gilt.vercel.app
**Sign in as:** `m.muwahid@gmail.com` (super_admin / captain)
**Before starting:** hard-refresh once (Ctrl+Shift+R) OR unregister service worker via DevTools → Application → Service Workers → Unregister.

Mark as you go: `[x]` pass · `[!]` fail (add a note) · `[~]` partial/needs-seed.

---

## Pre-flight (one-time)

- [ ] **P1** — `/admin/seasons` → Season 1 → set `planned_games` (e.g. `30`). Without this, Matches banner shows `GAME N` only (no denominator).
- [ ] **P2** — Confirm at least one approved match exists (otherwise `/matches` is empty). If not, seed one via `/admin/matches` → Enter result → Approve.

---

## A · S030 scope — Formation Slices D+E (just shipped)

- [ ] **A1** Captain notes persist — `/match/:id/formation` as captain → type in notes textarea → Save → reload. Text reappears.
- [ ] **A2** Share to team — same screen → click `Share to team` (visible after first Save). Footer flips to `Shared · last synced HH:MM`; button relabels to `Re-share`.
- [ ] **A3** Realtime cross-device — Device 1 (captain) Save; Device 2 (teammate on same team) sees update without reloading.
- [ ] **A4** Non-captain read-only — teammate opens `/match/:id/formation`; textarea is disabled, no Save button.
- [ ] **A5** Poll State 8 CTA — `/poll` after teams revealed. Captain sees `🧩 Plan formation`; teammate sees `🧩 View team formation`. Click navigates.
- [ ] **A6** AdminMatches Formation button — `/admin/matches` → matchday card with a match row → `🧩 Formation` button present, navigates.
- [ ] **A7** MatchDetailSheet View formation — `/matches` → tap row → sheet footer has `🧩 View formation`; click dismisses sheet + navigates.

---

## B · S029 scope — Matches flashcard + AdminSeasons

- [ ] **B1** AdminSeasons list + create — `/admin/seasons` lists existing; `+ New season` creates one.
- [ ] **B2** Inline `planned_games` edit — same page → edit value → save persists.
- [ ] **B3** Matches banner `GAME N / TOTAL` — `/matches` after P1 is set. Banner shows `GAME N / TOTAL`. With `planned_games` NULL → `GAME N` only.
- [ ] **B4** Split-colour flashcard — WHITE half + BLACK half; winner bright, loser dim; `WINNER` ribbon on winning side; `DRAW` pill on tie.
- [ ] **B5** Scorers per team + HAT pill — one row per scorer per team; hat-trick renders pink `HAT` pill.

---

## C · S028 scope — Phase 5.5 overrides + Formation A/B/C

- [ ] **C1** Phase 5.5 Force complete — needs seeded `draft_sessions.status='in_progress'` older than stuck threshold. Button enabled; click auto-distributes unpicked players alternating teams. _(Say the word if you want the seed SQL.)_
- [ ] **C2** Phase 5.5 Abandon — same card. Click flips status, keeps draft_picks audit trail.
- [ ] **C3** Formation pattern picker — `/match/:id/formation` as captain. 9 presets selectable (6 × 7v7 + 3 × 5v5); pitch updates on selection.
- [ ] **C4** Drag + custom — pointer-drag slot token; pattern chip auto-flips to `custom`; `Reset to {named}` returns to last named preset.
- [ ] **C5** Rotating GK — toggle `Rotate every 10 min`. Native select lists `profiles` only (guests excluded). GK badge + rotation numbers appear on tokens + roster.

---

## D · S026 scope — Poll Depth-B + Leaderboard gate + edits + friendly

- [ ] **D1** Poll 9 states render — `/poll` across the cycle: pre-open / not-voted tri-button / confirmed #N / waitlisted / roster-locked / State 6.5 draft-in-progress / State 8 teams-revealed / penalty sheet. _(Some need specific DB state — say the word for seed SQL.)_
- [ ] **D2** Guest invite — Poll → `+1 guest` action (available when guest slot open). 5 chip groups required + optional description; submits.
- [ ] **D3** Leaderboard realtime / PTR / skeleton — `/leaderboard` stays open in tab A; approve a new match from tab B. Row animates without reload. Pull-to-refresh works on touch with resistance curve. Initial load shows shimmer skeleton for ≥150 ms.
- [ ] **D4** `✎ Edit player stats` toggle — `/admin/matches` → past matchday → Edit result → toggle reveals per-player goals/🟨/🟥/(C)/NS inputs + dirty counter. Save calls `edit_match_players`.
- [ ] **D5** Phase 5.5 card — with a seeded `draft_sessions.status='in_progress'` row, AdminMatches shows amber pulsing card with elapsed time + picker team + captain name.
- [ ] **D6** Friendly auto-flag — insert 4 active guests on a 7v7 matchday (or 3 on 5v5). `matchdays.friendly_flagged_at` auto-stamps; AdminMatches review card turns amber.

---

## Reporting

Say results like `A1 PASS`, `B4 FAIL — winner ribbon missing`, `D1 PARTIAL — need State 6.5 seed`. I'll triage live.
