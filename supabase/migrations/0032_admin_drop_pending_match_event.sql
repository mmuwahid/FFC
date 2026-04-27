-- 0032_admin_drop_pending_match_event.sql
-- Phase 2 Slice 2B-F — admin affordance to drop a single bogus event row
-- from a submitted ref entry before approving. Rare; for ref typos.
--
-- Idempotent on a missing row: returns silently if the event id no longer
-- exists (no-op rather than 22023). Caller (admin UI) refreshes the event
-- list after success either way, so a dropped-twice click is harmless.

BEGIN;

CREATE OR REPLACE FUNCTION admin_drop_pending_match_event(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pending_id uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  -- Capture the parent pending_entry_id for audit before delete.
  SELECT pending_entry_id INTO v_pending_id
    FROM pending_match_events
   WHERE id = p_event_id;

  IF v_pending_id IS NULL THEN
    RETURN;  -- already gone; idempotent no-op
  END IF;

  DELETE FROM pending_match_events WHERE id = p_event_id;

  PERFORM log_admin_action(
    'pending_match_events',
    p_event_id,
    'admin_drop_pending_match_event',
    jsonb_build_object('pending_entry_id', v_pending_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_drop_pending_match_event(uuid) TO authenticated;

COMMIT;
