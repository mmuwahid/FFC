-- 0049_admin_add_guest_rpc.sql
-- S054 (issue #11) — admin creates a guest for a matchday.
--
-- Unlike invite_guest (player-facing), this bypasses slot-availability checks
-- and stats-required validation. Name is the only required field; all trait /
-- position / rating columns are left nullable (admin can fill them later).
--
-- Two-layer guard per S047:
--   (1) is_admin() body check
--   (2) REVOKE EXECUTE FROM PUBLIC + GRANT EXECUTE TO authenticated
--
-- Returns the new match_guests.id so the UI can immediately slot the guest
-- into a team without a follow-up fetch.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_add_guest(
  p_matchday_id  uuid,
  p_display_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := public.current_profile_id();
  v_guest_id uuid;
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;
  IF p_matchday_id IS NULL THEN
    RAISE EXCEPTION 'p_matchday_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_display_name IS NULL OR length(trim(p_display_name)) = 0 THEN
    RAISE EXCEPTION 'p_display_name is required' USING ERRCODE = '22023';
  END IF;
  IF length(trim(p_display_name)) > 40 THEN
    RAISE EXCEPTION 'Guest name too long (max 40 chars)' USING ERRCODE = '22001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.matchdays WHERE id = p_matchday_id) THEN
    RAISE EXCEPTION 'Matchday % not found', p_matchday_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.match_guests (matchday_id, inviter_id, display_name)
  VALUES (p_matchday_id, v_admin_id, trim(p_display_name))
  RETURNING id INTO v_guest_id;

  PERFORM public.log_admin_action(
    'match_guests', v_guest_id, 'admin_add_guest',
    jsonb_build_object('matchday_id', p_matchday_id, 'display_name', trim(p_display_name))
  );

  RETURN v_guest_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_add_guest(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_add_guest(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.admin_add_guest(uuid, text) IS
  'S054 (issue #11): admin creates a guest for a matchday. '
  'Name only required; trait/position/rating columns left nullable. '
  'Two-layer guard: is_admin() + EXECUTE-grant gate. Returns new guest_id.';

COMMIT;
