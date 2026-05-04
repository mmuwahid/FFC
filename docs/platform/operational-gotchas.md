# Live operational gotchas (durable)

Debugging reference for Supabase / Vercel / Windows / TS / RPC quirks discovered the hard way. Read on demand when something behaves unexpectedly. Pulled out of CLAUDE.md to reduce per-session token load (rotated 04/MAY/2026).

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
