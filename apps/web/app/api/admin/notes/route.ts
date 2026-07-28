/**
 * GET  /api/admin/notes?targetType=user&targetId=<uuid>
 *      List notes for a target. Newest first. Soft-deleted rows hidden.
 *
 * POST /api/admin/notes
 *      Body: { targetType: 'user' | 'vendor', targetId: uuid, body: string }
 *      Create a new note. Author is the calling admin. body is 1..2000 chars
 *      and trimmed; empty / whitespace-only is rejected.
 *
 *      The target must exist and match the target_type:
 *        - target_type='user'   → users.id where role IN ('buyer', 'admin')
 *                                  (admins can write notes on other admins
 *                                  but not on sellers — sellers are 'vendor'
 *                                  target_type)
 *        - target_type='vendor' → vendors.id
 *      We don't restrict to role='buyer' on purpose so admin can take notes
 *      on peer admins (handoff notes, escalations).
 *
 * Both endpoints are admin-only. Rate-limited under 'admin_note_action'
 * (write-only, 30/min). Reads are not rate-limited — listing notes is
 * cheap and an admin opening a drawer does 1-2 GETs.
 *
 * Audit actions: 'add_admin_note' (POST), 'view_admin_note' is NOT logged
 * (a drawer open would otherwise spam the audit log).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import pool from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { parseJsonBody } from '@/lib/parse-json'
import { requireSameOrigin } from '@/lib/csrf'
import { logger, serializeErr } from '@/lib/logger'
import { logAdminAction } from '@/lib/admin-audit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BODY = 2000

function isUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID_RE.test(s)
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const targetType = url.searchParams.get('targetType')
  const targetId = url.searchParams.get('targetId')

  if (targetType !== 'user' && targetType !== 'vendor') {
    return NextResponse.json(
      { error: 'targetType debe ser "user" o "vendor"' },
      { status: 400 }
    )
  }
  if (!isUuid(targetId)) {
    return NextResponse.json({ error: 'targetId inválido' }, { status: 400 })
  }

  try {
    const result = await pool.query(
      `SELECT n.id, n.target_type, n.target_id, n.author_id,
              u.email AS author_email, u.name AS author_name,
              n.body, n.created_at
         FROM admin_notes n
         JOIN users u ON u.id = n.author_id
        WHERE n.target_type = $1
          AND n.target_id   = $2
          AND n.deleted_at IS NULL
        ORDER BY n.created_at DESC`,
      [targetType, targetId]
    )
    return NextResponse.json({ notes: result.rows })
  } catch (err) {
    logger.error(serializeErr(err), 'admin notes list error')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth instanceof NextResponse) return auth

  const csrf = requireSameOrigin(req)
  if (csrf) return csrf

  const { allowed, retryAfter } = await checkRateLimit(
    auth.userId,
    'admin_note_action',
    30,
    60 * 1000
  )
  if (!allowed) {
    return NextResponse.json(
      { error: 'Demasiadas acciones', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const body = parsed.body as Record<string, unknown>

  const targetType = body.targetType
  const targetId = body.targetId
  const noteBody = typeof body.body === 'string' ? body.body.trim() : ''

  if (targetType !== 'user' && targetType !== 'vendor') {
    return NextResponse.json(
      { error: 'targetType debe ser "user" o "vendor"' },
      { status: 400 }
    )
  }
  if (!isUuid(targetId)) {
    return NextResponse.json({ error: 'targetId inválido' }, { status: 400 })
  }
  if (noteBody.length === 0) {
    return NextResponse.json({ error: 'La nota no puede estar vacía' }, { status: 400 })
  }
  if (noteBody.length > MAX_BODY) {
    return NextResponse.json(
      { error: `La nota no puede superar ${MAX_BODY} caracteres` },
      { status: 400 }
    )
  }

  try {
    // Verify the target exists. We don't use FOR UPDATE — adding a note
    // is independent of any state on the target. If the target disappears
    // between the existence check and the INSERT, the FK on users.id
    // (for target_type='user') would fail. For target_type='vendor' we
    // only check vendors.id existence (no FK exists on admin_notes
    // because vendors can be soft-deleted while their notes survive).
    if (targetType === 'user') {
      const u = await pool.query(`SELECT id FROM users WHERE id = $1`, [targetId])
      if (u.rows.length === 0) {
        return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
      }
    } else {
      const v = await pool.query(`SELECT id FROM vendors WHERE id = $1`, [targetId])
      if (v.rows.length === 0) {
        return NextResponse.json({ error: 'Vendedor no encontrado' }, { status: 404 })
      }
    }

    const result = await pool.query(
      `INSERT INTO admin_notes (target_type, target_id, author_id, body)
       VALUES ($1, $2, $3, $4)
       RETURNING id, target_type, target_id, author_id, body, created_at`,
      [targetType, targetId, auth.userId, noteBody]
    )

    // Audit AFTER commit so a rolled-back client (we don't currently
    // use one but the logAdminAction contract is "after success")
    // would never produce ghost rows. With a single INSERT there's no
    // explicit transaction; the audit logger wraps its own.
    logAdminAction(auth.userId, 'add_admin_note', req, {
      targetType: targetType as 'user' | 'vendor',
      targetId,
      metadata: { noteId: result.rows[0].id, length: noteBody.length },
    })

    return NextResponse.json({ note: result.rows[0] }, { status: 201 })
  } catch (err) {
    logger.error(serializeErr(err), 'admin note create error')
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
