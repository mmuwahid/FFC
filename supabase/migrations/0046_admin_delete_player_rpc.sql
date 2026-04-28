-- 0046_admin_delete_player_rpc.sql
-- S051 — admin-initiated soft-delete of a player profile (GitHub issue #7).
--
-- Mirrors 0040_delete_my_account_rpc but the caller is an admin acting on a
-- target profile_id. Same anonymisation pattern: clears display_name to
-- 'Deleted player', clears avatar / auth_user_id / email, flips is_active
-- false, sets deleted_at = now(). Match history + leaderboard entries drop
-- off cleanly via the v_season_standings deleted_at filter (added in 0039).
--
-- Two-layer guard per S047:
--   (1) is_admin() body check — RPC body raises if caller lacks admin role
--   (2) REVOKE EXECUTE FROM PUBLIC + GRANT EXECUTE TO authenticated — only
--       authenticated callers can attempt; non-admins hit the body check.
--
-- Audits BEFORE the UPDATE so the log entry survives a partial failure
-- (mirrors S034 delete_season + S049 delete_my_account pattern).
--
-- Refuses to act on:
--   • the caller's own profile (use delete_my_account instead)
--   • a profile that is already soft-deleted (idempotency guard)
--   • a super_admin profile (super-admin self-protection)

CREATE OR REPLACE FUNCTION public.admin_delete_player(p_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := public.current_profile_id();
  v_target_role public.user_role;
  v_target_deleted_at timestamptz;
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'p_profile_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_profile_id = v_admin_id THEN
    RAISE EXCEPTION 'Use delete_my_account for self-deletion' USING ERRCODE = '22023';
  END IF;

  SELECT role, deleted_at INTO v_target_role, v_target_deleted_at
    FROM public.profiles
   WHERE id = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile % not found', p_profile_id USING ERRCODE = 'P0002';
  END IF;
  IF v_target_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Profile % already deleted', p_profile_id USING ERRCODE = '22023';
  END IF;
  IF v_target_role = 'super_admin' THEN
    RAISE EXCEPTION 'Cannot delete a super_admin' USING ERRCODE = '42501';
  END IF;

  -- Audit first.
  INSERT INTO public.admin_audit_log
    (admin_profile_id, target_entity, target_id, action, payload_jsonb)
  VALUES
    (v_admin_id, 'profiles', p_profile_id, 'admin_deleted_player',
     jsonb_build_object('at', now(), 'prior_role', v_target_role));

  UPDATE public.profiles
     SET deleted_at   = now(),
         display_name = 'Deleted player',
         avatar_url   = NULL,
         auth_user_id = NULL,
         email        = NULL,
         is_active    = false
   WHERE id = p_profile_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_delete_player(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_player(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_delete_player(uuid) IS
  'S051 (issue #7): admin-initiated soft-delete of a player profile. '
  'Two-layer guard: is_admin() body check + EXECUTE-grant gate. Refuses self-target '
  '(use delete_my_account), already-deleted targets, and super_admin targets. '
  'Audits before the destructive update.';
