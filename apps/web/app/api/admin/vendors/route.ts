/**
 * GET /api/admin/vendors — admin-only list of all vendors.
 *
 * Filters (all optional, AND'd):
 *   ?cityId=bogota           — match vendor.city_id
 *   ?active=true|false       — match vendor.is_active
 *   ?q=texto                  — case-insensitive search over vendor.name
 *   ?since=YYYY-MM-DD         — registered on or after this date
 *   ?until=YYYY-MM-DD         — registered before this date (exclusive)
 *   ?verified=true|false      — owner email_verified
 *   ?withPhoto=true|false     — vendor.photo_url NOT NULL
 *   ?includeDeleted=true      — show soft-deleted (default: hide them)
 *   ?limit=50&offset=0        — pagination (default 50, max 200)
 *
 * Admin-only. Every call is written to admin_audit_log so we can
 * answer "who looked at vendor X" without a separate access log.
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
    'admin_vendor_list',
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
  // Phase L8: support a category filter on the admin vendor list.
  // The "Servicios" virtual option sends the comma-separated 5 service
  // category ids so the admin can filter to "all service vendors"
  // without picking one at a time. The query uses ANY (v.category =
  // ANY(...)) which Postgres resolves to an IN-clause under the hood.
  const categoryParam = url.searchParams.get('category')
  const ALLOWED_CATEGORIES = [
    'frutas','comida','bebidas','artesanias','ropa','otros',
    'clases','bienestar','belleza','hogar','eventos',
  ]
  const requestedCategories = (categoryParam ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => ALLOWED_CATEGORIES.includes(s))
  const active = url.searchParams.get('active')
  const q = url.searchParams.get('q')?.trim()
  const verified = url.searchParams.get('verified')
  const withPhoto = url.searchParams.get('withPhoto')
  const since = url.searchParams.get('since')
  const until = url.searchParams.get('until')
  const includeDeleted = url.searchParams.get('includeDeleted') === 'true'
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10)
  const offsetRaw = parseInt(url.searchParams.get('offset') ?? '', 10)

  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
    : DEFAULT_LIMIT
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0

  const conditions: string[] = []
  const params: unknown[] = []

  if (!includeDeleted) {
    conditions.push('v.deleted_at IS NULL')
  }
  if (cityId) {
    params.push(cityId)
    conditions.push(`v.city_id = $${params.length}`)
  }
  // Phase L8: category filter. `category=Servicios` → all 5 service
  // category ids (the virtual "Servicios" group). `category=clases`
  // → that single category. Comma-separated multi-value supported.
  // The values were validated against the ALLOWED_CATEGORIES
  // allowlist at parse time so the SQL is bound to safe strings.
  if (requestedCategories.length > 0) {
    const placeholders = requestedCategories.map((_, i) => `$${params.length + i}`).join(',')
    for (const c of requestedCategories) params.push(c)
    conditions.push(`v.category IN (${placeholders})`)
  }
  if (active === 'true') conditions.push('v.is_active = true')
  else if (active === 'false') conditions.push('v.is_active = false')
  if (verified === 'true') conditions.push('u.email_verified = true')
  else if (verified === 'false') conditions.push('u.email_verified = false')
  if (withPhoto === 'true') conditions.push('v.photo_url IS NOT NULL')
  else if (withPhoto === 'false') conditions.push('v.photo_url IS NULL')
  if (since) {
    params.push(since)
    conditions.push(`v.created_at >= $${params.length}`)
  }
  if (until) {
    params.push(until)
    conditions.push(`v.created_at < $${params.length}`)
  }
  if (q) {
    params.push(`%${q}%`)
    conditions.push(`v.name ILIKE $${params.length}`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  // COUNT(*) OVER() piggybacks a total on the same scan so we don't
  // do a second round-trip just for the pagination footer.
  try {
    params.push(limit, offset)
    const result = await pool.query(
      `SELECT
         v.id, v.name, v.slug, v.category, v.description, v.phone,
         v.city_id, v.latitude, v.longitude,
         v.is_active, v.is_verified, v.created_at, v.photo_url,
         v.deleted_at,
         p.name AS owner_name,
         u.email AS owner_email, u.phone AS owner_phone,
         u.email_verified AS owner_email_verified,
         COUNT(*) OVER() AS total_count
       FROM vendors v
       JOIN profiles p ON p.id = v.profile_id
       JOIN users u ON u.id = p.user_id
       ${where}
       ORDER BY v.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    const vendors = result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      category: r.category,
      description: r.description,
      phone: r.phone,
      cityId: r.city_id,
      latitude: r.latitude,
      longitude: r.longitude,
      isActive: r.is_active,
      isVerified: r.is_verified,
      photoUrl: r.photo_url,
      createdAt: r.created_at,
      deletedAt: r.deleted_at,
      owner: {
        name: r.owner_name,
        email: r.owner_email,
        phone: r.owner_phone,
        emailVerified: r.owner_email_verified,
      },
    }))

    const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0

    // Fire-and-forget audit
    logAdminAction(auth.userId, 'view_vendor_list', req, {
      metadata: {
        filters: { cityId, active, q, verified, withPhoto, since, until, includeDeleted },
        limit,
        offset,
        returned: vendors.length,
      },
    })

    return NextResponse.json({ vendors, total, limit, offset })
  } catch (err) {
    logger.error(serializeErr(err), 'admin vendor list error')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
