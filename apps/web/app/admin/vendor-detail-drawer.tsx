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
