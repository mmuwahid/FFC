# FFC Phase 2 — Design Spec

**Authoritative for:** Phase 2 implementation kickoff and acceptance.
**Companion docs:**
- `planning/FFC-masterplan-V3.0.md` (high-level roadmap, slice ordering, risks)
- `mockups/3-4-v2-ref-console.html` (Track 2B UX, 5 states)
- `docs/superpowers/specs/2026-04-17-ffc-phase1-design.md` §3.4 (V1 ref-entry spec — V2 layered on top)
- `docs/ui-conventions.md` (date format DD/MMM/YYYY, safe-area, palette)

**Date:** 26 / APR / 2026
**Status:** Approved by user 26/APR/2026 (S039) for implementation. No further design iteration required before plan-write.

---

## A — Track 2A: Poll → Lock → Captain automation

### A.1 — Push notification delivery (foundation)

The frontend already writes `profiles.push_prefs` and the backend already inserts `notifications` rows. Phase 2A wires the missing delivery layer end-to-end.

#### A.1.1 — Web Push subscription lifecycle

**Subscription start.** When a user toggles the master pill `Push notifications → ON` in `/settings`:

1. Client requests `Notification.requestPermission()`. If denied → master flips back OFF, persistent denied-state tile shown (S024 already does this).
2. Client subscribes the active service worker via `swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })`. VAPID public key shipped as a Vite env var.
3. Client persists the resulting `PushSubscription.toJSON()` to a new table `push_subscriptions`:

```sql
CREATE TABLE push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint        text NOT NULL,
  p256dh          text NOT NULL,  -- public key from PushSubscription.keys
  auth            text NOT NULL,  -- shared secret from PushSubscription.keys
  user_agent      text,           -- captured at subscribe time for diagnostics
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, endpoint)
);

CREATE INDEX push_subscriptions_profile_idx ON push_subscriptions (profile_id);
```

A profile may have multiple subscriptions (one per device). The `(profile_id, endpoint)` UNIQUE prevents duplicates from a single device re-subscribing.

**Subscription teardown.** Master pill `OFF` calls `pushSubscription.unsubscribe()` and DELETEs the matching row. Browser-driven invalidation (e.g. user clears site data) is handled at delivery time — see A.1.3.

#### A.1.2 — `notify-dispatch` Edge Function

A new Supabase Edge Function consumes notification rows and fans out Web Push. Two trigger options; we ship both:

1. **Postgres trigger** (preferred for low latency): `AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION pg_net.http_post(...)` — Supabase's `pg_net` extension fires an HTTP POST to the Edge Function URL with the row payload. Sub-second delivery.
2. **Polling fallback** (resilience): a pg_cron job runs every 30 s, queries `notifications WHERE delivered_at IS NULL`, posts each to the Edge Function. Catches any rows missed by the trigger (e.g. during pg_net outages).

The function:

```typescript
// supabase/functions/notify-dispatch/index.ts (sketch)
serve(async (req) => {
  const { record } = await req.json()  // single notification row
  const subs = await pg.from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('profile_id', record.recipient_id)

  await Promise.allSettled(subs.data.map(sub =>
    webPush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({
        title: record.title,
        body: record.body,
        kind: record.kind,
        payload: record.payload,
      }),
      { vapidDetails: { subject: 'mailto:m.muwahid@gmail.com', publicKey, privateKey }, TTL: 3600 }
    ).catch(err => handleDeliveryError(err, sub.endpoint))
  ))

  // Mark delivered after fan-out (best-effort).
  await pg.from('notifications').update({ delivered_at: new Date().toISOString() }).eq('id', record.id)
})
```

**Delivery error handling (A.1.3).** If `webPush.sendNotification` returns `410 Gone` (subscription expired) or `404`, DELETE the row from `push_subscriptions`. Other errors are logged but not retried — the polling job will pick the row back up if `delivered_at` was never set.

#### A.1.4 — Service worker push handler

`ffc/public/sw.js` (or whatever the PWA plugin generates) extends the existing service worker:

```javascript
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/ffc-logo-192.png',
    badge: '/ffc-logo-32.png',
    tag: data.kind,           // collapses repeated reminders
    data: { url: data.payload?.deeplink ?? '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.openWindow(event.notification.data.url))
})
```

Per-kind deep-link payloads: `vote_reminder → /poll`, `roster_locked → /poll`, `dropout_after_lock → /matchday/:id/captains`, `result_posted → /match/:id`, etc.

#### A.1.5 — Notifications table extension

Add `delivered_at timestamptz NULL` to `notifications`. Used by the polling fallback to avoid double-delivery; also gives admin diagnostics.

```sql
ALTER TABLE notifications ADD COLUMN delivered_at timestamptz;
CREATE INDEX notifications_undelivered_idx ON notifications (created_at) WHERE delivered_at IS NULL;
```

---

### A.2 — Vote-reminder schedule

A pg_cron job runs every 5 minutes, finds matchdays in `voting_open` state, and for each computes whether reminder windows have crossed (T-24h, T-3h, T-15min before `lock_at`).

For each non-voter (any `profiles` row with `is_active=true` and no `poll_votes` row for this matchday), insert a `vote_reminder` notification with payload `{matchday_id, reminder_kind: '24h' | '3h' | '15m'}`. The notification dispatcher (A.1) handles the rest.

**Idempotency:** add a unique constraint `(recipient_id, kind, payload->>'matchday_id', payload->>'reminder_kind')` on a partial index where `kind = 'vote_reminder'` so re-runs of the cron don't double-send.

```sql
CREATE UNIQUE INDEX vote_reminder_unique_idx
  ON notifications (recipient_id, kind, (payload->>'matchday_id'), (payload->>'reminder_kind'))
  WHERE kind = 'vote_reminder';
```

`app_settings` rows added:
- `vote_reminder_24h_enabled` (boolean, default true)
- `vote_reminder_3h_enabled` (boolean, default true)
- `vote_reminder_15m_enabled` (boolean, default true)

---

### A.3 — Auto-lock at deadline

New RPC `auto_lock_matchday(p_matchday_id uuid)`:

```sql
CREATE OR REPLACE FUNCTION auto_lock_matchday(p_matchday_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_md        matchdays%ROWTYPE;
  v_cap       int;
BEGIN
  SELECT * INTO v_md FROM matchdays WHERE id = p_matchday_id FOR UPDATE;
  IF v_md.roster_locked_at IS NOT NULL THEN RETURN; END IF;  -- already locked

  v_cap := roster_cap(effective_format(p_matchday_id));

  UPDATE matchdays SET
    roster_locked_at = now(),
    roster_locked_by = NULL  -- NULL signifies system-locked
  WHERE id = p_matchday_id;

  -- Fire roster_locked notifications for every voter (confirmed + waitlist).
  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT
    pv.profile_id,
    'roster_locked',
    'Roster locked',
    CASE
      WHEN ROW_NUMBER() OVER (ORDER BY pv.committed_at) <= v_cap
        THEN 'You''re in for ' || to_char(v_md.kickoff_at, 'Dy DD/Mon')
      ELSE 'You''re on the waitlist (#' || (ROW_NUMBER() OVER (ORDER BY pv.committed_at) - v_cap) || ')'
    END,
    jsonb_build_object('matchday_id', p_matchday_id, 'kickoff_at', v_md.kickoff_at)
  FROM poll_votes pv
  WHERE pv.matchday_id = p_matchday_id
    AND pv.vote = 'yes'
    AND pv.cancelled_at IS NULL;

  -- Auto-pick captains if app_settings says so.
  IF (SELECT (value::jsonb)->>'enabled' FROM app_settings WHERE key = 'auto_pick_captains')::boolean THEN
    PERFORM auto_pick_captains_on_lock(p_matchday_id);
  END IF;

  PERFORM log_admin_action('matchdays', p_matchday_id, 'auto_lock_matchday', '{}'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION auto_lock_matchday(uuid) TO service_role;
```

**Cron trigger.** A pg_cron job runs every minute looking for `matchdays WHERE lock_at <= now() AND roster_locked_at IS NULL`. For each, calls `auto_lock_matchday`.

**Override.** Admin can still manually `set_roster_lock` from `/admin/matches`. The RPC's idempotent `IF roster_locked_at IS NOT NULL THEN RETURN` guards against races.

---

### A.4 — Captain auto-pick on lock

New RPC `auto_pick_captains_on_lock(p_matchday_id uuid)` called from `auto_lock_matchday` when the setting is ON:

```sql
CREATE OR REPLACE FUNCTION auto_pick_captains_on_lock(p_matchday_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pair record;
BEGIN
  -- Use the existing suggest_captain_pairs RPC; take the top suggestion.
  SELECT white_profile_id, black_profile_id
    INTO v_pair
    FROM suggest_captain_pairs(p_matchday_id)
    ORDER BY balance_score ASC LIMIT 1;

  IF v_pair IS NULL THEN RETURN; END IF;  -- not enough eligible captains

  PERFORM set_matchday_captains(p_matchday_id, v_pair.white_profile_id, v_pair.black_profile_id);

  -- Notify both captains.
  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  VALUES
    (v_pair.white_profile_id, 'captain_assigned',
      'You''re White captain', 'Tap to plan formation.',
      jsonb_build_object('matchday_id', p_matchday_id, 'team', 'white')),
    (v_pair.black_profile_id, 'captain_assigned',
      'You''re Black captain', 'Tap to plan formation.',
      jsonb_build_object('matchday_id', p_matchday_id, 'team', 'black'));

  -- Notify admins with one-tap override deeplink.
  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT id, 'captain_auto_picked',
    'Captains auto-picked',
    (SELECT display_name FROM profiles WHERE id = v_pair.white_profile_id) || ' (W) · ' ||
    (SELECT display_name FROM profiles WHERE id = v_pair.black_profile_id) || ' (B). Tap to override.',
    jsonb_build_object('matchday_id', p_matchday_id, 'deeplink', '/matchday/' || p_matchday_id || '/captains')
  FROM profiles WHERE role IN ('admin', 'super_admin');
END;
$$;
GRANT EXECUTE ON FUNCTION auto_pick_captains_on_lock(uuid) TO service_role;
```

**`captain_assigned` and `captain_auto_picked`** are new `notification_kind` enum values added in migration 0028.

**Captain Helper screen extension.** When opened post-auto-pick, the existing pair card shows an "AUTO-PICKED" gold pill next to the pair, and the top of the screen has a one-line banner: "Auto-picked at lock. Roll again to reroll." The `Roll` button already exists; tapping it calls `pick_captains_random` and updates via `set_matchday_captains`.

---

### A.5 — Dropout-after-lock real-time flow

#### A.5.1 — `cancel_my_vote` extension

The existing `cancel_my_vote` RPC handles pre-lock cancels. Add a branch for post-lock:

```sql
-- Existing logic for pre-lock case unchanged.
IF v_md.roster_locked_at IS NOT NULL THEN
  -- Insert dropout_after_lock notification to admins + both captains.
  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT
    p.id,
    'dropout_after_lock',
    'Roster dropout',
    (SELECT display_name FROM profiles WHERE id = v_caller_profile) || ' cancelled. Promote from waitlist?',
    jsonb_build_object(
      'matchday_id', v_md.id,
      'cancelled_profile_id', v_caller_profile,
      'was_captain', (SELECT bool_or(is_captain) FROM match_players WHERE matchday_id = v_md.id AND profile_id = v_caller_profile),
      'deeplink', '/matchday/' || v_md.id || '/captains'
    )
  FROM profiles p
  WHERE p.role IN ('admin', 'super_admin')
     OR p.id IN (SELECT white_captain_id FROM matchdays WHERE id = v_md.id)
     OR p.id IN (SELECT black_captain_id FROM matchdays WHERE id = v_md.id);
END IF;
```

#### A.5.2 — `promote_from_waitlist` RPC

```sql
CREATE OR REPLACE FUNCTION promote_from_waitlist(p_matchday_id uuid)
RETURNS uuid  -- returns promoted profile_id
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cap        int;
  v_promote_id uuid;
  v_caller_id  uuid;
BEGIN
  IF NOT is_admin() AND NOT is_captain_of(p_matchday_id) THEN
    RAISE EXCEPTION 'Only admin or captain may promote' USING ERRCODE = '42501';
  END IF;

  v_cap := roster_cap(effective_format(p_matchday_id));
  v_caller_id := current_profile_id();

  -- Find first waitlisted player by committed_at order.
  WITH ordered AS (
    SELECT pv.profile_id, ROW_NUMBER() OVER (ORDER BY pv.committed_at) AS pos
    FROM poll_votes pv
    WHERE pv.matchday_id = p_matchday_id
      AND pv.vote = 'yes'
      AND pv.cancelled_at IS NULL
  )
  SELECT profile_id INTO v_promote_id FROM ordered WHERE pos = v_cap + 1;

  IF v_promote_id IS NULL THEN
    RAISE EXCEPTION 'No waitlisted players to promote' USING ERRCODE = 'FFC_NO_WAITLIST';
  END IF;

  -- Push to promoted player.
  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  VALUES (v_promote_id, 'you_are_in',
    'You''re in!',
    'A confirmed player dropped — you''re on for Thursday.',
    jsonb_build_object('matchday_id', p_matchday_id));

  PERFORM log_admin_action('matchdays', p_matchday_id, 'promote_from_waitlist',
    jsonb_build_object('promoted_profile_id', v_promote_id));

  RETURN v_promote_id;
END;
$$;
GRANT EXECUTE ON FUNCTION promote_from_waitlist(uuid) TO authenticated;
```

#### A.5.3 — Captain Helper banner UI

When a `dropout_after_lock` notification arrives via realtime (the Captain Helper screen subscribes to `notifications` filtered by recipient_id), an amber banner inserts above the candidate list.

**Pre-req:** `notifications` table must be added to the `supabase_realtime` publication. Per CLAUDE.md S030 lesson: `ALTER PUBLICATION supabase_realtime ADD TABLE notifications` — verify via `pg_publication_tables` before wiring `postgres_changes`. This ALTER lives in migration 0028.

```
┌─────────────────────────────────────────────┐
│ ⚠ Mohammed cancelled · 2 min ago            │
│ [ PROMOTE FROM WAITLIST ]    [ Dismiss ]    │
└─────────────────────────────────────────────┘
```

`PROMOTE FROM WAITLIST` calls `promote_from_waitlist(matchday_id)` → success toast: "Karim promoted." `Dismiss` clears the banner locally (admin can still act later from `/admin/matches`).

If `was_captain = true` in the payload, the banner reads:
```
⚠ Mohammed (W captain) cancelled · 2 min ago
[ ROLL FOR NEW W CAPTAIN ]    [ Dismiss ]
```
The button calls the existing `accept_substitute` / `request_reroll` flow shipped in S037.

---

### A.6 — Migration 0028 summary

```sql
-- 0028_phase2a_automation.sql

-- 1. notification_kind enum extension
ALTER TYPE notification_kind ADD VALUE 'vote_reminder';
ALTER TYPE notification_kind ADD VALUE 'dropout_after_lock';
ALTER TYPE notification_kind ADD VALUE 'captain_auto_picked';
ALTER TYPE notification_kind ADD VALUE 'captain_assigned';
ALTER TYPE notification_kind ADD VALUE 'you_are_in';

-- 2. notifications.delivered_at + index
ALTER TABLE notifications ADD COLUMN delivered_at timestamptz;
CREATE INDEX notifications_undelivered_idx ON notifications (created_at) WHERE delivered_at IS NULL;
CREATE UNIQUE INDEX vote_reminder_unique_idx
  ON notifications (recipient_id, kind, (payload->>'matchday_id'), (payload->>'reminder_kind'))
  WHERE kind = 'vote_reminder';

-- 3. push_subscriptions table (full DDL above in A.1.1)

-- 4. RPCs: auto_lock_matchday, auto_pick_captains_on_lock, promote_from_waitlist
--    (full bodies above in A.3, A.4, A.5.2)

-- 5. cancel_my_vote extension for post-lock branch (A.5.1)

-- 6. app_settings rows
INSERT INTO app_settings (key, value) VALUES
  ('auto_pick_captains', '{"enabled": true}'),
  ('vote_reminder_24h_enabled', '{"enabled": true}'),
  ('vote_reminder_3h_enabled', '{"enabled": true}'),
  ('vote_reminder_15m_enabled', '{"enabled": true}');

-- 7. realtime publication for notifications (per S030 lesson)
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- 8. pg_cron jobs
SELECT cron.schedule('vote-reminders', '*/5 * * * *', $$SELECT enqueue_vote_reminders()$$);
SELECT cron.schedule('auto-lock-matchdays', '* * * * *', $$
  SELECT auto_lock_matchday(id) FROM matchdays WHERE lock_at <= now() AND roster_locked_at IS NULL
$$);

-- 9. enqueue_vote_reminders helper (computes T-24h / T-3h / T-15m windows
--    and inserts vote_reminder notifications; relies on the unique index for idempotency)
```

---

## B — Track 2B: Live Match Console (§3.4-v2)

The mockup `mockups/3-4-v2-ref-console.html` is the visual source of truth. This section documents data + behaviour.

### B.1 — Architecture overview

| Layer | Where | Responsibility |
|---|---|---|
| **Token URL** | `/ref/:token` (public, no auth) | Single entry point; opens the three-mode console. |
| **Client state machine** | `RefEntry.tsx` + `useMatchClock` hook | Pre-match → Live → Halftime → Live → Post-match. Authoritative match clock + event log. |
| **Local persistence** | `localStorage` keyed by token sha256 | Survives backgrounding, accidental tab close, network drops. |
| **Submit endpoint** | `submit_ref_entry` RPC (extended) | One round-trip on full-time submit. Anonymous, token-validated. |
| **Admin review** | `/admin/match-entries/:id` (new screen) | Pre-fills approve flow with submitted data + event log. |
| **Promotion** | `approve_match_entry` (extended) | Copies event log to permanent `match_events` on approval. |

### B.2 — Three modes

#### Pre-match (mockup state 1)
- Token URL fetches matchday + locked rosters via `get_ref_matchday(token)` (new anon RPC; takes raw token, validates `sha256(token) = ref_tokens.token_sha256`, returns matchday+rosters or 410).
- Renders both team rosters. Captain marked with `(C)`.
- KICK OFF button — large, gold, bottom-anchored.
- On tap: `wakeLock = await navigator.wakeLock.request('screen')`, persist `kickoff_started_at = now()` to `localStorage`, transition to Live mode.

#### Live mode (mockup state 2 + 3)

**Match clock.**
- 1st half: counts up `0:00 → 35:00` (configurable per format via `app_settings.match_half_minutes_7v7` / `_5v5`, default 35 / 25).
- At 35:00, accumulated stoppage is added: clock continues `35:00 → 35:38` etc. while a "+0:38" stoppage chip pulses.
- HALFTIME prompt fires when ref taps "End 1st half" (always available) OR auto-prompts when stoppage exceeds `app_settings.max_stoppage_seconds` (default 180 s).
- 2nd half: counts up `35:00 → 70:00` from the saved-end of 1st half + break.
- FULL TIME prompt fires similarly.

**Hook signature:**
```typescript
function useMatchClock(token: string): {
  half: 1 | 2 | 'break'
  elapsedMs: number              // since kickoff or 2nd-half start
  stoppageMs: number             // accumulated while paused
  isPaused: boolean
  matchMinute: string            // formatted "M'" or "M+S'" for stoppage events
  pause(reason?: string): void
  resume(): void
  endHalf(): void                // ref-triggered
  startSecondHalf(): void
  endMatch(): void
}
```

State persists to `localStorage[`ffc_ref_${token}`]` on every state change. On mount, hook hydrates from storage if a session exists.

**Score block.**
- Tapping a colour cell opens the **scorer picker sheet** (mockup state 3).
- Picker is filtered to that team's roster (profiles + guests).
- Tap player → optimistic `events.push({type: 'goal', match_minute, participant_id, team})`, score increments by 1.
- "OWN GOAL" inline hint: tapping the OPPOSITE side picker for the OWN GOAL is an explicit affordance (the picker title flips to "Who put it in their own net?" when own-goal toggle pressed pre-pick).

**Pause/Resume.**
- PAUSE: clock freezes, screen flashes amber, optional "Why?" shortcut chips (`Foul · Injury · Ref decision · Other`). Reason is logged to `events` as `{type: 'pause', reason}` but doesn't persist beyond client.
- RESUME: clock unfreezes; pause duration adds to `stoppageMs`.

**Cards.**
- CARD button → opens player picker (both teams).
- Pick → second sheet "Yellow / Red / Cancel".
- Yellow: `events.push({type: 'yellow', match_minute, participant_id, team})`.
- Red: same with `type: 'red'`. Optional follow-up "Player is sent off" toggle (no in-match consequence — recorded only).

**Undo last.**
- A 15-second undo window starts from event commit (i.e. when the picker sheet closes for goal/card events; immediately for pause/resume). Tap "↺ UNDO LAST" → pops the last event, reverts score if applicable.
- After 15 s the option greys out for that event; ref can still edit in post-match summary.
- The undo window is purely client-side; nothing has been submitted to the server yet at this stage.

**MOTM.**
- "⭐ SET MOTM" button opens the combined-roster picker; selection is persisted in client state but doesn't fire an event.
- MOTM can be changed any time before submit.

#### Halftime break (mockup state 4)
- 5-minute countdown (configurable in `app_settings.halftime_break_seconds`, default 300).
- "⏭ SKIP BREAK" — ref-triggered second-half start.
- "+ ADD MIN" — bumps the break clock by 60 s.
- Score visible but greyed.

#### Post-match summary (mockup state 5)
- Final score row with winner highlight.
- Compact event log with all goals/cards/pauses (chronological).
- MOTM row.
- "✎ Edit event log" → opens an editable list view; ref can correct typos before submit.
- SUBMIT TO ADMIN — calls extended `submit_ref_entry`.

### B.3 — Migration 0028

```sql
-- 0028_phase2b_match_events.sql

-- 1. notification_kind extension
ALTER TYPE notification_kind ADD VALUE 'ref_submitted';

-- 2. event_type enum (new)
CREATE TYPE match_event_type AS ENUM (
  'goal', 'own_goal', 'yellow_card', 'red_card',
  'halftime', 'fulltime', 'pause', 'resume'
);

-- 3. pending_match_events
--
-- Match-minute encoding: continuous count from kickoff in WHOLE MINUTES.
-- The clock counts 0..35 in the first half. Stoppage minutes 35+ are still
-- stored as 35, 36, 37 (continuous count); the "+N" stoppage notation
-- ("35+1") is rendered client-side by comparing match_minute against the
-- regulation half length from `app_settings.match_half_minutes_<format>`.
-- Second half: minutes 35..70 (or whatever the configured half length × 2).
-- This means renderer needs `match_half_minutes_<format>` to know where the
-- "+N" boundary falls; small price for storage simplicity.
CREATE TABLE pending_match_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_entry_id    uuid NOT NULL REFERENCES pending_match_entries(id) ON DELETE CASCADE,
  event_type          match_event_type NOT NULL,
  match_minute        int NOT NULL,        -- continuous minutes from kickoff (see encoding note above)
  match_second        int NOT NULL,        -- second within minute, for sub-minute precision
  team                team_color,          -- nullable for non-team events (halftime, fulltime)
  profile_id          uuid REFERENCES profiles(id),
  guest_id            uuid REFERENCES match_guests(id),
  meta                jsonb NOT NULL DEFAULT '{}'::jsonb,  -- e.g. {pause_reason: 'foul'} or {own_goal_for: 'white'}
  ordinal             int NOT NULL,        -- monotonic sequence for stable replay order
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pending_event_participant_xor CHECK (
    (event_type IN ('halftime', 'fulltime', 'pause', 'resume') AND profile_id IS NULL AND guest_id IS NULL)
    OR (event_type NOT IN ('halftime', 'fulltime', 'pause', 'resume') AND (profile_id IS NOT NULL OR guest_id IS NOT NULL))
  )
);
CREATE INDEX pending_events_entry_idx ON pending_match_events (pending_entry_id, ordinal);

-- 4. pending_match_entries timing extension
ALTER TABLE pending_match_entries ADD COLUMN kickoff_at timestamptz;
ALTER TABLE pending_match_entries ADD COLUMN halftime_at timestamptz;
ALTER TABLE pending_match_entries ADD COLUMN fulltime_at timestamptz;
ALTER TABLE pending_match_entries ADD COLUMN stoppage_h1_seconds int DEFAULT 0;
ALTER TABLE pending_match_entries ADD COLUMN stoppage_h2_seconds int DEFAULT 0;

-- 5. permanent match_events (post-promotion)
CREATE TABLE match_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id            uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  event_type          match_event_type NOT NULL,
  match_minute        int NOT NULL,
  match_second        int NOT NULL,
  team                team_color,
  profile_id          uuid REFERENCES profiles(id),
  guest_id            uuid REFERENCES match_guests(id),
  meta                jsonb NOT NULL DEFAULT '{}'::jsonb,
  ordinal             int NOT NULL,
  CONSTRAINT match_event_participant_xor CHECK (
    (event_type IN ('halftime', 'fulltime', 'pause', 'resume') AND profile_id IS NULL AND guest_id IS NULL)
    OR (event_type NOT IN ('halftime', 'fulltime', 'pause', 'resume') AND (profile_id IS NOT NULL OR guest_id IS NOT NULL))
  )
);
CREATE INDEX match_events_match_idx ON match_events (match_id, ordinal);

-- 6. matches timing extension (mirror of pending_match_entries)
ALTER TABLE matches ADD COLUMN kickoff_at timestamptz;
ALTER TABLE matches ADD COLUMN halftime_at timestamptz;
ALTER TABLE matches ADD COLUMN fulltime_at timestamptz;
ALTER TABLE matches ADD COLUMN stoppage_h1_seconds int;
ALTER TABLE matches ADD COLUMN stoppage_h2_seconds int;

-- 7. RLS for new tables
ALTER TABLE pending_match_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_events         ENABLE ROW LEVEL SECURITY;

CREATE POLICY pme_admin_select ON pending_match_events FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY match_events_select ON match_events FOR SELECT TO authenticated USING (true);  -- visible to all

-- 8. submit_ref_entry — extended signature
DROP FUNCTION IF EXISTS submit_ref_entry(text, jsonb);
CREATE OR REPLACE FUNCTION submit_ref_entry(
  p_token   text,
  p_payload jsonb  -- {score_white, score_black, motm: {profile_id?, guest_id?},
                  --   players: [{profile_id|guest_id, team, goals, yellow_cards, red_cards, is_motm}],
                  --   events: [{event_type, match_minute, match_second, team?, profile_id?, guest_id?, meta?, ordinal}],
                  --   timing: {kickoff_at, halftime_at, fulltime_at, stoppage_h1_seconds, stoppage_h2_seconds}}
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_token       ref_tokens%ROWTYPE;
  v_entry_id    uuid;
BEGIN
  -- Validate token (existing logic preserved).
  SELECT * INTO v_token FROM ref_tokens WHERE token_sha256 = encode(digest(p_token, 'sha256'), 'hex');
  IF NOT FOUND OR v_token.consumed_at IS NOT NULL OR v_token.expires_at < now() THEN
    RAISE EXCEPTION 'Invalid or expired token' USING ERRCODE = 'FFC_TOKEN_INVALID';
  END IF;

  -- Insert pending_match_entries (extended with timing columns).
  INSERT INTO pending_match_entries (matchday_id, submitted_by_token_id, score_white, score_black, result,
    kickoff_at, halftime_at, fulltime_at, stoppage_h1_seconds, stoppage_h2_seconds)
  VALUES (
    v_token.matchday_id,
    v_token.id,
    (p_payload->>'score_white')::int,
    (p_payload->>'score_black')::int,
    derive_result((p_payload->>'score_white')::int, (p_payload->>'score_black')::int),
    (p_payload#>>'{timing,kickoff_at}')::timestamptz,
    (p_payload#>>'{timing,halftime_at}')::timestamptz,
    (p_payload#>>'{timing,fulltime_at}')::timestamptz,
    COALESCE((p_payload#>>'{timing,stoppage_h1_seconds}')::int, 0),
    COALESCE((p_payload#>>'{timing,stoppage_h2_seconds}')::int, 0)
  ) RETURNING id INTO v_entry_id;

  -- Insert per-player aggregates (existing logic).
  INSERT INTO pending_match_entry_players (pending_entry_id, profile_id, guest_id, team, goals, yellow_cards, red_cards, is_motm)
  SELECT v_entry_id, (p->>'profile_id')::uuid, (p->>'guest_id')::uuid, (p->>'team')::team_color,
         COALESCE((p->>'goals')::int, 0), COALESCE((p->>'yellow_cards')::int, 0),
         COALESCE((p->>'red_cards')::int, 0), COALESCE((p->>'is_motm')::boolean, false)
  FROM jsonb_array_elements(p_payload->'players') p;

  -- Insert event log (NEW).
  INSERT INTO pending_match_events (pending_entry_id, event_type, match_minute, match_second, team, profile_id, guest_id, meta, ordinal)
  SELECT v_entry_id,
         (e->>'event_type')::match_event_type,
         (e->>'match_minute')::int,
         (e->>'match_second')::int,
         (e->>'team')::team_color,
         (e->>'profile_id')::uuid,
         (e->>'guest_id')::uuid,
         COALESCE(e->'meta', '{}'::jsonb),
         (e->>'ordinal')::int
  FROM jsonb_array_elements(p_payload->'events') e;

  -- Burn token + push admin.
  UPDATE ref_tokens SET consumed_at = now() WHERE id = v_token.id;

  INSERT INTO notifications (recipient_id, kind, title, body, payload)
  SELECT id, 'ref_submitted',
    'Ref submitted Matchday ' || (SELECT matchday_number(matchday_id) FROM pending_match_entries WHERE id = v_entry_id),
    'Tap to review and approve.',
    jsonb_build_object('pending_entry_id', v_entry_id, 'deeplink', '/admin/match-entries/' || v_entry_id)
  FROM profiles WHERE role IN ('admin', 'super_admin');

  RETURN v_entry_id;
END;
$$;
GRANT EXECUTE ON FUNCTION submit_ref_entry(text, jsonb) TO anon, authenticated;

-- 9. approve_match_entry — extended to copy event log
-- (existing body kept; add at end:)
INSERT INTO match_events (match_id, event_type, match_minute, match_second, team, profile_id, guest_id, meta, ordinal)
SELECT v_match_id, event_type, match_minute, match_second, team, profile_id, guest_id, meta, ordinal
FROM pending_match_events WHERE pending_entry_id = p_pending_id;

-- 10. regenerate_ref_token RPC (admin)
CREATE OR REPLACE FUNCTION regenerate_ref_token(p_matchday_id uuid)
RETURNS text  -- raw token (only returned here; never persisted)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_raw_token text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  -- Burn any active tokens for this matchday.
  UPDATE ref_tokens SET consumed_at = now()
   WHERE matchday_id = p_matchday_id AND consumed_at IS NULL;

  -- Mint fresh token.
  v_raw_token := encode(gen_random_bytes(24), 'base64url');
  INSERT INTO ref_tokens (matchday_id, token_sha256, issued_by, expires_at, label)
  VALUES (
    p_matchday_id,
    encode(digest(v_raw_token, 'sha256'), 'hex'),
    current_profile_id(),
    now() + interval '6 hours',
    'Ref link · regenerated'
  );

  PERFORM log_admin_action('matchdays', p_matchday_id, 'regenerate_ref_token', '{}'::jsonb);

  RETURN v_raw_token;
END;
$$;
GRANT EXECUTE ON FUNCTION regenerate_ref_token(uuid) TO authenticated;
```

### B.4 — Admin review screen `/admin/match-entries/:id`

Pre-fills the existing approve UI from S023/S025 with the submitted data:
- Final score (large)
- Per-player grid (goals/yellow/red/MOTM checkboxes — editable)
- **NEW:** Event timeline showing all events with timestamps; each row has a 🗑 to drop a single event before approval (rare; for ref typos)
- Timing summary: kickoff at HH:MM · halftime at HH:MM · fulltime at HH:MM · stoppage 1st: M:SS · 2nd: M:SS
- Validation warnings (existing): per-player goal sum vs scoreline mismatch flagged but not blocked.
- APPROVE → `approve_match_entry` (extended) promotes pending → matches + match_players + match_events.
- REJECT → `reject_match_entry` (existing) — pending rows + event log deleted, ref must regenerate.
- EDIT AND APPROVE → admin mutates pending row, then approves (rolls into one transaction via stored procedure).

### B.5 — Admin "Generate ref link" UX

In `/admin/matches`, the matchday card gains a section visible after roster lock:

```
┌─────────────────────────────────────────────────┐
│ Ref link · expires in 5h 47m                    │
│  [📋 Copy link]  [🔄 Regenerate]  [💬 WhatsApp] │
└─────────────────────────────────────────────────┘
```

If no token exists yet: **`[+ Generate ref link]`** button (calls `regenerate_ref_token`, which double-duties as initial mint).

WhatsApp share intent uses `https://wa.me/?text=` URL scheme with a pre-filled message: `"FFC ref link for Matchday 33 (30/Apr/2026): https://ffc-gilt.vercel.app/ref/<token>  Expires in 6h."`

---

## C — Cross-cutting

### C.1 — VAPID key generation (one-time bootstrap)

Run locally:
```bash
npx web-push generate-vapid-keys
# Outputs:
# Public Key:  BL...
# Private Key: ...
```

- **Public key** → Vite env var `VITE_VAPID_PUBLIC_KEY` (committed to Vercel project env, also used in `applicationServerKey` on subscribe).
- **Private key** → Supabase Edge Function secret `VAPID_PRIVATE_KEY` (set via `supabase secrets set`).

Document in `CLAUDE.md` after S040 lands.

### C.2 — `app_settings` rows for Phase 2

| Key | Default | Used by |
|---|---|---|
| `auto_pick_captains` | `{"enabled": true}` | A.4 |
| `vote_reminder_24h_enabled` | `{"enabled": true}` | A.2 |
| `vote_reminder_3h_enabled` | `{"enabled": true}` | A.2 |
| `vote_reminder_15m_enabled` | `{"enabled": true}` | A.2 |
| `match_half_minutes_7v7` | `35` | B.2 |
| `match_half_minutes_5v5` | `25` | B.2 |
| `halftime_break_seconds` | `300` | B.2 |
| `max_stoppage_seconds` | `180` | B.2 |
| `ref_token_expiry_hours` | `6` | B.5 |

### C.3 — Acceptance criteria (mirror of masterplan §V3.0)

A single Season-11 Thursday matchday must pass all eight checkboxes:

1. No vote-chasing in WhatsApp; push reminders alone cover non-voters.
2. Roster locks itself at the deadline; players get `roster_locked` push immediately.
3. Captain pair auto-set on lock; admin gets `captain_auto_picked` notification with one-tap override.
4. If a confirmed player drops after lock, captains see realtime banner; one-tap promote works.
5. Ref runs the entire match on the console; no paper.
6. Goals / cards / MOTM time-stamped at the moment of capture.
7. Ref taps SUBMIT TO ADMIN; admin gets push within 30 s.
8. Admin opens review screen, verifies, taps APPROVE; leaderboard updates with no manual entry.

---

## D — Out of scope (for clarity)

- Photo-OCR fallback for ref entry (rejected by user 26/APR/2026)
- Email notifications on signup approve/reject (Phase 3 backlog)
- Season-end awards page (Phase 3 — for Season 12 launch)
- WhatsApp share PNG (Phase 3 backlog)
- Wide-viewport Formation two-column (Phase 1 deferred — stays mobile-first)
- SMS gateway for ref tokens (Phase 1 deferred — WhatsApp share intent covers it)
- Live spectator clock for non-ref users (Phase 3 — would require server-authoritative clock)

---

## E — Open decisions (none blocking)

All design decisions are committed by user approval on 26/APR/2026. No open items.

---

## Close-out

Spec frozen. Implementation plan via `superpowers:writing-plans` is the next step. Per slice: spec excerpt → plan → implement → preview deploy → real-matchday acceptance.
