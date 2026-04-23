-- 0020_v_match_commitments_guest_id.sql
--
-- Extend v_match_commitments to expose match_guests.id directly on guest rows,
-- eliminating the client-side join-by-display_name hack in Poll.tsx (S026).
-- Two guests sharing a display name on the same matchday would collide in the
-- old `find(g => g.display_name === r.guest_display_name)` lookup. Surfacing
-- the guest row id lets the caller map commitments to guest rows by pk.
--
-- CREATE OR REPLACE VIEW requires additional columns to be appended at the
-- end of the column list, so `guest_id` is the new trailing column (uuid,
-- NULL for player rows, match_guests.id for guest rows).
--
-- Grants: ALTER DEFAULT PRIVILEGES from 0012_grants.sql covers views
-- created in schema public, so no explicit GRANT SELECT is needed — but
-- CREATE OR REPLACE preserves existing grants anyway.

CREATE OR REPLACE VIEW v_match_commitments AS
SELECT matchday_id,
       'player'::text AS commitment_type,
       profile_id AS participant_id,
       NULL::uuid AS inviter_id,
       NULL::text AS guest_display_name,
       committed_at AS sort_ts,
       ROW_NUMBER() OVER (PARTITION BY matchday_id ORDER BY committed_at) AS slot_order,
       NULL::uuid AS guest_id
FROM poll_votes
WHERE choice = 'yes' AND cancelled_at IS NULL
UNION ALL
SELECT matchday_id,
       'guest'::text,
       NULL,
       inviter_id,
       display_name,
       created_at AS sort_ts,
       ROW_NUMBER() OVER (PARTITION BY matchday_id ORDER BY created_at) + 10000 AS slot_order,
       id AS guest_id
FROM match_guests
WHERE cancelled_at IS NULL;
