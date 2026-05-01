# FFC

FFC is a mobile-first PWA for managing a weekly 7v7 friends football league: Monday poll → Thursday game cycle, with match history, leaderboard, seasons, awards, and WhatsApp share integration.

## Current state (S063 close, 01/MAY/2026)
- **Phase:** Phase 1 complete. Phase 2A + 2B code-complete (S051). Phase 2 live acceptance still owed on a real Thursday matchday. **S053** awards (V3.0:139). **S054** share PNG (V3.0:140). **S056** payment tracker (V3.0:147). **S058** all 4 GH issues (#22 #23 #25 #21). **S059** 9-issue GH sweep (#30–#38). **S060** payment-tracker verify + #41 ref-name/is_no_show (mig 0064) + #38 topbar fix. **S061** PR #42 merged + #40 formal_name (mig 0065) + #41 FIFA player table. **S062** #38 design-system polish (focus-visible / radius / skeletons / typography / spacing / state-flips). **S063** first-real-match-day diagnostic cascade — RefEntry submit cast bug (winner→result enum at boundary) + MatchEntryReview Approve hidden-by-nav + "[object Object]" toast → mig 0066 enum casts in 4 RPCs + share PNG overhaul (Game-N + games_seeded mig 0067, side-aligned scorers, twemoji `graphemeImages` for ⭐⚽🟨🟥, RENDER_VERSION cache invalidation, mig 0068 cards in payload) + 4 GH issues closed (#44 splash crest, #45 W/D/L colours, #46 nav GPU compositing, #47 sticky header z-index). #43 (light mode) deferred — needs 15-scope inversion.
- **Live:** https://ffc-gilt.vercel.app · `main` clean at `36b2963`. **Open GitHub: 0 PRs · 1 issue (#43 light-mode, deferred).**
- **Migrations on live DB:** 68. S053 → 0047. S054 → 0048 / 0049 / 0051 / 0052 / 0053. S055 → 0054. S056 → 0055. S058 → 0056 / 0057 / 0058 / 0059. S059 → 0060 / 0061 / 0062 / 0063. S060 → 0064 (`matches.ref_name` + `pending_match_entry_players.is_no_show`). S061 → 0065 (`profiles.formal_name`). **S063 → 0066** (`::notification_kind` casts in 4 RPCs) + **0067** (`get_match_card_payload` + `games_seeded`) + **0068** (`get_match_card_payload` sources scorers from `match_players` + cards).
- **pg_cron jobs live:** `auto-lock-matchdays` (`* * * * *`) · `vote-reminders` (`*/5 * * * *`).
- **Edge Functions live:** `notify-dispatch` (S048) · `purge-deleted-auth-user` (S051) · `notify-signup-outcome` (S051; `RESEND_API_KEY` set as Supabase project secret) · `render-match-card` (S054, redeployed 5× in S063; WOFF fonts via jsDelivr CDN fetch, crest base64 inline, twemoji `graphemeImages` for ⭐⚽🟨🟥, RENDER_VERSION = 3 cache key).
- **Authoritative plan:** `planning/FFC-masterplan-V3.0.md` (Phase 3 backlog: V3.0:139–148; awards V3.0:139 shipped S053; share PNG V3.0:140 shipped S054).
- **Session history:** `sessions/INDEX.md` + per-session logs at `sessions/S###/session-log.md`. Do not duplicate session narratives here.
- **Durable lessons:** `tasks/lessons.md` (inherits PadelHub's lessons too).
- **Open todo:** `tasks/todo.md` (`## NEXT SESSION` is the live agenda; older session blocks live in `tasks/_archive/`).
- **Maintenance reminder:** if any of CLAUDE.md / todo.md / lessons.md / INDEX.md crosses 30 KB or 1,000 lines, re-run the S050 trim cycle.

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
Working across work PC (`UNHOEC03`) and home PC (`User`).
- **OneDrive IS the main working tree.** Path: `C:/Users/UNHOEC03/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC/`. Edit files here directly.
- **Separate-git-dir architecture** — `.git/` lives OUTSIDE OneDrive, one per PC. Work PC: `C:/Users/UNHOEC03/FFC-git/`. Home PC: `C:/Users/User/FFC-git/`. The OneDrive `.git` file is a text pointer (`gitdir: <path>`) that must be rewritten on each PC. OneDrive syncs the pointer across PCs so it needs updating whenever you switch machines.
- **Sync via git, not OneDrive file sync.** Authoritative state is `origin/main`.
- **Git identity for FFC commits:** `git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com"` (repo-local config already set on both PCs).
- **Windows `gitdir:` pointer must use forward slashes.** Example on work PC: `gitdir: C:/Users/UNHOEC03/FFC-git`.

### Session-start sync protocol (MANDATORY — run before any work)
Every session must begin with this check to detect cross-PC lag (OneDrive may have synced working-tree files from the other PC while local `.git/` stayed at an older HEAD).

1. **Detect which PC** — `echo $USERNAME`. Work PC = `UNHOEC03`, Home PC = `User`.
2. **Fix the `.git` pointer** — read `FFC/.git`; it must say `gitdir: C:/Users/<this-pc-username>/FFC-git`. Forward slashes only.
3. **Fetch + inspect** — `git fetch` then `git status -sb` and `git log --oneline -5`.
4. **Branch check (NEW — prevents stale-branch disaster):**
   - Run `git rev-parse --abbrev-ref HEAD` to see the current branch.
   - If NOT on `main`: run `git log --oneline origin/main..HEAD` (our unique commits) AND `git log --oneline HEAD..origin/main | wc -l` (how far behind main we are).
   - **If the branch is more than 5 commits behind main → STOP and tell the user before doing any work.** Show them: branch name, how many commits behind, and the merge-base commit. Ask whether to switch to main or consciously continue on the stale branch.
   - If the branch is ≤5 commits behind → safe to continue; note it in the session briefing.
5. **Diagnose working tree:**
   - **(a) On main, clean + up-to-date** → proceed.
   - **(b) Behind origin/main AND working tree shows "modifications" matching the ahead commits** (cross-PC lag): `git stash push --include-untracked -m "<pc>-sync-s###"` → `git pull --ff-only` → `git stash drop`.
   - **(c) Genuinely uncommitted local work** (modifications NOT on origin/main) → ask the user before touching it.
6. **Announce the PC + branch + HEAD** in the session briefing.

Differentiator (b) vs (c): `git diff HEAD origin/main --stat` — if the listed files match `git status` output, it's (b).

**Why this matters (S053 post-mortem):** In S053 we spent a full session building AdminRosterSetup on `feature/fix-login`, which was 72 commits behind main. Main already had the feature built by S054–S059. PR #39 had to be closed without merging — all S053 code was abandoned. The branch check above catches this in 10 seconds at session start.

## Live operational gotchas (durable)
- **`ffc/vercel.json` SPA catch-all rewrite is LOAD-BEARING.** Deleting it 404s every non-root URL. Static-file precedence over rewrites is automatic, so it does NOT break `/sw.js`, `/manifest.webmanifest`, `/ffc-logo.png`.
- **Supabase MCP PAT is scoped to PadelHub org only** — `execute_sql` returns 403 on FFC. Use Supabase CLI (`npx supabase db push`, `db query --linked`) throughout.
- **`supabase gen types typescript --linked 2>/dev/null`** — the `2>/dev/null` redirect is mandatory; "Initialising login role…" diagnostic goes to stdout and corrupts the types file without it.
- **Windows OneDrive `&`-in-path bug:** `.bin/*.cmd` batch wrappers truncate at `&` in "11 - AI & Digital". FFC's `package.json` uses `node ./node_modules/<pkg>/bin/<bin>` direct invocation, not `npm run`. Vercel Linux CI is unaffected.
- **`supabase link`** uses cached auth token — no DB password needed on a machine already authenticated.
- **Multi-statement SQL via Supabase CLI requires `DO $$ BEGIN … END $$` block** — `db query --linked "UPDATE ...; UPDATE ...;"` errors out otherwise.
- **Supabase email validator rejects `example.com`** and throwaway domains. Test convention: `m.muwahid+s###<role>@gmail.com`.
- **Supabase "Confirm email" must stay OFF for Phase 1.** Flipping it ON re-breaks `Signup.tsx` Stage 1 silent-stuck bug; add the "check your inbox" handler first.
- **Google OAuth consent screen shows `hylarwwsedjxwavuwjrn.supabase.co`, not "FFC"** (Testing mode + default Supabase callback URL). Pro custom domain ($25/mo) would fix it — not worth it for a private league.
- **Migration 0012 DEFAULT PRIVILEGES covers `authenticated` only, NOT `service_role`.** Any new table that needs Edge Function (service_role) DML access must emit explicit `GRANT … TO service_role` in the same migration.
- **All admin SECURITY DEFINER RPCs need `is_admin()` body guard + `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO authenticated`.** Two-layer defense: helper-function NULL safety (S043 `COALESCE(...,false)`) + PostgREST EXECUTE gate (S047 migration 0033).
- **Supabase auth-key dual model trap:** `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` returns `sb_secret_*` (length 41) inside Edge Functions; the Functions gateway only accepts legacy JWT bearers AND `supabase-js`'s `createClient` only RLS-bypasses with the legacy JWT. Maintain a separate `LEGACY_SERVICE_ROLE_JWT` env var; for trigger-called Functions, use a custom shared-secret in a custom header for caller-auth.
- **Supabase realtime requires explicit `ALTER PUBLICATION supabase_realtime ADD TABLE`** before `postgres_changes` will fire. Verify via `pg_publication_tables`. The `postgres_changes` filter supports ONE column; secondary filters apply client-side.
- **`CREATE OR REPLACE FUNCTION` cannot change arg defaults or add parameters** — DROP + CREATE required (re-GRANT EXECUTE after).
- **`CREATE OR REPLACE VIEW` requires identical column signature.** Adding a `WHERE` predicate while keeping the SELECT shape unchanged means dependent views don't need rebuilding.
- **DATE columns need string-split, not `new Date(iso)`** — `new Date('2026-04-21')` parses as UTC midnight, renders as 20/APR on negative-offset TZs. Use inline `fmtDate(iso)` that splits and uses components directly.
- **Audit BEFORE destructive update / DELETE** for self-delete and admin RPCs — the audit log entry needs to survive even if the destructive path rolls back.
- **Terminal roles (`rejected`, future `banned`) must auto-`signOut` in `AppContext.tsx`** — not just render a display flag.
- **`as unknown as Json` for jsonb RPC args** — Supabase's generated `Json` type carries a structural index signature `[k: string]: Json | undefined` that hand-written interfaces lack.
- **Conditional-spread for optional RPC args:** `...(x ? { p_field: x } : {})` matches generated types' `T | undefined` without `as`-cast escape hatches. RPC args that are nullable must have `DEFAULT NULL` in PL/pgSQL or Supabase marks them required.
- **Router lives in `ffc/src/router.tsx`, NOT `App.tsx`.** `App.tsx` is just `<RouterProvider router={router} />`. Routes are configured as `createBrowserRouter` object literals — new screens add `{ path: 'foo', element: <Foo /> }` inside the `RoleLayout` children array, not as JSX `<Route>` elements. Any plan that says "modify App.tsx" should be auto-corrected to `router.tsx` (caught in S053 Task 3 by the implementer).
- **`tsconfig.app.json` has `noUnusedLocals: true` AND `noUnusedParameters: true`.** Skeleton commits that "pre-declare state for future tasks" won't compile. Pattern when implementing a multi-task scaffold: drop the unused symbols in the skeleton + comment-block document what later tasks must re-add + delete the comment block when the symbols come back (S053).

## Per-screen brand tokens
All in-app screens (`.po-screen` Poll, `.lb-screen` Leaderboard, `.pf-screen` Profile, `.mt-screen` Matches, `.lr-screen` Rules, `.st-screen` Settings, `.aw-screen` Awards [S053], `.admin-players`, `.admin-matches`, `.as-root` AdminSeasons, `.ah-root` AdminHome, `.ch-root` CaptainHelper, `.mer-screen` MatchEntryReview) declare a 12-token brand block at scope-root: `--bg:#0e1826` paper · `--surface` translucent panel · `--text:#f2ead6` cream ink · `--accent:#e5ba5b` gold · `--danger:#e63349` red · `--success:#4fbf93` · `--warn`/`--warning`. Auth screens (`.auth-screen`) and global `:root` defaults intentionally untouched. When existing CSS is already var()-based with fallbacks, scope-override at the screen root is a 20× better ROI than rule-by-rule editing.
