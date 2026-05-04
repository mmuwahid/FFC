# FFC

FFC is a mobile-first PWA for managing a weekly 7v7 friends football league: Monday poll → Thursday game cycle, with match history, leaderboard, seasons, awards, and WhatsApp share integration.

## Current state
- **Phase:** Phase 1 done. Phase 2A + 2B code-complete; live acceptance owed on a real Thursday matchday. Phase 3 in progress (awards / share PNG / payment tracker shipped).
- **Live:** https://ffc-gilt.vercel.app · `main` is authoritative. For latest HEAD, session details, and migration inventory see `sessions/INDEX.md`.
- **Pointers:** plan → `planning/FFC-masterplan-V3.0.md` · sessions → `sessions/INDEX.md` (+ `sessions/S###/session-log.md`) · todo → `tasks/todo.md` (`## NEXT SESSION` is live agenda) · lessons → `tasks/lessons.md`.
- **Maintenance:** if CLAUDE.md / todo.md / lessons.md / INDEX.md crosses 30 KB or 1,000 lines, re-run the S050 trim cycle.

## Stack
- **Frontend:** React 19 + Vite 8 + TypeScript 6 (PWA via `vite-plugin-pwa`, `injectManifest` strategy + `src/sw.ts`)
- **Backend:** Supabase (Postgres + RLS + Auth + Edge Functions + Storage + Vault)
- **Auth:** email/password + Google OAuth
- **Deploy:** Vercel (GitHub auto-deploy from `main`, Root Directory = `ffc`)
- **Repo:** `github.com/mmuwahid/FFC` (private)
- **Supabase project:** `hylarwwsedjxwavuwjrn` (`ffc` org, `ap-south-1` Mumbai, Free tier)
- **Vercel project:** `prj_2NszuyOepArCTUAJCOxH8NsAAeSv` (`ffc` on `team_HYo81T72HYGzt54bLoeLYkZx`)

## Philosophy
- **Reuse PadelHub patterns** — every critical rule from `Padel Battle APP/tasks/lessons.md` applies here too. READ IT BEFORE WRITING CODE.
- **Mockup-first workflow:** HTML mockup → user review → finalize → implement. Never skip.
- **Phased rollout:** Phase 1 (Core Weekly Cycle) shipped; Phase 2 = automation + Live Match Console.
- **UI conventions:** all app-wide design rules live in `docs/ui-conventions.md`. Read before building or reviewing any screen.

## Folder layout
```
FFC/
├── CLAUDE.md                  ← you are here
├── _wip/                      ← scratch / draft files (clean weekly)
├── archive/                   ← retired docs / code
├── docs/
│   ├── ui-conventions.md      ← app-wide UI rules (dates, colour, layout, naming)
│   ├── platform/              ← platform-specific implementation notes
│   └── superpowers/specs/     ← design specs (YYYY-MM-DD-*.md)
├── ffc/                       ← Vite app
├── mockups/                   ← HTML mockups before implementing screens
├── planning/                  ← masterplan V1, V2, V3... (version always, never overwrite)
├── sessions/                  ← per-session logs (S001, S002, ...)
│   └── INDEX.md               ← session index (authoritative history)
├── shared/                    ← shared assets between sub-projects (logos, icons)
├── supabase/                  ← SQL migrations, Edge Function source
└── tasks/
    ├── todo.md                ← running todo (NEXT SESSION at top)
    ├── lessons.md             ← FFC-specific lessons (inherits PadelHub's too)
    └── _archive/              ← rotated history blocks (todo, lessons)
```

## Operating rules (inherited from PadelHub)
1. **Mockup-first.** No screen gets built without an approved mockup in `mockups/`.
2. **Plan docs versioned.** `planning/FFC-masterplan-V1.0.md`, never overwrite — create V2.0 for revisions.
3. **No files at repo root** except CLAUDE.md and the top-level readme.
4. **Temp/draft files go in `_wip/`**. Clean weekly.
5. **Session log every working session.** `sessions/S###/session-log.md` + entry in `INDEX.md`.
6. **NEVER regenerate user documents** — edit originals.
7. **Verify DB columns and function signatures BEFORE writing PostgREST queries / PL/pgSQL calls.** Query `information_schema.columns`, `pg_proc.pg_get_function_identity_arguments(oid)`, `pg_type`, `information_schema.views`. Generalises to enum values too.
8. **Plain-object React Context** — no useMemo cascades.
9. **No hooks after conditional returns.**
10. **Safe-area insets** on all fixed-position mobile elements. See `docs/platform/iphone-safe-area.md` + `docs/ui-conventions.md` ("Mockup review checklist").
11. **Supabase CLI:** `npx supabase` (global install is broken on work PC).
12. **Vercel builds with `tsc -b` (project refs)** — stricter than local `tsc --noEmit`. Run `node ./node_modules/typescript/bin/tsc -b` before pushing.
13. **Git repo temp clone path on Windows:** full path `C:/Users/UNHOEC03/AppData/Local/Temp/FFC`. Never use `/tmp/` inside Node `fs` calls — it resolves to `C:\tmp\` incorrectly.

## Cross-PC protocol
Work PC = `UNHOEC03`, home PC = `User`. OneDrive holds working tree; `.git/` is external per-PC at `C:/Users/<user>/FFC-git/` (forward slashes); authoritative state is `origin/main`. The OneDrive `.git` is a text pointer rewritten when switching PCs. Git identity: `git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com"` (repo-local config already set on both PCs).

### Session-start sync (MANDATORY — run before any work)
1. `echo $USERNAME` → confirm PC.
2. `cat FFC/.git` → ensure `gitdir: C:/Users/<this-pc-username>/FFC-git` (forward slashes).
3. `git fetch && git status -sb && git log --oneline -5 && git rev-parse --abbrev-ref HEAD`.
4. **Branch check:** if NOT on `main` AND `git log --oneline HEAD..origin/main | wc -l` > 5 → STOP, ask user before any work.
5. **Working tree:**
   - Clean + up-to-date → proceed.
   - Modifications match `git diff HEAD origin/main --stat` → cross-PC lag: `git stash push --include-untracked -m "<pc>-sync-s###" && git pull --ff-only && git stash drop`.
   - Genuinely uncommitted local work (NOT on `origin/main`) → ask user.
6. Announce PC + branch + HEAD in the session briefing.

S053 post-mortem context (why the branch check exists) lives in `sessions/_archive/INDEX-pre-s060.md`.

## Live operational gotchas
Durable debugging reference (Vercel SPA rewrite, Supabase auth-key dual model, RPC patterns, TS quirks, Windows `&`-in-path bug, etc.) lives in [`docs/platform/operational-gotchas.md`](docs/platform/operational-gotchas.md). Read on demand when something behaves unexpectedly.

## Per-screen brand tokens
12-token brand block convention for in-app screens documented in [`docs/ui-conventions.md`](docs/ui-conventions.md) ("Per-screen brand tokens").
