-- 0010_pg_cron_bindings.sql — pg_cron jobs bound to scheduled_reminders rows
-- Rows are seeded in 0011 (after super_admin exists). This file is a placeholder;
-- the actual cron.schedule() calls run via DO block in 0011 once rows exist.
-- To add or remove jobs after initial deploy, use the Supabase Dashboard → Database → pg_cron.

-- Helper: fire_due_reminders — called by a single pg_cron job that checks all enabled reminders.
-- Supabase pg_cron runs in the pg_cron schema as the postgres superuser, so SECURITY DEFINER
-- is not needed here; the function just fans out to fire_scheduled_reminder per row.
CREATE OR REPLACE FUNCTION fire_due_reminders() RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  r scheduled_reminders%ROWTYPE;
BEGIN
  FOR r IN SELECT * FROM scheduled_reminders WHERE enabled = true LOOP
    BEGIN
      PERFORM fire_scheduled_reminder(r.id);
    EXCEPTION WHEN OTHERS THEN
      UPDATE scheduled_reminders
      SET last_fire_status = SQLERRM, last_fired_at = now()
      WHERE id = r.id;
    END;
  END LOOP;
END;
$$;
