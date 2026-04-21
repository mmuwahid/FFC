-- 0011_seed_super_admin.sql — seed super_admin profile + scheduled_reminders + pg_cron jobs
-- Run once after auth user m.muwahid@gmail.com has signed up via Supabase Auth.
-- If the auth user does not exist yet, the INSERT will succeed with auth_user_id = NULL
-- and can be patched later via: UPDATE profiles SET auth_user_id = '<uuid>' WHERE email = 'm.muwahid@gmail.com';

INSERT INTO profiles (display_name, email, role, is_active, joined_on)
VALUES ('Mohammed Muwahid', 'm.muwahid@gmail.com', 'super_admin', true, CURRENT_DATE)
ON CONFLICT DO NOTHING;

-- Seed scheduled_reminders (created_by = super_admin row just inserted)
INSERT INTO scheduled_reminders
  (kind, label, cron_expression, channels, target_audience, payload_template, created_by)
VALUES
  ('poll_open_broadcast', 'Monday 5:00 PM — roll-call poll opens',
   '0 17 * * 1',
   ARRAY['push','whatsapp_share']::reminder_channel[],
   'admins',
   '{"title":"Poll is live","body":"Tap to post the roll-call to the group.","share_template_key":"poll_open"}'::jsonb,
   (SELECT id FROM profiles WHERE email = 'm.muwahid@gmail.com' AND role = 'super_admin' LIMIT 1)),

  ('poll_cutoff_warning', 'Tuesday 9:00 PM — nudge non-voters',
   '0 21 * * 2',
   ARRAY['push']::reminder_channel[],
   'active_players',
   '{"title":"Still need your vote","body":"Poll closes tomorrow night."}'::jsonb,
   (SELECT id FROM profiles WHERE email = 'm.muwahid@gmail.com' AND role = 'super_admin' LIMIT 1)),

  ('plus_one_unlock_broadcast', 'Wednesday 8:00 PM — +1 slots unlock if not full',
   '0 20 * * 3',
   ARRAY['push','whatsapp_share']::reminder_channel[],
   'admins',
   '{"title":"+1 slots unlocked","body":"Roster < 14. Tap to post to the group.","share_template_key":"plus_one_unlock"}'::jsonb,
   (SELECT id FROM profiles WHERE email = 'm.muwahid@gmail.com' AND role = 'super_admin' LIMIT 1)),

  ('teams_post_reminder', 'Wednesday 10:00 PM — complete team selection tonight',
   '0 22 * * 3',
   ARRAY['push']::reminder_channel[],
   'admins',
   '{"title":"Team selection due","body":"Lock rosters and enter teams tonight; Thursday is the hard fallback."}'::jsonb,
   (SELECT id FROM profiles WHERE email = 'm.muwahid@gmail.com' AND role = 'super_admin' LIMIT 1)),

  ('teams_post_reminder', 'Thursday 12:00 PM — fallback: teams must be posted before kickoff',
   '0 12 * * 4',
   ARRAY['push']::reminder_channel[],
   'admins',
   '{"title":"Last chance: post the teams","body":"Kick-off is in ~8 hours. If teams are already posted, ignore."}'::jsonb,
   (SELECT id FROM profiles WHERE email = 'm.muwahid@gmail.com' AND role = 'super_admin' LIMIT 1));

-- Seed first season placeholder (can be updated via admin UI)
INSERT INTO seasons (name, starts_on, roster_policy, default_format, created_by)
VALUES (
  'Season 1',
  CURRENT_DATE,
  'carry_forward',
  '7v7',
  (SELECT id FROM profiles WHERE email = 'm.muwahid@gmail.com' AND role = 'super_admin' LIMIT 1)
);

-- Wire pg_cron: one job per reminder row (runs in Asia/Dubai time via AT TIME ZONE in the job)
DO $$
DECLARE
  r scheduled_reminders%ROWTYPE;
  job_name text;
BEGIN
  FOR r IN SELECT * FROM scheduled_reminders WHERE enabled = true LOOP
    job_name := 'ffc-reminder-' || r.id::text;
    PERFORM cron.schedule(
      job_name,
      r.cron_expression,
      format('SELECT fire_scheduled_reminder(%L::uuid)', r.id)
    );
  END LOOP;
END;
$$;
