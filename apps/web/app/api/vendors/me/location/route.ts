import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import pool from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { parseJsonBody } from '@/lib/parse-json'
import { requireSameOrigin } from '@/lib/csrf'


// PATCH /api/vendors/me/location — update vendor GPS coordinates
export async function PATCH(req: NextRequest) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  try {
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth
    // Audit 2026-08-14 (Important #16): defense-in-depth role gate.
    // Ownership is checked below; a buyer with no vendor row
    // can never reach this code, but if the auto-bootstrap ever
    // changes (or a buyer somehow owns a row) this prevents it.
    if (auth.role !== 'seller' && auth.role !== 'service') {
      return NextResponse.json({ error: 'Prohibido' }, { status: 403 })
    }
    const userId = auth.userId

    // Rate limit: 30 updates/min per user (post-auth). Limits are per-account,
    // not per-IP, so attackers behind NAT don't punish legitimate sellers
    // and an attacker without a valid JWT can't fill our rate-limit table.
    const { allowed, retryAfter } = await checkRateLimit(userId, 'location_update', 30, 60 * 1000)
    if (!allowed) {
      return NextResponse.json(
        { error: 'Demasiadas actualizaciones de ubicación', retryAfter },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      )
    }

    const parsed = await parseJsonBody<{ latitude?: unknown; longitude?: unknown }>(req)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { latitude, longitude } = parsed.body

    if (
      typeof latitude !== 'number' || typeof longitude !== 'number' ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude)
    ) {
      return NextResponse.json({ error: 'Latitud y longitud son requeridas y deben ser números' }, { status: 400 })
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return NextResponse.json({ error: 'Coordenadas inválidas' }, { status: 400 })
    }

    // Colombia bounding box (same as /api/vendors/[id]/location):
    //   lat: -4.2 to 13.5 (continental Colombia + San Andrés/Providencia roughly)
    //   lng: -79.1 to -66.9
    if (latitude < -4.2 || latitude > 13.5 || longitude < -79.1 || longitude > -66.9) {
      return NextResponse.json({ error: 'Coordenadas fuera de Colombia' }, { status: 400 })
    }

    // Get vendor for this user
    const vendorRes = await pool.query(
      'SELECT v.id FROM vendors v JOIN profiles p ON p.id = v.profile_id WHERE p.user_id = $1',
      [userId]
    )

    if (vendorRes.rows.length === 0) {
      return NextResponse.json({ error: 'No tienes perfil de vendedor' }, { status: 404 })
    }

    const vendorId = vendorRes.rows[0].id

    // Update vendor location + set active
    await pool.query(
      // Audit 2026-08-14: dropped `, is_active = true` from the SET clause.
// Sharing GPS location doesn't override the seller's "I'm closed"
// toggle — otherwise toggling off then any GPS ping flips them back
// on, which made VendorVisibility meaningless. Activation is now
// managed exclusively through /api/vendors/me/settings (or the
// equivalent /api/vendors/[id]/location PUT with explicit isActive).
      'UPDATE vendors SET latitude = $1, longitude = $2, location_updated_at = NOW() WHERE id = $3',
      [latitude, longitude, vendorId]
    )

    return NextResponse.json({ success: true, latitude, longitude })
  } catch (err) {
    logger.error(serializeErr(err), 'Vendor location update error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
