# FFC

**Status:** Phase 1 Steps 1, 2 & 3 of V2.8 **COMPLETE**. Auth flow live end-to-end (D1–D6 all PASSED in S020). S021 shipped 4 polish items: **Google OAuth Path B verified end-to-end** (DB delta confirms Test Player now has `[email, google]` identities — Supabase merge did NOT fork duplicate profile), **real FFC crest PNG icons live** (32/180/192/512 + maskable-512 replace the purple-bolt Vite-starter placeholder everywhere — favicon, apple-touch-icon, manifest, splash), **Signup.tsx confirm-email handler added** (latent fix for when Supabase "Confirm email" flips ON — new `'confirm_email'` Stage with inbox-check + resend), **`docs/admin-audit-sql.md` cheat-sheet** (canonical column reference after S020 D5 SQL failed on wrong name `target_table` vs actual `target_entity`). Live: https://ffc-gilt.vercel.app. `supabase/migrations/0012_grants.sql` applied live — **every future table-creating migration MUST rely on 0012's DEFAULT PRIVILEGES or emit its own GRANTs**; RLS alone does not grant access (Supabase "auto table exposure" is OFF on this project). `ffc/vercel.json` ships SPA catch-all rewrite — deleting it will 404 every non-root URL. Google OAuth in Testing mode (Client ID `991515683563-ncjuidcn08psinv7oq8jb9kevp4k6g32…`) — consent screen shows `hylarwwsedjxwavuwjrn.supabase.co` not "FFC" (Supabase platform limit, fix requires $25/mo Pro custom domain — deferred indefinitely). Authoritative plan: `planning/FFC-masterplan-V2.8.md`. Next: **S022 Step 4 UI slice** — planner-agent to pick between Poll full Depth-B (§3.7) or Leaderboard (§3.13).

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
- **Sync via git, not OneDrive file sync.** OneDrive syncs the working tree across PCs as a convenience, but the authoritative state is `origin/main`.
- **Git identity for FFC commits:** `git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com"` (repo-local config already set on both PCs).
- **Windows `gitdir:` pointer must use forward slashes.** Example on work PC: `gitdir: C:/Users/UNHOEC03/FFC-git`.

### Session-start sync protocol (MANDATORY — run before any work)
Every session must begin with this check to detect and resolve cross-PC lag, because OneDrive may have synced working-tree files from the other PC while this PC's local `.git/` stayed at an older HEAD. Symptoms: `git status` shows dozens of "modifications" or "untracked" files that are actually already-pushed commits from the other PC.

1. **Detect which PC you're on** — `echo $USERNAME` (or check `C:/Users/<name>/`). Work PC = `UNHOEC03`, Home PC = `User`.
2. **Fix the `.git` pointer** — read `FFC/.git`; it must say `gitdir: C:/Users/<this-pc-username>/FFC-git`. If it points at the other PC, rewrite the single line. Forward slashes only.
3. **Fetch + inspect** — `git fetch` then `git status -sb` and `git log --oneline -5`.
4. **Diagnose one of three states:**
   - **(a) Clean + up-to-date with origin/main** → proceed to work.
   - **(b) Behind origin/main AND working tree shows "modifications" matching the ahead commits** (classic cross-PC lag — OneDrive synced the files, local git didn't see the commits): run `git stash push --include-untracked -m "<pc>-sync-s###"` → `git pull --ff-only` → `git stash drop` (the stash content is identical to HEAD, safe to discard). Verify clean via `git status -sb`.
   - **(c) Genuinely uncommitted local work** (modifications that are NOT on origin/main) → this is real WIP from a session that never pushed. Do NOT stash-drop. Ask the user before touching it.
5. **Announce the PC + HEAD** in the session briefing so it's obvious which side was lagging.

The lagging-side symptom looks identical to (c) — the differentiator is whether the ahead commits on origin/main already contain those changes. A quick check: `git diff HEAD origin/main --stat` lists the same files that appear as "modified" or "untracked" in `git status`. If yes → state (b). If `git status` has files NOT in that diff → mixed state; ask.

## Current state (S020 close, 22/APR/2026)
- **Live:** https://ffc-gilt.vercel.app — full auth flow. `/login` (email/password + Google OAuth buttons), `/signup` (3-stage: email → who-are-you → waiting), `/admin/players` (Pending/Active/Rejected tabs with approve/reject RPC wiring), `/poll` stub loads under 4-tab RoleLayout for players or 5-tab for admins. All deep-link URLs resolve (SPA catch-all rewrite).
- **Database:** 20 tables + 12 migrations (`0012_grants.sql` added in S019). 20 RPCs. RLS on all tables. 2 real players in `profiles`: super-admin `m.muwahid@gmail.com` (id `cce905a8…`) + Test Player `m.muwahid05@gmail.com` (id `ca3181b2…`). 1 rejected row: `m.muwahid+reject@gmail.com` (id `7f8bb630…`). 2 pending_signups rows both resolved.
- **Auth:** Email confirmations DISABLED (admin approval is the Phase 1 gate). Google OAuth provider enabled in Supabase; GCP project `FFC App` (ID `ffc-app-494112`) in Testing mode; OAuth 2.0 Web Client `FFC Web` (Client ID `991515683563-ncjuidcn08psinv7oq8jb9kevp4k6g32.apps.googleusercontent.com`). Test users allowlisted. Redirect URLs: `https://ffc-gilt.vercel.app/**` + `http://localhost:5174/**`.
- **Types:** `ffc/src/lib/database.types.ts` (1816 lines). Zero TS errors.
- **Repo:** `main` at `0e62ffd`. S020 shipped 3 commits: `8f8668e` (S019 bundle), `dca48cf` (D6 UX fix), `0e62ffd` (SPA rewrite).
- **`ffc/vercel.json`** — LOAD-BEARING. Ships the SPA catch-all rewrite. Deleting it will 404 every non-root URL.

### Live operational gotchas
- **Supabase MCP PAT is scoped to PadelHub org only.** `execute_sql` returns 403 on FFC project. Workaround: Supabase CLI (`npx supabase db push`, `db query --linked`) throughout. Update PAT in Claude settings → MCP connectors → Supabase if MCP access to FFC is wanted.
- **`supabase gen types typescript --linked 2>/dev/null`** — the `2>/dev/null` redirect is mandatory; "Initialising login role..." diagnostic goes to stdout and corrupts the types file without it.
- **Windows OneDrive `&`-in-path bug:** `.bin/*.cmd` batch wrappers truncate at `&` in "11 - AI & Digital". FFC's `package.json` uses `node ./node_modules/<pkg>/bin/<bin>` direct invocation, not `npm run`. Vercel Linux CI is unaffected.
- **`supabase link`** uses cached auth token — no DB password needed on a machine already authenticated.
- **Supabase "Confirm email" must stay OFF for Phase 1.** Flipping it ON will re-break `Signup.tsx` Stage 1 silent-stuck bug (signUp returns session:null → onAuthStateChange never fires). Before flipping ON, add the "check your inbox" handler to `Signup.tsx`.
- **Supabase email validator rejects `example.com` and throwaway domains.** Test emails MUST be real Gmail or `+tag` aliases. Convention: `m.muwahid+s###<role>@gmail.com`.
- **Google OAuth consent screen shows `hylarwwsedjxwavuwjrn.supabase.co`, not "FFC".** Platform limitation in Testing mode + default Supabase callback URL. Fix requires Supabase Pro custom domain ($25/mo) — not worth it for a private league.
- **Google Cloud Test Users modal "Ineligible accounts not added" is a red herring on duplicate-case adds.** Gmail is case-insensitive at the SMTP level; the add actually succeeded.
- **Vercel static-file precedence over rewrites is automatic.** Catch-all `/(.*) → /` does NOT break `/sw.js`, `/manifest.webmanifest`, `/ffc-logo.png`.
- **Terminal roles (`rejected`, future `banned`) must auto-signOut in `AppContext.tsx`** — not just render a display flag. Handled for `rejected` in `dca48cf`. Apply the same pattern to any future terminal role.

### Next session (S021)
Phase 1 Step 3 is DONE. S021 candidates: (1) Google OAuth Path B end-to-end retest on production (config is in place). (2) PWA logo variants (32/180/192/512 PNG + SVG master) wired into `manifest.webmanifest`. (3) `Signup.tsx` confirm-email handler (latent fix for future). (4) `admin_audit_log` column audit (S020 D5 query failed on `target_table` name). (5) Step 4 of V2.8 — check masterplan §17 for next milestone. (6) Palette re-alignment (backburner).

## Session history
Session-by-session narrative lives in `sessions/INDEX.md` and per-session logs at `sessions/S###/session-log.md`. Do not duplicate here.

Durable lessons across sessions: `tasks/lessons.md` (inherits PadelHub's lessons too).
