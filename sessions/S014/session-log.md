# Session S014 — 21/APR/2026 (Home PC)

**Focus:** Masterplan V2.8 consolidation · formal Phase 1 approval · collaborator brief (Word document with all 10 approved mockups embedded as screenshots).

**Outcome — full close:**
- **Masterplan V2.8 landed** — 378 lines, consolidates all S009–S013 deltas on top of V2.7. Includes 11-file migration order + implementation sequencing notes for Phase 1 kickoff.
- **Phase 1 design FORMALLY APPROVED** — CLAUDE.md status header flipped from `Brainstorming (pre-implementation). Design Phase 1 not yet fully approved. Code not started.` to `Design Phase 1 APPROVED — implementation ready. Formally approved by user on 21/APR/2026 (S014)...`. Memory file `project_ffc.md` updated (4 edits — frontmatter description · opening paragraph · masterplan reference · Latest/Next session blocks).
- **Collaborator brief Word document built** at `docs/FFC-Collaborator-Brief.docx` (14.2 MB · 305 paragraphs · 10 embedded PNG screenshots · 33 files in docx archive). Includes cover · executive summary · problem/solution · core features · tech stack · current progress · data model snapshot · 10-page mockup gallery · next-steps section.
- **Logo rollout DEFERRED to S015** — user still to export transparent PNG/SVG from `shared/FF_LOGO_FINAL.pdf`.
- **Implementation kickoff DEFERRED to S015** — clean handoff for a fresh-focus impl session.

---

## Item 1 — Cold-start briefing

Invoked `anthropic-skills:session-resume`. Read INDEX.md (up through S013 row) + S013 session log + `tasks/todo.md` (NEXT SESSION block). Briefing presented covering: last session outcome · where we are · S014 agenda (5 items) · blockers · memory loaded.

---

## Item 2 — Masterplan V2.8 written

New file: `planning/FFC-masterplan-V2.8.md` · 378 lines · within the ~350–500 target.

**Structure (follows V2.7 shape):**
- Revision history section describing 5 S013 delta groups (§1 non-goal fix · §2 DDL landings · drift reconciliation · 5v5/7v7 spec · CSS contract persistence).
- Sections 1–2 carryover with brand-asset and logo-rollout notes added.
- Section 3 decisions — **9 new V2.8 bullets**: captain-draft scoping · `user_role` authority · admin-audit convention · `formations` conditional SELECT · 5v5/7v7 four locked decisions · CHECK expansion · WhatsApp `{{roster_cap}}` placeholder.
- Sections 4–15 mostly pointers to V2.7 with V2.8 extensions noted where 5v5 changes the surface.
- **Section 16 NEW — 5v5/7v7 Multi-Format Support** (major addition): decisions table · data model table · format-awareness convention table · UI parameterisation table · admin UX.
- **Section 2 data-model delta (V2.8-only)**: `match_format` enum · helper SQL for `effective_format()` + `roster_cap()` + `log_admin_action()` · CHECK expansion SQL · 10-drift reconciliation table.
- **Migration order** — authoritative 11-file layout table (supersedes V2.7's list).
- **Implementation sequencing notes** — 4 ordered steps with acceptance criteria each.
- **Deferred items table** — 6 rows (palette re-alignment · masterplan §§4–6 · auto-captain-pick · etc.).

**Heavy use of markdown tables** per the new `feedback_table_presentation.md` rule — decisions, helpers, drifts, migrations, UI surfaces, and deferred items all rendered as tables, not prose walls.

**SQL blocks for the new helpers** (`effective_format`, `roster_cap`, `log_admin_action`) + `formations_pattern_valid` CHECK expansion — lets migration authors copy-paste.

V2.7 preserved untouched (per Rule 2 — never overwrite plan docs).

---

## Item 3 — Formal Phase 1 approval

Two edits in parallel:
- `CLAUDE.md` line 3 — status header flipped (see outcome block above).
- `C:\Users\UNHOEC03\.claude\projects\...\memory\project_ffc.md` — **4 edits**:
  1. Frontmatter description: `"latest session S013 close, next-session resume point (S014 = masterplan V2.8 + logo + approval + impl kickoff)"` → `"Phase 1 design APPROVED (S014 21/APR/2026), next gate is implementation kickoff"`.
  2. Opening paragraph: `"Still in design phase — no code yet; Phase 1 design feature-complete and drift-free at S013 close, formal approval deferred to S014."` → `"Design Phase 1 APPROVED on 21/APR/2026 in S014 after masterplan V2.8 landed..."`.
  3. Masterplan reference: `V2.7 latest · V2.8 queued for S014` → `V2.8 latest (378 lines, landed S014)`.
  4. Latest/Next session blocks: rewrote — S014 is now "Latest" · S015 plan rewritten to focus on logo rollout + implementation kickoff Steps 0–2 of V2.8 + first feature slice.

---

## Item 4 — Collaborator brief Word document

User requested: a full brief of the project (purpose · main features · current progress) plus screenshots of all approved mockups, all in a Word document for easy sharing with a collaborator.

### 4.1 Infrastructure — preview + headless Chrome pipeline
- **Preview server** reused/restarted from `.claude/launch.json` config (Python `http.server` serving `.superpowers/brainstorm/635-1776592878/content/` on port 5173).
- **Screenshot path**: `preview_screenshot` initially timed out (30s) even after restart — pivoted to **headless Chrome** (`/c/Program Files/Google/Chrome/Application/chrome.exe --headless=new --disable-gpu --hide-scrollbars --window-size=1400,3200 --screenshot=...`). Saves directly to disk (unlike preview tool which returns images inline).
- Hit a bash path-expansion bug on first batch: `"$OUTDIR\\${f}.png"` with mixed slashes failed to expand `${f}` correctly — files wrote with literal `${f}` in filename, all iterations overwrote one file. **Fix**: use forward slashes throughout: `"$OUTDIR/$f.png"`.

### 4.2 Screenshots (10 files)
All saved to `docs/brief-screenshots/`:
- `welcome.png` (872 KB · 1400×2400)
- `3-7-poll-screen.png` (1.7 MB · 1400×3200)
- `3-1-v2-captain-helper.png` (439 KB · 1400×3200)
- `3-13-leaderboard.png` (1.5 MB · 1400×3200)
- `3-14-player-profile.png` (1.5 MB · 1400×3200)
- `3-15-match-detail.png` (1.6 MB · 1400×3200)
- `3-16-settings.png` (1.6 MB · 1400×3200)
- `3-17-admin-players.png` (1.6 MB · 1400×3200)
- `3-18-admin-matches.png` (1.6 MB · 1400×3200)
- `3-19-formation.png` (1.6 MB · 1400×3200)

### 4.3 Word document build
- Invoked `anthropic-skills:docx` skill.
- Installed `docx` npm package globally (`npm install -g docx` — 22 packages).
- Wrote `docs/build-collaborator-brief.js` (a Node script using `docx-js` library). Kept as a reusable artifact for future updates.
- Script defines: cover page · 8 top-level sections · 10 mockup pages · helpers for headings/bullets/tables/images/page-breaks.
- Output: `docs/FFC-Collaborator-Brief.docx` · 14.2 MB · 305 paragraphs · 33 archive files · 10 embedded PNGs.
- Validation attempt via skill's `validate.py` hit Windows cp1252 encoding errors on both module imports (missing `defusedxml` + `lxml`) and on the validator's own console output. Installed the Python deps; validator still crashed on its own Unicode arrow output.
- **Pivot to manual sanity check** via Python zipfile + xml.etree: archive opens cleanly · document.xml parses as valid XML · 305 paragraphs · all 10 media files present at expected sizes. File is valid.

### 4.4 Document content highlights
Sections included:
1. Cover (title, subtitle, date, approved status, owner)
2. Executive Summary (+ quick-stats 2-col table)
3. What We're Building (problem + solution + 7 design principles)
4. Core Features (player-side + admin-side + cross-cutting subsections)
5. Tech Stack (2-col table + 9 enforced design conventions bullets)
6. Current Progress (done + not-done + key files to read)
7. Data Model Snapshot (tables + enums + 20 RPCs + 5 helpers)
8. Approved Mockups (10 pages — each with title, purpose, embedded image, 4–6 highlight bullets, page break)
9. What's Next (before-first-commit 6 ordered steps, first feature slice, beyond Phase 1, how-to-contribute, open questions)

---

## Item 5 — Todos + housekeeping

- TodoWrite used to track 4 items through the session.
- `docs/brief-screenshots/` garbage file from the initial failed bash run (`brief-screenshots${f}.png`) was surfaced and removed after the forward-slash fix.
- `.claude/launch.json` pre-existed with correct config — no edit needed.

---

## Deferred to S015

| # | Item | Why deferred |
|---|---|---|
| 1 | Logo rollout | User still to export transparent PNG/SVG from `shared/FF_LOGO_FINAL.pdf` (512/192/180/32 + SVG master + WhatsApp OG 1200×630) |
| 2 | Phase 1 implementation kickoff | Step 0–2 of V2.8 sequencing (GitHub repo + Supabase project + Vercel + Vite scaffold + 11 migrations) — sizeable; deserves a fresh-focus session |
| 3 | First feature slice | Step 3 of V2.8 sequencing — auth + welcome + self-signup pending flow → admin approval → ref unlock → Poll screen up to State 3 |
| 4 | Brand palette re-alignment | Still on the backburner unless user surfaces it |
| 5 | Masterplan §§4–6 (operational runbook · rollout plan · post-Phase-1 roadmap) | Not blockers for impl kickoff |

---

## Durable rules learned this session

No new durable UI/CSS rules. **One operational rule worth capturing** (already known but reinforced):
- **Bash on Windows with mixed slashes + variable expansion** — when a path contains both forward slashes (from `cd` context) and backslashes (Windows literal), variable expansion inside double-quoted strings can silently fail. Always prefer forward slashes end-to-end when building Windows paths in bash.

The Python validator's Windows console encoding issue (cp1252 vs the script's own Unicode arrow) is worth noting too — the skill's `validate.py` is not Windows-console safe even after deps are installed. Sanity-check via zipfile+xml.etree is reliable fallback.

---

## Authoritative files at S014 close

- `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` — Phase 1 design spec (~3,100 lines, feature-complete + drift-free). Unchanged this session.
- `planning/FFC-masterplan-V2.8.md` — **NEW** (378 lines). V2.7 and prior preserved.
- `docs/FFC-Collaborator-Brief.docx` — **NEW** (14.2 MB). Shareable brief with 10 embedded mockup screenshots.
- `docs/build-collaborator-brief.js` — **NEW**. Reusable Node script for rebuilding the brief.
- `docs/brief-screenshots/*.png` — **NEW** (10 files, ~13 MB total).
- `CLAUDE.md` — status header flipped.
- `_wip/` — empty (unchanged since S013).

**Memory files updated:**
- `project_ffc.md` — 4 edits (frontmatter + opening + masterplan ref + Latest/Next session blocks).

---

## Handoff to S015

**Cold-start checklist:**
- Read CLAUDE.md (S014 summary at top — status now shows APPROVED), `sessions/INDEX.md` (S014 row), `sessions/S014/session-log.md` (this file).
- Memory auto-loads all prior rules. `project_ffc.md` description now reflects approved state + S015 plan.

**S015 agenda (priority order):**

1. **Logo rollout** (unblocks when user exports):
   - Transparent PNG at 512 · 192 · 180 · 32 + SVG master
   - Wire into `welcome.html` + all 9 phone-frame mockups (replacing JPG stopgap on `3-7-poll-screen.html`)
   - PWA manifest `icons[]` block stub
   - WhatsApp OG image 1200×630

2. **Phase 1 implementation kickoff — Steps 0–2 of V2.8 sequencing:**
   - Create GitHub repo `mmuwahid/FFC` (private). Enforce committer identity `m.muwahid@gmail.com`.
   - Create Supabase project (separate org from PadelHub's `nkvqbwdsoxylkqhubhig`). Record `project_ref` + anon key + service role key.
   - Create Vercel project on team `team_HYo81T72HYGzt54bLoeLYkZx`. Wire env vars: `SUPABASE_URL` · `SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY`.
   - Scaffold Vite React PWA inside `ffc/` using PadelHub boot patterns (inline splash · safe-area CSS · service worker · `ErrorBoundary` · plain-object Context).
   - Run 11 migration files in order: `0001_enums.sql` → `0011_seed_super_admin.sql`. Seed `m.muwahid@gmail.com` as super_admin.
   - Smoke-test `npx supabase` CLI + hello-world Edge Function.

3. **First feature slice — Step 3 of V2.8 sequencing:**
   - Auth (email/password + Google OAuth) + welcome screen + self-signup pending flow.
   - Super-admin approval via `approve_signup` RPC.
   - Ref token unlock (one-time URL).
   - §3.7 Poll screen state machine up to State 3 (voted, pre-lock).
   - Acceptance: super-admin approves a pending signup; approved player signs in and commits a poll vote; `committed_at` row visible in `poll_votes` with correct ordering.

4. **Brand palette re-alignment** — still deferred unless user surfaces it.

5. **Close S015** — session log · INDEX row · CLAUDE.md bump · todo.md S016 plan.

---

_Session logged 21/APR/2026 · S014 · Home PC_
