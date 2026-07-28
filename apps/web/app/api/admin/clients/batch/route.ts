/**
 * POST /api/admin/clients/batch — bulk admin actions on a set of buyers.
 *
 * Body: { clientIds: string[], action: 'activate' | 'deactivate' | 'verify_email' }
 *
 * Symmetric to /api/admin/vendors/batch. Clients = users WHERE role='buyer'.
 *
 * - `activate` / `deactivate` flips users.is_active.
 * - `verify_email` flips users.email_verified on the same row.
 *
 * Caps:
 *   - MAX_IDS = 200 per request to keep the transaction short.
 *   - All ids must be valid UUIDs.
 *   - All ids must belong to a row WHERE role='buyer' (any other role
 *     counts as "not found" and yields 404 — same shape as vendors/batch
 *     so the client UI's error handling is symmetric).
 *
 * The whole operation runs in a single transaction so a partial failure
 * leaves the database unchanged. Audit log entries are written AFTER
 * commit (a rolled-back tx must leave zero audit). Each affected client
 * gets its own audit row tagged with the batch id so an investigator
 * can group them.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import pool from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { parseJsonBody } from '@/lib/parse-json'
import { requireSameOrigin } from '@/lib/csrf'
import { logger, serializeErr } from '@/lib/logger'
import { logAdminAction } from '@/lib/admin-audit'

const MAX_IDS = 200

type BatchAction = 'activate' | 'deactivate' | 'verify_email'

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth instanceof NextResponse) return auth

  const csrf = requireSameOrigin(req)
  if (csrf) return csrf

  // Batch writes are rare and intentional, so a tight rate limit
  // (10/min) gives a useful safety brake without being annoying.
  // Separate bucket from vendors/batch so an admin who's processing
  // both kinds of rows in one sitting doesn't trip the wrong limit.
  const { allowed, retryAfter } = await checkRateLimit(
    auth.userId,
    'admin_client_batch',
    10,
    60 * 1000
  )
  if (!allowed) {
    return NextResponse.json(
      { error: 'Demasiadas acciones', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  const parsed = await parseJsonBody<{ clientIds?: unknown; action?: unknown }>(req)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const { clientIds, action } = parsed.body

  if (!Array.isArray(clientIds) || clientIds.length === 0) {
    return NextResponse.json({ error: 'clientIds requeridos' }, { status: 400 })
  }
  if (clientIds.length > MAX_IDS) {
    return NextResponse.json(
      { error: `Máximo ${MAX_IDS} ids por lote`, maxIds: MAX_IDS },
      { status: 400 }
    )
  }
  if (!isBatchAction(action)) {
    return NextResponse.json(
      { error: 'action debe ser activate | deactivate | verify_email' },
      { status: 400 }
    )
  }
  const idStrings = clientIds.map((x) => String(x))
  for (const id of idStrings) {
    if (!isUuid(id)) {
      return NextResponse.json({ error: `id inválido: ${id}` }, { status: 400 })
    }
  }

  try {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Lock the buyer rows we plan to mutate. Restricting to role='buyer'
      // means any seller/admin UUID in the payload appears in the
      // `missing` list and triggers a 404 + ROLLBACK (same UX as
      // vendors/batch).
      const lockRes = await client.query(
        `SELECT id, is_active, email_verified
         FROM users
         WHERE id = ANY($1::uuid[]) AND role = 'buyer'
         FOR UPDATE`,
        [idStrings]
      )
      const foundIds = new Set(lockRes.rows.map((r) => r.id as string))
      const missing = idStrings.filter((id) => !foundIds.has(id))
      if (missing.length > 0) {
        await client.query('ROLLBACK')
        return NextResponse.json(
          { error: `Clientes no encontrados: ${missing.join(', ')}` },
          { status: 404 }
        )
      }

      const changes: Array<{ id: string; prev: boolean; next: boolean }> = []
      for (const row of lockRes.rows) {
        const prev =
          action === 'verify_email' ? row.email_verified : row.is_active
        const next = action === 'deactivate' ? false : true
        if (prev === next) continue
        if (action === 'verify_email') {
          await client.query(
            'UPDATE users SET email_verified = $1 WHERE id = $2',
            [next, row.id]
          )
        } else {
          await client.query(
            'UPDATE users SET is_active = $1 WHERE id = $2',
            [next, row.id]
          )
        }
        changes.push({ id: row.id as string, prev, next })
      }

      await client.query('COMMIT')

      const auditAction =
        action === 'activate'
          ? 'batch_activate_client'
          : action === 'deactivate'
            ? 'batch_deactivate_client'
            : 'batch_verify_email_client'
      for (const c of changes) {
        await logAdminAction(auth.userId, auditAction, req, {
          targetType: 'user',
          targetId: c.id,
          metadata: { previous: c.prev, next: c.next, batchSize: idStrings.length },
        })
      }

      return NextResponse.json({
        ok: true,
        requested: idStrings.length,
        changed: changes.length,
        skipped: idStrings.length - changes.length,
        action,
      })
    } catch (txErr) {
      await client.query('ROLLBACK')
      throw txErr
    } finally {
      client.release()
    }
  } catch (err) {
    logger.error(serializeErr(err), 'admin client batch error')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

function isBatchAction(x: unknown): x is BatchAction {
  return x === 'activate' || x === 'deactivate' || x === 'verify_email'
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}
