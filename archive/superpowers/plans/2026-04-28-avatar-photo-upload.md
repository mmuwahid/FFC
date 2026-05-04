# Plan: Profile Avatar Photo Upload

**Date:** 2026-04-28
**Scope:** Allow users to upload a profile photo by taking a direct camera shot or choosing from camera roll. Only available when viewing your own profile (`isSelf`). Supports removing an existing photo.

---

## Files to create/modify

| File | Action |
|------|--------|
| `supabase/migrations/0037_avatars_storage.sql` | **CREATE** — already written |
| `ffc/src/pages/ProfileAvatarSheet.tsx` | **CREATE** — sibling component |
| `ffc/src/pages/Profile.tsx` | **MODIFY** — ~68 lines added |
| `ffc/src/index.css` | **MODIFY** — ~30 lines added at end of `.pf-*` section |

---

## Task 1 — Migration 0037 (already written)

File: `supabase/migrations/0037_avatars_storage.sql`

Creates a public `avatars` bucket (2 MB limit, JPEG/PNG/WebP) and 4 RLS policies:

- `avatars_public_read` — SELECT TO public USING bucket_id = 'avatars'
- `avatars_self_insert` — INSERT TO authenticated WITH CHECK bucket_id = 'avatars' AND name = `current_profile_id()::text || '.jpg'`
- `avatars_self_update` — UPDATE TO authenticated (same guard on both USING + WITH CHECK)
- `avatars_self_delete` — DELETE TO authenticated USING same guard

All DROP IF EXISTS prefixed for idempotency.

**Apply:** `npx supabase db push --linked` from `FFC/` root.

**Verify:** anon-key curl to upload should return 403; authenticated upload to `{own_profile_id}.jpg` should return 200.

> **Note on `current_profile_id()`:** This SECURITY DEFINER function (migration 0007) returns `profiles.id` for the authenticated user. If storage RLS doesn't resolve it correctly (empirical test needed), fall back to the inline subquery:
> ```sql
> name = (SELECT id::text FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1) || '.jpg'
> ```

---

## Task 2 — Create `ProfileAvatarSheet.tsx`

Path: `ffc/src/pages/ProfileAvatarSheet.tsx`

Exports:
1. `compressImage(file: File): Promise<Blob>` — Canvas API, max 400px, JPEG @ 85%
2. `AvatarSheetProps` interface
3. `AvatarSheet` component

```tsx
import { type ChangeEvent, type RefObject } from 'react'

export async function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const MAX = 400
      let { width, height } = img
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX }
        else { width = Math.round(width * MAX / height); height = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Compression failed'))),
        'image/jpeg', 0.85,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')) }
    img.src = url
  })
}

export interface AvatarSheetProps {
  uploading: boolean
  error: string | null
  hasAvatar: boolean
  cameraInputRef: RefObject<HTMLInputElement | null>
  galleryInputRef: RefObject<HTMLInputElement | null>
  onRemove: () => void
  onClose: () => void
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void
}

export function AvatarSheet({
  uploading, error, hasAvatar,
  cameraInputRef, galleryInputRef,
  onRemove, onClose, onFileChange,
}: AvatarSheetProps) {
  return (
    <div className="pf-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="pf-sheet" role="dialog" aria-modal aria-label="Change profile photo">
        <div className="pf-sheet-title">Change photo</div>
        {error && <div className="pf-sheet-error" style={{ marginBottom: 10 }}>{error}</div>}
        {uploading ? (
          <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Uploading…
          </div>
        ) : (
          <div className="pf-avatar-opts">
            <button className="pf-avatar-opt" onClick={() => cameraInputRef.current?.click()}>
              📷 Take a photo
            </button>
            <button className="pf-avatar-opt" onClick={() => galleryInputRef.current?.click()}>
              🖼 Choose from library
            </button>
            {hasAvatar && (
              <button className="pf-avatar-opt pf-avatar-opt--danger" onClick={onRemove}>
                🗑 Remove photo
              </button>
            )}
            <button className="pf-avatar-opt pf-avatar-opt--cancel" onClick={onClose}>
              Cancel
            </button>
          </div>
        )}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="user"
          style={{ display: 'none' }}
          onChange={onFileChange}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onFileChange}
        />
      </div>
    </div>
  )
}
```

---

## Task 3 — Modify `Profile.tsx`

### 3a. Add import (after existing imports)
```tsx
import { AvatarSheet, compressImage } from './ProfileAvatarSheet'
```

### 3b. Add state + refs (after `const [saving, setSaving] = useState(false)`)
```tsx
const [avatarSheetOpen, setAvatarSheetOpen] = useState(false)
const [avatarUploading, setAvatarUploading] = useState(false)
const [avatarError, setAvatarError] = useState<string | null>(null)
const cameraInputRef = useRef<HTMLInputElement>(null)
const galleryInputRef = useRef<HTMLInputElement>(null)
```

### 3c. Add handlers (after `handleSavePositions`)
```tsx
async function handleAvatarFile(e: ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0]
  if (!file || !profile) return
  e.target.value = ''
  setAvatarUploading(true)
  setAvatarError(null)
  try {
    const blob = await compressImage(file)
    const path = `${profile.id}.jpg`
    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
    if (upErr) throw upErr
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
    const urlWithBust = `${publicUrl}?t=${Date.now()}`
    const { error: dbErr } = await supabase
      .from('profiles')
      .update({ avatar_url: urlWithBust })
      .eq('id', profile.id)
    if (dbErr) throw dbErr
    setProfile((prev) => prev ? { ...prev, avatar_url: urlWithBust } : prev)
    setAvatarSheetOpen(false)
  } catch (err: unknown) {
    setAvatarError(err instanceof Error ? err.message : 'Upload failed')
  } finally {
    setAvatarUploading(false)
  }
}

async function handleRemoveAvatar() {
  if (!profile) return
  setAvatarUploading(true)
  setAvatarError(null)
  try {
    await supabase.storage.from('avatars').remove([`${profile.id}.jpg`])
    const { error: dbErr } = await supabase
      .from('profiles')
      .update({ avatar_url: null })
      .eq('id', profile.id)
    if (dbErr) throw dbErr
    setProfile((prev) => prev ? { ...prev, avatar_url: null } : prev)
    setAvatarSheetOpen(false)
  } catch (err: unknown) {
    setAvatarError(err instanceof Error ? err.message : 'Remove failed')
  } finally {
    setAvatarUploading(false)
  }
}
```

### 3d. Replace hero avatar section

**Before** (lines ~844–856 in current Profile.tsx):
```tsx
{profile.avatar_url ? (
  <img
    src={profile.avatar_url}
    alt={profile.display_name}
    className={`pf-avatar${!isSelf ? ' pf-avatar--other' : ''}`}
  />
) : (
  <div className={`pf-avatar${!isSelf ? ' pf-avatar--other' : ''}`}>
    {initials}
  </div>
)}
```

**After:**
```tsx
{isSelf ? (
  <button
    className="pf-avatar-wrap"
    onClick={() => { setAvatarError(null); setAvatarSheetOpen(true) }}
    disabled={avatarUploading}
    aria-label="Change profile photo"
  >
    {profile.avatar_url ? (
      <img src={profile.avatar_url} alt={profile.display_name} className="pf-avatar" />
    ) : (
      <span className="pf-avatar">{initials}</span>
    )}
    {avatarUploading ? (
      <span className="pf-avatar-busy" aria-hidden>⏳</span>
    ) : (
      <span className="pf-avatar-cam" aria-hidden>📷</span>
    )}
  </button>
) : (
  <>
    {profile.avatar_url ? (
      <img src={profile.avatar_url} alt={profile.display_name} className="pf-avatar pf-avatar--other" />
    ) : (
      <div className="pf-avatar pf-avatar--other">{initials}</div>
    )}
  </>
)}
```

### 3e. Add sheet JSX (just before the closing `</div>` of the root element)
```tsx
{avatarSheetOpen && (
  <AvatarSheet
    uploading={avatarUploading}
    error={avatarError}
    hasAvatar={!!profile?.avatar_url}
    cameraInputRef={cameraInputRef}
    galleryInputRef={galleryInputRef}
    onRemove={handleRemoveAvatar}
    onClose={() => setAvatarSheetOpen(false)}
    onFileChange={handleAvatarFile}
  />
)}
```

### 3f. Ensure `ChangeEvent` is imported from React
Add `ChangeEvent` to the React import if not already present.

---

## Task 4 — CSS additions in `index.css`

Append after the existing `.pf-avatar--other` rule:

```css
/* --- avatar upload affordance --- */
.pf-avatar-wrap {
  position: relative;
  flex-shrink: 0;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  border-radius: 22px;
  line-height: 0;
}
.pf-avatar-wrap .pf-avatar {
  display: block;
}
.pf-avatar-cam {
  position: absolute;
  bottom: -3px;
  right: -3px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--bg);
  display: grid;
  place-items: center;
  font-size: 13px;
  line-height: 1;
  pointer-events: none;
}
.pf-avatar-busy {
  position: absolute;
  inset: 0;
  border-radius: 22px;
  background: rgba(0, 0, 0, 0.45);
  display: grid;
  place-items: center;
  font-size: 18px;
  color: #fff;
  pointer-events: none;
}
.pf-avatar-opts {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}
.pf-avatar-opt {
  width: 100%;
  padding: 14px 16px;
  background: var(--surface-2);
  border: none;
  border-radius: 12px;
  color: var(--text);
  font-size: 15px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}
.pf-avatar-opt--danger { color: var(--danger); }
.pf-avatar-opt--cancel {
  background: transparent;
  color: var(--text-muted);
  margin-top: 4px;
}
```

---

## Task 5 — Apply migration

```bash
cd "C:/Users/User/OneDrive - United Engineering Construction/11 - AI & Digital/Works In Progress/FFC"
npx supabase db push --linked
```

Expected: migration 0037 applied, `avatars` bucket visible in Supabase dashboard.

**Smoke test** (replace `<profile_id>` with your actual profile ID):
```bash
# Should fail with 403 (anon cannot upload)
curl -s -X POST \
  "https://hylarwwsedjxwavuwjrn.supabase.co/storage/v1/object/avatars/<profile_id>.jpg" \
  -H "apikey: <anon_key>" \
  -H "Content-Type: image/jpeg" \
  --data-binary "@test.jpg" | jq .
```

---

## Task 6 — Build verification

```bash
cd ffc
node ./node_modules/typescript/bin/tsc -b
npx vite build
```

Expected: EXIT 0 for both.

---

## Key correctness invariants

1. **Storage path = `profiles.id` (not `auth.uid()`)** — enforced via `current_profile_id()` in RLS
2. **`upsert: true`** on upload — overwrites existing file without error
3. **Cache-bust `?t=Date.now()`** appended to stored `avatar_url` — forces browser re-fetch
4. **`<span>` not `<div>` inside `<button>`** — HTML validity (div-in-button is invalid)
5. **`disabled={avatarUploading}`** on the wrap button — prevents double-tap race
6. **`e.target.value = ''` reset** after file pick — allows re-picking same file
7. **Storage `.remove()` on avatar delete** — cleanup before nulling DB column; ignore storage error if file never existed
