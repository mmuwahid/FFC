# Phase 2 Slice 2B-B — Admin "Generate ref link" UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the admin-side UI that mints + manages ref tokens. Once a matchday's roster is locked, the AdminMatches card surfaces a "Ref link" section: generate / copy / regenerate / share to WhatsApp, with an expires-in countdown chip. Backend (RPC + tables) was shipped in slice 2B-A; this slice is purely frontend.

**Architecture:**
- Add a per-matchday active-token lookup to AdminMatches (`SELECT matchday_id, expires_at FROM ref_tokens WHERE consumed_at IS NULL AND expires_at > now()` on load) so each card knows whether a live token exists.
- New `<RefLinkSection>` component inside `MatchdayCard`, rendered only when `roster_locked_at IS NOT NULL`. Two states: **no active token** (shows "Generate ref link" CTA) and **active token** (shows expiry chip + 🔄 Regenerate button).
- New `<RefLinkSheet>` portal component that pops when the admin generates / regenerates. Receives the raw token string from the RPC return value (one-shot — Postgres doesn't store plaintext), builds the URL, exposes 📋 Copy and 💬 WhatsApp share intent and an explanation that the link is shown once.
- Regenerate burns the previous token via the same `regenerate_ref_token` RPC and immediately reopens the sheet with the new URL.

**Tech Stack:**
- React 19 + TypeScript 6 (existing)
- Supabase JS client `supabase.rpc('regenerate_ref_token', { p_matchday_id })`
- `navigator.clipboard.writeText()` for copy (already used elsewhere — e.g. AdminPlayers)
- WhatsApp share intent via `https://wa.me/?text=` URL scheme (works on mobile + desktop)

---

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `ffc/src/pages/admin/AdminMatches.tsx` | **Modify** | Add `tokensByMatchday` Map fetched alongside existing `loadAll`; new `RefLinkSection` component (~80 LOC) embedded after existing actions; new `RefLinkSheet` portal (~120 LOC); two new handler callbacks (`onGenerate(md.id)` / `onRegenerate(md.id)`). |
| `ffc/src/pages/admin/admin-matches.css` | **Modify** | New CSS classes under `.admin-ref-link-*` namespace (~60 LOC). Brand-token-driven (cream-on-navy + gold accent). |
| `tasks/todo.md` | **Edit** | Append Slice 2B-B close-out section (S041). Update NEXT block to S042. |

No new top-level files. Keeping it in `AdminMatches.tsx` for cohesion — the section is tightly coupled to the matchday card. If `AdminMatches.tsx` grows past ~1500 LOC after this, slice 2B-F can split RefLinkSheet into its own file (current file is 1362 LOC; this slice adds ~200 LOC).

---

## Pre-flight context (read once)

- Last committed tip on `main`: `ec39083` (S040 doc close-out).
- Migrations on live DB: 28. `regenerate_ref_token` RPC is live and callable from authenticated admin role.
- The RPC returns `text` (the raw base64url token, ~32 chars). It's only returned at this moment — Postgres stores `sha256(token)` only. **Slice 2B-B is the only window where the raw token exists in memory.** Once the sheet closes, the URL is gone forever (admin must regenerate to share again).
- The RPC takes a per-matchday advisory lock (slice 2B-A code-review fix), so concurrent admin clicks are safe.
- Existing AdminMatches structure (read `ffc/src/pages/admin/AdminMatches.tsx` lines 466–564 to confirm):
  - `MatchdayCard` is a function component receiving `md: MatchdayWithMatch` + several `onAction` callbacks.
  - Actions row uses `auth-btn auth-btn--sheet-cancel admin-md-btn` for neutral buttons and `auth-btn auth-btn--approve admin-md-btn` for primary actions.
  - The portal-rendered sheet pattern is already used by `<ConfirmSheet>` (search for `<ConfirmSheet` in the file). New `<RefLinkSheet>` should follow that same z-index + scrim + safe-area pattern.
- Toast pattern: `setToast('Link copied')` already exists in AdminMatches; it's a string-state-driven banner that auto-dismisses (search `toast` in the file to confirm wiring).

---

## Visual sketch (inline — no separate mockup file)

**No active token (post-lock):**
```
┌─────────────────────────────────────────────┐
│ Matchday 34 · Thu 30/Apr · Sky Stars        │
│ 🔒 Roster locked · 14 of 14                 │
│                                             │
│ [ Edit result ]  [ 🧩 Formation ]            │
│ [ 👔 Pick captains ]                         │
│                                             │
│ ─────────────────────────────────────────── │
│ Ref link                                    │
│ [ + Generate ref link ]                     │
└─────────────────────────────────────────────┘
```

**Active token:**
```
┌─────────────────────────────────────────────┐
│ Matchday 34 · Thu 30/Apr · Sky Stars        │
│ 🔒 Roster locked · 14 of 14                 │
│                                             │
│ [ Edit result ]  [ 🧩 Formation ]            │
│ [ 👔 Pick captains ]                         │
│                                             │
│ ─────────────────────────────────────────── │
│ Ref link · expires in 4h 22m       🔄       │
└─────────────────────────────────────────────┘
```

Tapping the section (or the 🔄 button) opens the sheet.

**RefLinkSheet (when admin just generated / regenerated):**
```
        ───────                                  (grabber)
        Ref link ready
        Share this link with the ref. It works
        for one submission and expires in 6 h.
        Shown once — regenerate to share again.

        ┌──────────────────────────────────────┐
        │ https://ffc-gilt.vercel.app/ref/A2x… │
        └──────────────────────────────────────┘

        [ 📋 Copy link ]    [ 💬 Share to WhatsApp ]

                      [ Done ]
```

The URL is in a read-only `<input type="text" readOnly>` so admins can long-press to select on mobile if the copy button doesn't work for some reason.

WhatsApp message body:
> `FFC ref link for Matchday <N> (<DD/Mon>): <url>  Expires in 6h.`

---

## Task 1 — Data layer + helper functions (15 min)

**Files:**
- Modify: `ffc/src/pages/admin/AdminMatches.tsx` (top of file — type import + state + loadAll extension; helper functions later in file)

- [ ] **Step 1: Read the file to anchor edits**

```bash
grep -n "MatchdayWithMatch\|loadAll\|setMatchdays\|MatchdayRow" ffc/src/pages/admin/AdminMatches.tsx | head -20
```

Note the line numbers for `type MatchdayWithMatch`, `const [matchdays, setMatchdays]`, the Promise.all in `loadAll`. Confirm structure matches plan's pre-flight context.

- [ ] **Step 2: Extend the per-card type to carry token info**

Find the `type MatchdayWithMatch` definition (around line 23-35). It currently looks like:

```ts
type MatchdayWithMatch = MatchdayRow & {
  match: MatchRow | null
  draft?: DraftInfo
}
```

Modify to add a token-info field:

```ts
type ActiveTokenInfo = {
  expires_at: string  // ISO timestamp
}

type MatchdayWithMatch = MatchdayRow & {
  match: MatchRow | null
  draft?: DraftInfo
  activeToken?: ActiveTokenInfo  // present iff a non-consumed, non-expired ref_tokens row exists
}
```

- [ ] **Step 3: Extend `loadAll` to fetch active tokens**

Find the `Promise.all([...])` block in `loadAll` (around line 168-172). It currently fetches matchdays + matches + draft_sessions. Add a fourth fetch for active tokens:

```ts
const [matchdaysRes, matchesRes, draftsRes, tokensRes] = await Promise.all([
  supabase.from('matchdays').select('*').order('kickoff_at', { ascending: false }).limit(60),
  supabase.from('matches').select('id, matchday_id, score_white, score_black, result, motm_user_id, motm_guest_id, approved_at, notes'),
  supabase.from('draft_sessions').select('id, matchday_id, status, current_picker_team, reason, started_at, triggered_by_profile_id').in('status', ['in_progress']),
  supabase.from('ref_tokens').select('matchday_id, expires_at').is('consumed_at', null).gt('expires_at', new Date().toISOString()),
])
```

Then build a `tokensByMd` Map alongside the existing `matchByMd` and `draftByMd` Maps:

```ts
const tokensByMd = new Map<string, ActiveTokenInfo>()
for (const t of (tokensRes.data ?? []) as { matchday_id: string; expires_at: string }[]) {
  tokensByMd.set(t.matchday_id, { expires_at: t.expires_at })
}
```

In the matchday-merge loop (where `matchByMd` and `draftByMd` are read), pull token info too:

```ts
const merged: MatchdayWithMatch[] = (matchdaysRes.data ?? []).map((md) => ({
  ...md,
  match: matchByMd.get(md.id) ?? null,
  draft: draftByMd.get(md.id),
  activeToken: tokensByMd.get(md.id),
}))
```

- [ ] **Step 4: Add a small helper for the "expires in" label**

After the existing `formatDraftElapsed` helper (find via grep), add:

```ts
function formatExpiresIn(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return 'expired'
  const totalMin = Math.floor(ms / 60000)
  if (totalMin < 60) return `expires in ${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `expires in ${h}h ${m}m`
}
```

- [ ] **Step 5: Verify compilation**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc -b
```

Expected: EXIT 0. The new code is structurally sound — `ref_tokens` is in the regenerated types from slice 2B-A so `.from('ref_tokens')` is type-checked.

- [ ] **Step 6: Commit**

```bash
git add ffc/src/pages/admin/AdminMatches.tsx
git commit -m "$(cat <<'EOF'
feat(s041,2b-b): AdminMatches data layer for active ref tokens

Extends MatchdayWithMatch with optional activeToken: { expires_at }
populated from a fourth Promise.all branch in loadAll querying
ref_tokens WHERE consumed_at IS NULL AND expires_at > now(). Adds
formatExpiresIn helper for the matchday-card chip.

No UI yet — Task 2 wires the RefLinkSection.
EOF
)"
```

---

## Task 2 — `RefLinkSection` component + `RefLinkSheet` portal + handlers (45 min)

**Files:**
- Modify: `ffc/src/pages/admin/AdminMatches.tsx` (add 2 new components, 2 new state slots, 2 new handlers, wire MatchdayCard)
- Modify: `ffc/src/pages/admin/admin-matches.css` (add `.admin-ref-link-*` styles)

- [ ] **Step 1: Add component-level state for the sheet**

In the main `AdminMatches` function component (find by grep; the `useState` block is near the top of the function), after the existing `setToast`/`setError`/`setSheet` slots, add:

```ts
const [refSheet, setRefSheet] = useState<{ matchday: MatchdayWithMatch; rawToken: string } | null>(null)
```

This state holds the raw token + matchday context while the sheet is open. Set to null on close.

- [ ] **Step 2: Add the `onGenerate` / `onRegenerate` handler**

Inside the main component, after existing handlers, add a single handler (generate and regenerate are the same RPC call; regenerate just overwrites):

```ts
const handleMintRefLink = async (md: MatchdayWithMatch) => {
  setError(null)
  const { data, error } = await supabase.rpc('regenerate_ref_token', { p_matchday_id: md.id })
  if (error) {
    setError(error.message)
    return
  }
  if (typeof data !== 'string' || data.length === 0) {
    setError('Unexpected empty token from regenerate_ref_token')
    return
  }
  setRefSheet({ matchday: md, rawToken: data })
  // Refresh the activeToken view so the card chip flips to "expires in 6h 0m" once sheet closes.
  await loadAll()
}
```

- [ ] **Step 3: Wire the new prop into MatchdayCard**

Find the `<MatchdayCard ... />` invocation (around line 308-320). Add the prop:

```tsx
<MatchdayCard
  // ...existing props
  onMintRefLink={() => handleMintRefLink(md)}
/>
```

Update `MatchdayCard`'s prop type signature to include:

```ts
onMintRefLink: () => void
```

And destructure `onMintRefLink` in the function signature alongside the other `onAction` props.

- [ ] **Step 4: Add the `RefLinkSection` rendering inside MatchdayCard**

Inside the `MatchdayCard` JSX, AFTER the existing `<div className="admin-md-actions">...</div>` and BEFORE the closing `</li>`, insert:

```tsx
{locked && (
  <div className="admin-ref-link">
    {md.activeToken ? (
      <button
        type="button"
        className="admin-ref-link-active"
        onClick={onMintRefLink}
        title="Regenerate ref link (burns the previous one)"
      >
        <span className="admin-ref-link-label">Ref link</span>
        <span className="admin-ref-link-expiry">· {formatExpiresIn(md.activeToken.expires_at)}</span>
        <span className="admin-ref-link-regen" aria-hidden>🔄</span>
      </button>
    ) : (
      <button
        type="button"
        className="admin-ref-link-generate"
        onClick={onMintRefLink}
      >
        + Generate ref link
      </button>
    )}
  </div>
)}
```

- [ ] **Step 5: Add the `RefLinkSheet` component**

After the `MatchdayCard` function and before `resultLabel`, add a new component:

```tsx
function RefLinkSheet({
  matchday,
  rawToken,
  onClose,
  onCopy,
}: {
  matchday: MatchdayWithMatch
  rawToken: string
  onClose: () => void
  onCopy: () => void
}) {
  const url = `${window.location.origin}/ref/${rawToken}`
  const matchdayLabel = `${dateLabel(matchday.kickoff_at)}`
  const whatsappMessage = `FFC ref link for Matchday ${matchdayLabel}: ${url}  Expires in 6h.`
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(whatsappMessage)}`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      onCopy()
    } catch {
      // Fallback: select the input so the user can long-press / Ctrl+C
      document.getElementById('admin-ref-link-input')?.focus()
    }
  }

  return createPortal(
    <div className="admin-sheet-scrim" onClick={onClose}>
      <div className="admin-sheet admin-ref-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="admin-sheet-grabber" aria-hidden />
        <h3 className="admin-sheet-title">Ref link ready</h3>
        <p className="admin-ref-sheet-copy">
          Share this link with the ref. It works for one submission and expires in 6&nbsp;h.
          <br />
          <strong>Shown once</strong> — regenerate to share again.
        </p>
        <input
          id="admin-ref-link-input"
          className="admin-ref-link-url"
          type="text"
          value={url}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="admin-ref-sheet-actions">
          <button
            type="button"
            className="auth-btn auth-btn--approve"
            onClick={handleCopy}
          >
            📋 Copy link
          </button>
          <a
            className="auth-btn auth-btn--sheet-cancel"
            href={whatsappHref}
            target="_blank"
            rel="noreferrer noopener"
          >
            💬 Share to WhatsApp
          </a>
        </div>
        <button
          type="button"
          className="auth-btn auth-btn--sheet-cancel admin-ref-sheet-done"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>,
    document.body
  )
}
```

`createPortal` import: at the top of the file, find existing `import { ... } from 'react-dom'` (the existing `<ConfirmSheet>` uses it) — extend that import or add `import { createPortal } from 'react-dom'` if absent.

- [ ] **Step 6: Render `RefLinkSheet` from the main component**

In the main `AdminMatches` function's return JSX, after the existing `<ConfirmSheet>`/sheet rendering blocks (search for the `{sheet && ...}` pattern at the bottom), add:

```tsx
{refSheet && (
  <RefLinkSheet
    matchday={refSheet.matchday}
    rawToken={refSheet.rawToken}
    onClose={() => setRefSheet(null)}
    onCopy={() => {
      setToast('Link copied to clipboard')
      // Don't close the sheet on copy — admin may want to share to WhatsApp too.
    }}
  />
)}
```

- [ ] **Step 7: Add CSS**

Append to `ffc/src/pages/admin/admin-matches.css`:

```css
/* §3.4-v2 Slice 2B-B — Ref link section on matchday card */

.admin-ref-link {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border, rgba(242,234,214,0.08));
}

.admin-ref-link-generate {
  width: 100%;
  height: 40px;
  border-radius: 10px;
  border: 1px dashed var(--border, rgba(242,234,214,0.18));
  background: transparent;
  color: var(--text, #f2ead6);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  cursor: pointer;
}
.admin-ref-link-generate:hover { background: rgba(242,234,214,0.04); }

.admin-ref-link-active {
  width: 100%;
  height: 40px;
  border-radius: 10px;
  border: 1px solid rgba(229,186,91,0.35);
  background: rgba(229,186,91,0.08);
  color: var(--text, #f2ead6);
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  cursor: pointer;
}
.admin-ref-link-active:hover { background: rgba(229,186,91,0.14); }

.admin-ref-link-label {
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-size: 11px;
  color: var(--accent, #e5ba5b);
}

.admin-ref-link-expiry {
  flex: 1;
  text-align: left;
  font-weight: 500;
  color: var(--text-muted, #85929f);
}

.admin-ref-link-regen {
  font-size: 16px;
}

/* Sheet specifics */
.admin-ref-sheet {
  padding: 22px 18px calc(28px + env(safe-area-inset-bottom, 12px));
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.admin-ref-sheet-copy {
  font-size: 13px;
  color: var(--text-muted, #85929f);
  line-height: 1.55;
  margin: 0;
}
.admin-ref-link-url {
  width: 100%;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--border, rgba(242,234,214,0.12));
  background: var(--surface-2, #182437);
  color: var(--text, #f2ead6);
  font-size: 13px;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
.admin-ref-link-url:focus {
  outline: 2px solid var(--accent, #e5ba5b);
  outline-offset: 1px;
}
.admin-ref-sheet-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.admin-ref-sheet-done {
  margin-top: 4px;
}
```

- [ ] **Step 8: tsc + vite verify**

```bash
cd ffc && node ./node_modules/typescript/bin/tsc -b && node ./node_modules/vite/bin/vite.js build 2>&1 | tail -5
```

Expected: tsc EXIT 0, vite ends with `✓ built in <ms>ms`. PWA size up by maybe 1-3 KiB (CSS + JS additions are small).

- [ ] **Step 9: Commit**

```bash
git add ffc/src/pages/admin/AdminMatches.tsx ffc/src/pages/admin/admin-matches.css
git commit -m "$(cat <<'EOF'
feat(s041,2b-b): admin "Generate ref link" UI on matchday cards

After roster lock, each card surfaces a Ref link section: Generate
button when no active token, "expires in Xh Ym" + 🔄 chip when one
exists. Tap opens a portal sheet showing the URL once with 📋 Copy
+ 💬 WhatsApp share intent. URL is read-only input so admins can
long-press select on mobile. Regenerate burns the previous token
via the same regenerate_ref_token RPC and reopens the sheet with
the new URL.

CSS namespaced under .admin-ref-link-* using brand tokens (gold
accent for active state, dashed border for generate CTA).
EOF
)"
```

---

## Task 3 — S041 close-out + push (10 min)

**Files:**
- Modify: `tasks/todo.md`
- Implicit: `git push`

- [ ] **Step 1: Update `tasks/todo.md`**

Read the file. Change the `## NEXT SESSION — S041` block to `## NEXT SESSION — S042`. Update the cold-start tip to whatever the current HEAD will be after Task 3's commit (you can leave a placeholder `<S041 close>` and patch later, or use the actual SHA after committing).

Insert a new `## Completed in S041 (26/APR/2026, Home PC)` section IMMEDIATELY ABOVE the existing `## Completed in S040` section:

```markdown
## Completed in S041 (26/APR/2026, Home PC)

### Slice 2B-B — Admin "Generate ref link" UI

- [x] AdminMatches data layer extended — `loadAll` now fetches `ref_tokens` (active only) alongside matchdays/matches/drafts; tokens merged onto each `MatchdayWithMatch` as optional `activeToken: { expires_at }`.
- [x] `formatExpiresIn(iso)` helper for the chip ("expires in 4h 22m" / "expires in 12m" / "expired").
- [x] `RefLinkSection` rendered conditionally on `roster_locked_at` inside MatchdayCard. Two states (no token = dashed Generate CTA; active token = gold-tinted button with expiry chip + 🔄 icon).
- [x] `RefLinkSheet` portal opens on Generate / Regenerate. Read-only URL input + 📋 Copy (clipboard API + toast feedback) + 💬 Share to WhatsApp (`https://wa.me/?text=` deep link). Explanation copy: "Shown once — regenerate to share again."
- [x] Single shared handler `handleMintRefLink(md)` calls `regenerate_ref_token(p_matchday_id)` RPC, captures the raw token from the response, opens the sheet with it, then re-runs `loadAll()` so the card chip shows the fresh expiry.
- [x] CSS under `.admin-ref-link-*` namespace (~60 LOC) using brand tokens (gold accent for active, dashed border for generate, monospace URL field).
- [x] Build clean: tsc -b EXIT 0; vite build EXIT 0.
- [x] No backend changes. Migrations on live DB stay at 28.

### S041 gotchas / lessons (additive)

- **Raw token is one-shot in memory.** The RPC returns the plaintext token only at mint; Postgres stores `sha256(token)` only. The sheet must capture the URL the moment the RPC resolves and never persist it. If the admin navigates away or the sheet closes, the URL is gone forever — they must regenerate. Pattern: keep the raw token in `useState` (not in any persistent store, not in the matchday row).
- **`loadAll` fan-out for derived per-row state.** When a card needs auxiliary data that lives in a different table (here: `ref_tokens` per matchday), fetch it as a fourth `Promise.all` branch in the same load function and merge into the row type via a Map lookup. Keeps a single source of truth for the page state and avoids per-card `useEffect` queries that would N+1.
- **Portal sheets pattern reused.** `<RefLinkSheet>` follows the same `createPortal(<scrim onClick={onClose}><sheet onClick={stopPropagation}>...</sheet></scrim>, document.body)` pattern as `<ConfirmSheet>` — including the grabber div, safe-area-bottom padding, and scrim-tap-to-close.
- **WhatsApp deep link via `wa.me`.** `https://wa.me/?text=<encoded>` opens the app on mobile and Web WhatsApp on desktop. The phone number is omitted (no `?phone=`) so the user picks the recipient. `target="_blank"` + `rel="noreferrer noopener"` is the safe default.
- **Toast on copy without auto-close.** Opening the sheet → tap 📋 Copy → toast "Link copied" appears, but the sheet stays open so the admin can also tap 💬 Share to WhatsApp afterward. Closing only happens on explicit `Done` or scrim-tap.
```

Update the S042 NEXT block:

```markdown
## NEXT SESSION — S042

**Cold-start checklist:**
- **MANDATORY session-start sync** per CLAUDE.md Cross-PC protocol.
- Expected tip: `<S041 close commit>` or later (S041 slice 2B-B close).
- Migrations on live DB: **28** (unchanged from S040).

**S042 agenda:**

1. **Slice 2B-C** — RefEntry pre-match mode. Token URL `/ref/:token` opens to roster confirmation + KICK OFF button + screen-wake lock. Calls a new public-RPC `get_ref_matchday(token)` to fetch matchday + rosters anonymously (token validates server-side; sha256 lookup per slice 2B-A pattern). Persist start-timestamp to `localStorage[ffc_ref_<sha256>]` so refresh survives.
2. Carry-over backlog still pending acceptance: S031 21-item checklist, S032/33/34/35 acceptance items.
3. Captain reroll live test — deferred until MD31 runs in-app.
```

- [ ] **Step 2: Commit + push**

```bash
git add tasks/todo.md
git commit -m "$(cat <<'EOF'
docs(s041,2b-b): close-out — todo.md S041 completion + S042 agenda

Slice 2B-B fully shipped — admin can generate / copy / regenerate /
share ref links from each matchday card. No backend changes.
EOF
)"
git push
```

Expected push:
```
To https://github.com/mmuwahid/FFC.git
   ec39083..<new>  main -> main
```

After push, run `git log --oneline -5` to confirm three slice 2B-B commits on top of `ec39083`.

- [ ] **Step 3: Sanity-check the deploy**

Vercel auto-deploys on push to `main`. The build will take ~20 s. After:

```bash
npx --yes vercel ls 2>&1 | head -3
```
or just visit the production site and load `/admin/matches`. Confirm:
- A locked matchday card shows the Ref link section (either Generate CTA or active chip).
- Tapping Generate opens the sheet with a real URL.
- The URL pattern matches `https://ffc-gilt.vercel.app/ref/<32-char-base64url>`.
- Refreshing the page makes the card show the active-token chip with countdown.

If anything's off, this is the moment to roll back — run `git revert HEAD~3..HEAD` and push.

---

## Acceptance criteria — Slice 2B-B

- [ ] `AdminMatches.tsx` carries `activeToken` on each `MatchdayWithMatch`.
- [ ] `loadAll` fetches `ref_tokens WHERE consumed_at IS NULL AND expires_at > now()`.
- [ ] `RefLinkSection` renders only when `roster_locked_at IS NOT NULL`.
- [ ] No active token → Generate CTA visible.
- [ ] Active token → expiry chip ("expires in Xh Ym") + 🔄 icon visible.
- [ ] Tapping either → calls `regenerate_ref_token(p_matchday_id)` → opens `RefLinkSheet` with the raw URL.
- [ ] Sheet has 📋 Copy + 💬 Share to WhatsApp + Done.
- [ ] Copy fires `navigator.clipboard.writeText(url)` and surfaces toast.
- [ ] WhatsApp link is a `https://wa.me/?text=…` URL with the message format.
- [ ] tsc -b EXIT 0; vite build EXIT 0.
- [ ] Production site reflects the change after Vercel auto-deploy.
- [ ] No backend changes (migration count stays 28).
- [ ] No other source files modified outside the two listed.

---

## Out of scope for Slice 2B-B (deferred)

- The actual ref console UI (`/ref/:token` opens to a real screen) → slice 2B-C through 2B-E.
- The admin review screen `/admin/match-entries/:id` → slice 2B-F.
- Phase 2A push delivery → slices 2A-A onward.
- A token-already-exists confirmation modal before regenerate (optional polish for slice 2B-F).

---

## Risks + recovery

| Risk | Mitigation |
|---|---|
| Clipboard API blocked on insecure context | Production is HTTPS so this only affects local dev. Fallback: input gets focused so user can long-press / Ctrl+C. |
| RPC fails (auth lapse, network) | `setError(error.message)` surfaces in the existing error banner; no sheet opens. |
| Two admins click Generate on the same matchday concurrently | Slice 2B-A added `pg_advisory_xact_lock` per matchday — second call serialises after first; both succeed but only the second token is active (first was burned by the second's UPDATE). UX outcome: both admins see different URLs; only the second one works. Acceptable. |
| WhatsApp link fails on iOS Safari | `wa.me` is the canonical Meta-blessed URL scheme; works on iOS WhatsApp ≥ 2.21. If user reports breakage, fall back to `whatsapp://send?text=`. |
| Existing admins clicking Regenerate during a live match would break the ref's submission | `submit_ref_entry` validates against `consumed_at IS NULL AND expires_at > now()`. Regenerate sets the OLD token's `consumed_at = now()`, which means the ref's old URL stops working immediately. **This is correct behaviour** — admin warned by the regenerate button's title attribute ("burns the previous one"). UX safety fence: 2B-B does NOT add a confirm step before regenerate; the cost of a fast-tap is "ref needs the new link" which is recoverable. |

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-26-phase2-slice-2B-B.md`.**
