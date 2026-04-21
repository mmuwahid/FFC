# FFC

**Status:** Phase 1 implementation — **Steps 1 & 2 of V2.8 COMPLETE** (21/APR/2026, S017). PWA shell live at https://ffc-gilt.vercel.app. Database live at Supabase project `hylarwwsedjxwavuwjrn`: 20 tables, 11 migrations applied, 20 SECURITY DEFINER RPCs, RLS on all tables, 4 views, 7 app_settings rows, 5 scheduled_reminders, Season 1 + super_admin seeded. TypeScript types generated (`ffc/src/lib/database.types.ts`, 1816 lines). Next gate: Step 3 (auth flow — email/password + Google OAuth, real Welcome screen, self-signup pending flow, admin approval via `approve_signup` RPC). See `planning/FFC-masterplan-V2.8.md` → "Implementation sequencing notes".

FFC is a mobile-first PWA for managing a weekly 7v7 friends football league: Monday poll → Thursday game cycle, with match history, leaderboard, seasons, awards, and WhatsApp share integration.

## Stack
- **Frontend:** React 19 + Vite 8 + TypeScript 6 (PWA via `vite-plugin-pwa` — to be added in Step 1)
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

## Folder layout
```
FFC/
├── CLAUDE.md                  ← you are here
├── _wip/                      ← scratch / draft files (clean weekly)
├── archive/                   ← retired docs / code
├── docs/
│   └── superpowers/
│       └── specs/             ← design specs (YYYY-MM-DD-*.md)
├── ffc/                       ← Vite app (not yet scaffolded)
├── mockups/                   ← HTML mockups before implementing screens
├── planning/                  ← masterplan V1, V2, V3... (version always, never overwrite)
├── sessions/                  ← per-session logs (S001, S002, ...)
│   └── INDEX.md               ← session index
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
10. **Safe-area insets** on all fixed-position mobile elements.
    See `docs/platform/iphone-safe-area.md` for the authoritative implementation pattern.
    Mockup review MUST verify the 5 CSS check-points (listed in lessons.md S008 entry) AND that phone-frame CSS includes a simulated iPhone-14-Pro Dynamic-Island cutout.
11. **Supabase CLI:** `npx supabase` (same as PadelHub — global install is broken on work PC).
12. **Git repo temp clone path on Windows:** full path `C:/Users/UNHOEC03/AppData/Local/Temp/FFC`. Never use `/tmp/` inside Node `fs` calls — it resolves to `C:\tmp\` incorrectly.

## Cross-PC protocol
Working across work PC (`UNHOEC03`) and home PC.
- **Workspace moved out of OneDrive as of S015.** Primary path is now `C:/Users/UNHOEC03/FFC/` on each PC. OneDrive folder retained as read-only snapshot during transition; do NOT edit it.
- **Sync via git, not OneDrive.** `git pull` at start of session on each PC; `git commit && git push` at end. OneDrive is explicitly NOT the sync mechanism anymore (silent `.git/` corruption risk, can't share with collaborators).
- **Git identity for FFC commits:** `git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com"` (repo-local config already set on home PC — verify + set on work PC too).
- **First time on a new PC:** `git clone https://github.com/mmuwahid/FFC.git C:/Users/UNHOEC03/FFC` (Windows) — `schannel` backend handles TLS via OS cert store.
- **GitHub CLI (`gh`) is blocked by TLS cert-interception on this network** — Go binaries don't use Windows cert store. Use Chrome for repo/PR creation; raw `git` for everything else. See lessons.md S015 entries.

## Latest session
**S017 (21/APR/2026 home — Step 2 of V2.8 FULLY COMPLETE · 11 Supabase migration files applied · TypeScript types generated · CRLF chore · Windows build fix).**

**What landed in S017:**

- **CRLF normalization (commit `3cd2677`).** `.gitattributes` added (`* text=auto eol=lf` + binary exclusions). `git add --renormalize .` resolved all 47 pre-existing CRLF-drift files in a single chore commit. Zero content diff confirmed before committing.

- **11 Supabase migration files written and applied.** All files in `supabase/migrations/` per V2.8 §2.9 authoritative order: `0001_enums.sql` (18 enums + pgcrypto + pg_cron) → `0002_base_entities.sql` (profiles, pending_signups, seasons, matchdays) → `0003_match_data.sql` (match_guests, matches, match_players) → `0004_poll_ref_workflow.sql` (poll_votes, ref_tokens, pending_match_entries) → `0005_operational.sql` (notifications, player_bans, push_subscriptions, app_settings ×7, scheduled_reminders, admin_audit_log, draft_sessions, draft_picks, formations, format helpers) → `0006_views.sql` (4 views) → `0007_rls_helpers.sql` (4 STABLE role functions) → `0008_security_definer_rpcs.sql` (20 RPCs + log_admin_action + grants) → `0009_rls_policies.sql` (RLS on 20 tables) → `0010_pg_cron_bindings.sql` (fire_due_reminders wrapper) → `0011_seed_super_admin.sql` (super_admin profile, 5 scheduled_reminders, Season 1, pg_cron jobs via DO block).

- **Deployed via Supabase CLI.** `supabase link --project-ref hylarwwsedjxwavuwjrn` (cached auth, no DB password) + `supabase db push` applied all 11 migrations. Verified: 20 tables, 11 schema_migrations rows, 30 functions, 7 app_settings, 5 scheduled_reminders, Season 1, super_admin `m.muwahid@gmail.com`. Note: `auth_user_id = NULL` on super_admin profile — Step 3 sign-in flow will bind it via `approve_signup` RPC.

- **TypeScript types generated.** `supabase gen types typescript --linked 2>/dev/null > ffc/src/lib/database.types.ts` — 1816 lines. The `2>/dev/null` redirect is essential; without it the "Initialising login role..." diagnostic line goes to stdout and corrupts the types file (causes TS1434 errors).

- **`ffc/src/lib/supabase.ts` typed.** Added `import type { Database } from './database.types'`; changed client to `createClient<Database>(url, anonKey, ...)` with explicit `SupabaseClient<Database>` type annotation.

- **Windows build script fix.** `ffc/package.json` build script changed from `tsc -b && vite build` (`.cmd` wrappers truncate at `&` in the OneDrive path "11 - AI & Digital") to `node ./node_modules/typescript/bin/tsc -b && node ./node_modules/vite/bin/vite.js build`. Vercel Linux CI is unaffected; both environments now use the explicit node invocation.

- **Zero TypeScript errors confirmed.** `node ./node_modules/typescript/bin/tsc -b --noEmit` produced no output after wiring the Database type.

- **Commit `cab85b9`** — 16 files, 4260 insertions. Pushed to main (`3cd2677..cab85b9`).

**Supabase MCP note:** MCP PAT is scoped to PadelHub org only — `execute_sql` returns 403 on FFC project `hylarwwsedjxwavuwjrn`. Workaround: Supabase CLI throughout. No fix needed unless MCP access to FFC project is wanted (update PAT in Claude settings → MCP connectors → Supabase).

**Durable lessons captured** (see `tasks/lessons.md` S017 entries):
- `supabase gen types typescript --linked 2>/dev/null` — the `2>/dev/null` redirect is mandatory; "Initialising login role..." goes to stdout not stderr on first run.
- `supabase db query --linked "SQL"` is the correct syntax in CLI v2.90.0 (not `--remote`; `db execute` subcommand does not exist).
- `supabase link` uses cached auth token — no DB password needed on a machine already authenticated.

**Stats at S017 close:** repo `main` at `cab85b9`. 20 tables live. 11 migrations applied. `ffc/src/lib/database.types.ts` 1816 lines. Zero TS errors.

**Next: S018** — Step 3 of V2.8: auth flow (email/password + Google OAuth), real Welcome screen ported from `mockups/welcome.html`, self-signup pending flow (`pending_signups` INSERT), admin approval via `approve_signup` RPC, bind `auth_user_id` on super_admin. Acceptance: new user signs up → admin approves → user signs in → reaches `/poll`.

---

### Prior: S016 (21/APR/2026 home — Step 1 of V2.8 FULLY COMPLETE · elaborated scaffold live end-to-end · home-PC workspace aligned to separate-git-dir architecture). https://ffc-gilt.vercel.app now serves a real PWA shell — not the placeholder Vite template. Welcome page renders under PublicLayout; 13 spec-ref stubs wired through auth-aware react-router tree under PublicLayout / RoleLayout (4-tab bottom nav, 5-tab when admin) / RefLayout.

**What landed in S016:**

- **Home-PC workspace aligned** to the separate-git-dir architecture agreed in S015 follow-up commit `fa1c0a8` (OneDrive working tree + external per-PC `.git/`). Moved `.git/` out of a temp clone to `C:/Users/User/FFC-git/`; rewrote the OneDrive `.git` pointer from the work-PC path `C:/Users/UNHOEC03/FFC-git` to `C:/Users/User/FFC-git`; set `core.worktree` + `core.autocrlf=true`. Verified via `git status` from OneDrive path showing `On branch main · up to date with origin/main`; the 24 pre-existing "modifications" confirmed pure CRLF drift (zero content diff via `git diff --ignore-cr-at-eol --name-only`).

- **Step 1 — library layer.** `ffc/src/lib/supabase.ts` (client singleton, fails fast on missing env) · `ffc/src/lib/env.d.ts` (typed `ImportMetaEnv`) · `ffc/src/lib/AppContext.tsx` (plain-object Context per Rule #8 — `{ session, role, loading, signOut }`, subscribes to `onAuthStateChange`, role stays null until Step 2 lands profiles) · `ffc/src/lib/ErrorBoundary.tsx` (class boundary with reset button + fallback prop).

- **Step 1 — layouts (3).** `PublicLayout` (topbar only) · `RoleLayout` (topbar + 4-tab bottom nav: Home/Leaderboard/Profile/Settings; 5th Admin tab appears when `role ∈ {admin, super_admin}`) · `RefLayout` (stripped shell for `/ref/:token`). All safe-area-aware via CSS primitives.

- **Step 1 — pages (14).** `Welcome.tsx` (real content: FFC crest placeholder + "Friends, football, Thursdays." + Sign in / Request to join CTAs) + 13 stubs (Login · Signup · Poll §3.7 · Leaderboard §3.13 · Profile §3.14 · MatchDetail §3.15 · Settings §3.16 · RefEntry §3.4 · NotFound + admin/AdminHome · AdminPlayers §3.17 · AdminMatches §3.18 · FormationPlanner §3.19). Shared `StubPage` helper. One file per stub — each grows into a real screen in future sessions.

- **Step 1 — router.** `ffc/src/router.tsx` with `createBrowserRouter`. Index route is `<HomeRoute />` which conditionally renders `<Navigate to="/poll" replace />` when authed, `<Welcome />` otherwise. `/match/:id`, `/profile/:id`, `/admin/matches/:id/formation`, `/ref/:token` all param-reading. 404 fallback wired outside layouts.

- **Step 1 — global CSS rewrite.** `ffc/src/index.css` replaced Vite template styling entirely: safe-area tokens at `:root` (following `docs/platform/iphone-safe-area.md`), dark palette default + `:root.theme-light` opt-in + `:root.theme-auto` media variant, typography + reset (100svh shell, `overscroll-behavior-y:none`), layout primitives (`.app-shell` / `.app-topbar` sticky / `.app-bottom-nav` fixed with safe-area padding / `.app-main` / `.app-loading` / `.app-error`). Root width capped 560px centered.

- **Step 1 — index.html + manifest + vite config.** `index.html` now ships `viewport-fit=cover`, apple-mobile-web-app meta (capable/status-bar-style=black-translucent/title), light+dark theme-color meta, inline `#ffc-splash` painted pre-JS (CSS gradient FFC crest, hides on React commit via `requestAnimationFrame`). `public/manifest.webmanifest` (standalone/portrait/theme `#0e1826`/categories sports+social). `vite.config.ts` added `VitePWA` with `generateSW`, `manifest:false`, `workbox.cacheId=ffc-<ISO-timestamp>` (Rule #19 auto-satisfied), `clientsClaim:true`, `cleanupOutdatedCaches:true`, `navigateFallback:/index.html` (SPA routing).

- **Step 1 — entry points.** `ffc/src/App.tsx` reduced to `<ErrorBoundary><AppProvider><RouterProvider router={router} /></AppProvider></ErrorBoundary>`. `ffc/src/main.tsx` dropped Step-0 console.logs; imports `./lib/supabase` for fail-fast env validation; PROD-only SW registration via `new Workbox('/sw.js')` with `messageSkipWaiting` on `waiting` event (no forced reload — new SW takes over on next navigation).

- **Deleted Vite template cruft:** `src/App.css`, `src/assets/{hero.png,react.svg,vite.svg}`, `public/icons.svg`.

- **Two commits shipped:** `c7b2b74` Step 1 scaffold (36 files, +8,344 / −422) → first Vercel auto-deploy ERRORED in 7s with ERESOLVE (`vite-plugin-pwa@1.2.0` peers `vite<=7`, scaffold on `vite@8.0.9`). `dd0c00b` fix: `ffc/.npmrc` with `legacy-peer-deps=true` → redeploy Ready in 15s. Live alias `ffc-gilt.vercel.app` updated.

- **Verification end-to-end.** Local preview via `preview_start ffc-dev` on port 5174: Welcome renders under PublicLayout, `/login` stays PublicLayout, `/poll` flips to RoleLayout with 4-tab bottom nav, zero console errors, Welcome + Poll screenshots captured. Live curl: `GET /` → 200 (2088 B) with all expected meta tags + inline splash; `GET /manifest.webmanifest` → 200; `GET /sw.js` → 200.

**Durable lessons captured** (see `tasks/lessons.md` S016 entries):
- For any `--legacy-peer-deps` workaround accepted during a local install, commit an `.npmrc` with `legacy-peer-deps=true` in the same PR. CI installs ignore ambient `--flag` use.
- Test `gh auth status` at session start — takes <2s. S015's "gh blocked by Go-binary TLS wall" lesson was specific to one network at one moment; user confirmed `gh` works on both home PC (`gh auth status` shows `mmuwahid` auth'd with full `repo` scope) AND work PC now. Retracted.
- On Windows + OneDrive path with `&` in it (FFC's "11 - AI & Digital"), `.bin/*.cmd` batch wrappers truncate at `&`. Use `node ./node_modules/<pkg>/bin/<bin>` direct invocation, not `npm run <script>`. Vercel's Linux builds are unaffected.

**Direct-to-main workflow re-confirmed.** Every commit since repo creation goes to `main`; Vercel auto-deploys. User explicitly authorised S016 pushes during close-out.

**Stats at S016 close:** repo +37 files on `main` vs S015 close. Design spec unchanged (~3,100 lines). `_wip/` still empty.

**S017 COMPLETE** — Step 2 of V2.8 done. See `sessions/INDEX.md` S017 row and `~/.claude/session-data/2026-04-21-ffc-s017-session.tmp` for full close-out details.

---

### Prior: S015 (21/APR/2026 home — Phase 1 implementation kickoff · Step 0 of V2.8 FULLY COMPLETE · infrastructure live end-to-end).
GitHub + Supabase + Vercel all wired; https://ffc-gilt.vercel.app live with env vars verified resolving in production build (lengths 40 / 46 confirm zero newline drift). Workspace initially migrated OneDrive → `C:/Users/UNHOEC03/FFC/` (later reversed at S015 follow-up commit `fa1c0a8` — separate-git-dir architecture adopted instead). GitHub `mmuwahid/FFC` private, 5 commits on `main`. Supabase project `hylarwwsedjxwavuwjrn` in new FFC org, `ap-south-1` Mumbai, Healthy. Vercel `prj_2NszuyOepArCTUAJCOxH8NsAAeSv` Git-connected Root Directory `ffc`. 6 env vars wired (URL × 3, publishable key × 3 — legacy JWT retired). React 19.2.5 + Vite 8.0.9 + TS 6.0.2 (scaffold default). Four lessons captured (PowerShell echo-pipe newlines; Go-binary TLS wall — RETRACTED at S016; Vercel preview empty-string arg; README paths in gitignored dirs). See full narrative in `sessions/S015/session-log.md`.

---

### Prior: S014 (21/APR/2026 home — masterplan V2.8 · formal Phase 1 approval · collaborator Word brief with 10 embedded mockups — FULL CLOSE).

**Item 1 — Masterplan V2.8 landed** (`planning/FFC-masterplan-V2.8.md` · 378 lines · within the 350–500 target). Consolidates all S009–S013 deltas on top of V2.7. Structure: revision history (5 S013 delta groups) · §§1–15 carryover pointing to V2.7 for unchanged sections · **§16 NEW — 5v5/7v7 Multi-Format Support** (decisions table + data-model table + format-awareness convention table + UI parameterisation table) · Section 2 delta with SQL for new helpers (`effective_format` · `roster_cap` · `log_admin_action`) + CHECK expansion · 10-drift reconciliation table · **authoritative 11-file migration order** (supersedes V2.7's list) · **implementation sequencing notes** — 4 ordered steps each with acceptance criterion. Heavy use of markdown tables per `feedback_table_presentation.md`. V2.7 and prior preserved untouched.

**Item 2 — Phase 1 design FORMALLY APPROVED.** `CLAUDE.md` status header flipped from `Brainstorming (pre-implementation). Design Phase 1 not yet fully approved. Code not started.` → `Design Phase 1 APPROVED — implementation ready. Formally approved by user on 21/APR/2026 (S014) after masterplan V2.8 consolidation landed. Code not yet started. Next gate: repo + Supabase project + Vite scaffold.` Memory file `project_ffc.md` updated with **4 edits** (frontmatter description · opening paragraph · masterplan reference · Latest/Next session blocks). `project_ffc.md` now declares S014 as latest and S015 plan as "implementation kickoff + logo rollout + first feature slice."

**Item 3 — Collaborator Word brief built.** `docs/FFC-Collaborator-Brief.docx` · **14.2 MB · 305 paragraphs · 33 archive files · all 10 approved mockup PNGs embedded.** Sections: Cover · Executive Summary · What We're Building · Core Features · Tech Stack · Current Progress · Data Model Snapshot · 10-page mockup gallery · What's Next. Built via `docs/build-collaborator-brief.js` (Node · `docx-js`) — kept as a reusable artifact for future updates. Infrastructure: pivoted from `preview_screenshot` (timed out at 30s) to headless Chrome (`chrome.exe --headless=new --screenshot --window-size=1400,3200`) for direct-to-disk PNGs; caught a bash path bug (mixed forward/back slashes broke `${f}` expansion — fixed by forward slashes end-to-end). 10 PNGs in `docs/brief-screenshots/` (~13 MB total: welcome 872 KB · all others 439 KB–1.7 MB · captured at 1400×2400/3200). Sanity-checked docx via `python -c zipfile + xml.etree` — valid structure, XML parses cleanly, all 10 media files embedded at expected sizes. Skill's `validate.py` crashed on Windows cp1252 encoding of its own Unicode output (a validator problem, not a docx problem).

**Durable operational note (not a new UI rule):** Bash on Windows with mixed forward/back slashes can silently break variable expansion inside double-quoted path strings. Default to forward slashes end-to-end. Also noted: the skill's `validate.py` is not Windows-console safe even after Python deps install.

**Stats at S014 close:** design spec **unchanged** (~3,100 lines · 20 tables · 20 RPCs · 18 enums · 19 notification kinds · 7 app_settings keys · 9 approved mockups). Masterplan **V2.7 → V2.8** (378 lines).

**Next: S015** — **Implementation kickoff.** (a) Logo rollout once user exports transparent PNG/SVG from `shared/FF_LOGO_FINAL.pdf` (512/192/180/32 PNG + SVG master + WhatsApp OG 1200×630) → wire into welcome + all 9 mockups. (b) **Steps 0–2 of V2.8 sequencing** — GitHub repo `mmuwahid/FFC` (private) with committer identity `m.muwahid@gmail.com` · Supabase project (separate org from PadelHub's `nkvqbwdsoxylkqhubhig`) · Vercel project on team `team_HYo81T72HYGzt54bLoeLYkZx` with env vars · Vite React PWA scaffold inside `ffc/` using PadelHub boot patterns (inline splash · safe-area CSS · service worker · ErrorBoundary · plain-object Context) · run 11 migration files in `§2.9` order (`0001_enums.sql` → `0011_seed_super_admin.sql`) · seed super-admin · smoke-test `npx supabase` + hello-world Edge Function. (c) **Step 3 of V2.8 sequencing** — first feature slice: auth + welcome + self-signup pending → approval → ref token unlock → §3.7 Poll screen state machine up to State 3. Palette re-alignment still on backburner. See `sessions/S014/session-log.md`.

---

### Prior: S013 (21/APR/2026 home — full spec walkthrough + S009–S013 delta consolidation + 5v5/7v7 multi-format spec — PARTIAL CLOSE).
Ten spec sections reviewed section-by-section with user approval at each — §1 · §2.1–§2.9 · §3.0 · §3.2–§3.6. **23 distinct edits** applied across items 1–5 + item 8 (archive). §1 non-goal fix scoping auto-pick to Phase 2. **§2 Data Model** landed all S009–S011 deltas: 3 new enums (`user_role += rejected` · `draft_status` · `draft_reason`) · 6 new `notification_kind` values · 2 new columns (`profiles.reject_reason` · `match_players.substituted_in_by`) · 4 new tables (`admin_audit_log` · `draft_sessions` · `draft_picks` · `formations` with `shared_at` gating + `formations_pattern_valid` CHECK) · 3 new `app_settings` keys · **7 new RPCs** (13 → 20) plus private `log_admin_action` helper + admin-audit convention · 4 new RLS policy blocks. **§3.0 + §3.2–§3.6**: 10 drift fixes reconciling S002 sub-designs against authoritative §2 DDL (`voted_at`→`committed_at` · `profiles.is_admin boolean`→`role user_role` enum · `match_guests.goals_scored`→`match_players via guest_id` (Section 2 prologue had flagged this since S003 — finally fixed) · "your position changed" notification formally retired). **5v5/7v7 multi-format** — 4 decisions locked: A(i) captain min-matches stays 5 · B(i) unified leaderboard · C(i) unified profile · D(i) per-season storage only. `match_format` enum + `seasons.default_format` + `matchdays.format` nullable + helpers (`effective_format`, `roster_cap` → 14/10) + 5v5 formation patterns (1-2-1 · 2-1-1 · 1-1-2) + 10 surfaces parameterised. **§3.14 + §3.19 CSS contracts** persisted (`.card { flex-shrink: 0 }` · sticky tabbar · `.phone-inner > * { flex-shrink: 0 }` defensive rule · native `<select>` GK picker). **3 WIP files archived.** New feedback memory: `feedback_table_presentation.md` (tables, not prose walls). Spec ~2,940 → ~3,100 lines. Masterplan V2.8 deferred to S014.

---

### Prior: S012 (21/APR/2026 home — mockup review round 2 + bug fixes + brand logo + 5v5/7v7 scope lock — PARTIAL CLOSE).
User reviewed Section 1 + all 9 phone mockups. **7 approved:** Poll · Admin Matches · Admin Players · Settings · Match Details · Leaderboard · Captain Helper. **2 fixed this session:** (1) Player Profile — `.card` compressed + tabbar position bug → `.card { flex-shrink: 0 }` + `position: sticky; margin-top: auto`. (2) Formation — every `.phone-inner` child compressed → defensive rule `.phone-inner > * { flex-shrink: 0 }`. GK picker converted from radio-card to native `<select>`. Brand discovered in `shared/`; palette re-alignment deferred. Logo wired into Poll as `ffc-logo.jpg` stopgap. **New scope — 5v5/7v7 multi-format locked** (spec work landed in S013).

---

### Prior: S011 (21/APR/2026 home — bug fix + spec integration + masterplan V2.7 — FULL CLOSE).

**What landed in S011:**
1. **Statusbar `flex-shrink: 0` fix (CRITICAL — diagnosed S010, fixed S011).** Applied to all 9 phone-frame mockups. Root cause: `.phone-inner` is `display: flex; flex-direction: column`; `.statusbar` defaulted to `flex-shrink: 1`, causing it to compress from 59px → 17–25px when Profile or Formation content overflowed 844px. Fix verified via DOM inspection: both Profile and Formation compute `.statusbar` height = 59px ✅. Applied defensively to all 9 screens (not just the 2 affected ones).
2. **§3.7 Poll spec fully synced** — "Nine key states" header. State 6 updated (green `[Keep my spot]` + red `[Cancel anyway]`). **State 6.5 "Draft in progress"** inserted: live Supabase realtime view of `draft_sessions` + `draft_picks` — LIVE chip + pulsing dot + two-column picks-so-far + pool + last-pick footer. State 7 updated (green/red). State 8 updated to two-section layout (WHITE TEAM + BLACK TEAM, no per-row pills). AC9 + AC10 added. **Post-lock substitution + captain reroll sub-section** appended: `dropout_after_lock` notification → captain modal `[Accept substitute]` green / `[Request reroll]` amber → reroll creates new `draft_sessions` row `reason='reroll_after_dropout'`; 12h cutoff before kickoff.
3. **§3.16 Settings spec v2** — dark default (was `system`). Push prefs updated (6 keys: removed `position_changed`, added `dropout_after_lock`; `poll_reminder` = 2 min before close). Pill-toggle UI documented. AC1–AC7 block. Section-5 wiring stub added.
4. **§3.18 Admin Matches** — Phase 5.5 "Draft in progress" inserted in phases ladder with "Force complete / Abandon" admin actions. Always-visible 14-player roster documented (no tap-to-expand).
5. **§3.19 Formation planner (NEW full Depth-B spec)** — 7 formation patterns, drag-drop pitch tokens, rotating-GK toggle (`Dedicated GK` vs `Rotate every 10 min`), starting-GK picker, auto-assign rotation numbers 1–6, team-colour header strip, realtime sync to team members, 12 acceptance criteria. `formations` DDL included.
6. **Masterplan V2.7 written** (`planning/FFC-masterplan-V2.7.md`) — full S009+S010+S011 consolidation: 3 new enums, 4 new tables, 2 new columns, 6 new RPCs, 2 new `app_settings` flags, 6 new notification types, 11-step migration order.

**Authoritative files:**
- `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` — Phase 1 design spec (feature-complete)
- `planning/FFC-masterplan-V2.7.md` — latest; V2.6 and earlier preserved
- All 10 mockups in `.superpowers/brainstorm/635-1776592878/content/`
- `tasks/lessons.md` — S009 + S010 rows present (env() + statusbar v2 + statusbar v2.1)

**WIP files (integrated, ready to archive):**
- `_wip/item-b-draft-reroll-spec.md` · `_wip/item-settings-v2-amendments.md` · `_wip/item-formation-planner-spec.md`

**Next: S012** — User review pass on full Phase 1 design spec. Read all sections, flag remaining gaps or amendments, then formally approve Phase 1 design. Implementation begins after approval.

---

### Prior: S010 (21/APR/2026 home — mockup review round + partial close)
User reviewed all 5 S009 mockups. 4 approved (Captain helper · Leaderboard · Match detail · Admin players). 5 amendments applied via parallel subagent pass. 4 durable rules saved to memory. One critical layout bug diagnosed personally but NOT fixed — deferred to S011. Spec integration + masterplan V2.7 also deferred. See `sessions/S010/session-log.md`.

---

### Prior: S009 (20/APR/2026 home — marathon, forced pause at token limit)
Items 0–6 of S008 plan DONE. Mid-session scope expansion captured. Item 7 (close-out + masterplan V2.7) deferred to S010. See `sessions/S009/session-log.md` for the full handoff with open items + subagent prompts to relaunch if needed.

**What landed in S009:**
1. **Safe-area retrofit (2 iterations).** v1 used `env(safe-area-inset-top, 59px)` — wrong because `env()` resolves to `0px` on desktop (var IS defined) so the fallback never fires. v2 hardcodes `--safe-top: 59px` etc. on `.phone` AND sets `.statusbar { height: var(--safe-top); display: flex; justify-content: space-between; align-items: center; }` so time/battery FLANK the Dynamic Island on left/right (matching real iOS), not pushed below it. All 7 phone mockups use v2 pattern; 3-16 also v2 via subagent.
2. **§3.0 Platform safe-area** cross-cutting sub-section added. **CLAUDE.md Rule #10 paragraph bump** (this file, below).
3. **§3.7 Poll — State 8 "Teams revealed"** landed in spec + mockup mini-tile (closes the S005 team-colour-preview open item).
4. **§3.15 Match-detail** upgraded STUB → full Depth-B + new `3-15-match-detail.html` mockup.
5. **§3.16 Settings NEW** — Depth-B + `3-16-settings.html` mockup (subagent). Settings v2 amendments applied by follow-on subagent: **default theme = dark** · remove `position_changed` · `poll_reminder` fires 2 min before poll close · new `dropout_after_lock` notification. Scratch at `_wip/item-settings-v2-amendments.md` ready to integrate into master §3.16 at S010.
6. **§3.17 Admin Players + §3.18 Admin Matches** Depth-B + 2 new mockups.
7. **§2.7 new RPCs** — `set_matchday_captains` + `update_guest_stats` + `match_guests.updated_by/updated_at` audit cols.
8. **FFC naming corrected** — "Friends FC" / "Friends Football Club" removed from CLAUDE.md line 1 + poll-mockup crest text. Historical session logs (S001, S008) preserved. User memory saved: `user_app_name.md` — app is **FFC only**, never expand the acronym.
9. **Crest upgrade** — shield-monogram "FFC" in poll mockup (placeholder until real logo asset).

**What's drafted but NOT INTEGRATED yet** (priority items for S010):
- **Subagent B scratch (`_wip/item-b-draft-reroll-spec.md`, 329 lines):**
  - **NEW §3.7 State 6.5 "Draft in progress"** — live view of captain-pick session via Supabase realtime on new `draft_sessions` + `draft_picks` tables. Players see picks flow WHITE ↔ BLACK as captains take turns.
  - **NEW §3.7 sub-section: Post-lock substitution with captain reroll** — when player X cancels within 24h, sub Y auto-promotes from waitlist, captain of team T gets modal `[Accept substitute]` green / `[Request reroll]` amber; reroll creates a fresh `draft_sessions` row with `reason='reroll_after_dropout'`; 12h cutoff before kickoff; captains themselves cannot be reselected.
  - §3.18 touch-up for "Phase 5.5 · Draft in progress" + admin force-complete action.
- **Subagent C (formation planner §3.19) — in-flight at pause:** check `_wip/item-formation-planner-spec.md` + `3-19-formation.html` at S010 open; relaunch if missing (prompt in `sessions/S009/agent-prompts.md`). 7v7 pattern picker (2-3-1 / 3-2-1 / 2-2-2 / 3-1-2 / 2-1-3 / 1-3-2 / Custom), drag-drop tokens on top-down pitch, share-to-team via `share_formation` RPC, non-captains see live-synced read-only view. 24h-before-kickoff entry window.

**Remaining 3-7 mockup work for S010:**
- State 7 mini-tile buttons: green `[Keep my spot]` + red `[Confirm cancel]` (durable rule: green = confirm-safe, red = confirm-destructive).
- State 8 mini-tile: expand to show 2-team roster — WHITE header + 7 rows, BLACK header + 7 rows (currently only 3 proof-of-concept rows).
- Add State 6.5 tile for Draft in progress (after subagent B integration).

**Data-model amendments queued for masterplan V2.7** (consolidated in S009 log):
- New tables: `admin_audit_log` · `draft_sessions` · `draft_picks` · `formations`.
- New columns: `profiles.reject_reason` · `match_players.substituted_in_by`.
- New enums: `rejected` on `profile_role` · `draft_status` · `draft_reason`.
- New RPCs: `edit_match_result` · `promote_from_waitlist` · `accept_substitute` · `request_reroll` · `submit_draft_pick` · `upsert_formation` · `share_formation`.
- New notifications: `dropout_after_lock` · `draft_reroll_started` · `reroll_triggered_by_opponent` · `captain_dropout_needs_replacement` · `formation_reminder` · `formation_shared`. REMOVED: `position_changed`.
- New app_settings: `draft_stuck_threshold_hours` (default 6) · `reroll_cutoff_hours_before_kickoff` (default 12) · `poll_reminder_offset_minutes` (default -2).

**Durable rules added this session:**
- **Safe-area mockup pattern** — hardcode `--safe-top: 59px; --safe-bottom: 34px; --safe-left: 0px; --safe-right: 0px;` in mockup `.phone`. Statusbar = `height: var(--safe-top); display: flex; justify-content: space-between;` — time/battery flank island, NEVER `padding-top: var(--safe-top)`.
- **Green/red button colour rule** — safe-confirm = green, destructive-confirm = red. App-wide.
- **FFC naming rule** — app is "FFC" only. Never expand.

---

### Prior: S008 (20/APR/2026 work — framing session, all decisions locked before handoff)
No spec drafting — decisions captured and new platform concern researched. Decisions LOCKED in S008:

1. **§3.7 Poll team-colour preview = Option A** (full state 8). VOTE STATUS CARD gains `You're on ⚪ White / ⚫ Black` row; every roster row (members + guests) gains `[W]/[B]` pill. Triggers when `match_players` rows exist for the active matchday. **Closes S005 open item.**
2. **§3.15 Match-detail sheet:** W/D/L chip = profile-owner's perspective · guest rows = lighter (goals/cards inline same as members, no S007 rating chip / description) · wide-viewport = ≥768px → max 640w × 80vh (provisional, user to verify on S009 mockup).
3. **Settings screen = 6 rows** (Theme · Push prefs · Leaderboard sort · Positions re-entry · **Display name (new)** · Account). Extras (about/version, T&P, data-export) deferred to Phase 2+. State tile #2 = first-visit push-permission-prompt (signed-out dropped — screen is auth-gated per §3.0).
4. **NEW — iPhone notch / Dynamic Island handling** researched (see `_wip/iphone-safe-area-research.md`). Pattern = `viewport-fit=cover` meta + CSS `env(safe-area-inset-*)` custom props on fixed-position elements. Dynamic Island uses same `env(safe-area-inset-top)` as classic notch — no special handling. **GAP DISCOVERED:** all 5 approved S005–S007 mockups (Poll, Leaderboard, Profile, Captain helper, Welcome) lack safe-area CSS despite CLAUDE.md Rule #10 committing us to it at spec level. Retrofit queued for S009.

**Lesson logged:** mockup review checklist never verified Rule #10 enforcement. New rule captured in S008 log: every mockup must verify `viewport-fit=cover` + `env(safe-area-inset-*)` on fixed elements before approval; mockup phone-frame CSS needs a simulated iPhone-14-Pro notch so the obstruction is visually obvious at review time.

S009 (home PC) resumes with 7 execution items — see `tasks/todo.md` NEXT SESSION block.

---

### S007 (20/APR/2026 work) — previous session
Single-session marathon that closed every item queued at S006 + surfaced and repaired a documentation gap inherited from S005. Poll + Leaderboard + §3.14 (refined) + §3.1-v2 mockups all user-APPROVED.

**Guest-stats Q1–Q6 applied.** §2.1 +2 enums (`guest_rating`, `guest_trait`) · §2.3 `match_guests` +6 columns + 2 CHECKs + S007 migration note · §3.5 invite flow amended with two-step form (name → "Tell us about your +1" 6-field step · app-layer enforces required fields · DB nullable for Phase 2 quick-invites) · §3.7 poll mockup guest rows restructured to 3-line layout (name + rating chip + pills + time · "+1 · invited by …" subtitle · italic description).

**§3.7 Poll screen Depth-B spec PERSISTED.** S005 said "SPEC COMPLETE" but the spec text was never written into the design-spec file. Reconstructed from scratch — purpose · 4 entry points · data read/write · ASCII layout · 7 key states · member vs guest row rendering contract · tap targets · theme/safe-area · 7 acceptance criteria · errors · notifications · Phase-2 deferred.

**§3.14 Player profile REFINED (R1–R6) — v3 APPROVED.** User surfaced bugs + scope change mid-session:
- **R1** W-D-L alignment — CSS specificity collision: `.kpi .l` (label) was overriding `.wdl-triplet .l` (loss digit). Fixed with explicit override block.
- **R2** Last-5 circle centering — `letter-spacing: 0.02em` nudged the glyph off-centre. Fixed.
- **R3** **MP (matches-played)** added to Season stats grid.
- **R4** Rank removed from KPI grid (still shown as card-header hint `rank 1st 🥇`).
- **R5** **Totals card REPLACED with Achievements card** — user feedback: "just data without explanation". 6 tiles: ⭐ MOTMs · 🔥 W-streak · 🎯 Goals · 🟨 Yellows · 🟥 Reds · 📉 L-streak. Scope dropdown retired.
- **R6** Zero-match career state — CTA now replaces Achievements card.

**§3.1-v2 Captain helper reconciled APPROVED** — Depth-B spec + v1 mockup (light formula-mode + dark randomizer-mode phones + 4 state tiles). Supersedes §3.1 (S002 first-pass). Single screen · visible mode toggle (formula when season ≥ 5 approved matchdays, randomizer when < 5) · 3-criteria triplet · 3-section candidate list · **guest subsection** (read-only, S007 stats visible, cannot captain) · **pair-confirmation sheet** with White=weaker auto-assignment + rank-gap ✓/⚠ badge (gap>5 = amber warning + "Proceed anyway?" sub-modal, NOT a hard block). New RPC queued for §2.7 Part 5B: `set_matchday_captains(matchday_id, white_profile_id, black_profile_id)`.

**Masterplan V2.6** written — captures S006 leaderboard decisions + S006/S007 profile decisions + §3.15 stub + §3.1-v2 + guest-stats model. 2 new numbered sections (§11 Leaderboard Sort Preference · §12 Guest Player Stats). V2.5 preserved. Design spec grew ~1,573 → ~1,990 lines.

Current authoritative docs:
- `planning/FFC-masterplan-V2.6.md` — latest; V2.5 and earlier preserved.
- `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` — Section 1 APPROVED · Section 2 APPROVED (amended S005 + S006 + S007) · Section 3.0 APPROVED · **§3.7 Poll APPROVED (spec + v3 mockup)** · §3.1 **SUPERSEDED** · **§3.1-v2 Captain helper APPROVED (spec + v1 mockup)** · **§3.13 Leaderboard APPROVED** · **§3.14 Player profile APPROVED (v3 w/ R1–R6)** · **§3.15 Match-detail STUB** · §3.2–§3.6 from S002 carry.
- `sessions/S007/session-log.md`
- `.superpowers/brainstorm/635-1776592878/content/3-7-poll-screen.html` — approved v3.
- `.superpowers/brainstorm/635-1776592878/content/3-13-leaderboard.html` — approved v2.
- `.superpowers/brainstorm/635-1776592878/content/3-14-player-profile.html` — approved v3.
- `.superpowers/brainstorm/635-1776592878/content/3-1-v2-captain-helper.html` — approved v1.

**Durable preferences (apply app-wide, auto-load next session):**
- DD/MMM/YYYY uppercase date format for all user-facing surfaces (storage stays ISO).
- **W-D-L triplet in green W / grey D / red L wherever W-D-L appears** (leaderboard, profile cards, match detail, captain helper, anywhere else).
- Fixed column widths preferred over `auto` whenever a column can appear or disappear based on data — row-to-row alignment stability is a first-class design property.
- **No data without explanation.** Stats surfaces pair numbers with context (narrative, comparison, trend). The Totals card was deleted specifically for violating this.
- **CSS specificity collision** is the first suspect when a layout bug reports inconsistent fonts/spacing between element siblings (`.kpi .l` vs `.wdl-triplet .l` is the canonical example).
- Visual Companion browser is for genuine visuals only; never duplicate terminal text.
- Fixed column widths preferred over `auto` whenever a column can appear or disappear based on data — row-to-row alignment stability is a first-class design property.

**NEXT:** S009 (home PC) — decisions already locked in S008, so S009 is execution-only. (1) **Safe-area retrofit** on all 5 approved mockups + add notched-phone frame to mockup CSS template; (2) **§3.7 spec amendment** — add State 8 "Teams revealed" per Option A, delete the Phase-2-deferred line (line 1512), update `3-7-poll-screen.html` with State 8 tile; (3) **§3.15 match-detail** full Depth-B + mockup (W/D/L from profile-owner perspective, guest rows lighter, 640w×80vh wide); (4) **Settings** Depth-B + mockup (6 rows incl. display-name, push-permission-prompt tile); (5) **§2.7 RPCs** — `set_matchday_captains` + `update_guest_stats` + `match_guests.updated_by/.updated_at` audit cols (triggers masterplan V2.7 bump); (6) **Admin Players + Matches** Depth-B + mockups; (7) **Promote Rule #10** to a §3.0 sub-section + promote `_wip/iphone-safe-area-research.md` out of `_wip/`. Cold-start checklist in `tasks/todo.md` NEXT SESSION block.
