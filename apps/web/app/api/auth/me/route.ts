import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import pool from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { getCityById } from '@/lib/core/constants'
import { isPhone, normalizePhone } from '@/lib/auth-helpers'
import { parseJsonBody } from '@/lib/parse-json'
import { sanitizeDisplayName } from '@/lib/sanitize'
import { requireSameOrigin } from '@/lib/csrf'
import { checkRateLimitByUser } from '@/lib/rate-limit'
const noStoreHeaders = { 'Cache-Control': 'no-store' } as const
async function getUserFromDb(userId: string) {
  const result = await pool.query(
    'SELECT id, email, name, role, phone, city_id, is_active, email_verified FROM users WHERE id = $1',
    [userId]
  )
  if (result.rows.length === 0) return null
  const u = result.rows[0]
  if (!u.is_active) return null
  return {
    id: u.id,
    email: u.email,
    fullName: u.name || '',
    role: u.role,
    phone: u.phone || '',
    cityId: u.city_id || '',
    avatarUrl: '',
    emailVerified: u.email_verified,
  }
}

// GET /api/auth/me — reads cookie OR Authorization header
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth
// Per-user rate limit. 20/min — bursty but bounded.
const rl = await checkRateLimitByUser(req, 'auth_me_update', 20, 60_000)
if (!rl.allowed) {
  return NextResponse.json(
    { error: 'Demasiadas solicitudes. Intenta más tarde.', retryAfter: rl.retryAfter },
    { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
  )}


    const user = await getUserFromDb(auth.userId)
    if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })

    return NextResponse.json(user, { headers: noStoreHeaders })
  } catch (err) {
    logger.error(serializeErr(err), 'GET /api/auth/me error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// PATCH /api/auth/me — update user profile (name, phone, cityId)
export async function PATCH(req: NextRequest) {
  // C2 (audit 2026-07-27): CSRF check on profile update. SameSite=strict
  // cookies already block naive cross-site mutations, but defense-in-depth
  // (matching the rest of the mutating endpoints) keeps us safe if the
  // cookie policy ever softens (e.g. for an OAuth callback later).
  const csrf = requireSameOrigin(req); if (csrf) return csrf
  try {
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth

    const parsed = await parseJsonBody<{
      name?: unknown; phone?: unknown; cityId?: unknown;
    }>(req)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { name, phone, cityId } = parsed.body

    // SECURITY: 'role' is intentionally NOT updatable here. Role is set once at
    // /api/auth/register and is immutable for the lifetime of the account. To
    // change role, contact support (intentional friction to prevent silent
    // privilege escalation from buyer to seller or vice versa).
    void 0

    const updates: string[] = []
    const values: unknown[] = []
    let paramCount = 1

    if (name !== undefined) {
      if (typeof name !== 'string') {
        return NextResponse.json({ error: 'name debe ser texto' }, { status: 400 })
      }
      // M5 (audit 2026-07-27): sanitizeDisplayName strips zero-width + bidi
      // controls and normalizes Unicode to NFC before the length check.
      const trimmed = sanitizeDisplayName(name)
      if (!trimmed) {
        return NextResponse.json({ error: 'El nombre es requerido' }, { status: 400 })
      }
      if (trimmed.length < 2) {
        return NextResponse.json(
          { error: 'El nombre debe tener al menos 2 caracteres' },
          { status: 400 }
        )
      }
      if (trimmed.length > 100) {
        return NextResponse.json(
          { error: 'El nombre es demasiado largo (máx 100 caracteres)' },
          { status: 400 }
        )
      }
      updates.push(`name = $${paramCount++}`)
      values.push(trimmed)
    }
    if (phone !== undefined) {
      if (phone !== null && typeof phone !== 'string') {
        return NextResponse.json({ error: 'phone debe ser texto' }, { status: 400 })
      }
      // Empty string clears the phone. Otherwise validate via the shared
      // normalizePhone helper (M9 audit 2026-07-27) so the same rules
      // apply on register, login, and profile update.
      let normalizedPhone: string | null = null
      if (typeof phone === 'string' && phone.trim() !== '') {
        if (!isPhone(phone)) {
          return NextResponse.json(
            { error: 'Ingresa un número de teléfono colombiano válido (10 dígitos)' },
            { status: 400 }
          )
        }
        const normalized = normalizePhone(phone)
        normalizedPhone = normalized // guaranteed non-null when isPhone() is true
      }
      updates.push(`phone = $${paramCount++}`)
      values.push(normalizedPhone)
    }
    if (cityId !== undefined) {
      // S1-DB-3 (audit 2026-07-22): users.city_id is text without FK, so without
      // this check a PATCH could set city_id='marte' or any garbage. vendors
      // table has a CHECK constraint that DOES enforce Colombian cities (see
      // commit aa5b09f), so a free-form cityId would create an inconsistency
      // between user.city_id and the bootstrap vendor's city_id. Mirror the
      // register flow's validation: whitelist against COLOMBIA_CITIES.
      if (typeof cityId !== 'string' || cityId === '') {
        return NextResponse.json({ error: 'cityId debe ser texto' }, { status: 400 })
      }
      const validCity = !!getCityById(cityId)
      if (!validCity) {
        return NextResponse.json(
          { error: 'Ciudad no válida. Selecciona una de la lista.' },
          { status: 400 }
        )
      }
      updates.push(`city_id = $${paramCount++}`)
      values.push(cityId)
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
    }

    values.push(auth.userId)
    let result
    try {
      result = await pool.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id, email, name, role, phone, city_id`,
        values
      )
    } catch (err) {
      // 23505 = unique_violation — surface which field collided so the
      // frontend can highlight the right input. Before this catch the
      // user saw a generic 500 and the endpoint looked broken.
      const errObj = typeof err === 'object' && err !== null ? (err as { code?: unknown; constraint?: unknown; message?: unknown }) : null
      if (errObj?.code === '23505') {
        const constraint = typeof errObj.constraint === 'string' ? errObj.constraint : ''
        const field = constraint.includes('email') ? 'email'
          : constraint.includes('phone') ? 'phone'
          : 'campo'
        return NextResponse.json(
          { error: `Ya existe otro usuario con ese ${field}` },
          { status: 409 }
        )
      }
      // P0001 = trigger-raised exception (see migration 020). Today only
      // users_role_immutable_guard uses it, surfacing it as 409 makes the
      // contract explicit if/when we expose role in this endpoint.
      const message = typeof errObj?.message === 'string' ? errObj.message : ''
      if (errObj?.code === 'P0001' && /role is immutable/i.test(message)) {
        return NextResponse.json(
          { error: 'El rol de la cuenta no se puede cambiar' },
          { status: 409 }
        )
      }
      throw err
    }

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    const user = result.rows[0]
    return NextResponse.json({
      id: user.id,
      email: user.email,
      fullName: user.name,
      role: user.role,
      phone: user.phone || '',
      cityId: user.city_id || '',
      avatarUrl: '',
    }, { headers: noStoreHeaders })
  } catch (err) {
    logger.error(serializeErr(err), 'PATCH /api/auth/me error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}