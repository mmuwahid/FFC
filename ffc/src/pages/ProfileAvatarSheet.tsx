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
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Compression failed'))),
        'image/jpeg',
        0.85,
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
  uploading,
  error,
  hasAvatar,
  cameraInputRef,
  galleryInputRef,
  onRemove,
  onClose,
  onFileChange,
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
