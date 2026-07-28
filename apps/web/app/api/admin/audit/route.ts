/**
 * GET /api/admin/audit — paginated audit log with filters.
 *
 * Filters (all optional, AND'd):
 *   ?adminId=<uuid>      — only entries from this admin
 *   ?action=<substring>  — case-insensitive substring of action name
 *   ?targetType=user|vendor   — limit to one kind of target
 *   ?since=<iso>         — created_at >= since (inclusive)
 *   ?until=<iso>         — created_at <= until (exclusive)
 *   ?limit=50&offset=0   — pagination (default 50, max 200)
 *
 * Audits its own access with `view_admin_audit_log`. The actions a
 * previous admin took are themselves sensitive — reading this table is
 * observable.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import pool from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { logger, serializeErr } from '@/lib/logger'
import { logAdminAction } from '@/lib/admin-audit'

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

interface AuditRow {
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

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth instanceof NextResponse) return auth

  const { allowed, retryAfter } = await checkRateLimit(
    auth.userId,
    'admin_audit_list',
    60,
    60 * 1000
  )
  if (!allowed) {
    return NextResponse.json(
      { error: 'Demasiadas consultas', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  const url = new URL(req.url)
  const adminId = url.searchParams.get('adminId')?.trim()
  const action = url.searchParams.get('action')?.trim()
  const targetType = url.searchParams.get('targetType')?.trim()
  const since = url.searchParams.get('since')?.trim()
  const until = url.searchParams.get('until')?.trim()
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10)
  const offsetRaw = parseInt(url.searchParams.get('offset') ?? '', 10)

  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
    : DEFAULT_LIMIT
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0

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
    params.push(limit, offset)
    const result = await pool.query(
      `SELECT a.id, a.admin_id, a.action, a.target_type, a.target_id,
              a.metadata, a.ip, a.created_at,
              u.email AS admin_email,
              COUNT(*) OVER() AS total_count
       FROM admin_audit_log a
       LEFT JOIN users u ON u.id = a.admin_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    const entries: AuditRow[] = result.rows.map((r) => ({
      id: r.id,
      adminId: r.admin_id,
      adminEmail: r.admin_email ?? null,
      action: r.action,
      targetType: r.target_type ?? null,
      targetId: r.target_id ?? null,
      metadata: r.metadata ?? null,
      ip: r.ip ?? null,
      createdAt: r.created_at,
    }))

    const total = result.rows.length > 0
      ? parseInt(result.rows[0].total_count, 10)
      : 0

    logAdminAction(auth.userId, 'view_admin_audit_log', req, {
      metadata: { filters: { adminId, action, targetType, since, until }, limit, offset, returned: entries.length },
    })

    return NextResponse.json({ entries, total, limit, offset })
  } catch (err) {
    logger.error(serializeErr(err), 'admin audit list error')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
