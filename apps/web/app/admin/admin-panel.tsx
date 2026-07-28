'use client'

/**
 * Admin panel — two tabs (Vendedores / Clientes) with a detail drawer.
 *
 * Why a single component instead of two separate pages?
 * - The admin role is the same, the layout is the same, the toolbar
 *   (logout, theme, etc.) is the same. Splitting tabs into routes would
 *   duplicate the chrome.
 * - The selected tab persists in localStorage so reloading keeps state.
 * - Vendors get a detail drawer with activate/deactivate + email-verified
 *   actions. Clients are read-only in v1 (we can add deactivate later).
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { VendorDetailDrawer } from './vendor-detail-drawer'

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
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null)

  // Hydrate tab from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('admin-tab')
    if (stored === 'vendors' || stored === 'clients') setTab(stored)
  }, [])

  const fetchVendors = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: '0' })
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
  }, [activeFilter, query])

  const fetchClients = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: '0' })
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
  }, [activeFilter, query])

  useEffect(() => {
    if (tab === 'vendors') fetchVendors()
    else fetchClients()
  }, [tab, fetchVendors, fetchClients])

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
    // Refresh list to reflect the new state
    await fetchVendors()
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
            <VendorTable
              vendors={vendors}
              onSelect={(id) => setSelectedVendorId(id)}
            />
          ) : (
            <ClientTable clients={clients} />
          )}
        </div>
      </div>

      {selectedVendorId && (
        <VendorDetailDrawer
          vendorId={selectedVendorId}
          onClose={() => setSelectedVendorId(null)}
          onAction={onVendorAction}
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
  onSelect,
}: {
  vendors: AdminVendor[]
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
            <th className="px-4 py-3 font-medium">Vendedor</th>
            <th className="px-4 py-3 font-medium">Categoría</th>
            <th className="px-4 py-3 font-medium">Ciudad</th>
            <th className="px-4 py-3 font-medium">Email</th>
            <th className="px-4 py-3 font-medium">Estado</th>
            <th className="px-4 py-3 font-medium">Alta</th>
          </tr>
        </thead>
        <tbody>
          {vendors.map((v) => (
            <tr
              key={v.id}
              onClick={() => onSelect(v.id)}
              className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
            >
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
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ClientTable({ clients }: { clients: AdminClient[] }) {
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
            <tr key={c.id} className="border-t border-slate-100">
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
