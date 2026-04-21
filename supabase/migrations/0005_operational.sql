-- 0005_operational.sql — operational tables + S013 tables + format helpers (§2.5)

-- notifications
CREATE TABLE notifications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind               notification_kind NOT NULL,
  title              text NOT NULL,
  body               text NOT NULL,
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  read_at            timestamptz,
  dispatched_push_at timestamptz,
  push_error         text
);
CREATE INDEX notifications_recipient_unread_idx
  ON notifications (recipient_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_recipient_all_idx
  ON notifications (recipient_id, created_at DESC);

-- player_bans
CREATE TABLE player_bans (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  reason     text NOT NULL,
  imposed_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES profiles(id),

  CONSTRAINT player_bans_valid_range CHECK (ends_at > starts_at),
  CONSTRAINT player_bans_revoke_consistent CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL) OR
    (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
  )
);
CREATE INDEX player_bans_profile_active_idx
  ON player_bans (profile_id, ends_at) WHERE revoked_at IS NULL;

-- push_subscriptions
CREATE TABLE push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint        text NOT NULL UNIQUE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  disabled_at     timestamptz,
  disabled_reason text
);
CREATE INDEX push_subscriptions_profile_active_idx
  ON push_subscriptions (profile_id) WHERE disabled_at IS NULL;

-- app_settings
CREATE TABLE app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES profiles(id)
);

INSERT INTO app_settings (key, value, description) VALUES
  ('whatsapp_group_link', '""'::jsonb,
    'Invite / join link for the FFC WhatsApp group.'),
  ('whatsapp_share_templates', '{
      "poll_open":        "🎯 FFC poll is open — vote for Thursday:\n{{poll_url}}",
      "plus_one_unlock":  "⚽ <{{roster_cap}} confirmed for Thursday. +1 slot unlocked:\n{{poll_url}}",
      "teams_posted":     "🏁 Teams up for {{match_date}}:\n{{match_url}}",
      "result_posted":    "📊 {{match_date}} result:\n{{share_url}}"
    }'::jsonb,
    'Text templates for native share-sheet to WhatsApp.'),
  ('match_settings', '{
      "kickoff_time_default":            "20:00",
      "roster_cap":                      14,
      "plus_one_unlock_hours":           24,
      "late_cancel_penalty_after_lock":  -1,
      "late_cancel_penalty_within_24h":  -1,
      "late_cancel_ban_days_within_24h": 7,
      "captain_min_matches_this_season": 5,
      "captain_cooldown_matchdays":      4,
      "captain_min_attendance_rate":     0.6
    }'::jsonb,
    'Tunable match & captain constants.'),
  ('season_settings', '{"default_roster_policy":"carry_forward"}'::jsonb,
    'Defaults applied when creating a new season.'),
  ('draft_stuck_threshold_hours', '6'::jsonb,
    'Hours after which an open draft_sessions row exposes the admin Force complete / Abandon action.'),
  ('reroll_cutoff_hours_before_kickoff', '12'::jsonb,
    'Captains cannot trigger request_reroll() within this many hours of kickoff.'),
  ('poll_reminder_offset_minutes', '-2'::jsonb,
    'poll_reminder push fires at poll_closes_at + this many minutes (negative = before).');

-- scheduled_reminders (rows seeded in 0011 after super_admin exists)
CREATE TABLE scheduled_reminders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             reminder_kind NOT NULL,
  label            text NOT NULL,
  cron_expression  text NOT NULL,
  timezone         text NOT NULL DEFAULT 'Asia/Dubai',
  enabled          boolean NOT NULL DEFAULT true,
  channels         reminder_channel[] NOT NULL DEFAULT ARRAY['push']::reminder_channel[],
  target_audience  text NOT NULL DEFAULT 'active_players',
  payload_template jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_fired_at    timestamptz,
  last_fire_status text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL REFERENCES profiles(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES profiles(id),

  CONSTRAINT scheduled_reminders_audience_valid CHECK (
    target_audience IN ('active_players','admins','super_admins','all')
  )
);
CREATE INDEX scheduled_reminders_enabled_idx
  ON scheduled_reminders (enabled, kind) WHERE enabled = true;

-- admin_audit_log (S013)
CREATE TABLE admin_audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  target_entity    text NOT NULL,
  target_id        uuid,
  action           text NOT NULL,
  payload_jsonb    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_log_admin_recent_idx
  ON admin_audit_log (admin_profile_id, created_at DESC);
CREATE INDEX admin_audit_log_target_idx
  ON admin_audit_log (target_entity, target_id, created_at DESC) WHERE target_id IS NOT NULL;

-- draft_sessions (S013)
CREATE TABLE draft_sessions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matchday_id             uuid NOT NULL REFERENCES matchdays(id) ON DELETE CASCADE,
  status                  draft_status NOT NULL DEFAULT 'in_progress',
  current_picker_team     team_color NOT NULL DEFAULT 'white',
  reason                  draft_reason NOT NULL DEFAULT 'initial',
  triggered_by_profile_id uuid REFERENCES profiles(id),
  started_at              timestamptz NOT NULL DEFAULT now(),
  completed_at            timestamptz,

  CONSTRAINT draft_sessions_completed_consistent CHECK (
    (status = 'in_progress' AND completed_at IS NULL) OR
    (status IN ('completed','abandoned') AND completed_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX draft_sessions_one_active_per_matchday
  ON draft_sessions (matchday_id) WHERE status = 'in_progress';
CREATE INDEX draft_sessions_matchday_idx
  ON draft_sessions (matchday_id, started_at DESC);

-- draft_picks (S013)
CREATE TABLE draft_picks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_session_id uuid NOT NULL REFERENCES draft_sessions(id) ON DELETE CASCADE,
  pick_order       int NOT NULL CHECK (pick_order > 0),
  team             team_color NOT NULL,
  profile_id       uuid REFERENCES profiles(id),
  guest_id         uuid REFERENCES match_guests(id),
  picked_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT draft_picks_participant_xor CHECK (
    (profile_id IS NOT NULL AND guest_id IS NULL) OR
    (profile_id IS NULL AND guest_id IS NOT NULL)
  ),
  CONSTRAINT draft_picks_unique_order   UNIQUE (draft_session_id, pick_order),
  CONSTRAINT draft_picks_unique_profile UNIQUE (draft_session_id, profile_id),
  CONSTRAINT draft_picks_unique_guest   UNIQUE (draft_session_id, guest_id)
);
CREATE INDEX draft_picks_session_idx
  ON draft_picks (draft_session_id, pick_order);

-- formations (S013)
CREATE TABLE formations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matchday_id              uuid NOT NULL REFERENCES matchdays(id) ON DELETE CASCADE,
  team                     team_color NOT NULL,
  pattern                  text NOT NULL,
  layout_jsonb             jsonb NOT NULL,
  formation_rotation_order jsonb,
  starting_gk_profile_id  uuid REFERENCES profiles(id),
  last_edited_by           uuid REFERENCES profiles(id),
  last_edited_at           timestamptz NOT NULL DEFAULT now(),
  shared_at                timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT formations_pattern_valid CHECK (
    pattern IN (
      '2-3-1','3-2-1','2-2-2','3-1-2','2-1-3','1-3-2',
      '1-2-1','2-1-1','1-1-2',
      'custom'
    )
  ),
  CONSTRAINT formations_unique_team_per_matchday UNIQUE (matchday_id, team)
);
CREATE INDEX formations_matchday_idx ON formations (matchday_id);

-- format helpers (S013 item 4)
CREATE OR REPLACE FUNCTION effective_format(p_matchday_id uuid) RETURNS match_format
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(md.format, s.default_format)
  FROM matchdays md
  JOIN seasons s ON s.id = md.season_id
  WHERE md.id = p_matchday_id;
$$;

CREATE OR REPLACE FUNCTION roster_cap(p_format match_format) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_format WHEN '7v7' THEN 14 WHEN '5v5' THEN 10 END;
$$;
