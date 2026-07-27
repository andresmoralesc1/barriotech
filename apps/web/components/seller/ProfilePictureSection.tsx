'use client'

import { Card } from '@/components/ui/Card'
import { ImageUpload } from '@/components/ui/ImageUpload'

interface Props {
  photoUrl: string
  onPhotoChange: (url: string) => void
}

/**
 * "Foto del negocio" card. Single ImageUpload + a small caption. Kept
 * standalone because the layout is the only thing that differs from the
 * vehicle photo card below — same ImageUpload, different copy + folder.
 */
export function ProfilePictureSection({ photoUrl, onPhotoChange }: Props) {
  return (
    <Card variant="outlined" className="p-4">
      <div className="flex items-center gap-4">
        <ImageUpload
          value={photoUrl}
          onChange={onPhotoChange}
          folder="vendors"
        />
        <div>
          <p className="text-sm font-medium text-gray-700">Foto del negocio</p>
          {/* FIELD-FIX v4 (2026-07-27): synced to the 10MB cap enforced by
              /api/upload + ImageUpload.tsx. The 5MB number here was stale
              copy from before the cap was raised. */}
          <p className="text-xs text-gray-400">PNG o JPG, máx 10MB</p>
        </div>
      </div>
    </Card>
  )
}