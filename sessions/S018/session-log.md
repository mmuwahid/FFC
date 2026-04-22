# Session Log — 2026-04-22 — Session018 — CLAUDE.md Optimization + docs/ui-conventions.md

**Project:** FFC
**Type:** Audit / Build
**Phase:** Phase 1 housekeeping (outside V2.8 implementation sequence)
**Duration:** Short (~20 min)
**Commits:** None (pending user sign-off to commit)

---

## What Was Done

### CLAUDE.md audit and optimization
- Read existing `CLAUDE.md` in full: **40,880 chars / 291 lines** — well above the 28,000-char target.
- Classified every section: KEEP / COMPRESS / EXTERNALIZE / REMOVE with rationale per section.
- Root cause of bloat: ~85% of the file (~35,000 chars) was session-by-session narrative (S007 through S017) that duplicated `sessions/S###/session-log.md` and `sessions/INDEX.md`.
- Plan written to `C:/Users/UNHOEC03/.claude/plans/vivid-juggling-snowflake.md`, approved by user via ExitPlanMode.

### CLAUDE.md rewritten
- Overwritten in place. **6,983 chars / 84 lines** — **−82.9%** vs before.
- Preserved 100% verbatim: Stack, Philosophy (+1 line pointing to ui-conventions.md), Folder layout (updated `docs/` subtree), Operating rules 1–12, Cross-PC protocol.
- Rule 10 trimmed: now points to `docs/platform/iphone-safe-area.md` + `docs/ui-conventions.md` instead of inlining 5 CSS check-points.
- S017 4,100-char narrative → ~800-char "Current state" + "Live operational gotchas" + "Next session" blocks. Preserved the 4 live gotchas: MCP PAT scoped to PadelHub, `supabase gen types 2>/dev/null` redirect, Windows `&`-in-path `node ./node_modules/` workaround, `supabase link` cached auth.
- S007–S016 full narratives removed → replaced with 2-line "Session history" pointer to `sessions/INDEX.md`.
- Stale S009 "NEXT" block removed (contradicted current Status header).

### docs/ui-conventions.md created
- New file at `docs/ui-conventions.md` (**2,900 chars / 39 lines**).
- Sections: Dates · Colour semantics · Layout · Information design · Debugging · Naming · Tool discipline · Mockup review checklist.
- Consolidates the 6 "Durable preferences" bullets previously buried under the S007 session narrative + the 3 "Durable rules added" from S009 (safe-area pattern, green/red button rule, FFC naming rule).
- Referenced from `CLAUDE.md` Philosophy section and Rule 10.

### Verification
- Character count confirmed: CLAUDE.md 6,983 (< 12,000 target, < 28,000 hard limit).
- Token zero-loss check: grepped 9 load-bearing tokens (`hylarwwsedjxwavuwjrn`, `prj_2NszuyOepArCTUAJCOxH8NsAAeSv`, `ffc-gilt.vercel.app`, `Mockup-first`, `viewport-fit=cover`, `DD/MMM/YYYY`, `W-D-L`, MCP PAT PadelHub, `approve_signup`) — all resolve to either new CLAUDE.md, new docs/ui-conventions.md, or pre-existing docs/platform/iphone-safe-area.md.
- Session-log integrity verified: `sessions/S014–S016/session-log.md` untouched.

---

## Files Created or Modified

- `CLAUDE.md` — rewritten in place (40,880 → 6,983 chars, −82.9%)
- `docs/ui-conventions.md` — created (2,900 chars)
- `C:/Users/UNHOEC03/.claude/plans/vivid-juggling-snowflake.md` — plan file (outside repo)

## Key Decisions

- **Externalize by reference, not by move.** Session narratives stay in `sessions/S###/session-log.md` — CLAUDE.md just points to `sessions/INDEX.md`. No session content was copied elsewhere.
- **UI conventions get a canonical doc home.** Previously scattered across session narratives + memory files. `docs/ui-conventions.md` is now the single source; memory files still exist as cross-references.
- **Rule 10 simplified, not weakened.** The 5 CSS check-points moved to the Mockup review checklist at the bottom of `docs/ui-conventions.md`. The rule itself still has force; the inlined recipe didn't.
- **No commits yet.** User hasn't explicitly authorized a commit for this housekeeping change. Commit held pending approval.

## Open Questions

- Commit + push this change to main? — user — This Week.
- Do we want to do similar pruning on `tasks/todo.md` and `tasks/lessons.md`? — user — When Possible (both are currently in the 4K–7K range per file, not yet a problem).

## Lessons Learned

### Validated Patterns

- **Externalize changelog-style content; inline only the reference card.** A CLAUDE.md file should answer "what are the live operating rules and current state?" in under 10 minutes of reading. Session-by-session narrative is a different document (a changelog) and belongs elsewhere. When an AGENTS/CLAUDE/GEMINI file crosses ~20K chars, audit for this pattern. — **Why:** every session pays the full file in tokens on every turn. 33,000 chars of duplicated session narrative was costing us silently.
- **Plan → approve → execute works cleanly in Plan Mode for file-optimization tasks.** The user's Phase 1 / Phase 2 / Phase 3 framing mapped directly onto ExitPlanMode — no bespoke workflow needed. — **Why:** confirmed that Plan Mode is the right tool for any "present-a-plan-first" task regardless of whether it's code or docs.

## Next Actions

- [ ] User decision: commit CLAUDE.md rewrite + new `docs/ui-conventions.md` to main? (Pre-prepared commit message: `chore: externalize session history + UI conventions from CLAUDE.md (−82.9% chars)`.)
- [ ] S019 (next actual session) = Step 3 of V2.8 auth flow — agenda unchanged, moved forward from the old "S018" label in `tasks/todo.md`. Update the todo.md header to point at S019.
- [ ] (Low priority) Consider extracting PadelHub lesson inheritance + critical rules block from `tasks/lessons.md` into a separate `docs/padelhub-inherited-rules.md` if lessons.md crosses 20K chars.

---

## Commits and Deploy

- **Commits:** None (pending user sign-off)
- **Live:** https://ffc-gilt.vercel.app — unchanged (no code touched)

---
_Session logged: 2026-04-22 | Logged by: Claude (session-log skill) | Session018_
