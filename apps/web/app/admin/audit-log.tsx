'use client'

/**
 * AuditLog — paginated, filterable view of admin_audit_log.
 *
 * Everything in this table is a write that someone cares about:
 * vendor activations, batch overrides, dashboard reads, CSV exports.
 * The simplest way to make an admin accountable is to give them a
 * window onto their own history.
 *
 * Filters supported: action substring, target type (user|vendor), and
 * a date range (since / until, both inclusive of since and exclusive
 * of until to match ISO-8601 half-open intervals). The list reset to
 * page 1 whenever a filter changes, so a narrowed search doesn't
 * strand you on an empty page.
 */

import { useEffect, useState, useCallback } from 'react'

interface AuditEntry {
  id: string
  adminId: string
  adminEmail: string | null
  action: string
  targetType: string | null
  targetId: string | null
  metadata: Record<string, unknown> | null
  ip: string | null
  createdAt: string
}

const PAGE_SIZE = 50

export function AuditLog({ initialAction = '' }: { initialAction?: string } = {}) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [action, setAction] = useState(initialAction)
  const [targetType, setTargetType] = useState<'all' | 'user' | 'vendor'>('all')
  const [since, setSince] = useState('') // YYYY-MM-DD
  const [until, setUntil] = useState('')

  const fetchPage = useCallback(
    async (off: number) => {
      setLoading(true)
      setError(null)
      try {
        const params = buildParams(action, targetType, since, until)
        params.set('limit', String(PAGE_SIZE))
        params.set('offset', String(off))

        const res = await fetch(`/api/admin/audit?${params}`, {
          credentials: 'include',
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as {
          entries: AuditEntry[]
          total: number
        }
        setEntries(json.entries)
        setTotal(json.total)
        setOffset(off)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error')
      } finally {
        setLoading(false)
      }
    },
    [action, targetType, since, until]
  )

  const exportCsv = useCallback(async () => {
    setExporting(true)
    setError(null)
    try {
      const params = buildParams(action, targetType, since, until)
      const res = await fetch(`/api/admin/audit/export?${params}`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setExporting(false)
    }
  }, [action, targetType, since, until])

  useEffect(() => {
    fetchPage(0)
  }, [fetchPage])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Filters bar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col">
          <label className="text-xs text-slate-500 mb-1">Acción contiene</label>
          <input
            type="search"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="ej. activate, batch_…"
            className="px-3 py-2 border border-slate-300 rounded text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-slate-500 mb-1">Tipo de target</label>
          <select
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as typeof targetType)}
            className="px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Todos</option>
            <option value="vendor">Vendor</option>
            <option value="user">User</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-slate-500 mb-1">Desde</label>
          <input
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-slate-500 mb-1">Hasta</label>
          <input
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            setAction('')
            setTargetType('all')
            setSince('')
            setUntil('')
          }}
          className="text-xs text-slate-600 hover:text-slate-900 underline self-end pb-2"
        >
          Limpiar filtros
        </button>
        <button
          type="button"
          onClick={exportCsv}
          disabled={exporting || loading}
          className="ml-auto px-4 py-2 bg-slate-900 text-white text-sm rounded hover:bg-slate-700 disabled:bg-slate-400 disabled:cursor-not-allowed self-end"
        >
          {exporting ? 'Exportando…' : 'Exportar CSV'}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        {error && (
          <div className="px-4 py-3 text-sm text-red-600 bg-red-50">Error: {error}</div>
        )}
        {loading ? (
          <div className="px-4 py-6 text-sm text-slate-500 text-center">Cargando…</div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-6 text-sm text-slate-500 text-center">
            No hay entradas que coincidan con los filtros
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Admin</th>
                <th className="px-3 py-2 text-left">Acción</th>
                <th className="px-3 py-2 text-left">Target</th>
                <th className="px-3 py-2 text-left">IP</th>
                <th className="px-3 py-2 text-left">Metadata</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString('es-CO', {
                      year: '2-digit',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </td>
                  <td className="px-3 py-2 text-slate-700 truncate max-w-[160px]">
                    {e.adminEmail ?? e.adminId.slice(0, 8) + '…'}
                  </td>
                  <td className="px-3 py-2">
                    <code className="px-1.5 py-0.5 bg-slate-100 rounded text-xs">
                      {e.action}
                    </code>
                  </td>
                  <td className="px-3 py-2 text-slate-600 text-xs">
                    {e.targetType ? (
                      <>
                        <span className="font-medium">{e.targetType}</span>
                        {e.targetId && (
                          <>
                            :<span className="font-mono ml-1">{e.targetId.slice(0, 8)}…</span>
                          </>
                        )}
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-xs font-mono">{e.ip ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {e.metadata ? (
                      <MetadataCell metadata={e.metadata} />
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination footer */}
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span>
          {total === 0
            ? 'Sin resultados'
            : `Mostrando ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} de ${total}`}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => fetchPage(Math.max(0, offset - PAGE_SIZE))}
            disabled={currentPage <= 1 || loading}
            className="px-3 py-1 rounded border border-slate-300 disabled:text-slate-300 disabled:cursor-not-allowed hover:bg-slate-50"
          >
            ‹ Anterior
          </button>
          <span className="px-3 py-1 text-slate-500">
            Página {currentPage} de {totalPages}
          </span>
          <button
            type="button"
            onClick={() => fetchPage(offset + PAGE_SIZE)}
            disabled={currentPage >= totalPages || loading}
            className="px-3 py-1 rounded border border-slate-300 disabled:text-slate-300 disabled:cursor-not-allowed hover:bg-slate-50"
          >
            Siguiente ›
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Audit metadata can be anything; show up to two keys + a "(+N more)"
 * hint, with full JSON in a <details> for the curious.
 */
function MetadataCell({ metadata }: { metadata: Record<string, unknown> }) {
  const keys = Object.keys(metadata).slice(0, 3)
  const more = Object.keys(metadata).length - keys.length
  return (
    <details>
      <summary className="cursor-pointer text-blue-600 hover:underline">
        {keys.map((k) => `${k}=${shortVal(metadata[k])}`).join(', ')}
        {more > 0 && ` (+${more})`}
      </summary>
      <pre className="mt-2 p-2 bg-slate-50 rounded text-[10px] max-w-md overflow-x-auto">
        {JSON.stringify(metadata, null, 2)}
      </pre>
    </details>
  )
}

function shortVal(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'object') return '{…}'
  const s = String(v)
  return s.length > 20 ? s.slice(0, 18) + '…' : s
}

/**
 * Build a URLSearchParams from the same filter set shared by the list
 * endpoint and the export endpoint. Centralized so the two stay in
 * sync — if a new filter gets added here, both pages pick it up.
 */
function buildParams(
  action: string,
  targetType: 'all' | 'user' | 'vendor',
  since: string,
  until: string
): URLSearchParams {
  const params = new URLSearchParams()
  if (action.trim()) params.set('action', action.trim())
  if (targetType !== 'all') params.set('targetType', targetType)
  if (since) params.set('since', `${since}T00:00:00Z`)
  if (until) params.set('until', `${until}T00:00:00Z`)
  return params
}
