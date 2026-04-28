-- 0044_auto_pick_inline_captain_update.sql
-- Fix for 0043: auto_pick_captains_on_lock called set_matchday_captains, which
-- raises 'Admin role required' (is_admin() guard) when invoked from the
-- pg_cron job — cron runs without auth.uid, so current_profile_id() is NULL,
-- and is_admin() is false.
--
-- Fix: inline the match_players UPDATE inside auto_pick_captains_on_lock so it
-- runs as SECURITY DEFINER without going through the admin-guarded RPC. The
-- audit_log entry uses action 'set_matchday_captains' with payload
-- {auto_picked: true} so the Captain Helper UI can detect the auto-pick and
-- show the gold pill.

BEGIN;

CREATE OR REPLACE FUNCTION public.auto_pick_captains_on_lock(p_matchday_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_white     uuid;
  v_black     uuid;
  v_match_id  uuid;
BEGIN
  SELECT s.white_captain, s.black_captain
    INTO v_white, v_black
    FROM public.suggest_captain_pairs(p_matchday_id) s
    ORDER BY s.score ASC
    LIMIT 1;

  IF v_white IS NULL OR v_black IS NULL THEN
    RETURN;
  END IF;

  SELECT m.id INTO v_match_id
    FROM public.matches m
   WHERE m.matchday_id = p_matchday_id
   LIMIT 1;
  IF v_match_id IS NULL THEN RETURN; END IF;

  -- Validate both on roster — silent no-op if either isn't (partial state).
  IF NOT EXISTS (
    SELECT 1 FROM public.match_players
     WHERE match_id = v_match_id AND profile_id = v_white
  ) THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.match_players
     WHERE match_id = v_match_id AND profile_id = v_black
  ) THEN RETURN; END IF;

  -- Inline captain update (bypasses set_matchday_captains' is_admin guard).
  UPDATE public.match_players SET is_captain = false WHERE match_id = v_match_id;
  UPDATE public.match_players SET is_captain = true
   WHERE match_id = v_match_id AND profile_id IN (v_white, v_black);

  -- Audit with auto_picked flag so the UI can detect this and show the pill.
  PERFORM public.log_admin_action(
    'matches', v_match_id, 'set_matchday_captains',
    jsonb_build_object('white', v_white, 'black', v_black, 'auto_picked', true)
  );

  -- Notify both captains.
  INSERT INTO public.notifications (recipient_id, kind, title, body, payload)
  VALUES
    (v_white, 'captain_assigned',
     'You''re White captain', 'Tap to plan formation.',
     jsonb_build_object('matchday_id', p_matchday_id, 'team', 'white')),
    (v_black, 'captain_assigned',
     'You''re Black captain', 'Tap to plan formation.',
     jsonb_build_object('matchday_id', p_matchday_id, 'team', 'black'));

  -- Notify admins with one-tap override deeplink.
  INSERT INTO public.notifications (recipient_id, kind, title, body, payload)
  SELECT
    p.id,
    'captain_auto_picked',
    'Captains auto-picked',
    (SELECT display_name FROM public.profiles WHERE id = v_white) || ' (W) · ' ||
    (SELECT display_name FROM public.profiles WHERE id = v_black) || ' (B). Tap to override.',
    jsonb_build_object(
      'matchday_id', p_matchday_id,
      'deeplink', '/matchday/' || p_matchday_id || '/captains',
      'auto_picked', true
    )
    FROM public.profiles p
   WHERE p.role IN ('admin', 'super_admin');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_pick_captains_on_lock(uuid) FROM PUBLIC;

COMMIT;
