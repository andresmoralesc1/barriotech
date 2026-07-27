'use client'

import { useRef, useState } from 'react'
import { Camera, Upload, X, Loader2 } from 'lucide-react'

interface ImageUploadProps {
  value?: string
  onChange: (url: string) => void
  folder?: string
  accept?: string
  className?: string
}

export function ImageUpload({
  value,
  onChange,
  folder = 'misc',
  accept = 'image/*',
  className = '',
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')

  // FIELD-FIX (2026-07-27): iPhone cameras default to HEIC/HEIF which the
// /api/upload backend rejects (only jpeg/png/gif/webp magic bytes are
// whitelisted). Detect this BEFORE the upload roundtrip so the seller
// gets a clear message instead of a generic "Error al subir" toast.
// Conversion (heic2any / sharp) was considered but skipped — adds 170KB
// to the bundle for an edge case, and most field-agent Android phones
// don't hit it. If usage data shows HEIC is common we can revisit.
const isHeic = (f: File): boolean => {
  if (f.type === 'image/heic' || f.type === 'image/heif') return true
  const name = f.name.toLowerCase()
  return name.endsWith('.heic') || name.endsWith('.heif')
}

const HEIC_MSG =
  'Tu foto está en formato HEIC (iPhone). En tu iPhone ve a Ajustes → ' +
  'Cámara → Formatos → "Más compatible" para tomar fotos en JPEG, o ' +
  'comparte la foto por WhatsApp y súbela desde ahí (se convierte a JPEG).'

const uploadFile = async (file: File) => {
    // FIELD-FIX (2026-07-27): mirror the 10MB backend cap. The 5MB
    // mismatch was making the client-side check stricter than the
    // server (upload would pass client-side at 6MB and fail at the
    // server with a generic 413). Now both ends say 10MB.
    if (file.size > 10 * 1024 * 1024) {
      setError('Máximo 10MB')
      return
    }
    if (isHeic(file)) {
      setError(HEIC_MSG)
      return
    }

    setUploading(true)
    setError('')

    const formData = new FormData()
    formData.append('file', file)
    formData.append('folder', folder)

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error || 'Error al subir')
      setUploading(false)
      return
    }

    const { url } = await res.json()
    onChange(url)
    setUploading(false)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadFile(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) {
      uploadFile(file)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }

  const handleDragLeave = () => setDragging(false)

  // Use value directly as src — value is already the /storage/... path
  const previewSrc = value || null

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleFileChange}
        className="hidden"
      />

      {previewSrc ? (
        <div className="relative w-24 h-24 rounded-xl overflow-hidden group">
          <img src={previewSrc} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <button
              onClick={() => inputRef.current?.click()}
              className="p-1.5 bg-white rounded-full text-gray-700 hover:bg-gray-100"
              disabled={uploading}
            >
              <Camera size={16} />
            </button>
            <button
              onClick={() => onChange('')}
              className="p-1.5 bg-white rounded-full text-red-500 hover:bg-red-50"
            >
              <X size={16} />
            </button>
          </div>
          {uploading && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <Loader2 size={20} className="text-white animate-spin" />
            </div>
          )}
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => inputRef.current?.click()}
          className={`
            w-24 h-24 rounded-xl border-2 border-dashed cursor-pointer
            flex flex-col items-center justify-center gap-1
            transition-colors text-xs text-center p-2
            ${dragging ? 'border-primary bg-orange-50 text-primary-700' : 'border-gray-300 text-gray-400 hover:border-primary hover:text-primary-700'}
          `}
        >
          {uploading ? (
            <>
              <Loader2 size={20} className="animate-spin text-primary-700" />
              <span>Subiendo...</span>
            </>
          ) : (
            <>
              <Upload size={20} />
              <span>Subir foto</span>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="text-red-500 text-xs mt-1">{error}</p>
      )}
    </div>
  )
}
