# Phase 2 Slice 2B-A — Live Match Console backend foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the database schema, RLS policies, and RPC extensions that the Live Match Console will write to. No UI changes — backend only. After this slice the schema is ready; the next slice (2B-B) wires the admin "Generate ref link" button to call `regenerate_ref_token` and copy the resulting URL.

**Architecture:**
- One migration file `0028_phase2b_match_events.sql` adds (a) a `match_event_type` enum, (b) two new tables `pending_match_events` + `match_events`, (c) timing columns on `pending_match_entries` and `matches`, (d) RLS policies on the new tables, (e) one new admin RPC `regenerate_ref_token`, (f) DROP+CREATE rewrites of `submit_ref_entry` and `approve_match_entry` to include event-log handling.
- Migration applies to live Supabase via `npx supabase db push`. TypeScript types regenerate from the live schema. Build verifies clean.
- **Migration numbering note:** the design spec at `docs/superpowers/specs/2026-04-26-phase2-design.md` references migration `0029` for Phase 2B (because the spec was written before build-order was fixed). Since the masterplan locks "Track 2B ships first," this slice claims the next unused number — **0028**. The Phase 2A automation migration will be **0029** when it lands later in slice 2A-A. Update the spec inline (one-line edit) so docs stay coherent with disk reality.

**Tech Stack:**
- PostgreSQL 17 (Supabase project `hylarwwsedjxwavuwjrn`, region ap-south-1)
- Supabase CLI invoked via `npx supabase` (global install broken on Windows)
- TypeScript 6 + tsc-build via `node ./node_modules/typescript/bin/tsc -b`
- Vite 8 build via `node ./node_modules/vite/bin/vite.js build`

---

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `supabase/migrations/0028_phase2b_match_events.sql` | **Create** | All DDL + RPC changes for Slice 2B-A. One file, transactional (BEGIN/COMMIT). |
| `ffc/src/lib/database.types.ts` | **Overwrite** | Regenerated from live schema after migration applies. ~1900–2100 lines. |
| `docs/superpowers/specs/2026-04-26-phase2-design.md` | **Edit** | One-line edit: change "Migration 0029" → "Migration 0028" in §B.3 header to reflect actual numbering. |
| `tasks/todo.md` | **Edit** | Append Slice 2B-A close-out section (S040). |

No source-code files (`*.tsx`, `*.ts`) other than the regenerated types. UI work is slice 2B-B.

---

## Pre-flight context (read once before starting)

- Last committed tip on `main`: `1d3f78e` (Phase 2 design + masterplan).
- Last applied migration on live DB: `0027_season11_roster_import` (per `tasks/todo.md` and `CLAUDE.md` status header).
- Existing `submit_ref_entry` and `approve_match_entry` bodies live in `supabase/migrations/0008_security_definer_rpcs.sql:21-93` and `:165-240` respectively. We do NOT modify 0008 — instead 0028 issues `DROP FUNCTION IF EXISTS` followed by `CREATE OR REPLACE` so the new bodies override on apply.
- The `ref_tokens` table column is `consumed_at` (NOT `used_at` — drift fix from S013 §3.4 reconciliation).
- The `match_players` participant XOR check is `(profile_id IS NULL) <> (guest_id IS NULL)` — same shape applies to the new event tables.
- Per CLAUDE.md S028 lesson: GRANT EXECUTE on every SECURITY DEFINER RPC explicitly to `authenticated` (or `anon` for token-validated functions). DEFAULT PRIVILEGES (migration 0012) cover tables only, not functions.
- Per CLAUDE.md schema-drift pattern: query `information_schema` to verify state both before AND after the migration applies.

---

## Task 1 — Pre-flight checks (5 min)

**Files:** none modified. Pure read-only.

- [ ] **Step 1: Confirm working directory clean and at expected tip**

Run:
```bash
cd "C:/Users/User/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC" && git status -sb && git log --oneline -3
```

Expected output:
```
## main...origin/main
1d3f78e docs(phase2): masterplan V3.0 + design spec + ref-console mockup
677b1ed fix(signup,login): post-approval redirect race + forgot-password + reset page
cc8f07e docs(s038): close-out — session log + INDEX + CLAUDE.md status + todo S039 prep
```

If `git status -sb` shows uncommitted changes: STOP. Investigate before continuing.

- [ ] **Step 2: Confirm Supabase project link**

Run:
```bash
npx --yes supabase@latest projects list 2>&1 | grep -E "ffc|hylarwwsedjxwavuwjrn" | head -3
```

Expected: a row containing `hylarwwsedjxwavuwjrn` and `ffc` (the project name) with `LINKED` status. If not linked: `npx supabase link --project-ref hylarwwsedjxwavuwjrn`.

- [ ] **Step 3: Confirm last applied migration on live DB is 0027**

Run:
```bash
npx --yes supabase@latest db query --linked "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3"
```

Expected: top row is `0027` (with `0026`, `0025` below). If top row is `0028` or higher: STOP — schema is ahead of disk. Investigate.

- [ ] **Step 4: Sanity-check existing function signatures we are about to override**

Run:
```bash
npx --yes supabase@latest db query --linked "SELECT proname, pg_get_function_arguments(oid) FROM pg_proc WHERE proname IN ('submit_ref_entry','approve_match_entry','regenerate_ref_token')"
```

Expected:
- `submit_ref_entry` returns `(p_token text, p_payload jsonb)` — current 2-arg signature.
- `approve_match_entry` returns `(p_pending_id uuid, p_edits jsonb DEFAULT '{}'::jsonb)`.
- `regenerate_ref_token` returns NO rows — function doesn't exist yet.

If `regenerate_ref_token` already exists: STOP. Means a prior partial migration ran. Investigate before re-applying.

---

## Task 2 — Author `0028_phase2b_match_events.sql` (15 min)

**Files:**
- Create: `supabase/migrations/0028_phase2b_match_events.sql`

The migration is a single transactional file. Build it section-by-section, commit at end of task.

- [ ] **Step 1: Create the file with the header + section-1 enums + section-2 tables**

Create `supabase/migrations/0028_phase2b_match_events.sql` with the following content:

```sql
-- 0028_phase2b_match_events.sql
-- Phase 2 Slice 2B-A — Live Match Console backend foundation.
--
-- Adds the schema needed for time-stamped match events captured by the ref
-- console at /ref/:token. Two parallel tables: pending_match_events (mirrors
-- the existing pending_match_entries pre-approval staging) and match_events
-- (post-promotion, attached to the permanent matches row). Existing
-- submit_ref_entry and approve_match_entry RPCs are rewritten (DROP+CREATE)
-- to read/write the event log alongside the per-player aggregates.
--
-- New admin RPC: regenerate_ref_token(matchday_id) burns any active token
-- for the matchday and mints a fresh one with 6h expiry. Returns the raw
-- token to the caller — never persisted plaintext.
--
-- Numbering note: the Phase 2 design spec mentions "migration 0029" for
-- Phase 2B because the spec was written before build-order locked. Track 2B
-- ships first; this is 0028. The Phase 2A automation migration becomes 0029
-- when slice 2A-A lands.

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- 1. match_event_type enum
-- ═══════════════════════════════════════════════════════════════
CREATE TYPE match_event_type AS ENUM (
  'goal',
  'own_goal',
  'yellow_card',
  'red_card',
  'halftime',
  'fulltime',
  'pause',
  'resume'
);

COMMENT ON TYPE match_event_type IS
  'Discrete events the ref console captures during a live match. Player events
   (goal/own_goal/yellow_card/red_card) carry profile_id XOR guest_id.
   Match-state events (halftime/fulltime/pause/resume) carry neither.';

-- ═══════════════════════════════════════════════════════════════
-- 2. pending_match_events — staged event log per ref submission
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE pending_match_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_entry_id    uuid NOT NULL REFERENCES pending_match_entries(id) ON DELETE CASCADE,
  event_type          match_event_type NOT NULL,
  match_minute        int NOT NULL,
  match_second        int NOT NULL DEFAULT 0,
  team                team_color,
  profile_id          uuid REFERENCES profiles(id),
  guest_id            uuid REFERENCES match_guests(id),
  meta                jsonb NOT NULL DEFAULT '{}'::jsonb,
  ordinal             int NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pending_event_participant_xor CHECK (
    (event_type IN ('halftime','fulltime','pause','resume')
       AND profile_id IS NULL AND guest_id IS NULL)
    OR
    (event_type NOT IN ('halftime','fulltime','pause','resume')
       AND ((profile_id IS NULL) <> (guest_id IS NULL)))
  ),
  CONSTRAINT pending_event_minute_nonneg CHECK (match_minute >= 0 AND match_second BETWEEN 0 AND 59)
);

CREATE INDEX pending_events_entry_idx
  ON pending_match_events (pending_entry_id, ordinal);

COMMENT ON TABLE pending_match_events IS
  'Time-stamped event log captured by the ref console. Writes flow through
   submit_ref_entry; promoted to match_events on approve_match_entry.';

COMMENT ON COLUMN pending_match_events.match_minute IS
  'Continuous count from kickoff in whole minutes. Stoppage minutes 35+ are
   stored as 35, 36, 37 (continuous); the "+N" notation is rendered
   client-side from app_settings.match_half_minutes_<format>.';

-- ═══════════════════════════════════════════════════════════════
-- 3. match_events — permanent event log post-promotion
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE match_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id            uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  event_type          match_event_type NOT NULL,
  match_minute        int NOT NULL,
  match_second        int NOT NULL DEFAULT 0,
  team                team_color,
  profile_id          uuid REFERENCES profiles(id),
  guest_id            uuid REFERENCES match_guests(id),
  meta                jsonb NOT NULL DEFAULT '{}'::jsonb,
  ordinal             int NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_event_participant_xor CHECK (
    (event_type IN ('halftime','fulltime','pause','resume')
       AND profile_id IS NULL AND guest_id IS NULL)
    OR
    (event_type NOT IN ('halftime','fulltime','pause','resume')
       AND ((profile_id IS NULL) <> (guest_id IS NULL)))
  ),
  CONSTRAINT match_event_minute_nonneg CHECK (match_minute >= 0 AND match_second BETWEEN 0 AND 59)
);

CREATE INDEX match_events_match_idx
  ON match_events (match_id, ordinal);

COMMENT ON TABLE match_events IS
  'Permanent time-stamped event log promoted from pending_match_events on
   admin approval. Source of truth for "all 3 of Mohammed''s goals were
   in the 2nd half"-style stat queries on Profile + Match Detail screens.';
```

- [ ] **Step 2: Append section 4 — timing columns on parent tables**

Append to the same file:

```sql

-- ═══════════════════════════════════════════════════════════════
-- 4. Timing columns on pending_match_entries + matches
-- ═══════════════════════════════════════════════════════════════
-- All timestamp columns are nullable so legacy rows (pre-Phase-2) and
-- admin-direct submissions (which skip the ref console entirely) remain
-- valid. Stoppage seconds default to 0 (no stoppage) for the same reason.

ALTER TABLE pending_match_entries
  ADD COLUMN kickoff_at          timestamptz,
  ADD COLUMN halftime_at         timestamptz,
  ADD COLUMN fulltime_at         timestamptz,
  ADD COLUMN stoppage_h1_seconds int NOT NULL DEFAULT 0,
  ADD COLUMN stoppage_h2_seconds int NOT NULL DEFAULT 0;

ALTER TABLE matches
  ADD COLUMN kickoff_at          timestamptz,
  ADD COLUMN halftime_at         timestamptz,
  ADD COLUMN fulltime_at         timestamptz,
  ADD COLUMN stoppage_h1_seconds int,
  ADD COLUMN stoppage_h2_seconds int;
```

- [ ] **Step 3: Append section 5 — RLS policies**

Append:

```sql

-- ═══════════════════════════════════════════════════════════════
-- 5. RLS — pending events admin-only; permanent events public-read
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE pending_match_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_events         ENABLE ROW LEVEL SECURITY;

-- Admin can SELECT pending events for review. Writes flow only through
-- submit_ref_entry (anon-callable, token-gated, SECURITY DEFINER) and
-- approve_match_entry (admin SECURITY DEFINER) — no direct INSERT.
CREATE POLICY pending_events_admin_select
  ON pending_match_events
  FOR SELECT
  TO authenticated
  USING (is_admin());

-- Permanent match events visible to all authenticated users (parity with
-- match_players read access). Writes only via approve_match_entry.
CREATE POLICY match_events_authenticated_select
  ON match_events
  FOR SELECT
  TO authenticated
  USING (true);
```

- [ ] **Step 4: Append section 6 — `regenerate_ref_token` RPC**

Append:

```sql

-- ═══════════════════════════════════════════════════════════════
-- 6. regenerate_ref_token — admin token rotation
-- ═══════════════════════════════════════════════════════════════
-- Burns any active (non-consumed, non-expired) token for the matchday
-- and mints a fresh one with 6h expiry. Returns the RAW token string —
-- this is the only moment the plaintext exists; the DB only stores
-- sha256. Caller (admin UI in slice 2B-B) is responsible for showing
-- the URL once and never re-fetching it.

CREATE OR REPLACE FUNCTION regenerate_ref_token(p_matchday_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_raw_token  text;
  v_caller_id  uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM matchdays WHERE id = p_matchday_id) THEN
    RAISE EXCEPTION 'Matchday not found' USING ERRCODE = '22023';
  END IF;

  v_caller_id := current_profile_id();

  -- Burn any active tokens for this matchday.
  UPDATE ref_tokens
     SET consumed_at = now()
   WHERE matchday_id = p_matchday_id
     AND consumed_at IS NULL
     AND expires_at > now();

  -- Mint fresh raw token (24 random bytes → ~32 base64url chars).
  v_raw_token := encode(gen_random_bytes(24), 'base64');
  -- base64url-safe replacements (the encode() built-in doesn't have base64url)
  v_raw_token := replace(replace(replace(v_raw_token, '+', '-'), '/', '_'), '=', '');

  INSERT INTO ref_tokens (matchday_id, token_sha256, issued_by, expires_at, label)
  VALUES (
    p_matchday_id,
    encode(digest(v_raw_token, 'sha256'), 'hex'),
    v_caller_id,
    now() + interval '6 hours',
    'Ref link · regenerated'
  );

  PERFORM log_admin_action('matchdays', p_matchday_id, 'regenerate_ref_token', '{}'::jsonb);

  RETURN v_raw_token;
END;
$$;

GRANT EXECUTE ON FUNCTION regenerate_ref_token(uuid) TO authenticated;
```

- [ ] **Step 5: Append section 7 — extended `submit_ref_entry` (DROP + CREATE)**

Append:

```sql

-- ═══════════════════════════════════════════════════════════════
-- 7. submit_ref_entry — extended with timing + event log
-- ═══════════════════════════════════════════════════════════════
-- Signature unchanged (text + jsonb returns uuid) so DROP+CREATE is
-- not strictly required, but we drop anyway to ensure a clean rewrite
-- and to GRANT identically afterwards. Payload shape extended:
--
--   {
--     "result":         "white"|"black"|"draw",
--     "score_white":    int,
--     "score_black":    int,
--     "notes":          string|null,
--     "players": [{
--       "profile_id":    uuid|null,
--       "guest_id":      uuid|null,
--       "team":          "white"|"black",
--       "goals":         int,
--       "yellow_cards":  int,
--       "red_cards":     int,
--       "is_motm":       bool
--     }, ...],
--     "events": [{
--       "event_type":    "goal"|...,
--       "match_minute":  int,
--       "match_second":  int,
--       "team":          "white"|"black"|null,
--       "profile_id":    uuid|null,
--       "guest_id":      uuid|null,
--       "meta":          jsonb,
--       "ordinal":       int
--     }, ...],
--     "timing": {
--       "kickoff_at":           timestamptz,
--       "halftime_at":          timestamptz,
--       "fulltime_at":          timestamptz,
--       "stoppage_h1_seconds":  int,
--       "stoppage_h2_seconds":  int
--     }
--   }
--
-- Backwards-compatible: clients that omit `events` and `timing` (e.g. the
-- legacy stub or admin direct-entry path) still write valid pending rows.

DROP FUNCTION IF EXISTS submit_ref_entry(text, jsonb);

CREATE OR REPLACE FUNCTION submit_ref_entry(
  p_token   text,
  p_payload jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_token_hash  text;
  v_token_row   ref_tokens%ROWTYPE;
  v_entry_id    uuid;
  v_matchday_id uuid;
BEGIN
  v_token_hash := encode(digest(p_token, 'sha256'), 'hex');

  SELECT * INTO v_token_row
  FROM ref_tokens
  WHERE token_sha256 = v_token_hash
    AND consumed_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired ref token' USING ERRCODE = '22023';
  END IF;

  v_matchday_id := v_token_row.matchday_id;

  IF EXISTS (
    SELECT 1 FROM pending_match_entries
    WHERE submitted_by_token_id = v_token_row.id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'A pending entry already exists for this token' USING ERRCODE = '22023';
  END IF;

  INSERT INTO pending_match_entries (
    matchday_id, submitted_by_token_id, result, score_white, score_black, notes,
    kickoff_at, halftime_at, fulltime_at, stoppage_h1_seconds, stoppage_h2_seconds
  ) VALUES (
    v_matchday_id,
    v_token_row.id,
    (p_payload->>'result')::match_result,
    (p_payload->>'score_white')::int,
    (p_payload->>'score_black')::int,
    p_payload->>'notes',
    NULLIF(p_payload#>>'{timing,kickoff_at}','')::timestamptz,
    NULLIF(p_payload#>>'{timing,halftime_at}','')::timestamptz,
    NULLIF(p_payload#>>'{timing,fulltime_at}','')::timestamptz,
    COALESCE(NULLIF(p_payload#>>'{timing,stoppage_h1_seconds}','')::int, 0),
    COALESCE(NULLIF(p_payload#>>'{timing,stoppage_h2_seconds}','')::int, 0)
  ) RETURNING id INTO v_entry_id;

  -- Per-player aggregates (existing shape — unchanged).
  INSERT INTO pending_match_entry_players (
    pending_entry_id, profile_id, guest_id, team, goals, yellow_cards, red_cards, is_motm
  )
  SELECT
    v_entry_id,
    NULLIF(pl->>'profile_id', '')::uuid,
    NULLIF(pl->>'guest_id', '')::uuid,
    (pl->>'team')::team_color,
    COALESCE((pl->>'goals')::int, 0),
    COALESCE((pl->>'yellow_cards')::int, 0),
    COALESCE((pl->>'red_cards')::int, 0),
    COALESCE((pl->>'is_motm')::boolean, false)
  FROM jsonb_array_elements(p_payload->'players') pl;

  -- Event log (NEW). Skipped silently if `events` key is absent or empty.
  IF p_payload ? 'events' AND jsonb_typeof(p_payload->'events') = 'array' THEN
    INSERT INTO pending_match_events (
      pending_entry_id, event_type, match_minute, match_second,
      team, profile_id, guest_id, meta, ordinal
    )
    SELECT
      v_entry_id,
      (e->>'event_type')::match_event_type,
      (e->>'match_minute')::int,
      COALESCE((e->>'match_second')::int, 0),
      NULLIF(e->>'team','')::team_color,
      NULLIF(e->>'profile_id','')::uuid,
      NULLIF(e->>'guest_id','')::uuid,
      COALESCE(e->'meta', '{}'::jsonb),
      (e->>'ordinal')::int
    FROM jsonb_array_elements(p_payload->'events') e;
  END IF;

  -- Burn the token.
  UPDATE ref_tokens SET consumed_at = now() WHERE id = v_token_row.id;

  -- Notify admins (existing behaviour).
  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT id, 'match_entry_submitted',
    'Match entry submitted',
    'A ref has submitted the result for review.',
    jsonb_build_object('pending_entry_id', v_entry_id, 'matchday_id', v_matchday_id)
  FROM profiles WHERE role IN ('admin','super_admin') AND is_active = true;

  RETURN v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_ref_entry(text, jsonb) TO anon, authenticated;
```

- [ ] **Step 6: Append section 8 — extended `approve_match_entry`**

Append:

```sql

-- ═══════════════════════════════════════════════════════════════
-- 8. approve_match_entry — extended to copy event log + timing
-- ═══════════════════════════════════════════════════════════════
-- Same signature; rewritten body adds:
--   - copies pending_match_entries timing columns to matches
--   - copies pending_match_events rows to match_events (preserving ordinal)

DROP FUNCTION IF EXISTS approve_match_entry(uuid, jsonb);

CREATE OR REPLACE FUNCTION approve_match_entry(
  p_pending_id uuid,
  p_edits      jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pme        pending_match_entries%ROWTYPE;
  v_match_id   uuid;
  v_caller_id  uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pme FROM pending_match_entries WHERE id = p_pending_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending entry not found or already resolved' USING ERRCODE = '22023';
  END IF;

  v_caller_id := current_profile_id();

  SELECT id INTO v_match_id FROM matches WHERE matchday_id = v_pme.matchday_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No draft match found for matchday' USING ERRCODE = '22023';
  END IF;

  UPDATE matches SET
    result        = COALESCE((p_edits->>'result')::match_result, v_pme.result),
    score_white   = COALESCE((p_edits->>'score_white')::int, v_pme.score_white),
    score_black   = COALESCE((p_edits->>'score_black')::int, v_pme.score_black),
    motm_user_id  = CASE WHEN p_edits ? 'motm_user_id'
                          THEN NULLIF(p_edits->>'motm_user_id','')::uuid
                          ELSE motm_user_id END,
    motm_guest_id = CASE WHEN p_edits ? 'motm_guest_id'
                           THEN NULLIF(p_edits->>'motm_guest_id','')::uuid
                           ELSE motm_guest_id END,
    notes         = COALESCE(p_edits->>'notes', v_pme.notes),
    -- NEW: copy timing columns from pending entry (admin can override via p_edits later).
    kickoff_at          = v_pme.kickoff_at,
    halftime_at         = v_pme.halftime_at,
    fulltime_at         = v_pme.fulltime_at,
    stoppage_h1_seconds = v_pme.stoppage_h1_seconds,
    stoppage_h2_seconds = v_pme.stoppage_h2_seconds,
    approved_at = now(),
    approved_by = v_caller_id,
    updated_at  = now(),
    updated_by  = v_caller_id
  WHERE id = v_match_id;

  -- Reconcile match_players stats from pending line items (unchanged).
  UPDATE match_players mp SET
    goals        = pmep.goals,
    yellow_cards = pmep.yellow_cards,
    red_cards    = pmep.red_cards,
    updated_at   = now(),
    updated_by   = v_caller_id
  FROM pending_match_entry_players pmep
  WHERE pmep.pending_entry_id = p_pending_id
    AND mp.match_id = v_match_id
    AND (
      (pmep.profile_id IS NOT NULL AND mp.profile_id = pmep.profile_id) OR
      (pmep.guest_id   IS NOT NULL AND mp.guest_id   = pmep.guest_id)
    );

  -- NEW: copy event log to permanent match_events. Idempotent because
  -- approve_match_entry can only be called once (status flip below blocks
  -- re-entry).
  INSERT INTO match_events (
    match_id, event_type, match_minute, match_second,
    team, profile_id, guest_id, meta, ordinal
  )
  SELECT
    v_match_id, event_type, match_minute, match_second,
    team, profile_id, guest_id, meta, ordinal
  FROM pending_match_events
  WHERE pending_entry_id = p_pending_id
  ORDER BY ordinal;

  UPDATE pending_match_entries SET
    status = 'approved', approved_at = now(), approved_by = v_caller_id
  WHERE id = p_pending_id;

  PERFORM log_admin_action('matches', v_match_id, 'approve_match_entry',
    jsonb_build_object('pending_id', p_pending_id));

  -- Fan-out approval notifications (unchanged).
  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT id, 'match_entry_approved',
    'Match result approved',
    'The match result has been confirmed.',
    jsonb_build_object('match_id', v_match_id)
  FROM profiles WHERE is_active = true;

  RETURN v_match_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_match_entry(uuid, jsonb) TO authenticated;

COMMIT;
```

- [ ] **Step 7: Verify file is syntactically well-formed (line count + end-marker check)**

Run:
```bash
wc -l "supabase/migrations/0028_phase2b_match_events.sql"
tail -3 "supabase/migrations/0028_phase2b_match_events.sql"
```

Expected: ~290–320 lines. Last line should be `COMMIT;`. If not, the file is incomplete — re-do the section assembly.

- [ ] **Step 8: Patch the design spec to reflect actual migration number (0028)**

Run:
```bash
grep -n "0029_phase2b_match_events\|Migration 0029" "docs/superpowers/specs/2026-04-26-phase2-design.md" | head
```

Then for each match, change `0029` → `0028` and `Migration 0029` → `Migration 0028`. Use the Edit tool with each unique context. Expected: 2–4 occurrences in §B.3.

- [ ] **Step 9: Commit migration file + spec patch**

```bash
git add supabase/migrations/0028_phase2b_match_events.sql docs/superpowers/specs/2026-04-26-phase2-design.md
git commit -m "feat(s040,2b-a): migration 0028 — pending_match_events + match_events tables + RPC extensions

Authors the Phase 2B backend foundation. Not yet applied to live DB
(separate task in this slice). Spec updated to reflect 0028 numbering
(was speculatively documented as 0029 before build-order locked).

- match_event_type enum (8 values)
- pending_match_events + match_events tables (mirror shape)
- timing columns on pending_match_entries + matches (nullable for back-compat)
- RLS: admin-select on pending; public read on permanent
- regenerate_ref_token admin RPC (returns raw token, never persisted)
- submit_ref_entry rewritten to accept events + timing payload keys
- approve_match_entry rewritten to copy events + timing on promotion"
```

---

## Task 3 — Apply migration to live Supabase + verify schema (10 min)

**Files:** none modified (writes to live DB only).

- [ ] **Step 1: Push the migration**

Run:
```bash
npx --yes supabase@latest db push --linked
```

Expected output ending:
```
Applying migration 20...0028_phase2b_match_events.sql
Local database is up to date.
```

(Supabase CLI prefixes with timestamp on push; the body includes our filename.)

If apply fails: read the error carefully. Common failures:
- `type "match_event_type" already exists` → a prior partial apply happened. Need to `DROP TYPE` first manually then re-apply.
- `relation "pending_match_entries" does not exist` → 0008 wasn't applied. Should never happen on live; check `schema_migrations` table.

If apply succeeds, continue.

- [ ] **Step 2: Verify the new tables exist**

```bash
npx --yes supabase@latest db query --linked "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('pending_match_events','match_events')"
```

Expected:
```
count
2
```

- [ ] **Step 3: Verify the enum exists with all 8 values**

```bash
npx --yes supabase@latest db query --linked "SELECT enumlabel FROM pg_enum WHERE enumtypid = 'match_event_type'::regtype ORDER BY enumsortorder"
```

Expected (in order):
```
enumlabel
goal
own_goal
yellow_card
red_card
halftime
fulltime
pause
resume
```

- [ ] **Step 4: Verify timing columns landed on both tables**

```bash
npx --yes supabase@latest db query --linked "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('kickoff_at','halftime_at','fulltime_at','stoppage_h1_seconds','stoppage_h2_seconds') ORDER BY table_name, column_name"
```

Expected: 10 rows — 5 columns × 2 tables (`matches` and `pending_match_entries`).

- [ ] **Step 5: Verify the new RPC exists with correct signature**

```bash
npx --yes supabase@latest db query --linked "SELECT proname, pg_get_function_arguments(oid), pg_get_function_result(oid) FROM pg_proc WHERE proname = 'regenerate_ref_token'"
```

Expected:
```
proname                | pg_get_function_arguments | pg_get_function_result
regenerate_ref_token   | p_matchday_id uuid        | text
```

- [ ] **Step 6: Verify the rewritten RPCs still exist (didn't drop without recreating)**

```bash
npx --yes supabase@latest db query --linked "SELECT proname, pg_get_function_arguments(oid) FROM pg_proc WHERE proname IN ('submit_ref_entry','approve_match_entry') ORDER BY proname"
```

Expected:
```
proname              | pg_get_function_arguments
approve_match_entry  | p_pending_id uuid, p_edits jsonb DEFAULT '{}'::jsonb
submit_ref_entry     | p_token text, p_payload jsonb
```

- [ ] **Step 7: Verify schema_migrations row landed**

```bash
npx --yes supabase@latest db query --linked "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3"
```

Expected: top row matches the timestamp prefix the CLI assigned to `0028`. (E.g. `20260426120000` style. Exact value depends on push time; what matters is that 0028 is the highest.)

- [ ] **Step 8: Smoke-test `regenerate_ref_token` (read-only — does not consume)**

This is a real call but only writes a `ref_tokens` row + audit log. Pick an existing matchday id:

```bash
npx --yes supabase@latest db query --linked "SELECT id FROM matchdays ORDER BY kickoff_at DESC LIMIT 1"
```

Copy the returned uuid. Then call the function via the dashboard SQL editor (CLI can't easily run `SECURITY DEFINER` as admin without auth). Or skip this step and defer to slice 2B-B integration test.

If you want to call it from CLI: requires JWT for an admin user — skip unless you have one cached.

---

## Task 4 — Regenerate types + verify build + commit + push (10 min)

**Files:**
- Overwrite: `ffc/src/lib/database.types.ts`
- Edit: `tasks/todo.md` (close-out section append)

- [ ] **Step 1: Regenerate TypeScript types from live schema**

Run from the repo root (NOT from `ffc/`; the `--linked` works from anywhere when project is linked):

```bash
npx --yes supabase@latest gen types typescript --linked 2>/dev/null > "ffc/src/lib/database.types.ts"
```

Note the `2>/dev/null` — mandatory per CLAUDE.md ("Initialising login role..." diagnostic goes to stdout and corrupts the types file without it).

Expected: file overwritten silently. Verify:
```bash
wc -l "ffc/src/lib/database.types.ts"
```
Expected: ~1990–2100 lines (was 1916 at S027 close, +tables +columns +RPC).

- [ ] **Step 2: Sanity-check the types file has the new shapes**

```bash
grep -n "pending_match_events\|match_events:\|regenerate_ref_token\|match_event_type" "ffc/src/lib/database.types.ts" | head -10
```

Expected: at least 6–8 hits — table types, RPC type, enum union.

- [ ] **Step 3: tsc-build verification**

```bash
cd "C:/Users/User/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC/ffc" && node ./node_modules/typescript/bin/tsc -b
```

Expected: EXIT 0, no output (or just info lines). If errors appear, they'll be `Property 'X' does not exist on type 'Y'` — usually means a callsite is referencing the OLD function signature. None expected for slice 2B-A because the only code that calls these RPCs (`AdminMatches.tsx` → `approve_match_entry`) uses positional args that haven't changed.

- [ ] **Step 4: vite-build verification**

```bash
cd "C:/Users/User/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC/ffc" && node ./node_modules/vite/bin/vite.js build 2>&1 | tail -5
```

Expected: ends with `✓ built in <ms>ms` and `PWA v1.2.0 / precache N entries / NNNN.NN KiB`. PWA size should be roughly the same as 1487 KiB at S038 close — the types file is not bundled into the runtime.

- [ ] **Step 5: Append S040 close-out to tasks/todo.md**

Open `tasks/todo.md`. Insert a new section above "Completed in S038" matching the pattern of prior session close-outs:

```markdown
## Completed in S040 (DD/APR/2026, Home PC)

### Slice 2B-A — Live Match Console backend foundation

- [x] **Migration 0028 `0028_phase2b_match_events.sql`** authored and applied to live DB.
  - `match_event_type` enum (8 values: goal · own_goal · yellow_card · red_card · halftime · fulltime · pause · resume).
  - `pending_match_events` + `match_events` tables with participant XOR + minute/second checks, ordinal index.
  - 5 timing columns added to `pending_match_entries` + `matches` (nullable; default 0 stoppage).
  - RLS: pending events admin-select; permanent events authenticated-select-true.
  - `regenerate_ref_token(matchday_id)` admin RPC — burns active tokens, mints fresh 6h, returns raw base64url string.
  - `submit_ref_entry` rewritten (DROP+CREATE) to read `events` and `timing` payload keys; backwards-compatible.
  - `approve_match_entry` rewritten to copy event log + timing to permanent `match_events` + `matches` on promotion.
- [x] Types regenerated: `ffc/src/lib/database.types.ts` (~XXXX lines, was 1916).
- [x] Build clean: tsc -b EXIT 0 + vite build EXIT 0.
- [x] No UI changes — `RefEntry.tsx` still stub (slice 2B-B opens that work).
- [x] **Migrations on live DB: 28 (0001 → 0028).**

### S040 gotchas / lessons (additive)

- **Migration number renumber pattern.** Spec was authored with 0029 for Phase 2B because the spec writer didn't know build-order at writing time. Build-order was locked AFTER the spec, putting Track 2B before 2A. Resolved by claiming 0028 and patching the spec inline. Pattern: when a spec hardcodes a migration number, confirm build-order before applying.
- **`gen_random_bytes` + base64url.** Postgres `encode(..., 'base64')` produces base64 with `+`, `/`, `=`. For URL-safe tokens, three `replace()` calls turn it into base64url. (`gen_random_uuid()` would have been simpler but produces 36 chars including hyphens — base64url 24-byte gives ~32 chars and feels more like a token.)
- **`DROP FUNCTION IF EXISTS` before `CREATE OR REPLACE` for rewrites.** Even when signature is unchanged, dropping first ensures no shadow function sticks around if the param defaults change in a future revision. Costs a microsecond at apply time, removes a class of bugs.
```

Replace `DD` with the actual day, `XXXX` with the wc -l result from Step 1.

- [ ] **Step 6: Commit and push**

```bash
cd "C:/Users/User/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC"
git add ffc/src/lib/database.types.ts tasks/todo.md
git commit -m "feat(s040,2b-a): apply migration 0028 to live + regenerate types + S040 close-out

- Migration 0028 applied (pending_match_events + match_events + timing
  columns + regenerate_ref_token RPC + extended submit/approve).
- TypeScript types regenerated from live schema.
- Build clean: tsc -b EXIT 0; vite build EXIT 0.
- Migrations on live DB: 28."
git push
```

Expected push output:
```
To https://github.com/mmuwahid/FFC.git
   1d3f78e..<new-sha>  main -> main
```

---

## Acceptance criteria — Slice 2B-A

After Task 4 is complete, all the following should hold:

- [ ] `0028_phase2b_match_events.sql` exists in `supabase/migrations/`, ~290–320 lines, ends with `COMMIT;`.
- [ ] `npx supabase db query --linked "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('pending_match_events','match_events')"` returns 2.
- [ ] `match_event_type` enum has all 8 values (verified in Task 3 Step 3).
- [ ] `regenerate_ref_token` RPC exists (verified in Task 3 Step 5).
- [ ] `submit_ref_entry` and `approve_match_entry` still exist with original signatures (verified in Task 3 Step 6).
- [ ] `database.types.ts` references `pending_match_events`, `match_events`, `regenerate_ref_token`, and `match_event_type`.
- [ ] `tsc -b` exits 0.
- [ ] `vite build` succeeds (PWA size unchanged ±10 KiB).
- [ ] No `*.tsx` source files were modified — UI stays at S039 state.
- [ ] `git log --oneline -3` on `main` shows the two slice-2B-A commits as the top entries.
- [ ] `migrations on live DB: 28` line lands in CLAUDE.md status header (handled at session close, not in this plan).

---

## Out of scope for Slice 2B-A (deferred to later slices)

- Admin UI button "Generate ref link" → slice 2B-B.
- RefEntry.tsx implementation (the actual ref console UI) → slices 2B-C through 2B-E.
- Admin review screen `/admin/match-entries/:id` → slice 2B-F.
- Phase 2A push notifications, auto-lock, captain auto-pick → slices 2A-A through 2A-E.
- VAPID key generation → slice 2A-B.
- Edge Function `notify-dispatch` → slice 2A-C.

---

## Risks + recovery

| Risk | Mitigation |
|---|---|
| Migration apply fails partway through (e.g. CHECK violation on existing data) | Wrap entire migration in BEGIN/COMMIT (already done). On failure, full rollback. Re-author the constraint if real data violates it. |
| Types regeneration produces broken types | The `2>/dev/null` redirect prevents stdout corruption. If types still look wrong, re-run from a clean shell and inspect `head -5 ffc/src/lib/database.types.ts` — must start with `export type Json =`. |
| `tsc -b` fails on a callsite using old RPC shape | None expected — payload shape is additive, not breaking. If it does fail, the failing callsite needs an explicit `as any` cast (temp) and a follow-up issue logged. |
| `regenerate_ref_token` errors at first call from admin UI (slice 2B-B) | Slice 2B-A doesn't exercise this RPC live. Defer to 2B-B integration test. |

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-26-phase2-slice-2B-A.md`.**
