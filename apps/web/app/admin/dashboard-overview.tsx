'use client'

/**
 * DashboardOverview — the default landing tab of /admin.
 *
 * Shows headline numbers (vendor totals, client totals, last-24h
 * activity), the top 5 cities by vendor density, and a live tail of the
 * 20 most recent admin audit rows so the admin can see what the team
 * (or they, an hour ago) did last.
 *
 * Why this is its own component instead of inline in admin-panel.tsx:
 * the dashboard is a single endpoint's worth of data with a clean card
 * layout — pulling its ~150 lines out keeps admin-panel.tsx focused on
 * the dense table-driven tabs (vendors/clients/audit).
 */

import { useEffect, useState } from 'react'

interface DashboardSummary {
  generatedAt: string
  vendors: {
    total: number
    active: number
    inactive: number
    verified: number
    pendingEmailVerified: number
    newLast24h: number
  }
  clients: {
    total: number
    active: number
    inactive: number
    verified: number
    newLast24h: number
    loginsLast24h: number
  }
  topCities: Array<{ cityId: string; cityName: string; vendorCount: number }>
  recentActivity: Array<{
    id: string
    action: string
    adminId: string
    adminEmail: string | null
    targetType: string | null
    targetId: string | null
    createdAt: string
  }>
}

export function DashboardOverview({
  onNavigate,
}: {
  /** Lets the dashboard cards deep-link to the right tab+filter. */
  onNavigate: (tab: 'vendors' | 'clients', filter: 'all' | 'true' | 'false') => void
}) {
  const [data, setData] = useState<DashboardSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/admin/stats/summary', { credentials: 'include' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as DashboardSummary
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error')
      }
    }
    load()
    // Re-fetch every 30s so the recent-activity tail doesn't go stale
    // while the admin stares at the screen.
    const t = setInterval(load, 30000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  if (error) {
    return (
      <div className="p-6 text-center text-sm text-red-600">
        Error al cargar el resumen: {error}
      </div>
    )
  }
  if (!data) {
    return <div className="p-6 text-center text-sm text-slate-500">Cargando…</div>
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Vendor stats — three columns on desktop, stacked on mobile */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">
          Vendedores
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total" value={data.vendors.total} onClick={() => onNavigate('vendors', 'all')} />
          <StatCard
            label="Activos"
            value={data.vendors.active}
            accent="green"
            onClick={() => onNavigate('vendors', 'true')}
          />
          <StatCard
            label="Inactivos"
            value={data.vendors.inactive}
            accent="slate"
            onClick={() => onNavigate('vendors', 'false')}
          />
          <StatCard
            label="Email sin verificar"
            value={data.vendors.pendingEmailVerified}
            accent="amber"
          />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {data.vendors.verified} verificados · {data.vendors.newLast24h} nuevos en las últimas 24h
        </p>
      </section>

      {/* Client stats */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">
          Clientes
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total" value={data.clients.total} onClick={() => onNavigate('clients', 'all')} />
          <StatCard
            label="Activos"
            value={data.clients.active}
            accent="green"
            onClick={() => onNavigate('clients', 'true')}
          />
          <StatCard
            label="Inactivos"
            value={data.clients.inactive}
            accent="slate"
            onClick={() => onNavigate('clients', 'false')}
          />
          <StatCard label="Verificados" value={data.clients.verified} accent="blue" />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {data.clients.newLast24h} nuevos en 24h · {data.clients.loginsLast24h} logins en 24h
        </p>
      </section>

      {/* Top cities + recent activity side by side on wide screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section>
          <h2 className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">
            Top 5 ciudades
          </h2>
          <div className="bg-white rounded border border-slate-200 divide-y divide-slate-100">
            {data.topCities.length === 0 && (
              <div className="px-4 py-6 text-sm text-slate-500 text-center">
                Sin datos de ciudad
              </div>
            )}
            {data.topCities.map((c, i) => (
              <div key={c.cityId} className="px-4 py-2.5 flex justify-between items-center text-sm">
                <span className="text-slate-700">
                  <span className="text-slate-400 mr-2">{i + 1}.</span>
                  {c.cityName}
                </span>
                <span className="text-slate-900 font-medium">{c.vendorCount}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">
            Actividad reciente
          </h2>
          <div className="bg-white rounded border border-slate-200 max-h-80 overflow-y-auto">
            {data.recentActivity.length === 0 && (
              <div className="px-4 py-6 text-sm text-slate-500 text-center">
                Sin actividad registrada
              </div>
            )}
            <ul className="divide-y divide-slate-100">
              {data.recentActivity.map((a) => (
                <li key={a.id}>
                  <div className="w-full text-left px-4 py-2.5 text-xs hover:bg-blue-50 transition-colors group">
                    <div className="flex justify-between items-baseline">
                      <span className="font-mono text-slate-700 group-hover:text-blue-700">
                        {a.action}
                      </span>
                      <span className="text-slate-400">
                        {new Date(a.createdAt).toLocaleString('es-CO', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <div className="text-slate-500 mt-0.5 truncate">
                      por{' '}
                      <span
                        className="font-medium text-slate-700"
                        title={a.adminEmail ?? a.adminId.slice(0, 8)}>
                        {a.adminEmail ?? a.adminId.slice(0, 8)}
                      </span>
                      {a.targetType && a.targetId && (
                        <> · {a.targetType}:{a.targetId.slice(0, 8)}…</>
                      )}
                  </div>
                </div>
              </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <p className="text-[10px] text-slate-400 text-center pt-2">
        Última actualización:{' '}
        {new Date(data.generatedAt).toLocaleTimeString('es-CO')} · auto-refresh 30s
      </p>
    </div>
  )
}

/** Small KPI card with an optional accent color and click handler. */
function StatCard({
  label,
  value,
  accent,
  onClick,
}: {
  label: string
  value: number
  accent?: 'green' | 'slate' | 'amber' | 'blue'
  onClick?: () => void
}) {
  const accentClass = {
    green: 'text-green-700',
    slate: 'text-slate-700',
    amber: 'text-amber-700',
    blue: 'text-blue-700',
  }[accent ?? 'slate']

  const base =
    'bg-white border border-slate-200 rounded px-4 py-3 ' +
    (onClick ? 'cursor-pointer hover:border-slate-400 transition-colors' : '')

  const inner = (
    <>
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accentClass}`}>{value.toLocaleString('es-CO')}</div>
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${base} text-left`}>
        {inner}
      </button>
    )
  }
  return <div className={base}>{inner}</div>
}
