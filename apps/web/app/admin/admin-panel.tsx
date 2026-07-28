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
import { OrderDetailDrawer } from './order-detail-drawer'
import { DashboardOverview } from './dashboard-overview'
import { AuditLog } from './audit-log'

type Tab = 'overview' | 'vendors' | 'clients' | 'orders' | 'audit'

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
  deletedAt: string | null
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

interface AdminOrder {
  id: string
  status: 'pending' | 'accepted' | 'ready' | 'completed' | 'cancelled'
  total: number
  createdAt: string
  buyer: { id: string; name: string; email: string | null }
  vendor: { id: string; name: string; slug: string }
  itemCount: number
}

const ORDER_STATUSES = ['pending', 'accepted', 'ready', 'completed', 'cancelled'] as const

const PAGE_SIZE = 25

type BatchAction = 'activate' | 'deactivate' | 'verify_email'

export function AdminPanel() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overview')
  const [vendors, setVendors] = useState<AdminVendor[]>([])
  const [vendorsTotal, setVendorsTotal] = useState(0)
  const [clients, setClients] = useState<AdminClient[]>([])
  const [clientsTotal, setClientsTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<'all' | 'true' | 'false'>('all')
  const [query, setQuery] = useState('')
  // Tier 2 filter additions — see /api/admin/vendors and /api/admin/clients
  // for the matching query params. Each is independent and AND-combined.
  const [cityFilter, setCityFilter] = useState<string>('')
  const [verifiedFilter, setVerifiedFilter] = useState<'all' | 'true' | 'false'>('all')
  const [withPhotoFilter, setWithPhotoFilter] = useState<'all' | 'true' | 'false'>('all')
  const [sinceFilter, setSinceFilter] = useState('') // YYYY-MM-DD
  const [untilFilter, setUntilFilter] = useState('') // YYYY-MM-DD
  // Papelera toggle (vendors-only) — when on, list includes soft-deleted.
  const [showTrash, setShowTrash] = useState(false)
  // Pagination — offset is reset to 0 whenever filters/tab change so the
  // user always lands on the first page of the new view.
  const [offset, setOffset] = useState(0)
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null)
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)

  // Tier 6: orders list state + filters. Status is a select dropdown;
  // search hits buyer name/email + vendor name/slug. Date range +
  // min/max total stay exposed via `since/until` (we keep them hidden
  // for now to avoid toolbar bloat — re-useable if needed).
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [ordersTotal, setOrdersTotal] = useState(0)
  const [orderStatusFilter, setOrderStatusFilter] = useState<'all' | typeof ORDER_STATUSES[number]>('all')
  const [orderQuery, setOrderQuery] = useState('')

  // Tier 8: dashboard recent-activity deep-links to the audit log with
  // the action of the clicked row pre-filled in the filter.
  const [auditInitialAction, setAuditInitialAction] = useState('')

  // Vendor batch selection — set of selected vendor ids.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchPending, setBatchPending] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [batchConfirm, setBatchConfirm] = useState<BatchAction | null>(null)

  // Client batch selection — independent Set so toggling tabs doesn't
  // leak vendor selection into the clients view (or vice versa). Reuse
  // the same action type so the BatchActionBar / BatchConfirmModal are
  // shared between tabs.
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set())
  const [clientBatchPending, setClientBatchPending] = useState(false)
  const [clientBatchError, setClientBatchError] = useState<string | null>(null)
  const [clientBatchConfirm, setClientBatchConfirm] = useState<BatchAction | null>(null)

  // Hydrate tab from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('admin-tab')
    if (
      stored === 'overview' ||
      stored === 'vendors' ||
      stored === 'clients' ||
      stored === 'orders' ||
      stored === 'audit'
    ) {
      setTab(stored)
    }
  }, [])

  const fetchVendors = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    })
    if (activeFilter !== 'all') params.set('active', activeFilter)
    if (cityFilter) params.set('cityId', cityFilter)
    if (verifiedFilter !== 'all') params.set('verified', verifiedFilter)
    if (withPhotoFilter !== 'all') params.set('withPhoto', withPhotoFilter)
    if (sinceFilter) params.set('since', sinceFilter)
    if (untilFilter) params.set('until', untilFilter)
    if (showTrash) params.set('includeDeleted', 'true')
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
  }, [activeFilter, cityFilter, verifiedFilter, withPhotoFilter, sinceFilter, untilFilter, showTrash, query, offset])

  const fetchClients = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
    if (activeFilter !== 'all') params.set('active', activeFilter)
    if (cityFilter) params.set('cityId', cityFilter)
    if (verifiedFilter !== 'all') params.set('verified', verifiedFilter)
    if (sinceFilter) params.set('since', sinceFilter)
    if (untilFilter) params.set('until', untilFilter)
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
  }, [activeFilter, cityFilter, verifiedFilter, sinceFilter, untilFilter, query, offset])

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
    if (orderStatusFilter !== 'all') params.set('status', orderStatusFilter)
    if (orderQuery.trim()) params.set('q', orderQuery.trim())
    const res = await fetch(`/api/admin/orders?${params}`)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? `Error ${res.status}`)
      setLoading(false)
      return
    }
    const data = await res.json()
    setOrders(data.orders)
    setOrdersTotal(data.total)
    setLoading(false)
  }, [orderStatusFilter, orderQuery, offset])

  useEffect(() => {
    // Tab-driven fetches:
    //   · vendors  → vendor list (offset/filter already in fetchVendors deps)
    //   · clients  → client list
    //   · orders   → order list
    //   · overview → BOTH vendors + clients in parallel, so the tab badges
    //                show real counts even if the user never clicks the
    //                table tabs
    //   · audit    → component fetches its own data internally, skip here
    if (tab === 'vendors') {
      void fetchVendors()
    } else if (tab === 'clients') {
      void fetchClients()
    } else if (tab === 'orders') {
      void fetchOrders()
    } else if (tab === 'overview') {
      void fetchVendors()
      void fetchClients()
    }
  }, [tab, fetchVendors, fetchClients, fetchOrders])

  // Reset selection AND page when the filter context changes. Resetting
  // selection alone would leave a stale set whose ids might no longer be
  // on screen, and resetting page keeps "page 5 of filtered" from
  // appearing empty after the user narrows the search.
  useEffect(() => {
    setSelectedIds(new Set())
    setSelectedClientIds(new Set())
    setSelectedOrderId(null)
    setOffset(0)
  }, [
    tab,
    activeFilter,
    query,
    cityFilter,
    verifiedFilter,
    withPhotoFilter,
    sinceFilter,
    untilFilter,
    showTrash,
    orderStatusFilter,
    orderQuery,
  ])

  const onTabChange = (next: Tab) => {
    setTab(next)
    localStorage.setItem('admin-tab', next)
  }

  /** Dashboard deep-link handler: jumps to the vendors/clients tab with
   *  the matching active-filter chip selected. */
  const onNavigate = useCallback(
    (nextTab: 'vendors' | 'clients', filter: 'all' | 'true' | 'false') => {
      setTab(nextTab)
      localStorage.setItem('admin-tab', nextTab)
      setActiveFilter(filter)
      setOffset(0)
      setSelectedIds(new Set())
    },
    []
  )

  /** Tier 8: dashboard recent-activity → audit-log deep-link. Jumps to
   *  the audit tab with the clicked row's action pre-filled in the
   *  filter so the operator lands on a narrowed result. */
  const onJumpToAudit = useCallback((actionName: string) => {
    setTab('audit')
    localStorage.setItem('admin-tab', 'audit')
    setAuditInitialAction(actionName)
    setOffset(0)
  }, [])

  /** CSV export — re-uses the same active/query filters the table shows,
   *  fetches the CSV endpoint with credentials, and triggers a browser
   *  download via a temporary object URL. Filename comes from the
   *  server's Content-Disposition so it stays consistent with what the
   *  endpoint emits. */
  const onExportCsv = useCallback(async () => {
    if (tab !== 'vendors' && tab !== 'clients') return
    const params = new URLSearchParams()
    if (activeFilter !== 'all') params.set('active', activeFilter)
    if (cityFilter) params.set('cityId', cityFilter)
    if (verifiedFilter !== 'all') params.set('verified', verifiedFilter)
    if (sinceFilter) params.set('since', sinceFilter)
    if (untilFilter) params.set('until', untilFilter)
    if (tab === 'vendors' && withPhotoFilter !== 'all') params.set('withPhoto', withPhotoFilter)
    if (tab === 'vendors' && showTrash) params.set('includeDeleted', 'true')
    if (query.trim()) params.set('q', query.trim())
    const url = `/api/admin/${tab}/export?${params.toString()}`
    try {
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Export error: HTTP ${res.status}`)
        return
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const m = disposition.match(/filename="?([^";]+)"?/)
      const filename = m ? m[1] : `${tab}-export.csv`
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(a.href)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    }
  }, [tab, activeFilter, cityFilter, verifiedFilter, withPhotoFilter, sinceFilter, untilFilter, showTrash, query])

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

  // Client-side mirror of the vendor selection helpers. Each tab keeps
  // its own set so picking rows in Vendedores doesn't carry over to
  // Clientes when the operator flips tabs.
  const allClientsOnPageSelected = useMemo(() => {
    if (clients.length === 0) return false
    return clients.every((c) => selectedClientIds.has(c.id))
  }, [clients, selectedClientIds])

  const someClientsOnPageSelected = useMemo(() => {
    return clients.some((c) => selectedClientIds.has(c.id))
  }, [clients, selectedClientIds])

  const toggleAllClients = () => {
    setSelectedClientIds((prev) => {
      const next = new Set(prev)
      if (allClientsOnPageSelected) {
        clients.forEach((c) => next.delete(c.id))
      } else {
        clients.forEach((c) => next.add(c.id))
      }
      return next
    })
  }

  const toggleOneClient = (id: string) => {
    setSelectedClientIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const runClientBatch = async (action: BatchAction) => {
    setClientBatchPending(true)
    setClientBatchError(null)
    try {
      const res = await fetch('/api/admin/clients/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientIds: Array.from(selectedClientIds), action }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      setSelectedClientIds(new Set())
      setClientBatchConfirm(null)
      await fetchClients()
    } catch (e: any) {
      setClientBatchError(e.message ?? 'Error desconocido')
    } finally {
      setClientBatchPending(false)
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
            <nav className="flex gap-1 overflow-x-auto">
              <TabButton active={tab === 'overview'} onClick={() => onTabChange('overview')}>
                Resumen
              </TabButton>
              <TabButton active={tab === 'vendors'} onClick={() => onTabChange('vendors')}>
                Vendedores
                <span className="ml-2 text-xs text-slate-500">({vendorsTotal})</span>
              </TabButton>
              <TabButton active={tab === 'clients'} onClick={() => onTabChange('clients')}>
                Clientes
                <span className="ml-2 text-xs text-slate-500">({clientsTotal})</span>
              </TabButton>
              <TabButton active={tab === 'orders'} onClick={() => onTabChange('orders')}>
                Pedidos
                <span className="ml-2 text-xs text-slate-500">({ordersTotal})</span>
              </TabButton>
              <TabButton active={tab === 'audit'} onClick={() => onTabChange('audit')}>
                Auditoría
              </TabButton>
            </nav>
          </div>

          {/* Toolbar — only shown on the table-driven tabs (vendors/clients/orders) */}
          {(tab === 'vendors' || tab === 'clients' || tab === 'orders') && (
            <div className="p-4 border-b border-slate-200 flex gap-3 items-center flex-wrap">
              {tab === 'orders' ? (
                <>
                  <input
                    type="search"
                    placeholder="Buscar por comprador o vendedor…"
                    value={orderQuery}
                    onChange={(e) => setOrderQuery(e.target.value)}
                    className="flex-1 min-w-[180px] px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <select
                    value={orderStatusFilter}
                    onChange={(e) =>
                      setOrderStatusFilter(e.target.value as typeof orderStatusFilter)
                    }
                    className="px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="all">Todos los estados</option>
                    <option value="pending">Pendiente</option>
                    <option value="accepted">Aceptado</option>
                    <option value="ready">Listo</option>
                    <option value="completed">Completado</option>
                    <option value="cancelled">Cancelado</option>
                  </select>
                </>
              ) : (
                <>
                  <input
                    type="search"
                    placeholder={
                      tab === 'vendors' ? 'Buscar por nombre…' : 'Buscar por nombre o email…'
                    }
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="flex-1 min-w-[180px] px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <select
                    value={activeFilter}
                onChange={(e) => setActiveFilter(e.target.value as 'all' | 'true' | 'false')}
                className="px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                title="Estado activo/inactivo"
              >
                <option value="all">Todos</option>
                <option value="true">Activos</option>
                <option value="false">Inactivos</option>
              </select>
              {/* City dropdown — the list of city IDs is small and
                  stable (declared in /migrations), so we hardcode the
                  options rather than fetching them. Keeps the toolbar
                  load-free and the dropdown works offline. */}
              <select
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                title="Ciudad"
              >
                <option value="">Todas las ciudades</option>
                <option value="bogota">Bogotá</option>
                <option value="cali">Cali</option>
                <option value="medellin">Medellín</option>
                <option value="barranquilla">Barranquilla</option>
                <option value="cartagena">Cartagena</option>
                <option value="pereira">Pereira</option>
                <option value="bucaramanga">Bucaramanga</option>
                <option value="manizales">Manizales</option>
                <option value="armenia">Armenia</option>
                <option value="neiva">Neiva</option>
                <option value="ibague">Ibagué</option>
                <option value="pasto">Pasto</option>
                <option value="cucuta">Cúcuta</option>
                <option value="villavicencio">Villavicencio</option>
                <option value="santa-marta">Santa Marta</option>
                <option value="sincelejo">Sincelejo</option>
                <option value="tunja">Tunja</option>
                <option value="riohacha">Riohacha</option>
              </select>
              <select
                value={verifiedFilter}
                onChange={(e) => setVerifiedFilter(e.target.value as 'all' | 'true' | 'false')}
                className="px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                title="Email verificado del propietario"
              >
                <option value="all">Email verificado: todos</option>
                <option value="true">Verificados</option>
                <option value="false">Sin verificar</option>
              </select>
              {/* withPhoto only makes sense for vendors (clients have
                  no photo); hide on the clients tab to keep the toolbar
                  honest. */}
              {tab === 'vendors' && (
                <select
                  value={withPhotoFilter}
                  onChange={(e) => setWithPhotoFilter(e.target.value as 'all' | 'true' | 'false')}
                  className="px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  title="Vendedores con foto de perfil"
                >
                  <option value="all">Con foto: todos</option>
                  <option value="true">Con foto</option>
                  <option value="false">Sin foto</option>
                </select>
              )}
              <label className="flex items-center gap-1 text-sm text-slate-700" title="Alta desde">
                <span className="text-slate-500">Desde</span>
                <input
                  type="date"
                  value={sinceFilter}
                  onChange={(e) => setSinceFilter(e.target.value)}
                  className="px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="flex items-center gap-1 text-sm text-slate-700" title="Alta hasta (exclusivo)">
                <span className="text-slate-500">Hasta</span>
                <input
                  type="date"
                  value={untilFilter}
                  onChange={(e) => setUntilFilter(e.target.value)}
                  className="px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              {tab === 'vendors' && (
                <label
                  className={`inline-flex items-center gap-2 px-3 py-2 border rounded text-sm cursor-pointer select-none ${
                    showTrash
                      ? 'bg-amber-50 border-amber-300 text-amber-900'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                  title="Mostrar también vendedores eliminados (papelera)"
                >
                  <input
                    type="checkbox"
                    className="accent-amber-600"
                    checked={showTrash}
                    onChange={(e) => setShowTrash(e.target.checked)}
                  />
                  Mostrar papelera
                </label>
              )}
              {/* Export button hits the export endpoint with the same
                  filters currently applied to the table. Orders tab
                  has no export in tier 6 (read-only oversight). */}
              <button
                type="button"
                onClick={onExportCsv}
                className="inline-flex items-center gap-1 px-3 py-2 border border-slate-300 rounded text-sm text-slate-700 hover:bg-slate-50 hover:border-slate-400"
                title="Descarga los mismos filtros que ves en la tabla"
              >
                <span aria-hidden="true">⬇</span> Exportar CSV
              </button>
                </>
              )}
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-50 text-red-700 text-sm border-b border-red-200">{error}</div>
          )}

          {tab === 'overview' ? (
            <DashboardOverview onNavigate={onNavigate} onJumpToAudit={onJumpToAudit} />
          ) : tab === 'audit' ? (
            <AuditLog key={auditInitialAction} initialAction={auditInitialAction} />
          ) : loading ? (
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
          ) : tab === 'clients' ? (
            <>
              <ClientTable
                clients={clients}
                selectedIds={selectedClientIds}
                onToggleOne={toggleOneClient}
                onToggleAll={toggleAllClients}
                allSelected={allClientsOnPageSelected}
                someSelected={someClientsOnPageSelected}
                onSelect={(id) => setSelectedClientId(id)}
              />
              <PaginationBar
                total={clientsTotal}
                offset={offset}
                pageSize={PAGE_SIZE}
                onChange={setOffset}
              />
            </>
          ) : (
            <>
              <OrderTable
                orders={orders}
                onSelect={(id) => setSelectedOrderId(id)}
              />
              <PaginationBar
                total={ordersTotal}
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

      {/* Client-batch counterparts — same shape, separate state so the
          vendor selection isn't carried over when the operator flips tabs. */}
      {tab === 'clients' && selectedClientIds.size > 0 && (
        <BatchActionBar
          count={selectedClientIds.size}
          pending={clientBatchPending}
          error={clientBatchError}
          onAction={(a) => setClientBatchConfirm(a)}
          onClear={() => setSelectedClientIds(new Set())}
        />
      )}

      {clientBatchConfirm && (
        <BatchConfirmModal
          action={clientBatchConfirm}
          count={selectedClientIds.size}
          pending={clientBatchPending}
          subject="client"
          onConfirm={() => runClientBatch(clientBatchConfirm)}
          onCancel={() => setClientBatchConfirm(null)}
        />
      )}

      {selectedVendorId && (
        <VendorDetailDrawer
          vendorId={selectedVendorId}
          allowDeleted={showTrash}
          onClose={() => setSelectedVendorId(null)}
          onAction={onVendorAction}
          onSoftDeleted={() => {
            // Refresh the table so the row reflects the new state
            // (active row count drops by 1, etc.). Don't auto-close —
            // the drawer stays open with the Restaurar button so the
            // admin can immediately undo.
            if (tab === 'vendors') void fetchVendors()
          }}
          onRestored={() => {
            if (tab === 'vendors') void fetchVendors()
          }}
        />
      )}

      {selectedClientId && (
        <ClientDetailDrawer
          clientId={selectedClientId}
          onClose={() => setSelectedClientId(null)}
          onAction={onClientAction}
        />
      )}

      {selectedOrderId && (
        <OrderDetailDrawer
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
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
            const isDeleted = !!v.deletedAt
            // Soft-deleted rows render with a muted, line-through treatment
            // so they look obviously "in the trash" while the admin still
            // has the same click affordances (open drawer, restore, etc.).
            return (
              <tr
                key={v.id}
                onClick={() => onSelect(v.id)}
                className={`border-t border-slate-100 cursor-pointer ${
                  isSelected
                    ? 'bg-blue-50/50 hover:bg-blue-50'
                    : isDeleted
                      ? 'bg-amber-50/40 hover:bg-amber-50/60'
                      : 'hover:bg-slate-50'
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
                        className={`w-8 h-8 rounded-full object-cover ${isDeleted ? 'opacity-50 grayscale' : ''}`}
                      />
                    ) : (
                      <div className={`w-8 h-8 rounded-full ${isDeleted ? 'bg-amber-100' : 'bg-slate-200'}`} />
                    )}
                    <div>
                      <div className={`font-medium ${isDeleted ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
                        {v.name}
                      </div>
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
                  {isDeleted ? (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800"
                      title={`Eliminado el ${new Date(v.deletedAt!).toLocaleString('es-CO')}`}
                    >
                      <span aria-hidden="true">🗑</span> En papelera
                    </span>
                  ) : (
                    <StatusBadge active={v.isActive} />
                  )}
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
  selectedIds,
  onToggleOne,
  onToggleAll,
  allSelected,
  someSelected,
  onSelect,
}: {
  clients: AdminClient[]
  selectedIds: Set<string>
  onToggleOne: (id: string) => void
  onToggleAll: () => void
  allSelected: boolean
  someSelected: boolean
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
            <th className="px-4 py-3 font-medium">Nombre</th>
            <th className="px-4 py-3 font-medium">Email</th>
            <th className="px-4 py-3 font-medium">Teléfono</th>
            <th className="px-4 py-3 font-medium">Ciudad</th>
            <th className="px-4 py-3 font-medium">Estado</th>
            <th className="px-4 py-3 font-medium">Último login</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => {
            const isSelected = selectedIds.has(c.id)
            return (
              <tr
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={`border-t border-slate-100 cursor-pointer ${
                  isSelected ? 'bg-blue-50/50 hover:bg-blue-50' : 'hover:bg-slate-50'
                }`}
              >
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar ${c.name}`}
                    checked={isSelected}
                    onChange={() => onToggleOne(c.id)}
                    className="w-4 h-4 cursor-pointer"
                  />
                </td>
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
            )
          })}
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
 */
/**
 * OrderTable — read-only listing of orders for tier 6 oversight.
 *
 * Each row is clickable; selection opens the OrderDetailDrawer. No
 * checkbox column because tier 6 has no batch actions on orders
 * (status mutations stay in the buyer/vendor flows).
 *
 * Status badge colors mirror the drawer so the table and detail
 * pane read consistently.
 */
function OrderTable({
  orders,
  onSelect,
}: {
  orders: AdminOrder[]
  onSelect: (id: string) => void
}) {
  if (orders.length === 0) {
    return (
      <div className="p-12 text-center text-slate-500">
        No hay pedidos con los filtros actuales.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Fecha</th>
            <th className="px-3 py-2">Comprador</th>
            <th className="px-3 py-2">Vendedor</th>
            <th className="px-3 py-2 text-right">Items</th>
            <th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2">Estado</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr
              key={o.id}
              onClick={() => onSelect(o.id)}
              className="border-t border-slate-200 cursor-pointer hover:bg-slate-50"
            >
              <td className="px-3 py-2 text-slate-600">
                {new Date(o.createdAt).toLocaleString('es-CO', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </td>
              <td className="px-3 py-2">
                <div className="font-medium text-slate-900">{o.buyer.name}</div>
                <div className="text-xs text-slate-500">{o.buyer.email ?? '—'}</div>
              </td>
              <td className="px-3 py-2">
                <div className="font-medium text-slate-900">{o.vendor.name}</div>
                <div className="text-xs text-slate-500">{o.vendor.slug}</div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{o.itemCount}</td>
              <td className="px-3 py-2 text-right tabular-nums font-medium">
                {new Intl.NumberFormat('es-CO', {
                  style: 'currency',
                  currency: 'COP',
                  maximumFractionDigits: 0,
                }).format(o.total)}
              </td>
              <td className="px-3 py-2">
                <OrderStatusBadge status={o.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OrderStatusBadge({ status }: { status: AdminOrder['status'] }) {
  const label: Record<AdminOrder['status'], string> = {
    pending: 'Pendiente',
    accepted: 'Aceptado',
    ready: 'Listo',
    completed: 'Completado',
    cancelled: 'Cancelado',
  }
  const color: Record<AdminOrder['status'], string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    accepted: 'bg-blue-100 text-blue-800',
    ready: 'bg-purple-100 text-purple-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${color[status]}`}
    >
      {label[status]}
    </span>
  )
}

/**
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
  subject = 'vendor',
  onConfirm,
  onCancel,
}: {
  action: BatchAction
  count: number
  pending: boolean
  /** Tab the batch is being run from — controls copy. Defaults to 'vendor'
   *  so the existing call site (which already passes an action and count)
   *  keeps the same wording without rewrites. */
  subject?: 'vendor' | 'client'
  onConfirm: () => void
  onCancel: () => void
}) {
  const noun = subject === 'client' ? 'cliente' : 'vendedor'
  const nounPlural = subject === 'client' ? 'clientes' : 'vendedores'
  const labels: Record<BatchAction, { title: string; body: string; confirm: string; tone: string }> = {
    activate: {
      title: `Activar ${count} ${nounPlural}`,
      body:
        subject === 'client'
          ? 'Los clientes seleccionados podrán volver a iniciar sesión y usar la plataforma.'
          : 'Los vendedores seleccionados aparecerán en el mapa y serán visibles para los compradores.',
      confirm: 'Activar',
      tone: 'bg-green-600 hover:bg-green-500',
    },
    deactivate: {
      title: `Desactivar ${count} ${nounPlural}`,
      body:
        subject === 'client'
          ? 'Los clientes seleccionados no podrán iniciar sesión. Sus datos no se eliminan.'
          : 'Los vendedores seleccionados dejarán de aparecer en el mapa. Sus datos no se eliminan.',
      confirm: 'Desactivar',
      tone: 'bg-red-600 hover:bg-red-500',
    },
    verify_email: {
      title: `Marcar email verificado (${count})`,
      body:
        subject === 'client'
          ? 'Los clientes seleccionados serán marcados con email verificado sin necesidad de hacer clic en el enlace.'
          : 'Los propietarios seleccionados serán marcados con email verificado sin necesidad de hacer clic en el enlace.',
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