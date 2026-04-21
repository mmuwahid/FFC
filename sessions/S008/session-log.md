# Session Log — 20/APR/2026 — S008 — Cold-start + 4 decisions locked + safe-area research

**Project:** FFC — Friends Football Club
**Type:** Plan
**Phase:** Phase 1 Design (Depth B) — screens + data-model refinement
**PC:** Work (`UNHOEC03`)
**Duration:** Short (<15 min)
**Commits:** N/A (non-repo OneDrive workspace; no code yet)

---

## What Was Done

### Cold start
- Invoked `anthropic-skills:session-resume`. Read `CLAUDE.md`, `tasks/todo.md` NEXT SESSION block, `sessions/INDEX.md`, and the tail of the Phase 1 design spec (§3.7 Poll screen lines 1380–1516, §3.15 Match-detail stub lines 1826–1872).
- Produced cold-start briefing: S007 outcome summary · S008 priority-ordered plan (1 Settings · 2 §3.15 · 3 §2.7 RPCs · 4 admin Players+Matches · 5 poll team-colour decision · 6 close) · durable-rules reminder · open decisions.
- User opted to start with item 1 AND tackle remaining open items, beginning with the two pending design decisions (§3.7 team-colour preview + §3.15 scope).

### Decisions framed for user (presented — awaiting answers)

**1. §3.7 Poll team-colour preview (S005 open).**
Three options surfaced:
- **A — Land as §3.7 state 8 "Teams revealed".** Adds `You're on ⚪ White / ⚫ Black` row to VOTE STATUS CARD once `match_players.team` is populated · also paints `[W]/[B]` pills on every roster row.
- **B — Defer to Phase 2 explicitly.** Close the open item. Rationale: competes with Phase-2 match-prep bundle (teams + captains + kit) which owns the reveal moment.
- **C — Hybrid.** Viewer-only team chip on their own status card · no per-row pills for others · match-prep still owns the full team reveal. Assistant's recommendation.
- Data availability: zero new data needed · `match_players.team` populated at team-entry step already.

**2. §3.15 Match-detail sheet scope confirmation.**
Reproduced the STUB's locked content in a table (container · entry · header strip · MOTM row · White/Black rosters · late-cancel strip · footer · data sources · out-of-scope). Surfaced three sub-decisions needed before full Depth-B write:
- **Sub-Q1:** W/D/L chip perspective on non-viewer profiles — neutral "Final" vs profile-owner's perspective (assistant leans profile-owner).
- **Sub-Q2:** Guest row stats visibility — full S007 rating chip + description (poll-screen parity) vs lighter (name + pills + goals/cards only). Assistant leans lighter here.
- **Sub-Q3:** Wide-viewport sheet sizing — ≥768px → max 640px wide · 80% height?

**3. Settings screen scope confirmation (item 1).**
Confirmed scope from `tasks/todo.md`: 5 rows (Theme · Push prefs · Leaderboard sort · Positions re-entry · Account). Raised two questions before drafting:
- **Q1:** Additional candidates — display-name/avatar shortcut · about/version · terms/privacy links · data-export request (Phase 2?).
- **Q2:** Second state tile — drop "signed-out" (Settings auth-gated per §3.0) and replace with first-visit push-permission-prompt tile?

### Decisions returned by user (post-framing)
After the initial framing, user provided answers for all three queued decisions AND added a new platform concern:

- **§3.7 poll team-colour preview → OPTION A.** Full state 8 — VOTE STATUS CARD gains `You're on ⚪ White / ⚫ Black` row **and** per-row `[W]/[B]` pills on every roster member + guest. Triggers when `match_players.team` rows exist for the active matchday. Closes the S005 open item.
- **§3.15 match-detail sheet:**
  - **Sub-Q1 (W/D/L perspective): profile-owner's perspective** (not neutral "Final"). When viewing someone's profile, the chip reflects their outcome in that match.
  - **Sub-Q2 (guest stats): lighter — player match stats only** (goals/cards inline same as members). S007 rating chip + description do NOT render in the match-detail sheet — those stay poll-screen recruitment context. Guest rows keep their italic + gold-avatar visual distinction.
  - **Sub-Q3 (wide-viewport sizing): approved pending HTML check** — ≥768px → max 640w × 80vh provisionally locked; user will verify in the S009 mockup.
- **Settings screen:**
  - **Q1: Add display-name row.** Other candidates (about/version, T&P, data-export) deferred to Phase 2+.
  - **Q2: Replace signed-out tile with first-visit push-permission-prompt tile** (Settings is auth-gated per §3.0 — a signed-out state is unreachable). Deferred to assistant's judgment.
- **NEW — iPhone camera / notch handling.** User flagged that the PWA must render dynamically around the notch/Dynamic Island, not behind it. Research performed (see `_wip/iphone-safe-area-research.md`) — findings:
  - Single meta tag (`viewport-fit=cover`) + CSS `env(safe-area-inset-*)` covers notch + Dynamic Island + home-indicator on all iPhones.
  - Dynamic Island uses the same `env(safe-area-inset-top)` value as the classic notch — no special handling needed.
  - CLAUDE.md Rule #10 already commits us to safe-area handling at spec level (inherited from PadelHub).
  - **GAP DISCOVERED:** all five approved S005–S007 mockups (Poll, Leaderboard, Profile, Captain helper, Welcome) use plain `padding-top`/`padding-bottom` — **none** currently reference `viewport-fit=cover` or `env(safe-area-inset-*)`. Will render behind the notch on real iPhones. Retrofit action added to S009 plan.

---

## Files Created or Modified
- `sessions/S008/session-log.md` — this file (new).
- `sessions/INDEX.md` — S008 row added, Next-session pointer bumped to S009.
- `tasks/todo.md` — header moved to "NEXT SESSION — S009 (home PC)"; S008 tasks marked complete (decisions captured); mockup safe-area retrofit added to S009 plan.
- `CLAUDE.md` — Latest-session block bumped to S008 with all 4 decisions locked; NEXT marker rewritten for S009.
- `_wip/iphone-safe-area-research.md` — **new** research writeup: meta-viewport config, CSS `env()` pattern, Dynamic Island specifics, manifest/theme-color, gap analysis of existing mockups, S009 action items, sources.
- No design-spec edits, no mockup edits, no data-model changes. Spec amendments happen in S009 after decisions informed by this session.

## Key Decisions (all LOCKED in S008)
1. **§3.7 Poll team-colour preview = Option A** (full state 8). Closes S005 open item.
2. **§3.15 W/D/L chip = profile-owner's perspective.**
3. **§3.15 Guest row stats in match-detail sheet = lighter** (goals/cards only, no S007 rating chip or description).
4. **§3.15 Wide-viewport sizing = ≥768px → max 640w × 80vh** (provisional; user will verify in S009 mockup).
5. **Settings screen = 6 rows** (Theme · Push prefs · Leaderboard sort · Positions re-entry · **Display name (new)** · Account). Extras (about/version · T&P · data-export) deferred.
6. **Settings state tile #2 = push-permission-prompt** (first-visit UX) — signed-out tile dropped (Settings is auth-gated).
7. **Platform safe-area / notch** — already a spec rule; MOCKUPS NOT CURRENTLY COMPLIANT. Retrofit action queued for S009.

## Open Questions
- **§3.15 wide-viewport sizing** — pending user's HTML review of the S009 mockup. If 640w × 80vh feels wrong on tablet/desktop, revisit at that point.
- **Phase-2 deferred Settings rows** (about/version · T&P · data-export) — confirm Phase 2 timing is correct, or promote one (T&P link most likely candidate).

## Lessons Learned

### Mistakes
| Date | Mistake | Root Cause | Prevention Rule |
|------|---------|------------|-----------------|
| 20/APR/2026 | Five approved mockups (S005–S007) were signed off without applying `viewport-fit=cover` or `env(safe-area-inset-*)` CSS, despite CLAUDE.md Rule #10 committing us to safe-area handling. Would render behind the iPhone notch/Dynamic Island in production. | Rule #10 was written at spec level but never enforced at mockup-review level. Mockup review checklist didn't include "does this apply safe-area?" The preview looks fine in desktop-browser phone-frames (which don't simulate the notch), masking the gap. | **Every mockup review MUST verify `viewport-fit=cover` in meta + `env(safe-area-inset-*)` on all `position: fixed` elements before approval. Add an iPhone-14-Pro-notched phone frame to the mockup CSS template so the obstruction is visually obvious at review time.** |

### Validated Patterns
- [20/APR/2026] **Frame decisions before drafting when multiple downstream artifacts depend on them.** S008 deliberately did not start drafting the Settings spec until the user had answered the team-colour-preview + §3.15 sub-Qs + Settings scope questions. Even with one of the answers ("Q2 go with whatever u think is best") being an explicit delegation, the other answers shaped scope meaningfully — Option A for §3.7 materially changes state 8 of the poll-screen spec, which would have been wasted work if the spec had been drafted under the deferred assumption. **Why worth remembering:** scope-framing sessions feel slow in the moment but compound into faster drafting once the answers are in. One 15-minute framing session saves 30+ minutes of re-draft.
- [20/APR/2026] **When a user flags a cross-cutting platform concern mid-session, research it before closing even if the session was otherwise done.** User raised the iPhone notch question after saying "log this session." Doing the ~15 min web research + mockup audit before closing converted a vague worry into an actionable S009 retrofit item with a specific CSS pattern and gap list. Closing without it would have left a known defect buried in "nice to have" territory. **Why worth remembering:** research-before-close trades 15 min now for 60+ min of cold-start research on home PC.

## Next Actions (S009 — home PC)

- [ ] **Retrofit safe-area on all 5 approved mockups** (Poll v3 · Leaderboard v2 · Profile v3 · Captain helper v1 · Welcome) — apply the pattern from `_wip/iphone-safe-area-research.md`. Add iPhone-14-Pro notch cutout to mockup phone-frame CSS.
- [ ] Amend **§3.7 Poll spec** — delete the Phase-2-deferred wording (line 1512), add State 8 "Teams revealed" (both status card row + per-row pills) to the spec table and layout, update acceptance criteria. Amend the `3-7-poll-screen.html` mockup to show State 8 as a new tile.
- [ ] Draft **§3.15 match-detail** full Depth-B spec + mockup — upgrade STUB to APPROVED. Light + dark phones + ≥2 state tiles (with late-cancels; no-MOTM). W/D/L chip from profile-owner perspective. Guest rows = goals/cards only (no S007 chip/description). Wide-viewport = 640w × 80vh (user verifies).
- [ ] Draft **Settings screen** Depth-B spec + mockup. 6 rows (Theme · Push · Leaderboard sort · Positions · Display name · Account). State tiles: light + dark + push-permission-prompt (first-visit) + denied-permission fallback.
- [ ] **§2.7 Part 5B RPCs** — spec `set_matchday_captains` + `update_guest_stats` + add `match_guests.updated_by` / `.updated_at` audit columns (migration note S009).
- [ ] **Admin dashboard start** — Players + Matches screens Depth-B + mockups.
- [ ] **Add "Platform safe-area" sub-section to §3.0** in the design spec so future screen specs inherit the requirement explicitly. Bump CLAUDE.md Rule #10 from one line to a short paragraph pointing at `_wip/iphone-safe-area-research.md` (or promote that file out of `_wip/` into `docs/`).
- [ ] Close S009 — log · INDEX · CLAUDE.md bump · todo S010 plan · masterplan V2.7 if data-model amended (audit columns on `match_guests` will trigger this).

## Commits and Deploy
- **Commits:** None (non-git OneDrive workspace; no code shipped this cycle).

---
_Session logged: 20/APR/2026 | Logged by: Claude (session-log skill) | S008_
