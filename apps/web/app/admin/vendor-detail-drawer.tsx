'use client'

/**
 * Vendor detail drawer — overlay on the right with full vendor info
 * and admin actions (activate/deactivate, override email verification,
 * soft-delete / restore).
 *
 * The drawer fetches fresh data when it opens so it's never stale.
 * On action success the parent refreshes the list and the drawer
 * re-fetches to reflect the new state (so soft-deleted → restored
 * doesn't leave a stale "Eliminado" banner).
 *
 * `allowDeleted` controls whether the drawer fetches with
 * `?includeDeleted=true`. Used by the papelera view to let the admin
 * see and restore a soft-deleted vendor; on the active tab the API
 * would 404 the request and we'd never reach the restaurar action.
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface VendorDetail {
  id: string
  name: string
  slug: string
  category: string | null
  description: string | null
  phone: string | null
  cityId: string | null
  latitude: number | null
  longitude: number | null
  vehicleType: string | null
  photoUrl: string | null
  isActive: boolean
  isVerified: boolean
  productCount: number
  createdAt: string
  deletedAt: string | null
  owner: {
    id: string
    name: string
    email: string | null
    phone: string | null
    emailVerified: boolean
    createdAt: string
    lastLoginAt: string | null
  }
  recentReviews: Array<{
    id: string
    rating: number
    comment: string | null
    authorName: string
    userId: string | null
    createdAt: string
  }>
  reviewStats: {
    total: number
    averageRating: number
    distribution: { 1: number; 2: number; 3: number; 4: number; 5: number }
  }
  activeSponsorship: {
    id: string
    plan: string
    amountCents: number
    startsAt: string
    endsAt: string
    status: string
    daysRemaining: number
  } | null
  orderStats: { total: number; last30Days: number }
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

export function VendorDetailDrawer({
  vendorId,
  allowDeleted = false,
  onClose,
  onAction,
  onSoftDeleted,
  onRestored,
}: {
  vendorId: string
  allowDeleted?: boolean
  onClose: () => void
  onAction: (id: string, body: { isActive?: boolean; emailVerified?: boolean }) => Promise<void>
  /** Called after a successful soft-delete so the parent can refresh
   *  the list and, if the vendor was visible, close the drawer or
   *  leave it open depending on context. */
  onSoftDeleted?: (id: string) => void
  /** Called after a successful restore so the parent can refresh
   *  the list (the row will go from "deleted" back to "active"). */
  onRestored?: (id: string) => void
}) {
  const router = useRouter()
  const [vendor, setVendor] = useState<VendorDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deletePending, setDeletePending] = useState(false)
  const [restorePending, setRestorePending] = useState(false)

  // Admin notes state (mirrors ClientDetailDrawer; the same /api/admin/notes
  // endpoint supports target_type='vendor').
  const [notes, setNotes] = useState<AdminNote[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [notePending, setNotePending] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null)

  const loadVendor = (id: string) => {
    setLoading(true)
    setError(null)
    const qs = allowDeleted ? '?includeDeleted=true' : ''
    return fetch(`/api/admin/vendors/${id}${qs}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}))
          throw new Error(data.error ?? `Error ${r.status}`)
        }
        return r.json()
      })
      .then((data) => {
        setVendor(data.vendor)
      })
      .catch((e) => {
        setError(e.message)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    void loadVendor(vendorId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId, allowDeleted])

  // Notes: fetched on mount + after every successful POST/DELETE.
  // Mirrors the ClientDetailDrawer implementation — same endpoint,
  // same optimistic-insert pattern. Tied to the open vendorId, so
  // switching vendors between drawer opens re-fetches.
  const loadNotes = async () => {
    setNotesLoading(true)
    try {
      const r = await fetch(
        `/api/admin/notes?targetType=vendor&targetId=${vendorId}`
      )
      if (r.ok) {
        const data = await r.json()
        setNotes(data.notes ?? [])
      }
    } catch {
      // silent — notes are best-effort
    } finally {
      setNotesLoading(false)
    }
  }

  useEffect(() => {
    loadNotes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId])

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
          targetType: 'vendor',
          targetId: vendorId,
          body: trimmed,
        }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${r.status}`)
      }
      const data = await r.json()
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
      await onAction(vendorId, body)
      // Reflect the new state locally without re-fetching
      if (vendor) {
        setVendor({
          ...vendor,
          isActive: body.isActive ?? vendor.isActive,
          owner: {
            ...vendor.owner,
            emailVerified: body.emailVerified ?? vendor.owner.emailVerified,
          },
        })
      }
    } catch (e: any) {
      setActionError(e.message ?? 'Error desconocido')
    } finally {
      setActionPending(false)
    }
  }

  const doSoftDelete = async () => {
    setDeletePending(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/admin/vendors/${vendorId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      setConfirmDelete(false)
      onSoftDeleted?.(vendorId)
      // Stay open so the admin can see the "Eliminado" banner with
      // a Restaurar button, so the click is reversible in one step.
      await loadVendor(vendorId)
    } catch (e: any) {
      setActionError(e.message ?? 'Error desconocido')
    } finally {
      setDeletePending(false)
    }
  }

  const doRestore = async () => {
    setRestorePending(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/admin/vendors/${vendorId}/restore`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      onRestored?.(vendorId)
      await loadVendor(vendorId)
    } catch (e: any) {
      setActionError(e.message ?? 'Error desconocido')
    } finally {
      setRestorePending(false)
    }
  }

  const isDeleted = !!vendor?.deletedAt

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
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-semibold text-slate-900">Detalle del vendedor</h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-900 text-2xl leading-none"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        {loading && <div className="p-12 text-center text-slate-500">Cargando…</div>}
        {error && <div className="p-6 text-red-700 text-sm">{error}</div>}
        {actionError && (
          <div className="mx-6 mt-4 p-3 bg-red-50 text-red-700 text-sm rounded">{actionError}</div>
        )}

        {vendor && (
          <div className="p-6 space-y-6">
            {/* Deleted-at banner — first thing the admin sees if the
                vendor is currently in the papelera. */}
            {isDeleted && (
              <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900">
                <div className="font-medium">Vendedor eliminado</div>
                <div className="text-amber-800 mt-0.5">
                  Eliminado el{' '}
                  {new Date(vendor.deletedAt!).toLocaleString('es-CO')}. No
                  aparece en el mapa ni en los listados públicos, pero sus
                  productos, órdenes, reseñas y patrocinios siguen en la
                  base de datos.
                </div>
              </div>
            )}

            <div className="flex items-center gap-4">
              {vendor.photoUrl ? (
                <img src={vendor.photoUrl} alt="" className="w-16 h-16 rounded-full object-cover" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-slate-200 flex items-center justify-center text-slate-400 text-2xl">
                  ?
                </div>
              )}
              <div>
                <h3 className="text-xl font-bold text-slate-900">{vendor.name}</h3>
                <p className="text-sm text-slate-500">{vendor.category ?? 'Sin categoría'}</p>
              </div>
            </div>

            {vendor.description && (
              <p className="text-sm text-slate-700">{vendor.description}</p>
            )}

            <Section title="Datos del puesto">
              <Field label="Ciudad" value={vendor.cityId} />
              <Field label="Coordenadas" value={
                vendor.latitude && vendor.longitude
                  ? `${vendor.latitude.toFixed(4)}, ${vendor.longitude.toFixed(4)}`
                  : null
              } />
              <Field label="Teléfono" value={vendor.phone} />
              <Field label="Vehículo" value={vendor.vehicleType} />
              <Field label="Productos" value={String(vendor.productCount)} />
              <Field label="Verificado" value={vendor.isVerified ? 'Sí' : 'No'} />
              <Field label="Alta" value={new Date(vendor.createdAt).toLocaleString('es-CO')} />
            </Section>

            <Section title="Propietario">
              <Field label="Nombre" value={vendor.owner.name} />
              <Field label="Email" value={vendor.owner.email} />
              <Field label="Teléfono" value={vendor.owner.phone} />
              <Field label="Email verificado" value={vendor.owner.emailVerified ? 'Sí' : 'No'} />
              <Field label="Último login" value={
                vendor.owner.lastLoginAt
                  ? new Date(vendor.owner.lastLoginAt).toLocaleString('es-CO')
                  : 'Nunca'
              } />
            </Section>

            <Section title="Actividad">
              <Field
                label="Pedidos totales"
                value={String(vendor.orderStats.total)}
              />
              <Field
                label="Pedidos (30 días)"
                value={String(vendor.orderStats.last30Days)}
              />
              <Field
                label="Reseñas"
                value={
                  vendor.reviewStats.total > 0
                    ? `${vendor.reviewStats.total} (★ ${vendor.reviewStats.averageRating.toFixed(1)})`
                    : '0'
                }
              />
            </Section>

            <Section title="Patrocinio">
              {vendor.activeSponsorship ? (
                <>
                  <Field label="Plan" value={vendor.activeSponsorship.plan} />
                  <Field
                    label="Monto"
                    value={`$${(vendor.activeSponsorship.amountCents / 100).toLocaleString('es-CO')} COP`}
                  />
                  <Field
                    label="Vence"
                    value={new Date(vendor.activeSponsorship.endsAt).toLocaleString('es-CO')}
                  />
                  <Field
                    label="Días restantes"
                    value={String(vendor.activeSponsorship.daysRemaining)}
                  />
                </>
              ) : (
                <div className="text-sm text-slate-500 italic">Sin patrocinio activo</div>
              )}
            </Section>

            <div className="border-t border-slate-200 pt-6 space-y-3">
              <h4 className="font-semibold text-slate-900 text-sm">Reseñas recientes</h4>
              {vendor.reviewStats.total === 0 ? (
                <div className="text-sm text-slate-500 italic">Sin reseñas todavía.</div>
              ) : (
                <>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-slate-500">Distribución:</span>
                    {([5, 4, 3, 2, 1] as const).map((star) => (
                      <span key={star} className="text-xs text-slate-600">
                        ★{star}: {vendor.reviewStats.distribution[star]}
                      </span>
                    ))}
                  </div>
                  <ul className="space-y-2">
                    {vendor.recentReviews.map((rv) => (
                      <li
                        key={rv.id}
                        className="bg-slate-50 rounded p-3 text-sm border border-slate-200"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs text-slate-500">
                            <span className="font-medium text-slate-700">{rv.authorName}</span>
                            <span className="text-slate-400">
                              {' · '}
                              {new Date(rv.createdAt).toLocaleString('es-CO')}
                            </span>
                          </div>
                          <div className="text-amber-600 font-semibold">
                            {'★'.repeat(rv.rating)}
                            <span className="text-slate-300">
                              {'★'.repeat(5 - rv.rating)}
                            </span>
                          </div>
                        </div>
                        {rv.comment && (
                          <p className="mt-1 text-slate-900 whitespace-pre-wrap break-words">
                            {rv.comment}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <div className="border-t border-slate-200 pt-6 space-y-3">
              <h4 className="font-semibold text-slate-900 text-sm">Notas internas</h4>
              <p className="text-xs text-slate-500">
                Anotaciones visibles para todos los administradores. No se muestran al público.
              </p>

              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Ej. Patrocinio renovado por queja resuelta, no requiere contacto."
                rows={3}
                maxLength={2000}
                disabled={notePending}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm resize-y focus:outline-none focus:border-blue-500 disabled:opacity-50"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500">{noteDraft.length} / 2000</span>
                <button
                  onClick={submitNote}
                  disabled={notePending || noteDraft.trim().length === 0}
                  className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {notePending ? 'Guardando…' : 'Agregar nota'}
                </button>
              </div>
              {noteError && <div className="text-red-700 text-xs">{noteError}</div>}

              {notesLoading && notes.length === 0 && (
                <div className="text-slate-500 text-sm">Cargando notas…</div>
              )}
              {!notesLoading && notes.length === 0 && (
                <div className="text-slate-500 text-sm italic">Sin notas todavía.</div>
              )}
              {notes.length > 0 && (
                <ul className="space-y-2">
                  {notes.map((n) => (
                    <li
                      key={n.id}
                      className="bg-slate-50 rounded p-3 text-sm border border-slate-200"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="text-xs text-slate-500">
                          <span className="font-medium text-slate-700">{n.author_name}</span>
                          {n.author_email && (
                            <span className="text-slate-400"> · {n.author_email}</span>
                          )}
                          <span className="text-slate-400">
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
                      <p className="mt-1 text-slate-900 whitespace-pre-wrap break-words">
                        {n.body}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-slate-200 pt-6 space-y-3">
              <h4 className="font-semibold text-slate-900 text-sm">Acciones</h4>

              {isDeleted ? (
                <button
                  onClick={doRestore}
                  disabled={restorePending}
                  className="w-full px-4 py-2 rounded text-sm font-medium bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50"
                >
                  {restorePending ? 'Restaurando…' : 'Restaurar vendedor'}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => doAction({ isActive: !vendor.isActive })}
                    disabled={actionPending}
                    className={`w-full px-4 py-2 rounded text-sm font-medium disabled:opacity-50 ${
                      vendor.isActive
                        ? 'bg-red-50 text-red-700 hover:bg-red-100'
                        : 'bg-green-50 text-green-700 hover:bg-green-100'
                    }`}
                  >
                    {vendor.isActive ? 'Desactivar vendedor' : 'Activar vendedor'}
                  </button>

                  {!vendor.owner.emailVerified && (
                    <button
                      onClick={() => doAction({ emailVerified: true })}
                      disabled={actionPending}
                      className="w-full px-4 py-2 rounded text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                    >
                      Marcar email como verificado
                    </button>
                  )}

                  <button
                    onClick={() => setConfirmDelete(true)}
                    disabled={actionPending}
                    className="w-full px-4 py-2 rounded text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 border border-slate-300"
                  >
                    Eliminar (mover a papelera)
                  </button>
                </>
              )}

              <button
                onClick={() => router.push(`/vendedor/${vendor.slug}`)}
                className="w-full px-4 py-2 rounded text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Ver página pública
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confirm-delete modal — separate from the drawer so it's
          impossible to mis-click. Aria-modal so screen readers trap
          focus. Escape closes the drawer, not this modal. */}
      {confirmDelete && vendor && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
          onClick={() => !deletePending && setConfirmDelete(false)}
          role="presentation"
        >
          <div
            className="bg-white rounded-lg shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-title"
          >
            <h3 id="confirm-delete-title" className="text-lg font-bold text-slate-900">
              ¿Eliminar vendedor?
            </h3>
            <p className="mt-2 text-sm text-slate-700">
              Vas a mover <strong>{vendor.name}</strong> a la papelera. Dejará de
              aparecer en el mapa público y en los listados; sus productos,
              órdenes, reseñas y patrocinios se mantienen intactos.
            </p>
            <p className="mt-2 text-sm text-slate-700">
              Esta acción queda registrada en la auditoría y se puede revertir
              desde la pestaña Vendedores con el botón <em>Mostrar papelera</em>.
            </p>
            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deletePending}
                className="px-4 py-2 rounded text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={doSoftDelete}
                disabled={deletePending}
                className="px-4 py-2 rounded text-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deletePending ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="font-semibold text-slate-900 text-sm mb-2">{title}</h4>
      <div className="bg-slate-50 rounded p-3 space-y-1 text-sm">
        {children}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900 font-medium text-right">{value ?? '—'}</span>
    </div>
  )
}
