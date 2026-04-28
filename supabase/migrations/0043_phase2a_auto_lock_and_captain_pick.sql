-- 0043_phase2a_auto_lock_and_captain_pick.sql
-- Phase 2A Slices 2A-D + 2A-E (S050).
--
-- Lands the automation core for Track 2A:
--   * auto_lock_matchday(matchday_id)             — locks the roster + fires
--                                                    roster_locked notifications
--                                                    + (if enabled) auto-picks captains.
--   * auto_pick_captains_on_lock(matchday_id)     — top suggested pair via
--                                                    suggest_captain_pairs +
--                                                    notifies both captains +
--                                                    notifies admins with
--                                                    one-tap override deeplink.
--   * promote_from_waitlist(matchday_id)          — captain-callable overload
--                                                    that finds the next
--                                                    waitlisted player by
--                                                    committed_at + fires
--                                                    you_are_in notification.
--   * notify_dropout_after_lock_trigger           — AFTER UPDATE on poll_votes;
--                                                    fires dropout_after_lock
--                                                    notification to admins +
--                                                    captains when a confirmed
--                                                    player cancels post-lock.
--   * pg_cron job 'auto-lock-matchdays'           — runs every minute,
--                                                    auto-locks matchdays
--                                                    whose poll_closes_at has
--                                                    passed.
--
-- Vote reminders (T-24h / T-3h / T-15m) are intentionally NOT in this slice
-- (deferred to 2A-F) per V3.0 + S050 scope decision. The existing
-- promote_from_waitlist(matchday, departing_profile) admin overload from S012
-- (migration 0008) is preserved — this slice adds a new 1-arg overload that
-- coexists.
--
-- Schema realities the spec didn't capture:
--   * matchdays.lock_at does NOT exist — use poll_closes_at as the auto-lock
--     trigger time.
--   * poll_votes.choice not poll_votes.vote.
--   * captains live in match_players.is_captain — there are no white_captain_id
--     / black_captain_id columns on matchdays.
--   * suggest_captain_pairs returns columns named white_captain / black_captain
--     / score (not white_profile_id / balance_score as spec assumed).
--
-- Pre-flight: pg_cron extension must be available (it was enabled in mig 0010).

BEGIN;

-- =============================================================
-- 1. notification_kind enum extensions (3 new values).
-- =============================================================
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'captain_auto_picked';
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'captain_assigned';
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'you_are_in';

COMMIT;

-- ALTER TYPE ADD VALUE must be committed before the new value is usable.
BEGIN;

-- =============================================================
-- 2. is_captain_of helper.
--    Used by promote_from_waitlist to allow captain callers in addition
--    to admins. Pure read, STABLE, returns boolean.
-- =============================================================
CREATE OR REPLACE FUNCTION public.is_captain_of(p_matchday_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.match_players mp
      JOIN public.matches m ON m.id = mp.match_id
     WHERE m.matchday_id = p_matchday_id
       AND mp.profile_id = public.current_profile_id()
       AND mp.is_captain = true
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_captain_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_captain_of(uuid) TO authenticated;

-- =============================================================
-- 3. promote_from_waitlist(uuid) — 1-arg captain-callable overload.
--    Coexists with existing promote_from_waitlist(uuid, uuid) admin overload
--    from S012 (mig 0008). Different arity → no PG conflict.
--    Finds the next non-cancelled yes-voter by committed_at order beyond
--    roster_cap, fires a you_are_in notification, audit-logs.
-- =============================================================
CREATE OR REPLACE FUNCTION public.promote_from_waitlist(p_matchday_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap        int;
  v_promote_id uuid;
BEGIN
  IF NOT public.is_admin() AND NOT public.is_captain_of(p_matchday_id) THEN
    RAISE EXCEPTION 'Only admin or captain may promote' USING ERRCODE = '42501';
  END IF;

  v_cap := public.roster_cap(public.effective_format(p_matchday_id));

  -- First waitlisted player = position v_cap + 1 by committed_at.
  WITH ordered AS (
    SELECT pv.profile_id,
           ROW_NUMBER() OVER (ORDER BY pv.committed_at) AS pos
      FROM public.poll_votes pv
     WHERE pv.matchday_id = p_matchday_id
       AND pv.choice = 'yes'
       AND pv.cancelled_at IS NULL
  )
  SELECT profile_id INTO v_promote_id FROM ordered WHERE pos = v_cap + 1;

  IF v_promote_id IS NULL THEN
    RETURN NULL;  -- silent no-op when waitlist empty
  END IF;

  INSERT INTO public.notifications (recipient_id, kind, title, body, payload)
  VALUES (
    v_promote_id,
    'you_are_in',
    'You''re in!',
    'A confirmed player dropped — you''re on for Thursday.',
    jsonb_build_object('matchday_id', p_matchday_id)
  );

  PERFORM public.log_admin_action(
    'matchdays', p_matchday_id, 'promote_from_waitlist',
    jsonb_build_object('promoted_profile_id', v_promote_id)
  );

  RETURN v_promote_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.promote_from_waitlist(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_from_waitlist(uuid) TO authenticated;

-- =============================================================
-- 4. auto_pick_captains_on_lock — picks top suggest_captain_pairs result,
--    sets via set_matchday_captains, notifies captains + admins.
-- =============================================================
CREATE OR REPLACE FUNCTION public.auto_pick_captains_on_lock(p_matchday_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_white uuid;
  v_black uuid;
BEGIN
  SELECT s.white_captain, s.black_captain
    INTO v_white, v_black
    FROM public.suggest_captain_pairs(p_matchday_id) s
    ORDER BY s.score ASC
    LIMIT 1;

  IF v_white IS NULL OR v_black IS NULL THEN
    -- Not enough eligible captains; admin will pick manually.
    RETURN;
  END IF;

  PERFORM public.set_matchday_captains(p_matchday_id, v_white, v_black);

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
-- Called only from auto_lock_matchday in service-role context; no GRANT.

-- =============================================================
-- 5. auto_lock_matchday — service-role-callable from pg_cron.
--    Idempotent (returns early if roster_locked_at already set).
--    Emits roster_locked notifications + (if app_settings flag) auto-picks
--    captains.
-- =============================================================
CREATE OR REPLACE FUNCTION public.auto_lock_matchday(p_matchday_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_md           public.matchdays%ROWTYPE;
  v_cap          int;
  v_auto_pick    boolean;
BEGIN
  SELECT * INTO v_md FROM public.matchdays WHERE id = p_matchday_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_md.roster_locked_at IS NOT NULL THEN RETURN; END IF;

  v_cap := public.roster_cap(public.effective_format(p_matchday_id));

  UPDATE public.matchdays
     SET roster_locked_at = now()
   WHERE id = p_matchday_id;

  -- Roster_locked notification per voter — partition by committed_at to
  -- decide whether they're confirmed (≤ cap) or waitlist (> cap).
  WITH ordered AS (
    SELECT pv.profile_id,
           ROW_NUMBER() OVER (ORDER BY pv.committed_at) AS pos
      FROM public.poll_votes pv
     WHERE pv.matchday_id = p_matchday_id
       AND pv.choice = 'yes'
       AND pv.cancelled_at IS NULL
  )
  INSERT INTO public.notifications (recipient_id, kind, title, body, payload)
  SELECT
    o.profile_id,
    'roster_locked',
    'Roster locked',
    CASE
      WHEN o.pos <= v_cap
        THEN 'You''re in for ' || to_char(v_md.kickoff_at AT TIME ZONE 'Asia/Dubai', 'Dy DD/Mon')
      ELSE 'You''re on the waitlist (#' || (o.pos - v_cap) || ')'
    END,
    jsonb_build_object(
      'matchday_id', p_matchday_id,
      'kickoff_at', v_md.kickoff_at,
      'your_status', CASE WHEN o.pos <= v_cap THEN 'confirmed' ELSE 'waitlist' END,
      'position', o.pos
    )
    FROM ordered o;

  -- Auto-pick captains if app_settings says so.
  SELECT COALESCE((value->>'enabled')::boolean, false)
    INTO v_auto_pick
    FROM public.app_settings
    WHERE key = 'auto_pick_captains';

  IF COALESCE(v_auto_pick, false) THEN
    PERFORM public.auto_pick_captains_on_lock(p_matchday_id);
  END IF;

  PERFORM public.log_admin_action(
    'matchdays', p_matchday_id, 'auto_lock_matchday', '{}'::jsonb
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_lock_matchday(uuid) FROM PUBLIC;
-- service_role context (pg_cron) is what calls this; no GRANT to authenticated.

-- =============================================================
-- 6. notify_dropout_after_lock_trigger — AFTER UPDATE on poll_votes.
--    Fires a dropout_after_lock notification to admins + both captains
--    when a confirmed (or waitlisted) yes-voter cancels post-lock.
--    Best-effort: errors swallowed via NOTICE so the cancel itself still
--    commits.
-- =============================================================
CREATE OR REPLACE FUNCTION public.notify_dropout_after_lock_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_was_locked    boolean;
  v_dropout_name  text;
  v_was_captain   boolean := false;
BEGIN
  -- Only fire on the cancellation transition.
  IF OLD.cancelled_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.cancelled_at IS NULL THEN RETURN NEW; END IF;

  -- Only post-lock cancellations matter for the banner.
  SELECT (roster_locked_at IS NOT NULL)
    INTO v_was_locked
    FROM public.matchdays
   WHERE id = NEW.matchday_id;
  IF NOT COALESCE(v_was_locked, false) THEN RETURN NEW; END IF;

  -- Pull the dropout's display name + captain status.
  SELECT display_name INTO v_dropout_name
    FROM public.profiles WHERE id = NEW.profile_id;

  SELECT EXISTS (
    SELECT 1
      FROM public.match_players mp
      JOIN public.matches m ON m.id = mp.match_id
     WHERE m.matchday_id = NEW.matchday_id
       AND mp.profile_id = NEW.profile_id
       AND mp.is_captain = true
  ) INTO v_was_captain;

  INSERT INTO public.notifications (recipient_id, kind, title, body, payload)
  SELECT
    p.id,
    'dropout_after_lock',
    'Roster dropout',
    COALESCE(v_dropout_name, 'A player') || ' cancelled' ||
      CASE WHEN v_was_captain THEN ' (was captain)' ELSE '' END ||
      '. Promote from waitlist?',
    jsonb_build_object(
      'matchday_id', NEW.matchday_id,
      'cancelled_profile_id', NEW.profile_id,
      'was_captain', v_was_captain,
      'deeplink', '/matchday/' || NEW.matchday_id || '/captains'
    )
    FROM public.profiles p
   WHERE p.role IN ('admin', 'super_admin')
      OR p.id IN (
        SELECT mp.profile_id
          FROM public.match_players mp
          JOIN public.matches m ON m.id = mp.match_id
         WHERE m.matchday_id = NEW.matchday_id
           AND mp.is_captain = true
      );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_dropout_after_lock_trigger: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_dropout_after_lock_trigger() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_poll_votes_dropout_after_lock ON public.poll_votes;
CREATE TRIGGER trg_poll_votes_dropout_after_lock
  AFTER UPDATE OF cancelled_at ON public.poll_votes
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_dropout_after_lock_trigger();

-- =============================================================
-- 7. app_settings row — auto_pick_captains default ON.
-- =============================================================
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'auto_pick_captains',
  '{"enabled": true}'::jsonb,
  'When true, auto_lock_matchday calls auto_pick_captains_on_lock right after locking the roster.'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- =============================================================
-- 8. pg_cron job — minute-tick auto-lock scheduler.
--    Runs OUTSIDE a transaction because cron.schedule writes to its own
--    schema. Idempotent: unschedule existing job (if any) first.
-- =============================================================
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-lock-matchdays') THEN
      PERFORM cron.unschedule('auto-lock-matchdays');
    END IF;
    PERFORM cron.schedule(
      'auto-lock-matchdays',
      '* * * * *',
      $job$
        SELECT public.auto_lock_matchday(id)
          FROM public.matchdays
         WHERE poll_closes_at <= now()
           AND roster_locked_at IS NULL
      $job$
    );
  ELSE
    RAISE NOTICE 'pg_cron extension not installed — auto-lock job not scheduled';
  END IF;
END
$cron$;

COMMENT ON FUNCTION public.auto_lock_matchday(uuid) IS
  'S050 (Phase 2A-D): locks a matchday roster, fires roster_locked notifications, '
  'and auto-picks captains if app_settings.auto_pick_captains.enabled is true. '
  'Idempotent — re-entry exits early if roster_locked_at is already set. '
  'Called every minute by pg_cron job auto-lock-matchdays.';

COMMENT ON FUNCTION public.auto_pick_captains_on_lock(uuid) IS
  'S050 (Phase 2A-E): top result of suggest_captain_pairs → set_matchday_captains '
  '+ captain_assigned notifications to both + captain_auto_picked to admins with '
  'one-tap override deeplink. No-op if suggest_captain_pairs returns nothing.';

COMMENT ON FUNCTION public.promote_from_waitlist(uuid) IS
  'S050 (Phase 2A-D): 1-arg overload alongside the S012 admin (uuid, uuid) version. '
  'Captain or admin callable. Finds next waitlisted yes-voter by committed_at and '
  'fires you_are_in notification. Returns promoted profile_id or NULL when waitlist empty.';
