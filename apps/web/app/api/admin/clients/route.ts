/**
 * GET /api/admin/clients — admin-only list of all buyers.
 *
 * Buyers don't have a vendor row; they're plain users with role='buyer'.
 * Filters (all optional, AND'd):
 *   ?cityId=bogota           — match users.city_id
 *   ?active=true|false       — match users.is_active
 *   ?verified=true|false     — match users.email_verified
 *   ?since=YYYY-MM-DD        — users.created_at >= since
 *   ?until=YYYY-MM-DD        — users.created_at <  until (exclusive upper bound)
 *   ?q=texto                  — case-insensitive search over users.name OR users.email
 *   ?limit=50&offset=0        — pagination (default 50, max 200)
 *
 * Admin-only. Every call is written to admin_audit_log.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import pool from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { logger, serializeErr } from '@/lib/logger'
import { logAdminAction } from '@/lib/admin-audit'

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth instanceof NextResponse) return auth

  const { allowed, retryAfter } = await checkRateLimit(
    auth.userId,
    'admin_client_list',
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
  const cityId = url.searchParams.get('cityId')
  const active = url.searchParams.get('active')
  const verified = url.searchParams.get('verified')
  const since = url.searchParams.get('since')
  const until = url.searchParams.get('until')
  const q = url.searchParams.get('q')?.trim()
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10)
  const offsetRaw = parseInt(url.searchParams.get('offset') ?? '', 10)

  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
    : DEFAULT_LIMIT
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0

  const conditions: string[] = ["u.role = 'buyer'"]
  const params: unknown[] = []

  if (cityId) {
    params.push(cityId)
    conditions.push(`u.city_id = $${params.length}`)
  }
  if (active === 'true') conditions.push('u.is_active = true')
  else if (active === 'false') conditions.push('u.is_active = false')
  if (verified === 'true') conditions.push('u.email_verified = true')
  else if (verified === 'false') conditions.push('u.email_verified = false')
  if (since) {
    params.push(since)
    conditions.push(`u.created_at >= $${params.length}`)
  }
  if (until) {
    params.push(until)
    conditions.push(`u.created_at < $${params.length}`)
  }
  if (q) {
    params.push(`%${q}%`)
    const idx = params.length
    conditions.push(`(u.name ILIKE $${idx} OR u.email ILIKE $${idx})`)
  }

  const where = `WHERE ${conditions.join(' AND ')}`

  try {
    params.push(limit, offset)
    const result = await pool.query(
      `SELECT
         u.id, u.email, u.name, u.phone, u.city_id,
         u.is_active, u.email_verified, u.created_at, u.last_login_at,
         COUNT(*) OVER() AS total_count
       FROM users u
       ${where}
       ORDER BY u.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    const clients = result.rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      phone: r.phone,
      cityId: r.city_id,
      isActive: r.is_active,
      emailVerified: r.email_verified,
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at,
    }))

    const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0

    logAdminAction(auth.userId, 'view_client_list', req, {
      metadata: { filters: { cityId, active, verified, since, until, q }, limit, offset, returned: clients.length },
    })

    return NextResponse.json({ clients, total, limit, offset })
  } catch (err) {
    logger.error(serializeErr(err), 'admin client list error')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
