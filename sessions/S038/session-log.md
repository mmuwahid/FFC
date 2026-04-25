# S038 — Cream-bg PWA + share-preview polish + ghost-claim routing fix (Barhoom unblock)

**Date:** 25/APR/2026
**PC:** Work (`UNHOEC03`)
**Topic:** P1 cream-bg logo polish (OG share preview + Apple touch + maskable). P2 ghost-claim flow fix — discovered the existing infra already covered binding, the only bug was a routing dead-end after Google OAuth. Seeded expected emails on the 4 admin ghost rows.
**Outcome:** Complete. Two commits pushed; both Vercel deploys green. No migration needed for P2.

## What landed

### Part 1 — P1 cream-bg PWA + share-preview polish (commit `a44f1fb`)

User-flagged at S037 close: WhatsApp link preview was dark navy with cropped shield, Apple touch home-screen icon was navy. Direction: cream brand background, full crest visible, og:description rewritten.

- **Generator script** `_wip/gen_cream_assets_s038.py` (Python 3.13 + PIL 12.2). Reads `shared/FFC Logo Transparent Background.png` (1024×1024 RGBA, opaque bbox `(147, 98, 876, 966)`), trims to bbox, scales preserving aspect ratio so the longest side fits a configurable inset of the smaller frame dimension, centres on a cream-`#f2ead6` canvas. Three outputs:
  - `og-image.png` — 1200×630, 80% inset → 221 KB.
  - `ffc-logo-180.png` — Apple touch, 78% inset → 23 KB.
  - `ffc-logo-maskable-512.png` — 60% safe-zone inset → 87 KB.
- **`index.html` meta updates:**
  - `<meta name="description">` + `og:description` + `twitter:description` → `"The official Home of the FFC."` (was `"FFC — weekly 7-a-side with the same crew."`).
  - `og:image` + `twitter:image` → `/og-image.png?v=2` (cache-buster forces WhatsApp scrape cache to refresh).
  - Added `<meta name="twitter:description">` (was missing).
- **`PublicLayout.tsx`** — stripped the `<header className="app-topbar">` block. Login / Signup / PendingApproval all render their own large centred FFC crest, so the topbar from `3573761` was redundant on auth screens. RoleLayout (authed) + RefLayout topbars left intact.
- Transparent `any`-purpose icons (`ffc-logo-32/192/512.png` + `ffc-logo.png`) untouched — they layer over OS chrome.

Build clean: tsc -b EXIT 0 + vite build EXIT 0, PWA bumped 1340 → 1483 KB (the cream-bg variants are larger than the navy-bg originals; expected). Vercel deploy `dpl_13J5zwtKekvJaQBmUQsr6fd4NxkW` READY in ~17s.

### Part 2 — P2 ghost-claim flow fix for Barhoom (commit `4de4b05`)

User reported during session: admin Barhoom signed in (Google OAuth) → blank screen → couldn't claim a profile.

**Diagnosis (during code-read, before touching anything):**
- `Login.tsx:78` already navigates to `/` after sign-in — that's correct, lands on HomeRoute.
- `router.tsx:35` HomeRoute renders `<PendingApproval />` for `session && !role`.
- PendingApproval shows `"Waiting for approval"` — but for Barhoom this is **wrong UX** because no `pending_signups` row was ever created (Google OAuth from the Login page doesn't go through Signup.tsx Stage 2). Mohammed never sees Barhoom in the admin queue.
- **Critical discovery:** the full ghost-claim flow already exists. `Signup.tsx` has a 3-stage state machine (auth / who / waiting) that derives stage from session+role+pending_signups. Stage 2 (`who`) renders an unclaimed-ghost picker + "I'm new" fallback. Submitting inserts a `pending_signups` row with `claim_profile_hint = ghost.id`. Migration 0008 `approve_signup(p_pending_id, p_claim_profile_id)` already binds the ghost (sets `auth_user_id`, `email`, `is_active`, audits, fires welcome notification).

So the bug was **purely a routing dead-end after OAuth**. Fix is 3 small code changes — no migration:

- **`router.tsx`** — HomeRoute: `session && !role` → `<Navigate to="/signup" replace />` instead of `<PendingApproval />`. Signup.tsx self-derives the right stage. Removed PendingApproval import; file kept on disk for git-history simplicity but now dead code.
- **`RoleLayout.tsx`** — defensive role-gate: `loading || profileLoading` → splash; `!session || !role` → `<Navigate to="/" replace />`. Prevents direct URL hits on `/poll`/etc. from rendering blank if a user mid-flow tries to deep-link.
- **`AdminPlayers.tsx` ApproveSheet** — when a claim row's ghost has `email` populated, render a green ✓ "Email matches" or amber ⚠ "Expected X, got Y" banner so Mohammed has a sanity check before binding the ghost. Case-insensitive comparison.

**Pre-claim email seed (executed via `supabase db query --linked`):**

| Display name | Ghost ID | Seeded email |
|---|---|---|
| Barhoom | `0cc871e8-a2b9-4edd-b818-2af5203dd97f` | `ahmed.abdallahh@hotmail.com` |
| Abood | `8dc6d6ba-c167-4d6d-baeb-262cadf00438` | `amakkawi89@gmail.com` |
| Ahmed Saleh | `fc2b7ea6-2ebc-4655-b152-ade5095a4aa6` | `ahmed_msaleh@hotmail.com` |
| Rawad | `c984bdce-d1c5-4a97-9cf1-9054bfa57d1e` | `rawadbn@gmail.com` |

Implementation note: multi-statement queries via the CLI errored with `String must contain at least 1 character(s)` — wrapped in `DO $$ BEGIN ... END $$` block. Successful.

Build clean: tsc -b EXIT 0 + vite build EXIT 0, PWA 1484 KB. Vercel deploy `dpl_Ge8bwT6Thc7kKbHgv2XJ67jDWeKX` READY in ~22s.

## Verification

### Live DB
```
display_name | email
Abood        | amakkawi89@gmail.com
Ahmed Saleh  | ahmed_msaleh@hotmail.com
Barhoom      | ahmed.abdallahh@hotmail.com
Rawad        | rawadbn@gmail.com
```

### Live URLs
- Production: https://ffc-gilt.vercel.app — both deploys aliased.
- OG image: https://ffc-gilt.vercel.app/og-image.png?v=2 — cream `#f2ead6` bg + full crest + 1200×630.
- Apple touch: https://ffc-gilt.vercel.app/ffc-logo-180.png — cream bg, 78% logo inset.
- Maskable: https://ffc-gilt.vercel.app/ffc-logo-maskable-512.png — cream bg, 60% safe zone.

### Acceptance test for Barhoom (deferred to user — will verify when he next signs in)
1. Hard-refresh production on his phone (PWA SW cache may need bust).
2. Login screen → "Continue with Google" → sign in with `ahmed.abdallahh@hotmail.com`.
3. Lands on `/signup` (HomeRoute fix routes him there instead of PendingApproval).
4. Stage 2 ghost-picker shows all 39 unclaimed rows including "Barhoom".
5. Tap "Barhoom" → Submit request → Stage 3 "Waiting for approval".
6. Mohammed opens `/admin/players` → Pending tab → sees Barhoom row with `claim` chip + "Wants to claim: Barhoom".
7. Tap Approve → ApproveSheet shows green ✓ "Email matches the seeded address for Barhoom" → Confirm.
8. `approve_signup(p_pending_id, p_claim_profile_id=barhoom.id)` runs → ghost.auth_user_id bound to Barhoom's auth.uid + email stored + audit row.
9. Barhoom hard-refreshes → AppContext profile lookup resolves → role=`admin` → `/poll` opens with admin chrome. Season 11 stats preserved.

Same flow for Abood / Ahmed Saleh / Rawad.

35 player ghosts flow through the same path — no email-match banner for them (their `profiles.email` is still NULL), but the regular admin-approval flow still works. Pre-seed their emails the same way later if you want the sanity check.

## Patterns + lessons (additive)

- **"Read the existing code before designing the fix" pattern.** Initial P2 plan was a full ghost-claim feature build: migration 0028 + new `claim_requests` table + `request_claim`/`approve_claim`/`reject_claim` RPCs + new `Claim.tsx` page + AdminPlayers tab augmentation. Reading `Signup.tsx` (S019) + `AdminPlayers.tsx` (S025) revealed the entire flow already existed. Final fix was 3 routing edits + a 4-row UPDATE. Lesson: when a user reports a bug in a complex codebase you haven't touched in days, **read the relevant files end-to-end before sketching the fix** — the "missing feature" might already be 80% built.

- **Multi-statement SQL via CLI requires DO block.** `npx supabase db query --linked "UPDATE ...; UPDATE ...;"` returns `String must contain at least 1 character(s)`. Wrapping in `DO $$ BEGIN ... END $$` works because it's a single PL/pgSQL statement.

- **PIL.Image bbox + LANCZOS pattern for asset regen.** Trimming with `getbbox()` first (instead of operating on padded canvas) keeps the inset percentages meaningful — 80% of frame height = 80% of the visible logo's extent, not 80% with whatever transparent padding the source had baked in. Re-usable for future PWA icon refreshes.

- **Cache-buster `?v=N` on og:image** is the safest way to force WhatsApp's link-preview scraper to re-fetch. WhatsApp aggressively caches by URL — without the query param, the old preview can stick for hours/days even after redeploy.

- **`ApproveSheet` email-match sanity banner pattern.** When a system has multiple identity sources (auth email vs ghost-row expected email), surface BOTH in the admin's confirmation sheet with a colour-coded match indicator. Cheap to implement (4 LOC of comparison + 2 conditional banners), prevents wrong-claim binding which is permanent. Re-usable for any "admin approves a destructive bind" UI.

## Commits

| SHA | Message |
|---|---|
| `a44f1fb` | feat(s038-p1): cream-bg PWA + OG share-preview polish + strip topbar from auth screens |
| `4de4b05` | fix(s038-p2): unblock ghost-claim flow for Google OAuth — route session+no-role through /signup |

## Next session (S039)

- **Live verification of Barhoom flow** end-to-end (user-driven, parallel to other work). Same flow to ride for Abood / Ahmed Saleh / Rawad whenever they next sign in.
- **Carry-over backlog** (still in flight): S031 21-item checklist, S032/33/34/35 acceptance.
- **Captain reroll live test** (deferred until MD31 runs in-app).
- **Logo + share-preview WhatsApp acceptance** — user manually shares the live URL to a chat to verify cream OG card lands. iOS "Add to Home Screen" cream icon test.
- Backburner: empty.
