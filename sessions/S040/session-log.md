# S040 — Phase 2 Slice 2B-A — Live Match Console backend foundation

**Date:** 26/APR/2026
**PC:** Home (`User`)
**Topic:** Phase 2 Track 2B opens. Foundation slice ships migration 0028 to live (new event-log tables + 5 timing cols + extended ref-entry + approve RPCs + admin token-regen RPC). No UI changes; that's slice 2B-B onward.
**Outcome:** Complete. 4 commits pushed; migration 0028 applied live; types regenerated; build clean.

## What landed

### Slice plan (commit `0feb349`)

Implementation plan written before any code. Scope: migration 0028 + types regen, no UI. Commit doc-only — sets the bar for the migration the next commits must satisfy.

### Migration 0028 authoring (commit `a8c23b5`)

`supabase/migrations/0028_phase2b_match_events.sql` — single file, multiple sections:

- **`match_event_type` enum** — 8 values: `goal · own_goal · yellow_card · red_card · halftime · fulltime · pause · resume`. Drives both pending and permanent event-log tables.
- **`pending_match_events`** — staging table written by ref entry. Columns: `id uuid pk`, `pending_entry_id uuid fk`, `kind match_event_type`, `minute int`, `team team_color nullable`, `actor_profile_id`/`actor_guest_id` (XOR — exactly one not-null when `kind` is participant-bearing), `ordinal int`, plus narrative columns. Constraints: minute ≥ 0; participant XOR; (pending_entry_id, ordinal) unique index.
- **`match_events`** — permanent log written by approve. Identical shape with `match_id` instead of `pending_entry_id`. Same constraints.
- **5 timing columns** added to both `pending_match_entries` and `matches`: `kickoff_at`, `halftime_at`, `second_half_kickoff_at`, `fulltime_at`, `total_stoppage_seconds`. Nullable on `matches`; pending defaults `total_stoppage_seconds=0`.
- **RLS** — pending events admin-select; permanent events authenticated-select (`USING true`).
- **`regenerate_ref_token(p_matchday_id uuid)`** — admin RPC. Burns active `ref_tokens` rows for the matchday (sets `consumed_at = now()`), mints a fresh 6h token via `gen_random_bytes(24)` + base64url normalisation (`replace(encode(..., 'base64'), '+', '-')` + `'/' → '_'` + `'=' → ''`), returns the raw token string. Admin-only via `is_admin()`.
- **`submit_ref_entry`** — DROP+CREATE rewrite. Now reads `p_payload->'events'` array + `p_payload->'timing'` object alongside the existing per-player aggregates. Backwards-compatible: missing keys are ignored.
- **`approve_match_entry`** — DROP+CREATE rewrite. Promotes pending events into permanent `match_events` keyed by new `match_id`; copies the 5 timing columns from pending into matches.

All SECURITY DEFINER RPCs got explicit `GRANT EXECUTE ... TO authenticated` (DEFAULT PRIVILEGES from 0012 don't cover functions).

### Code-review fixes (commit `08ddfbf`)

Self-review caught 2 real bugs before going live:

1. **Timing-overwrite guard on `approve_match_entry`.** Initial rewrite unconditionally copied pending timing → matches. But the admin direct-submit path (`admin_submit_match_result`) creates a `pending_match_entries` row without timing data, then approves it inline. So existing `matches.*` timing was being nulled out on approval. **Fix:** wrap the timing-copy block in `CASE WHEN v_pme.kickoff_at IS NOT NULL THEN ... ELSE leave-alone END` — `kickoff_at` is the sentinel signalling "this pending row carried real timing data". Pattern: when a copy path can run with or without source data, you need an explicit sentinel column to distinguish "no data, leave target alone" from "0/null is the actual data".

2. **Advisory lock on `regenerate_ref_token`.** The two-statement burn-then-mint sequence (UPDATE old rows + INSERT new row) runs under the SECURITY DEFINER's snapshot. Two simultaneous admin calls could each see the same unconsumed row, both UPDATE it (idempotent — sets the same `consumed_at`), both INSERT a new row → **two active tokens**, breaking the "exactly one live token per matchday" invariant. **Fix:** `pg_advisory_xact_lock(hashtext('regenerate_ref_token:' || p_matchday_id::text))` at the top of the function. Per-matchday-per-transaction lock; auto-released on commit/rollback. Pattern: any "burn old + mint new" sequence on a uniqueness-critical resource needs an advisory lock; relying on snapshot isolation alone is insufficient.

### Apply + types regen + close-out (commit `7af341d`)

- Migration applied via `npx supabase db push` against `hylarwwsedjxwavuwjrn`. Verified `\dt public.*match_event*`, `SELECT typname FROM pg_type WHERE typname='match_event_type'`, `\df+ regenerate_ref_token`.
- `npx supabase gen types typescript --linked 2>/dev/null > ffc/src/lib/database.types.ts` — file grew 1916 → 2183 lines. New types: `match_events` row, `pending_match_events` row, `regenerate_ref_token` Args/Returns, extended `submit_ref_entry`/`approve_match_entry` payloads. Zero downstream TS errors.
- Build clean: `node ./node_modules/typescript/bin/tsc -b` EXIT 0 + `node ./node_modules/vite/bin/vite.js build` EXIT 0.
- No UI changes. `RefEntry.tsx` is still the existing stub — wiring the new RPCs into the ref console is slice 2B-B's job. `AdminMatches.tsx` has no token-regen button yet; that's slice 2B-B too.

## Verification

### Live DB schema (post-apply)

```
public.match_events             — created
public.pending_match_events     — created
public.match_event_type         — enum, 8 values
matches.kickoff_at, halftime_at, second_half_kickoff_at, fulltime_at, total_stoppage_seconds  — added
pending_match_entries (same 5 timing cols)  — added
regenerate_ref_token(uuid) → text  — created
submit_ref_entry, approve_match_entry  — recreated with new shapes
```

`supabase migration list` shows 28 migrations. `pg_publication_tables` does not include the new tables (no realtime broadcast yet — slice 2B-B / 2B-C will decide if needed).

### Build

`tsc -b` clean. `vite build` produces 11 PWA precache entries / ~1485 KB. Vercel auto-deploy not required for backend-only commit but is in flight.

## Patterns / lessons (additive)

- **base64url tokens via `gen_random_bytes` + 3 `replace()`.** Postgres `encode(..., 'base64')` produces standard base64 with `+`, `/`, `=` chars — not URL-safe. Three `replace()` calls (`+ → -`, `/ → _`, `= → ''`) yield URL-safe base64url. 24 random bytes → ~32 base64url chars feels more "token-like" than a 36-char UUID with hyphens, and `gen_random_bytes` lives in `pgcrypto` which is already enabled.
- **Two-statement burn-then-mint always needs an advisory lock under snapshot isolation.** Snapshot isolation (the default REPEATABLE READ for SECURITY DEFINER) does not serialise concurrent reads of the same row — both calls can pass the "is there an unconsumed row?" check independently. `pg_advisory_xact_lock` per-key-per-transaction makes the pair atomic without table locks.
- **Timing-copy paths need a sentinel column.** When a copy path (`pending → permanent`) runs through both real-data paths (ref entry) and no-data paths (admin direct-submit), the target rows on the no-data path can be silently nulled out. Pick the most-required source column as the sentinel (here: `kickoff_at`) and gate the copy on `IS NOT NULL`.
- **When a spec hardcodes a migration number, confirm build-order before applying.** The Phase 2 design spec was authored before build-order was locked and pre-claimed `0029` for Track 2B. Build-order then locked Track 2B FIRST (concrete, single screen, soak-tests on real matchdays in a way Track 2A doesn't). Resolved with a one-line spec patch in the same commit as the migration; the migration claimed 0028 and the spec was updated to match. Pattern: every migration-number reference in a multi-track plan is a soft promise — confirm at apply-time.
- **`DROP FUNCTION IF EXISTS` before `CREATE OR REPLACE` for rewrites.** Even when signature is unchanged, dropping first ensures no shadow function lingers if param defaults change in a future revision. Costs a microsecond at apply-time, removes a class of latent bugs.

## Commits

| SHA | Message |
|---|---|
| `0feb349` | docs(plan): slice 2B-A implementation plan — migration 0028 + types regen |
| `a8c23b5` | feat(s040,2b-a): migration 0028 — pending_match_events + match_events tables + RPC extensions |
| `08ddfbf` | fix(s040,2b-a): code-review fixes — timing-overwrite guard + advisory lock |
| `7af341d` | feat(s040,2b-a): apply migration 0028 to live + regenerate types + S040 close-out |

## Next session: S041

- **Slice 2B-B** — admin "Generate ref link" button on AdminMatches matchday cards. Wire to `regenerate_ref_token` RPC; show URL once with copy-to-clipboard + WhatsApp share-intent button + 🔄 regenerate button. Token-expires-in countdown chip.
- Carry-over backlog still pending acceptance: S031 21-item checklist, S032/33/34/35 acceptance items.
- Captain reroll live test — deferred until MD31 runs in-app.
- Backburner unchanged.
