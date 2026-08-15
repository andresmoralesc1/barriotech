'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { Plus, X, Image as ImageIcon, Loader2 } from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import { ConfirmPhotoDeleteModal } from './ConfirmPhotoDeleteModal'

/**
 * N12 — Multi-photo uploader (URL-based, max 6 photos).
 * Lets the seller paste image URLs (or upload via storage in future).
 * For MVP: URL paste; storage upload will be a follow-up.
 *
 * Audit-2026-07-19 follow-ups:
 *   - A: confirmation modal before deleting a photo (was instant, risked
 *        accidental clicks deleting a seller's gallery).
 *   - B: drag-and-drop reordering (HTML5 DnD, no extra dep). Persisted
 *        with PATCH /api/products/[id]/photos (new endpoint).
 */
interface MultiPhotoUploaderProps {
  productId: string
  initialPhotos?: { id: string; url: string; position: number }[]
  onChange?: (photos: { id: string; url: string; position: number }[]) => void
  // G: optional callback fired whenever the photo set diverges from the
  // initial set (add, delete, reorder). Lets the parent show its own modal
  // before navigation since the in-page beforeunload handler only covers
  // tab close / refresh.
  onDirtyChange?: (isDirty: boolean) => void
}

interface Photo {
  id: string
  url: string
  position: number
}

export function MultiPhotoUploader({ productId, initialPhotos = [], onChange, onDirtyChange }: MultiPhotoUploaderProps) {
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos)
  const [newUrl, setNewUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [reordering, setReordering] = useState(false)
  // A: confirmation modal state. null = no dialog.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmDeleting, setConfirmDeleting] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const fetchedRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Drag-and-drop state (B).
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  // G: dirty tracking. A photo set is "dirty" whenever the current array
  // differs from the initial set the component mounted with. We compare by id
  // + order since position is what we persist on the server.
  const isDirty = useMemo(() => {
    if (photos.length !== initialPhotos.length) return true
    for (let i = 0; i < photos.length; i++) {
      if (photos[i].id !== initialPhotos[i]?.id) return true
    }
    return false
  }, [photos, initialPhotos])

  // G: notify parent (e.g. /products page) so it can show its own modal when
  // the user tries to navigate away via an internal link.
  useEffect(() => {
    onChange?.(photos)
    onDirtyChange?.(isDirty)
  }, [photos, isDirty, onChange, onDirtyChange])

  // G: warn before tab close / refresh if there are unsaved changes. The
  // browser shows its own native modal; we just set the flag.
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Chrome requires returnValue to be set.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  useEffect(() => {
    if (fetchedRef.current || initialPhotos.length > 0) return
    fetchedRef.current = true
    fetch(`/api/products/${productId}/photos`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : { photos: [] })
      .then((data) => {
        const list = (data.photos || []) as Photo[]
        setPhotos(list)
        onChange?.(list)
      })
      .catch(() => {})
  }, [productId, initialPhotos.length, onChange])

  const addPhoto = async () => {
    if (!newUrl.trim()) return
    setAdding(true)
    try {
      const res = await fetch(`/api/products/${productId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url: newUrl.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        const next = [...photos, data.photo]
        setPhotos(next)
        onChange?.(next)
        setNewUrl('')
        toast({ title: 'Foto agregada ✓', kind: 'success' })
      } else {
        toast({ title: data.error || 'Error al agregar foto', kind: 'error' })
      }
    } catch {
      toast({ title: 'Error de conexión', kind: 'error' })
    } finally {
      setAdding(false)
    }
  }

  // File picker flow: upload the file to /api/upload, then register the
  // returned /storage/... URL as a photo on this product. The dedicated
  // /api/products/[id]/photos endpoint persists position, owner-check and
  // cap (max 6) consistently with the URL path.
  // FIELD-FIX (2026-07-27): HEIC/HEIF (iPhone) early-rejection — same
  // helper as ImageUpload. See components/ui/ImageUpload.tsx for why we
  // detect+reject instead of converting (bundle cost vs field usage).
  const isHeic = (f: File): boolean => {
    if (f.type === 'image/heic' || f.type === 'image/heif') return true
    const name = f.name.toLowerCase()
    return name.endsWith('.heic') || name.endsWith('.heif')
  }
  const HEIC_MSG =
    'Tu foto está en formato HEIC (iPhone). En tu iPhone ve a Ajustes → ' +
    'Cámara → Formatos → "Más compatible" para tomar fotos en JPEG, o ' +
    'comparte la foto por WhatsApp y súbela desde ahí (se convierte a JPEG).'

  const SIZE_MSG = 'La imagen es demasiado grande. Máximo 10MB.'

  const handleFileSelected = async (file: File) => {
    if (uploading) return
    // Audit 2026-08-14 (M6): pre-check size client-side. ImageUpload
    // already had this; MultiPhotoUploader missed the cap and uploaded
    // the full file before getting a 400 from the server. Cap matches
    // /api/upload route on the server.
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: SIZE_MSG, kind: 'error' })
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    if (isHeic(file)) {
      toast({ title: HEIC_MSG, kind: 'error' })
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', 'products')
      const upRes = await fetch('/api/upload', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      })
      const upData = await upRes.json().catch(() => ({}))
      if (!upRes.ok) {
        toast({ title: upData.error || 'Error al subir el archivo', kind: 'error' })
        return
      }
      const url: string = upData.url
      const regRes = await fetch(`/api/products/${productId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url }),
      })
      const regData = await regRes.json().catch(() => ({}))
      if (!regRes.ok) {
        toast({ title: regData.error || 'Error al registrar la foto', kind: 'error' })
        return
      }
      const next = [...photos, regData.photo]
      setPhotos(next)
      onChange?.(next)
      toast({ title: 'Foto agregada ✓', kind: 'success' })
    } catch {
      toast({ title: 'Error de conexión', kind: 'error' })
    } finally {
      setUploading(false)
      // Reset input so picking the same file again re-triggers onChange.
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // A: confirmation flow. Called only after the user clicks "Eliminar" in
  // the modal — `removePhoto` is now the actual delete handler.
  // B-031 fix: photoId in URL path (REST convention) instead of body.
  // Some CDNs/proxies strip DELETE bodies, breaking the previous endpoint.
  const removePhoto = async (photoId: string) => {
    setConfirmDeleting(true)
    setConfirmError(null)
    try {
      const res = await fetch(
        `/api/products/${productId}/photos/${encodeURIComponent(photoId)}`,
        {
          method: 'DELETE',
          credentials: 'include',
        }
      )
      if (res.ok) {
        const next = photos.filter((p) => p.id !== photoId)
        setPhotos(next)
        onChange?.(next)
        toast({ title: 'Foto eliminada', kind: 'info' })
        setConfirmDeleteId(null)
      } else {
        const data = await res.json().catch(() => ({}))
        setConfirmError(data.error || 'Error al eliminar')
      }
    } catch {
      setConfirmError('Error de conexión')
    } finally {
      setConfirmDeleting(false)
    }
  }

  // B: re-ordering. After drop we send the new order to the server.
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverId(id)
  }
  const handleDragLeave = () => setDragOverId(null)
  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    const sourceId = e.dataTransfer.getData('text/plain') || draggingId
    setDraggingId(null)
    setDragOverId(null)
    if (!sourceId || sourceId === targetId) return
    const sourceIdx = photos.findIndex((p) => p.id === sourceId)
    const targetIdx = photos.findIndex((p) => p.id === targetId)
    if (sourceIdx === -1 || targetIdx === -1) return
    const next = [...photos]
    const [moved] = next.splice(sourceIdx, 1)
    next.splice(targetIdx, 0, moved)
    // Optimistic update.
    setPhotos(next)
    onChange?.(next)
    // Persist new order on the server.
    setReordering(true)
    try {
      const res = await fetch(`/api/products/${productId}/photos`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ order: next.map((p) => p.id) }),
      })
      if (!res.ok) {
        // Audit 2026-08-14 (M5): use functional setter to roll back — the
        // captured `photos` snapshot is stale after the await; the
        // correct rollback is whatever the last committed state was.
        setPhotos((prev) => {
          onChange?.(prev)
          return prev
        })
        const data = await res.json().catch(() => ({}))
        toast({ title: data.error || 'No se pudo reordenar', kind: 'error' })
      } else {
        toast({ title: 'Orden actualizado ✓', kind: 'success' })
      }
    } catch {
      setPhotos(photos)
      onChange?.(photos)
      toast({ title: 'Error de conexión', kind: 'error' })
    } finally {
      setReordering(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {photos.map((photo) => (
          <div
            key={photo.id}
            draggable
            onDragStart={(e) => handleDragStart(e, photo.id)}
            onDragOver={(e) => handleDragOver(e, photo.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, photo.id)}
            className={`relative aspect-square rounded-lg overflow-hidden bg-gray-100 cursor-move transition-all ${
              dragOverId === photo.id ? 'ring-2 ring-primary scale-105' : ''
            } ${draggingId === photo.id ? 'opacity-40' : ''}`}
            aria-label={`Foto ${photo.position + 1}: arrastrable para reordenar`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {/* B-030 fix: alt was empty (decorative). These are product photos
                (informative), so screen readers should hear position info. */}
            <img src={photo.url} alt={`Foto ${photo.position + 1}`} className="w-full h-full object-cover pointer-events-none" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setConfirmDeleteId(photo.id)
                setConfirmError(null)
              }}
              aria-label="Eliminar foto"
              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 z-10"
            >
              <X size={12} />
            </button>
            {photo.position === 0 && (
              <span className="absolute bottom-1 left-1 text-[10px] bg-primary text-white px-1.5 py-0.5 rounded">
                Principal
              </span>
            )}
            <span className="absolute bottom-1 right-1 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">
              #{photo.position + 1}
            </span>
          </div>
        ))}
        {photos.length < 6 && (
          <>
            {/* Hidden file input — clicking the "+" tile or the "Subir"
                button opens the picker. After selection, handleFileSelected
                uploads to /api/upload then registers the URL. */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              aria-label="Subir foto desde tu dispositivo"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFileSelected(f)
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              aria-label={uploading ? 'Subiendo foto…' : 'Subir foto (abrir selector de archivos)'}
              className="aspect-square rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:border-primary hover:text-primary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <>
                  <Loader2 size={22} className="animate-spin" />
                  <span className="text-[10px] mt-1">Subiendo…</span>
                </>
              ) : (
                <>
                  <Plus size={22} aria-hidden="true" />
                  <span className="text-[10px] mt-1">Subir foto</span>
                </>
              )}
            </button>
          </>
        )}
      </div>

      {photos.length < 6 && (
        <div className="flex items-center gap-2">
          <input
            type="url"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://... o /products/cali/imagen.jpg"
            aria-label="URL de nueva foto"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <button
            type="button"
            onClick={addPhoto}
            disabled={adding || !newUrl.trim()}
            className="px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
          >
            <Plus size={14} />
            {adding ? '...' : 'Añadir'}
          </button>
        </div>
      )}
      <p className="text-xs text-gray-500">
        {photos.length}/6 fotos. Arrastra para reordenar. La primera es la principal.
        {reordering && ' · Guardando orden…'}
      </p>

      {/* A: confirmation modal — extracted to ConfirmPhotoDeleteModal
          (2026-07-21) to keep this file focused on the uploader UI. */}
      <ConfirmPhotoDeleteModal
        photoId={confirmDeleteId}
        deleting={confirmDeleting}
        error={confirmError}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => confirmDeleteId && removePhoto(confirmDeleteId)}
      />
    </div>
  )
}
