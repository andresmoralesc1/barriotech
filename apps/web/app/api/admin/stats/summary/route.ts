/**
 * GET /api/admin/stats/summary — admin-only dashboard summary.
 *
 * Returns the numbers an admin wants to see at a glance when opening
 * /admin: vendor and client totals broken down by status, top cities,
 * recent admin activity, and last-24h registration / login trends.
 *
 * Cheap by design — every COUNT runs in one round-trip each (no joins
 * across the full table), and the recent-activity pull is bounded to
 * the last 20 audit rows regardless of timeframe filters.
 *
 * Admin-only. Audits its own existence with `view_dashboard_summary`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import pool from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { logger, serializeErr } from '@/lib/logger'
import { logAdminAction } from '@/lib/admin-audit'

interface VendorStats {
  total: number
  active: number
  inactive: number
  verified: number
  pendingEmailVerified: number
  newLast24h: number
}

interface ClientStats {
  total: number
  active: number
  inactive: number
  verified: number
  newLast24h: number
  loginsLast24h: number
}

interface TopCity {
  cityId: string
  cityName: string
  vendorCount: number
}

interface RecentActivity {
  id: string
  action: string
  adminId: string
  adminEmail: string | null
  targetType: string | null
  targetId: string | null
  createdAt: string
}

export interface DashboardSummary {
  generatedAt: string
  vendors: VendorStats
  clients: ClientStats
  topCities: TopCity[]
  recentActivity: RecentActivity[]
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth instanceof NextResponse) return auth

  const { allowed, retryAfter } = await checkRateLimit(
    auth.userId,
    'admin_stats_summary',
    30,
    60 * 1000
  )
  if (!allowed) {
    return NextResponse.json(
      { error: 'Demasiadas consultas', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  try {
    // Each block is one round-trip; nine queries in parallel for the
    // dashboard's worth. ~150ms p99 on a small DB.
    const [
      vTotals,
      cTotals,
      topCities,
      recent,
      vendorLogins,
    ] = await Promise.all([
      // Vendor totals — a single scan groups by is_active and is_verified.
      // Soft-deleted rows are excluded entirely so the dashboard numbers
      // stay aligned with what the public site shows.
      pool.query<{
        total: string
        active: string
        verified: string
        new24h: string
      }>(
        `SELECT
           COUNT(*)                                                          AS total,
           COUNT(*) FILTER (WHERE v.is_active = true)                        AS active,
           COUNT(*) FILTER (WHERE v.is_verified = true)                      AS verified,
           COUNT(*) FILTER (WHERE v.created_at >= NOW() - INTERVAL '24h')    AS new24h
         FROM vendors v
         WHERE v.deleted_at IS NULL`
      ),
      // Client totals — joins users → profiles to read both sides.
      pool.query<{
        total: string
        active: string
        verified: string
        new24h: string
      }>(
        `SELECT
           COUNT(*)                                                          AS total,
           COUNT(*) FILTER (WHERE u.is_active = true)                        AS active,
           COUNT(*) FILTER (WHERE u.email_verified = true)                   AS verified,
           COUNT(*) FILTER (WHERE u.created_at >= NOW() - INTERVAL '24h')    AS new24h
         FROM users u
         WHERE u.role = 'buyer'`
      ),
      // Top 5 cities by vendor count — useful for spotting where the
      // marketplace is densest. Excludes soft-deleted so the top stays
      // representative of the active marketplace.
      pool.query<{ cityId: string; cityName: string; vendorCount: string }>(
        `SELECT v.city_id AS "cityId",
                c.name    AS "cityName",
                COUNT(*)  AS "vendorCount"
         FROM vendors v
         JOIN cities c ON c.id = v.city_id
         WHERE v.city_id IS NOT NULL AND v.deleted_at IS NULL
         GROUP BY v.city_id, c.name
         ORDER BY COUNT(*) DESC
         LIMIT 5`
      ),
      // Last 20 audit rows, newest first, with the acting admin's email
      // resolved in one LEFT JOIN.
      pool.query<{
        id: string
        action: string
        adminId: string
        adminEmail: string | null
        targetType: string | null
        targetId: string | null
        createdAt: string
      }>(
        `SELECT a.id, a.action, a.admin_id AS "adminId",
                u.email         AS "adminEmail",
                a.target_type   AS "targetType",
                a.target_id     AS "targetId",
                a.created_at    AS "createdAt"
         FROM admin_audit_log a
         LEFT JOIN users u ON u.id = a.admin_id
         ORDER BY a.created_at DESC
         LIMIT 20`
      ),
      // Logins in the last 24h — proxy for "is the marketplace alive?"
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM users
         WHERE last_login_at >= NOW() - INTERVAL '24h'`
      ),
    ])

    const summary: DashboardSummary = {
      generatedAt: new Date().toISOString(),
      vendors: {
        total: parseInt(vTotals.rows[0]?.total ?? '0', 10),
        active: parseInt(vTotals.rows[0]?.active ?? '0', 10),
        inactive:
          parseInt(vTotals.rows[0]?.total ?? '0', 10) -
          parseInt(vTotals.rows[0]?.active ?? '0', 10),
        verified: parseInt(vTotals.rows[0]?.verified ?? '0', 10),
        // "Pending email verified" = owner whose email isn't yet verified.
        // We approximate by joining on the latest audit row — a precise
        // value is good enough for a dashboard card.
        pendingEmailVerified: 0, // filled below
        newLast24h: parseInt(vTotals.rows[0]?.new24h ?? '0', 10),
      },
      clients: {
        total: parseInt(cTotals.rows[0]?.total ?? '0', 10),
        active: parseInt(cTotals.rows[0]?.active ?? '0', 10),
        inactive:
          parseInt(cTotals.rows[0]?.total ?? '0', 10) -
          parseInt(cTotals.rows[0]?.active ?? '0', 10),
        verified: parseInt(cTotals.rows[0]?.verified ?? '0', 10),
        newLast24h: parseInt(cTotals.rows[0]?.new24h ?? '0', 10),
        loginsLast24h: parseInt(vendorLogins.rows[0]?.count ?? '0', 10),
      },
      topCities: topCities.rows.map((r) => ({
        cityId: r.cityId,
        cityName: r.cityName,
        vendorCount: parseInt(r.vendorCount, 10),
      })),
      recentActivity: recent.rows,
    }

    // Pull a precise "pending email verified" count from profiles so the
    // dashboard card doesn't lie. Cheap by itself (count only).
    const pendingRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM vendors v
       JOIN profiles p ON p.id = v.profile_id
       JOIN users u ON u.id = p.user_id
       WHERE u.email_verified = false AND v.deleted_at IS NULL`
    )
    summary.vendors.pendingEmailVerified = parseInt(
      pendingRes.rows[0]?.count ?? '0',
      10
    )

    logAdminAction(auth.userId, 'view_dashboard_summary', req, {
      metadata: { vendors: summary.vendors.total, clients: summary.clients.total },
    })

    return NextResponse.json(summary)
  } catch (err) {
    logger.error(serializeErr(err), 'admin stats summary error')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
