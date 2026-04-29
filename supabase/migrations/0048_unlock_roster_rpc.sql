-- 0047_unlock_roster_rpc.sql
-- Adds unlock_roster(p_matchday_id uuid) admin RPC.
-- Clears roster_locked_at so the admin can redo the formation before re-locking.
-- Refuses if no lock is set (idempotent-safe) or if a pending_match_entry
-- already exists (entry is in flight — unlock would leave it orphaned).

BEGIN;

CREATE OR REPLACE FUNCTION public.unlock_roster(p_matchday_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM matchdays WHERE id = p_matchday_id AND roster_locked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Roster is not locked' USING ERRCODE = '22023';
  END IF;

  -- Block unlock if a ref entry is already in flight for this matchday.
  IF EXISTS (
    SELECT 1 FROM pending_match_entries
    WHERE matchday_id = p_matchday_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'A ref entry is pending review — reject it before unlocking' USING ERRCODE = '22023';
  END IF;

  UPDATE matchdays SET roster_locked_at = NULL WHERE id = p_matchday_id;

  PERFORM log_admin_action('matchday', p_matchday_id, 'unlock_roster', '{}'::jsonb);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.unlock_roster(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.unlock_roster(uuid) TO authenticated;

COMMENT ON FUNCTION public.unlock_roster(uuid) IS
  'Admin-only. Clears roster_locked_at so the formation can be revised before
   re-locking. Blocked if a pending ref entry is already in flight.';

COMMIT;
