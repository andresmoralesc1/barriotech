import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE_PATH } from '@/lib/auth-cookies'
import { logger, serializeErr } from '@/lib/logger'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { COLOMBIA_CITIES } from '@/lib/core/constants'
import { signTokenSync } from '@/lib/auth'
import { checkRateLimit, checkRateLimitByIdentifier } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/trusted-ip'
import { issueEmailVerificationToken, sendVerificationEmail } from '@/lib/email'
import { generateUniqueSlug } from '@/lib/vendor-slug'
import {
  isEmail,
  isPhone,
  normalizeEmail,
  normalizePhone,
} from '@/lib/auth-helpers'
import { isCommonPassword } from '@/lib/common-passwords'
import { sanitizeDisplayName } from '@/lib/sanitize'
import { parseJsonBody } from '@/lib/parse-json'

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const { allowed, retryAfter } = await checkRateLimit(ip, 'register', 20, 15 * 60 * 1000)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Intenta de nuevo más tarde.', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  try {
    const parsed = await parseJsonBody<{
      email?: unknown; password?: unknown; name?: unknown;
      phone?: unknown; cityId?: unknown; role?: unknown;
      acceptedTerms?: unknown; acceptedPrivacy?: unknown;
    }>(req)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { email, password, name, phone, cityId, role, acceptedTerms, acceptedPrivacy } = parsed.body
    if (typeof password !== 'string') {
      return NextResponse.json({ error: 'La contraseña es requerida' }, { status: 400 })
    }

    // ── Required: name + role + password + at least one of (email, phone)
    // sanitizeDisplayName strips zero-width + bidi controls, normalizes
    // Unicode to NFC, then trims + collapses internal whitespace (M5).
    const trimmedName = sanitizeDisplayName(name)
    if (!trimmedName) {
      return NextResponse.json({ error: 'El nombre es requerido' }, { status: 400 })
    }
    if (trimmedName.length < 2) {
      return NextResponse.json(
        { error: 'El nombre debe tener al menos 2 caracteres' },
        { status: 400 }
      )
    }
    if (trimmedName.length > 100) {
      return NextResponse.json(
        { error: 'El nombre es demasiado largo (máx 100 caracteres)' },
        { status: 400 }
      )
    }

    // Role must be explicit — silent default to 'buyer' would surprise sellers.
    // SPRINT admin (2026-07-27): 'admin' is NOT in this list on purpose. The
    // DB CHECK now allows it (migration 027), but self-registration must
    // never produce an admin. Promotions go through
    // scripts/dev/create-admin.js.
    if (role !== 'buyer' && role !== 'seller') {
      return NextResponse.json(
        { error: 'Selecciona un tipo de cuenta: vendedor o comprador' },
        { status: 400 }
      )
    }

    // ── Password strength: minimum 8 chars, no top-50 common passwords.
    // Bcrypt cost 13 (raised from 12 in 2026-07-27 audit) — ~500ms on
    // modern hardware, keeps 8-char passwords costly enough to resist
    // bulk brute-force at typical botnet scale.
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'La contraseña debe tener al menos 8 caracteres' },
        { status: 400 }
      )
    }
    if (password.length > 128) {
      return NextResponse.json(
        { error: 'La contraseña es demasiado larga (máx 128 caracteres)' },
        { status: 400 }
      )
    }
    if (isCommonPassword(password)) {
      return NextResponse.json(
        { error: 'Esta contraseña es muy común. Elige otra más segura.' },
        { status: 400 }
      )
    }

    // ── Email/phone validation: at least one must be present and valid.
    const rawEmail = typeof email === 'string' ? email.trim() : ''
    const rawPhone = typeof phone === 'string' ? phone.trim() : ''

    let cleanEmail: string | null = null
    let cleanPhone: string | null = null

    if (rawEmail) {
      cleanEmail = normalizeEmail(rawEmail)
      if (!cleanEmail) {
        return NextResponse.json(
          { error: 'El email no tiene un formato válido' },
          { status: 400 }
        )
      }
    }

    if (rawPhone) {
      cleanPhone = normalizePhone(rawPhone)
      if (!cleanPhone) {
        return NextResponse.json(
          { error: 'Ingresa un número de teléfono colombiano válido (10 dígitos)' },
          { status: 400 }
        )
      }
    }

    if (!cleanEmail && !cleanPhone) {
      return NextResponse.json(
        { error: 'Necesitas al menos un email o un teléfono para registrarte' },
        { status: 400 }
      )
    }

    // Tier 21: per-identifier throttle so an attacker can't burn through IP
    // rotations to spam-signup-create accounts using a known victim's email
    // or phone. Falls back to IP if neither identifier is valid (handled by
    // the check above — we always have at least one here).
    const identifierForThrottle = (cleanEmail || cleanPhone || '').trim().toLowerCase()
    if (identifierForThrottle) {
      const idLimit = await checkRateLimitByIdentifier(
        req,
        identifierForThrottle,
        'register_account',
        5,
        60 * 60 * 1000
      )
      if (!idLimit.allowed) {
        return NextResponse.json(
          { error: 'Demasiados intentos para esta cuenta. Intenta más tarde.', retryAfter: idLimit.retryAfter },
          { status: 429, headers: { 'Retry-After': String(idLimit.retryAfter) } }
        )
      }
    }

    // ── Ley 1581/2012 art. 9 — consent must be explicit and informed.
    if (!acceptedTerms || !acceptedPrivacy) {
      return NextResponse.json(
        { error: 'Debes aceptar los Términos y la Política de Tratamiento de Datos Personales' },
        { status: 400 }
      )
    }

    // Validate cityId if provided (cities are static config, not in DB)
    if (cityId) {
      const validCity = COLOMBIA_CITIES.some((c) => c.id === cityId)
      if (!validCity) {
        return NextResponse.json({ error: 'Ciudad inválida' }, { status: 400 })
      }
    }

    // ── Atomic insert — handles both duplicate-email AND duplicate-phone races.
    const passwordHash = await bcrypt.hash(password, 13)
    const roleValue = role

    // ── Seller requires a city for vendor auto-bootstrap ─────────────────
    if (roleValue === 'seller' && !cityId) {
      return NextResponse.json(
        { error: 'Selecciona una ciudad para tu perfil de vendedor' },
        { status: 400 }
      )
    }

    // Wrap users + profiles insert in a transaction so a profile failure
    // rolls back the user row.
    const client = await pool.connect()
    let user: { id: string; email: string; name: string; role: string; phone: string; city_id: string | null }
    try {
      await client.query('BEGIN')

      // New users start with email_verified=false (C1 — re-enabled 2026-07-27).
      // The verification email is sent AFTER the COMMIT (below) so a rollback
      // never leaves an orphaned token pointing at a non-existent user.
      const userResult = await client.query(
        `INSERT INTO users (email, password_hash, name, phone, city_id, role, email_verified)
         VALUES ($1, $2, $3, $4, $5, $6, false)
         ON CONFLICT DO NOTHING
         RETURNING id, email, name, role, phone, city_id, email_verified`,
        [cleanEmail as string | null, passwordHash, trimmedName, cleanPhone as string | null, cityId || null, roleValue]
      )

      if (userResult.rows.length === 0) {
        await client.query('ROLLBACK')
        // L8 (audit 2026-07-27): collapse to a SINGLE generic error so an
        // attacker can't enumerate which identifier is the duplicate. The
        // server still knows which one matched (logged below for ops),
        // but the wire response is identical regardless of whether the
        // email, the phone, or both already exist.
        let collidingField: 'email' | 'phone' | null = null
        if (cleanEmail) {
          const dup = await client.query('SELECT 1 FROM users WHERE email = $1 LIMIT 1', [cleanEmail])
          if (dup.rows.length > 0) collidingField = 'email'
        }
        if (!collidingField && cleanPhone) {
          const dup = await client.query('SELECT 1 FROM users WHERE phone = $1 LIMIT 1', [cleanPhone])
          if (dup.rows.length > 0) collidingField = 'phone'
        }
        if (collidingField) {
          // Internal observability: structured log on which field collided
          // (devs + SIEM can debug). The client-facing message is generic.
          logger.warn({ event: 'register_duplicate', field: collidingField, ip: getClientIp(req) },
            'register attempted with already-registered identifier')
          return NextResponse.json(
            { error: 'Ya existe una cuenta con estos datos. Si eres tú, intenta iniciar sesión.' },
            { status: 409 }
          )
        }
        return NextResponse.json({ error: 'No se pudo crear la cuenta. Verifica email y teléfono.' }, { status: 400 })
      }

      user = userResult.rows[0]

      const profileResult = await client.query(
        `INSERT INTO profiles (id, user_id, email, name, role, token_version)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 1)
         ON CONFLICT (user_id) DO UPDATE
           SET token_version = 1,
               email = EXCLUDED.email,
               name = EXCLUDED.name,
               role = EXCLUDED.role
         RETURNING id`,
        [user.id, user.email, user.name, roleValue]
      )
      const profileId: string = profileResult.rows[0].id

      // ── Seller auto-bootstrap — creates a placeholder vendor row in
      // the same transaction so the seller can complete their profile.
      //
      // FIELD-FIX (2026-07-27): lat/lng are seeded from the city center
      // (not NULL anymore). The buyer map's pin filter at
      // components/map/MapHelpers.tsx:149 drops any vendor whose
      // lat/lng aren't numbers — a NULL placeholder was therefore
      // never visible on /map, even after the seller toggled
      // is_active=true. Seeding the city center means the vendor
      // appears at a sensible position immediately; the seller can
      // drag the pin to their actual spot via /dashboard or via the
      // onboarding GPS step (apps/web/app/(auth)/onboarding).
      if (roleValue === 'seller') {
        const firstName = trimmedName.split(' ')[0] || trimmedName || 'vendedor'
        const placeholderName = `Mi negocio de ${firstName}`
        const slug = await generateUniqueSlug(client, placeholderName, (typeof cityId === 'string' ? cityId : null))
        const cityCenter = (typeof cityId === 'string')
          ? COLOMBIA_CITIES.find((c) => c.id === cityId)?.center
          : undefined
        const seedLat = cityCenter ? cityCenter[0] : null
        const seedLng = cityCenter ? cityCenter[1] : null
        await client.query(
          `INSERT INTO vendors (
            profile_id, name, slug, category, description,
            city_id, latitude, longitude, station_type,
            phone, is_active, is_verified, created_at
          )
          VALUES ($1, $2, $3, 'comida', '', $4, $5, $6, 'mobile', $7, false, false, NOW())
          ON CONFLICT DO NOTHING`,
          [profileId, placeholderName, slug, cityId || null, seedLat, seedLng, cleanPhone || null]
        )
      }

      // ── Ley 1581/2012 — record the consent inside the same tx
      const policyVersion = process.env.POLICY_VERSION || 'v1.0'
      const safeIp = (ip && ip !== 'unknown') ? ip : null
      await client.query(
        `INSERT INTO consent_logs
          (user_id, consent_type, policy_version, granted, ip_address, user_agent)
         VALUES ($1, 'terms', $2, true, $3, $4),
                ($1, 'privacy', $2, true, $3, $4)`,
        [user.id, policyVersion, safeIp, req.headers.get('user-agent')]
      )

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }

    // ── Email verification (re-enabled 2026-07-27 audit C1).
    // Best-effort: a failed send must not block the registration. The user
    // can re-trigger via the EmailVerifyBanner's "Reenviar email" link,
    // which calls /api/auth/resend-verification. The token is a 32-byte
    // random base64url stored as SHA-256 in email_verification_tokens.
    if (user.email) {
      try {
        const v = issueEmailVerificationToken(user.id)
        await pool.query(
          `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, $3)`,
          [user.id, v.tokenHash, v.expiresAt]
        )
        const result = await sendVerificationEmail({
          to: user.email, name: user.name, token: v.token,
        })
        if (!result.ok) logger.error({ userId: user.id, error: result.error }, '[register] Verification email send failed:')
      } catch (emailErr) {
        logger.error(serializeErr(emailErr), '[register] Verification email error (non-fatal):')
      }
    }

    const tokenPayload = { userId: user.id, email: user.email, role: roleValue as 'buyer' | 'seller', tokenVersion: 1 }
    const token = signTokenSync(tokenPayload, '15m')
    const refreshToken = signTokenSync(tokenPayload, '7d')

    // Token is set via httpOnly cookies only — never echo it in the body
    const response = NextResponse.json({
      // Re-enabled 2026-07-27 — new users must verify their email before
      // they can create vendors, leave reviews, or contact sellers.
      emailVerified: false,
      requiresEmailVerification: true,
      user: {
        id: user.id,
        email: user.email || '',
        fullName: user.name,
        phone: user.phone || '',
        cityId: user.city_id,
        role: user.role,
        avatarUrl: '',
        emailVerified: false,
      },
    }, {
      // Auth responses must not be cached by browsers, CDNs, or proxies —
      // any cached response with a Set-Cookie header can be replayed.
      headers: { 'Cache-Control': 'no-store' },
    })

    const isProd = process.env.NODE_ENV === 'production'
    response.cookies.set('token', token, {
      httpOnly: true,
      // L1 (audit 2026-07-27): scope to /api/auth.
      path: AUTH_COOKIE_PATH,
      maxAge: 60 * 15,
      sameSite: 'strict',
      secure: isProd,
    })
    response.cookies.set('refresh-token', refreshToken, {
      httpOnly: true,
      path: AUTH_COOKIE_PATH,
      maxAge: 60 * 60 * 24 * 7,
      sameSite: 'strict',
      secure: isProd,
    })

    return response
  } catch (err) {
    logger.error(serializeErr(err), 'Register error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
