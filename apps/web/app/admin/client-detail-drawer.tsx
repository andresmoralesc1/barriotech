'use client'

/**
 * Client (buyer) detail drawer — right-side overlay with the buyer's
 * full profile, activity stats, and admin actions.
 *
 * Mirrors VendorDetailDrawer in structure but:
 *   - No vendor-level sections (this is a buyer, not a vendor)
 *   - Adds stats (orders, favorites, reviews) so an admin can spot
 *     fake or abandoned accounts at a glance
 *
 * Fetches fresh data when it opens so it's never stale. On action
 * success the parent refreshes the list and the drawer reflects the
 * new state locally.
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
          <h2 className="text-lg font-semibold text-slate-900">Detalle del cliente</h2>
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

        {client && (
          <div className="p-6 space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-2xl font-bold">
                {(client.name || client.email || '?').charAt(0).toUpperCase()}
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">{client.name}</h3>
                <p className="text-sm text-slate-500">{client.email ?? 'Sin email'}</p>
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

            <div className="border-t border-slate-200 pt-6 space-y-3">
              <h4 className="font-semibold text-slate-900 text-sm">Acciones</h4>

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
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="font-semibold text-slate-900 text-sm mb-2">{title}</h4>
      <div className="bg-slate-50 rounded p-3 space-y-1 text-sm">{children}</div>
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