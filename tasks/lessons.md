# FFC Lessons Learned

FFC inherits **all lessons** from `Padel Battle APP/tasks/lessons.md` — read that before writing any FFC code. Every Critical Rule there applies here too.

The original prose-heavy lessons (S008–S049) are archived at [`_archive/lessons-pre-distill.md`](_archive/lessons-pre-distill.md). This file is the distilled rule set.

## Critical Rules (Always Enforce — inherited from PadelHub)
1. Mockup-first workflow. HTML mockup → user review → finalize → implement.
2. No design changes without explicit approval.
3. Placeholder data only in mockups. No invented names / leagues / stats.
4. Version control planning docs. V1, V2, V3. Never overwrite.
5. Never regenerate user documents. Edit originals.
6. Match existing app styling in mockups. Copy CSS from most recent approved mockup.
7. Safe-area insets for all fixed-position elements on mobile.
8. Verify before pushing fixes: run dev server, check console, visually verify.
9. When adding inline state-driven UI, declare `useState` first. Grep to confirm.
10. **CRITICAL: verify DB columns exist before any Supabase `.select()` / `.update()`.** Extends to `.order()` / `.filter()` / `.in()` column references too — TypeScript's PostgREST client accepts any string, drift is silent until runtime.
11. Never use `useMemo` for React Context with derived state. Plain object.
12. Never place hooks after conditional returns.
13. Global `<style>` must live in main render, not early-return subtree.
14. SECURITY DEFINER RPCs for all Edge Function DB access (never service-role + direct queries).
15. RPC parameters receiving JSON should be typed `TEXT`, cast to `JSONB` internally.
16. After `CREATE TABLE` via SQL editor: `GRANT SELECT, INSERT, UPDATE, DELETE ON public.X TO authenticated, anon;` — RLS ≠ GRANT, missing grants silently return empty rows.
17. Always include `window.location.search` in `redirectTo` URLs (OAuth + reset).
18. Always scope `.delete()` / `.update()` with `.eq("league_id", ...)` — defense-in-depth beyond RLS.
19. Bump service-worker `CACHE_NAME` on every major deploy. Format: `ffc-vN`.
20. Full Windows path in Node scripts: `C:/Users/User/AppData/Local/Temp/FFC/...` — never `/tmp/`.
21. CRLF-aware string replacements on Windows git clones.
22. After triggering React state changes in `preview_eval`, wrap DOM reads in a 200–300ms timeout.
23. Git identity for FFC commits: `git -c user.name="Mohammed Muwahid" -c user.email="m.muwahid@gmail.com"`.

## Mockup safe-area (S008–S012)
- **Every mockup review verifies safe-area** — `viewport-fit=cover` meta + simulated Dynamic-Island cutout in phone-frame CSS + `padding-top: var(--safe-top)` on `.topbar` + `padding-bottom: var(--safe-bottom)` on bottom nav + sheets pad with `calc(var(--safe-bottom) + 16px)`. Reference: `docs/platform/iphone-safe-area.md`.
- **Hardcode safe-area values in mockups** — `--safe-top: 59px; --safe-bottom: 34px`. `env(safe-area-inset-*, 59px)` fallback fires only when env var is unrecognised; modern browsers resolve to `0px` (defined value) so fallback never triggers.
- **Statusbar pattern:** `.statusbar { height: var(--safe-top); display: flex; align-items: flex-end; justify-content: space-between; padding: 0 calc(28px + var(--safe-right)) 8px calc(28px + var(--safe-left)); flex-shrink: 0; }` — flex-end positions time/battery 8px below the island; `flex-shrink: 0` prevents content overflow from compressing it.
- **`.phone-inner > * { flex-shrink: 0 }`** — phone-frame is a scroll container, not stretch container; ANY child with `overflow: hidden` (cards, pitch-wraps) gets shrunk to 0 by flex spec without this. Applies to all phone-frame mockups.
- **Sticky bottom-nav, never absolute** — `.tabbar { position: sticky; bottom: 0; margin-top: auto; flex-shrink: 0; z-index: 10 }`. Absolute inside scroll container anchors to scroll-content-bottom, not viewport-bottom — appears mid-screen when content overflows.

## Windows + OneDrive workflow (S015–S016)
- **OneDrive working tree + external `.git/` per PC.** `git init --separate-git-dir=C:/Users/<user>/FFC-git`. The `.git` pointer file syncs via OneDrive across PCs but git's object DB stays local. Authoritative source = `origin/main`.
- **Bypass `.bin/*.cmd` wrappers** when project path contains `&` (e.g. "11 - AI & Digital") — cmd.exe truncates at `&`. Use `node ./node_modules/<pkg>/bin/<bin>` directly in `package.json` scripts.
- **Vercel env vars on Windows:** `vercel env add <NAME> <env> --value "<v>" --yes` (positional env, `--value` flag, `--yes`). Preview takes empty-string positional branch arg. Never pipe stdin via `echo |` — captures trailing `\n`. Add `console.log(..., '(len:', v.length, ')')` runtime canary.
- **`.npmrc` in package root for peer-dep workarounds** — `legacy-peer-deps=true`. `--flag` doesn't persist across CI's clean `npm install`.
- **`SSL_CERT_FILE` for Go-binary CA-pool failures** — Go CLIs (`gh`, `docker`, `kubectl`) bundle Mozilla CAs and ignore Windows cert store. Export OS roots to PEM, point env var, restart shell. Raw `git` works without this (uses schannel).

## Schema + RPC verification (S024–S028, S046–S047)
- **Before referencing any column, function, enum, or view, query it from `pg_*` / `information_schema`.** Spec prose is not authoritative — DDL is. plpgsql lazy-parses function bodies so CREATE passes but first call fails on bad column/enum/cast.
  - Columns: `information_schema.columns WHERE table_name='X'`
  - Function signatures: `pg_get_function_identity_arguments(oid)` from `pg_proc`
  - Enums: `pg_enum` joined to `pg_type`
  - View projection: `pg_views.definition` or `information_schema.columns WHERE table_name='v_X'`
- **Schema-drift check applies to enum VALUES** too — even when a sister enum makes the value space look "obvious." `match_result` is `'win_white'|'win_black'|'draw'` (S046).
- **Generate migration DDL for REVOKE/GRANT programmatically from `pg_proc`**, not by hand-typing from prior migrations. Function signatures evolve (`ban_player` 2→3 arg, `admin_submit_match_result` arg-order change).
- **`CREATE OR REPLACE FUNCTION` cannot change arg defaults or add parameters** — DROP + CREATE required (re-GRANT EXECUTE after).
- **`CREATE OR REPLACE VIEW` requires identical column signature** — body can change freely (e.g. add `WHERE pr.deleted_at IS NULL` predicate) without rebuilding dependents.
- **`log_admin_action` is 4-arg** `(target_entity, target_id, action, payload)` — admin derived internally via `current_profile_id()`. Don't pass admin id.
- **Audit BEFORE destructive update / DELETE** — audit row needs to survive even if destructive path rolls back (S034 `delete_season`, S049 `delete_my_account`).
- **`admin_audit_log` columns:** `target_entity`, `target_id`, `payload_jsonb` (NOT `target_table`). See `docs/admin-audit-sql.md`.
- **`edit_match_result` is narrow** — score/result/MOTM/notes only, requires `approved_at IS NOT NULL`, no nested `players`. Use `edit_match_players` for per-player post-approval edits.
- **`bans` live on `public.player_bans`** (`profile_id`, `starts_at`, `ends_at`, `revoked_at`) — NOT a column on profiles. `rejected` lives on `profiles.role`. `inactive` on `profiles.is_active=false`.
- **Migration number collision check:** `ls supabase/migrations/` AND `grep -r "supabase/migrations/NNNN" docs/superpowers/plans/` for unexecuted plans before picking next number.

## TypeScript + Supabase RPC typing (S028, S045)
- **Vercel builds with `tsc -b` (project refs)** — stricter than local `tsc --noEmit`. Run `node ./node_modules/typescript/bin/tsc -b && node ./node_modules/vite/bin/vite.js build` before pushing. Catches TS6133 unused vars + stricter generated RPC arg types.
- **Optional RPC args: conditional spread, never `null`.** `...(x ? { p_field: x } : {})` matches generated `T | undefined`. Never `null as unknown as null` (silences local but fails strict build). RPC args that should be nullable need `DEFAULT NULL` in PL/pgSQL or generator marks them required.
- **`as unknown as Json` for jsonb RPC args** — Supabase generated `Json` carries an index signature `[k: string]: Json | undefined` that hand-written interfaces lack.
- **Defensive `??`-normalisation when persisted-state shape evolves** — adding a field deserialises legacy state with `undefined`; normalise every field in the read path rather than version-bumping.

## Auth + signup flow (S019–S020, S038)
- **Supabase "Confirm email" must stay OFF for FFC Phase 1** (admin approval is the gate). Flipping ON re-breaks `Signup.tsx` Stage 1 silent-stuck — `signUp()` returns `session: null`, `onAuthStateChange` never fires. Fix the inbox-handler before flipping.
- **Terminal roles auto-`signOut`** in `AppContext.tsx` — not just render flag. Pattern: stash sessionStorage message → signOut → `window.location.replace('/login?err=<code>')`. Hard redirect beats `navigate()` — bypasses onAuthStateChange races. Apply to `rejected`, `banned`, `suspended`, `session_expired`.
- **Test emails: `m.muwahid+s###<role>@gmail.com`** — Supabase email validator rejects `example.com` and throwaway domains; Gmail `+tag` aliases pass and forward to main inbox.
- **OAuth ghost-claim flow already exists** — `Signup.tsx` Stage 2 ghost-picker + `pending_signups.claim_profile_hint` + `approve_signup(p_pending_id, p_claim_profile_id)`. For OAuth users with no pending row, route HomeRoute → `<Navigate to="/signup" />` so Signup self-derives the right stage.
- **Read existing code before designing the fix** — when reporting a bug in code untouched in days, read end-to-end first. S038 P2 plan was a full feature build; reading revealed 80% already shipped, final fix was 3 routing edits.
- **Multi-statement SQL via Supabase CLI requires `DO $$ BEGIN … END $$`** — `db query --linked "UPDATE ...; UPDATE ...;"` errors out.
- **Supabase Google OAuth consent screen shows backend domain** (`hylarwwsedjxwavuwjrn.supabase.co`) — Pro custom domain ($25/mo) is the only fix. Add logo on Google Branding page; URL string stays.

## Vercel deploy + verification (S015–S020)
- **`vercel.json` SPA catch-all rewrite** — every Vite SPA needs `{"rewrites":[{"source":"/(.*)","destination":"/"}]}` from day one. Static assets (`/sw.js`, `/manifest.webmanifest`) take precedence automatically.
- **Acceptance test for SPA deploys** must curl-probe at least 3 non-root paths (`/login`, `/poll`, `/does-not-exist`). `/` alone proves nothing about routing.
- **Concrete observable check per milestone**, not "deploy green." Build crash-free is necessary but insufficient — env vars might not resolve, routes might not wire, SW might not install.
- **SW cache bump via build-timestamp** — `VitePWA({ workbox: { cacheId: 'ffc-<ISO-timestamp>' } })` + `cleanupOutdatedCaches: true` eliminates Rule #19 manual discipline. Now superseded by `injectManifest` workflow with `cleanupOutdatedCaches()` call in `src/sw.ts` (S048).
- **Vercel MCP `list_deployments`** — first-line diagnostic for "did my push trigger a deploy" — returns SHA + state + timestamp + commit message in one call.

## React + UI patterns (S016, S025–S028, S045–S049)
- **Plain-object Context, per-render rebuild.** `AppProvider` rebuilds `{ session, role, loading, signOut }` every render. No `useMemo` (#1 source of stale-Context bugs). If perf becomes real (FFC isn't close), the fix is `useSyncExternalStore`, not memo.
- **Inline HTML splash + `requestAnimationFrame` hide on first commit** — paints before any JS parses; CSS-only splash is faster than any JS-rendered splash.
- **Custom DOM events for cross-screen state refresh** — `window.dispatchEvent('ffc:profile-changed')` from Profile/Settings; RoleLayout listens + refetches. Lighter than threading through Context. Caveat: events don't carry diff data, listeners must refetch.
- **Sticky-cols + grid + min-width + overflow-x: auto** for tables that aren't `<table>`. Sticky offsets must equal cumulative widths of preceding sticky cells.
- **`body.is-X` orientation class scoped to one screen** — `useEffect` with matchMedia listener, sets/clears on mount/unmount; CSS `body.is-X #root { max-width: none }` overrides global cap. Cleanup-on-unmount critical.
- **Per-screen brand tokens** — declare ~12 `--*` properties at scope-root (`.po-screen` etc.) and let downstream rules pick up via `var()`. When existing CSS already var()-based with fallbacks, scope-override is 20× cheaper than rule-by-rule editing.
- **`overflow: hidden` on the clipped element, not the wrap.** If sibling decorations (badges) must stay outside the clip, position them on the parent wrap.
- **`loadData(mode: 'initial'|'refresh')` callback** for realtime-capable screens — initial mount + realtime sub + pull-to-refresh share one query; mode flag gates skeleton-clear vs spinner.
- **State-machine UI from raw data only** — Poll's 9 states derive from `(now vs windows) × myVote × roster_locked_at × draft.status × commitments[].team`. No phase enum. Self-correcting under realtime.
- **Lifting a stateful hook to share between siblings** — when both children need the same authoritative state and the hook tolerates null inputs, lift to common parent over context-threading.
- **Ref-based drag state, not `useState`** — pointermove fires ~60Hz; ref mutation avoids per-frame re-render. Gate updates via `if (state.pointerId !== e.pointerId) return`.
- **Slice-size discipline** — multi-session screens split A/B/C/D/E; each slice's file-header JSDoc lists what lands + what's deferred. Aim < 800 LOC per file; extract sibling modules at slice-close before they grow.
- **Local-state-only sheets > round-tripping setters** — instant UX, single transaction at confirm, no network on cancel-able edits.
- **`min-width: 22px` + tabular-nums on count badges** — single-digit counts collapse to oval otherwise.
- **Single consolidated commit for entangled multi-task slice** — when 3+ tasks edit overlapping files, one feat(s###) commit with task breakdown beats artificially split commits.
- **Pre-existing-vs-new ESLint triage at slice close** — `git blame -L line,line file` on each error. Pre-existing errors out of scope.

## Realtime + Edge Functions (S030, S048, S049)
- **`ALTER PUBLICATION supabase_realtime ADD TABLE`** required before `postgres_changes` fires. Verify via `pg_publication_tables`. Filter supports ONE column; secondary filters apply client-side.
- **Migration 0012 DEFAULT PRIVILEGES covers `authenticated` only, NOT `service_role`.** Any new table that needs Edge Function (service_role) DML access must emit explicit `GRANT … TO service_role` in the same migration.
- **Two-bearer Edge Function auth** — `Authorization: Bearer <legacy-jwt>` for the Functions gateway + `X-<custom>-Secret` for function-internal caller-auth. Decouples function from Supabase's `sb_secret_*` vs legacy-JWT key model.
- **Supabase auth-key dual model trap** — `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` returns `sb_secret_*` (length 41); the Functions gateway and `supabase-js` `createClient` both need legacy JWT. Maintain a separate `LEGACY_SERVICE_ROLE_JWT` env var.
- **Vault paste-artifact verification** — `SELECT length, substring(., 1, 5) FROM vault.decrypted_secrets WHERE name = ?` after every secret create/update.
- **Two-layer defense for SECURITY DEFINER RPCs** — Layer 1: helper-function NULL safety (`COALESCE(is_admin(), false)`). Layer 2: `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO authenticated`. Either alone shuts out anon; both together survive helper bugs and signature regressions.
- **base64url tokens via `gen_random_bytes` + 3 `replace()` calls** (URL-safe vs Postgres `encode(..., 'base64')` which produces `+`/`/`/`=`).
- **Two-statement burn-then-mint under snapshot isolation needs `pg_advisory_xact_lock`** to serialise concurrent calls.

## Process / framing (S008, S015, S025, S038, S050)
- **Frame decisions before drafting** when multiple downstream artifacts depend on them — 15 min framing saves 30+ min re-draft.
- **Research-before-close** — when user flags cross-cutting concern mid-session, research it before closing even if otherwise done. Trades 15 min now for 60+ min cold-start research next session.
- **Swap infrastructure hygiene debt early** — anon key → publishable key, build tool versions, naming conventions. "Will work for now" is a debt trap when migration cost grows linearly with app size.
- **User-driven post-deploy feedback round** — when mockups + spec are approved, ship 90% solution + one live testing pass beats iterating speculatively. User must be available to drive in one sitting.
- **Always check `git log --oneline -10` at session start** before acting on instructions in prior session docs. Commits landing AFTER a session's close log may supersede the log's decisions.
- **Three-option (A/B/C) cleanup proposal before touching durable files.** Mass-edit operations on lessons / planning docs / indexes deserve a "what gets dropped" preview — same shape as a destructive-action confirm sheet in the app. User picks in one message.
- **Profile context-file bloat by file size FIRST, then by load frequency.** CLAUDE.md sends every prompt; INDEX.md reads once at session-start. Same byte saving in CLAUDE.md is worth ~5× the saving elsewhere. Triggering condition for re-running an audit: any context file crossing 30 KB or 1,000 lines.
- **Archive-don't-delete** preserves prose for future grep without bloating live context (`tasks/_archive/`). Reusable any time durable docs grow past their useful-context size.
- **Per-domain grouping for lessons > chronological listing** — future-me / fresh subagent wants "what's the rule for schema verification", not "what happened in S028". Grouped sections are scan-friendly.
- **For files with row patterns, programmatic reconstruction beats Edit chains.** `awk + sort + Bash heredoc` rewrite is cleaner than sequential Edit calls when restructuring an indexable list.
