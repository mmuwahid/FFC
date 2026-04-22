# `admin_audit_log` — SQL cheat-sheet

Every security-definer admin RPC writes one row here. This is the authoritative trail of who did what to which entity.

## Schema (as of S021)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `admin_profile_id` | uuid | FK → `public.profiles.id`; always the acting super-admin |
| `target_entity` | text | Logical table name, e.g. `pending_signups`, `profiles`, `matches` |
| `target_id` | uuid | Row being acted on |
| `action` | text | Verb, e.g. `approve_signup`, `reject_signup`, `deactivate_player` |
| `payload_jsonb` | jsonb | Action-specific context (reason, prior values, derived IDs) |
| `created_at` | timestamptz | UTC |

> **Past mistake:** column is `target_entity`, NOT `target_table`. S020's D5 SQL used the wrong name and errored. If you ever see `column "target_table" does not exist` — that's this.

## Common queries

Recent activity by a specific admin:
```sql
SELECT created_at, action, target_entity, target_id, payload_jsonb
FROM admin_audit_log
WHERE admin_profile_id = (SELECT id FROM profiles WHERE email = 'm.muwahid@gmail.com')
ORDER BY created_at DESC
LIMIT 50;
```

Every approve/reject decision with the resolved signup row:
```sql
SELECT a.created_at, a.action, a.payload_jsonb, ps.email AS signup_email
FROM admin_audit_log a
LEFT JOIN pending_signups ps ON ps.id = a.target_id
WHERE a.target_entity = 'pending_signups'
ORDER BY a.created_at DESC;
```

Reject reasons only (for auditing rejection quality):
```sql
SELECT a.created_at,
       a.payload_jsonb->>'reason' AS reason,
       ps.email
FROM admin_audit_log a
JOIN pending_signups ps ON ps.id = a.target_id
WHERE a.action = 'reject_signup'
ORDER BY a.created_at DESC;
```

Daily action volume:
```sql
SELECT date_trunc('day', created_at)::date AS day,
       action,
       count(*) AS n
FROM admin_audit_log
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
```

## Known actions (Phase 1)

| Action | Source RPC | `payload_jsonb` shape |
|---|---|---|
| `approve_signup` | `admin_approve_signup` | `{profile_id, claimed}` |
| `reject_signup` | `admin_reject_signup` | `{ghost_profile_id, reason}` |

Expand this table as new admin RPCs land.
