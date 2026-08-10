'use client'

/**
 * Client (buyer) detail drawer — right-side overlay with the buyer's
 * full profile, activity stats, admin actions, and admin notes.
 *
 * Mirrors VendorDetailDrawer in structure but:
 *   - No vendor-level sections (this is a buyer, not a vendor)
 *   - Adds stats (orders, favorites, reviews) so an admin can spot
 *     fake or abandoned accounts at a glance
 *   - Shows admin notes section (read-only history + new note form)
 *
 * Fetches fresh data when it opens so it's never stale. On action
 * success the parent refreshes the list and the drawer reflects the
 * new state locally.
 *
 * Notes are scoped to this department's API contract:
 *   - GET /api/admin/notes?targetType=user&targetId=<id>
 *   - POST /api/admin/notes  body { targetType, targetId, body }
 *   - DELETE /api/admin/notes/[id]
 * The list is updated optimistically on a successful POST so the
 * admin sees their note appear without a roundtrip.
 */

import { useEffect, useState } from 'react'

interface ClientDetail {
  id: string
  email: string | null
  name: string
  phone: string | null
  cityId: string | null
  isActive: boolean
  emailVerified: boolean
  createdAt: string
  lastLoginAt: string | null
  stats: {
    orderCount: number
    favoriteCount: number
    reviewCount: number
  }
}

interface AdminNote {
  id: string
  target_type: 'user' | 'vendor'
  target_id: string
  author_id: string
  author_email: string | null
  author_name: string
  body: string
  created_at: string
}

export function ClientDetailDrawer({
  clientId,
  onClose,
  onAction,
}: {
  clientId: string
  onClose: () => void
  onAction: (id: string, body: { isActive?: boolean; emailVerified?: boolean }) => Promise<void>
}) {
  const [client, setClient] = useState<ClientDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const [notes, setNotes] = useState<AdminNote[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [notePending, setNotePending] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/admin/clients/${clientId}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}))
          throw new Error(data.error ?? `Error ${r.status}`)
        }
        return r.json()
      })
      .then((data) => {
        setClient(data.client)
        setLoading(false)
      })
      .catch((e) => {
        setError(e.message)
        setLoading(false)
      })
  }, [clientId])

  // Notes fetched on mount and after every successful POST/DELETE.
  const loadNotes = async () => {
    setNotesLoading(true)
    try {
      const r = await fetch(`/api/admin/notes?targetType=user&targetId=${clientId}`)
      if (r.ok) {
        const data = await r.json()
        setNotes(data.notes ?? [])
      }
    } catch {
      // Silent — notes section is best-effort, the rest of the drawer
      // still works. The note form will surface its own errors.
    } finally {
      setNotesLoading(false)
    }
  }

  useEffect(() => {
    loadNotes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const doAction = async (body: { isActive?: boolean; emailVerified?: boolean }) => {
    setActionPending(true)
    setActionError(null)
    try {
      await onAction(clientId, body)
      if (client) {
        setClient({
          ...client,
          isActive: body.isActive ?? client.isActive,
          emailVerified: body.emailVerified ?? client.emailVerified,
        })
      }
    } catch (e: any) {
      setActionError(e.message ?? 'Error desconocido')
    } finally {
      setActionPending(false)
    }
  }

  const submitNote = async () => {
    const trimmed = noteDraft.trim()
    if (trimmed.length === 0) {
      setNoteError('La nota no puede estar vacía')
      return
    }
    if (trimmed.length > 2000) {
      setNoteError('La nota no puede superar 2000 caracteres')
      return
    }
    setNotePending(true)
    setNoteError(null)
    try {
      const r = await fetch('/api/admin/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: 'user',
          targetId: clientId,
          body: trimmed,
        }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${r.status}`)
      }
      const data = await r.json()
      // Optimistic insert at the top (notes are ordered DESC).
      setNotes((prev) => [
        {
          ...(data.note as Omit<AdminNote, 'author_email' | 'author_name'>),
          author_email: null,
          author_name: 'Tú',
        },
        ...prev,
      ])
      setNoteDraft('')
    } catch (e: any) {
      setNoteError(e.message ?? 'Error desconocido')
    } finally {
      setNotePending(false)
    }
  }

  const deleteNote = async (noteId: string) => {
    setDeletingNoteId(noteId)
    try {
      const r = await fetch(`/api/admin/notes/${noteId}`, { method: 'DELETE' })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${r.status}`)
      }
      setNotes((prev) => prev.filter((n) => n.id !== noteId))
    } catch (e: any) {
      setNoteError(e.message ?? 'Error al eliminar')
    } finally {
      setDeletingNoteId(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="absolute right-0 top-0 h-full w-full max-w-xl bg-white shadow-xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="sticky top-0 bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-semibold text-stone-900">Detalle del cliente</h2>
          <button
            onClick={onClose}
            className="text-stone-500 hover:text-stone-900 text-2xl leading-none"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        {loading && <div className="p-12 text-center text-stone-500">Cargando…</div>}
        {error && <div className="p-6 text-red-700 text-sm">{error}</div>}
        {actionError && (
          <div className="mx-6 mt-4 p-3 bg-red-50 text-red-700 text-sm rounded">{actionError}</div>
        )}

        {client && (
          <div className="p-6 space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-2xl font-bold">
                {(client.name || client.email || '?').charAt(0).toUpperCase()}
              </div>
              <div>
                <h3 className="text-xl font-bold text-stone-900">{client.name}</h3>
                <p className="text-sm text-stone-500">{client.email ?? 'Sin email'}</p>
              </div>
            </div>

            <Section title="Datos personales">
              <Field label="Email" value={client.email} />
              <Field label="Email verificado" value={client.emailVerified ? 'Sí' : 'No'} />
              <Field label="Teléfono" value={client.phone} />
              <Field label="Ciudad" value={client.cityId} />
              <Field label="Estado" value={client.isActive ? 'Activo' : 'Inactivo'} />
              <Field label="Alta" value={new Date(client.createdAt).toLocaleString('es-CO')} />
              <Field
                label="Último login"
                value={
                  client.lastLoginAt
                    ? new Date(client.lastLoginAt).toLocaleString('es-CO')
                    : 'Nunca'
                }
              />
            </Section>

            <Section title="Actividad">
              <Field label="Pedidos" value={String(client.stats.orderCount)} />
              <Field label="Favoritos" value={String(client.stats.favoriteCount)} />
              <Field label="Reseñas" value={String(client.stats.reviewCount)} />
            </Section>

            <div className="border-t border-stone-200 pt-6 space-y-3">
              <h4 className="font-semibold text-stone-900 text-sm">Acciones</h4>

              <button
                onClick={() => doAction({ isActive: !client.isActive })}
                disabled={actionPending}
                className={`w-full px-4 py-2 rounded text-sm font-medium disabled:opacity-50 ${
                  client.isActive
                    ? 'bg-red-50 text-red-700 hover:bg-red-100'
                    : 'bg-green-50 text-green-700 hover:bg-green-100'
                }`}
              >
                {client.isActive ? 'Desactivar cuenta' : 'Activar cuenta'}
              </button>

              {!client.emailVerified && (
                <button
                  onClick={() => doAction({ emailVerified: true })}
                  disabled={actionPending}
                  className="w-full px-4 py-2 rounded text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                >
                  Marcar email como verificado
                </button>
              )}
            </div>

            <div className="border-t border-stone-200 pt-6 space-y-3">
              <h4 className="font-semibold text-stone-900 text-sm">Notas internas</h4>
              <p className="text-xs text-stone-500">
                Anotaciones visibles para todos los administradores. No se muestran al cliente.
              </p>

              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Ej. Cliente escaló queja por cobro duplicado, llamar antes de reactivar."
                rows={3}
                maxLength={2000}
                disabled={notePending}
                className="w-full px-3 py-2 border border-stone-300 rounded text-sm resize-y focus:outline-none focus:border-blue-500 disabled:opacity-50"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-stone-500">
                  {noteDraft.length} / 2000
                </span>
                <button
                  onClick={submitNote}
                  disabled={notePending || noteDraft.trim().length === 0}
                  className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {notePending ? 'Guardando…' : 'Agregar nota'}
                </button>
              </div>
              {noteError && (
                <div className="text-red-700 text-xs">{noteError}</div>
              )}

              {notesLoading && notes.length === 0 && (
                <div className="text-stone-500 text-sm">Cargando notas…</div>
              )}
              {!notesLoading && notes.length === 0 && (
                <div className="text-stone-500 text-sm italic">Sin notas todavía.</div>
              )}
              {notes.length > 0 && (
                <ul className="space-y-2">
                  {notes.map((n) => (
                    <li
                      key={n.id}
                      className="bg-stone-50 rounded p-3 text-sm border border-stone-200"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="text-xs text-stone-500">
                          <span className="font-medium text-stone-700">
                            {n.author_name}
                          </span>
                          {n.author_email && (
                            <span className="text-stone-400"> · {n.author_email}</span>
                          )}
                          <span className="text-stone-400">
                            {' · '}
                            {new Date(n.created_at).toLocaleString('es-CO')}
                          </span>
                        </div>
                        <button
                          onClick={() => deleteNote(n.id)}
                          disabled={deletingNoteId === n.id}
                          className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                          title="Eliminar nota"
                        >
                          {deletingNoteId === n.id ? '…' : 'Eliminar'}
                        </button>
                      </div>
                      <p className="mt-1 text-stone-900 whitespace-pre-wrap break-words">
                        {n.body}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="font-semibold text-stone-900 text-sm mb-2">{title}</h4>
      <div className="bg-stone-50 rounded p-3 space-y-1 text-sm">{children}</div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-stone-500">{label}</span>
      <span className="text-stone-900 font-medium text-right">{value ?? '—'}</span>
    </div>
  )
}
