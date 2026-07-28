/**
 * GET /api/admin/vendors/export — CSV download of vendors matching the
 * same filters as GET /api/admin/vendors.
 *
 * Hard cap: 5000 rows per export. If the table grows past that we want
 * the admin to filter before exporting, not paste a 200 MB sheet into
 * Excel.
 *
 * Headers: Content-Type: text/csv; charset=utf-8, Content-Disposition:
 * attachment; filename="...". The Content-Disposition uses a date
 * stamp so repeated exports don't overwrite each other in /tmp.
 *
 * Soft-deleted vendors are hidden by default; pass
 * ?includeDeleted=true to include them (useful for auditing trash
 * before a permanent purge).
 *
 * Admin-only. Audits with `export_vendors_csv`.
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
    'admin_export_vendors',
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
  const cityId = url.searchParams.get('cityId')
  const active = url.searchParams.get('active')
  const q = url.searchParams.get('q')?.trim()
  const verified = url.searchParams.get('verified')
  const withPhoto = url.searchParams.get('withPhoto')
  const since = url.searchParams.get('since')
  const until = url.searchParams.get('until')
  const includeDeleted = url.searchParams.get('includeDeleted') === 'true'

  const conditions: string[] = []
  const params: unknown[] = []

  if (!includeDeleted) conditions.push('v.deleted_at IS NULL')
  if (cityId) {
    params.push(cityId)
    conditions.push(`v.city_id = $${params.length}`)
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

  try {
    const result = await pool.query(
      `SELECT
         v.id, v.name, v.slug, v.category, v.description, v.phone,
         v.city_id, v.is_active, v.is_verified, v.created_at, v.deleted_at,
         v.photo_url, v.latitude, v.longitude, v.rating, v.review_count,
         c.name AS city_name, c.department,
         u.email AS owner_email, u.phone AS owner_phone,
         u.email_verified AS owner_email_verified,
         u.last_login_at AS owner_last_login_at
       FROM vendors v
       JOIN profiles p ON p.id = v.profile_id
       JOIN users u ON u.id = p.user_id
       LEFT JOIN cities c ON c.id = v.city_id
       ${where}
       ORDER BY v.created_at DESC
       LIMIT ${MAX_EXPORT_ROWS}`,
      params
    )

    const headers = [
      'id', 'name', 'slug', 'category', 'description', 'phone',
      'city_id', 'city_name', 'department',
      'latitude', 'longitude',
      'is_active', 'is_verified', 'rating', 'review_count',
      'owner_email', 'owner_phone', 'owner_email_verified',
      'owner_last_login_at', 'created_at', 'deleted_at',
    ]

    const rows = result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      category: r.category,
      description: r.description,
      phone: r.phone,
      city_id: r.city_id,
      city_name: r.city_name,
      department: r.department,
      latitude: r.latitude,
      longitude: r.longitude,
      is_active: r.is_active ? 'true' : 'false',
      is_verified: r.is_verified ? 'true' : 'false',
      rating: r.rating,
      review_count: r.review_count,
      owner_email: r.owner_email,
      owner_phone: r.owner_phone,
      owner_email_verified: r.owner_email_verified ? 'true' : 'false',
      owner_last_login_at: r.owner_last_login_at,
      created_at: r.created_at,
      deleted_at: r.deleted_at,
    }))

    const csv = toCsv(headers, rows)

    logAdminAction(auth.userId, 'export_vendors_csv', req, {
      metadata: {
        filters: { cityId, active, verified, q, withPhoto, since, until, includeDeleted },
        rows: rows.length,
      },
    })

    const datestamp = new Date().toISOString().slice(0, 10)
    const filename = includeDeleted ? `vendedores-papelera-${datestamp}.csv` : `vendedores-${datestamp}.csv`

    // BOM at the start makes Excel auto-detect UTF-8 instead of CP1252,
    // which keeps accented city names ("Bogotá") from going mojibake.
    return new NextResponse('\ufeff' + csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    logger.error(serializeErr(err), 'admin vendor export error')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
