-- 0002_base_entities.sql — profiles, pending_signups, seasons, matchdays (§2.2)

CREATE TABLE profiles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id       uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name       text NOT NULL,
  email              text,
  phone              text,
  avatar_url         text,
  role               user_role NOT NULL DEFAULT 'player',
  is_active          boolean NOT NULL DEFAULT true,
  joined_on          date NOT NULL DEFAULT CURRENT_DATE,
  notes              text,
  primary_position   player_position,
  secondary_position player_position,
  theme_preference   theme_preference NOT NULL DEFAULT 'system',
  leaderboard_sort   leaderboard_sort NOT NULL DEFAULT 'points',
  reject_reason      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES profiles(id),

  CONSTRAINT profiles_positions_differ CHECK (
    secondary_position IS NULL OR primary_position IS DISTINCT FROM secondary_position
  ),
  CONSTRAINT profiles_reject_reason_scope CHECK (
    (role = 'rejected') OR (reject_reason IS NULL)
  )
);

CREATE INDEX profiles_active_idx      ON profiles (is_active) WHERE is_active = true;
CREATE INDEX profiles_role_idx        ON profiles (role);
CREATE INDEX profiles_primary_pos_idx ON profiles (primary_position) WHERE is_active = true;
CREATE UNIQUE INDEX profiles_auth_user_unique
  ON profiles (auth_user_id) WHERE auth_user_id IS NOT NULL;

CREATE TABLE pending_signups (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name        text NOT NULL,
  email               text NOT NULL,
  phone               text,
  claim_profile_hint  uuid REFERENCES profiles(id),
  message             text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz,
  resolved_by         uuid REFERENCES profiles(id),
  resolution          signup_resolution NOT NULL DEFAULT 'pending',
  resolved_profile_id uuid REFERENCES profiles(id),
  rejection_reason    text,

  CONSTRAINT pending_signups_resolution_consistent CHECK (
    (resolution = 'pending' AND resolved_at IS NULL) OR
    (resolution <> 'pending' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  )
);
CREATE INDEX pending_signups_queue_idx
  ON pending_signups (created_at) WHERE resolution = 'pending';

CREATE TABLE seasons (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  starts_on      date NOT NULL,
  ends_on        date,
  roster_policy  roster_policy NOT NULL DEFAULT 'carry_forward',
  default_format match_format NOT NULL DEFAULT '7v7',
  ended_at       timestamptz,
  ended_by       uuid REFERENCES profiles(id),
  archived_at    timestamptz,
  archived_by    uuid REFERENCES profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES profiles(id),

  CONSTRAINT seasons_end_before_archive CHECK (
    archived_at IS NULL OR ended_at IS NOT NULL
  ),
  CONSTRAINT seasons_ends_on_consistent CHECK (
    (ended_at IS NULL AND ends_on IS NULL) OR
    (ended_at IS NOT NULL AND ends_on IS NOT NULL)
  )
);
CREATE UNIQUE INDEX seasons_single_active
  ON seasons ((1)) WHERE ended_at IS NULL;
CREATE INDEX seasons_archived_idx ON seasons (archived_at) WHERE archived_at IS NOT NULL;

CREATE TABLE matchdays (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id         uuid NOT NULL REFERENCES seasons(id) ON DELETE RESTRICT,
  kickoff_at        timestamptz NOT NULL,
  venue             text,
  poll_opens_at     timestamptz NOT NULL,
  poll_closes_at    timestamptz NOT NULL,
  roster_locked_at  timestamptz,
  format            match_format,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES profiles(id),

  CONSTRAINT matchdays_poll_window_valid CHECK (
    poll_closes_at > poll_opens_at AND kickoff_at > poll_closes_at
  )
);
CREATE INDEX matchdays_season_idx ON matchdays (season_id, kickoff_at DESC);
