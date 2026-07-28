'use client'

/**
 * Order detail drawer — read-only oversight view.
 *
 * Tier 6 intentionally does NOT include admin status mutations
 * (cancel/force-complete). Status transitions stay in the buyer
 * and vendor flows so the existing audit trail — buyer-side
 * cancel, vendor-side accept — is preserved. Admins record any
 * intervention via the notes section, but the drawer itself
 * is read-only by design.
 *
 * If we ever need write actions, this is where they'd land.
 * Until then, the drawer surfaces:
 *   - Order header (id, status badge, total, created at)
 *   - Buyer card (name, email, phone, isActive)
 *   - Vendor card (name, slug, owner name, isActive)
 *   - Item line items (product name, quantity, unit price, subtotal)
 *   - Notas internas — admin notes that target this order's
 *     buyer or vendor (the only targets admin_notes supports today).
 *     We surface them as related context the operator can read
 *     while triaging.
 */

import { useEffect, useState } from 'react'

interface OrderDetail {
  order: {
    id: string
    status: 'pending' | 'accepted' | 'ready' | 'completed' | 'cancelled'
    total: number
    createdAt: string
  }
  items: Array<{
    id: string
    productId: string | null
    productName: string
    quantity: number
    price: number
    subtotal: number
  }>
  buyer: {
    id: string
    name: string
    email: string | null
    phone: string | null
    isActive: boolean
  }
  vendor: {
    id: string
    name: string
    slug: string
    isActive: boolean
    ownerName: string | null
  }
  related: {
    notes: Array<{
      id: string
      targetType: 'user' | 'vendor'
      targetId: string
      body: string
      createdAt: string
      authorName: string
      authorEmail: string | null
    }>
  }
}

const STATUS_LABEL: Record<OrderDetail['order']['status'], string> = {
  pending: 'Pendiente',
  accepted: 'Aceptado',
  ready: 'Listo',
  completed: 'Completado',
  cancelled: 'Cancelado',
}

const STATUS_COLOR: Record<OrderDetail['order']['status'], string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  accepted: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  ready: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
}

function formatCOP(n: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function OrderDetailDrawer({
  orderId,
  onClose,
}: {
  orderId: string
  onClose: () => void
}) {
  const [data, setData] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/admin/orders/${orderId}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.error ?? `Error ${r.status}`)
        }
        return r.json()
      })
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [orderId])

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <aside
        className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-start justify-between border-b border-zinc-200 pb-3 dark:border-zinc-700">
          <div>
            <h2 className="text-lg font-semibold">Detalle del pedido</h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {data?.order.id ?? orderId}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </header>

        {loading && (
          <p className="text-sm text-zinc-500">Cargando pedido…</p>
        )}
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        {data && (
          <div className="space-y-6">
            {/* Header */}
            <section className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
                  STATUS_COLOR[data.order.status]
                }`}
              >
                {STATUS_LABEL[data.order.status]}
              </span>
              <span className="text-2xl font-bold tracking-tight">
                {formatCOP(data.order.total)}
              </span>
              <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
                {formatDate(data.order.createdAt)}
              </span>
            </section>

            {/* Buyer */}
            <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
              <h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                Comprador
              </h3>
              <dl className="grid grid-cols-3 gap-y-1 text-sm">
                <dt className="text-zinc-500 dark:text-zinc-400">Nombre</dt>
                <dd className="col-span-2 font-medium">{data.buyer.name}</dd>
                <dt className="text-zinc-500 dark:text-zinc-400">Email</dt>
                <dd className="col-span-2 break-all text-zinc-700 dark:text-zinc-300">
                  {data.buyer.email ?? '—'}
                </dd>
                <dt className="text-zinc-500 dark:text-zinc-400">Teléfono</dt>
                <dd className="col-span-2 text-zinc-700 dark:text-zinc-300">
                  {data.buyer.phone ?? '—'}
                </dd>
                <dt className="text-zinc-500 dark:text-zinc-400">Estado</dt>
                <dd className="col-span-2">
                  {data.buyer.isActive ? (
                    <span className="text-green-600 dark:text-green-400">Activo</span>
                  ) : (
                    <span className="text-red-600 dark:text-red-400">Inactivo</span>
                  )}
                </dd>
              </dl>
            </section>

            {/* Vendor */}
            <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
              <h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                Vendedor
              </h3>
              <dl className="grid grid-cols-3 gap-y-1 text-sm">
                <dt className="text-zinc-500 dark:text-zinc-400">Nombre</dt>
                <dd className="col-span-2 font-medium">{data.vendor.name}</dd>
                <dt className="text-zinc-500 dark:text-zinc-400">Slug</dt>
                <dd className="col-span-2 break-all text-zinc-700 dark:text-zinc-300">
                  {data.vendor.slug}
                </dd>
                <dt className="text-zinc-500 dark:text-zinc-400">Dueño</dt>
                <dd className="col-span-2 text-zinc-700 dark:text-zinc-300">
                  {data.vendor.ownerName ?? '—'}
                </dd>
                <dt className="text-zinc-500 dark:text-zinc-400">Estado</dt>
                <dd className="col-span-2">
                  {data.vendor.isActive ? (
                    <span className="text-green-600 dark:text-green-400">Activo</span>
                  ) : (
                    <span className="text-red-600 dark:text-red-400">Inactivo</span>
                  )}
                </dd>
              </dl>
            </section>

            {/* Items */}
            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                Productos ({data.items.length})
              </h3>
              {data.items.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Sin productos registrados.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      <tr>
                        <th className="px-3 py-2">Producto</th>
                        <th className="px-3 py-2 text-right">Cant.</th>
                        <th className="px-3 py-2 text-right">Precio</th>
                        <th className="px-3 py-2 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((it) => (
                        <tr
                          key={it.id}
                          className="border-t border-zinc-200 dark:border-zinc-700"
                        >
                          <td className="px-3 py-2">{it.productName}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {it.quantity}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatCOP(it.price)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">
                            {formatCOP(it.subtotal)}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-zinc-200 bg-zinc-50 font-semibold dark:border-zinc-700 dark:bg-zinc-800">
                        <td className="px-3 py-2" colSpan={3}>
                          Total
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCOP(data.order.total)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Related admin notes (read-only context, sourced from the
                buyer/vendor targets — admin_notes has no direct order FK
                today; new notes are not written from this drawer). */}
            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                Notas internas relacionadas ({data.related.notes.length})
              </h3>
              {data.related.notes.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  No hay notas internas sobre el comprador o vendedor de este pedido.
                </p>
              ) : (
                <ul className="space-y-2">
                  {data.related.notes.map((n) => (
                    <li
                      key={n.id}
                      className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-700"
                    >
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {n.authorName}
                        {n.targetType === 'vendor' ? ' · vendedor' : ' · comprador'} ·{' '}
                        {formatDate(n.createdAt)}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                        {n.body}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <footer className="border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              Los administradores no modifican el estado del pedido.
              Cualquier intervención se registra como nota interna en el
              comprador o vendedor correspondiente.
            </footer>
          </div>
        )}
      </aside>
    </div>
  )
}