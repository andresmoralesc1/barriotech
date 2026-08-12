import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import pool from '@/lib/db'
import { parseJsonBody } from '@/lib/parse-json'
import { requireSameOrigin } from '@/lib/csrf'
import { checkRateLimitByUser } from '@/lib/rate-limit'

/**
 * PATCH /api/vendors/me/settings
 *
 * Body (all fields optional — only what you send gets updated):
 *   {
 *     station_type?:              'fixed' | 'mobile'
 *     is_active?:                 boolean   (vendor-controlled visibility toggle)
 *     business_hours_enabled?:    boolean   (if false, schedule is ignored — vendor is always open)
 *     business_hours_start?:      string    "HH:MM"  (24h)
 *     business_hours_end?:        string    "HH:MM"  (24h)
 *     business_days?:             string[]  subset of ['mon','tue','wed','thu','fri','sat','sun']
 *   }
 *
 * Auth:
 *   Vendor-only. Returns 403 if the user is not a seller, 404 if they don't
 *   own a vendor row.
 *
 * Validation:
 *   - station_type / days enum-checked
 *   - hours must match HH:MM
 *   - end > start (a vendor can't close before opening)
 *
 * Scope:
 *   This endpoint only edits the *currently selected* vendor. Multi-vendor
 *   users (rare) can pass ?vendorId=<uuid>; we still verify ownership.
 */
const VALID_DAYS = ['mon','tue','wed','thu','fri','sat','sun'] as const

function parseHHMM(s: unknown): { h: number; m: number } | null {
  if (typeof s !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const hh = Number(m[1]), mm = Number(m[2])
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return { h: hh, m: mm }
}

export async function PATCH(req: NextRequest) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  try {
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth
// Per-user rate limit. 10/min — bursty but bounded.
const rl = await checkRateLimitByUser(req, 'update_vendor_settings', 10, 60_000)
if (!rl.allowed) {
  return NextResponse.json(
    { error: 'Demasiadas solicitudes. Intenta más tarde.', retryAfter: rl.retryAfter },
    { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
  )}

    const userId = auth.userId

    if (auth.role !== 'seller' && auth.role !== 'service') {
      return NextResponse.json({ error: 'Solo vendedores pueden editar su perfil' }, { status: 403 })
    }

    let body: Record<string, unknown>
    const parsed = await parseJsonBody<Record<string, unknown>>(req)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    body = parsed.body
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Body debe ser un objeto' }, { status: 400 })
    }
    const bodyObj = body

    // ── Resolve which vendor we edit. Default = current active_vendor_id from
    // localStorage mirror on the client; here we just take the first vendor
    // the user owns (they're allowed to switch via ?vendorId).
    const url = new URL(req.url)
    const requestedVendorId = url.searchParams.get('vendorId')

    let vendorId: string
    if (requestedVendorId) {
      const own = await pool.query(
        'SELECT id FROM vendors WHERE id = $1 AND profile_id = (SELECT id FROM profiles WHERE user_id = $2)',
        [requestedVendorId, auth.userId]
      )
      if (own.rows.length === 0) {
        return NextResponse.json({ error: 'Vendedor no encontrado o no te pertenece' }, { status: 404 })
      }
      vendorId = own.rows[0].id
    } else {
      const first = await pool.query(
        'SELECT id FROM vendors WHERE profile_id = (SELECT id FROM profiles WHERE user_id = $1) ORDER BY created_at ASC LIMIT 1',
        [auth.userId]
      )
      if (first.rows.length === 0) {
        return NextResponse.json({ error: 'No tienes un vendedor asociado' }, { status: 404 })
      }
      vendorId = first.rows[0].id
    }

    // ── Build dynamic SET clause. Each field validated before adding.
    const sets: string[] = []
    const params: any[] = []
    let i = 1

    if (bodyObj.station_type !== undefined) {
      if (bodyObj.station_type !== null && bodyObj.station_type !== 'fixed' && bodyObj.station_type !== 'mobile') {
        return NextResponse.json({ error: 'station_type debe ser "fixed" o "mobile"' }, { status: 400 })
      }
      sets.push(`station_type = $${i++}`)
      params.push(bodyObj.station_type)
    }

    if (bodyObj.is_active !== undefined) {
      if (typeof bodyObj.is_active !== 'boolean') {
        return NextResponse.json({ error: 'is_active debe ser booleano' }, { status: 400 })
      }
      sets.push(`is_active = $${i++}`)
      params.push(bodyObj.is_active)
    }

    if (bodyObj.business_hours_enabled !== undefined) {
      if (typeof bodyObj.business_hours_enabled !== 'boolean') {
        return NextResponse.json({ error: 'business_hours_enabled debe ser booleano' }, { status: 400 })
      }
      sets.push(`business_hours_enabled = $${i++}`)
      params.push(bodyObj.business_hours_enabled)
    }

    // For start/end/days we require consistent state: if any of the three is
    // present, all three are required (otherwise the schedule is ambiguous).
    const hasStart = bodyObj.business_hours_start !== undefined
    const hasEnd = bodyObj.business_hours_end !== undefined
    const hasDays = bodyObj.business_days !== undefined
    if (hasStart || hasEnd || hasDays) {
      if (!(hasStart && hasEnd && hasDays)) {
        return NextResponse.json(
          { error: 'Si modificas horario, debes enviar start, end Y days' },
          { status: 400 }
        )
      }
      const start = parseHHMM(bodyObj.business_hours_start)
      const end = parseHHMM(bodyObj.business_hours_end)
      if (!start || !end) {
        return NextResponse.json(
          { error: 'Horario debe ser HH:MM (24h)' },
          { status: 400 }
        )
      }
      const startMin = start.h * 60 + start.m
      const endMin = end.h * 60 + end.m
      if (endMin <= startMin) {
        return NextResponse.json(
          { error: 'La hora de cierre debe ser después de la hora de apertura' },
          { status: 400 }
        )
      }
      if (!Array.isArray(bodyObj.business_days) || bodyObj.business_days.length === 0) {
        return NextResponse.json({ error: 'business_days debe ser un array no vacío' }, { status: 400 })
      }
      const daysClean: string[] = []
      for (const d of bodyObj.business_days) {
        if (typeof d !== 'string' || !(VALID_DAYS as readonly string[]).includes(d)) {
          return NextResponse.json(
            { error: `Día inválido: ${String(d)}. Usa: mon tue wed thu fri sat sun` },
            { status: 400 }
          )
        }
        daysClean.push(d)
      }
      sets.push(`business_hours_start = $${i++}`); params.push(`${String(start.h).padStart(2,'0')}:${String(start.m).padStart(2,'0')}`)
      sets.push(`business_hours_end = $${i++}`);   params.push(`${String(end.h).padStart(2,'0')}:${String(end.m).padStart(2,'0')}`)
      sets.push(`business_days = $${i++}`);         params.push(daysClean)
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'No enviaste campos para actualizar' }, { status: 400 })
    }

    params.push(vendorId)
    const sql = `UPDATE vendors SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, station_type, is_active, business_hours_enabled, business_hours_start, business_hours_end, business_days`

    const result = await pool.query(sql, params)
    return NextResponse.json({ vendor: result.rows[0] })
  } catch (err) {
    logger.error(serializeErr(err), 'vendors/me/settings PATCH error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}