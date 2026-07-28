/**
 * GET /api/admin/audit/export — CSV download of admin_audit_log entries
 * matching the same filters as GET /api/admin/audit.
 *
 * Hard cap: 5000 rows per export. Matches clients/export and
 * vendors/export. If the audit table grows past that we want the admin
 * to narrow the date range, not paste a 200 MB sheet into Excel.
 *
 * Filters respected (all optional, AND'd):
 *   ?adminId=<uuid>      — only entries from this admin
 *   ?action=<substring>  — case-insensitive substring of action name
 *   ?targetType=user|vendor   — limit to one kind of target
 *   ?since=<iso>         — created_at >= since
 *   ?until=<iso>         — created_at < until
 *
 * Headers: Content-Type: text/csv; charset=utf-8, Content-Disposition:
 * attachment; filename="auditoria-YYYY-MM-DD.csv". UTF-8 BOM at the
 * start keeps Excel from misreading accented characters.
 *
 * Admin-only. Audits with `export_audit_csv`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import pool from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { logger, serializeErr } from '@/lib/logger'
import { logAdminAction } from '@/lib/admin-audit'
import { toCsv } from '@/lib/csv'

const MAX_EXPORT_ROWS = 5000

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth instanceof NextResponse) return auth

  const { allowed, retryAfter } = await checkRateLimit(
    auth.userId,
    'admin_export_audit',
    5,
    60 * 1000
  )
  if (!allowed) {
    return NextResponse.json(
      { error: 'Demasiadas exportaciones', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  const url = new URL(req.url)
  const adminId = url.searchParams.get('adminId')?.trim()
  const action = url.searchParams.get('action')?.trim()
  const targetType = url.searchParams.get('targetType')?.trim()
  const since = url.searchParams.get('since')?.trim()
  const until = url.searchParams.get('until')?.trim()

  const conditions: string[] = []
  const params: unknown[] = []

  if (adminId && /^[0-9a-f-]{36}$/i.test(adminId)) {
    params.push(adminId)
    conditions.push(`a.admin_id = $${params.length}`)
  }
  if (action) {
    params.push(`%${action}%`)
    conditions.push(`a.action ILIKE $${params.length}`)
  }
  if (targetType === 'user' || targetType === 'vendor') {
    params.push(targetType)
    conditions.push(`a.target_type = $${params.length}`)
  }
  if (since) {
    params.push(since)
    conditions.push(`a.created_at >= $${params.length}`)
  }
  if (until) {
    params.push(until)
    conditions.push(`a.created_at < $${params.length}`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  try {
    const result = await pool.query(
      `SELECT
         a.id, a.admin_id, u.email AS admin_email,
         a.action, a.target_type, a.target_id, a.metadata,
         a.ip, a.created_at
       FROM admin_audit_log a
       LEFT JOIN users u ON u.id = a.admin_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT ${MAX_EXPORT_ROWS}`,
      params
    )

    const headers = [
      'id', 'created_at', 'admin_id', 'admin_email',
      'action', 'target_type', 'target_id',
      'ip', 'metadata',
    ]

    const rows = result.rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      admin_id: r.admin_id,
      admin_email: r.admin_email ?? '',
      action: r.action,
      target_type: r.target_type ?? '',
      target_id: r.target_id ?? '',
      ip: r.ip ?? '',
      metadata: r.metadata ? JSON.stringify(r.metadata) : '',
    }))

    const csv = toCsv(headers, rows)

    logAdminAction(auth.userId, 'export_audit_csv', req, {
      metadata: {
        filters: { adminId, action, targetType, since, until },
        rows: rows.length,
        capped: rows.length === MAX_EXPORT_ROWS,
      },
    })

    const datestamp = new Date().toISOString().slice(0, 10)
    const filename = `auditoria-${datestamp}.csv`

    return new NextResponse('\ufeff' + csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    logger.error(serializeErr(err), 'admin audit export error')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
