'use client'

/**
 * Admin panel — two tabs (Vendedores / Clientes) with a detail drawer.
 *
 * Why a single component instead of two separate pages?
 * - The admin role is the same, the layout is the same, the toolbar
 *   (logout, theme, etc.) is the same. Splitting tabs into routes would
 *   duplicate the chrome.
 * - The selected tab persists in localStorage so reloading keeps state.
 * - Vendors and clients each get a detail drawer with the relevant
 *   admin actions.
 * - Vendor tab supports batch selection + bulk actions (activate,
 *   deactivate, mark email verified).
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { VendorDetailDrawer } from './vendor-detail-drawer'
import { ClientDetailDrawer } from './client-detail-drawer'

type Tab = 'vendors' | 'clients'

interface AdminVendor {
  id: string
  name: string
  slug: string
  category: string | null
  description: string | null
  phone: string | null
  cityId: string | null
  latitude: number | null
  longitude: number | null
  isActive: boolean
  isVerified: boolean
  photoUrl: string | null
  createdAt: string
  owner: {
    name: string
    email: string | null
    phone: string | null
    emailVerified: boolean
  }
}

interface AdminClient {
  id: string
  email: string | null
  name: string
  phone: string | null
  cityId: string | null
  isActive: boolean
  emailVerified: boolean
  createdAt: string
  lastLoginAt: string | null
}

const PAGE_SIZE = 25

type BatchAction = 'activate' | 'deactivate' | 'verify_email'

export function AdminPanel() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('vendors')
  const [vendors, setVendors] = useState<AdminVendor[]>([])
  const [vendorsTotal, setVendorsTotal] = useState(0)
  const [clients, setClients] = useState<AdminClient[]>([])
  const [clientsTotal, setClientsTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<'all' | 'true' | 'false'>('all')
  const [query, setQuery] = useState('')
  // Pagination — offset is reset to 0 whenever filters/tab change so the
  // user always lands on the first page of the new view.
  const [offset, setOffset] = useState(0)
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null)
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)

  // Vendor batch selection — set of selected vendor ids.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchPending, setBatchPending] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [batchConfirm, setBatchConfirm] = useState<BatchAction | null>(null)

  // Hydrate tab from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('admin-tab')
    if (stored === 'vendors' || stored === 'clients') setTab(stored)
  }, [])

  const fetchVendors = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
    if (activeFilter !== 'all') params.set('active', activeFilter)
    if (query.trim()) params.set('q', query.trim())
    const res = await fetch(`/api/admin/vendors?${params}`)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? `Error ${res.status}`)
      setLoading(false)
      return
    }
    const data = await res.json()
    setVendors(data.vendors)
    setVendorsTotal(data.total)
    setLoading(false)
  }, [activeFilter, query, offset])

  const fetchClients = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
    if (activeFilter !== 'all') params.set('active', activeFilter)
    if (query.trim()) params.set('q', query.trim())
    const res = await fetch(`/api/admin/clients?${params}`)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? `Error ${res.status}`)
      setLoading(false)
      return
    }
    const data = await res.json()
    setClients(data.clients)
    setClientsTotal(data.total)
    setLoading(false)
  }, [activeFilter, query, offset])

  useEffect(() => {
    if (tab === 'vendors') fetchVendors()
    else fetchClients()
  }, [tab, fetchVendors, fetchClients])

  // Reset selection AND page when the filter context changes. Resetting
  // selection alone would leave a stale set whose ids might no longer be
  // on screen, and resetting page keeps "page 5 of filtered" from
  // appearing empty after the user narrows the search.
  useEffect(() => {
    setSelectedIds(new Set())
    setOffset(0)
  }, [tab, activeFilter, query])

  const onTabChange = (next: Tab) => {
    setTab(next)
    localStorage.setItem('admin-tab', next)
  }

  const onVendorAction = async (id: string, body: { isActive?: boolean; emailVerified?: boolean }) => {
    const res = await fetch(`/api/admin/vendors/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error ?? `Error ${res.status}`)
    }
    await fetchVendors()
  }

  const onClientAction = async (id: string, body: { isActive?: boolean; emailVerified?: boolean }) => {
    const res = await fetch(`/api/admin/clients/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error ?? `Error ${res.status}`)
    }
    await fetchClients()
  }

  // Selection helpers
  const allOnPageSelected = useMemo(() => {
    if (vendors.length === 0) return false
    return vendors.every((v) => selectedIds.has(v.id))
  }, [vendors, selectedIds])

  const someOnPageSelected = useMemo(() => {
    return vendors.some((v) => selectedIds.has(v.id))
  }, [vendors, selectedIds])

  const toggleAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allOnPageSelected) {
        vendors.forEach((v) => next.delete(v.id))
      } else {
        vendors.forEach((v) => next.add(v.id))
      }
      return next
    })
  }

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const runBatch = async (action: BatchAction) => {
    setBatchPending(true)
    setBatchError(null)
    try {
      const res = await fetch('/api/admin/vendors/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), action }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      setSelectedIds(new Set())
      setBatchConfirm(null)
      await fetchVendors()
    } catch (e: any) {
      setBatchError(e.message ?? 'Error desconocido')
    } finally {
      setBatchPending(false)
    }
  }

  const onLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🛡️</span>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Admin</h1>
              <p className="text-xs text-slate-500">GPS Street Sellers</p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded hover:bg-slate-100"
          >
            Cerrar sesión
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="bg-white rounded-lg border border-slate-200">
          <div className="border-b border-slate-200 px-4">
            <nav className="flex gap-1">
              <TabButton active={tab === 'vendors'} onClick={() => onTabChange('vendors')}>
                Vendedores
                <span className="ml-2 text-xs text-slate-500">({vendorsTotal})</span>
              </TabButton>
              <TabButton active={tab === 'clients'} onClick={() => onTabChange('clients')}>
                Clientes
                <span className="ml-2 text-xs text-slate-500">({clientsTotal})</span>
              </TabButton>
            </nav>
          </div>

          <div className="p-4 border-b border-slate-200 flex gap-3 items-center">
            <input
              type="search"
              placeholder={tab === 'vendors' ? 'Buscar por nombre…' : 'Buscar por nombre o email…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value as 'all' | 'true' | 'false')}
              className="px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Todos</option>
              <option value="true">Activos</option>
              <option value="false">Inactivos</option>
            </select>
          </div>

          {error && (
            <div className="p-4 bg-red-50 text-red-700 text-sm border-b border-red-200">{error}</div>
          )}

          {loading ? (
            <div className="p-12 text-center text-slate-500">Cargando…</div>
          ) : tab === 'vendors' ? (
            <>
              <VendorTable
                vendors={vendors}
                selectedIds={selectedIds}
                onToggleOne={toggleOne}
                onToggleAll={toggleAll}
                allSelected={allOnPageSelected}
                someSelected={someOnPageSelected}
                onSelect={(id) => setSelectedVendorId(id)}
              />
              <PaginationBar
                total={vendorsTotal}
                offset={offset}
                pageSize={PAGE_SIZE}
                onChange={setOffset}
              />
            </>
          ) : (
            <>
              <ClientTable
                clients={clients}
                onSelect={(id) => setSelectedClientId(id)}
              />
              <PaginationBar
                total={clientsTotal}
                offset={offset}
                pageSize={PAGE_SIZE}
                onChange={setOffset}
              />
            </>
          )}
        </div>
      </div>

      {/* Floating batch action bar — only when vendors tab has selection */}
      {tab === 'vendors' && selectedIds.size > 0 && (
        <BatchActionBar
          count={selectedIds.size}
          pending={batchPending}
          error={batchError}
          onAction={(a) => setBatchConfirm(a)}
          onClear={() => setSelectedIds(new Set())}
        />
      )}

      {batchConfirm && (
        <BatchConfirmModal
          action={batchConfirm}
          count={selectedIds.size}
          pending={batchPending}
          onConfirm={() => runBatch(batchConfirm)}
          onCancel={() => setBatchConfirm(null)}
        />
      )}

      {selectedVendorId && (
        <VendorDetailDrawer
          vendorId={selectedVendorId}
          onClose={() => setSelectedVendorId(null)}
          onAction={onVendorAction}
        />
      )}

      {selectedClientId && (
        <ClientDetailDrawer
          clientId={selectedClientId}
          onClose={() => setSelectedClientId(null)}
          onAction={onClientAction}
        />
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-blue-600 text-blue-600'
          : 'border-transparent text-slate-600 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  )
}

function VendorTable({
  vendors,
  selectedIds,
  onToggleOne,
  onToggleAll,
  allSelected,
  someSelected,
  onSelect,
}: {
  vendors: AdminVendor[]
  selectedIds: Set<string>
  onToggleOne: (id: string) => void
  onToggleAll: () => void
  allSelected: boolean
  someSelected: boolean
  onSelect: (id: string) => void
}) {
  if (vendors.length === 0) {
    return <div className="p-12 text-center text-slate-500">No se encontraron vendedores.</div>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600 text-left">
          <tr>
            <th className="px-3 py-3 w-10">
              <input
                type="checkbox"
                aria-label="Seleccionar todos en esta página"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = !allSelected && someSelected
                }}
                onChange={onToggleAll}
                className="w-4 h-4 cursor-pointer"
              />
            </th>
            <th className="px-4 py-3 font-medium">Vendedor</th>
            <th className="px-4 py-3 font-medium">Categoría</th>
            <th className="px-4 py-3 font-medium">Ciudad</th>
            <th className="px-4 py-3 font-medium">Email</th>
            <th className="px-4 py-3 font-medium">Estado</th>
            <th className="px-4 py-3 font-medium">Alta</th>
          </tr>
        </thead>
        <tbody>
          {vendors.map((v) => {
            const isSelected = selectedIds.has(v.id)
            return (
              <tr
                key={v.id}
                onClick={() => onSelect(v.id)}
                className={`border-t border-slate-100 cursor-pointer ${
                  isSelected ? 'bg-blue-50/50 hover:bg-blue-50' : 'hover:bg-slate-50'
                }`}
              >
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar ${v.name}`}
                    checked={isSelected}
                    onChange={() => onToggleOne(v.id)}
                    className="w-4 h-4 cursor-pointer"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {v.photoUrl ? (
                      <img
                        src={v.photoUrl}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-slate-200" />
                    )}
                    <div>
                      <div className="font-medium text-slate-900">{v.name}</div>
                      <div className="text-xs text-slate-500">{v.owner.name}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-700">{v.category ?? '—'}</td>
                <td className="px-4 py-3 text-slate-700">{v.cityId ?? '—'}</td>
                <td className="px-4 py-3 text-slate-700">
                  {v.owner.email ?? '—'}
                  {!v.owner.emailVerified && (
                    <span className="ml-1 text-xs text-amber-600">(sin verificar)</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge active={v.isActive} />
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">
                  {new Date(v.createdAt).toLocaleDateString('es-CO')}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ClientTable({
  clients,
  onSelect,
}: {
  clients: AdminClient[]
  onSelect: (id: string) => void
}) {
  if (clients.length === 0) {
    return <div className="p-12 text-center text-slate-500">No se encontraron clientes.</div>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600 text-left">
          <tr>
            <th className="px-4 py-3 font-medium">Nombre</th>
            <th className="px-4 py-3 font-medium">Email</th>
            <th className="px-4 py-3 font-medium">Teléfono</th>
            <th className="px-4 py-3 font-medium">Ciudad</th>
            <th className="px-4 py-3 font-medium">Estado</th>
            <th className="px-4 py-3 font-medium">Último login</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr
              key={c.id}
              onClick={() => onSelect(c.id)}
              className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
            >
              <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
              <td className="px-4 py-3 text-slate-700">
                {c.email ?? '—'}
                {!c.emailVerified && (
                  <span className="ml-1 text-xs text-amber-600">(sin verificar)</span>
                )}
              </td>
              <td className="px-4 py-3 text-slate-700">{c.phone ?? '—'}</td>
              <td className="px-4 py-3 text-slate-700">{c.cityId ?? '—'}</td>
              <td className="px-4 py-3">
                <StatusBadge active={c.isActive} />
              </td>
              <td className="px-4 py-3 text-slate-500 text-xs">
                {c.lastLoginAt ? new Date(c.lastLoginAt).toLocaleDateString('es-CO') : 'Nunca'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
        active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
      }`}
    >
      {active ? 'Activo' : 'Inactivo'}
    </span>
  )
}

/**
 * Pagination bar — shows the visible range and prev/next + page numbers.
 *
 * Why custom and not a UI lib? Two reasons: (a) the layout below the
 * table is small and bespoke enough that the dependency cost outweighs
 * the benefit, and (b) we want exact control over the visible page list
 * (ellipsis for long ranges).
 *
 * Page number strategy: always show first, last, current, current ±1,
 * and ellipses for the gap. With PAGE_SIZE=25 and a typical admin table
 * this stays under 7 buttons even at 1000+ rows.
 */
function PaginationBar({
  total,
  offset,
  pageSize,
  onChange,
}: {
  total: number
  offset: number
  pageSize: number
  onChange: (offset: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.floor(offset / pageSize) + 1

  // Don't render anything when there's nothing to paginate.
  if (total === 0) {
    return (
      <div className="px-4 py-3 border-t border-slate-200 text-xs text-slate-500 text-center">
        Sin resultados
      </div>
    )
  }
  if (totalPages === 1) {
    return (
      <div className="px-4 py-3 border-t border-slate-200 text-xs text-slate-500 text-center">
        {total} resultado{total === 1 ? '' : 's'}
      </div>
    )
  }

  const first = offset + 1
  const last = Math.min(offset + pageSize, total)
  const canPrev = currentPage > 1
  const canNext = currentPage < totalPages

  const pageNumbers = buildPageList(currentPage, totalPages)

  return (
    <nav
      aria-label="Paginación"
      className="px-4 py-3 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3"
    >
      <span className="text-xs text-slate-600">
        Mostrando <strong>{first}–{last}</strong> de <strong>{total}</strong>
      </span>
      <div className="flex items-center gap-1">
        <PageBtn
          onClick={() => onChange((currentPage - 2) * pageSize)}
          disabled={!canPrev}
          aria-label="Página anterior"
        >
          ‹ Anterior
        </PageBtn>
        {pageNumbers.map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} className="px-2 text-slate-400" aria-hidden="true">
              …
            </span>
          ) : (
            <PageBtn
              key={p}
              onClick={() => onChange((p - 1) * pageSize)}
              active={p === currentPage}
              aria-label={`Página ${p}`}
              aria-current={p === currentPage ? 'page' : undefined}
            >
              {p}
            </PageBtn>
          )
        )}
        <PageBtn
          onClick={() => onChange(currentPage * pageSize)}
          disabled={!canNext}
          aria-label="Página siguiente"
        >
          Siguiente ›
        </PageBtn>
      </div>
    </nav>
  )
}

function PageBtn({
  children,
  onClick,
  disabled,
  active,
  ...rest
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  active?: boolean
  [k: string]: unknown
}) {
  const base = 'min-w-[2.25rem] px-2.5 py-1.5 text-xs rounded font-medium transition-colors'
  const tone = active
    ? 'bg-blue-600 text-white'
    : disabled
      ? 'text-slate-300 cursor-not-allowed'
      : 'text-slate-700 hover:bg-slate-100'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${tone}`}
      {...rest}
    >
      {children}
    </button>
  )
}

/**
 * Build a compact page list: always show first, last, current ±1, with
 * ellipses for the gap. Returns an array of either numbers or '…'.
 *
 * Example for currentPage=5, totalPages=12:
 *   [1, '…', 4, 5, 6, '…', 12]
 */
function buildPageList(current: number, total: number): Array<number | '…'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  const pages: Array<number | '…'> = []
  pages.push(1)
  if (current > 3) pages.push('…')
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    pages.push(p)
  }
  if (current < total - 2) pages.push('…')
  pages.push(total)
  return pages
}

function BatchActionBar({
  count,
  pending,
  error,
  onAction,
  onClear,
}: {
  count: number
  pending: boolean
  error: string | null
  onAction: (a: BatchAction) => void
  onClear: () => void
}) {
  return (
    <div
      role="region"
      aria-label="Acciones por lote"
      className="fixed bottom-4 inset-x-4 md:inset-x-auto md:right-6 md:max-w-2xl bg-slate-900 text-white rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3 z-40"
    >
      <span className="text-sm font-medium">
        {count} seleccionado{count === 1 ? '' : 's'}
      </span>
      <div className="flex-1" />
      {error && (
        <span className="text-xs text-red-300 mr-2 max-w-[14rem] truncate" title={error}>
          {error}
        </span>
      )}
      <button
        onClick={onClear}
        disabled={pending}
        className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50"
      >
        Limpiar
      </button>
      <button
        onClick={() => onAction('verify_email')}
        disabled={pending}
        className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
      >
        Verificar email
      </button>
      <button
        onClick={() => onAction('activate')}
        disabled={pending}
        className="px-3 py-1.5 text-sm rounded bg-green-600 hover:bg-green-500 disabled:opacity-50"
      >
        Activar
      </button>
      <button
        onClick={() => onAction('deactivate')}
        disabled={pending}
        className="px-3 py-1.5 text-sm rounded bg-red-600 hover:bg-red-500 disabled:opacity-50"
      >
        Desactivar
      </button>
    </div>
  )
}

function BatchConfirmModal({
  action,
  count,
  pending,
  onConfirm,
  onCancel,
}: {
  action: BatchAction
  count: number
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const labels: Record<BatchAction, { title: string; body: string; confirm: string; tone: string }> = {
    activate: {
      title: `Activar ${count} vendedor${count === 1 ? '' : 'es'}`,
      body: 'Los vendedores seleccionados aparecerán en el mapa y serán visibles para los compradores.',
      confirm: 'Activar',
      tone: 'bg-green-600 hover:bg-green-500',
    },
    deactivate: {
      title: `Desactivar ${count} vendedor${count === 1 ? '' : 'es'}`,
      body: 'Los vendedores seleccionados dejarán de aparecer en el mapa. Sus datos no se eliminan.',
      confirm: 'Desactivar',
      tone: 'bg-red-600 hover:bg-red-500',
    },
    verify_email: {
      title: `Marcar email verificado (${count})`,
      body: 'Los propietarios seleccionados serán marcados con email verificado sin necesidad de hacer clic en el enlace.',
      confirm: 'Verificar',
      tone: 'bg-blue-600 hover:bg-blue-500',
    },
  }
  const l = labels[action]
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-confirm-title"
        className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
      >
        <h3 id="batch-confirm-title" className="text-lg font-semibold text-slate-900">
          {l.title}
        </h3>
        <p className="mt-2 text-sm text-slate-600">{l.body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={pending}
            className="px-4 py-2 text-sm rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className={`px-4 py-2 text-sm rounded text-white font-medium disabled:opacity-50 ${l.tone}`}
          >
            {pending ? 'Aplicando…' : l.confirm}
          </button>
        </div>
      </div>
    </div>
  )
}