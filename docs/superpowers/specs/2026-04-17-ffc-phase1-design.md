# FFC Phase 1 Design — Core Weekly Cycle
**Date:** 2026-04-17 (initial) · updated through S013 (21/APR/2026)
**Status:** Feature-complete · formal Phase 1 approval in progress (S013).
- Section 1 (Architecture) — **APPROVED (S004)** · S013 non-goal inconsistency fix applied.
- Section 2 (Data Model) — **APPROVED** in parts (S003 Parts 1–3 · S004 Parts 4–5A/B/C); amended through S007+S009+S011 (guest stats, leaderboard sort, theme, positions, draft sessions, formations).
- Section 3 (Screens & Nav) — **§3.0 / §3.1-v2 / §3.7 / §3.13 / §3.14 / §3.15 / §3.16 / §3.17 / §3.18 / §3.19 APPROVED** (Depth-B spec + mockup per §3.x). §3.2–§3.6 carry from S002 sub-designs (text-only).
- Sections 4 (Notifications), 5 (Cron/Reminders), 6 (Implementation plan) — queued for post-approval.

---

## Section 1 — Architecture & Stack (APPROVED — S004, 19/APR/2026)

**Stack (direct reuse of PadelHub, lessons already baked in):**
- Frontend: React 18 + Vite, mobile-first PWA, inline HTML splash, installable
- Backend: Supabase Postgres with RLS, Auth (email/password + Google OAuth), Web Push via Deno Edge Function, Storage for result images
- Deploy: Vercel (GitHub auto-deploy), separate project from PadelHub
- Repo (new): `github.com/mmuwahid/FFC`
- Supabase project (new): TBD
- Vercel team (reused): `team_HYo81T72HYGzt54bLoeLYkZx`, new project
- Domain: `ffc.vercel.app` placeholder; custom later

**Reused from PadelHub (zero rewrite):**
- Auth: `PASSWORD_RECOVERY` handler, friendlyAuthError() mapper, Google OAuth with `redirectTo` preserving `?invite=` query params
- PWA: inline splash, safe-area insets, service worker (network-first JS / cache-first assets), `postMessage` SW-update flow
- Notifications: RFC 8291 Web Push, target_user_ids pattern, SECURITY DEFINER RPCs
- Admin dashboard skeleton, type-to-confirm destructive actions, toast system, ErrorBoundary
- Patterns: component extraction with view-local state, plain-object Context (no useMemo cascades)

**New for FFC:**
- 7v7 team match data model (different from PadelHub 2v2)
- Self-signup + admin approval + "claim existing profile" onboarding (new in S002)
- Multi-season with per-season roster policy (fresh / carry forward) (new in S002)
- Weekly poll with lock + waitlist + auto-unlocking +1 guest slots (new in S002)
- Ref entry link + admin approval queue for match results (new in S002)
- Discipline & lateness tracking (schema only in Phase 1; enforcement in Phase 2)
- Matchday-based seasons with target matchday count
- Result PNG generator (html-to-image)
- Native share-sheet integration
- "Who can captain?" admin helper screen (new in S002)
- Last-5 form indicator component (new in S002)

**Phase 1 explicit non-goals:**
- Captain **auto-pick** on roster lock (Phase 2 — Phase 1 includes the captain helper, manual captain draft with live visibility via §3.7 State 6.5, and post-lock reroll with `[Accept substitute]` / `[Request reroll]` captain modal)
- Automated discipline rules (schema ready; enforcement + bans in Phase 2; admin can manually apply point penalties in Phase 1)
- Season awards page (Phase 3)
- H2H, deep form guide, payment tracking, badges, injury list (Phase 4)

**S013 note:** The earlier "Captain draft flow (Phase 2)" non-goal was removed — S009–S011 brought manual captain draft (admin chooses captains + picks alternate), live draft visibility (§3.7 State 6.5 via `draft_sessions` + `draft_picks` realtime), and post-lock captain reroll into Phase 1 scope. Only the *automated* "pick on lock" helper is Phase 2.

---

## Section 2 — Data Model (APPROVED — S003 Parts 1–3, S004 Parts 4–5)

**Status:** Full production DDL. Approved in five parts: S003 approved Parts 1–3; S004 approved Part 4 (operational tables) and Part 5A/5B/5C (views, RPCs, RLS).

**Scope decision (S003 Q1):** Ready-to-paste migration SQL — no iteration, no placeholders.

**Architecture decisions locked (S003):**
1. **Commitment architecture = split.** `poll_votes` (registered players) + `match_guests` (+1 guests), merged by view for 14-slot ordering.
2. **MOTM single source of truth.** Two nullable pointers on `matches` with XOR CHECK. No `is_motm` flag on guests.
3. **Pending queues stay separate.** `pending_signups` (onboarding) vs `pending_match_entries` (ref submissions).
4. **RLS effective roles = 3.** player / admin / super_admin. Anonymous ref path is RPC-only (no anon table access).

**Queries the sub-designs in Section 3 rely on:**
- **Captain helper (3.1)** → `v_captain_eligibility` view (5 boolean criteria + composite `is_eligible`).
- **Last-5 form indicator (3.2)** → `v_player_last5` view.
- **Player self-signup (3.3)** → `pending_signups` table + `approve_signup` / `reject_signup` RPCs.
- **Ref entry (3.4)** → `ref_tokens` + `pending_match_entries` + `submit_ref_entry` (anon-callable) + `approve_match_entry` / `reject_match_entry` RPCs.
- **+1 guest mechanic (3.5)** → `match_guests` table; slot count via `v_match_commitments`.
- **Vote-order / waitlist (3.6)** → `poll_votes.committed_at` + `v_match_commitments` ordered by `sort_ts`.

**Section 2 ↔ Section 3 column-name reconciliation (Section 2 is authoritative; Section 3 sub-design text pre-dates the DDL):**

| Section 3 text uses | Section 2 DDL uses | Resolution |
|---|---|---|
| `poll_votes.voted_at` | `poll_votes.committed_at` | Use `committed_at` — tracks first transition into 'yes', not every UPDATE. Section 3.6 will be rewritten against `committed_at`. |
| `match_guests.inviter_user_id` | `match_guests.inviter_id` | Use `inviter_id`. FK target is `profiles.id`, which is not auth.users. |
| `match_guests.guest_display_name` | `match_guests.display_name` | Use `display_name`. Shorter, context makes "guest" implicit. |
| `match_guests` goal counter (Section 3.5) | goals live on `match_players.goals` via `guest_id` | Guests' stats are on `match_players` rows with `guest_id` set, `profile_id` null. Consistent with single stats location. |

**Open item flagged for user review:** the `v_captain_eligibility` view (§2.6) uses **5 criteria** (min 5 matches played, no reds, ≤2 yellows, attendance ≥60%, points > 0). The S002 captain formula (masterplan V2.1) may have slightly different or additional criteria (e.g. "played with every FFC member who played ≥1 match this season", "matchdays since last captained"). These are computable from the same tables and can be added as additional columns once V2.1/V2.3 formula text is reconciled.

**Required Postgres extensions** (add to migration 0001 preamble):

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- digest() for ref-token sha256
CREATE EXTENSION IF NOT EXISTS pg_cron;    -- scheduled_reminders cron binding
```

---

### 2.1 Enums

```sql
CREATE TYPE user_role       AS ENUM ('player','admin','super_admin','rejected');
-- S013: `'rejected'` added for §3.17 Admin Players rejected tab. A rejected applicant
-- becomes a ghost `profiles` row with role = 'rejected' + `reject_reason` populated, so
-- admins retain a visible audit trail beyond the `pending_signups.resolution='rejected'`
-- row. Masterplan V2.7 referred to this as "profile_role" — that is naming drift; the
-- actual enum is `user_role` and is authoritative per CLAUDE.md Rule #7.
CREATE TYPE team_color      AS ENUM ('white','black');
CREATE TYPE match_result    AS ENUM ('win_white','win_black','draw');
CREATE TYPE poll_choice     AS ENUM ('yes','no','maybe');
CREATE TYPE season_status   AS ENUM ('active','ended','archived');
CREATE TYPE roster_policy   AS ENUM ('fresh','carry_forward');
CREATE TYPE signup_resolution AS ENUM ('pending','approved','rejected');
CREATE TYPE pending_match_status AS ENUM ('pending','approved','rejected');

CREATE TYPE notification_kind AS ENUM (
  'poll_open','poll_reminder','roster_locked','teams_posted',
  'plus_one_unlocked','plus_one_slot_taken',
  'match_entry_submitted','match_entry_approved','match_entry_rejected',
  'signup_approved','signup_rejected',
  'admin_promoted','season_archived',
  -- ADDED IN S013 (consolidates S009–S011 deltas from masterplan V2.7)
  'dropout_after_lock',                  -- a confirmed player cancels after roster lock
  'draft_reroll_started',                -- captain triggered a reroll; notify both teams
  'reroll_triggered_by_opponent',        -- sent to the non-triggering captain
  'captain_dropout_needs_replacement',   -- captain-is-the-dropout; routes to admins
  'formation_reminder',                  -- nudge captain 24h before kickoff to plan
  'formation_shared'                     -- captain pressed "Share" on §3.19 formation
);
CREATE TYPE reminder_kind    AS ENUM (
  'poll_open_broadcast','poll_cutoff_warning',
  'plus_one_unlock_broadcast','teams_post_reminder','custom'
);
CREATE TYPE reminder_channel AS ENUM ('push','email','whatsapp_share');

-- Added in S005 (19/APR/2026)
CREATE TYPE player_position  AS ENUM ('GK','DEF','CDM','W','ST');
CREATE TYPE theme_preference AS ENUM ('light','dark','system');

-- Added in S006 (20/APR/2026) — leaderboard sort persistence (O3 resolution)
CREATE TYPE leaderboard_sort AS ENUM ('points','goals','motm','wins','last5_form');

-- Added in S007 (20/APR/2026) — guest-player stats (Q1–Q6 resolution, §3.5 +1 enrichment)
CREATE TYPE guest_rating AS ENUM ('weak','average','strong');
CREATE TYPE guest_trait  AS ENUM ('low','medium','high');

-- Added in S013 (21/APR/2026) — captain draft session states (consolidates S011 V2.7)
-- Referenced by `draft_sessions` (see §2.5) for live manual captain picking (§3.7 State 6.5)
-- and post-lock captain reroll.
CREATE TYPE draft_status AS ENUM ('in_progress','completed','abandoned');
CREATE TYPE draft_reason AS ENUM ('initial','reroll_after_dropout');

-- Added in S013 (21/APR/2026) — multi-format support (locked S012).
-- Default FFC cycle is 7v7. An individual matchday can be overridden to 5v5 (when <14
-- commit and the admin wants to run a shorter game rather than cancel), OR an entire
-- season can be scheduled as a 5v5 league via seasons.default_format.
-- Roster cap is a direct derivation: 7v7 → 14 slots total, 5v5 → 10 slots total.
CREATE TYPE match_format AS ENUM ('7v7','5v5');
```

**Position catalogue (S005 decision — 5 positions, colour-coded for UI tags):**

| Code | Name | Colour token | Hex |
|---|---|---|---|
| `GK` | Goalkeeper | `--pos-gk` | `#d4a84a` (gold) |
| `DEF` | Defender (CB / FB) | `--pos-def` | `#1e3a8a` (deep blue) |
| `CDM` | Defensive midfielder | `--pos-cdm` | `#065f46` (dark green) |
| `W` | Winger | `--pos-w` | `#ea580c` (orange) |
| `ST` | Striker | `--pos-st` | `#c8102e` (FFC accent red) |

Generalist central-midfielder (CM) and attacking-mid (CAM) roles are intentionally excluded; players who fit those map to CDM (defensive-leaning) or W (attacking-leaning) as their primary.

---

### 2.2 Base entities (Part 1)

```sql
-- profiles: one row per FFC player; auth_user_id links to Supabase auth.users when claimed
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
  notes              text,                           -- admin-only scratch notes
  -- ADDED IN S005 — player positions + theme preference
  primary_position   player_position,                -- required at signup; nullable for ghost/legacy profiles
  secondary_position player_position,                -- optional
  theme_preference   theme_preference NOT NULL DEFAULT 'system',
  -- ADDED IN S006 — persisted leaderboard sort preference (O3 resolution)
  leaderboard_sort   leaderboard_sort NOT NULL DEFAULT 'points',
  -- ADDED IN S013 — rejection context for role='rejected' ghost profiles (§3.17 Admin Players)
  -- Populated by `reject_signup` RPC when an admin denies a pending_signup; surfaced in the
  -- Admin Players rejected tab for audit. Null for every non-rejected role.
  reject_reason      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES profiles(id),

  CONSTRAINT profiles_positions_differ CHECK (
    secondary_position IS NULL OR primary_position IS DISTINCT FROM secondary_position
  ),
  -- S013: reject_reason only meaningful when role='rejected'; non-rejected roles must leave it null
  CONSTRAINT profiles_reject_reason_scope CHECK (
    (role = 'rejected') OR (reject_reason IS NULL)
  )
);

CREATE INDEX profiles_active_idx     ON profiles (is_active) WHERE is_active = true;
CREATE INDEX profiles_role_idx       ON profiles (role);
CREATE INDEX profiles_primary_pos_idx ON profiles (primary_position) WHERE is_active = true;
CREATE UNIQUE INDEX profiles_auth_user_unique
  ON profiles (auth_user_id) WHERE auth_user_id IS NOT NULL;

-- S005 migration note (for an existing DB this would be an ALTER; for greenfield it's baked
-- into the CREATE above):
--   ALTER TABLE profiles
--     ADD COLUMN primary_position   player_position,
--     ADD COLUMN secondary_position player_position,
--     ADD COLUMN theme_preference   theme_preference NOT NULL DEFAULT 'system',
--     ADD CONSTRAINT profiles_positions_differ CHECK (
--       secondary_position IS NULL OR primary_position IS DISTINCT FROM secondary_position
--     );

-- S006 migration note — adds persisted leaderboard sort preference (resolves O3 from §3.13):
--   CREATE TYPE leaderboard_sort AS ENUM ('points','goals','motm','wins','last5_form');
--   ALTER TABLE profiles
--     ADD COLUMN leaderboard_sort leaderboard_sort NOT NULL DEFAULT 'points';

-- pending_signups: self-registrations awaiting admin decision
CREATE TABLE pending_signups (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name        text NOT NULL,
  email               text NOT NULL,
  phone               text,
  claim_profile_hint  uuid REFERENCES profiles(id),  -- if user said "I'm the existing ghost profile"
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

-- seasons: containers for matchdays/leaderboard windows
CREATE TABLE seasons (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,                    -- "Spring 2026", etc.
  starts_on        date NOT NULL,
  ends_on          date,                              -- NULL while active
  roster_policy    roster_policy NOT NULL DEFAULT 'carry_forward',
  -- ADDED IN S013 — season-level default for per-matchday `matchdays.format` (see §2.3).
  -- 7v7 is the app default; a season can be scheduled as 5v5-only by setting this to '5v5'.
  -- Per-matchday overrides are still allowed via `matchdays.format`.
  default_format   match_format NOT NULL DEFAULT '7v7',
  ended_at         timestamptz,
  ended_by         uuid REFERENCES profiles(id),
  archived_at      timestamptz,
  archived_by      uuid REFERENCES profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES profiles(id),

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

-- matchdays: one scheduled fixture (Thursday slot)
CREATE TABLE matchdays (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     uuid NOT NULL REFERENCES seasons(id) ON DELETE RESTRICT,
  kickoff_at    timestamptz NOT NULL,
  venue         text,
  poll_opens_at timestamptz NOT NULL,                 -- Mon 20:00 default
  poll_closes_at timestamptz NOT NULL,                 -- Wed 20:00 default
  roster_locked_at timestamptz,                        -- set when admin locks the roster
  -- ADDED IN S013 — optional per-matchday override of `seasons.default_format` (§2.2).
  -- NULL means "inherit season default" — resolved via `effective_format(matchday_id)`
  -- helper in §2.5. Admin can override per matchday via §3.18 (e.g., only 11 confirmed
  -- → flip to 5v5 instead of cancelling). Roster cap derives: 7v7 → 14, 5v5 → 10.
  format        match_format,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES profiles(id),

  CONSTRAINT matchdays_poll_window_valid CHECK (poll_closes_at > poll_opens_at AND kickoff_at > poll_closes_at)
);
CREATE INDEX matchdays_season_idx ON matchdays (season_id, kickoff_at DESC);
```

---

### 2.3 Match data (Part 2)

```sql
-- match_guests: +1 entries, keyed to matchday (not match, because roster is locked pre-match)
CREATE TABLE match_guests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matchday_id        uuid NOT NULL REFERENCES matchdays(id) ON DELETE CASCADE,
  inviter_id         uuid NOT NULL REFERENCES profiles(id),
  display_name       text NOT NULL,
  -- ADDED IN S007 (20/APR/2026) — guest stats for captain-pair balancing (§3.1-v2)
  -- All 6 columns nullable at DB level; app-layer invite form (§3.5) enforces required
  -- fields: primary_position, stamina, accuracy, rating. secondary_position + description optional.
  primary_position   player_position,                 -- reuses §2.1 player_position enum
  secondary_position player_position,
  stamina            guest_trait,                     -- low | medium | high
  accuracy           guest_trait,                     -- low | medium | high
  rating             guest_rating,                    -- weak | average | strong
  description        text,                            -- ≤ 140 chars, single-line
  -- ADDED IN S009 (20/APR/2026) — audit trail for admin edits via update_guest_stats (§2.7)
  updated_by         uuid REFERENCES profiles(id),    -- nullable; set by update_guest_stats RPC
  updated_at         timestamptz,                     -- nullable; set by update_guest_stats RPC
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

-- S007 migration note — adds guest-stats columns (resolves Q1–Q6 from S006 scope lock).
-- For an existing DB this would be an ALTER; greenfield bakes into the CREATE above:
--   CREATE TYPE guest_rating AS ENUM ('weak','average','strong');
--   CREATE TYPE guest_trait  AS ENUM ('low','medium','high');
--   ALTER TABLE match_guests
--     ADD COLUMN primary_position   player_position,
--     ADD COLUMN secondary_position player_position,
--     ADD COLUMN stamina            guest_trait,
--     ADD COLUMN accuracy           guest_trait,
--     ADD COLUMN rating             guest_rating,
--     ADD COLUMN description        text,
--     ADD CONSTRAINT match_guests_positions_differ CHECK (
--       secondary_position IS NULL OR primary_position IS DISTINCT FROM secondary_position
--     ),
--     ADD CONSTRAINT match_guests_description_length CHECK (
--       description IS NULL OR char_length(description) <= 140
--     );

-- S009 migration note (20/APR/2026) — adds audit columns so admin corrections via the
-- update_guest_stats RPC (§2.7) are traceable. Both columns nullable — a fresh invite has
-- no audit trail; only admin edits populate them. For an existing DB this would be an ALTER;
-- greenfield bakes into the CREATE above:
--   ALTER TABLE match_guests
--     ADD COLUMN updated_by uuid REFERENCES profiles(id),
--     ADD COLUMN updated_at timestamptz;

-- matches: one row per played fixture. Draft created at roster-lock, flipped to approved on ref approval.
CREATE TABLE matches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matchday_id       uuid NOT NULL REFERENCES matchdays(id) ON DELETE RESTRICT,
  season_id         uuid NOT NULL REFERENCES seasons(id) ON DELETE RESTRICT,
  result            match_result,
  score_white       int CHECK (score_white >= 0),
  score_black       int CHECK (score_black >= 0),
  motm_user_id      uuid REFERENCES profiles(id),
  motm_guest_id     uuid REFERENCES match_guests(id),
  notes             text,
  approved_at       timestamptz,                        -- null = draft; set = final
  approved_by       uuid REFERENCES profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES profiles(id),

  CONSTRAINT matches_motm_xor CHECK (
    motm_user_id IS NULL OR motm_guest_id IS NULL
  ),
  CONSTRAINT matches_one_per_matchday UNIQUE (matchday_id)
);
CREATE INDEX matches_season_idx   ON matches (season_id);
CREATE INDEX matches_approved_idx ON matches (approved_at) WHERE approved_at IS NOT NULL;

-- match_players: one row per (match, participant). Participant = registered player OR guest (mutually exclusive).
CREATE TABLE match_players (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id           uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  profile_id         uuid REFERENCES profiles(id),
  guest_id           uuid REFERENCES match_guests(id),
  team               team_color NOT NULL,
  is_captain         boolean NOT NULL DEFAULT false,
  goals              int NOT NULL DEFAULT 0 CHECK (goals >= 0),
  yellow_cards       int NOT NULL DEFAULT 0 CHECK (yellow_cards >= 0),
  red_cards          int NOT NULL DEFAULT 0 CHECK (red_cards >= 0),
  -- ADDED IN S013 — post-lock substitution audit trail (captain-reroll flow, S011 V2.7).
  -- Populated by `promote_from_waitlist` RPC when a waitlist player fills a dropout slot
  -- after roster lock. Null for every organic (non-substituted) match_players row.
  substituted_in_by  uuid REFERENCES profiles(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES profiles(id),

  CONSTRAINT match_players_participant_xor CHECK (
    (profile_id IS NOT NULL AND guest_id IS NULL) OR
    (profile_id IS NULL AND guest_id IS NOT NULL)
  ),
  CONSTRAINT match_players_unique_profile UNIQUE (match_id, profile_id),
  CONSTRAINT match_players_unique_guest   UNIQUE (match_id, guest_id)
);
CREATE INDEX match_players_team_idx    ON match_players (match_id, team);
CREATE INDEX match_players_profile_idx ON match_players (profile_id) WHERE profile_id IS NOT NULL;
-- S013: partial index for admin audit queries that filter substituted rows only
CREATE INDEX match_players_substituted_idx
  ON match_players (substituted_in_by) WHERE substituted_in_by IS NOT NULL;
```

---

### 2.4 Poll + ref workflow (Part 3)

```sql
-- poll_votes: registered-player commitments. Composite ordering drives vote-order / waitlist.
CREATE TABLE poll_votes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matchday_id    uuid NOT NULL REFERENCES matchdays(id) ON DELETE CASCADE,
  profile_id     uuid NOT NULL REFERENCES profiles(id),
  choice         poll_choice NOT NULL,
  committed_at   timestamptz NOT NULL DEFAULT now(),   -- first transition into 'yes'
  cancelled_at   timestamptz,
  cancelled_by   uuid REFERENCES profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT poll_votes_unique UNIQUE (matchday_id, profile_id)
);
CREATE INDEX poll_votes_order_idx
  ON poll_votes (matchday_id, committed_at, id)
  WHERE choice = 'yes' AND cancelled_at IS NULL;
CREATE INDEX poll_votes_profile_idx ON poll_votes (profile_id);

-- ref_tokens: one-shot signed tokens issued by admin for a specific matchday
CREATE TABLE ref_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matchday_id    uuid NOT NULL REFERENCES matchdays(id) ON DELETE CASCADE,
  token_sha256   text NOT NULL UNIQUE,                 -- raw token never stored
  issued_at      timestamptz NOT NULL DEFAULT now(),
  issued_by      uuid NOT NULL REFERENCES profiles(id),
  expires_at     timestamptz NOT NULL,
  consumed_at    timestamptz,                          -- burned on successful submit
  label          text                                   -- "Ahmed (ref)"; admin note
);
CREATE INDEX ref_tokens_active_idx
  ON ref_tokens (matchday_id, expires_at)
  WHERE consumed_at IS NULL;

-- pending_match_entries: ref submissions awaiting admin approval
CREATE TABLE pending_match_entries (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matchday_id              uuid NOT NULL REFERENCES matchdays(id) ON DELETE CASCADE,
  submitted_by_token_id    uuid NOT NULL REFERENCES ref_tokens(id),
  result                   match_result NOT NULL,
  score_white              int NOT NULL CHECK (score_white >= 0),
  score_black              int NOT NULL CHECK (score_black >= 0),
  notes                    text,
  submitted_at             timestamptz NOT NULL DEFAULT now(),
  status                   pending_match_status NOT NULL DEFAULT 'pending',
  approved_at              timestamptz,
  approved_by              uuid REFERENCES profiles(id),
  rejected_at              timestamptz,
  rejected_by              uuid REFERENCES profiles(id),
  rejection_reason         text,

  CONSTRAINT pme_status_consistent CHECK (
    (status = 'pending'  AND approved_at IS NULL AND rejected_at IS NULL) OR
    (status = 'approved' AND approved_at IS NOT NULL AND rejected_at IS NULL) OR
    (status = 'rejected' AND rejected_at IS NOT NULL AND approved_at IS NULL)
  )
);
CREATE INDEX pme_queue_idx
  ON pending_match_entries (submitted_at) WHERE status = 'pending';

-- pending_match_entry_players: line items for a pending submission
CREATE TABLE pending_match_entry_players (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_entry_id   uuid NOT NULL REFERENCES pending_match_entries(id) ON DELETE CASCADE,
  profile_id         uuid REFERENCES profiles(id),
  guest_id           uuid REFERENCES match_guests(id),
  team               team_color NOT NULL,
  goals              int NOT NULL DEFAULT 0 CHECK (goals >= 0),
  yellow_cards       int NOT NULL DEFAULT 0 CHECK (yellow_cards >= 0),
  red_cards          int NOT NULL DEFAULT 0 CHECK (red_cards >= 0),
  is_motm            boolean NOT NULL DEFAULT false,

  CONSTRAINT pmep_participant_xor CHECK (
    (profile_id IS NOT NULL AND guest_id IS NULL) OR
    (profile_id IS NULL AND guest_id IS NOT NULL)
  )
);
CREATE INDEX pmep_entry_idx ON pending_match_entry_players (pending_entry_id);
```

---

### 2.5 Operational tables (Part 4)

```sql
-- notifications: fan-out on write. One row per (event, recipient).
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

-- player_bans: schema only in Phase 1; enforcement in Phase 2
CREATE TABLE player_bans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  reason      text NOT NULL,
  imposed_by  uuid NOT NULL REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  revoked_by  uuid REFERENCES profiles(id),

  CONSTRAINT player_bans_valid_range CHECK (ends_at > starts_at),
  CONSTRAINT player_bans_revoke_consistent CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL) OR
    (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
  )
);
CREATE INDEX player_bans_profile_active_idx
  ON player_bans (profile_id, ends_at) WHERE revoked_at IS NULL;

-- push_subscriptions: Web Push endpoints (ported from PadelHub)
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

-- app_settings: key/value JSON for runtime config (super-admin writes only)
CREATE TABLE app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES profiles(id)
);

-- Seeded keys (insert in migration)
INSERT INTO app_settings (key, value, description) VALUES
  ('whatsapp_group_link', '""'::jsonb,
    'Invite / join link for the FFC WhatsApp group.'),
  ('whatsapp_share_templates', '{
      "poll_open":        "🎯 FFC poll is open — vote for Thursday:\n{{poll_url}}",
      "plus_one_unlock":  "⚽ <{{roster_cap}} confirmed for Thursday. +1 slot unlocked:\n{{poll_url}}",
      "teams_posted":     "🏁 Teams up for {{match_date}}:\n{{match_url}}",
      "result_posted":    "📊 {{match_date}} result:\n{{share_url}}"
    }'::jsonb,
    'Text templates for native share-sheet to WhatsApp. S013: {{roster_cap}} placeholder substituted at render time with roster_cap(effective_format(matchday_id)) — 14 for 7v7, 10 for 5v5.'),
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
    'Tunable match & captain constants. Penalties: -1 point after roster/teams locked; -1 point + 7-day ban if cancelled within 24h of kickoff.'),
  ('season_settings', '{"default_roster_policy":"carry_forward"}'::jsonb,
    'Defaults applied when creating a new season.');

-- scheduled_reminders: pg_cron-driven. Admin dashboard edits rows.
CREATE TABLE scheduled_reminders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              reminder_kind NOT NULL,
  label             text NOT NULL,
  cron_expression   text NOT NULL,
  timezone          text NOT NULL DEFAULT 'Asia/Dubai',
  enabled           boolean NOT NULL DEFAULT true,
  channels          reminder_channel[] NOT NULL DEFAULT ARRAY['push']::reminder_channel[],
  target_audience   text NOT NULL DEFAULT 'active_players',
  payload_template  jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_fired_at     timestamptz,
  last_fire_status  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES profiles(id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES profiles(id),

  CONSTRAINT scheduled_reminders_audience_valid CHECK (
    target_audience IN ('active_players','admins','super_admins','all')
  )
);
CREATE INDEX scheduled_reminders_enabled_idx
  ON scheduled_reminders (enabled, kind) WHERE enabled = true;

-- Seeded Phase 1 reminders (5 rows; created_by bound to first super-admin at seed time)
-- Times = Asia/Dubai. Weekly cycle: Mon poll → Tue nudge → Wed +1 unlock → Wed team-selection → Thu fallback.
INSERT INTO scheduled_reminders
  (kind, label, cron_expression, channels, target_audience, payload_template, created_by)
VALUES
  ('poll_open_broadcast',       'Monday 5:00 PM — roll-call poll opens',
    '0 17 * * 1',  ARRAY['push','whatsapp_share']::reminder_channel[], 'admins',
    '{"title":"Poll is live","body":"Tap to post the roll-call to the group.","share_template_key":"poll_open"}'::jsonb,
    (SELECT id FROM profiles WHERE role='super_admin' LIMIT 1)),
  ('poll_cutoff_warning',       'Tuesday 9:00 PM — nudge non-voters',
    '0 21 * * 2',  ARRAY['push']::reminder_channel[], 'active_players',
    '{"title":"Still need your vote","body":"Poll closes tomorrow night."}'::jsonb,
    (SELECT id FROM profiles WHERE role='super_admin' LIMIT 1)),
  ('plus_one_unlock_broadcast', 'Wednesday 8:00 PM — +1 slots unlock if not full',
    '0 20 * * 3',  ARRAY['push','whatsapp_share']::reminder_channel[], 'admins',
    '{"title":"+1 slots unlocked","body":"Roster < 14. Tap to post to the group.","share_template_key":"plus_one_unlock"}'::jsonb,
    (SELECT id FROM profiles WHERE role='super_admin' LIMIT 1)),
  ('teams_post_reminder',       'Wednesday 10:00 PM — complete team selection tonight',
    '0 22 * * 3',  ARRAY['push']::reminder_channel[], 'admins',
    '{"title":"Team selection due","body":"Lock rosters and enter teams tonight; Thursday is the hard fallback."}'::jsonb,
    (SELECT id FROM profiles WHERE role='super_admin' LIMIT 1)),
  ('teams_post_reminder',       'Thursday 12:00 PM — fallback: teams must be posted before kickoff',
    '0 12 * * 4',  ARRAY['push']::reminder_channel[], 'admins',
    '{"title":"Last chance: post the teams","body":"Kick-off is in ~8 hours. If teams are already posted, ignore."}'::jsonb,
    (SELECT id FROM profiles WHERE role='super_admin' LIMIT 1));

-- =========================================================================
-- S013 ADDITIONS (consolidates S009 admin_audit_log + S011 captain-draft /
-- formation planner tables + 3 new app_settings keys from V2.7).
-- =========================================================================

-- admin_audit_log: append-only trail for admin mutations on matches, profiles, guests, etc.
-- Surfaced in §3.17/§3.18 (S009). Written by every SECURITY DEFINER RPC that mutates on
-- behalf of an admin (e.g. edit_match_result, update_guest_stats, approve_signup, reject_signup,
-- promote_from_waitlist). Read path is admin-only (see §2.8 RLS).
CREATE TABLE admin_audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  target_entity    text NOT NULL,                            -- 'matches' | 'profiles' | 'match_guests' | ...
  target_id        uuid,                                     -- nullable when action is broad (e.g. bulk)
  action           text NOT NULL,                            -- 'edit_result' | 'reject_signup' | ...
  payload_jsonb    jsonb NOT NULL DEFAULT '{}'::jsonb,       -- before/after diff or arbitrary ctx
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_log_admin_recent_idx
  ON admin_audit_log (admin_profile_id, created_at DESC);
CREATE INDEX admin_audit_log_target_idx
  ON admin_audit_log (target_entity, target_id, created_at DESC) WHERE target_id IS NOT NULL;

-- draft_sessions: live manual captain draft (§3.7 State 6.5). Captains alternate picks
-- starting from `current_picker_team`. One active (status='in_progress') session per
-- matchday, enforced by a partial unique index. Completed or abandoned sessions persist
-- for audit / history.
CREATE TABLE draft_sessions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matchday_id             uuid NOT NULL REFERENCES matchdays(id) ON DELETE CASCADE,
  status                  draft_status NOT NULL DEFAULT 'in_progress',
  current_picker_team     team_color NOT NULL DEFAULT 'white',
  reason                  draft_reason NOT NULL DEFAULT 'initial',
  triggered_by_profile_id uuid REFERENCES profiles(id),      -- null for initial draft; set for reroll
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

-- draft_picks: line items for a draft session. Pick order is 1..N globally across the draft
-- (not per team). Participant XOR — a pick is either a member or a guest, never both.
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
  CONSTRAINT draft_picks_unique_order UNIQUE (draft_session_id, pick_order),
  CONSTRAINT draft_picks_unique_profile UNIQUE (draft_session_id, profile_id),
  CONSTRAINT draft_picks_unique_guest   UNIQUE (draft_session_id, guest_id)
);
CREATE INDEX draft_picks_session_idx
  ON draft_picks (draft_session_id, pick_order);

-- formations: captain-authored lineup + rotation plan per (matchday, team) (§3.19).
-- `pattern` values are the 7v7 starter set from S011; 5v5 patterns are added in S013 item 4
-- when the `match_format` enum + per-matchday format column land. `layout_jsonb` encodes
-- pitch-token positions; `formation_rotation_order` encodes the 10-min rotating-GK plan.
CREATE TABLE formations (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matchday_id               uuid NOT NULL REFERENCES matchdays(id) ON DELETE CASCADE,
  team                      team_color NOT NULL,
  pattern                   text NOT NULL,
  layout_jsonb              jsonb NOT NULL,                  -- [{participant_kind, id, x, y, pos_label}]
  formation_rotation_order  jsonb,                           -- [{profile_id, rotation_number, is_starting_gk}]
  starting_gk_profile_id    uuid REFERENCES profiles(id),    -- null when rotating-GK mode is OFF
  last_edited_by            uuid REFERENCES profiles(id),
  last_edited_at            timestamptz NOT NULL DEFAULT now(),
  shared_at                 timestamptz,                     -- set by `share_formation` RPC
  created_at                timestamptz NOT NULL DEFAULT now(),
  -- S013 item 4: pattern CHECK accepts the 7v7 set + the 5v5 set + `custom`.
  -- 7v7 patterns: 2-3-1, 3-2-1, 2-2-2, 3-1-2, 2-1-3, 1-3-2 (6 outfield + 1 GK).
  -- 5v5 patterns: 1-2-1, 2-1-1, 1-1-2 (4 outfield + 1 GK).
  -- The app-layer UI (§3.19) picks the visible set based on effective_format(matchday_id);
  -- the DB CHECK is a strict superset so drift is impossible.
  CONSTRAINT formations_pattern_valid CHECK (
    pattern IN (
      '2-3-1','3-2-1','2-2-2','3-1-2','2-1-3','1-3-2',   -- 7v7
      '1-2-1','2-1-1','1-1-2',                            -- 5v5
      'custom'                                            -- either
    )
  ),
  CONSTRAINT formations_unique_team_per_matchday UNIQUE (matchday_id, team)
);
CREATE INDEX formations_matchday_idx ON formations (matchday_id);

-- S013 app_settings seed additions (consolidates V2.7 + S011 Settings v2 timing knob):
INSERT INTO app_settings (key, value, description) VALUES
  ('draft_stuck_threshold_hours', '6'::jsonb,
    'Hours after which an open draft_sessions row exposes the §3.18 admin "Force complete / Abandon" action.'),
  ('reroll_cutoff_hours_before_kickoff', '12'::jsonb,
    'Captains cannot trigger request_reroll() within this many hours of matchdays.kickoff_at.'),
  ('poll_reminder_offset_minutes', '-2'::jsonb,
    'poll_reminder push fires at matchdays.poll_closes_at + this many minutes (negative = before). S011 Settings v2 tuning.');

-- =========================================================================
-- S013 item 4 — multi-format helpers (5v5 / 7v7)
-- =========================================================================

-- effective_format(matchday_id): COALESCE of the per-matchday override and the
-- season default. Every downstream query, view, and RPC that cares about format
-- must call this helper rather than reading matchdays.format directly — that way
-- the "null means inherit" rule is enforced in one place.
CREATE OR REPLACE FUNCTION effective_format(p_matchday_id uuid) RETURNS match_format
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(md.format, s.default_format)
  FROM matchdays md
  JOIN seasons s ON s.id = md.season_id
  WHERE md.id = p_matchday_id;
$$;

-- roster_cap(format): pure derivation — 7v7 → 14, 5v5 → 10.
-- Used by §3.5 guest cap, §3.7 poll status card, §2.7 RPCs for completion checks.
CREATE OR REPLACE FUNCTION roster_cap(p_format match_format) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_format WHEN '7v7' THEN 14 WHEN '5v5' THEN 10 END;
$$;
```

---

### 2.6 Views (Part 5A)

```sql
-- 14-slot commitment order (used by poll screen)
CREATE VIEW v_match_commitments AS
SELECT matchday_id, 'player'::text AS commitment_type,
       profile_id AS participant_id, NULL::uuid AS inviter_id,
       NULL::text AS guest_display_name,
       committed_at AS sort_ts,
       ROW_NUMBER() OVER (PARTITION BY matchday_id ORDER BY committed_at) AS slot_order
FROM poll_votes
WHERE choice = 'yes' AND cancelled_at IS NULL
UNION ALL
SELECT matchday_id, 'guest'::text,
       NULL, inviter_id, display_name,
       created_at AS sort_ts,
       ROW_NUMBER() OVER (PARTITION BY matchday_id ORDER BY created_at) + 10000 AS slot_order
FROM match_guests
WHERE cancelled_at IS NULL;

-- Leaderboard
CREATE VIEW v_season_standings AS
WITH played AS (
  SELECT m.season_id, mp.profile_id,
    COUNT(*) FILTER (WHERE m.result = 'win_white' AND mp.team = 'white') +
    COUNT(*) FILTER (WHERE m.result = 'win_black' AND mp.team = 'black')  AS wins,
    COUNT(*) FILTER (WHERE m.result = 'draw')                             AS draws,
    COUNT(*) FILTER (WHERE m.result = 'win_white' AND mp.team = 'black') +
    COUNT(*) FILTER (WHERE m.result = 'win_black' AND mp.team = 'white')  AS losses,
    COALESCE(SUM(mp.goals), 0)        AS goals,
    COALESCE(SUM(mp.yellow_cards), 0) AS yellows,
    COALESCE(SUM(mp.red_cards), 0)    AS reds,
    COUNT(*) FILTER (WHERE m.motm_user_id = mp.profile_id) AS motms
  FROM matches m
  JOIN match_players mp ON mp.match_id = m.id
  WHERE m.approved_at IS NOT NULL AND mp.profile_id IS NOT NULL
  GROUP BY m.season_id, mp.profile_id
),
penalties AS (
  -- Penalty logic (S004 decision):
  --   * Cancel before roster lock                         → 0
  --   * Cancel after roster lock, outside 24h of kickoff  → -1 point
  --   * Cancel within 24h of kickoff                      → -1 point + 7-day player_bans row
  --     (the ban row is inserted by a trigger on poll_votes.cancelled_at;
  --      enforcement of the ban on poll inserts is Phase 2.)
  SELECT md.season_id, pv.profile_id,
    SUM(CASE
          WHEN pv.cancelled_at IS NULL                                   THEN 0
          WHEN pv.cancelled_at > (md.kickoff_at - INTERVAL '24 hours')   THEN -1  -- within 24h
          WHEN md.roster_locked_at IS NOT NULL
               AND pv.cancelled_at > md.roster_locked_at                 THEN -1  -- after lock
          ELSE 0                                                                  -- pre-lock: free
        END) AS late_cancel_points
  FROM poll_votes pv
  JOIN matchdays md ON md.id = pv.matchday_id
  WHERE pv.choice = 'yes'
  GROUP BY md.season_id, pv.profile_id
)
SELECT p.season_id, p.profile_id, pr.display_name,
       p.wins, p.draws, p.losses, p.goals, p.yellows, p.reds, p.motms,
       COALESCE(pen.late_cancel_points, 0) AS late_cancel_points,
       (p.wins * 3 + p.draws * 1 + COALESCE(pen.late_cancel_points, 0)) AS points
FROM played p
JOIN profiles pr ON pr.id = p.profile_id
LEFT JOIN penalties pen ON pen.season_id = p.season_id AND pen.profile_id = p.profile_id;

-- Last-5 form (per season, per player, W/D/L letters)
CREATE VIEW v_player_last5 AS
WITH ranked AS (
  SELECT m.season_id, mp.profile_id, m.id AS match_id, md.kickoff_at,
    CASE
      WHEN m.result = 'draw' THEN 'D'
      WHEN (m.result = 'win_white' AND mp.team = 'white') OR
           (m.result = 'win_black' AND mp.team = 'black') THEN 'W'
      ELSE 'L'
    END AS outcome,
    ROW_NUMBER() OVER (PARTITION BY m.season_id, mp.profile_id ORDER BY md.kickoff_at DESC) AS rn
  FROM matches m
  JOIN matchdays md ON md.id = m.matchday_id
  JOIN match_players mp ON mp.match_id = m.id
  WHERE m.approved_at IS NOT NULL AND mp.profile_id IS NOT NULL
)
SELECT season_id, profile_id, match_id, kickoff_at, outcome, rn
FROM ranked WHERE rn <= 5;

-- Captain eligibility (S004 formula — three per-player criteria).
-- Per-pair rules (White = weaker) live in application logic at pair-selection time.
-- Early-season randomizer fallback is handled by the RPC pick_captains_random() in §2.7 when
-- fewer than captain_min_matches_this_season matchdays have been played in the season.
CREATE VIEW v_captain_eligibility AS
WITH season_stats AS (
  SELECT s.season_id, s.profile_id,
         s.wins + s.draws + s.losses AS matches_played,
         s.points, s.motms
  FROM v_season_standings s
),
attendance AS (
  SELECT md.season_id, pv.profile_id,
         COUNT(*) FILTER (WHERE pv.choice = 'yes' AND pv.cancelled_at IS NULL) AS yes_votes,
         COUNT(*) AS total_votes
  FROM poll_votes pv
  JOIN matchdays md ON md.id = pv.matchday_id
  GROUP BY md.season_id, pv.profile_id
),
cooldown AS (
  -- Matchdays since this player last captained, within the current season
  SELECT m.season_id, mp.profile_id,
         MAX(md.kickoff_at) AS last_captained_at,
         COUNT(DISTINCT m2.matchday_id) AS matchdays_since_captained
  FROM matches m
  JOIN matchdays md ON md.id = m.matchday_id
  JOIN match_players mp ON mp.match_id = m.id AND mp.is_captain = true
  LEFT JOIN matches m2   ON m2.season_id = m.season_id
                         AND m2.matchday_id <> m.matchday_id
                         AND m2.approved_at IS NOT NULL
  LEFT JOIN matchdays md2 ON md2.id = m2.matchday_id
                           AND md2.kickoff_at > md.kickoff_at
  WHERE m.approved_at IS NOT NULL
  GROUP BY m.season_id, mp.profile_id
),
settings AS (
  SELECT
    COALESCE((value->>'captain_min_matches_this_season')::int, 5) AS min_matches,
    COALESCE((value->>'captain_cooldown_matchdays')::int,      4) AS cooldown,
    COALESCE((value->>'captain_min_attendance_rate')::float,  0.6) AS min_attendance
  FROM app_settings WHERE key = 'match_settings'
)
SELECT ss.season_id, ss.profile_id, pr.display_name,
       ss.matches_played, ss.points, ss.motms,
       COALESCE(att.yes_votes::float / NULLIF(att.total_votes, 0), 0) AS attendance_rate,
       COALESCE(cd.matchdays_since_captained, 999)                    AS matchdays_since_captained,
       -- Per-player boolean criteria (S004 decision — 3 criteria)
       (ss.matches_played >= s.min_matches)                                                        AS meets_min_matches,
       (COALESCE(att.yes_votes::float / NULLIF(att.total_votes, 0), 0) >= s.min_attendance)        AS meets_attendance,
       (COALESCE(cd.matchdays_since_captained, 999) >= s.cooldown)                                 AS cooldown_ok,
       -- Composite
       (ss.matches_played >= s.min_matches
        AND COALESCE(att.yes_votes::float / NULLIF(att.total_votes, 0), 0) >= s.min_attendance
        AND COALESCE(cd.matchdays_since_captained, 999) >= s.cooldown)                             AS is_eligible
FROM season_stats ss
JOIN profiles pr    ON pr.id = ss.profile_id
LEFT JOIN attendance att ON att.season_id = ss.season_id AND att.profile_id = ss.profile_id
LEFT JOIN cooldown cd    ON cd.season_id = ss.season_id  AND cd.profile_id = ss.profile_id
CROSS JOIN settings s;
```

---

### 2.7 SECURITY DEFINER functions (Part 5B)

Thirteen privileged RPCs. All run with `SECURITY DEFINER`, `SET search_path = public`. Helpers (`current_user_role`, `current_profile_id`, `is_admin`, `is_super_admin`) defined in 2.8. Full function bodies in S004 chat transcript — table below is the canonical list for the spec.

| # | Function | Called by | Purpose |
|---|---|---|---|
| 1 | `submit_ref_entry(token text, payload jsonb) → uuid` | **anon** | Token-gated ref submission. Validates sha256(token), writes pending entries, burns token, notifies admins. |
| 2 | `create_match_draft(matchday_id uuid, white_roster uuid[], black_roster uuid[], white_guests uuid[], black_guests uuid[]) → uuid` | admin | Called from the roster-lock / team-entry screen. Inserts the draft `matches` row (approved_at NULL) and the 14 `match_players` rows with team assignments, goals=0, cards=0. |
| 3 | `approve_match_entry(pending_id uuid, edits jsonb) → uuid` | admin | **UPDATEs the existing draft match row** (matched by matchday_id). Sets `result`, `score_white`, `score_black`, `motm_*`, `approved_at`, `approved_by`. Reconciles `match_players` goals/cards against the pending entry line items. Fans out approval notifications. |
| 4 | `reject_match_entry(pending_id uuid, reason text) → void` | admin | Rejects submission; re-arms ref token for resubmission. Draft `matches` row left untouched. |
| 5 | `approve_signup(pending_id uuid, claim_profile_id uuid DEFAULT NULL) → uuid` | admin | New-player create OR claim existing ghost profile; binds auth_user_id. |
| 6 | `reject_signup(pending_id uuid, reason text) → void` | admin | Marks rejected; rejection email sent by async Edge Function watching resolution column. |
| 7 | `promote_admin(profile_id uuid)` / `demote_admin(profile_id uuid) → void` | super_admin | Role changes. Cannot create super_admins (seed-only). |
| 8 | `archive_season(season_id uuid) → void` | admin | Enforces "must end before archive" rule. Notifies participants. |
| 9 | `fire_scheduled_reminder(reminder_id uuid) → void` | pg_cron | Resolves audience, inserts notifications rows, records last_fire_status. Push fan-out handled by separate Edge Function watching `notifications` via Supabase Realtime. |

**Lifecycle note:** `matches_one_per_matchday UNIQUE` enforces a single row per matchday. `create_match_draft` inserts it; `approve_match_entry` only ever UPDATEs. This matches the S003 decision "draft created at team-entry, flipped on ref approval."

**Captain-pick helper RPCs (S004 addition — support the admin "Who can captain?" screen):**

| # | Function | Called by | Purpose |
|---|---|---|---|
| 10 | `suggest_captain_pairs(matchday_id uuid) → TABLE(white_captain uuid, black_captain uuid, score int)` | admin | Returns up to 5 ranked candidate pairs from `v_captain_eligibility` **restricted to the locked-14 roster for this matchday**. Ranks pairs by combined `matches_played DESC, matchdays_since_captained DESC`. White = lower-ranked of the pair per §2.6 formula decision. |
| 11 | `pick_captains_random(matchday_id uuid) → TABLE(white_captain uuid, black_captain uuid)` | admin | Randomly picks two captains from the locked-14 roster (ignores eligibility). Used when the season is too young for the formula (fewer than `captain_min_matches_this_season` matchdays played) OR when the admin explicitly wants a random pick. White/Black assignment is also random. |

Both functions require admin role and validate that `matchdays.roster_locked_at IS NOT NULL` before operating. Neither mutates any row — they return suggestions; the admin then calls `create_match_draft` with the chosen pair.

**Randomizer trigger UX (for Section 3.1 when we get there):** the Who-Can-Captain admin screen checks season age. If `(SELECT COUNT(DISTINCT matchday_id) FROM matches WHERE season_id = current AND approved_at IS NOT NULL) < 5`, the screen leads with a "season too young for formula — pick randomly" primary action and offers the formula-based suggestion as a secondary option. If ≥5 matchdays played, the formula is primary and the randomizer is a secondary "surprise me" button.

**Write-path RPCs for captain confirmation + guest-stats correction (S009 addition — 20/APR/2026):**

| # | Function | Called by | Purpose |
|---|---|---|---|
| 12 | `set_matchday_captains(matchday_id uuid, white_profile_id uuid, black_profile_id uuid) → TABLE(white_captain uuid, black_captain uuid, assigned_at timestamptz)` | admin | Writes the captain pair for a matchday (§3.1-v2 write path). Validates: (a) both profile_ids appear in `match_players` for this matchday's draft match (i.e. on the locked 14); (b) neither is a guest (guest-authored `match_players` rows have `profile_id IS NULL` and are rejected implicitly by (a)); (c) neither profile sits on an active `player_bans` row (`expires_at > now()` AND `cancelled_at IS NULL`); (d) both profiles exist with `role IN ('player','admin','super_admin')` — bare FFC members, never external ids; (e) `white_profile_id <> black_profile_id` enforced at top of function body. Updates `matches.captain_assigned_at = now()`, `matches.captain_assigned_by = auth.uid()`, and flips `is_captain = true` on the two `match_players` rows (all others forced back to false for safety — idempotent re-pick). Rank-gap >5 is **not** enforced here — it is a UI warning only per S007. Returns the confirmed pair + timestamp. |
| 13 | `update_guest_stats(guest_id uuid, primary_position player_position, secondary_position player_position, stamina guest_trait, accuracy guest_trait, rating guest_rating, description text) → match_guests` | admin | Admin-only correction path for the 6 guest-stats columns added to `match_guests` in S007 (primary_position, secondary_position, stamina, accuracy, rating, description — see §2.3). Writes the 6 supplied values plus `updated_by = auth.uid()` and `updated_at = now()` (audit columns added to `match_guests` in §2.3 S009 migration note). Re-applies the table-level CHECKs (`match_guests_positions_differ`, `match_guests_description_length`) — a violation raises the underlying constraint error. Returns the updated `match_guests` row. |

**Error conditions (raised as `EXCEPTION` with `ERRCODE` for app-layer routing):**

- `set_matchday_captains`:
  - `22023 / FFC_CAPT_SAME_PROFILE` — `white_profile_id = black_profile_id`.
  - `42501 / FFC_CAPT_NOT_ADMIN` — caller fails `is_admin()`.
  - `22023 / FFC_CAPT_NOT_ON_ROSTER` — either profile is not in the matchday's locked 14.
  - `22023 / FFC_CAPT_BANNED` — either profile has an active `player_bans` row.
  - `22023 / FFC_CAPT_NOT_MEMBER` — either profile_id does not resolve to an FFC member (guest or unknown).
  - `22023 / FFC_CAPT_NO_DRAFT` — no `matches` draft row exists for the matchday (roster-lock has not happened yet).
- `update_guest_stats`:
  - `42501 / FFC_GUEST_NOT_ADMIN` — caller fails `is_admin()`.
  - `22023 / FFC_GUEST_NOT_FOUND` — `guest_id` does not resolve to a `match_guests` row (or row is cancelled).
  - Constraint errors (`23514`) pass through from `match_guests_positions_differ` / `match_guests_description_length`.

Both functions require admin role and are the only write path for their respective columns (Critical Rule #14). Neither accepts a JSON-shaped payload — all params are simple typed scalars (uuids + enums + text), so they pass through directly without the TEXT→JSONB cast pattern from Critical Rule #15.

**Post-approval match-result correction (S013 addition — Phase 1 backlog item):**

| # | Function | Called by | Purpose |
|---|---|---|---|
| 14 | `edit_match_result(match_id uuid, edits jsonb) → matches` | admin | Post-approval correction path for a completed `matches` row. Accepts a partial `edits` jsonb (score_white, score_black, result, motm_user_id / motm_guest_id, per-player `match_players` goals/cards/team/is_captain deltas). Enforces `matches.motm_xor`, `match_players_participant_xor`, and constraint consistency. Writes `admin_audit_log` row with `target_entity='matches'`, `action='edit_result'`, `payload_jsonb` capturing before/after delta for every changed column. Rejects calls when `approved_at IS NULL` (use `approve_match_entry` instead). |

**Post-lock substitution + captain draft + formation RPCs (S013 addition — consolidates S011 V2.7 deltas for §3.7 State 6.5 / reroll + §3.19 formation planner):**

| # | Function | Called by | Purpose |
|---|---|---|---|
| 15 | `promote_from_waitlist(matchday_id uuid, departing_profile_id uuid) → uuid` | admin | Substitutes a post-lock dropout. Removes `departing_profile_id` from the matchday's `match_players` (or clears their team assignment depending on draft state) and inserts the first waitlisted `poll_votes.profile_id` (ordered by `v_match_commitments.slot_order`) with `substituted_in_by = auth.uid()`. Idempotent: re-running when no dropout remains is a no-op returning `NULL::uuid`. Fires `dropout_after_lock` notification to the full roster + admins. Returns the `profile_id` of the promoted substitute (or NULL). |
| 16 | `accept_substitute(matchday_id uuid) → void` | captain | Captain acknowledges the auto-substitute (no reroll). Marks the `dropout_after_lock` notification row(s) for this captain as actioned with outcome `accepted` (via `notifications.payload.outcome` jsonb key — no DDL change). Admin role OR authenticated captain-of-matchday both permitted; RLS check enforced inside. |
| 17 | `request_reroll(matchday_id uuid) → uuid` | captain (of either team) | Authorises the non-dropout-side captain to reroll the draft after a post-lock dropout. Validates: (a) caller is the current captain of a team for this matchday; (b) `now() < matchdays.kickoff_at - INTERVAL 'X hours'` where X = `app_settings.reroll_cutoff_hours_before_kickoff`; (c) there is no `draft_sessions` row already `status='in_progress'` for this matchday. Creates a new `draft_sessions` row with `reason='reroll_after_dropout'` + `triggered_by_profile_id = current_profile_id()`, clears `match_players.team` for all non-captain rows on this matchday's draft match, fires `draft_reroll_started` to both teams and `reroll_triggered_by_opponent` to the non-triggering captain. Returns the new `draft_session_id`. |
| 18 | `submit_draft_pick(draft_session_id uuid, profile_id uuid DEFAULT NULL, guest_id uuid DEFAULT NULL) → draft_picks` | captain (current picker) | Captain of the `draft_sessions.current_picker_team` submits one pick. Exactly one of `profile_id`/`guest_id` must be non-null (participant XOR). Inserts a `draft_picks` row with `pick_order = (coalesce(MAX(pick_order), 0) + 1)`, flips `draft_sessions.current_picker_team` to the opposite team, updates `match_players.team` for the picked row to the picking team. On the Nth pick where N equals the matchday's slot count (7v7 → 14, 5v5 → 10; resolved via item 4 format wiring), also sets `draft_sessions.status='completed'` + `completed_at=now()`. Returns the inserted `draft_picks` row. |
| 19 | `upsert_formation(p_matchday_id uuid, p_team team_color, p_pattern text, p_layout_jsonb jsonb, p_rotation_order jsonb, p_starting_gk_profile_id uuid) → uuid` | captain | Upserts the `formations` row for (matchday, team). Validates: (a) caller is the captain of that team on this matchday; (b) `p_pattern` passes the `formations_pattern_valid` CHECK (7v7-only for now; item 4 extends to 5v5); (c) `p_starting_gk_profile_id` belongs to the picked roster when rotating-GK mode is OFF (null allowed when rotating-GK mode is ON). Sets `last_edited_by = current_profile_id()`, `last_edited_at = now()`. Returns the formation row id. **Does not** set `shared_at` — that is a separate action (#20). |
| 20 | `share_formation(p_formation_id uuid) → void` | captain | Sets `shared_at = now()` on the formation row (captain-only). Fires `formation_shared` push to non-captain team members. Idempotent — re-sharing updates `shared_at` without duplicating notifications (uses a "last shared in the past 10 minutes" guard). |

**Error conditions for the S013 RPCs (raised as `EXCEPTION` with `ERRCODE` for app-layer routing — condensed):**

| RPC | Code | Condition |
|---|---|---|
| `edit_match_result` | `42501 / FFC_EDIT_NOT_ADMIN` | Caller fails `is_admin()` |
| `edit_match_result` | `22023 / FFC_EDIT_NOT_APPROVED` | Target `matches.approved_at IS NULL` |
| `promote_from_waitlist` | `42501 / FFC_SUB_NOT_ADMIN` | Caller fails `is_admin()` |
| `promote_from_waitlist` | `22023 / FFC_SUB_NOT_ON_ROSTER` | `departing_profile_id` is not on the matchday's locked 14 |
| `accept_substitute` | `42501 / FFC_ACC_NOT_CAPTAIN` | Caller is not captain of either team on this matchday |
| `request_reroll` | `42501 / FFC_REROLL_NOT_CAPTAIN` | Caller is not captain of either team on this matchday |
| `request_reroll` | `22023 / FFC_REROLL_CUTOFF_PASSED` | Within `reroll_cutoff_hours_before_kickoff` of kickoff |
| `request_reroll` | `22023 / FFC_REROLL_SESSION_EXISTS` | Another `draft_sessions` row is already `in_progress` |
| `submit_draft_pick` | `42501 / FFC_PICK_NOT_CURRENT_CAPTAIN` | Caller is not captain of `current_picker_team` |
| `submit_draft_pick` | `22023 / FFC_PICK_XOR` | Both or neither of `profile_id`/`guest_id` supplied |
| `submit_draft_pick` | `22023 / FFC_PICK_ALREADY_PICKED` | Target already present on another `draft_picks` row this session |
| `upsert_formation` | `42501 / FFC_FORM_NOT_CAPTAIN` | Caller is not captain of `p_team` on this matchday |
| `upsert_formation` | `22023 / FFC_FORM_BAD_PATTERN` | `p_pattern` fails CHECK |
| `share_formation` | `42501 / FFC_SHARE_NOT_CAPTAIN` | Caller is not the captain who authored the formation |

**Admin audit convention (S013 — written side-effect on every admin-role mutation):**

Every SECURITY DEFINER function whose caller resolves to `is_admin() = true` **must** write exactly one `admin_audit_log` row before returning (the caller's admin_profile_id, the entity being mutated, the action name, and a payload jsonb capturing before/after when relevant). This is the only source of truth for the §3.17/§3.18 admin audit surfaces.

To eliminate drift between DDL intent and function bodies, a single private helper is used by every RPC:

```sql
-- Private helper — NOT granted to anon/authenticated. Called from inside SECURITY DEFINER
-- RPC bodies, so it runs with the RPC's elevated privileges.
CREATE OR REPLACE FUNCTION log_admin_action(
  p_target_entity text,
  p_target_id     uuid,
  p_action        text,
  p_payload       jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO admin_audit_log (admin_profile_id, target_entity, target_id, action, payload_jsonb)
  VALUES (current_profile_id(), p_target_entity, p_target_id, p_action, p_payload);
$$;
REVOKE EXECUTE ON FUNCTION log_admin_action(text, uuid, text, jsonb) FROM PUBLIC;
```

Functions that must call it: `approve_match_entry`, `reject_match_entry`, `approve_signup`, `reject_signup`, `promote_admin`, `demote_admin`, `archive_season`, `set_matchday_captains`, `update_guest_stats`, `edit_match_result`, `promote_from_waitlist`, `request_reroll`. (The captain-role RPCs `accept_substitute`, `submit_draft_pick`, `upsert_formation`, `share_formation` do **not** write audit rows — captain actions are not admin actions.)

**S013 item 4 — format-awareness convention:**

Every RPC whose slot-count, completion condition, or captain-eligibility threshold depends on the matchday's format (7v7 vs 5v5) **must** resolve the format via `effective_format(matchday_id)` (§2.5 helper) and derive the roster cap via `roster_cap(format)` (§2.5 helper). Direct reads of `matchdays.format` are forbidden — the helper enforces the "NULL means inherit season default" rule in one place.

| RPC | Format-dependent behaviour |
|---|---|
| #2 `create_match_draft` | Accepts 7+7 uuid arrays (7v7) OR 5+5 (5v5). Validates array length against `roster_cap / 2`. |
| #10 `suggest_captain_pairs` | Pair selection unchanged (pairs are always 2 regardless of format). Rank-gap threshold unchanged (±5 league positions). |
| #11 `pick_captains_random` | Samples 2 from the effective roster (14 or 10). |
| #12 `set_matchday_captains` | Validates both captains are on the matchday's draft `match_players` roster (size varies by format — validation walks whatever is there). |
| #14 `edit_match_result` | No format awareness — `match_players` line-item count is whatever the draft has. |
| #15 `promote_from_waitlist` | Unchanged — promotion is 1:1 regardless of format. |
| #18 `submit_draft_pick` | Completion check: `draft_sessions.status='completed'` when `COUNT(draft_picks) = roster_cap(effective_format)` rather than the hardcoded 14. |
| #19 `upsert_formation` | Pattern validation via `formations_pattern_valid` CHECK (superset). App-layer §3.19 UI restricts the visible picker to the format-appropriate subset. |

Captain eligibility (`app_settings.match_settings.captain_min_matches_this_season`, default 5) is **NOT** scaled by format in Phase 1 — the same "knows the group" bar applies. Decision locked S013 per user preference A(i). Revisit if 5v5-only seasons show nobody qualifying by mid-season.

**Grants:**
```sql
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT EXECUTE ON FUNCTION submit_ref_entry(text, jsonb)                                TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_match_draft(uuid, uuid[], uuid[], uuid[], uuid[])     TO authenticated;
GRANT EXECUTE ON FUNCTION approve_match_entry(uuid, jsonb)                             TO authenticated;
GRANT EXECUTE ON FUNCTION reject_match_entry(uuid, text)                               TO authenticated;
GRANT EXECUTE ON FUNCTION approve_signup(uuid, uuid)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION reject_signup(uuid, text)                                    TO authenticated;
GRANT EXECUTE ON FUNCTION promote_admin(uuid)                                          TO authenticated;
GRANT EXECUTE ON FUNCTION demote_admin(uuid)                                           TO authenticated;
GRANT EXECUTE ON FUNCTION archive_season(uuid)                                         TO authenticated;
GRANT EXECUTE ON FUNCTION suggest_captain_pairs(uuid)                                  TO authenticated;
GRANT EXECUTE ON FUNCTION pick_captains_random(uuid)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION set_matchday_captains(uuid, uuid, uuid)                      TO authenticated;
GRANT EXECUTE ON FUNCTION update_guest_stats(uuid, player_position, player_position, guest_trait, guest_trait, guest_rating, text) TO authenticated;
-- S013 additions
GRANT EXECUTE ON FUNCTION edit_match_result(uuid, jsonb)                               TO authenticated;
GRANT EXECUTE ON FUNCTION promote_from_waitlist(uuid, uuid)                            TO authenticated;
GRANT EXECUTE ON FUNCTION accept_substitute(uuid)                                      TO authenticated;
GRANT EXECUTE ON FUNCTION request_reroll(uuid)                                         TO authenticated;
GRANT EXECUTE ON FUNCTION submit_draft_pick(uuid, uuid, uuid)                          TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_formation(uuid, team_color, text, jsonb, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION share_formation(uuid)                                        TO authenticated;
-- S013 item 4 helpers
GRANT EXECUTE ON FUNCTION effective_format(uuid)                                       TO authenticated;
GRANT EXECUTE ON FUNCTION roster_cap(match_format)                                     TO authenticated;
-- fire_scheduled_reminder intentionally not granted to authenticated; invoked by pg_cron superuser.
-- log_admin_action is intentionally not granted — only SECURITY DEFINER RPC bodies call it.
```

---

### 2.8 RLS policies (Part 5C)

**Role helpers (STABLE SECURITY DEFINER — avoid recursive RLS on `profiles`):**

```sql
CREATE OR REPLACE FUNCTION current_user_role() RETURNS user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM profiles WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION current_profile_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM profiles WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT current_user_role() IN ('admin','super_admin'); $$;

CREATE OR REPLACE FUNCTION is_super_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT current_user_role() = 'super_admin'; $$;
```

**Matrix (authoritative):**

| Table | anon | player | admin | super_admin |
|---|---|---|---|---|
| `profiles` | — | SELECT all; UPDATE own (role column frozen) | SELECT all; UPDATE all (role column frozen) | same + role via RPC |
| `pending_signups` | — | SELECT own; INSERT own | SELECT all | same |
| `seasons` | — | SELECT non-archived | SELECT all; full write | full |
| `matchdays` | — | SELECT | full write | full |
| `poll_votes` | — | SELECT all; INSERT/UPDATE own | SELECT all; full write | same |
| `match_guests` | — | SELECT all; INSERT/UPDATE own (as inviter) | full write | full |
| `matches` | — | SELECT approved only | SELECT all; full write | full |
| `match_players` | — | SELECT approved-match rows only | SELECT all; full write | full |
| `ref_tokens` | — | — | full | full |
| `pending_match_entries` | — | — | SELECT all (writes via RPC) | full |
| `pending_match_entry_players` | — | — | SELECT all (writes via RPC) | full |
| `notifications` | — | SELECT own; UPDATE own (read_at) | same | same |
| `player_bans` | — | SELECT own | full | full |
| `push_subscriptions` | — | full on own rows | same | same |
| `app_settings` | — | SELECT | SELECT | SELECT + full write |
| `scheduled_reminders` | — | — | SELECT; UPDATE only | full |
| `admin_audit_log` (S013) | — | — | SELECT all (writes via `log_admin_action` helper only) | same |
| `draft_sessions` (S013) | — | SELECT all (live draft visibility — §3.7 State 6.5) | SELECT all · force-complete/abandon via RPC | same |
| `draft_picks` (S013) | — | SELECT all (live draft visibility) | SELECT all · writes via `submit_draft_pick` RPC | same |
| `formations` (S013) | — | SELECT rows where `shared_at IS NOT NULL` OR viewer is the creator | SELECT all · writes via `upsert_formation`/`share_formation` RPCs | same |

**Policies (canonical statements):**

```sql
-- Enable RLS on every table
ALTER TABLE profiles                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_signups             ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE matchdays                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_votes                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_guests                ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_players               ENABLE ROW LEVEL SECURITY;
ALTER TABLE ref_tokens                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_match_entries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_match_entry_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications               ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_bans                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings                ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_reminders         ENABLE ROW LEVEL SECURITY;
-- S013 additions
ALTER TABLE admin_audit_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_sessions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_picks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE formations                  ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY profiles_select_all ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY profiles_update_own ON profiles FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid()
              AND role = (SELECT role FROM profiles WHERE auth_user_id = auth.uid()));
CREATE POLICY profiles_update_admin ON profiles FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin() AND role = (SELECT role FROM profiles p2 WHERE p2.id = profiles.id));

-- pending_signups
CREATE POLICY pending_signups_insert_own ON pending_signups FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = auth.uid());
CREATE POLICY pending_signups_select ON pending_signups FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR is_admin());

-- seasons
CREATE POLICY seasons_select ON seasons FOR SELECT TO authenticated
  USING (archived_at IS NULL OR is_admin());
CREATE POLICY seasons_write_admin ON seasons FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- matchdays
CREATE POLICY matchdays_select ON matchdays FOR SELECT TO authenticated USING (true);
CREATE POLICY matchdays_write_admin ON matchdays FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- poll_votes
CREATE POLICY poll_votes_select ON poll_votes FOR SELECT TO authenticated USING (true);
CREATE POLICY poll_votes_insert_own ON poll_votes FOR INSERT TO authenticated
  WITH CHECK (profile_id = current_profile_id());
CREATE POLICY poll_votes_update_own ON poll_votes FOR UPDATE TO authenticated
  USING (profile_id = current_profile_id())
  WITH CHECK (profile_id = current_profile_id());
CREATE POLICY poll_votes_admin_all ON poll_votes FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- match_guests
CREATE POLICY match_guests_select ON match_guests FOR SELECT TO authenticated USING (true);
CREATE POLICY match_guests_insert_own ON match_guests FOR INSERT TO authenticated
  WITH CHECK (inviter_id = current_profile_id() OR is_admin());
CREATE POLICY match_guests_update_own ON match_guests FOR UPDATE TO authenticated
  USING (inviter_id = current_profile_id() OR is_admin())
  WITH CHECK (inviter_id = current_profile_id() OR is_admin());

-- matches
CREATE POLICY matches_select_approved ON matches FOR SELECT TO authenticated
  USING (approved_at IS NOT NULL OR is_admin());
CREATE POLICY matches_write_admin ON matches FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- match_players
CREATE POLICY match_players_select_approved ON match_players FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM matches m WHERE m.id = match_players.match_id
                 AND (m.approved_at IS NOT NULL OR is_admin())));
CREATE POLICY match_players_write_admin ON match_players FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- ref_tokens
CREATE POLICY ref_tokens_admin_all ON ref_tokens FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- pending_match_entries + players (read-only for admins; writes via RPC)
CREATE POLICY pme_admin_select ON pending_match_entries FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY pmep_admin_select ON pending_match_entry_players FOR SELECT TO authenticated USING (is_admin());

-- notifications
CREATE POLICY notifications_select_own ON notifications FOR SELECT TO authenticated
  USING (recipient_id = current_profile_id());
CREATE POLICY notifications_update_own ON notifications FOR UPDATE TO authenticated
  USING (recipient_id = current_profile_id())
  WITH CHECK (recipient_id = current_profile_id());

-- player_bans
CREATE POLICY player_bans_select_own ON player_bans FOR SELECT TO authenticated
  USING (profile_id = current_profile_id() OR is_admin());
CREATE POLICY player_bans_admin_write ON player_bans FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- push_subscriptions
CREATE POLICY push_subscriptions_own ON push_subscriptions FOR ALL TO authenticated
  USING (profile_id = current_profile_id())
  WITH CHECK (profile_id = current_profile_id());

-- app_settings
CREATE POLICY app_settings_read ON app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY app_settings_write_super ON app_settings FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

-- scheduled_reminders
CREATE POLICY scheduled_reminders_read_admin ON scheduled_reminders FOR SELECT TO authenticated
  USING (is_admin());
CREATE POLICY scheduled_reminders_update_admin ON scheduled_reminders FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY scheduled_reminders_write_super ON scheduled_reminders FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

-- =========================================================================
-- S013 additions — admin_audit_log + draft_sessions + draft_picks + formations
-- =========================================================================

-- admin_audit_log: admin-only SELECT. No direct write policies — the `log_admin_action`
-- helper (§2.7) runs SECURITY DEFINER and writes rows with the caller's admin profile
-- already resolved. Players cannot read audit history (may contain rejection reasons /
-- ban context that should stay admin-internal).
CREATE POLICY admin_audit_log_select_admin ON admin_audit_log FOR SELECT TO authenticated
  USING (is_admin());

-- draft_sessions: all authenticated users can read (drives §3.7 State 6.5 live draft
-- visibility for the full roster). Writes happen only via SECURITY DEFINER RPCs
-- (`request_reroll`, `submit_draft_pick`) — no direct INSERT/UPDATE policies needed.
-- Admins get a full-write escape hatch for force-complete / abandon via §3.18.
CREATE POLICY draft_sessions_select ON draft_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY draft_sessions_admin_all ON draft_sessions FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- draft_picks: same pattern — public read for live visibility, RPC-only writes.
CREATE POLICY draft_picks_select ON draft_picks FOR SELECT TO authenticated USING (true);
CREATE POLICY draft_picks_admin_all ON draft_picks FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- formations: conditional player SELECT. A captain's working draft (shared_at IS NULL)
-- is visible only to the captain who authored it; once they hit Share (sets shared_at)
-- the formation becomes visible to everyone. Admins can always read.
-- Writes happen via `upsert_formation` / `share_formation` RPCs.
CREATE POLICY formations_select ON formations FOR SELECT TO authenticated
  USING (
    is_admin()
    OR shared_at IS NOT NULL
    OR last_edited_by = current_profile_id()
  );
CREATE POLICY formations_admin_all ON formations FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- Hard boundary for anon
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
-- (anon surface is the submit_ref_entry RPC only, granted above.)
```

---

### 2.9 Migration file layout

Recommended order (Supabase `supabase/migrations/`):

```
0001_enums.sql                 -- Section 2.1 (incl. S013 draft_status/draft_reason + match_format + rejected user_role + 6 notification_kind values)
0002_base_entities.sql         -- Section 2.2 (incl. S013 profiles.reject_reason + CHECK + seasons.default_format + matchdays.format)
0003_match_data.sql            -- Section 2.3 (incl. S013 match_players.substituted_in_by)
0004_poll_ref_workflow.sql     -- Section 2.4
0005_operational.sql           -- Section 2.5 (incl. seed rows + S013 admin_audit_log, draft_sessions, draft_picks, formations + 3 new app_settings keys + effective_format/roster_cap helpers)
0006_views.sql                 -- Section 2.6
0007_rls_helpers.sql           -- Section 2.8 (helper functions only)
0008_security_definer_rpcs.sql -- Section 2.7 (20 RPCs + log_admin_action helper + grants; incl. S013 edit_match_result + 6 captain-draft/formation RPCs)
0009_rls_policies.sql          -- Section 2.8 (ALTER … ENABLE + CREATE POLICY; incl. S013 policies for 4 new tables)
0010_pg_cron_bindings.sql      -- pg_cron jobs 1:1 per scheduled_reminders row
0011_seed_super_admin.sql      -- one-off: insert m.muwahid@gmail.com as super_admin
```

Migrations 7 and 8 swap order because RLS helpers must exist before RPCs that may reference them; RPCs must exist before policies that some future helper function might call. Phase 1 policies only reference the four helpers — strict ordering is preserved regardless.

**S013 note:** the RPC count ballooned from 13 → 20 (added `edit_match_result` + `promote_from_waitlist` + `accept_substitute` + `request_reroll` + `submit_draft_pick` + `upsert_formation` + `share_formation`, plus the private `log_admin_action` helper). Four new tables land in `0005_operational.sql` rather than a new file to keep the chronology tight — `admin_audit_log` FK-depends on `profiles`, `draft_sessions`/`draft_picks` FK-depend on `matchdays`+`match_guests`+`profiles`, `formations` FK-depends on `matchdays`+`profiles` — all of which are created earlier in the same or prior file.

---

## Section 3 — Screens & Navigation (PARTIAL — sub-designs approved in S002)

The full navigation (bottom nav, route list, information architecture) is not yet written. Six specific sub-designs were approved in S002 and are recorded here in full: 3.1 captain helper · 3.2 last-5 form indicator · 3.3 player self-signup + admin approval · 3.4 ref entry flow · 3.5 +1 guest mechanic · 3.6 poll vote order & waitlist priority.

**Data-model follow-up flagged for Section 2:** the `match_guests` row carries per-match guest stats (`goals_scored`, `yellow_card`, `red_card`, `is_motm`), and the `matches` row carries `motm_user_id` + `motm_guest_id`. The guest-MOTM signal is stored in two places — consolidate to one in Section 2 to avoid drift.

### 3.0 — Platform safe-area (cross-cutting, NEW in S009 — Phase 1)

**Status:** APPROVED — S009, 20/APR/2026 (promotes CLAUDE.md Rule #10 to a design-spec requirement; cross-cutting — applies to every screen, sheet, and fixed element in Section 3).

**Rule.** Every fixed-position UI element (topbar, bottom-nav, floating CTA stacks, modal sheets) MUST pad itself away from the iPhone notch / Dynamic Island / home-indicator using CSS `env(safe-area-inset-*)` values. The same CSS is a no-op (`0px`) on non-notched devices, so the pattern is universal.

**Reference.** Full implementation pattern — mechanics, manifest + theme-colour requirements, standalone-PWA caveats, source citations — lives in [`docs/platform/iphone-safe-area.md`](../../../docs/platform/iphone-safe-area.md). That document is authoritative; this sub-section is the design-spec binding.

**The 5 CSS check-points (mandatory on every screen).**
1. `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` in every page `<head>` — without it, nothing else works.
2. Root-scoped custom properties exposing the four insets — `--safe-top`, `--safe-right`, `--safe-bottom`, `--safe-left` — each mapped to the matching `env(safe-area-inset-*)` with a `0px` fallback.
3. `.topbar` — `padding-top: var(--safe-top)` (plus `--safe-left` / `--safe-right` for landscape notch).
4. `.bottom-nav` — `padding-bottom: var(--safe-bottom)` (plus `--safe-left` / `--safe-right`).
5. Modal sheets — internal scroll/padding must use `calc(var(--safe-bottom) + 16px)` so the bottom tap-target clears the home indicator. Floating CTA stacks that sit above the bottom nav follow the same `calc()` pattern.

**Mockup review contract.** Every mockup (new or retrofitted) MUST be verified against all 5 check-points above before approval. Additionally, the mockup phone-frame CSS MUST include a simulated iPhone-14-Pro Dynamic-Island cutout (centred pill at the top of the frame, ≈ 125×37 px) so reviewers can see the obstruction at review time — without it, safe-area violations are invisible in desktop-browser preview and only surface on real hardware.

**Testing requirement.** Real-hardware verification (portrait AND landscape) required before any screen ships in Phase 1 implementation — landscape is the only orientation that exposes the `left`/`right` insets.

---

### 3.1 — "Who can captain?" admin helper screen (NEW, Phase 1 — **SUPERSEDED by §3.1-v2 in S007**)

> **Status:** SUPERSEDED. S002's first-pass text below is preserved for historical context. The reconciled Phase 1 spec (simplified 3-criteria formula + randomizer mode + pair-confirmation sheet) lives in **§3.1-v2** below. Implementation should follow §3.1-v2; the criteria table in this section no longer matches the data model or the locked captain formula (simplified in S004, layout locked in S006, fully drafted in S007).

**Purpose.** After roster lock (14 confirmed), the admin opens this screen to see who is eligible to captain and picks two. In Phase 1 the admin's picks are advisory — the admin then types the two team rosters manually. In Phase 2 the same screen evolves into the auto-pick + override surface that drives the async draft.

**Entry point.** Accessible only to admins, from the matchday screen once the roster is locked. Not visible in regular player navigation.

**Behaviour — eligibility.** The formula has three layers:

| # | Criterion | Scope | Definition |
|---|---|---|---|
| 1 | Knows the group | per-player | Has played ≥ 1 match this season with every other FFC member (excluding +1s) who has played ≥ 1 match this season. |
| 2 | Captain cooldown | per-player | ≥ 4 matchdays have passed since they last captained. |
| 3 | Recent activity | per-player | Played in at least one of the last 2 matchdays as a locked-roster player (waitlist does not count). |
| 4 | Pair balance | per-pair | The two picked captains must be within ± 5 positions of each other on the current season league table. |
| 5 | White = weaker | assignment | Once a pair is chosen, the lower-ranked of the pair (higher position number) captains White and picks first. |

A **candidate** is fully qualifying when criteria 1–3 hold. A **pair** is fully qualifying when both candidates are individually fully qualifying AND criterion 4 holds. Criterion 5 is not a filter — it's the rule that picks which captain gets White once the pair is locked.

**Behaviour — screen layout.**
1. **Fully-qualifying pairs section (top of screen).** If any pair is fully qualifying (per the definition above), each valid pair is surfaced as a single row: *"White: Player X (rank 8) · Black: Player Y (rank 5)"*, with a "Pick this pair" action.
2. **Candidate list (below).** Every player (not on ban) ordered by number of criteria satisfied, descending. Each row shows the player name, current league rank, and small badges indicating which of criteria 1–3 they miss (e.g., `missed knows-group`, `captained 3wk ago`, `didn't play last 2`). This list is always shown — it does not disappear when fully-qualifying pairs exist.
3. **Manual pick action.** Admin can select any two candidates as captains regardless of qualification. The screen shows a confirmation dialog surfacing any failed criteria for the chosen pair (e.g., *"This pair misses: rank gap (8 positions apart). Proceed?"*). On confirm, the White/Black assignment is set automatically using rule 5.

**State implications.**
- Writes to `matchdays.captain_white_user_id` and `matchdays.captain_black_user_id` (column names to finalise in Section 2).
- Does NOT start a draft in Phase 1. After admin confirms captains, admin is returned to the matchday screen to type the teams manually.

**Edge cases.**
- Before a season starts (no completed matchdays) criteria 2 and 3 are trivially satisfied for everyone. Criterion 1 reduces to "empty set" (nobody has played this season yet), so again trivial. First 1–2 matchdays of a new season will have very permissive eligibility — expected.
- Bans (Phase 1: admin-applied) disqualify a player from the list entirely.

**Phase 2 extensions (out of scope for Phase 1, noted so we don't design ourselves into a corner):**
- The same screen becomes the auto-pick UI. System pre-selects the best fully-qualifying pair (or best partial pair) on roster lock and notifies the admin, who can override within a window (exact window TBD in Phase 2 design).

---

### 3.1-v2 — Captain helper (reconciled, NEW in S007 — Phase 1, Depth B)

**Status:** APPROVED — layout locked S006 (one screen with two modes + pair-confirmation sheet), Depth-B spec written S007. Mockup v1 delivered S007. **Supersedes §3.1** (S002 first-pass).

**Purpose.** Admin-only screen reached after the 14-player roster is locked for a matchday. Helps the admin pick two captains for that match. Phase 1 output is advisory — the admin's pair becomes the `is_captain=true` flags on the White/Black rosters but the admin still types the per-player team assignment on the team-entry screen. In Phase 2 this screen evolves into the auto-pick + async-draft entrypoint.

**Entry points.**
- Admin matchday screen → "Pick captains" CTA, enabled after roster lock.
- Admin dashboard → Captain pool card (pending, not yet specced).
- Notifications: `roster_locked` push deep-links here for admins.

**Data sources.**
- **`v_captain_eligibility`** (§2.6) — one row per locked-roster FFC player, with the three per-player booleans and their input columns:
  - `has_min_matches` (boolean) — has played ≥ 5 approved matches this season (criterion 1).
  - `has_min_attendance` (boolean) — attendance ≥ 60% of approved matchdays this season (criterion 2).
  - `has_cooldown` (boolean) — has NOT captained in the last 4 matchdays (criterion 3).
  - `is_eligible` (boolean) — composite: all three booleans TRUE.
  - Plus `matches_played_this_season`, `attendance_pct`, `matchdays_since_last_captain`, `current_rank`, `primary_position`, `secondary_position`, `display_name`, `profile_id`.
- **`suggest_captain_pairs(matchday_id uuid) → setof record`** (§2.7) — SECURITY DEFINER RPC. Returns top-N pairs of eligible candidates ranked by criterion-4 pair-balance (rank-gap ≤ 5 league positions), with White/Black assignment per the White=weaker rule. Deferred ranking rule Phase 2: tie-break pairs by combined matches_played then by display_name.
- **`pick_captains_random(matchday_id uuid) → record`** (§2.7) — SECURITY DEFINER RPC. Returns one random pair from the locked-14 (uniform random, then White=weaker assigned). Used when the season has < 5 approved matchdays (formula mode has no meaningful signal yet).
- **Season age** (for mode selection): `SELECT COUNT(*) FROM matches m JOIN matchdays md ON md.id = m.matchday_id WHERE md.season_id = :active_season AND m.approved_at IS NOT NULL`. If < 5 → default to randomizer mode; else → default to formula mode.
- **S007 — Guest roster context:** `match_guests` rows for the matchday, including the new S007 stat columns (`primary_position`, `secondary_position`, `stamina`, `accuracy`, `rating`, `description`). Surfaced in the candidate list but never selectable as a captain.

**Mode selection.**
- **Formula mode** (default when `season_matchdays_approved ≥ 5`): top of screen shows "Suggested pair" card(s) from `suggest_captain_pairs`. Candidate list below shows all 14 locked-roster FFC players with their three-boolean criteria badges. Guests appear at the bottom in a separate "Guests on roster (not eligible to captain)" subsection, showing their stats for pair-balance context.
- **Randomizer mode** (default when `season_matchdays_approved < 5`): top of screen shows a big "Pick a random pair" CTA. Candidate list below still renders (for context), but criteria badges are muted because the formula isn't trusted yet.
- **Visible toggle**: a segmented control at the top of the screen (`Formula` · `Randomizer`) lets the admin flip modes at any time. The default is pre-selected by the rule above but can be overridden — e.g., early in a season the admin might flip to formula to see who's already building a case even with limited data.

**Layout — formula mode (primary state).**

```
┌─────────────────────────────────────┐
│ [status bar]                        │
│ [topbar] < Back · Pick captains     │
├─────────────────────────────────────┤
│ MATCHDAY STRIP                      │
│ Matchday 07 · 23/APR/2026 · locked  │
├─────────────────────────────────────┤
│ MODE TOGGLE                         │
│ [ Formula (active) | Randomizer ]   │
├─────────────────────────────────────┤
│ SUGGESTED PAIR                      │
│ ┌─ Suggested ─────────────────────┐ │
│ │ 🤍 WHITE: Jamal R. · rank #8    │ │
│ │    [DEF]  ✓ ✓ ✓ · 7MP · 78%     │ │
│ │ ⚫ BLACK: Amir K. · rank #5     │ │
│ │    [GK]   ✓ ✓ ✓ · 9MP · 91%     │ │
│ │ Rank gap: 3 ✓  [Use this pair]  │ │
│ └─────────────────────────────────┘ │
│ (+1 alt pair below, same template)  │
├─────────────────────────────────────┤
│ CANDIDATE LIST · 14 players         │
│ Eligible first, then partials,      │
│ then ineligible, each section       │
│ sorted by rank ASC.                 │
│ Row = avatar · name · pills · ✓✓✓   │
│       · rank # · "Pick as ..." menu │
├─────────────────────────────────────┤
│ GUESTS ON ROSTER · read-only        │
│ (not eligible to captain — S007)    │
│ Row = "+1" · name · pills · rating  │
│       chip · description subtitle   │
└─────────────────────────────────────┘
```

**Layout — randomizer mode.** Mode toggle + a single big card: "Season just started — formula's not reliable yet. Pick a random pair from the locked 14." with a `[ Roll captains ]` primary button. Tapping fires `pick_captains_random` and surfaces the resulting pair in the **pair-confirmation sheet** (below). Re-rolls are allowed until the admin confirms. Candidate list still shows below, muted, for reference.

**Candidate-list row rendering contract.**

*For FFC members (from `v_captain_eligibility`):*
- Rank # in the current season (`current_rank`, e.g. `#8`).
- Avatar + display name.
- Position pills (primary filled + secondary outlined) per §2.1 palette.
- **Three criteria booleans** rendered as a compact `✓ ✓ ✓` triplet, colour-coded green = pass, red = fail. Tapping the triplet expands a one-tap tooltip showing the raw values (`7 MP · 78% attend · last captained 5 md ago`).
- Row-right: secondary meta (`rank #8 · 7 MP`).
- Action: tap row → opens the pair-confirmation sheet with this player pre-selected as candidate A (the admin then picks candidate B from the list).

*Section ordering:*
1. **Eligible** (`is_eligible = true`), sorted by `current_rank ASC`.
2. **Partial** (one or two criteria fail), sorted by failed-criteria-count ASC then `current_rank ASC`.
3. **Ineligible** (zero criteria pass), sorted alphabetically.

*For guests (S007 additions, from `match_guests` joined on the matchday):*
- "+1" glyph avatar (same as §3.7 guest rows).
- Display name.
- Position pills (primary + secondary if set).
- Rating chip (`⭐ WEAK · AVG · STRONG` with the same three-colour palette as §3.7).
- Stamina + accuracy chips in a row below the name (`stamina: medium · accuracy: high`).
- Description as italic subtitle line (truncated to 1 line; tap expands).
- **Not tappable as a captain candidate** — guests can never captain. Tap expands the description only. A small note strip above the guest subsection reads: *"Guests can't captain, but their stats help you balance the pair."*

**Pair-confirmation sheet** — the central interaction for both modes.

Triggered when: (a) admin taps "Use this pair" on a Suggested-pair card, (b) admin taps a candidate row (pre-fills candidate A, prompts for B), or (c) randomizer roll returns a pair.

Sheet content:
1. **Header strip** — "Confirm captains" + close X.
2. **Candidate A block** — side-by-side with B (50/50 split):
   - Large avatar (48 px) + display name.
   - Position pills.
   - Three-criteria triplet (`✓ ✓ ✓` with green/red colouring per criterion).
   - Stats line: `rank #N · X MP · Y% attend · cooldown Z md`.
3. **Candidate B block** — same template, right side.
4. **Balance row** — single line below: `Rank gap: 3 ✓` (or `Rank gap: 8 ✗ — exceeds 5-position rule` with amber icon). Gap ≤ 5 = green; gap > 5 = amber warning but NOT a hard block (admin can still confirm with a "Proceed anyway?" sub-modal).
5. **White = weaker reminder** — explicit text: *"Auto-assigned: **Jamal R. → White** (rank #8, weaker of the pair), **Amir K. → Black** (rank #5).**"** with 🤍/⚫ emoji for visual chunking. Rule is not overridable in Phase 1.
6. **Guest balance summary** (S007 — only when +1s are on the locked roster): *"Guests on each team after draft: White has Ayman (⭐ AVG, ST/W), Black has 0 guests."* Calculated once the admin types the teams — in Phase 1 this is a soft preview only because the admin hasn't picked teams yet at this point. (In Phase 2 when the draft is live, this block updates in real time.)
7. **Confirm button** — bottom-pinned primary: `[ Use this pair ]`. Secondary ghost: `[ Pick different pair ]` (dismisses sheet, returns to candidate list).

On confirm:
- RPC `set_matchday_captains(matchday_id, white_profile_id, black_profile_id)` — SECURITY DEFINER, admin-only. Writes `is_captain = true` on the two chosen players' `match_players` rows AFTER the admin has submitted the team rosters (Phase 1 sequence), OR stages them in a session-local state until team entry (Phase 1 alternative — to be finalised in implementation). Either way the data model endpoint is `match_players.is_captain`.
- Admin is returned to the matchday screen.
- Push notification `teams_posted` fans out to confirmed players once the full team entry is submitted (handled by §3.4 ref entry / admin team-entry flow).

**State implications.**
- Phase 1 does not start a draft. It captures only the captain pair.
- Two different admins could open the screen concurrently — last write wins on the captain pair; a toast informs the later admin ("Captains were picked by Fatima 30s ago").
- After captains are confirmed, re-opening the screen shows the current pair with an "Edit" CTA that re-opens the confirmation sheet.

**Write path.**
- `set_matchday_captains(matchday_id, white_profile_id, black_profile_id)` RPC — to be added to §2.7 Part 5B. Validates both profiles are on the matchday's locked roster, both are FFC members (never guests), and neither is on an active `player_bans` row. Returns the updated captain pair.
- Writes `matches.captain_assigned_at` timestamptz + `matches.captain_assigned_by` uuid (audit trail).

**Edge cases.**
- **Fewer than 14 on locked roster** (someone cancelled post-lock): screen shows "Roster isn't set for this matchday" with a CTA back to matchday screen. Captain pick disabled.
- **All 14 fail the formula** (rare, season early in or roster unusually green): Suggested pair card shows "No fully-eligible pair — consider randomizer" with an inline "Switch to randomizer" button.
- **Only guests remain eligible** (impossible — guests can't captain; this is a sanity check for the filter).
- **An admin bans one of the confirmed captains before team entry**: next load of the screen unsets the ban-affected captain and prompts to re-pick.

**Accessibility.**
- Criteria booleans carry text labels, not colour alone (`✓` / `✗`).
- Pair-confirmation sheet is a modal dialog with `role="dialog"` + focus trap; first focus = confirm button once both candidates are picked.
- Three-criteria tooltip is keyboard-reachable (`tab` then `enter` to expand).

**Acceptance criteria (Depth-B gate).**
- [ ] Screen visible only to admin / super_admin roles; other roles get a permission-denied fallback.
- [ ] Mode default resolves from `season_matchdays_approved` correctly (< 5 → randomizer, ≥ 5 → formula).
- [ ] Mode toggle flips layout without a page reload.
- [ ] Suggested pair cards render from `suggest_captain_pairs` results in formula mode.
- [ ] Randomizer mode roll fires `pick_captains_random` and lands on the pair-confirmation sheet.
- [ ] Pair-confirmation sheet applies the White=weaker rule automatically and displays it explicitly.
- [ ] Rank-gap > 5 shows an amber warning and a `Proceed anyway?` sub-modal, but does not hard-block.
- [ ] Confirming the pair writes through `set_matchday_captains` RPC; concurrent-admin collision surfaces a toast.
- [ ] Guest rows render with S007 stats (pills, rating, stamina/accuracy chips, description) and are NOT selectable as candidates.
- [ ] All 6 S006-reconciled states render: formula default · randomizer default · mode-toggled formula · pair-confirmation with balanced gap · pair-confirmation with rank-gap warning · zero-eligible fallback.

**Phase 2 deferred** (noted so we don't design into a corner).
- Auto-pick + override window: on `roster_locked`, system pre-confirms the top pair from `suggest_captain_pairs` and notifies the admin; admin has a 60-minute window to override before the pair auto-finalises.
- Async captain draft: the pair-confirmation sheet becomes the entrypoint to a turn-based pick UI (see V2.0 captain-draft decision deferred to Phase 2).
- Per-player goal-difference as a 4th criterion once `match_players.goals_against` is tracked.

---

### 3.2 — Last-5 form indicator (NEW, Phase 1)

**Purpose.** A compact visual of each player's most recent form, intended to fold naturally into leaderboard and profile surfaces.

**Data rules.**
- 5 circles = the **5 most recent matches the player actually played in the current season**. Skips matchdays where they were on the waitlist or absent.
- **Per-season scope:** the strip resets at each new season. At the start of a season the strip is empty and fills up as matches are played.
- If the player has fewer than 5 matches **this season**, the strip is shorter — no placeholders, no empty circles.
- **Order:** oldest on the left, most recent on the right. Current form sits at the right edge.
- **Per-circle result:** computed from the player's team in that match and the final match score:
  - Their team scored strictly more goals → **W** (green, `#16a34a`)
  - Teams drew → **D** (grey, `#9ca3af`)
  - Their team scored strictly fewer goals → **L** (red, `#dc2626`)

**Visual spec (Option B — Letter-in-circle).**
- Each result is an 18 px circle, fully coloured (fill = result colour from above).
- The W / D / L letter is white, 10 px bold, centred.
- 3 px horizontal gap between circles.
- The strip is colorblind-safe (letter + colour).

**Surfaces (Phase 1).**
- **Leaderboard row.** Strip sits to the right of the points column. On phones narrower than ~ 360 px, the strip may push the points into a smaller type treatment or the leaderboard may scroll horizontally. Exact row composition finalised when Section 3 full-nav mockups land.
- **Player profile screen.** Larger version of the strip (24 px circles) sits above the detailed match history.

**Surfaces (future).**
- **Share PNG result card** can reuse the treatment. Decision deferred to the Section 5 (share PNG layout) conversation.

**Implementation note.**
- Component is a stateless presenter that takes an array of `"W" | "D" | "L"` of length 0–5.
- **Source:** the `v_player_last5` view (§2.6) — it already does the team-vs-result CASE and returns the W/D/L letter pre-computed, ordered by `kickoff_at DESC` and capped at 5 rows per (season, profile). The component query is simply: `SELECT outcome FROM v_player_last5 WHERE profile_id = $1 AND season_id = $2 ORDER BY rn ASC;` (rn ASC yields oldest-on-the-left / newest-on-the-right per the visual rule above).
- **S013 drift fix.** Earlier versions of this section referenced column names (`home_score`, `away_score`, `played_at`, `user_id`) that never made it into the §2 DDL. Section 2 is authoritative (Critical Rule #7) — the view is the contract.

---

### 3.3 — Player self-signup + admin approval (NEW, Phase 1)

**Purpose.** Let new players sign up on their own (replacing the V1.0 invite-link-only flow) while keeping admin in control of who actually joins FFC. Also handles the common case where an admin has pre-seeded placeholder profiles (e.g., imported from the Excel Season 11 roster) and the real person wants to take ownership of their name rather than creating a duplicate.

**Flow.**
1. **Landing page** exposes a "Sign up" action (alongside "Log in").
2. **Auth step.** User enters email + password or taps "Continue with Google." Supabase Auth creates the `auth.users` row. At this point the user has an authenticated session but no `profiles` row linked — they're in a half-registered state.
3. **"Who are you?" screen (post-auth, pre-approval).** Shows:
   - **Unclaimed existing profiles** — list of `profiles` where `auth_user_id IS NULL`. Each row shows display name + (optional) photo. Tap to request claim.
   - **"I'm new to FFC" button** — opens a small form to enter a new display name and (optional) photo.
4. **Submission.** Creates a `pending_signups` row with the user's `auth.users.id`, their intent (`claim` + `target_profile_id` OR `new` + `display_name`), and timestamp. Triggers a push notification to admin.
5. **Admin approval queue.** Admin has a screen listing pending signups. For each row:
   - **Approve (claim intent)** — sets `profiles.auth_user_id = pending.auth_user_id` on the target profile and deletes the pending row.
   - **Approve (new intent)** — inserts a new `profiles` row with the chosen display name and `auth_user_id = pending.auth_user_id`, deletes the pending row.
   - **Reject** — via the `reject_signup(pending_id, reason)` RPC (§2.7 #6). Resolves the `pending_signups` row (`resolution='rejected'`, `rejected_at`, `rejected_by`, `rejection_reason`) **and** creates a ghost `profiles` row with `role='rejected'` + `reject_reason` populated so the decision is preserved in the admin audit trail (§3.17 Rejected tab). Fires a "rejected" email to the user with a friendly note and a "retry" link (email dispatch is async — an Edge Function watches the `resolution` column). **S013: `role='rejected'` + `profiles.reject_reason` are the authoritative audit record; rejected pending rows are not deleted.**
6. **User experience during wait.** After submitting, user sees a "Waiting for admin approval" screen. Polling or realtime subscription: when admin approves, the app transitions them into the authenticated player experience. Rejection: transition to the rejected-email-sent screen.

**Edge cases.**
- **Multiple people try to claim the same profile.** Only one approval can succeed; on approve the target profile's `auth_user_id` flips from NULL to non-NULL. Admin can see the list of claimants and pick the right one (the app shows all pending claims side-by-side).
- **User already has an approved profile and signs up again.** Detected at auth step — already-linked `auth.users.id` → skip the "Who are you?" screen and log them in as their existing profile.
- **User abandons mid-flow.** `pending_signups` rows get a cleanup job (delete after 30 days of inactivity).

**Data model notes (reconciled against §2 — S013).** Authoritative DDL in §2.2; the §3.3 flow above is the UX layer on top of this shape:
- `profiles.auth_user_id uuid` (nullable, UNIQUE when not null) — NULL means "unclaimed placeholder" seeded by admin. Flipped to the user's `auth.users.id` on successful claim / new-signup approval.
- `pending_signups` (actual columns, §2.2): `id`, `auth_user_id` (FK `auth.users`, required), `display_name` (required), `email` (required), `phone` (nullable), `claim_profile_hint` (nullable FK `profiles` — the user's self-declared match against an unclaimed ghost; admin confirms or overrides), `message` (nullable free-text from user), `resolution` (enum `pending|approved|rejected`), `resolved_at`/`resolved_by`/`resolved_profile_id`, `rejection_reason`, `created_at`. Claim-vs-new intent is derived: `claim_profile_hint IS NULL → new`, `claim_profile_hint IS NOT NULL → claim` (hint may be ignored by admin if they see a better match).
- **Role model:** `profiles.role user_role` enum (§2.1) with values `player · admin · super_admin · rejected`. There is no `is_admin boolean` — helpers `is_admin()` / `is_super_admin()` (§2.8) compute the boolean from the enum. Role is frozen on the player-facing UPDATE policy — only privileged RPCs can change it.
- RLS (§2.8): `pending_signups_select` lets the signup author see their own row OR admins see all; `pending_signups_insert_own` lets an authenticated user insert their own row (WITH CHECK `auth_user_id = auth.uid()`). Writes for resolution happen via the `approve_signup` / `reject_signup` RPCs (§2.7).

**Flagged for review (not blocking):**
- Rejection email template copy — defaults to polite "not a match for FFC right now, reach out if this is a mistake."

---

### 3.4 — Ref entry flow (NEW, Phase 1)

**Purpose.** Replace the current paper-and-hand-off workflow. Ref captures match results on a purpose-built scorecard; admin remains the source of truth via a review-and-confirm queue.

**Flow.**
1. **Admin locks teams on the matchday screen.** After both team rosters are typed in (per Phase 1's manual-entry model), the matchday UI surfaces a **"Generate ref link"** action.
2. **Link issuance.** Backend mints a **signed, time-limited token** (6h expiry, single matchday scope) and returns a URL like `https://ffc.app/ref/<token>`. No ref account needed.
3. **Admin hand-off.** Admin either hands their phone to the ref (ref taps through the open link) or copy/pastes the link into WhatsApp / SMS to the ref.
4. **Ref Entry screen** (opened via the token URL):
   - **Header:** matchday date and number ("Matchday 30 · 2026-04-23"). Live status dot.
   - **Score block:** two number pickers — White vs Black. Large, tappable.
   - **White team section:** 7 rows (or more if guests present), each with player name, goal −/+ counter, yellow-card toggle, red-card toggle.
   - **Black team section:** same.
   - **MOTM selector:** single-select from the combined 14 (+ guests).
   - **Submit button:** "Submit to admin."
5. **On submit.** Writes a `pending_match_entries` row tied to the matchday, plus `pending_match_entry_players` rows for per-player stats. Fires a push to admin: *"Ref submitted results for Matchday 30."*
6. **Admin review screen** (`/admin/match-entries/:id`):
   - Full read-out of submitted data with inline edit affordances.
   - **Approve** → backend promotes the pending rows to real `matches` + `match_players` rows, recomputes leaderboard, triggers result-posted + MOTM push notifications, unlocks the share PNG.
   - **Edit and approve** → admin mutates the pending row before promotion.
   - **Reject** → pending rows deleted; ref link remains valid until expiry for a retry, or admin generates a fresh link.

**Security notes.**
- Token is a signed JWT-style bearer token scoped to a single `matchday_id`. Verified server-side; does not grant full auth session.
- Token cannot be used to read other players' data, leaderboard, or submit for a different matchday.
- Token rotation: admin can "Regenerate ref link" to invalidate the previous token (e.g., if it was sent to the wrong person).

**Data model notes (reconciled against §2 — S013).** Authoritative DDL in §2.4; the §3.4 flow above is the UX layer on top of this shape:
- `pending_match_entries` (actual columns, §2.4): `id`, `matchday_id`, `submitted_by_token_id` (FK `ref_tokens`), `result` (`match_result` enum), `score_white` / `score_black` (int, NOT NULL), `notes` (nullable free-text), `submitted_at`, `status` (`pending_match_status` enum — pending/approved/rejected), `approved_at`/`approved_by`, `rejected_at`/`rejected_by`, `rejection_reason`. MOTM is carried on the child table (see next row) via `is_motm` — NOT on the parent (no `motm_user_id`/`motm_guest_id` columns on pending entries; the single-source MOTM convention only applies to the promoted `matches` row).
- `pending_match_entry_players` (actual columns, §2.4): `id`, `pending_entry_id`, `profile_id` (nullable FK `profiles`), `guest_id` (nullable FK `match_guests`), `team` (`team_color`), `goals` (int), `yellow_cards` (int), `red_cards` (int), `is_motm` (boolean). Participant XOR CHECK enforces profile-or-guest-never-both.
- `ref_tokens` (actual columns, §2.4): `id`, `matchday_id`, `token_sha256` (UNIQUE — raw token never stored), `issued_at`/`issued_by`, `expires_at`, `consumed_at` (nullable — burned on successful submit), `label` (nullable admin note like "Ahmed (ref)"). There is no `revoked_at` — rotation works by issuing a fresh token; the prior token simply expires or is consumed.
- Writes on submit: the anon-callable `submit_ref_entry(token, payload)` RPC (§2.7 #1) validates sha256(token) against a non-consumed/non-expired `ref_tokens` row, inserts the pending entry + line items, and sets `consumed_at`. Rejection via `reject_match_entry` (§2.7 #4) re-arms submission by issuing a fresh token — not by clearing `consumed_at` on the old row.

**Edge cases.**
- **Ref submits nonsensical data** (e.g., per-player goals sum doesn't match the scoreline). Admin sees a validation warning in the review screen but can still choose to approve — we don't block; we flag.
- **Token expires before ref submits.** Ref sees a "This link has expired — ask admin to regenerate" screen.
- **Admin wants to skip the ref entirely.** They can; the existing admin match-entry screen remains usable. The ref link is optional.

---

### 3.5 — +1 guest mechanic (NEW, Phase 1)

**Purpose.** When fewer than 14 regular players have committed by 24h before kickoff, let confirmed players fill the gap by bringing named external guests.

**Unlock rule.**
- A scheduled job runs **Wednesday 8:15 PM** (24h before Thursday 8:15 PM kickoff, local time).
- If the matchday's confirmed-player count is less than the effective roster cap, the matchday enters **"guest slots open"** state. Slot count = `roster_cap(effective_format(matchday_id)) − confirmed_count` — that's `14 − confirmed` for 7v7 matchdays, `10 − confirmed` for 5v5 matchdays (S013 item 4). Per §2.5 helpers, format resolves from `matchdays.format` → `seasons.default_format`.
- A push notification fires to all confirmed players: *"+1 slots are open for Thursday's match. Bring a friend."*

**Who can invite.**
- Any player currently on the confirmed roster for that matchday (not the waitlist, not un-voted FFC members).

**Invite flow (amended in S007 — guest stats step).**
1. Confirmed player opens the matchday screen, sees a new **"Bring a +1"** action when guest slots are open.
2. **Step 1 — Name.** Display name, single text field (required, ≤ 40 chars). "How would you like us to list them on the roster? (e.g., 'Ayman', 'Karim B.')"
3. **Step 2 — Tell us about your +1** (added S007). Required for captain-pair balancing. Six fields, submit blocked until required fields are filled:
   - **Primary position** (required) — 5-pill picker reusing the `player_position` palette (GK · DEF · CDM · W · ST). Tap to select.
   - **Secondary position** (optional) — same picker; the primary-matching chip is disabled client-side to enforce the `match_guests_positions_differ` DB CHECK.
   - **Stamina** (required) — three-chip picker (`low` · `medium` · `high`), writes to `guest_trait`.
   - **Accuracy** (required) — three-chip picker (same enum).
   - **Rating** (required) — three-chip picker (`weak` · `average` · `strong`), writes to `guest_rating`.
   - **Description** (optional) — single-line text input, 140-char limit enforced client-side (matches DB `match_guests_description_length` CHECK). Live counter. Placeholder: *"e.g., 'Friend from the office — plays as a target man.'"*
4. Submit → creates a `match_guests` row with `inviter_id`, `display_name`, `matchday_id`, `primary_position`, `secondary_position`, `stamina`, `accuracy`, `rating`, `description`. Confirmed-count stays the same; `match_guests.count(matchday_id) + confirmed_count` reaches toward 14.
5. Matchday screen shows the guest on the roster per the §3.7 guest-row rendering contract — primary/secondary position pills, description as subtitle below "+1 · invited by <inviter>", rating chip next to the name. Full rendering rules live in §3.7.

**Why app-layer enforces required fields (rather than DB NOT NULL).** Phase 2+ may introduce "quick-invite" flows (e.g., admin bulk-adds pre-known guests from a saved list) where stats are carried over from history rather than re-entered. DB nullability keeps that path open without a schema change. Phase 1 never surfaces a nullable field — the invite form always collects the four required chips.

**Slot dynamics.**
- Guest slot count is **derived**, not stored: `slots = max(0, roster_cap − confirmed_count − guests_count)` at render time, where `roster_cap` = `roster_cap(effective_format(matchday_id))` (§2.5). That's 14 for 7v7, 10 for 5v5 — the rule shape doesn't change, only the number.
- When a regular votes in after guest slots have opened:
  - If total would stay ≤ `roster_cap` (i.e., a slot was still empty), the regular joins the confirmed list normally.
  - If total would exceed `roster_cap` (i.e., guests already filled the gap), the regular joins the **waitlist**. Guests are **not bumped**. — This is the V2.1 "first commitment wins" default and is subject to review.

**Match record.**
- Guests appear on the matchday's locked roster.
- Ref Entry screen (3.4) lists guests alongside regulars in the per-player stats section. Guests can score goals; they can receive cards; they can be MOTM.
- **Leaderboard:** guests do **not** appear. They are not FFC members and do not accumulate season points.
- **Goal totals:** per-guest goals are stored on the `match_players` row where `guest_id` is set and `profile_id` is null (§2.3 participant-XOR CHECK). The `match_guests` row holds only identity + invite metadata + S007 stats — it does NOT carry goal/card counters. Earlier drafts of this section referenced `match_guests.goals_scored`; that column was never in §2 DDL and the Section 2 prologue has flagged this drift since S003 — S013 reconciles it here.
- **Captain formula:** guests are excluded from captain selection entirely (they cannot hold `is_captain = true` and are not considered by `suggest_captain_pairs()` or `pick_captains_random()`). Their stats DO surface in the §3.1-v2 candidate list for pair-balancing *context* (a captain can see which guests are on the opposite team and of what quality), but guests never captain. — Reconciled in S004 (formula simplified to 3 per-player criteria) and carried into S007's §3.1-v2 draft.

**Data model notes (for Section 2 — authoritative DDL in §2.3).**
- `match_guests` holds identity + invite metadata only: `id`, `matchday_id`, `inviter_id`, `display_name`, + **S007-added** guest-stats columns (`primary_position`, `secondary_position`, `stamina`, `accuracy`, `rating`, `description`) + `created_at`, `cancelled_at`, `cancelled_by`.
- Per-match participation (team colour, goals, cards, MOTM) lives on `match_players` via `guest_id` FK (§2.3) — `match_players.profile_id XOR match_players.guest_id` CHECK enforces mutual exclusion. MOTM is recorded on `matches.motm_guest_id` when a guest wins it (§2.3 `matches_motm_xor` CHECK).
- Admin can edit guest `display_name` post-match for typos; admin can also edit guest stats pre-match via §3.18 Admin Matches if the inviter got them wrong. Writes flow through the `update_guest_stats` RPC (§2.7 #13 — landed S009; the admin-matchday screen is now specced in §3.18).

**Notification additions (carry into Section 5).**
- "+1 slots opened" — fires to confirmed players Wednesday 8:15 PM.
- Existing notifications extend naturally: the +1 counts toward the roster for "teams finalized," "result posted," etc.

**Edge cases.**
- **Inviter cancels after inviting a guest.** Guest stays on the roster; inviter is replaced from waitlist or another +1 slot opens up if under 14. (Guest is not tied to inviter's attendance.)
- **Guest doesn't show up.** Treated like a no-show — admin marks the guest absent on the ref entry screen. No discipline implications for the inviter in Phase 1.

---

### 3.6 — Poll vote order & waitlist priority (NEW, Phase 1)

**Purpose.** The poll can be oversubscribed (e.g., 18 players vote for 14 slots). Fair allocation requires a precise, auditable record of who committed first. The rule is simple: **earlier commitment = higher priority**.

**Rule.**
- Every `poll_votes` row carries a server-assigned `committed_at timestamptz NOT NULL DEFAULT now()` (§2.4). Semantics: `committed_at` records the first transition into `choice='yes'` — not every subsequent UPDATE. The database is the single source of truth; client clocks are never used for ordering. (Earlier drafts of this section called the column `voted_at`; the authoritative name is `committed_at` per Section 2.)
- Tiebreaker for identical microseconds: ascending `poll_votes.id` (uuid, DB-assigned — monotonic within the same insert transaction).
- **Confirmed vs waitlist is derived, not stored.** At render / query time, active commitments for a matchday are sorted `(sort_ts ASC, id ASC)` via the `v_match_commitments` view (§2.6); the first N are confirmed and the rest are waitlist, where N = `roster_cap(effective_format(matchday_id))` — 14 for 7v7, 10 for 5v5 (S013 item 4).
- **Active commitments** merge both `poll_votes` rows (regulars, where `choice='yes' AND cancelled_at IS NULL`) and `match_guests` rows (guests, where `cancelled_at IS NULL`) for the same matchday. `v_match_commitments` performs the UNION ALL and exposes `sort_ts` (committed_at for regulars, created_at for guests) so the caller sorts uniformly.
- **On cancellation** (a confirmed player withdraws), their row is soft-deleted by setting `poll_votes.cancelled_at = now()` + `cancelled_by = current_profile_id()` (the partial index excludes cancelled rows from the active set). The sort query re-runs and the next-earliest waitlist commitment is promoted to a confirmed slot. The promoted player receives a push notification (§5 mapping).
- **Re-voting after cancel** creates a brand-new `poll_votes` row — the UNIQUE `(matchday_id, profile_id)` constraint means the prior cancelled row must first be cleaned or the column is instead updated back to `choice='yes'` with a fresh `committed_at`. Implementation path: the RPC that accepts a vote handles idempotency (UPDATE cancelled row in place, reset `committed_at = now()`, clear `cancelled_at/by`). The player loses their previous position and joins the commitment sequence at the end — discourages frivolous cancel-and-rejoin position-holding.

**Interaction with the +1 guest rule (3.5).**
- Guest slot unlocking (Wed 8:15 PM cron) checks `(confirmed_count + guest_count) < roster_cap(effective_format)` — S013 item 4. 14 for 7v7, 10 for 5v5.
- When a confirmed player invites a guest, the guest row is inserted with `created_at = now()` and joins the commitment sequence at its own moment.
- A guest whose `created_at` lands within the first `roster_cap` of the combined sequence is confirmed; if a regular vote arrives later with a later `committed_at`, the regular goes to waitlist — the guest is not bumped. This is the mechanical implementation of the V2.1 "first commitment wins" rule.
- Guests are **never placed on the waitlist** — if a guest invitation would land outside the first `roster_cap` slots (i.e., by the time the inviter submits, no slot remains), the invitation is rejected at submit time with a clear message.

**UI implications.**
- **Matchday confirmed roster** displays in commitment order (not alphabetical). Each row shows the commitment time in a small type treatment (e.g., *"Mon 6:42 PM"*).
- **Waitlist section** displays positions as 1, 2, 3, … (not "#15, #16, #17") for readability. Each row also shows commitment time.
- When a player's position changes because of someone else's cancel or vote, a subtle toast can surface the update ("You're now confirmed · Was waitlist #1").

**Data model notes (reconciled against §2 — S013).** Authoritative DDL in §2.4; the §3.6 rule above is the UX+query-layer contract on top of this shape:
- `poll_votes` (actual columns, §2.4): `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `matchday_id FK matchdays`, `profile_id FK profiles`, `choice poll_choice` (`'yes'|'no'|'maybe'`), `committed_at timestamptz NOT NULL DEFAULT now()`, `cancelled_at timestamptz` (nullable — soft-delete), `cancelled_by uuid`, `created_at`, `updated_at`. UNIQUE (matchday_id, profile_id) — one row per player per matchday, mutated in place on re-vote.
- **Partial index** `poll_votes_order_idx` on `(matchday_id, committed_at, id) WHERE choice = 'yes' AND cancelled_at IS NULL` drives the confirmed/waitlist derivation efficiently.
- `match_guests` (§2.3): `created_at timestamptz NOT NULL DEFAULT now()` is the guest's commitment timestamp — treated as equivalent to a regular's `committed_at` for ordering purposes. Partial active-order index: `match_guests_active_order_idx (matchday_id, created_at) WHERE cancelled_at IS NULL`.
- **View** `v_match_commitments` (§2.6) is the single source for confirmed/waitlist derivation. It UNIONs the two base tables, exposes `sort_ts`, `commitment_type` (`'player'|'guest'`), and `slot_order` (row number within the matchday). Leaderboard, roster UI, captain helper screen, §3.18 admin matches, and ref entry all read from this view — there is no materialized duplicate.

**Edge cases.**
- **Two players submit votes in the same millisecond.** DB `now()` resolves to microseconds; tiebreaker is `id ASC`. Fully deterministic.
- **Admin manually adds a player to a matchday** (not via the poll). Insert a `poll_votes` row with `voted_at = now()` under the admin's user — they enter the commitment sequence at "right now" just like a regular vote.
- **Clock skew across PCs or phones.** Irrelevant — server time is authoritative.
- **Soft-deleted (cancelled) rows.** Retained for audit and to show cancellation history in admin tooling. Excluded from the commitment-sort by the partial index.

**Notification status (reconciled against §2.1 — S013).**
- **S009 decision (Settings v2):** a generic "your position changed" notification type was considered and cut. It is not in `notification_kind` (§2.1) and is not in the Phase-1 push preferences surface (§3.16). The rationale was that the common upgrade path — waitlist → confirmed — is already covered by a dedicated UX surface (§3.7 poll status card refreshes in realtime) and by the `roster_locked` / `plus_one_unlocked` / `teams_posted` notifications at the cadence points that actually matter.
- Phase-2 opportunity: if post-launch feedback shows players want a per-change ping, the cleanest addition is a single `position_changed_in_poll` value on `notification_kind` + a toggle in §3.16 push prefs. No DDL rework required beyond the enum extension. Out of scope for Phase 1.

---

### 3.7 — Poll Screen (NEW in S005 — Phase 1, Depth B)

**Status:** APPROVED — S005, 19/APR/2026 (spec drafted in S005 but not persisted to this file until S007; amended S007 with guest-stats rendering rules; mockup v2 accepted S005).

**Purpose.** The single weekly-cycle entry point. Every Monday–Wednesday this is the most-visited player screen. It answers four questions in one glance: *(1) Is the poll open? (2) Have I voted? (3) Am I in or waitlisted? (4) Who else is coming?* Secondary role: launch surface for "Bring a +1" once Wed 20:00 unlock fires.

**Entry points.**
- Bottom-nav Home tab (player), which routes to Poll screen whenever there's an open or upcoming poll.
- Push notifications — `poll_open`, `poll_reminder`, `plus_one_unlocked`, `roster_locked`, position-change notifications (§3.6) all deep-link here.
- Share-to-WhatsApp "Vote here" link (anon users see the auth wall; registered players land on this screen post-login).

**Data required (read).**
- **Active matchday:** `SELECT * FROM matchdays WHERE status IN ('poll_open','roster_locked') ORDER BY starts_at ASC LIMIT 1`. If none, render the "pre-open" state with the next scheduled matchday.
- **Commitment-ordered list:** merged view over `poll_votes` (regulars) + `match_guests` (+1s) for the active matchday, sorted `(committed_at ASC, id ASC)`. First 14 = confirmed; rest = waitlist (guests never waitlist — see §3.6).
- **Each commitment row** carries: avatar (initials or `avatar_url`), `display_name`, **S005: `primary_position` + `secondary_position`** (from `profiles` for members, from `match_guests` for guests), **S007 addition: guest `rating` + `description`** (guests only), `committed_at`.
- **Caller's own status:** `SELECT * FROM poll_votes WHERE matchday_id = :md AND profile_id = auth.uid() ORDER BY committed_at DESC LIMIT 1`. Resolves to one of: not-voted · confirmed (with #N) · waitlisted (with waitlist-#N) · cancelled.
- **Penalty copy:** `SELECT value FROM app_settings WHERE key = 'match_settings'` — drives the penalty sheet's body text. Never hardcoded.
- **Venue + kickoff:** from `matchdays.venue` + `matchdays.starts_at`.

**Data mutations (write).**
- **Cast / change vote:** `cast_poll_vote(matchday_id, choice)` SECURITY DEFINER RPC (§2.7). Writes one `poll_votes` row; soft-cancels any prior active row for the same `(matchday_id, profile_id)` with the cancellation-penalty math applied server-side.
- **Invite +1:** `invite_guest(matchday_id, display_name, primary_position, secondary_position, stamina, accuracy, rating, description)` — SECURITY DEFINER RPC (§2.7, signature amended in S007). Validates slot availability and writes `match_guests` row with all S007 stats fields.
- **Cancel (after lock, within 24h):** triggers penalty sheet first; RPC runs with `confirm_penalty = true`.

**Layout (primary state — voted YES, confirmed).**

```
┌─────────────────────────────────────┐
│ [status bar]                        │
│ [topbar] FFC · 🔔                    │
├─────────────────────────────────────┤
│ MATCHDAY HERO                       │
│ This Thursday · Matchday 07         │
│ 23 / APR / 2026                     │
│ Kick-off 20:00 · doors 19:30        │
│ 📍 Al Quoz 5-a-side — Court B        │
│                          Closes 20h │
├─────────────────────────────────────┤
│ VOTE STATUS CARD                    │
│ [ 7 ]  You're in — spot #7          │
│ OF 14  Voted YES · 23/APR · 18:42   │
│                           [Cancel]  │
├─────────────────────────────────────┤
│ Confirmed · 14 / 14                 │
│ Ordered by vote time                │
│ 1 · MM Mohammed M.  [ST][W]  17:04  │
│ 2 · AK Amir K.      [GK]     17:06  │
│ …                                   │
│ 7 · Y  You          [ST][CDM] (ME)  │
│ …                                   │
│ 9 · +1 Ayman  [ST][W] ⭐avg          │
│    +1 · invited by Karim B.         │
│    "Friend from the office — target │
│     man, good in the box."          │
├─────────────────────────────────────┤
│ Waitlist                            │
│ 1 · TZ Tariq Z.    [DEF]    10:01   │
├─────────────────────────────────────┤
│ [Bring a +1] primary CTA            │
│ [View Matchday] ghost CTA           │
├─────────────────────────────────────┤
│ [bottom nav — Home · Table · …]     │
└─────────────────────────────────────┘
```

**Nine key states** (same screen, only hero + vote-status cards change; roster + CTAs adapt accordingly).

| # | Name | Trigger | Hero/status card | CTA stack |
|---|---|---|---|---|
| 1 | **Pre-open** | Now < Mon 17:00 | Countdown card — "Poll opens Mon 19/APR · 17:00". No commitment list. | `[Set reminder]` only (ghost). |
| 2 | **Open — not voted** | Poll open + no vote row | Big "Will you play Thursday?" prompt + Yes / No / Maybe tri-button. Commitment list below. | `[Vote YES]` primary · `[Not sure — remind me]` ghost. |
| 3 | **Open — voted YES, confirmed #N** *(primary)* | Vote row with rank ≤ `roster_cap` | "You're in — spot #N of {roster_cap}" status card + Cancel button. `{roster_cap}` = 14 in 7v7 / 10 in 5v5 (S013 item 4). | `[Bring a +1]` (disabled until +1 unlocked) · `[View Matchday]` ghost. |
| 4 | **Open — voted YES, waitlisted** | Vote row with rank > `roster_cap` | Amber status card "Waitlist #W · Promoted if anyone drops". | `[Cancel]` primary · `[View Matchday]` ghost. |
| 5 | **+1 unlocked** | Wed 20:00 cron fired + slot(s) remain | Gold strip "{N} guest slots left — Bring a friend." overlays status card. | `[Bring a +1]` primary (active) · `[View Matchday]` ghost. |
| 6 | **Roster locked** | Admin fired `lock_roster(matchday_id)` | Danger strip "LOCKED · Cancel = −1 pt". Confirmed list freezes; waitlist shown read-only. | `[Keep my spot]` green (safe-confirm) · `[Cancel anyway]` red (destructive — opens penalty sheet) · `[View Matchday]` ghost. |
| 6.5 | **Draft in progress (S010)** | Admin starts captain-pick draft → `draft_sessions` INSERT with `status='in_progress'`; `matchday.phase` = `draft_in_progress`. | Status card: "Draft in progress · Waiting for [Captain name] to pick · ⚪ · [n] of {roster_cap} picked". Confirmed list splits into ⚪ WHITE · ⚫ BLACK · Available sections; picking team's section header pulses. Caller's row gets left-border accent once picked; team pill appears in status card at that moment. | `[Cancel — see penalty]` danger · `[View Matchday]` ghost. (No pick action here — captains use §3.1-v2.) |
| 7 | **Penalty sheet (within 24h)** | User taps "Cancel anyway" < 24h before kickoff | Modal slide-up. Body text reads from `app_settings.match_settings`. Pill shows "−1 PT + 7-DAY BAN". | `[Keep my spot]` green (safe-confirm) · `[Confirm cancel]` red (destructive-confirm). |
| 8 | **Teams revealed (S009/S010)** | `draft_sessions.status` flips to `'completed'` (or admin saves team assignments directly) | VOTE STATUS CARD gains `You're on ⚪ White` or `You're on ⚫ Black` below "You're in — spot #N of {roster_cap}". Confirmed list restructures into two sections: **⚪ WHITE TEAM** header + `roster_cap/2` rows · **⚫ BLACK TEAM** header + `roster_cap/2` rows. 7v7 → 7 rows per team · 5v5 → 5 rows per team (S013 item 4). Section header is the team indicator — no per-row `[W]/[B]` pills. Waitlist rows remain below both sections. | Same as state 6 (locked) — no new actions. `[Cancel — see penalty]` danger · `[View Matchday]` ghost. |

**Commitment row rendering contract.**

*For FFC members (from `profiles`):*
- Rank number (1..roster_cap confirmed · 1–∞ waitlist). `roster_cap` = 14 for 7v7 matchdays, 10 for 5v5 matchdays (S013 item 4).
- Avatar (initials fallback; `avatar_url` if set).
- Display name; row gets `.me` class if `profile_id = auth.uid()`.
- Position pills — primary (filled) + secondary (outlined) per §2.1 palette. Omitted if both positions NULL (legacy ghost profiles).
- Commitment time (`DD · HH:MM` compact form, e.g. "Mon 17:04").
- **Tappable → Player profile §3.14**.

*For +1 guests (from `match_guests` — S005 base + S007 stats extensions):*
- Rank number.
- Avatar: literal `+1` glyph in gold circle (not initials — guests aren't FFC members so initials would be confusing).
- `.row.guest` class for italic treatment and subtle gold tinting.
- **Primary line:** `display_name` + **rating chip** (S007) — `⭐weak` · `⭐avg` · `⭐strong` tiny pill next to the name. Colour: weak=muted grey, average=slate blue, strong=gold. Omitted if `rating IS NULL` (admin-added guest without stats).
- **Position pills** (S007) — same palette as members. Primary filled, secondary outlined if present. Omitted if `primary_position IS NULL`.
- **Description subtitle** (S007) — italic small text below, *"+1 · invited by <inviter_display_name>"* on one line, then (if `description IS NOT NULL`) a second italic line with the description, truncated to 1 line with ellipsis. Full description visible on tap (see below).
- Commitment time.
- **NOT tappable for deep-link** — guests have no profile — but tapping the row expands the description inline (single-tap accordion), for readers who want to see the full 140 chars.

**Tap targets.**
- **Member row** → §3.14 Player profile with the row's `profile_id`.
- **Guest row** → inline description expand/collapse. Admin-only long-press reveals an "Edit guest" sheet that routes to §3.1-v2's guest-stats editor (or the admin matchday screen, whichever is reached first in implementation order).
- **Vote status card** → scrolls the confirmed list so the caller's own row is centered.
- **Cancel button** → confirmation sheet (pre-lock) or penalty sheet (post-lock / within 24h).
- **Bring a +1** → §3.5 invite flow.
- **View Matchday** → match-prep bundle (team-colour reveal once locked, captain announcements, etc. — outside Phase 1 minimum).

**Theme, position, and safe-area conventions.**
- Root theme class `<html class="light|dark">` per S005 decision. Palette tokens applied via CSS custom properties.
- Position pills keep their hues across both modes; outlined variants slightly lighten in dark for legibility.
- Safe-area insets on the fixed bottom nav + fixed CTA stack (Rule #10 from CLAUDE.md).
- DD/MMM/YYYY uppercase dates on the matchday hero (`23 / APR / 2026`).

**Acceptance criteria.**
1. A player with an active YES vote sees their rank within 500 ms of screen mount (single query drives both the list and the status card).
2. Cancellation within 24h triggers the penalty sheet before any DB mutation; tapping "Keep my spot" aborts cleanly.
3. Position pills render on every member row where both positions resolve to NON-NULL values; missing-position rows render name-only without shifting column widths (fixed-width name column, flex gap for pills).
4. Guest rows render position pills, rating chip, and description per the S007 contract; omit gracefully when any field is NULL.
5. Penalty copy text is fetched from `app_settings` at screen mount and never hardcoded. Changing the copy in admin tools takes effect on the next screen mount, no redeploy.
6. Theme toggle propagates within 16 ms (one paint) — root class swap, no remount.
7. After an admin fires `lock_roster`, a WebSocket / poll-refresh causes in-flight poll screens to flip to state 6 within 5 seconds.
8. **(S009/S010)** When `draft_sessions.status` flips to `'completed'`, all connected poll screens flip from State 6.5 to State 8 within 5 seconds — the list restructures into ⚪ WHITE TEAM + ⚫ BLACK TEAM sections (7 rows each; section header is the team indicator — no per-row pills). The caller's VOTE STATUS CARD gains the `You're on ⚪ White / ⚫ Black` row. Waitlist rows remain team-less below both sections.
9. **(S010)** When a captain draft starts, all connected poll screens transition from State 6 to State 6.5 within 2s. Each new pick moves the player from Available → the correct team section on all clients within 2s, with the pulse animation switching to the opposite team header.
10. **(S010)** State 6 renders a green `[Keep my spot]` (safe-confirm) + red `[Cancel anyway]` (destructive) button pair. State 7 renders green `[Keep my spot]` + red `[Confirm cancel]`. Green = safe-confirm, red = destructive-confirm — durable FFC app-wide colour rule.

**Error / loading states.**
- **Loading:** skeleton rows for the confirmed list (rank pill + grey bar). Status card shows a shimmer instead of the number badge.
- **No matchday scheduled:** replace hero with "No matchday this week. The next one will post Monday." + home-nav return CTA.
- **Permission denied (anon / banned):** route to auth wall.
- **Invite-guest RPC fails** (e.g., slot taken during submit): toast "That slot just filled — someone else beat you to it." Form preserves entered values so the player doesn't lose the description text.

**Notification fan-outs (Section 5 linkage).**
- Mount-time: marks `notifications` rows of type `poll_open` and `poll_reminder` for this user+matchday as `read_at = now()`.
- After a successful `cast_poll_vote` promoting the caller from waitlist→confirmed, fires no additional notification to the caller (they're on-screen); fires `roster_locked` broadcast to all confirmed players only when `lock_roster` RPC runs.
- `plus_one_unlocked` notifications are dispatched by the Wed 20:00 cron (§3.5) and deep-link back to this screen in state 5.

**Phase-2 deferred.**
- "Vote as guest-inviter" — letting someone invite a guest without personally voting YES. Phase 1 requires the inviter to be confirmed.
- Inline swap-my-vote-for-a-waitlist-player (a.k.a. "let Karim take my slot"). Phase 2 will introduce a transfer action.

> **S009 note:** Previously deferred line ("Admin's team-colour pre-assignment preview on this screen once roster is locked") was LANDED in S009 as state 8 above. Closes the S005 open decision.

### Post-lock substitution with captain reroll right (NEW S010)

**Status:** DRAFT — S010, 21/APR/2026. Net-new behaviour landed from subagent B scratch.

**Purpose.** Preserve team balance when a player cancels within the 24h post-lock window. The captain whose team lost the player gets a unilateral right to either (a) accept the waitlist-promoted substitute, or (b) trigger a full reroll of non-captain slots. The opposing captain cannot veto — deliberate asymmetry favouring the losing side (they didn't cause the dropout).

**Trigger.** Player X (non-captain, on team T) confirms cancellation within 24h of kickoff → `promote_from_waitlist(matchday_id, departing_profile_id=X)` RPC runs (auto-promotes first waitlisted player Y with `substituted_in_by=X.profile_id`) → `dropout_after_lock` notification sent to captain of team T.

**Captain modal (on next app open after dropout notification):**
- Non-dismissible (no scrim-tap, no X button) until captain acts.
- Body: `{Departed} dropped out. {Replacement} promoted from waitlist. Reroll window closes in Xh YYm (12h before kickoff).`
- `[Accept substitute]` primary green → dismisses modal, no roster write (Y already in place).
- `[Request reroll]` amber → confirmation sub-modal `"All 14 non-captain slots will be redrawn. This cannot be undone."` → on confirm calls `request_reroll(matchday_id)` RPC which: creates a new `draft_sessions` row (`reason='reroll_after_dropout'`), clears non-captain `match_players.team` values, broadcasts `draft_reroll_started` to all 16 roster players + passive `reroll_triggered_by_opponent` to opposing captain.
- All connected poll screens transition from State 8 → State 6.5 within 2s of reroll session starting.
- Reroll window closes 12h before kickoff (configurable via `app_settings.reroll_cutoff_hours_before_kickoff`, default 12). If window elapses while modal is open, buttons replaced by single `[Acknowledge]` (substitute auto-accepted).

**Edge cases (see S010 subagent B scratch `_wip/item-b-draft-reroll-spec.md` for full treatment):**
- Captain IS the dropout → routed to admin via `captain_dropout_needs_replacement` notification (no reroll modal fires).
- Two dropouts before first reroll resolves → first dropout's captain wins reroll right; second dropout's sub joins the in-progress draft pool silently.
- Identical reroll output allowed — no "ensure-different" guarantee in Phase 1.
- Only one `draft_sessions` row with `status='in_progress'` per matchday at any time (partial index).

**Phase-2 deferred.** Player-initiated reroll requests; reroll voting; multiple-round reroll history with diff view; partial reroll (one team only).

---

### 3.13 — Leaderboard (NEW in S006 — Phase 1, Depth B)

**Status:** APPROVED — S006, 20/APR/2026 (all four open decisions O1–O4 resolved; mockup v1 accepted).

**Purpose.** Primary season-standings screen. Gives every player a single scannable ranking of the squad for the active season, with secondary utility for browsing archived seasons and filtering by position. One of the four player-nav tabs (§3.0 nav); also the most-linked destination from share PNGs, notifications, and the home tab.

**Entry points.**
- Bottom-nav tab `Leaderboard` (player mode), `Leaderboard` (admin mode — same screen, admin tab family is separate).
- Deep links from the share-PNG (future), "season ended" notification (`season_closed`), and the home screen "current leader" tile.
- Profile screen's "View full table" link.

**Data sources.**
- `v_season_standings` — one row per (season_id, profile_id). Columns consumed: `season_id`, `profile_id`, `display_name`, `wins`, `draws`, `losses`, `goals`, `yellows`, `reds`, `motms`, `late_cancel_points`, `points`.
- `v_player_last5` — up to 5 rows per (season_id, profile_id) with `outcome` W/D/L and `kickoff_at`. Joined client-side per row.
- `profiles` — `primary_position`, `secondary_position`, `avatar_url`, `role` (to hide banned/ghost rows conditionally — see edge cases).
- `seasons` — for the season picker; archive filter uses `archived_at IS NOT NULL`.

**Ranking rules (Phase 1).**
1. Primary sort = `points DESC` (computed as `wins*3 + draws*1 + late_cancel_points`).
2. Tiebreak chain (applied in order, each deterministic):
   1. `wins DESC`
   2. `(goals − goals_against) DESC` → Phase 1 NOTE: `goals_against` is not stored per-player in `match_players`; **Phase 1 substitute tiebreak = `motms DESC`, then `goals DESC`, then `display_name ASC`**. Revisit "goal difference" as a proper tiebreak in Phase 2 when per-player goals-against is tracked.
   3. `motms DESC`
   4. `goals DESC`
   5. `display_name ASC` (final, fully deterministic).
3. Rank numbers render as `1`, `2`, `3` …; tied rows share the number, next rank skips (standard competition ranking, e.g. `1, 2, 2, 4`).
4. Players with `wins + draws + losses = 0` (zero matches this season) render in a **separate "Not yet played" group** at the bottom of the list — not numbered, alpha-sorted by name, muted row treatment. They re-enter the ranked list as soon as their first match is approved.
5. Guests (`match_guests`) are **excluded** — confirmed by S002 assumption.

**Column header row (added in S006 review).** The list begins with a header row — no rank, no avatar, no rowspan for pills — that labels `Player · W – D – L · MP · Pts`. The W-D-L label letters are rendered in the same colour-triplet (green W / grey D / red L) to teach the pattern that carries down into every data row. The header row has a subtle bottom border and does not scroll away with the list (sticky).

**Row composition.**
Each ranked row shows, left to right:

| Slot | Contents | Notes |
|---|---|---|
| 1 | **Rank** (1-2 digits) | Medal icon for top 3 in current season only: 🥇🥈🥉 (stays a plain number in archived seasons). |
| 2 | **Avatar** 36 px | Fallback = initials disc in `--ink-soft`. |
| 3 | **Name + position pills** | Name on top line. Below name, primary pill (filled) + optional secondary pill (outlined). Pills use the 5-colour palette locked in S005. |
| 4 | **W – D – L** | Colour-coded triplet — green W / grey D / red L, monospace (e.g. `6 – 1 – 2`). Same palette as §3.2 last-5 strip and §3.14 result badges. |
| 5 | **MP** | Matches played — numeric, computed as `wins + draws + losses`. Rendered in monospace, `--ink-soft`. Makes the denominator of the W-D-L triplet explicit at a glance. |
| 6 | **GF** | Goals for (player's goals — not team's goals). |
| 7 | **Cards** | Small cluster `🟨2 🟥0` — hidden when both counts are 0. |
| 8 | **Points** | Bold, largest numeric element in the row. |
| 9 | **Last-5 strip** | The §3.2 component, right-aligned. Empty when the player has 0 matches this season (no strip rendered, column just absent). |

**Late-cancel penalty NOT shown on leaderboard (S006 review).** The penalty column was originally slot 8 but was removed on 20/APR/2026 after mockup review — keeping it forced W-D-L/MP/Pts into narrower fixed widths which squeezed player names. Penalties surface on the **post-match report** (see §3.15 match-detail sheet) and still drive the `late_cancel_points` component of the leaderboard's point calculation — they just aren't rendered as a column here.

**Column visibility by viewport.**

| Breakpoint | Visible slots |
|---|---|
| ≥ 420 px wide | All nine slots. |
| 360 – 419 px | Drop **Cards**; surface via row tap → detail sheet. |
| < 360 px | Additionally drop **GF**. Only rank · avatar · name+pills · W-D-L · MP · points · last-5 strip remain inline; everything else is in the tap-detail sheet. |

No horizontal scroll at any breakpoint. The row is the sole tap target and always routes to the player's profile screen (§3.14).

**Header area.**

1. **Season picker** (required). Left-aligned chip button `Season 2 · Apr – ongoing ▾`. Tap opens a bottom sheet listing all seasons (active + archived) sorted `starts_on DESC`. Active season badged `ongoing`, archived seasons badged `archived`, ended but not archived seasons badged `ended`. Each row shows `name · starts_on – ends_on`.
2. **Position filter** (optional chip row, right-aligned). Chips: `All` (default), `GK`, `DEF`, `CDM`, `W`, `ST`. Filter matches on `primary_position OR secondary_position`. Multi-select allowed; chips highlight with their palette colour when active. When any filter is active the header shows `N of M` count above the list.
3. **Sort dropdown** (secondary, right of position filter). Options: `Points` (default) · `Goals` · `MOTM` · `Wins` · `Last-5 form` (calculated as wins in last-5). Tap changes primary sort but keeps the tiebreak chain intact. **Sort selection persists across sessions (S006 O3 resolution)** — the chosen option writes to `profiles.leaderboard_sort` and is re-read on next entry. New players default to `points`; an unauthenticated view defaults to `points` without persistence.

**Empty / edge states.**

- **Season not started yet** (no approved matches in the season): full-bleed tile "Season starts here. First matchday will update the table." CTA to poll screen if poll is open.
- **All filters active, zero matches**: muted row "No players match `GK + CDM`. Clear filters."
- **Archived season selected**: no "medals for top 3" animation — static trophy icons only. Header adds a subtle "archived" tag in the top-right.
- **Banned player**: row still renders at their ranked position with a subtle `banned through DD/MMM/YYYY` tag under the name; penalty column already reflects the cancel that triggered the ban.
- **Ghost/legacy profile (pre-positions)**: `primary_position IS NULL`. Position pills omitted; row still ranks normally.

**Actions on each row.**
- **Tap row** → navigate to §3.14 Player profile, scoped to the currently-selected season.
- **Long-press** (mobile) / **right-click** (web): no context menu in Phase 1. Reserved for Phase 2 "compare with me" and "share row as image".

**Realtime + refresh.**
- Page loads with a fresh `SELECT` on entry.
- Pull-to-refresh supported on mobile.
- A Supabase realtime channel subscribed to `matches` UPDATE (where `approved_at` changes from NULL → NOT NULL) triggers a background refetch without a visual spinner — the new numbers fade in. No realtime subscription on `poll_votes` (cancellations update `late_cancel_points` but only need to be fresh on next explicit load; stale-up-to-60s is acceptable).

**Accessibility.**
- Full keyboard tab order: season picker → position chips → sort → first row → last row. Each row is a single focus target.
- Position pills double up with a 2-letter abbreviation (already present) so colourblind users aren't reliant on colour alone.
- Rank-1 medal icon has `aria-label="1st place"`, etc.
- Last-5 strip is already colourblind-safe per §3.2 (letter + colour).

**Loading state.**
- Skeleton: 8 skeleton rows at `--paper-dim` with the avatar disc + two shimmer lines + right-side strip placeholder. No spinner.
- Fetch SLA: show skeleton for ≥ 150 ms to avoid flash; hide when data arrives; fallback timeout at 6 s shows "Couldn't load the table. Tap to retry."

**Notification triggers firing into this screen (cross-ref §5 Notifications, pending).**
- `season_closed` → deep-link to this screen with the closed season pre-selected in the picker.
- `leaderboard_weekly_digest` (future, Phase 2) → deep-link with primary sort = `Last-5 form`.

**Acceptance criteria (Depth-B gate).**
- [ ] Primary sort + full tiebreak chain produces a fully deterministic order given any dataset.
- [ ] Medal icons render for top 3 only in the current (non-archived) season.
- [ ] Row tap routes to §3.14 with correct season param.
- [ ] Position filter is OR across primary + secondary; multi-select works additively.
- [ ] Last-5 strip renders shorter when the player has <5 matches (no placeholders).
- [ ] Ghost/legacy profile (no positions) renders without pills but is ranked normally.
- [ ] Zero-match players appear in the "Not yet played" group, not in the ranked list.
- [ ] Dark mode: every colour token resolves; position-pill hues are unchanged across modes; outline pills are legible on dark paper.
- [ ] Skeleton shows for ≥ 150 ms; error fallback renders after 6 s.
- [ ] Pull-to-refresh re-queries `v_season_standings` + `v_player_last5`.
- [ ] Sort selection writes to `profiles.leaderboard_sort` on change and is re-applied on next screen entry.

**Decisions resolved in S006 (20/APR/2026).**
- **O1 — Tiebreak substitute → APPROVED.** Phase 1 chain is `points DESC → wins DESC → motms DESC → goals DESC → display_name ASC`. True per-player goal-difference deferred to Phase 2 when `goals_against` is tracked on `match_players`.
- **O2 — "Not yet played" group → KEEP AS SEPARATE BOTTOM GROUP.** Zero-match players stay in a dedicated muted group at the bottom of the list, alpha-sorted by name, un-numbered. They re-enter the ranked list as soon as their first approved match lands.
- **O3 — Sort persistence → PERSISTENT.** Selection is written to a new `profiles.leaderboard_sort` column (enum `leaderboard_sort`, default `'points'`). DDL amendment captured in §2.1 (new enum) and §2.2 (new profiles column + S006 migration note). Unauthenticated views default to `'points'` without persistence.
- **O4 — Medal icons → APPROVED.** 🥇🥈🥉 render on top 3 in the current (non-archived) season only; archived seasons show static trophy glyphs; plain rank numbers for all other positions.

---

### 3.14 — Player profile (NEW in S006 — Phase 1, Depth B)

**Status:** APPROVED — S006, 20/APR/2026 (P1–P5 resolved). **Refined in S007, 20/APR/2026** — R1 W-D-L alignment fix · R2 last-5 centering fix · R3 MP added to Season stats · R4 Rank removed from KPI grid (kept as card-header hint) · R5 Totals card replaced with Achievements card · R6 zero-match career state updated. Mockup v3 accepted.

**Purpose.** A player's personal stats page. Renders three things in priority order: (1) identity — avatar, name, positions; (2) performance — current-season stats + last-5 form + career achievements; (3) history — recent matches. Same screen serves the logged-in player's self-view (with an edit button for positions + theme) and any other player's public view. Admin viewing another player sees the public view only; admin-controlled profile edits live on the Admin → Players screen.

**Entry points.**
- Row tap on **§3.13 Leaderboard** (primary — carries `season_id` + `profile_id` via query params).
- Avatar tap in **§3.7 Poll screen** commitment rows (player ↔ player, lands with the currently-open matchday's season).
- Self-tap from the player-nav bottom-right (profile tab → your own profile).
- Avatar tap on the Captain-helper screen (§3.1-v2, S006) — admin preview of a candidate's full profile without leaving the pick flow.
- Deep links from notifications: `match_entry_approved` (lands on the self-view with "You played this match" pulse on the top row of Recent matches), `signup_approved` (self-view, scrolled to the edit-profile CTA).

**Data sources.**
- `profiles` — `id`, `display_name`, `email`, `avatar_url`, `primary_position`, `secondary_position`, `theme_preference`, `leaderboard_sort`, `role`, `is_active`, `joined_on`.
- `v_season_standings` — one row for the selected season, same columns consumed by §3.13.
- `v_player_last5` — up to 5 rows for (selected_season, profile). 24 px circles per §3.2.
- **Recent matches** query (last 10 across all seasons, newest first):
  ```sql
  SELECT md.kickoff_at, s.name AS season_name, s.id AS season_id,
         m.result, m.score_white, m.score_black, mp.team,
         mp.goals, mp.yellow_cards, mp.red_cards,
         (m.motm_user_id = mp.profile_id) AS is_motm
  FROM matches m
  JOIN match_players mp ON mp.match_id = m.id
  JOIN matchdays md     ON md.id = m.matchday_id
  JOIN seasons s        ON s.id = m.season_id
  WHERE mp.profile_id = $1 AND m.approved_at IS NOT NULL
  ORDER BY md.kickoff_at DESC
  LIMIT 10;
  ```
- **Achievements aggregates** (S007 — replaces the S006 career-totals query). Feeds the 6 tiles on the Achievements card. Three queries, all running in parallel with the page load:

  1. **Career scalars** (MOTMs, goals, yellows, reds, career_matches):
     ```sql
     SELECT COUNT(*)                                          AS career_matches,
            COALESCE(SUM(mp.goals), 0)                        AS career_goals,
            COALESCE(SUM(mp.yellow_cards), 0)                 AS career_yellows,
            COALESCE(SUM(mp.red_cards), 0)                    AS career_reds,
            SUM((m.motm_user_id = mp.profile_id)::int)        AS career_motms
     FROM matches m
     JOIN match_players mp ON mp.match_id = m.id
     WHERE mp.profile_id = $1 AND m.approved_at IS NOT NULL;
     ```

  2. **Best W-streak and longest L-streak** (per season, take the max). Computed via a window-function scan over the player's match results grouped by season. Pseudocode:
     ```sql
     WITH results AS (
       SELECT m.season_id, md.kickoff_at,
              CASE
                WHEN m.result = 'draw' THEN 'D'
                WHEN (m.result = 'win_white' AND mp.team='white')
                  OR (m.result = 'win_black' AND mp.team='black') THEN 'W'
                ELSE 'L'
              END AS outcome
       FROM matches m
       JOIN match_players mp ON mp.match_id = m.id
       JOIN matchdays md     ON md.id = m.matchday_id
       WHERE mp.profile_id = $1 AND m.approved_at IS NOT NULL
       ORDER BY m.season_id, md.kickoff_at
     ),
     -- run-length encoding per season then MAX(length) WHERE outcome='W' / outcome='L'
     ...
     ```
     Exact SQL formalized in §2.6 when `v_player_achievements` view lands (queued for S008 with admin dashboards). **Phase 1 Implementation note:** run the RLE in app code (JavaScript over the result set) if the view isn't ready. Same for which season held the record.

  3. **Best finish** — retained as client-side scan of `v_season_standings` across all seasons (cheap). Surfaced only if needed by a future Phase 2 card; dropped from the Achievements card to keep the 6-tile layout focused on gameplay stats.

- **Season picker** feeds from `seasons` ORDER BY `starts_on DESC`.

**Information architecture (scroll order, top to bottom).**
1. **Hero band** — avatar (72 px) · display name (H1, Fraunces) · position pills (large: 28 px height, filled primary + outlined secondary) · joined date (small, muted). Self-view: top-right pencil → edit sheet. **No "You" indicator chip** — self-view is implied by the pencil and by landing from the bottom-nav profile tab.
2. **Season picker chip** — `Season 2 · Apr – ongoing ▾`. Same component as §3.13. Default = season passed in via query param, else active season, else most recent archived season, else empty.
3. **Season stats card** — 6 KPI tiles in a 3×2 grid on mobile (amended S007 — MP added, Rank dropped): `Points` (primary, larger) · `MP` (matches played = `wins + draws + losses`) · `W – D – L` (colour-triplet: green W / grey D / red L) · `Goals` · `MOTM` · `Late-cancel` (muted when 0). **Rank is NOT a KPI tile** — it surfaces as the card-header hint `rank 1st 🥇` / `rank 2nd 🥈` / … (top 3 get the medal glyph only in the current non-archived season; everyone else gets plain `#N`). Driven by the page-level season chip (2) above.
4. **Last-5 form strip (24 px)** — per §3.2, scoped to selected season. Placed below the season stats card. Empty (strip hidden) when 0 matches this season.
5. **Achievements card** (S007 — replaces the S006 "Totals card"). Career-scoped highlights that contextualise the raw numbers. 6 tiles in a 3×2 grid, each tile = emoji icon · big value · small-caps label · italic context line:
   - **⭐ MOTMs** — career MOTM count. Context = `career`.
   - **🔥 W-streak** (positive-tinted big number) — longest win streak in any single season. Context = `Season N · best`. Currently running streak shown if it's the best.
   - **🎯 Goals** — career goal total. Context = `career total`.
   - **🟨 Yellows** — career yellow-card count. Context = `career`.
   - **🟥 Reds** — career red-card count. Context = `career · clean` when 0, else just `career`.
   - **📉 L-streak** (negative-tinted big number) — longest losing streak in any single season. Context = `Season N · longest`.
   The card **does not carry a scope dropdown** — all six tiles are career-wide. Per-season granularity is already covered by the Season stats card + season-picker chip at the top of the screen. When `career_matches = 0`, the whole card is replaced with a single CTA tile `Your career starts here — RSVP Thursday →` linking to §3.7 Poll (or Home if poll is closed).
6. **Recent matches list** — last 10 matches, newest first. Each row:
   - **Left block:** date `DD/MMM/YYYY` (uppercase per durable prefs) + season name as caption.
   - **Result badge:** W (green) · D (grey) · L (red), 18 px pill.
   - **Team chip:** "White" / "Black" pill, outlined in the team colour token.
   - **Score:** `GF – GA` monospace (final match score, not player-specific).
   - **Player line:** "You scored 2 · MOTM ⭐" (or relevant subset). Yellow/red card glyphs surfaced inline only when > 0.
   - Row is **fully tappable** in Phase 1 (normal cursor, ripple, no disabled treatment). Tap → read-only match-detail bottom sheet — see §3.15.
7. **Footer tail** — "Joined DD/MMM/YYYY · Season X member" + a tertiary link "View full leaderboard →" routing to §3.13.

**Self-view vs other-player view vs admin-viewing-other.**

| View | Hero edit button | Season picker | Edit-sheet triggers | Additional chrome |
|---|---|---|---|---|
| **Self** | Shown (pencil icon top-right) | Shown | Position pickers · theme chips · leaderboard-sort chips | "You" chip in hero; scroll-position preserved on sheet close |
| **Other player (player mode)** | Hidden | Shown | — | None |
| **Admin viewing other (admin mode)** | Hidden on **this** screen | Shown | — | Admin-only footer link "Edit in Admin → Players" routing to §3.X admin Players screen (not specced yet — S007/S008) |

Admin profile edits (renaming someone, changing positions on behalf of a ghost profile, marking inactive) live on the Admin → Players screen with fuller controls, not here. This keeps the player-facing screen simple and avoids permission-creep.

**Edit sheet (self-view only).**
- Trigger: pencil icon in the hero.
- Slide-up sheet (80% viewport height on mobile, centered modal on wide).
- Three sections stacked vertically:
  1. **Positions.** Primary picker (single-select, required, 5-chip row GK · DEF · CDM · W · ST). Secondary picker (single-select, optional, same 5 chips with a "None" chip on the left). CHECK enforcement (`profiles_positions_differ`) means the secondary chip currently matching the primary is disabled with a tooltip "pick a different position".
  2. **Theme.** Three chips `Light · Dark · System` (default = `System`). Tapping a chip writes immediately and updates `<html class="…">`; no Save button for theme — change is live.
  3. **Leaderboard sort.** Five chips `Points · Goals · MOTM · Wins · Last-5`. Writes immediately. Matches the `leaderboard_sort` enum added to §2.1/§2.2. Default chip = current value.
- Save button bottom-pinned: **applies only to positions**. Positions must be saved explicitly (primary is required; dismissing without save rolls back). Theme + sort chips auto-save on tap because they're low-risk preferences.
- Backend call: direct `UPDATE profiles SET primary_position=…, secondary_position=…, theme_preference=…, leaderboard_sort=… WHERE id = current_profile_id()` via RLS self-update policy (see note in §2.8) — **no new RPC needed**.
- On save: toast "Profile saved" + optimistic UI update + refetch the current screen's data (to re-hit any server-computed values).
- On validation failure (primary null, or primary == secondary): inline error on the offending chip row, Save disabled.

**RLS self-update note (added to §2.8 scope — S006).** A new policy on `profiles`:
```sql
CREATE POLICY profiles_self_update ON profiles
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (
    auth_user_id = auth.uid()
    -- defense in depth: RLS blocks role / auth_user_id / is_active escalation
    -- (app layer only ever UPDATEs the whitelisted columns below, but we defend here too)
  );
```
The app layer must limit the UPDATE statement to the columns `primary_position`, `secondary_position`, `theme_preference`, `leaderboard_sort`, `display_name`, `avatar_url`, `updated_at`, `updated_by`. A trigger rejects any UPDATE that touches `role`, `is_active`, `auth_user_id` unless `current_user_role()` is admin/super_admin. Trigger body captured in §2.8 when we revisit RLS finalization.

**Empty / edge states.**
- **Zero matches this season** (`v_season_standings` returns no row for selected season): season-stats card shows all zeros with a muted "You haven't played this season yet" line; last-5 strip absent; rank shows as `—` (em dash); medal omitted.
- **Zero matches career-wide** (`career_matches = 0`): Achievements card replaced with a single CTA tile "Your career starts here — RSVP Thursday →" linking to §3.7 Poll if poll is open, else home.
- **Ghost/legacy profile** (`primary_position IS NULL`, or `auth_user_id IS NULL`): position pills omitted from hero; if viewing own ghost profile after claiming (first login), the edit sheet opens automatically with a dismissible onboarding message "Set your positions to appear on the captain-helper list".
- **Banned player** (active `player_bans` row): hero shows muted `banned through DD/MMM/YYYY` chip below the positions. Stats remain visible (the ban doesn't hide history). If self-view and banned, edit sheet is still accessible for theme/sort; positions remain editable.
- **Inactive profile** (`is_active = false`): hero shows `inactive` chip; not linkable from leaderboard (row still renders per §3.13 rules but tap takes to profile showing the chip).
- **Offline** (load fails): skeleton stays for 6 s, then "Couldn't load this profile. Tap to retry."

**Accessibility.**
- Tab order: back button → edit button (self only) → season picker → each KPI tile (read-only, focusable for VoiceOver) → last-5 circles (group focus with aria-label "Last 5 results: W W L W W") → career tiles → recent-match rows.
- Result badges carry text (W/D/L) not colour alone.
- Position pills include the 2-letter abbreviation and `aria-label` ("Primary position: Defender").
- Edit sheet is a modal dialog with `role="dialog"` and focus trap; first focus = primary-position picker.

**Loading state.** Four-tier skeleton matching the four cards (hero + season-stats + last-5 + achievements + recent-matches). Shown for ≥ 150 ms. Sections fetch in parallel (profile + season slice + last-5 + recent matches + achievements aggregates — six queries, one round-trip via Supabase batch or separate promises resolved together).

**Realtime.** Same rules as §3.13 — background refetch on `matches` UPDATE (approval flip). No realtime on `poll_votes`.

**Notification triggers firing into this screen (cross-ref §5, pending).**
- `match_entry_approved` → self-view, Recent matches top row pulses once.
- `signup_approved` → self-view, edit sheet opens pre-scrolled to positions (first-time profile setup).
- `admin_promoted` → self-view (so the new admin sees their role chip land; role chip displays for admins/super-admins in hero).

**Acceptance criteria (Depth-B gate).**
- [ ] Row tap from §3.13 lands on correct profile + correct season scoped in the season picker.
- [ ] Self-view shows the edit pencil; other-player view does not.
- [ ] Admin-viewing-other does not show the edit pencil; shows the "Edit in Admin → Players" footer link instead.
- [ ] Edit sheet Positions save rolls back on dismiss, respects `profiles_positions_differ` CHECK, and refuses to save with null primary.
- [ ] Theme chip tap changes `<html class>` immediately and persists to `profiles.theme_preference`.
- [ ] Leaderboard-sort chip tap persists to `profiles.leaderboard_sort` and affects §3.13 on next entry.
- [ ] Last-5 strip scoped to selected season, 24 px circles, hidden when 0 matches.
- [ ] Rank hint in card header shows medal glyph only in current non-archived season and only for top 3.
- [ ] Season stats grid shows 6 KPIs including **MP**; Rank is NOT a KPI tile (S007).
- [ ] Achievements card (S007) renders 6 tiles with icon + value + label + context line; positive-tinted W-streak and negative-tinted L-streak.
- [ ] Achievements card replaced with career-starter CTA tile when `career_matches = 0`.
- [ ] W/D/L digits inside the W-D-L triplet share a single baseline and font size (S007 alignment fix).
- [ ] Last-5 circles render the letter centred inside the 24 px disc (S007 centering fix).
- [ ] **S012 layout contract:** `.card` elements carry `flex-shrink: 0` so the flex-column `.phone-inner` never compresses them when total content exceeds 824 px (Profile is long-content; overflow: hidden on a flex child otherwise triggers the min-height-auto → 0 rule and cards collapse to thin strips).
- [ ] **S012 tabbar contract:** `.tabbar` uses `position: sticky; bottom: 0; margin-top: auto; flex-shrink: 0; z-index: 10` — never `position: absolute; bottom: 0`. Absolute pins to scroll-content bottom (mid-scroll visual bug); sticky pins to viewport bottom. `.phone-inner` must not carry a hard-coded `padding-bottom` to "reserve space" for the tabbar — sticky is in-flow.
- [ ] Recent matches shows last 10 across all seasons, newest first, date in `DD/MMM/YYYY`.
- [ ] Ghost profile renders without position pills and auto-opens edit sheet on first self-view.
- [ ] Banned chip renders in hero when an active `player_bans` row exists.
- [ ] Dark mode: all tokens resolve; score monospace stays legible; card shadows adapt.
- [ ] Admin / super-admin see a role chip in their own hero.
- [ ] Offline fallback renders after 6 s load timeout.

**Decisions resolved in S006 (20/APR/2026).**
- **P1 — "Best season finish" → COMPUTE LIVE.** Client-side scan of `v_season_standings` across all seasons on profile load. Revisit and materialize into a `v_player_career_totals` view in Phase 2 only if latency becomes painful.
- **P2 — Recent matches row tap → FULLY TAPPABLE.** Rows render with normal tappable affordance (cursor, ripple) in Phase 1. No disabled treatment.
- **P3 — Email visibility → EDIT SHEET ONLY.** Hero does not surface email; it's reachable only from the edit sheet.
- **P4 — "You" indicator chip → DROPPED.** Self-view is implied by the edit pencil and by entering via the bottom-nav profile tab; no chip needed in the hero.
- **W-D-L colour treatment (added in S006 review).** All W-D-L triplets render with green W / grey D / red L letters (same palette as §3.2 last-5 strip and the result badges). Applies to season-stats card and anywhere else W-D-L is rendered.
- **Totals card scope dropdown** — proposed in S006 but **retired in S007 review** (superseded by the Achievements card; Totals duplicated Season stats data without context, and the scope dropdown added state without clear value). See refinements below.

**Also resolved.**
- **P5 — Recent matches row tap destination → READ-ONLY MATCH-DETAIL SHEET.** New Phase 1 scope item. See §3.15 below for the sheet contract.

**Refinements applied in S007 (20/APR/2026).**
- **R1 — W-D-L alignment bug.** Loss digit was inheriting `.kpi .l` label styling (9 px uppercase + margin-top:6px) due to CSS specificity collision. Spec-level fix: W/D/L spans inside the triplet must be rendered with the triplet's font-size and letter-spacing, NOT the label's. Implementation note captured in the mockup CSS (`.kpi .wdl-triplet .w, .d, .l { ... }` override block).
- **R2 — Last-5 circle centering bug.** 24 px discs rendered their W/D/L letter off-centre because `letter-spacing: 0.02em` shifted the glyph right. Fix: `letter-spacing: 0` + explicit `line-height: 1` inside the circle.
- **R3 — MP (matches played) added to Season stats grid.** 6-KPI set is now `Points · MP · W-D-L · Goals · MOTM · Late-cancel`. `MP = wins + draws + losses` — same derivation as §3.13 Leaderboard MP column.
- **R4 — Rank removed from Season stats KPI tiles.** Rank already shown as the card-header hint (`rank 1st 🥇`). Having it as a KPI tile too was redundant.
- **R5 — Totals card replaced with Achievements card.** Totals card was data without context (duplicated Season stats numbers with a scope dropdown); feedback from S007 review called it "just data without explanation". Replaced with a 6-tile Achievements card surfacing career-wide gameplay highlights: MOTMs · best W-streak · career goals · yellows · reds · longest L-streak. Scope dropdown retired with the card.
- **R6 — Zero-match career state.** Updated: career-starter CTA replaces the Achievements card when `career_matches = 0` (was: replaced the Totals card).

---

### 3.15 — Match-detail sheet (NEW in S006, upgraded to Depth-B in S009 — Phase 1)

**Status:** DRAFT — S009, 20/APR/2026 (upgrades the S006 STUB; pending user approval of v1 mockup — wide-viewport sizing to verify at review).

**Purpose.** Read-only bottom sheet (mobile) / centered modal (wide) that surfaces the full outcome of a single approved match — scoreline, MOTM, White + Black rosters with per-player goals and cards, late-cancel penalties, and kickoff meta. Opens from any match-result row in the app without routing to a full match-detail screen in Phase 1. Read-only by design: all mutations live on the Admin → Matches dashboard (§3.18).

**Entry points.**
- **§3.14 Recent matches row tap** (primary). Passes `match_id` + `profile_id` (the profile owner) so the W/D/L chip resolves from that player's perspective.
- **§3.7 Poll screen — "last match" tile** (state 1, closed poll preceding the current matchday cycle). Passes `match_id` + `profile_id = current_user`. Reserved for Phase 2 wiring.
- **§3.13 Leaderboard drill-down** — reserved for Phase 2. No profile context carried; scoreline renders without a W/D/L chip.
- **Notification deep links** — `match_approved` (self-view context), `motm_awarded` (self-view context if the user is the MOTM). Pass `match_id` + `profile_id = current_user`.

**Data required (read).**
- `matches` — `id`, `matchday_id`, `season_id`, `score_white`, `score_black`, `result`, `motm_user_id`, `motm_guest_id`, `approved_at`, `approved_by`.
- `matchdays` — `kickoff_at`, `venue_label`, `matchday_number`.
- `seasons` — `name`, `id`.
- `match_players` — per-profile `team`, `goals`, `yellow_cards`, `red_cards`, `is_captain`, `late_cancel_penalty`, `late_cancel_at`, joined to `profiles` for `display_name`, `avatar_url`, `primary_position`, `secondary_position`.
- `match_guests` — per-guest `team`, `goals`, `yellow_cards`, `red_cards`, `invited_by_profile_id`, joined to `profiles` (inviter) for `display_name`.
- `profiles` — for MOTM render (`motm_user_id` → member) or via `match_guests` (`motm_guest_id` → guest name + gold avatar).

**Data mutations (write).** **NONE.** The sheet is read-only in Phase 1. No comments, no corrections, no admin affordances. Any error the user spots is handled through Admin → Matches (§3.18).

**Sheet container behaviour.**
- **Mobile (<768px).** Bottom sheet slides up from the bottom edge over a scrim (`rgba(10, 22, 40, 0.45)`). A 48×5 px grabber sits at the top. `max-height: 90vh` with `overflow-y: auto` for internal scroll. Dismiss via (a) swipe-down gesture on the grabber area, (b) tap on scrim, (c) hardware back button.
- **Wide viewport (≥768px).** Centered modal, `max-width: 640px`, `max-height: 80vh`, `border-radius: 20px` on all corners (no grabber). Close button (×) top-right, 32×32 px tap target. Dismiss via (a) × button, (b) tap on scrim, (c) Escape key. **Sizing is provisional — to verify at v1 mockup review.**
- **Scroll preservation.** On dismiss, returns the user to the entry screen with scroll position preserved.
- **Focus trap.** `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to the header score line. Initial focus on the close control (× on wide, grabber on mobile).

**Layout (Mobile).**

```
┌─────────────────────────────────────┐
│          ─── grabber ───            │
│                                     │
│   WHITE    4  –  2    BLACK         │  ← header strip
│              [W]                    │    (W/D/L chip from viewer)
│                                     │
│ ⭐ MOTM · Omar Khalil (WHITE)       │  ← MOTM row (omitted if none)
│                                     │
│ ─── WHITE ────────────────── 4 ──── │
│  👤 (C) You         DEF · CDM  ⚽2⭐│
│  👤 Omar Khalil     W   · ST   ⚽2  │
│  👤 Sami Haddad     CDM        🟨   │
│  👤 Rashid Farid    GK              │
│  👤 Tariq Qassim    DEF             │
│  👤 Nasser Khan     W               │
│  ⭐(gold) Guest · Ali  ST  ⚽        │  ← guest row (italic, gold)
│    +1 · invited by You              │
│                                     │
│ ─── BLACK ────────────────── 2 ──── │
│  👤 (C) Ahmed N.    GK              │
│  👤 Karim Aziz      DEF        ⚽1  │
│  👤 Yusuf Saleh     CDM             │
│  👤 Bilal Ayyad     W   · ST   ⚽1🟨│
│  👤 Hamza Riad      ST              │
│  👤 Faris Demir     DEF             │
│  ⭐(gold) Guest · Mo  W              │
│    +1 · invited by Karim Aziz       │
│                                     │
│ ─── late cancels ──────────────────  │  ← only if any
│  🕒 late cancel · Salim Idris · −1pt│
│                                     │
│ ─────────────────────────────────── │
│ 16/APR/2026 · 8:30 pm · Al-Bateen   │  ← footer (meta)
│ Matchday 7 · Season 2               │
└─────────────────────────────────────┘
```

**Header strip.** Reads "WHITE · [score_white] – [score_black] · BLACK" with `WHITE` / `BLACK` small-caps labels flanking a large monospace scoreline. Below the scoreline, the **W/D/L chip** renders on a new line, centred, in the profile-owner's result colour (green W / grey D / red L — durable rule). The chip is omitted entirely when the sheet is opened without a profile context (e.g. future leaderboard drill-down).

**W/D/L chip perspective rule.** The chip reflects how the **profile owner** — the player from whose context the sheet was opened — ended up in this match:
- Entry passes `profile_id = X`.
- Server (or client) looks up `match_players.team` for player X in this match.
- If `X.team = 'white' AND matches.result = 'win_white'` → `W` (green).
- If `X.team = 'black' AND matches.result = 'win_black'` → `W` (green).
- If `matches.result = 'draw'` → `D` (grey).
- Otherwise → `L` (red).
- If player X was a **late-cancel** (never appeared on `match_players` for this match, but appears on the penalty strip) → chip omitted; the late-cancel strip carries the context.
- If no `profile_id` passed (leaderboard drill-down future, no profile context) → chip omitted entirely; header shows the scoreline alone.
- If a **guest** profile-owner context is passed (not possible in Phase 1; guests don't have accounts) → reserved; no behaviour specified.

**MOTM row.** Rendered as a full-width banner strip directly below the header strip, only if `motm_user_id IS NOT NULL OR motm_guest_id IS NOT NULL`. Layout: `⭐ MOTM · [display name] · [WHITE|BLACK]`. The team label colour-codes the background tint (faint white/black tint). If the MOTM is a **guest** (per §2.3, guests CAN be MOTM via `motm_guest_id`), the display name renders italic with the gold avatar glyph prefix — same gold-avatar convention as the poll screen and the guest roster rows below. Omitted entirely if neither pointer is set.

**Roster section rendering contract.** Two stacked sections — WHITE first, BLACK second — each with a section header showing the team name (small-caps) and the team's scoreline number on the right. Each section renders 7 rows (or fewer if the matchday was under-rostered; guest rows fill toward 7 as needed). Captain row renders first within its team.

- **Member row.** Left-to-right: avatar (32 px rounded square) · display name (Fraunces 14 px) · position pills inline (primary filled + secondary outlined, 16 px height, 9 px label) · inline stat badges (right-aligned cluster): `⚽ N` if `goals > 0`, `🟨 N` if `yellow_cards > 0`, `🟥` (no count — single red max) if `red_cards > 0`, `⭐` if this player is MOTM.
- **Captain marker.** A `(C)` badge renders inline just before the display name, same colour as the team accent. Captains render as the first row in their team's section. Two captains per match (one WHITE, one BLACK).
- **Guest row.** Same column layout as member rows but with three differences:
  1. Name renders **italic** with a **gold avatar** (solid gold-token rounded square with the guest's initials).
  2. Below the name, a small caption line reads `+1 · invited by [inviter display name]` (10 px, italic, muted).
  3. **NO S007 rating chip.** **NO description.** Those fields stay in their poll-screen recruitment context. Inline goals/cards/MOTM-star render identically to member rows.
- **Lighter visual weight.** Guest rows use `opacity: 0.88` on the name line and a slightly smaller row padding (6 px vertical vs 8 px for members) to signal non-member status without hiding data.

**Late-cancel strip.** Renders below the BLACK roster section, only if any row exists in `match_players` for this match with `late_cancel_penalty = true`. One line per penalty: `🕒 late cancel · [display name] · −1 pt` (the `−1` is the leaderboard penalty per the late-cancel policy; 7-day ban enforcement is Phase 2 and is NOT mentioned here). Strip label: `LATE CANCELS` small-caps. No late-cancels → strip omitted entirely.

**Footer strip.** Small meta row at the bottom of the sheet, muted grey: `[kickoff DD/MMM/YYYY] · [kickoff HH:MM pm] · [venue_label]` on line 1; `Matchday [N] · Season [N]` on line 2. No admin info (approved_at / approved_by) surfaced to players — that's admin-only on §3.18.

**Theme, position, and safe-area conventions.** Inherits cross-ref §3.0. Sheet respects both light and dark modes. `env(safe-area-inset-bottom)` padding added to the sheet's bottom so the footer clears the iOS home indicator on mobile.

**Acceptance criteria (Depth-B gate).**
- [ ] Opens with fade-in scrim + slide-up (mobile) or fade-in (wide) in ≤ 300 ms.
- [ ] Header scoreline is always readable; W/D/L chip reflects profile-owner perspective when a profile context is passed, omitted otherwise.
- [ ] MOTM row renders whether the MOTM is a member (`motm_user_id`) or a guest (`motm_guest_id`); guest MOTM italic + gold glyph.
- [ ] Captain `(C)` badge renders on exactly one row per team.
- [ ] All member rows render inline goals/cards/MOTM star when > 0; absent badges for 0 values.
- [ ] Guest rows render italic + gold avatar + `+1 · invited by …` subtitle; NO rating chip; NO description; inline stats match member rendering.
- [ ] Late-cancel strip appears only when at least one `match_players.late_cancel_penalty = true` row exists for this match.
- [ ] Footer shows kickoff (DD/MMM/YYYY uppercase) + venue + matchday N + season N.
- [ ] Dismiss (swipe-down / scrim tap / back / ×) returns to entry screen with scroll position preserved.
- [ ] Wide viewport (≥768px) renders as 640×80vh centered modal with × close button; mobile renders as 90vh bottom sheet with grabber.
- [ ] `role="dialog"` + `aria-modal="true"` + `aria-labelledby` set correctly; focus trapped; initial focus on close control.
- [ ] Light + dark mode both legible; W-D-L chip colour tokens resolve correctly in both themes.
- [ ] No horizontal scroll at 320 / 375 / 768 / 1024 / 1440 widths.

**Error / loading states.**
- **Loading.** Skeleton sheet shows for ≥ 150 ms to avoid flash. Fetch SLA 6 s.
- **Fetch failure after 6 s.** Sheet body replaced with a compact error tile: `Couldn't load match details. Tap to retry.` Dismiss still works.
- **Match deleted / never-approved race.** Server returns 404 → error tile: `This match is no longer available.`
- **Offline.** Same as fetch failure; retry button re-queries when network returns.

**Phase-2 deferred.**
- Share-match-as-PNG (caps on §5 share conversation).
- Goal-by-goal timeline / minute-by-minute log.
- Assist attribution.
- Comments / match chat.
- Admin shortcuts (edit goals, reassign MOTM) — those live on §3.18.
- Compare-with-me view (your stats vs theirs for this match).

---

### 3.16 — Settings (NEW in S009 — Phase 1, Depth B)

**Status:** DRAFT — S009, 20/APR/2026 (pending user approval of v1 mockup).

**Purpose.** Player-facing preferences surface for the six settings locked in S008: theme, push-notification opt-ins, leaderboard sort, positions re-entry, display-name edit, and account controls. One screen · one scroll · no nested sub-screens in Phase 1. Settings is auth-gated (per §3.0) — signed-out visitors are bounced to the auth screen before reaching this route. The screen serves the logged-in player only; admin-controlled profile edits continue to live on §3.17 and are not duplicated here.

**Entry points.**
- Bottom-nav profile tab → header gear icon on the player's own profile (§3.14 self-view).
- Deep link from the first-visit push-permission-prompt notification tile (State tile 1 on this screen itself, also surfaced from the home tab).
- Deep link from the `push_permission_denied` fallback banner (emitted by any screen that tries to register a push subscription and fails).
- Edit-profile pencil in §3.14 hero routes to Settings in S009+ (the §3.14 sheet is deprecated once Settings lands — its chip content collapses into rows 1, 3 and 4 of Settings).

**Data required (read).**
- `profiles` — `id`, `display_name`, `email`, `theme_preference`, `push_prefs jsonb`, `leaderboard_sort`, `primary_position`, `secondary_position`, `role`, `is_active`.
- `Notification.permission` (browser API) — `'default' | 'granted' | 'denied'`. Drives State tile 1 (first-visit prompt) vs State tile 2 (denied fallback).
- `navigator.serviceWorker` registration state — to know whether a push subscription exists on this device.

**Data mutations (write).**
- `UPDATE profiles SET theme_preference = $1 WHERE id = auth.uid()` — auto-save on tap.
- `UPDATE profiles SET push_prefs = $1 WHERE id = auth.uid()` — auto-save on tap of master toggle or any child checkbox. The master toggle, when OFF, disables (greys out, non-interactive) the 6 child checkboxes but does NOT clear their stored values — re-enabling the master restores the previous per-event selection.
- `UPDATE profiles SET leaderboard_sort = $1 WHERE id = auth.uid()` — auto-save.
- `UPDATE profiles SET primary_position = $1, secondary_position = $2 WHERE id = auth.uid()` — happens inside §3.3 position-edit flow; Settings is just the deep-link entry.
- `UPDATE profiles SET display_name = $1 WHERE id = auth.uid()` — explicit Save button (requires valid + unique check). On conflict (uniqueness violation) re-renders the row with error copy and does not save.
- `POST /auth/signout` (Supabase auth) — clears session, returns to auth screen.
- Delete-account row is rendered but non-functional in Phase 1 — tap shows a "Coming soon" toast; no destructive call fires.

**Layout (single-phone scroll, top to bottom).**

```
┌──────────────────────────────────────┐
│  [ ← ]              Settings         │  ← top nav (back + screen title, H2 Fraunces)
├──────────────────────────────────────┤
│  (state tiles, conditional)          │  ← first-visit prompt OR denied fallback
├──────────────────────────────────────┤
│  THEME                              ›│  ← row 1 — inline chip row below
│    [ Light ] [•Dark•] [ System ]     │  ← dark is signup default (S010)
├──────────────────────────────────────┤
│  PUSH NOTIFICATIONS           [•ON ] │  ← row 2 — master toggle right-aligned
│    ☑  Poll opens                     │
│    ☑  Poll reminder (2 min before)   │
│    ☑  Roster locked                  │
│    ☑  +1 slot unlocked               │
│    ☑  Match result posted            │
│    ☑  Dropout after lock             │
├──────────────────────────────────────┤
│  LEADERBOARD SORT                   ›│  ← row 3 — inline chip row
│    [•Points•] [ W ] [ Goals ] [MOTM] │
├──────────────────────────────────────┤
│  POSITIONS                          ›│  ← row 4 — deep link to §3.3
│    DEF (primary)  ·  CDM (secondary) │
├──────────────────────────────────────┤
│  DISPLAY NAME                       ›│  ← row 5 — inline editable
│    [ Mohammed Muwahid         ] Save │
├──────────────────────────────────────┤
│  ACCOUNT                             │  ← row 6 — read-only email + actions
│    m.muwahid@example.com             │
│    [ Sign out ]                      │
│    [ Delete account · coming soon ]  │
├──────────────────────────────────────┤
│   (tabbar)                           │
└──────────────────────────────────────┘
```

**Six rows (locked in S008):**

1. **Theme** — `light` / `dark` / `system`. Three-chip row. Writes `profiles.theme_preference`. Auto-save on tap. **`dark` is the signup default** (S010 amendment — FFC's visual direction skews low-ambient, evening football, WhatsApp-first culture). `system` reads `prefers-color-scheme` on every render; if the OS switches while foregrounded, the paint updates on the next user interaction (not on media-query change mid-scroll — avoids flicker). Theme preference is stored cross-device on `profiles` AND mirrored to `localStorage.ffc_theme` so cold start doesn't flash-of-wrong-theme while auth hydrates.

2. **Push notifications** — master toggle (iOS-style pill switch) + six per-event pill switches (S010 amendment — checkboxes replaced with pill switches per durable FFC rule). Writes `profiles.push_prefs jsonb`:
   ```json
   { "master": true, "poll_open": true, "poll_reminder": true, "roster_locked": true,
     "plus_one_unlocked": true, "match_result_posted": true, "dropout_after_lock": true }
   ```
   - **Defaults at signup:** all six keys + master set `true`. `position_changed` is NOT present — admin-approval events are notified via admin channel only, not user-configurable in Phase 1.
   - **`poll_reminder` timing (S010 amendment):** fires at `matchday.poll_close_at - 2 minutes` (intentionally tight — last-call nudge for players who forgot to vote). If post-launch feedback is too aggressive, Section 5 can expose timing as a Phase-2 user preference.
   - **`dropout_after_lock` recipient set:** all confirmed-roster players of the affected matchday + admins. Excludes the cancelling player. Copy: `"{Canceller} dropped out · {Substitute} is now on the roster"`.
   - **Master OFF behaviour:** child pill switches greyed-out (`opacity: 0.4`, `pointer-events: none`); stored values preserved — re-enabling master restores prior selection. Hint below: `"Turn the master on to receive per-event notifications. Your selections are preserved."`
   - **Permission coupling:** first toggle-ON while `Notification.permission === 'default'` fires `Notification.requestPermission()`; denial surfaces State tile 2 and reverts master to OFF in UI.
   - Auto-save on every tap. `position_changed` legacy key silently ignored on read, stripped on next write (no DDL change needed).

3. **Leaderboard sort preference** — `points` / `W` / `goals` / `motms`. Four-chip row. Writes `profiles.leaderboard_sort`. Auto-save. Applies on next §3.13 entry (not realtime — avoids jolting an open leaderboard).

4. **Positions re-entry** — deep link row. Tap opens §3.3. Row preview shows current `primary_position` filled pill + `secondary_position` outlined pill. Ghost profile shows "Set your positions →" in accent colour.

5. **Display name** — inline editable + Save button. Validation: 2–30 chars, regex `^[A-Za-z0-9 .'\-]{2,30}$`, trimmed, whitespace collapsed, uniqueness check (case-insensitive) before save. Conflict: field shakes, red highlight, inline copy "That name's taken. Try another." Save disabled while equal to stored / invalid / in-flight.

6. **Account** — three mini-rows:
   - **Email** (read-only). Phase 2+ enables email-change.
   - **Sign out** — fires `supabase.auth.signOut()`, deregisters local push endpoint, redirects to auth.
   - **Delete account** (disabled, "coming soon"). Toast on tap; no destructive call. **Open question for user review:** add a `mailto:` fallback so players can request manual deletion in Phase 1?

**State tiles.**
- **Tile 1 — First-visit push-permission-prompt.** `Notification.permission === 'default'` AND not dismissed this session. In-page card (we control first surface to avoid "click No before reading"). Copy: "Enable push to know when polls open and teams are revealed." `[Enable notifications]` primary → `Notification.requestPermission()` then toggles row 2 master ON. `[Not now]` secondary → dismisses for session.
- **Tile 2 — Push-permission denied fallback.** `Notification.permission === 'denied'`. Persistent (cannot dismiss). Copy: "Push is blocked by your browser. Open browser site settings for FFC and set Notifications to Allow, then refresh this page." Master toggle forced OFF + disabled while tile present.

**Theme, position, and safe-area conventions.** Per §3.0. Top nav respects `env(safe-area-inset-top)` via `--safe-top`; bottom content clears `--safe-bottom` via `.phone-inner` `padding-bottom: 110px` (matches §3.14 pattern).

**Acceptance criteria (Depth-B gate).**
- **§3.16-AC1.** Theme row renders three chips in the fixed order Light · Dark · System. On first launch after signup the **Dark** chip is active; the app is painted with the dark token set (`.dark` scope variables resolve).
- **§3.16-AC2.** Tapping any Theme chip writes `profiles.theme_preference` and repaints the app in the same frame. Chip active-state updates immediately. No save button rendered on this row.
- **§3.16-AC3.** Push-prefs row renders exactly **six** child pill switches when master is ON, in the exact order: Poll opens · Poll reminder (2 min before close) · Roster locked · +1 slot unlocked · Match result posted · Dropout after lock. No seventh row. `position_changed` is not present.
- **§3.16-AC4.** At signup, `profiles.push_prefs` jsonb is inserted with every listed key set to `true` and the `master` key set to `true`. The old `position_changed` key is not written.
- **§3.16-AC5.** Toggling master OFF preserves the six child values in storage. Toggling master back ON restores the UI to the previously-stored values (not all-true, not all-false). No migration required when upgrading profiles that still have a legacy `position_changed` key — key is silently ignored on read and stripped on next write.
- **§3.16-AC6.** `poll_reminder` notifications are scheduled at `matchday.poll_close_at - 2 minutes` and cancelled if `poll_close_at` is moved. Players whose `push_prefs.poll_reminder === false` OR `push_prefs.master === false` are excluded from the send fan-out.
- **§3.16-AC7.** `dropout_after_lock` notifications fire exactly once per substitution event, to (confirmed-roster ∪ admins) minus the cancelling player, and only to recipients whose `push_prefs.dropout_after_lock === true` AND `push_prefs.master === true`. If no substitute is promoted (roster shortfall), this notification does NOT fire.
- [ ] All six rows render in the locked order from S008; no hidden Phase-2 rows leak into the list.
- [ ] First-visit push-permission-prompt tile appears once per session while `Notification.permission === 'default'`.
- [ ] Denied fallback tile is persistent, forces master OFF + disabled, and renders OS-appropriate re-enable instructions.
- [ ] Leaderboard sort chip auto-saves; next §3.13 entry reads the new value.
- [ ] Positions row deep-links to §3.3 and re-renders the pill preview on return.
- [ ] Display name Save is disabled while value equals stored / fails regex / in-flight request.
- [ ] Display name uniqueness conflict shakes the field and surfaces inline error.
- [ ] Email row is read-only with no edit affordance in Phase 1.
- [ ] Sign out clears session, deregisters the local push subscription endpoint, redirects to auth.
- [ ] Delete account row is present, muted, labelled "coming soon"; tap surfaces toast — no destructive call fires.
- [ ] Dark mode: every colour token resolves; master-toggle "on" uses `--accent`.

**Error / loading states.**
- **Load error:** full-bleed tile "Couldn't load your settings. [Retry]".
- **Save error (auto-save):** control reverts, red tick flashes 2s, non-blocking toast "Couldn't save. Try again."
- **Uniqueness conflict** (display name): inline error, field stays focused.
- **Push subscription failure:** toast "Couldn't enable push on this device. Try again or sign out + back in." Master reverts to OFF.
- **Sign out failure:** toast "Couldn't sign out. Check your connection." Session preserved.

**Notification-wiring (Section 5 stub).**
- **`poll_reminder`** — fires at `matchday.poll_close_at - 2 minutes`. Implement as a scheduled Edge Function invocation pinned to the matchday row, cancelled on `poll_close_at` update. Fan-out filter: `push_prefs.master === true AND push_prefs.poll_reminder === true`.
- **`dropout_after_lock`** — fires on `cancel_after_lock` RPC trigger, ONLY when the same transaction promotes a waitlist substitute. Recipient set: `confirmed_roster_player_ids ∪ admin_profile_ids` minus the cancelling player. Fan-out filter: `push_prefs.master === true AND push_prefs.dropout_after_lock === true`.
- **`position_changed`** — no longer a user-facing notification. Legacy `push_prefs.position_changed` key is not read or written; if encountered on read (old rows) it is ignored and stripped on next write. No DDL change needed.
- Section 5 cross-ref: tabulate all 6 event types with triggering RPC/job, recipient-set expression, fan-out filter, and payload schema.

**Phase-2 deferred.**
- About / version footer.
- Terms & Privacy links.
- Data export (GDPR/PDPL JSON export).
- Delete account — actual destructive flow (30-day soft-delete + admin confirmation chain).
- Per-device push preferences (Phase 1 stores on profile, not per-device).
- Email change (verification round-trip via Supabase auth).
- `poll_reminder` window exposed as user-configurable preference (Phase 2 — if 2-min default proves too aggressive post-launch).

---

### 3.17 — Admin Players (NEW in S009 — Phase 1, Depth B)

**Status:** DRAFT — S009, 20/APR/2026 (pending user approval of v1 mockup).

**Purpose.** Admin management of the member roster. One screen covers three admin jobs: (1) approving signups that land in the `pending` queue, (2) editing member profiles on behalf of players, and (3) placing and lifting bans tied to specific future matchdays. Not player-facing — hidden for `role='player'` sessions via §3.0 nav gating. Pairs with §3.18 as the two primary Phase 1 admin surfaces; Seasons · Admins · Schedule queued for later S009 sub-items.

**Entry points.**
- Bottom-nav `Admin` tab (visible only when `current_user_role() IN ('admin','super_admin')`).
- Deep link from `signup_pending_approval` push notification → `Pending approval` segment.
- From §3.14 Player profile's admin-only footer "Edit in Admin → Players".
- From §3.18 roster views — long-press member row → "Open in Admin Players".

**Data required (read).**
- `profiles` — all rows including `role IN ('pending','player','admin','super_admin','rejected')` and `is_active`.
- `player_bans` — active bans only (`lifted_at IS NULL AND return_matchday_id IS NOT NULL`).
- `v_season_standings` — for "Last season: Nth" hint.
- `matchdays` — future matchdays only for ban-horizon picker.
- `seasons` — for "Last season" label.

**Data mutations (write).**
All writes go through admin-only RPCs. All RPCs log to `admin_audit_log` (new table — **§2.3 amendment queued for masterplan V2.7**) with `{admin_profile_id, target_profile_id, action, payload_jsonb, created_at}`.
- `approve_signup(profile_id)` — flips `role` pending → player, sets `is_active=true`, audits, fires `signup_approved` notification.
- `reject_signup(profile_id, reason)` — flips role pending → **rejected** (NEW enum member — **§2.1 amendment queued**), writes `profiles.reject_reason` (NEW nullable column — **§2.2 amendment queued**). No notification; player learns from sign-in error banner.
- `update_player_profile(profile_id, updates_jsonb)` — whitelist: `display_name`, `primary_position`, `secondary_position`, `avatar_url`, `is_active`. Super-admin extension: `role` (can set `admin`; `super_admin` elevation blocked in Phase 1).
- `ban_player(profile_id, reason, until_matchday_id)` — inserts `player_bans`, sets `is_active=false`, audits, fires `player_banned` notification. CHECK: `until_matchday_id` strictly in future.
- `unban_player(profile_id)` — flips `player_bans.lifted_at = now()`, sets `is_active=true`, audits, fires `player_unbanned`. Idempotent.

**Layout.**

```
┌──────────────────────────────────────────┐
│  ← Admin                              ⚙  │
├──────────────────────────────────────────┤
│  Players  ·  Matches  ·  Seasons  ·  …   │
├──────────────────────────────────────────┤
│  🔍 Search players                       │
├──────────────────────────────────────────┤
│  Active (17) · Pending (3) · Banned (1)  │
├──────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐ │
│ │ 🧑 Mohammed Muwahid       ★ admin   │ │
│ │    DEF · CDM  ·  Last season: 1st   │ │
│ │                               ⋯     │ │
│ └──────────────────────────────────────┘ │
│                                          │
│  [ Pending approval — example ]          │
│ ┌──────────────────────────────────────┐ │
│ │ 🧑 Khaled Ismail     (pending)      │ │
│ │    Email: k.ismail@…                │ │
│ │    Positions picked: GK             │ │
│ │    Signed up 18/APR/2026            │ │
│ │   [  Approve  ]  [ Reject ]          │ │
│ └──────────────────────────────────────┘ │
│                                          │
│  [ Banned — example ]                    │
│ ┌──────────────────────────────────────┐ │
│ │ 🧑 Ahmed B.    🚫 banned             │ │
│ │    Reason: Late-cancel × 3          │ │
│ │    Returns: matchday 23/APR/2026    │ │
│ │                        [  Unban  ]  │ │
│ └──────────────────────────────────────┘ │
│  Bottom tabbar (Home · Poll · Table · Admin) │
└──────────────────────────────────────────┘
```

**Row composition (Active segment).**
1. **Avatar** 40 px rounded 12 px. Fallback = initials disc in `--ink-soft`.
2. **Display name** (Fraunces 15 px) with inline **role badge** when `role IN ('admin','super_admin')`: `★ admin` (gold pill) / `★★ super-admin` (accent pill). Inactive profiles show a muted `inactive` chip.
3. **Position pills** (16 px height) — primary filled, secondary outlined. Omitted for ghost profiles.
4. **Last-season-rank hint** — italic `Last season: 3rd` in `--muted`. Omitted if no row for that season/profile.
5. **Active ban chip** (`banned through DD/MMM/YYYY`) — only if active ban row exists.
6. **Overflow menu** (`⋯`) — actions: `Edit profile` · `Ban player` · `Unban player` · `Promote to admin` (super-admin only) · `Demote to player` (super-admin only) · `Deactivate` / `Reactivate`.

Tap on row (not overflow) → opens **Edit profile sheet**.

**Pending-approval row behaviour.**
- Shows `email · joined-date · positions-selected-at-signup`.
- `[Approve]` → immediate, row animates out, toast "{name} will be emailed."
- `[Reject]` → slide-up sheet with required `reason` textarea (min 10 chars, max 500) + `[Confirm reject]`. No silent reject.

**Banned-row behaviour.**
- Shows full reason · `Returns: DD/MMM/YYYY` · `banned_by` caption.
- `[Unban]` → confirmation mini-sheet "Unban {name}? They'll be able to vote on the next poll."

**Edit-profile sheet.** Slide-up (80% vh mobile / centered modal wide).
- Header: big avatar + name + "editing as admin" subtitle.
- Sections: Display name · Avatar · Positions · Role (super-admin only; `player · admin` chips; super-admin chip disabled — elevation deferred) · Active toggle.
- Footer: `[Cancel]` · `[Save changes]` (disabled until diff non-empty). Optimistic UI; rollback on error.

**Ban flow (from overflow).** Slide-up, medium height. Reason textarea (min 10) + Until-matchday chip row (next 6 upcoming + "further out" picker). `[Confirm ban]` accent-red, destructive.

**Role-promotion judgement.** Super-admin tier intentionally cannot be set from UI — documented as manual DB action to prevent self-elevation by a compromised admin. `promote_to_admin` / `demote_to_player` sit in overflow, super-admin-only.

**Theme, position, and safe-area conventions.** Cross-ref §3.0. Fixed elements pad with `env(safe-area-inset-*)`. Position pills use §2.1 palette.

**Acceptance criteria (Depth-B gate).**
- [ ] Admin tab hidden for `role='player'`; visible for `admin`/`super_admin`.
- [ ] `Active` segment lists `role IN ('player','admin','super_admin')` with `is_active=true`, sorted `display_name ASC`.
- [ ] `Pending approval` segment lists `role='pending'` sorted `created_at ASC` (FIFO).
- [ ] `Banned` segment lists profiles with active `player_bans` row, sorted `return_matchday_id ASC`.
- [ ] Approve flips role → `player`, fires notification, row animates out.
- [ ] Reject requires reason ≥ 10 chars; row moves to `Rejected` sub-filter.
- [ ] Ban flow requires reason + future matchday; `is_active` flips false.
- [ ] Unban is idempotent and audit-logged even if no active ban existed.
- [ ] Edit profile sheet validates `primary_position` required and `primary ≠ secondary`.
- [ ] Super-admin role-chip hidden for admin-level operators.
- [ ] Dark mode: every token resolves; pending-row action buttons retain contrast.
- [ ] All RPCs write to `admin_audit_log`.
- [ ] Search filters `display_name ILIKE + email ILIKE` with 200 ms debounce.

**Error / loading states.**
- **Loading:** 6 skeleton rows per segment.
- **Empty segment:** muted centred text with contextual hint.
- **Failed mutation:** inline red banner "Couldn't save. Tap to retry."
- **Offline:** full-page banner "You're offline. Admin changes require a live connection."
- **Stale data (ban race):** second request fails with `pending_ban_exists`; toast "Already banned by {other-admin}".

**Phase-2 deferred.**
- Bulk operations (multi-select ban/unban, bulk role change).
- CSV export.
- Signup funnel stats.
- Dedicated `Admins` sub-screen + audit-log viewer.
- Rejection cleanup policy (auto-hide > 30 days).
- Player notes field.

---

### 3.18 — Admin Matches (NEW in S009 — Phase 1, Depth B)

**Status:** DRAFT — S009, 20/APR/2026 (pending user approval of v1 mockup).

**Purpose.** Admin management of the full match lifecycle: roster lock → captain picking (links to §3.1-v2) → team assignment → result entry → admin approval → post-approval editing + guest-stats correction. The workhorse screen driving the poll-to-approved-result pipeline every Thursday. Pairs with §3.17.

**Entry points.**
- Bottom-nav `Admin` tab → `Matches` segment.
- Deep link from `roster_lock_pending` notification (Thursday 12:00 cron) → `This week` phase-2 CTA focused.
- Deep link from `match_result_pending_approval` notification → `Results (pending approval)` with row expanded.
- From §3.15 footer admin-only link → routes here for retroactive edits.
- From §3.1-v2 Captain helper back-arrow → returns to This-week segment.

**Data required (read).**
- `matchdays` — `id`, `poll_opens_at`, `kickoff_at`, `roster_locked_at`, `captains_set_at`, `season_id`, `status` (computed enum: `poll_open`, `roster_locked`, `teams_pending`, `result_pending`, `final`).
- `match_players` — `matchday_id`, `profile_id`, `team`, `goals`, `yellow_cards`, `red_cards`.
- `match_guests` — + 6 S007 stat columns.
- `poll_votes` — for roster-lock count.
- `v_confirmed_roster` — final 14 at lock time.
- `match_entries` — ref-submitted results awaiting admin sign-off.
- `matches` — approved matches.
- `seasons` — active season for segment counts.

**Data mutations (write).**
All audit-logged to `admin_audit_log`.
- `lock_roster(matchday_id)` — existing.
- `set_matchday_captains(matchday_id, white_profile_id, black_profile_id)` — **NEW S009** (§2.7). Writes `matchdays.captain_white_profile_id` + `matchdays.captain_black_profile_id`, sets `captains_set_at`. CHECK: white ≠ black, both in `match_players`.
- `create_match_draft(matchday_id, teams_jsonb)` — existing.
- `approve_match_entry(match_entry_id)` — existing. Copies into `matches`, writes per-player stat rows, fires `match_entry_approved`.
- `edit_match_result(match_id, patch JSONB)` — **NEW S009**. Admin-only patch on approved match. Writes before/after audit. Triggers `v_season_standings` cascade. No re-notification.
- `update_guest_stats(guest_id, patch JSONB)` — **NEW S009** (§2.7). Whitelisted: `rating`, `primary_trait`, `secondary_trait`, `goals_hint`, `description`, `is_confirmed`. Stamps `match_guests.updated_by/updated_at`.

**Layout.**

```
┌──────────────────────────────────────────┐
│  ← Admin                              ⚙  │
├──────────────────────────────────────────┤
│  Players  ·  Matches  ·  Seasons  ·  …   │
├──────────────────────────────────────────┤
│  This week · Upcoming · Results          │
│   └─ Pending approval · Approved         │
├──────────────────────────────────────────┤
│  THIS WEEK                               │
│ ┌──────────────────────────────────────┐ │
│ │ Matchday · THU 23/APR/2026 · 19:00  │ │
│ │ ────────────────────────────────    │ │
│ │ Phase 3 · Roster locked              │ │
│ │ 14 confirmed (12 members + 2 guests) │ │
│ │   [  Pick captains →  ]              │ │
│ │ Roster preview                       │ │
│ │   1. Mohammed M.   DEF · CDM         │ │
│ │  13. +1 Samir (guest, ⭐⭐⭐⭐)   ← long-press to edit │
│ └──────────────────────────────────────┘ │
│                                          │
│  [ Results (pending approval) — example ]│
│ ┌──────────────────────────────────────┐ │
│ │ 16/APR/2026  ·  Submitted by Omar K. │ │
│ │ WHITE 4 – 2 BLACK                    │ │
│ │ MOTM: Mohammed M. ⭐                 │ │
│ │ Goals: MM ×2, OK ×1, JH ×1, Samir ×1 │ │
│ │ Cards: 🟨 × 2                        │ │
│ │ [ Review + approve → ]  [ Edit ]     │ │
│ └──────────────────────────────────────┘ │
│  Bottom tabbar (Home · Poll · Table · Admin) │
└──────────────────────────────────────────┘
```

**Segments.**
1. **This week** — matchday with `kickoff_at` within 7 days. Expands to show current-phase CTA + **always-visible full roster** (S010 durable rule — all ≤`roster_cap` players rendered inline; no tap-to-expand accordion). WHITE TEAM header + `roster_cap/2` rows · BLACK TEAM header + `roster_cap/2` rows once teams are set. For 7v7 matchdays that's 7+7; for 5v5 it's 5+5 (S013 item 4, resolved via `effective_format(matchday_id)`). Colour-coded position pills + MOTM ⭐ on approved matches. Guest rows italic + gold-tint.
2. **Upcoming** — `kickoff_at > now() + 7 days`, newest first.
3. **Results (pending approval)** — `match_entries` where `approved_at IS NULL`. Sorted oldest-first (FIFO).
4. **Results (approved)** — `matches` where `approved_at IS NOT NULL`. Sorted newest-first. Admin-only `Edit` button. Full `roster_cap`-player roster always-visible (same always-visible rule).

**This-week card phases.** Driven by `matchdays.status`:
- **Phase 1 · Poll open** — shows vote counts (# in / # out / # maybe). No admin CTA. A format chip (`7v7` or `5v5`) is rendered to the right of the matchday date so the admin can see at a glance which cap is in force for this matchday (S013 item 4).
- **Phase 2 · Roster lock pending** — appears after `kickoff_at - 27h`. `[Lock roster now]` confirmation lists the `{roster_cap/2}+{roster_cap/2}` about to snapshot (7+7 for 7v7, 5+5 for 5v5). Warn amber.
- **Phase 3 · Roster locked — pick captains** — `[Pick captains →]` routes to §3.1-v2.
- **Phase 4 · Captains set — enter teams** — `[Enter teams →]` opens drag-into-White/Black form (`roster_cap/2` each enforced).
- **Phase 5 · Roster locked — draft pending** — `[Start draft →]` routes to §3.1-v2 captain-draft flow.
- **Phase 5.5 · Draft in progress (S010)** — amber dot + label. Card shows: `Pick [n] of {roster_cap} · ⚪ White picking · {Captain name} · Started {Xh Ym} ago`. If `draft_sessions` row has been `status='in_progress'` for more than `app_settings.draft_stuck_threshold_hours` (default 6h), exposes admin override actions: `[Force complete]` (auto-distributes remaining picks, logs `admin_draft_force_completed`) · `[Abandon draft]` (reverts to Phase 3 roster-locked, logs `admin_draft_abandoned`). When `reason='reroll_after_dropout'`, shows amber warning row: `Reroll triggered by {Captain X} at {DD/MMM/YYYY HH:MM} following {Player Y} dropout`.
- **Phase 6 · Teams revealed** — Teams set. No admin CTA on this card.
- **Phase 7 · Result pending** — "Waiting for ref to submit result." No admin CTA.
- **Phase 8 · Final** — W/D/L chip (matchday perspective) + score + `View detail →` to §3.15.

**Results-pending row.** Expands inline on tap. Shows full score + MOTM + per-player goals/cards (inline edit pencils) + guest-stats-correction long-press. Actions: `[Approve as submitted]` · `[Edit, then approve]` · `[Reject]` (Phase-2 deferred, hidden in Phase 1).

**Approved results — admin edit flow.** Same sheet as §3.15 but with `[Edit match result]` footer → editor pre-populated from `matches` row. Save runs `edit_match_result`. Confirmation modal: "This will update season standings. Continue?" Audit includes full diff.

**Guest-stats correction sub-sheet.** Long-press guest row in any roster view. Sheet 60% vh. Fields: `rating` (5-star picker) · `primary_trait` dropdown · `secondary_trait` dropdown (None allowed) · `goals_hint` stepper (0–10) · `description` textarea (max 200) · `is_confirmed` toggle. Writes via `update_guest_stats`; stamps `updated_by/updated_at`; audit-logged.

**Late-cancel penalty judgement.** Penalties surface on §3.13 and §3.15. Phase 1 does NOT expose a direct "edit late-cancel penalty" control — admin reverses via `edit_match_result` zeroing `late_cancel_points_delta`. Dedicated penalty-edit UI deferred to Phase 2.

**Matchday creation — Format chip (S013 item 4).** From the empty-state CTA `[Schedule a matchday →]` the admin lands on a Create-Matchday sheet with the usual fields (kickoff_at, venue, poll_opens_at, poll_closes_at) plus a **Format chip** — two pills `7v7` (default, tinted accent) · `5v5` (secondary tint). Default selection = `seasons.default_format` of the active season. Selecting the non-default pill writes `matchdays.format = '5v5'` (or `'7v7'` on a 5v5-default season); selecting the default pill leaves `matchdays.format = NULL` (inherit). Changing format after the poll has opened is allowed but warns: *"Switching format now will resize the roster cap from {old} to {new}. Confirmed players currently above the new cap will be moved to waitlist. Continue?"* On confirm, the re-derivation happens naturally (no DB rewrites — `v_match_commitments.slot_order` vs `roster_cap(effective_format)` drives it). Past the roster-lock phase the Format chip is read-only.

**Theme, position, and safe-area conventions.** Cross-ref §3.0. Phase-indicator colour tokens: Phase 1 = `--muted`, Phase 2 = `--warn`, Phase 3–5 = `--accent`, Phase 6 = `--success`.

**Acceptance criteria (Depth-B gate).**
- [ ] Admin-only visibility; regular players get 403.
- [ ] This-week card renders correct phase based on `matchdays.status`.
- [ ] Phase 2 `[Lock roster now]` lists exact 7+7 before commit.
- [ ] Phase 3 `[Pick captains →]` deep-links to §3.1-v2 with `matchday_id` param; back-arrow returns.
- [ ] `set_matchday_captains` writes both atomically (both-or-neither); fails visibly if either not in `match_players`.
- [ ] Results-pending queue is FIFO.
- [ ] `[Approve as submitted]` and `[Edit, then approve]` both run inside DB transaction.
- [ ] `edit_match_result` cascades to `v_season_standings` refresh within 2s and writes full before/after diff to audit.
- [ ] Guest-stats correction sub-sheet opens only on long-press.
- [ ] `update_guest_stats` stamps `updated_by` + `updated_at` on `match_guests` and logs audit.
- [ ] Dark mode: every phase indicator, segment control, result row, sub-sheet stays legible.
- [ ] All audit rows include `admin_profile_id, target_entity, action, payload_jsonb, created_at`.

**Error / loading states.**
- **Loading:** skeleton card + 3 row skeletons per results segment.
- **No matchday this week:** "No matchday scheduled this week." + CTA `Schedule a matchday →` (stub).
- **Poll-open with 0 votes:** banner + link to §3.7.
- **Lock-roster race:** button flips to `Roster already locked ✓` with refresh prompt.
- **Result-entry edit conflict:** "This entry was approved by {other-admin} 12s ago. Re-open." No silent overwrite.
- **Offline:** full-page banner, all CTAs disabled.

**Phase-2 deferred.**
- Draft mode for team entry.
- Auto-pick captains (server-side formula).
- Real-time multi-admin collaboration (presence indicator).
- `[Reject]` action for match entries.
- Dedicated penalty-edit UI.
- Bulk result-approval.
- Match-history CSV export.
- Admin-only post-match comments thread.

---

> **S009 data-model amendments queued for masterplan V2.7** (surfaced by §3.17 + §3.18 drafting):
> - **§2.1** — add `'rejected'` to `profile_role` enum.
> - **§2.2 `profiles`** — add `reject_reason TEXT` (nullable).
> - **§2.3** — create new `admin_audit_log` table with columns `{id, admin_profile_id, target_entity, target_id, action, payload_jsonb, created_at}`.
> - **§2.3 `match_guests`** — audit cols `updated_by` + `updated_at` already landed in S009 item 3.
> - **§2.7** — `edit_match_result(match_id, patch JSONB)` NEW RPC (admin-only, audited). Add to RPC count (was 13 after S009 item 3; now 14).

---

### 3.19 — Formation planner (NEW in S009 — Phase 1, Depth B)

**Status:** DRAFT — S009/S010, 20–21/APR/2026 (mockup v1 approved in S010 after rotating-GK redesign).

**Purpose.** Give each team's captain a lightweight, top-down tactical board to (a) pick a common formation pattern, (b) drag their outfield players + 1 GK into positions, and (c) share the layout with their team. Non-captains on the same team see a read-only, live-updating version so everyone arrives already knowing their shape. Ship intentionally below FIFA/FPL complexity — this is a pre-match nudge, not a tactical analytics tool.

**Format-aware (S013 item 4).** Roster size follows `roster_cap(effective_format(matchday_id))` — 7v7 matchdays render 6 outfield + 1 GK; 5v5 matchdays render 4 outfield + 1 GK. The pattern chip row (below), rotation-number range, and roster section header all re-derive from the matchday's format. The `formations.pattern` CHECK (§2.5) is a superset so a stored row never drifts outside the legal set.

**Entry points.**
1. **Home tab — Matchday card CTA.** `[Plan formation]` button. Captain-only. Visible from `kickoff_at − 24h` until `kickoff_at`. Before 24h window opens, CTA shows as disabled with tooltip "Opens 24h before kickoff".
2. **Push notification `formation_reminder`.** Fired 24h before kickoff to both captains. Tap deep-links to §3.19 in edit mode.
3. **Non-captain entry — Matchday card "View formation" link.** Appears after captain fires `share_formation` (`formations.shared_at IS NOT NULL`). Before share, no entry point is shown.
4. **Deep link from §3.15 Match detail (Phase 2 deferred).**
5. **Team-chat attachment (Phase 2 deferred).**

**Data required (read).**
- `matchdays` — `id`, `kickoff_at`, `captain_white_profile_id`, `captain_black_profile_id`, `teams_locked_at`.
- `match_players` — captain's team for this matchday; joined with `profiles` for `display_name`, `avatar_initials`, `preferred_position`.
- `match_guests` — captain's team; guests appear as draggable tokens too.
- `formations` — **NEW table** (§2.3 amendment in masterplan V2.7):
  ```sql
  formations (
    id                uuid pk,
    matchday_id       uuid fk matchdays,
    team              text check (team in ('white','black')),
    pattern           text check (pattern in ('2-3-1','3-2-1','2-2-2','3-1-2','2-1-3','1-3-2','custom')),
    layout_jsonb      jsonb not null,   -- [{player_id, kind:'member'|'guest', x, y, pos_label}]
    formation_rotation_order jsonb,     -- S010: [{profile_id, rotation_number 1-6, is_starting_gk bool}] for rotating-GK rule
    starting_gk_profile_id  uuid fk profiles nullable,  -- S010: captain-selected starter
    last_edited_by    uuid fk profiles,
    last_edited_at    timestamptz not null default now(),
    shared_at         timestamptz,
    created_at        timestamptz not null default now(),
    unique (matchday_id, team)
  )
  ```
  RLS: any member of `match_players` for that matchday can `select`. Only the corresponding captain can `insert/update` (via RPC, not direct write).

**Data mutations (write).**
1. **`upsert_formation(p_matchday_id, p_team, p_pattern, p_layout_jsonb, p_rotation_order, p_starting_gk_profile_id) → formations.id`** — validates caller is the captain of `p_team`; layout contains exactly `roster_cap/2` tokens (7 for 7v7, 5 for 5v5); exactly 1 GK token; no duplicate `player_id`; every `player_id` in `match_players` or `match_guests` for this team; `p_pattern` is in the format-appropriate subset (see Pattern presets table below). Upserts by `(matchday_id, team)`.
2. **`share_formation(p_formation_id) → void`** — sets `shared_at = now()`, triggers `formation_shared` push to every non-captain team member (respecting push prefs).
3. **Realtime.** Row-level postgres_changes on `formations` — app subscribes for UPDATE where matchday_id/team matches.

**Layout (ASCII — S010 version).**
```
┌──────────────────────────────────────────────┐
│ [statusbar — time · island · battery]        │
├──────────────────────────────────────────────┤
│ ┌── TEAM COLOUR HEADER STRIP ──────────────┐ │
│ │  ⚪ YOU'RE ON WHITE  ·  THU 24/APR/2026  │ │
│ └──────────────────────────────────────────┘ │
│ ← Back   Formation                      ⇪ ⓘ │
├──────────────────────────────────────────────┤
│ [ Dedicated GK ] · [ Rotate every 10 min ]   │  ← rotating-GK segmented toggle (S010)
├──────────────────────────────────────────────┤
│ ┌──pattern chip row (horizontally scrollable)┐│
│ │ 2-3-1  [3-2-1]  2-2-2  3-1-2  2-1-3  1-3-2││  (bracketed = active)
│ └──────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│ ╔══════════════════ PITCH SVG ═════════════╗  │
│ ║  ( GK ①GK )   ← starter + rotation badge║  │
│ ║                                          ║  │
│ ║    ( D ②)    ( D ③)    ( D )            ║  │
│ ║       ( M ④)        ( M ⑤)             ║  │
│ ║              ( ST ⑥)                    ║  │
│ ╚══════════════════════════════════════════╝  │
├──────────────────────────────────────────────┤
│ ROSTER (7)                                   │
│  ┌──────────┬──────┬──────────────────────┐  │
│  │ Avatar+name│Pos  │ Rotation chip        │  │  ← fixed column widths
│  │ Omar Khan  │ DEF │  ②                  │  │
│  │ Bilal K.   │ GK  │  GK (starter)       │  │
│  └──────────┴──────┴──────────────────────┘  │
├──────────────────────────────────────────────┤
│ [ Share with team ]             (primary)    │
└──────────────────────────────────────────────┘
```

**Rotating-GK feature (S010 — real match-day practice).**
- **Segmented toggle:** `Dedicated GK` (default if any player has `primary_position='GK'`) vs `Rotate every 10 min`.
- **When `Dedicated GK`:** GK token stays with the profile-GK player; no rotation numbers shown.
- **When `Rotate every 10 min` (captain-only):** captain selects the starting GK from a native `<select>` dropdown of all team players (S012 mockup v3 update — was a radio-card list). The remaining outfield players are auto-assigned rotation numbers `1..(roster_cap/2 − 1)` in alphabetical order by `display_name` (captain can drag-reorder in Phase 2). For 7v7 that's rotation 1–6 across 6 outfielders; for 5v5 that's rotation 1–4 across 4 outfielders (S013 item 4). Rotation numbers render as 18px badge top-right on each pitch token; starting-GK token shows gold "GK" badge. Numbers represent 10-minute keeper-swap order (player 1 → keeper at min 10, player 2 → keeper at min 20, etc.).
- Stored in `formations.formation_rotation_order` jsonb + `formations.starting_gk_profile_id`.
- Non-captains see the rotation assignments read-only.

**Captain vs non-captain rendering.**

| Surface | Captain | Non-captain (shared) |
|----|----|----|
| Pattern chip row | interactive | hidden |
| Pitch tokens | drag-enabled | static, no drag |
| Rotating-GK toggle | interactive | read-only display |
| GK-selection radio card | shown when Rotate ON | hidden |
| Roster list | `[placed/unplaced]` + rotation chip | plain list with position label + rotation chip |
| Share button | `[Share with team]` / `[Reshare update]` | replaced with "Shared by Capt {name} · {DD/MMM HH:mm}" |

**Pattern presets — coordinate tables.**

**7v7 (6 outfield + 1 GK):**

| Pattern | GK | Defence | Midfield | Attack |
|---|---|---|---|---|
| **2-3-1** | (50,8) | (35,28)·(65,28) | (25,52)·(50,52)·(75,52) | (50,78) |
| **3-2-1** | (50,8) | (25,28)·(50,28)·(75,28) | (35,52)·(65,52) | (50,78) |
| **2-2-2** | (50,8) | (35,28)·(65,28) | (35,52)·(65,52) | (35,78)·(65,78) |
| **3-1-2** | (50,8) | (25,28)·(50,28)·(75,28) | (50,52) | (35,78)·(65,78) |
| **2-1-3** | (50,8) | (35,28)·(65,28) | (50,52) | (25,78)·(50,78)·(75,78) |
| **1-3-2** | (50,8) | (50,28) | (20,52)·(50,52)·(80,52) | (35,78)·(65,78) |
| **Custom** | free | free | free | free |

**5v5 (4 outfield + 1 GK) — S013 item 4:**

| Pattern | GK | Defence | Midfield | Attack |
|---|---|---|---|---|
| **1-2-1** | (50,8) | (50,28) | (35,52)·(65,52) | (50,78) |
| **2-1-1** | (50,8) | (35,28)·(65,28) | (50,52) | (50,78) |
| **1-1-2** | (50,8) | (50,28) | (50,52) | (35,78)·(65,78) |
| **Custom** | free | free | free | free |

Coordinates are `(x%, y%)` on pitch SVG; `(0,0)` top-left, own goal at top (`y=0`), attacking goal at bottom (`y=100`). The visible pattern chip row in the UI is filtered by `effective_format(matchday_id)` — 7v7 shows the six 7v7 patterns + Custom; 5v5 shows the three 5v5 patterns + Custom. The `formations_pattern_valid` DB CHECK (§2.5) is the strict superset of all 10 values.

**Drag-drop behaviour.** Long-press (300ms) lifts token. Drop snaps to 5% grid cell, clamped to `(5..95, 5..95)`. `pos_label` auto-recomputed from `y` (`y<15`=GK, `15-39`=DEF, `40-64`=MID, `≥65`=ATT). Swap on conflict. Preset chip re-arranges tokens into preset slots animated at 180ms ease-out. In 5v5 mode only 4 non-GK tokens exist — unused DEF/MID/ATT preset slots from the 7v7 coordinate table are irrelevant.

**Realtime.** Supabase realtime channel `formations:matchday_id={id}:team={team}`. UPDATE events: patch local state, animate moved tokens (200ms). New `shared_at`: non-captain auto-transitions to read-only view with toast "Captain {name} shared the formation". Target latency: < 2s. Offline fallback: "Last synced {HH:mm}" footer chip.

**Theme, position, and safe-area.** Cross-ref §3.0. Pitch bg: `--pitch-bg` (light `#2d7a3f` · dark `#1a4529`). Token base: team colour — White tokens = `--paper` + 2px `--ink` border; Black tokens = `--ink` + 2px `--paper` border. GK token outlined in `--pos-gk` gold. All fixed elements honour `env(safe-area-inset-*)` per Rule #10. Statusbar uses `flex-shrink: 0` per S010 v2.1 amendment.

**S012 layout contract (MANDATORY).** Every direct child of `.phone-inner` (team-strip header, pattern chip row, pitch wrapper, GK picker card, roster list, share CTA) carries `flex-shrink: 0`. Without this, the scroll container — which is `display: flex; flex-direction: column; height: 824px; overflow-y: auto` — compresses every child proportionally when natural content exceeds 824 px (Formation's natural height is ~1490 px). Implementation: one defensive CSS rule `.phone-inner > * { flex-shrink: 0; }` covers every existing and future child. See `tasks/lessons.md` S012 entry (statusbar v2.2 amendment) for diagnostic walkthrough.

**S012 GK-picker contract.** Starting-GK selector is a native `<select class="gk-select">` dropdown (S012 replaced the S010 radio-card list). Renders 87 px tall vs 180 px for the old radio list — keeps the GK card within flex budget regardless of roster length.

**Acceptance criteria.**
1. Captain can tap a pattern chip and see all `roster_cap/2` tokens animate to preset positions within 200ms (7 tokens for 7v7, 5 for 5v5).
2. Captain can drag any token to a valid cell; GK cannot be dropped outside `y<15`; non-GK cannot be dropped in `y<15`.
3. Share CTA is disabled unless layout is valid (`roster_cap/2` tokens, exactly 1 GK, no overlaps).
4. Share CTA writes `shared_at` and fires push to every non-captain team member who has `push_prefs.formation_shared = true` (respecting master toggle).
5. Non-captain on same team sees the shared layout within 2s of captain save (realtime).
6. Non-captain cannot drag, cannot change pattern, cannot edit notes, cannot change GK rotation toggle.
7. Opposing team (Black viewer on White formation) cannot see any layout — RLS blocks the read.
8. When `Rotate every 10 min` is ON, captain selects starting GK; remaining outfield players auto-assigned rotation numbers `1..(roster_cap/2 − 1)` — 1–6 for 7v7, 1–4 for 5v5; pitch tokens show numbered badges; roster card shows rotation chip.
9. Concurrent edits by same captain on two devices: last writer wins; the other device receives realtime update within 2s with "Updated elsewhere" toast.
10. Offline captain sees local edits persisted; reconnect replays via `upsert_formation`.
11. Every token reachable via keyboard (tab + space to lift, arrow keys to move in 5% increments).
12. All safe-area insets respected on iPhone 14 Pro — nothing clips under Dynamic Island or home indicator. Statusbar computed height equals `--safe-top` (59px) regardless of content length (`flex-shrink: 0`).
13. Pattern picker visible chip set is filtered by `effective_format(matchday_id)` — 7v7 matchday shows {2-3-1, 3-2-1, 2-2-2, 3-1-2, 2-1-3, 1-3-2, Custom}; 5v5 matchday shows {1-2-1, 2-1-1, 1-1-2, Custom}. Tapping a disallowed pattern is impossible (it isn't rendered) but the DB CHECK guards regardless.

**Error / loading states.**
- **Teams not yet locked:** empty-state "Teams lock after poll closes. Come back then."
- **Roster incomplete** (< `roster_cap/2` on captain's team): banner "Only {n}/{roster_cap/2} confirmed. Share is locked until {roster_cap/2} are set." CTA disabled.
- **Captain swap mid-edit:** next `upsert_formation` returns `403 not_captain`; screen hot-swaps to read-only with toast "You are no longer captain for this team".
- **Network error on save:** inline banner "Couldn't save — retry." Tokens stay in place.
- **Realtime disconnect (non-captain):** banner "Live updates paused" until reconnect.

**Phase-2 deferred.**
- Multiple saved formations per team / template library.
- Formation history browser.
- Animated in-match formation change transitions.
- Opposing-team formation side-by-side view.
- Set-piece markers.
- Wide viewport (≥768px) two-column layout.
- Captain drag-reorder of rotation numbers (Phase 1 is alphabetical auto-assign).

---

## Section 4 — Key Flows (NOT YET WRITTEN)

---

## Section 5 — Notifications & Share (NOT YET WRITTEN)

---

## Section 6 — Open Decisions & Handoff to Phase 2 (NOT YET WRITTEN)

---

## Decisions Locked
See `planning/FFC-masterplan-V2.3.md` for the full list (supersedes V2.0, V2.1, V2.2).

**Locked in S003 (data-model architecture):**
1. Commitment architecture = split (`poll_votes` + `match_guests`, merged via view).
2. MOTM single source of truth (XOR pointers on `matches`).
3. Pending queues stay separate (`pending_signups` vs `pending_match_entries`).
4. RLS effective roles = 3 (player / admin / super_admin). Anon = RPC only.
5. Super-admin tier via `user_role` enum replacing `is_admin boolean`.
6. Season archive requires ended state (`seasons_end_before_archive` CHECK).
7. Audit trail: `updated_by` on matches + match_players (extended in S004 to seasons, profiles, app_settings, scheduled_reminders).
8. WhatsApp auto-post = Option A (native share sheet; zero Meta Business onboarding in Phase 1).

**Locked in S004 (Data-model completion):**
9. Part 4 operational tables approved as posted (notifications fan-out on write; player_bans schema-only until Phase 2; push_subscriptions ported from PadelHub; app_settings super-admin-write; scheduled_reminders DB-editable).
10. Part 5A views = 4 views (commitments, standings, last5, captain-eligibility) as regular views (not materialized).
11. Part 5B privileged surface = 13 RPCs (9 original + `suggest_captain_pairs` + `pick_captains_random` + `set_matchday_captains` + `update_guest_stats` — last two added in S009). `create_match_draft` at team-entry; `approve_match_entry` UPDATE-only on existing draft. Anon surface = `submit_ref_entry` only.
12. Part 5C RLS matrix locked per table per role. `profiles.role` frozen against self-modification via WITH CHECK. Admins cannot create/delete scheduled_reminders rows (super-admin-only).
13. **Section 1 Architecture & Stack** formally approved (was APPROVAL PENDING since S001).

**Late-cancel penalty rules (S004 final):**
- Cancel before roster lock → 0 penalty.
- Cancel after roster/teams locked, outside 24h of kickoff → −1 point.
- Cancel within 24h of kickoff → −1 point **and** a 7-day `player_bans` row (automated row creation via trigger; enforcement of the ban on new `poll_votes` inserts deferred to Phase 2).

**Captain-selection formula (S004 final — simplified from V2.0 five-criterion formula):**
- Per-player eligibility = three booleans, all must be true:
  1. `meets_min_matches` — ≥5 matches played this season (tunable via `app_settings.match_settings.captain_min_matches_this_season`).
  2. `meets_attendance` — attendance rate ≥60% (tunable).
  3. `cooldown_ok` — ≥4 matchdays since last captained (tunable).
- **Red/yellow cards are NOT gating criteria** (removed from V2.0 formula).
- **"Positive points" is NOT a criterion** (removed from V2.0 formula).
- **"Knows the group" and "played in last 2 matchdays" criteria were dropped** (not in user's S004 decision).
- **Early-season randomizer:** if fewer than 5 approved matchdays have been played in the current season, the admin Who-Can-Captain screen leads with `pick_captains_random(matchday_id)`, which picks two captains uniformly at random from the locked-14 roster ignoring eligibility. After ≥5 matchdays, the formula leads and the randomizer remains as a secondary "surprise me" option.
- **Pair rule — White = weaker:** when two captains are picked, the lower-ranked one (higher league-table position number) is assigned White and picks first. Enforced in application logic at pair-selection time, not in the view.
- **Pair balance (V2.0 ±5-position rule) is NOT enforced in S004 formula.**

**Scheduled-reminder cron seed (S004 final — 5 rows, Asia/Dubai):**
- Mon 17:00 — `poll_open_broadcast` (roll-call poll opens; admins share to group).
- Tue 21:00 — `poll_cutoff_warning` (nudge non-voters; push only).
- Wed 20:00 — `plus_one_unlock_broadcast` (unlock +1 if <14; admins share).
- Wed 22:00 — `teams_post_reminder` (complete team selection tonight; admins).
- Thu 12:00 — `teams_post_reminder` fallback (last-chance before kickoff; admins).

**Masterplan version bump queued for S005:** V2.3 → V2.4. V2.4 will document the simplified captain formula, revised late-cancel penalties, expanded 5-row scheduled reminders, and the two new captain-pick RPCs. V2.3 remains preserved unchanged per project rule "never overwrite plan docs".

## Open Decisions (remaining after S004)
- ~~Captain selection formula~~ — **RESOLVED in S002, SIMPLIFIED in S004** (3 criteria + randomizer + White=weaker).
- ~~Exact late-cancel point penalty number~~ — **RESOLVED in S004** (−1 after lock; −1 + 7d ban within 24h).
1. "Repeat dropout" threshold definition (Phase 2+).
2. Snake-draft vs simple alternating order (Phase 2).
3. Best Goalie mechanism (MVP: admin picks).
4. Phase 2: exact admin override window after auto-captain-pick (surfaced in S002).
5. Share PNG style: does it reuse the 3.2 last-5 circle treatment? (To decide in Section 5.)
6. Pair-balance rule (V2.0 criterion 4, ±5 league positions) — dropped in S004 simplification; revisit if pairings feel unbalanced in practice.

## Assumptions — all confirmed by user 2026-04-19
- ✓ Last-5 strip scope = per-season.
- ✓ +1 slot collision = first commitment wins (guests stay; late regulars go to waitlist).
- ✓ Rejected signups = polite email + retry.
- ✓ Guest attribution = inviter user_id stored on guest row.
- ✓ Guest leaderboard visibility = guests do NOT appear; no season points.
