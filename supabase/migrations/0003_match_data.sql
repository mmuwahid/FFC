-- 0003_match_data.sql — match_guests, matches, match_players (§2.3)

CREATE TABLE match_guests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matchday_id        uuid NOT NULL REFERENCES matchdays(id) ON DELETE CASCADE,
  inviter_id         uuid NOT NULL REFERENCES profiles(id),
  display_name       text NOT NULL,
  primary_position   player_position,
  secondary_position player_position,
  stamina            guest_trait,
  accuracy           guest_trait,
  rating             guest_rating,
  description        text,
  updated_by         uuid REFERENCES profiles(id),
  updated_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  cancelled_at       timestamptz,
  cancelled_by       uuid REFERENCES profiles(id),

  CONSTRAINT match_guests_positions_differ CHECK (
    secondary_position IS NULL OR primary_position IS DISTINCT FROM secondary_position
  ),
  CONSTRAINT match_guests_description_length CHECK (
    description IS NULL OR char_length(description) <= 140
  )
);
CREATE INDEX match_guests_active_order_idx
  ON match_guests (matchday_id, created_at) WHERE cancelled_at IS NULL;
CREATE INDEX match_guests_inviter_idx ON match_guests (inviter_id);

CREATE TABLE matches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matchday_id     uuid NOT NULL REFERENCES matchdays(id) ON DELETE RESTRICT,
  season_id       uuid NOT NULL REFERENCES seasons(id) ON DELETE RESTRICT,
  result          match_result,
  score_white     int CHECK (score_white >= 0),
  score_black     int CHECK (score_black >= 0),
  motm_user_id    uuid REFERENCES profiles(id),
  motm_guest_id   uuid REFERENCES match_guests(id),
  notes           text,
  approved_at     timestamptz,
  approved_by     uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES profiles(id),

  CONSTRAINT matches_motm_xor CHECK (
    motm_user_id IS NULL OR motm_guest_id IS NULL
  ),
  CONSTRAINT matches_one_per_matchday UNIQUE (matchday_id)
);
CREATE INDEX matches_season_idx   ON matches (season_id);
CREATE INDEX matches_approved_idx ON matches (approved_at) WHERE approved_at IS NOT NULL;

CREATE TABLE match_players (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id          uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  profile_id        uuid REFERENCES profiles(id),
  guest_id          uuid REFERENCES match_guests(id),
  team              team_color NOT NULL,
  is_captain        boolean NOT NULL DEFAULT false,
  goals             int NOT NULL DEFAULT 0 CHECK (goals >= 0),
  yellow_cards      int NOT NULL DEFAULT 0 CHECK (yellow_cards >= 0),
  red_cards         int NOT NULL DEFAULT 0 CHECK (red_cards >= 0),
  substituted_in_by uuid REFERENCES profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES profiles(id),

  CONSTRAINT match_players_participant_xor CHECK (
    (profile_id IS NOT NULL AND guest_id IS NULL) OR
    (profile_id IS NULL AND guest_id IS NOT NULL)
  ),
  CONSTRAINT match_players_unique_profile UNIQUE (match_id, profile_id),
  CONSTRAINT match_players_unique_guest   UNIQUE (match_id, guest_id)
);
CREATE INDEX match_players_team_idx    ON match_players (match_id, team);
CREATE INDEX match_players_profile_idx ON match_players (profile_id) WHERE profile_id IS NOT NULL;
CREATE INDEX match_players_substituted_idx
  ON match_players (substituted_in_by) WHERE substituted_in_by IS NOT NULL;
