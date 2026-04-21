-- 0004_poll_ref_workflow.sql — poll_votes, ref_tokens, pending_match_entries (§2.4)

CREATE TABLE poll_votes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matchday_id  uuid NOT NULL REFERENCES matchdays(id) ON DELETE CASCADE,
  profile_id   uuid NOT NULL REFERENCES profiles(id),
  choice       poll_choice NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT poll_votes_unique UNIQUE (matchday_id, profile_id)
);
CREATE INDEX poll_votes_order_idx
  ON poll_votes (matchday_id, committed_at, id)
  WHERE choice = 'yes' AND cancelled_at IS NULL;
CREATE INDEX poll_votes_profile_idx ON poll_votes (profile_id);

CREATE TABLE ref_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matchday_id  uuid NOT NULL REFERENCES matchdays(id) ON DELETE CASCADE,
  token_sha256 text NOT NULL UNIQUE,
  issued_at    timestamptz NOT NULL DEFAULT now(),
  issued_by    uuid NOT NULL REFERENCES profiles(id),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  label        text
);
CREATE INDEX ref_tokens_active_idx
  ON ref_tokens (matchday_id, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE pending_match_entries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matchday_id           uuid NOT NULL REFERENCES matchdays(id) ON DELETE CASCADE,
  submitted_by_token_id uuid NOT NULL REFERENCES ref_tokens(id),
  result                match_result NOT NULL,
  score_white           int NOT NULL CHECK (score_white >= 0),
  score_black           int NOT NULL CHECK (score_black >= 0),
  notes                 text,
  submitted_at          timestamptz NOT NULL DEFAULT now(),
  status                pending_match_status NOT NULL DEFAULT 'pending',
  approved_at           timestamptz,
  approved_by           uuid REFERENCES profiles(id),
  rejected_at           timestamptz,
  rejected_by           uuid REFERENCES profiles(id),
  rejection_reason      text,

  CONSTRAINT pme_status_consistent CHECK (
    (status = 'pending'  AND approved_at IS NULL  AND rejected_at IS NULL) OR
    (status = 'approved' AND approved_at IS NOT NULL AND rejected_at IS NULL) OR
    (status = 'rejected' AND rejected_at IS NOT NULL AND approved_at IS NULL)
  )
);
CREATE INDEX pme_queue_idx
  ON pending_match_entries (submitted_at) WHERE status = 'pending';

CREATE TABLE pending_match_entry_players (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_entry_id uuid NOT NULL REFERENCES pending_match_entries(id) ON DELETE CASCADE,
  profile_id       uuid REFERENCES profiles(id),
  guest_id         uuid REFERENCES match_guests(id),
  team             team_color NOT NULL,
  goals            int NOT NULL DEFAULT 0 CHECK (goals >= 0),
  yellow_cards     int NOT NULL DEFAULT 0 CHECK (yellow_cards >= 0),
  red_cards        int NOT NULL DEFAULT 0 CHECK (red_cards >= 0),
  is_motm          boolean NOT NULL DEFAULT false,

  CONSTRAINT pmep_participant_xor CHECK (
    (profile_id IS NOT NULL AND guest_id IS NULL) OR
    (profile_id IS NULL AND guest_id IS NOT NULL)
  )
);
CREATE INDEX pmep_entry_idx ON pending_match_entry_players (pending_entry_id);
