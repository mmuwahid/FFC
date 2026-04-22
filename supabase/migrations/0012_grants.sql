-- 0012_grants.sql — GRANT table/sequence privileges to `authenticated`.
--
-- Step 2 (migrations 0001–0011) enabled RLS and created policies, but the
-- project was provisioned with "automatic table exposure" disabled, so the
-- `authenticated` role never picked up the default table-level privileges.
-- RLS filters rows; it does NOT grant access. Without these GRANTs every
-- query from the authenticated JWT returns zero rows silently, which
-- surfaced in S019 as the super-admin landing on the "Waiting for approval"
-- screen despite the profile row being correctly bound.
--
-- This migration is idempotent (GRANTs are cumulative; re-running is a no-op).

-- Schema access
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Tables — authenticated can read/write; RLS constrains per-row access.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- Sequences — required for INSERT on tables with serial/identity columns.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Default privileges for any NEW tables / sequences created later by
-- migrations running as `postgres`. Keeps future schema changes consistent
-- without us having to re-grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- anon deliberately gets nothing on tables. The only anon-callable surface
-- is submit_ref_entry() — granted explicitly in 0008_security_definer_rpcs.sql.
