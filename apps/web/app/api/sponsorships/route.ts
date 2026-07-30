import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import pool from '@/lib/db'
import { requireAuth, requireVerifiedEmail } from '@/lib/auth'
import { requireSameOrigin } from '@/lib/csrf'
import { checkRateLimitByUser } from '@/lib/rate-limit'

/**
 * GET  /api/sponsorships          — list current user's sponsorships
 * POST /api/sponsorships          — create a sponsorship (plan + duration)
 *
 * Plans:
 *   semanal   — 7 days   — COP $20.000
 *   mensual   — 30 days  — COP $60.000
 *
 * Payment flow:
 *   1. Client POSTs here → row created with status='pending_payment'.
 *   2. We (would) hand back a Wompi checkout URL + reference.
 *   3. Wompi webhook (NOT IMPLEMENTED — see lib/payments/WOMPI_INTEGRATION.md)
 *      flips status to 'active' on confirmed payment.
 *
 * Beta mode (ENABLE_BETA_SPONSORSHIPS=true):
 *   Skips the payment step and inserts with status='active'. This is the
 *   documented dev/test shortcut; it does NOT bypass the no-stack check.
 *   In production leave the env var unset — POSTs will create
 *   pending_payment rows that will never resolve. Until Wompi is wired,
 *   surface that clearly to users (see 503 response below).
 */

const PRICING = {
  semanal:  { days: 7,  amount_cents: 20_000_00 }, // COP 20.000 (stored in cents)
  mensual:  { days: 30, amount_cents: 60_000_00 },
}

async function getMyVendorId(req: NextRequest) {
  // P1-1 (audit 2026-07-27): sponsorships are a paid flow, gate on
  // verified email. The dashboard banner promise is enforced uniformly
  // via requireVerifiedEmail.
  const auth = await requireVerifiedEmail(req)
  if (auth instanceof NextResponse) return auth

  const r = await pool.query(
    'SELECT v.id FROM vendors v JOIN profiles p ON p.id = v.profile_id WHERE p.user_id = $1',
    [auth.userId]
  )
  if (r.rows.length === 0) return NextResponse.json({ error: 'No tienes un perfil de vendedor' }, { status: 403 })
  return { vendorId: r.rows[0].id as string }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getMyVendorId(req)
    if (auth instanceof NextResponse) return auth

    const result = await pool.query(
      `SELECT id, plan, amount_cents, starts_at, ends_at, status, created_at
       FROM sponsorships
       WHERE vendor_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [auth.vendorId]
    )

    const sponsorships = result.rows.map((s) => ({
      id: s.id,
      plan: s.plan,
      amountCents: Number(s.amount_cents),
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      status: s.status,
      active: s.status === 'active' && new Date(s.ends_at) > new Date(),
      createdAt: s.created_at,
    }))

    return NextResponse.json({ sponsorships })
  } catch (err) {
    logger.error(serializeErr(err), 'Sponsorships GET error:')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  // Per-user rate limit on sponsorship creation. 3/min — payments are expensive
  // and bot-driven sponsorship creation could trigger real Wompi charges.
  const rl = await checkRateLimitByUser(req, 'create_sponsorship', 3, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes. Intenta más tarde.', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }
  // CRIT-23: prod guard. Sponsorships are a paid flow that should NOT be
  // callable from preview/staging deployments where the same Stripe / payment
  // gateway credentials would otherwise create real charges. The check uses
  // VERCEL_ENV (set on Vercel previews) plus an explicit ALLOW_TEST_Sponsorships
  // override for the local dev environment.
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.ALLOW_TEST_SPONSORSHIPS !== 'true' &&
    process.env.VERCEL_ENV === 'preview'
  ) {
    return NextResponse.json(
      { error: 'Sponsorships no disponibles en este entorno' },
      { status: 404 }
    )
  }

  const auth = await getMyVendorId(req)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const plan = body.plan as 'semanal' | 'mensual' | undefined

  if (!plan || !(plan in PRICING)) {
    return NextResponse.json(
      { error: 'plan must be one of: semanal, mensual' },
      { status: 400 }
    )
  }

  const config = PRICING[plan]

  // Don't allow stacking — if there's an active sponsorship, reject.
  // (We could allow renewals that extend the window; deferred for v2.)
  // Wrap in a transaction with the INSERT below to prevent races where two
  // simultaneous POSTs both pass the check and create two active sponsorships.
  const client = await pool.connect()
  let insertedRow: unknown = null
  try {
    await client.query('BEGIN')

    const activeResult = await client.query(
      `SELECT id, ends_at FROM sponsorships
       WHERE vendor_id = $1 AND status = 'active' AND ends_at > NOW()
       LIMIT 1
       FOR UPDATE`,
      [auth.vendorId]
    )

    if (activeResult.rows.length > 0) {
      await client.query('ROLLBACK')
      return NextResponse.json(
        {
          error: 'Ya tienes una sponsorship activa',
          activeUntil: activeResult.rows[0].ends_at,
        },
        { status: 409 }
      )
    }

    // Payment gate.
    //
    // Production: rows are created with status='pending_payment' and never get
    // promoted in this endpoint. The Wompi webhook (or admin tooling) is the
    // only path that can flip to 'active'. Until Wompi is wired, every call
    // gets a 503 so users get an honest "payments not wired" message and we
    // don't accidentally ship free sponsorships.
    //
    // Beta: ENABLE_BETA_SPONSORSHIPS=true in .env skips the payment step and
    // inserts directly with status='active'. Use this for manual onboarding
    // until the Wompi integration lands. The no-stack guard above still runs.
    const isBeta = process.env.ENABLE_BETA_SPONSORSHIPS === 'true'

    if (!isBeta) {
      await client.query('ROLLBACK')
      return NextResponse.json(
        {
          error:
            'Pagos aún no disponibles. Estamos integrando Wompi (PSE/Nequi). ' +
            'Si quieres patrocinar tu tienda en beta, contacta a soporte.',
        },
        { status: 503 }
      )
    }

    const insertResult = await client.query(
      `INSERT INTO sponsorships (vendor_id, plan, amount_cents, ends_at, status)
       VALUES ($1, $2, $3, NOW() + ($4 || ' days')::INTERVAL, 'active')
       RETURNING id, plan, amount_cents, starts_at, ends_at, status`,
      [auth.vendorId, plan, config.amount_cents, config.days]
    )
    insertedRow = insertResult.rows[0] // beta path: status='active'

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  if (!insertedRow) {
    // Should be unreachable — but keeps TS happy and the contract explicit.
    return NextResponse.json({ error: 'No se pudo crear la sponsorship' }, { status: 500 })
  }

  // pg returns rows as untyped objects; narrow to a known shape before
  // surfacing in the JSON response. `as unknown as ...` is the only safe
  // way given pg's `any[]` row default — see lib/db.ts for the typed
  // alternative if we ever swap drivers.
  const row = insertedRow as {
    id: string
    plan: string
    amount_cents: number
    starts_at: string
    ends_at: string
    status: string
  }
  return NextResponse.json({
    sponsorship: {
      id: row.id,
      plan: row.plan,
      amountCents: Number(row.amount_cents),
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
    },
  })
}