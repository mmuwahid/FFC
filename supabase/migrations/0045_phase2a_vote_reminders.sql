-- 0045_phase2a_vote_reminders.sql
-- Phase 2A Slice 2A-F (S050) — vote reminders T-24h / T-3h / T-15m.
--
-- Cron-driven (every 5 min) helper that scans upcoming matchdays whose poll
-- is still open and enqueues vote_reminder notifications for non-voters at
-- three windows before poll_closes_at:
--   * 24h — gentle morning-of nudge
--   * 3h  — afternoon nudge
--   * 15m — last-call
--
-- Idempotency: unique partial index on (recipient_id, kind, matchday_id,
-- reminder_kind) where kind = 'vote_reminder' guarantees each (user, matchday,
-- window) gets at most one reminder. Cron retries (5min cadence + 10min
-- lookback) collide with this index and ON CONFLICT DO NOTHING swallows them.
--
-- Targeting: anyone whose profile is active, not rejected, not soft-deleted,
-- AND who has NOT cast a non-cancelled vote (any choice) on the matchday.
-- People who explicitly said 'no' or 'maybe' are already engaged; nagging
-- them isn't the goal.
--
-- User opt-out: respects profiles.push_prefs.master + .vote_reminder. Migration
-- 0046 backfills push_prefs default to include vote_reminder; the helper
-- defaults to true via COALESCE for profiles that pre-date the new key.
--
-- Admin opt-out: each window has its own app_settings row. Disable any single
-- window without affecting the other two.

BEGIN;

-- =============================================================
-- 1. notification_kind enum extension.
-- =============================================================
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'vote_reminder';

COMMIT;

-- ALTER TYPE ADD VALUE must be committed before the new value is referenced.
BEGIN;

-- =============================================================
-- 2. Unique partial index for idempotency on vote_reminder rows.
-- =============================================================
CREATE UNIQUE INDEX IF NOT EXISTS vote_reminder_unique_idx
  ON public.notifications (
    recipient_id,
    kind,
    ((payload->>'matchday_id')),
    ((payload->>'reminder_kind'))
  )
  WHERE kind = 'vote_reminder';

-- =============================================================
-- 3. Per-window admin toggles. Defaults ON; admin can flip individually.
-- =============================================================
INSERT INTO public.app_settings (key, value, description) VALUES
  ('vote_reminder_24h_enabled',
   '{"enabled": true}'::jsonb,
   'Send vote_reminder push 24h before poll_closes_at to non-voters.'),
  ('vote_reminder_3h_enabled',
   '{"enabled": true}'::jsonb,
   'Send vote_reminder push 3h before poll_closes_at to non-voters.'),
  ('vote_reminder_15m_enabled',
   '{"enabled": true}'::jsonb,
   'Send vote_reminder push 15m before poll_closes_at to non-voters.')
ON CONFLICT (key) DO NOTHING;

-- =============================================================
-- 4. enqueue_vote_reminders() — invoked every 5 min by pg_cron.
--    Returns the count of new rows inserted (0 on a quiet tick).
-- =============================================================
CREATE OR REPLACE FUNCTION public.enqueue_vote_reminders()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
BEGIN
  WITH windows AS (
    SELECT
      md.id              AS matchday_id,
      md.poll_closes_at  AS poll_closes_at,
      md.kickoff_at      AS kickoff_at,
      w.window_kind      AS window_kind,
      CASE w.window_kind
        WHEN '24h' THEN md.poll_closes_at - interval '24 hours'
        WHEN '3h'  THEN md.poll_closes_at - interval '3 hours'
        WHEN '15m' THEN md.poll_closes_at - interval '15 minutes'
      END AS trigger_at
      FROM public.matchdays md
      CROSS JOIN (VALUES ('24h'), ('3h'), ('15m')) AS w(window_kind)
     WHERE md.poll_closes_at > now()
       AND md.poll_closes_at <= now() + interval '25 hours'
  ),
  active_windows AS (
    SELECT w.*
      FROM windows w
     WHERE w.trigger_at <= now()
       AND w.trigger_at > now() - interval '10 minutes'
       AND EXISTS (
         SELECT 1 FROM public.app_settings s
          WHERE s.key = 'vote_reminder_' || w.window_kind || '_enabled'
            AND COALESCE((s.value->>'enabled')::boolean, false)
       )
  ),
  non_voters AS (
    SELECT
      aw.matchday_id,
      aw.poll_closes_at,
      aw.kickoff_at,
      aw.window_kind,
      p.id AS profile_id
      FROM active_windows aw
      JOIN public.profiles p
        ON COALESCE(p.is_active, true)
       AND p.role <> 'rejected'
       AND p.deleted_at IS NULL
       AND COALESCE((p.push_prefs->>'master')::boolean, true)
       AND COALESCE((p.push_prefs->>'vote_reminder')::boolean, true)
      LEFT JOIN public.poll_votes pv
        ON pv.matchday_id = aw.matchday_id
       AND pv.profile_id = p.id
       AND pv.cancelled_at IS NULL
     WHERE pv.id IS NULL
  )
  INSERT INTO public.notifications (recipient_id, kind, title, body, payload)
  SELECT
    nv.profile_id,
    'vote_reminder',
    CASE nv.window_kind
      WHEN '24h' THEN 'Poll closes tomorrow'
      WHEN '3h'  THEN 'Poll closes in 3 hours'
      WHEN '15m' THEN 'Last call — poll closes in 15 min'
    END,
    'Cast your vote for ' ||
      to_char(nv.kickoff_at AT TIME ZONE 'Asia/Dubai', 'Dy DD/Mon'),
    jsonb_build_object(
      'matchday_id',   nv.matchday_id,
      'reminder_kind', nv.window_kind,
      'kickoff_at',    nv.kickoff_at,
      'poll_closes_at', nv.poll_closes_at
    )
    FROM non_voters nv
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_vote_reminders() FROM PUBLIC;

COMMENT ON FUNCTION public.enqueue_vote_reminders() IS
  'S050 (Phase 2A-F): cron-callable. Scans upcoming matchdays + non-voters '
  'and inserts vote_reminder notifications at the 24h/3h/15m windows before '
  'poll_closes_at. Idempotent via vote_reminder_unique_idx + ON CONFLICT.';

COMMIT;

-- =============================================================
-- 5. pg_cron job — fires every 5 minutes (out of transaction).
-- =============================================================
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vote-reminders') THEN
      PERFORM cron.unschedule('vote-reminders');
    END IF;
    PERFORM cron.schedule(
      'vote-reminders',
      '*/5 * * * *',
      $job$ SELECT public.enqueue_vote_reminders() $job$
    );
  ELSE
    RAISE NOTICE 'pg_cron extension not installed — vote-reminders job not scheduled';
  END IF;
END
$cron$;
