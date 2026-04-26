# S043 — Critical security hotfix: is_admin()/is_super_admin() NULL-3VL bug

**Date:** 27/APR/2026
**PC:** Home (`User`)
**Topic:** Same-day production security hotfix. Migration 0031 patches a NULL-3VL bug in `is_admin()` / `is_super_admin()` that had been latent in the codebase since migration 0007 (S016/17, Phase 1 bootstrap). Anon-key callers could reach past the `IF NOT is_admin() THEN RAISE 'Admin role required'` guard on every SECURITY DEFINER admin RPC because the helper returned NULL (not false) for callers without a profile row, and PL/pgSQL silently skips `IF NULL THEN ...` branches. Fix wraps both helpers' bodies in `COALESCE(..., false)`.
**Outcome:** Complete same-day. 1 commit (migration + investigation cleanup), pushed. Migration count on live DB: 30 → 31. RLS unaffected; types regen produced no delta.

## Background — how the bug surfaced

S042 (slice 2B-C) shipped migration 0029 `get_ref_matchday` and immediately hit a runtime failure under PostgREST anon-key curl: `function digest(text, unknown) does not exist`. Diagnosis was that pgcrypto lives in the `extensions` schema on Supabase, not `public`, and the function's `SET search_path = public` didn't include it. Hotfix migration 0030 schema-qualified all pgcrypto calls in three SECURITY DEFINER RPCs.

The lesson coming out of S042 was: **`db query --linked` is insufficient verification for SECURITY DEFINER functions** — it runs as the `postgres` login role with a wider search_path than anon/authenticated. The honest test is anon-key curl POST against `/rest/v1/rpc/<name>`.

That tightened verification protocol immediately produced a second discovery: while curl-testing migration 0030, an anon-key call to `regenerate_ref_token` reached the "Matchday not found" error path past the `IF NOT is_admin() THEN RAISE 'Admin role required'` admin gate. Either `is_admin()` returned true for anon (production security bug), or the test mistakenly used an authenticated key. S042 spawned a follow-up investigation chip rather than block on it; S043 is that investigation closing out as a hotfix.

This is the cascading-bug pattern: tighten verification when one bug is found — others often hide nearby.

## Investigation

1. **Read function bodies** for `is_admin()` and `is_super_admin()` from `pg_proc`:
   ```sql
   is_admin()        -> SELECT current_user_role() IN ('admin','super_admin');
   is_super_admin()  -> SELECT current_user_role() = 'super_admin';
   ```
2. **Identified the 3VL bug.** For an anon caller (no profile row), `current_user_role()` returns NULL. `NULL IN ('admin','super_admin')` evaluates to NULL (not false). PL/pgSQL's `IF NOT NULL THEN RAISE` is treated as `IF NULL THEN RAISE`, which is treated as FALSE — the RAISE is silently skipped. The function falls through to whatever existence check is on the next line.
3. **Verified with anon-key curl POST** against three admin RPCs:
   - `regenerate_ref_token` → `22023 Matchday not found` (past the admin gate, hitting the row-existence check)
   - `reject_signup` → `22023 Pending signup not found` (same shape)
   - `approve_signup` → `22023 Pending signup not found` (same shape)
4. **Confirmed RLS was not affected.** RLS treats NULL and FALSE identically: in USING the row is excluded; in WITH CHECK the operation raises. Only the PL/pgSQL `IF NOT helper()` callers were buggy.
5. **Verified `db query --linked` would have hidden the bug.** It runs as the `postgres` login role, which has a profile row in the test environment, so `current_user_role()` returns non-NULL and `is_admin()` returns TRUE. The function never gets exercised against a NULL-returning callsite via that test path.

## Fix — Migration 0031

`supabase/migrations/0031_is_admin_null_safety.sql`. Function body change only — no schema delta.

```sql
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(current_user_role() IN ('admin','super_admin'), false);
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(current_user_role() = 'super_admin', false);
$$;
```

`CREATE OR REPLACE` (not DROP+CREATE) because the signature is unchanged — GRANTs survive. Applied via `npx supabase db push --linked`.

Types regen via `npx supabase gen types typescript --linked > ffc/src/lib/database.types.ts 2>/dev/null` produced 2184 lines, byte-identical to S042's output (function-body change doesn't affect generated TS types).

`tsc -b` EXIT 0 (sanity check; no UI delta expected).

## Verification — before / after curl outputs

Tested via `curl -X POST` with the anon publishable key against `/rest/v1/rpc/<name>`.

| RPC | Before fix | After fix |
|---|---|---|
| `regenerate_ref_token` | `22023 Matchday not found` (reached past admin gate) | `42501 Admin role required` ✓ |
| `reject_signup` | `22023 Pending signup not found` (reached past admin gate) | `42501 Admin role required` ✓ |
| `approve_signup` | `22023 Pending signup not found` (reached past admin gate) | `42501 Admin role required` ✓ |
| `get_ref_matchday` (anon-callable by design — NOT admin-gated) | `22023 Invalid or expired ref token` | `22023 Invalid or expired ref token` ✓ (still working) |

The control case (`get_ref_matchday`) confirms we didn't accidentally break the legitimate anon surface — the function continues to validate tokens correctly.

## Patterns / lessons (additive)

### PL/pgSQL `IF NOT NULL THEN ...` silently skips the THEN branch

3-valued logic: `NOT NULL` evaluates to NULL. `IF NULL THEN ...` is treated as `IF FALSE THEN ...` and the THEN branch is skipped. Boolean SECURITY DEFINER helpers MUST COALESCE to false to avoid this trap.

The pattern for any future helper:
```sql
CREATE FUNCTION public.<helper>()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(<bool-expression>, false);
$$;
```

This applies to any helper used as `IF NOT <helper>() THEN RAISE ...`. The COALESCE turns NULL into a hard false so the RAISE actually fires.

### `db query --linked` hides authorization bugs

`db query --linked` runs as the `postgres` login role, which has a profile row in our test environment. `current_user_role()` therefore returns a non-NULL value, and `is_admin()` returns TRUE. The buggy fall-through path simply isn't reachable from that test surface. End-to-end verification of SECURITY DEFINER + auth-derived state requires anon-key + authenticated-key curl POST against `/rest/v1/rpc/<name>`.

### Anon-key curl is the only honest verification for admin RPCs

`db query` has too much privilege; the actual API surface needs to be tested with the role the attacker has access to. From S043 forward, every admin RPC that ships should be smoke-tested with the anon publishable key to confirm the admin guard fires before the row-existence check.

### The bug was invisible for 26 sessions

The COALESCE pattern shipped in S016/17 with migration 0007. Phase 1 admin testing went through the authenticated UI, where the bug doesn't manifest (authenticated callers have a profile row, `current_user_role()` returns a non-NULL value, the helper returns true/false correctly). The first anon-key curl in slice 2B-C was the moment of discovery — and only because that slice's testing protocol was tightened in response to the pgcrypto search_path bug found minutes earlier.

### Cascading discoveries are a good signal

S042's pgcrypto search_path lesson ("don't trust db query verification") directly led to the testing approach that uncovered S043's is_admin bug. When one bug is found, **tighten verification protocols immediately** — others often hide nearby. The 30 minutes spent on the anon-key curl harness in S042 paid for itself within the same hour.

### Defense-in-depth follow-up: REVOKE EXECUTE FROM PUBLIC

Postgres grants EXECUTE on user-defined functions to PUBLIC by default. Combined with the is_admin bug, this meant anon callers could reach the function body at all. After the COALESCE fix, anon still reaches the function body but is correctly rejected at the admin guard. A future slice should `REVOKE EXECUTE ... FROM PUBLIC` and explicitly `GRANT EXECUTE ... TO authenticated` on every admin RPC, so even if a future helper bug recurs, anon callers don't reach the function body in the first place.

## Open follow-ups

- **REVOKE EXECUTE FROM PUBLIC on admin RPCs.** Defense-in-depth slice. Audit every SECURITY DEFINER function in `supabase/migrations/` for explicit GRANTs; REVOKE FROM PUBLIC where missing; explicit `GRANT EXECUTE ... TO authenticated`. Logged in `tasks/todo.md` S044 backburner.
- **Acceptance tests for slices 2B-B / 2B-C on real device.** Carry-over from S042.

## Next session

**S044 — slice 2B-D (Live mode).** Match clock (35-5-35 minutes, configurable per format), large white/black score blocks (tap to open scorer picker), pause/resume button (auto-stoppage), card actions, MOTM picker, event log persisted to React state with 15s undo window. Client-side authoritative timer (no server clock) using `performance.now()` + persisted start-timestamp in localStorage.
