import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import pool from '@/lib/db'
import { requireSameOrigin } from '@/lib/csrf'
import { checkRateLimitByUser } from '@/lib/rate-limit'

/**
 * GET /api/vendors/[id]/business-hours — get vendor's business hours config.
 * PUT /api/vendors/[id]/business-hours — update vendor's business hours config.
 */

export async function GET(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  try {
    // SECURITY: business hours reveal when a vendor is open/closed. Before
    // this check any caller could enumerate vendor UUIDs and learn the
    // schedule of any competitor. Now the route requires auth + ownership.
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth

    const ownerCheck = await pool.query(
      `SELECT 1 FROM vendors
       WHERE id = $1 AND profile_id IN (SELECT id FROM profiles WHERE user_id = $2)`,
      [params.id, auth.userId]
    )
    if (ownerCheck.rows.length === 0) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const result = await pool.query(
      `SELECT business_hours_enabled, business_hours_start, business_hours_end, business_days
       FROM vendors WHERE id = $1`,
      [params.id]
    )
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Vendor no encontrado' }, { status: 404 })
    }
    return NextResponse.json({ hours: result.rows[0] })
  } catch (err) {
    logger.error(serializeErr(err), 'GET business-hours error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

const VALID_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export async function PUT(
  req: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  const params = await paramsPromise

  try {
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth

    // Per-user rate limit. 10/min — vendors tweak their hours rarely.
    const rl = await checkRateLimitByUser(req, 'set_business_hours', 10, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Intenta más tarde.', retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }
const userId = auth.userId
    // Verify ownership
    const ownerCheck = await pool.query(
      'SELECT id FROM vendors WHERE id = $1 AND profile_id IN (SELECT id FROM profiles WHERE user_id = $2)',
      [params.id, auth.userId]
    )
    if (ownerCheck.rows.length === 0) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const body = await req.json()
    const enabled = !!body.enabled
    const startTime = body.start || null // "HH:MM"
    const endTime = body.end || null
    const days = Array.isArray(body.days) ? body.days.filter((d: string) => VALID_DAYS.includes(d)) : []

    // Validate time format
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/
    if (enabled) {
      if (!startTime || !timeRe.test(startTime)) {
        return NextResponse.json({ error: 'Hora de inicio inválida' }, { status: 400 })
      }
      if (endTime && !timeRe.test(endTime)) {
        return NextResponse.json({ error: 'Hora de fin inválida' }, { status: 400 })
      }
      if (days.length === 0) {
        return NextResponse.json({ error: 'Selecciona al menos un día' }, { status: 400 })
      }
      // end < start: a business hours window that closes before it opens
      // is almost certainly a mistake. Reject with a clear message.
      if (endTime && endTime <= startTime) {
        return NextResponse.json(
          { error: 'La hora de fin debe ser posterior a la hora de inicio' },
          { status: 400 }
        )
      }
    }

    await pool.query(
      `UPDATE vendors
       SET business_hours_enabled = $1,
           business_hours_start = $2,
           business_hours_end = $3,
           business_days = $4
       WHERE id = $5`,
      [enabled, startTime, endTime, days, params.id]
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    logger.error(serializeErr(err), 'PUT business-hours error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}