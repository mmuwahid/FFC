# FFC

**Status:** Phase 1 implementation — Steps 1 & 2 of V2.8 complete. PWA shell live, DB seeded. Next gate: **Step 3 — auth flow** (email/password + Google OAuth, real Welcome, self-signup pending → admin approval via `approve_signup` RPC). Authoritative plan: `planning/FFC-masterplan-V2.8.md`.

FFC is a mobile-first PWA for managing a weekly 7v7 friends football league: Monday poll → Thursday game cycle, with match history, leaderboard, seasons, awards, and WhatsApp share integration.

## Stack
- **Frontend:** React 19 + Vite 8 + TypeScript 6 (PWA via `vite-plugin-pwa`)
- **Backend:** Supabase (Postgres + RLS + Auth + Edge Functions + Storage)
- **Auth:** email/password + Google OAuth
- **Deploy:** Vercel (GitHub auto-deploy from `main`, Root Directory = `ffc`)
- **Repo:** `github.com/mmuwahid/FFC` (private)
- **Supabase project:** `hylarwwsedjxwavuwjrn` (`ffc` on new FFC org, region `ap-south-1` Mumbai, Free tier)
- **Vercel project:** `prj_2NszuyOepArCTUAJCOxH8NsAAeSv` (`ffc` on `team_HYo81T72HYGzt54bLoeLYkZx`)
- **Live URL:** https://ffc-gilt.vercel.app

## Philosophy
- **Reuse PadelHub patterns** — every critical rule from `Padel Battle APP/tasks/lessons.md` applies here too. READ IT BEFORE WRITING CODE.
- **Mockup-first workflow:** HTML mockup → user review → finalize → implement. Never skip.
- **Phased rollout:** Phase 1 (Core Weekly Cycle) ships before anything else.
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
    ├── todo.md                ← running todo (NEXT SESSION section at top)
    └── lessons.md             ← FFC-specific lessons (inherits PadelHub's too)
```

## Operating rules (inherited from PadelHub)
1. **Mockup-first.** No screen gets built without an approved mockup in `mockups/`.
2. **Plan docs versioned.** `planning/FFC-masterplan-V1.0.md`, never overwrite — create V2.0 for revisions.
3. **No files at repo root** except CLAUDE.md and this top-level readme.
4. **Temp/draft files go in `_wip/`**. Clean weekly.
5. **Session log every working session.** `sessions/S###/session-log.md` + entry in `INDEX.md`.
6. **NEVER regenerate user documents** — edit originals.
7. **Verify DB columns before writes** (Critical Rule #12 from PadelHub lessons).
8. **Plain-object React Context** — no useMemo cascades (Rule #13).
9. **No hooks after conditional returns** (Rule #14).
10. **Safe-area insets** on all fixed-position mobile elements. Implementation: `docs/platform/iphone-safe-area.md`. Mockup review checklist: `docs/ui-conventions.md` ("Mockup review checklist" section).
11. **Supabase CLI:** `npx supabase` (same as PadelHub — global install is broken on work PC).
12. **Git repo temp clone path on Windows:** full path `C:/Users/UNHOEC03/AppData/Local/Temp/FFC`. Never use `/tmp/` inside Node `fs` calls — it resolves to `C:\tmp\` incorrectly.

## Cross-PC protocol
Working across work PC (`UNHOEC03`) and home PC (`User`).
- **OneDrive IS the main working tree** (reverted at S018 from the S015 migration-out plan). Path: `C:/Users/UNHOEC03/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC/`. Edit files here directly.
- **Separate-git-dir architecture** — the `.git/` lives OUTSIDE OneDrive, one per PC, so OneDrive sync never touches git internals. Work PC: `C:/Users/UNHOEC03/FFC-git/`. Home PC: `C:/Users/User/FFC-git/`. The OneDrive `.git` file is a text pointer (`gitdir: <path>`) that must be rewritten on each PC to point at its local git dir — OneDrive syncs the pointer across PCs so it needs updating whenever you switch machines.
- **Sync via git, not OneDrive file sync.** `git pull` at start of session; `git commit && git push` at end. OneDrive syncs the working tree across PCs as a convenience, but the authoritative state is `origin/main`.
- **Git identity for FFC commits:** `git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com"` (repo-local config already set on both PCs).
- **Windows `gitdir:` pointer must use forward slashes.** Example on work PC: `gitdir: C:/Users/UNHOEC03/FFC-git`.

## Current state (S017 close, 21/APR/2026)
- **Live:** https://ffc-gilt.vercel.app — real PWA shell with auth-aware router (PublicLayout / RoleLayout with 4-tab or 5-tab bottom nav / RefLayout), 13 spec-ref stubs wired, inline splash, safe-area CSS, SW registered.
- **Database:** 20 tables, 11 migrations applied, 20 SECURITY DEFINER RPCs, RLS on all tables, 4 views, 7 `app_settings` rows, 5 `scheduled_reminders`, Season 1 + super-admin seeded (`auth_user_id = NULL` until Step 3 binds it).
- **Types:** `ffc/src/lib/database.types.ts` (1816 lines). Zero TS errors. Supabase client typed via `createClient<Database>(...)`.
- **Repo:** `main` at `cab85b9`. Direct-to-main workflow; Vercel auto-deploys.

### Live operational gotchas
- **Supabase MCP PAT is scoped to PadelHub org only.** `execute_sql` returns 403 on FFC project. Workaround: Supabase CLI (`npx supabase db push`, `db query --linked`) throughout. Update PAT in Claude settings → MCP connectors → Supabase if MCP access to FFC is wanted.
- **`supabase gen types typescript --linked 2>/dev/null`** — the `2>/dev/null` redirect is mandatory; "Initialising login role..." diagnostic goes to stdout and corrupts the types file without it.
- **Windows OneDrive `&`-in-path bug:** `.bin/*.cmd` batch wrappers truncate at `&` in "11 - AI & Digital". FFC's `package.json` uses `node ./node_modules/<pkg>/bin/<bin>` direct invocation, not `npm run`. Vercel Linux CI is unaffected.
- **`supabase link`** uses cached auth token — no DB password needed on a machine already authenticated.

### Next session (S018)
Step 3 of V2.8: auth flow (email/password + Google OAuth), real Welcome ported from `mockups/welcome.html`, self-signup pending flow (`pending_signups` INSERT), admin approval via `approve_signup` RPC, bind `auth_user_id` on super-admin. Acceptance: new user signs up → admin approves → user signs in → reaches `/poll`.

## Session history
Session-by-session narrative lives in `sessions/INDEX.md` and per-session logs at `sessions/S###/session-log.md`. Do not duplicate here.

Durable lessons across sessions: `tasks/lessons.md` (inherits PadelHub's lessons too).
