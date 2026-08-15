import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import { requireAuth, requireVerifiedEmail } from '@/lib/auth'
import { isUuid } from '@/lib/core/utils/slug'
import pool from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/trusted-ip'
import { requireSameOrigin } from '@/lib/csrf'


// POST /api/reviews — submit a review (buyer only)
export async function POST(req: NextRequest) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  // Rate limit by IP (defense in depth — auth check happens next).
  // 10 reviews / hour per IP prevents scripted review bombing even
  // if a user authenticates with many accounts.
  const ip = getClientIp(req)
  const { allowed, retryAfter } = await checkRateLimit(ip, 'reviews', 10, 60 * 60 * 1000)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Demasiadas reseñas. Intenta más tarde.', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  try {
    // P1-1 (audit 2026-07-27): require verified email before posting a
    // review. The EmailVerifyBanner promises "Verifica tu email para ...
    // dejar reseñas"; previously this gate was disabled (2026-07-22) when
    // registration defaulted to email_verified=true. Now that we may have
    // unverified accounts again, re-enable via requireVerifiedEmail().
    const auth = await requireVerifiedEmail(req)
    if (auth instanceof NextResponse) return auth
    const userId = auth.userId

    if (auth.role !== 'buyer') {
      return NextResponse.json({ error: 'Solo compradores pueden dejar reseñas' }, { status: 403 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 })
    }
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body requerido' }, { status: 400 })
    }
    const b = body as { vendor_id?: unknown; vendorId?: unknown; rating?: unknown; comment?: unknown }
    // Accept both snake_case (vendor_id) and camelCase (vendorId) so callers
    // don't silently drop the field. Reviews already had this fallback.
    const vendor_id = (b.vendor_id ?? b.vendorId) as string | undefined
    const rating = b.rating
    const comment = b.comment

    if (!vendor_id || typeof vendor_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(vendor_id)) {
      return NextResponse.json({ error: 'vendor_id (UUID) requerido' }, { status: 400 })
    }
    if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Rating debe ser un entero entre 1 y 5' }, { status: 400 })
    }
    if (typeof comment !== 'string' || comment.trim().length < 3 || comment.length > 1000) {
      return NextResponse.json(
        { error: 'Comentario requerido (3-1000 caracteres)' },
        { status: 400 }
      )
    }

    // Security: ALWAYS use the authenticated user's profile name — never
    // trust author_name from the client (identity impersonation risk).
    let name = 'Cliente anónimo'
    const profileResult = await pool.query(
      'SELECT name FROM profiles WHERE user_id = $1',
      [auth.userId]
    )
    if (profileResult.rows.length > 0 && profileResult.rows[0].name) {
      name = profileResult.rows[0].name
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Lock the vendor row so concurrent reviews serialize and can't
      // race the AVG/COUNT recompute (was a HIGH bug — two simultaneous
      // reviews would each compute against their own stale snapshot).
      const vendorLock = await client.query(
        'SELECT id FROM vendors WHERE id = $1 FOR UPDATE',
        [vendor_id]
      )
      if (vendorLock.rows.length === 0) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'Vendedor no encontrado' }, { status: 404 })
      }

      const result = await client.query(
        `INSERT INTO reviews (vendor_id, author_name, rating, comment, user_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [vendor_id, name, rating, comment, auth.userId]
      )

      const stats = await client.query(
        'SELECT AVG(rating)::numeric(3,2) as avg_rating, COUNT(*)::int as count FROM reviews WHERE vendor_id = $1',
        [vendor_id]
      )
      await client.query(
        'UPDATE vendors SET rating = $1, review_count = $2 WHERE id = $3',
        [stats.rows[0].avg_rating, stats.rows[0].count, vendor_id]
      )

      await client.query('COMMIT')
      return NextResponse.json({ review: result.rows[0] }, { status: 201 })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    logger.error(serializeErr(err), 'Reviews POST error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// GET /api/reviews?vendorId=xxx
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const vendorId = searchParams.get('vendorId')

    // vendor_id is a UUID column — reject malformed values early instead of
    // letting the DB throw "invalid input syntax for type uuid" (which would
    // return a 500). Empty/missing vendorId returns the global list.
    if (vendorId !== null && vendorId !== '' && !isUuid(vendorId)) {
      return NextResponse.json({ error: 'vendorId debe ser un UUID válido' }, { status: 400 })
    }

    let query = 'SELECT * FROM reviews WHERE 1=1'
    const params: unknown[] = []

    if (vendorId) {
      params.push(vendorId)
      query += ` AND vendor_id = $${params.length}`
    }

    query += ' ORDER BY created_at DESC LIMIT 50'

    const result = await pool.query(query, params)
    return NextResponse.json({ reviews: result.rows })
  } catch (err) {
    logger.error(serializeErr(err), 'Reviews GET error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
