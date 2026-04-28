-- 0040_delete_my_account_rpc.sql
-- S049 — Player-initiated soft-delete RPC. Anonymises the profile so historical
-- match data + leaderboard entries fall out of sight without breaking foreign
-- keys on match_players / poll_votes / formations / etc.
--
-- After this RPC runs, the client signs the user out via supabase-js. The
-- auth.users row is intentionally NOT purged here (would need an Edge Function
-- with admin client). Since auth_user_id is cleared, the user can re-sign-up
-- (OAuth flow lands them in the ghost-claim picker as a fresh signup).
--
-- S047 patterns applied: SECURITY DEFINER + search_path lock + REVOKE PUBLIC
-- + GRANT EXECUTE TO authenticated. Defense-in-depth two-layer per S047.

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile_id uuid := public.current_profile_id();
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Audit BEFORE the destructive update so the log entry survives even if
  -- the soft-delete partially fails (mirrors S034 delete_season pattern).
  INSERT INTO public.admin_audit_log
    (admin_profile_id, target_entity, target_id, action, payload_jsonb)
  VALUES
    (v_profile_id, 'profiles', v_profile_id, 'player_self_deleted',
     jsonb_build_object('at', now()));

  UPDATE public.profiles
     SET deleted_at   = now(),
         display_name = 'Deleted player',
         avatar_url   = NULL,
         auth_user_id = NULL,
         email        = NULL,
         is_active    = false
   WHERE id = v_profile_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

COMMENT ON FUNCTION public.delete_my_account() IS
  'S049: player-initiated soft-delete. Anonymises profile (display_name → '
  '"Deleted player", clears avatar/email/auth link), sets deleted_at, marks '
  'inactive. Match history + leaderboard entries drop off via the v_season_'
  'standings filter. auth.users row is left in place (purge would require an '
  'Edge Function); user can re-sign-up cleanly (auth_user_id NULL means OAuth '
  'flow surfaces the ghost-claim picker on next login).';
