-- 0031_is_admin_null_safety.sql
-- CRITICAL SECURITY HOTFIX — make is_admin() / is_super_admin() return false
-- instead of NULL when called by anon (no auth.uid()).
--
-- Bug. The helpers were:
--   is_admin()       SELECT current_user_role() IN ('admin','super_admin');
--   is_super_admin() SELECT current_user_role() = 'super_admin';
--
-- For anon callers, current_user_role() returns NULL (no profile row matches
-- auth.uid() = NULL). Then `NULL IN (...)` and `NULL = 'super_admin'` both
-- return NULL (3-valued logic).
--
-- Inside SECURITY DEFINER functions, every admin RPC starts with:
--   IF NOT is_admin() THEN RAISE EXCEPTION 'Admin role required'; END IF;
--
-- PL/pgSQL evaluates `IF NOT NULL` as `IF NULL`, which is treated as FALSE,
-- so the RAISE was silently skipped. Anon callers slipped past the admin
-- check on every admin RPC: regenerate_ref_token, approve_signup,
-- reject_signup, approve_match_entry, reject_match_entry,
-- update_player_profile, ban_player, unban_player, update_season,
-- delete_season, lock_roster, set_matchday_captains, edit_match_result,
-- edit_match_players, admin_draft_force_complete, admin_draft_abandon,
-- confirm_friendly_matchday, dismiss_friendly_flag, etc.
--
-- Verified by anon-key curl POST against regenerate_ref_token and
-- reject_signup: both reached past the IF NOT is_admin() guard and errored
-- on the second-line existence check (matchday-not-found / pending-not-
-- found). After this fix, both correctly raise 'Admin role required' with
-- ERRCODE 42501 from the IF NOT is_admin() guard.
--
-- Fix. COALESCE the comparison result to false so the helpers return
-- strictly true/false (never NULL). Behavior changes:
--   - anon callers: NULL → false (now correctly excluded)
--   - admin/super_admin callers: TRUE → TRUE (unchanged)
--   - non-admin authenticated callers: FALSE → FALSE (unchanged)
--
-- RLS policy impact: NONE. RLS treated NULL and FALSE identically (row
-- excluded in USING, violation in WITH CHECK), so the COALESCE only
-- affects the PL/pgSQL `IF NOT helper()` callers that were buggy.

BEGIN;

CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_user_role() IN ('admin','super_admin'), false);
$$;

CREATE OR REPLACE FUNCTION is_super_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_user_role() = 'super_admin', false);
$$;

COMMIT;
