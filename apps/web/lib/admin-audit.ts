/**
 * Admin audit logger — writes to admin_audit_log with the acting admin's
 * id, the action name, the optional target (e.g. vendor UUID), and a
 * free-form JSON metadata blob for context.
 *
 * Best-effort: a failure to write the audit row logs to console but
 * doesn't fail the calling request. The user-facing action already
 * succeeded; the audit is observability, not correctness.
 */

import pool from './db'
import { logger, serializeErr } from './logger'
import { getClientIp } from './trusted-ip'

export type AdminAction =
  | 'view_vendor_list'
  | 'view_vendor_detail'
  | 'view_client_list'
  | 'activate_vendor'
  | 'deactivate_vendor'
  | 'override_email_verification'

export async function logAdminAction(
  adminId: string,
  action: AdminAction,
  req: { headers: Headers },
  opts?: {
    targetType?: 'user' | 'vendor'
    targetId?: string
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  try {
    const ip = getClientIp(req as any)
    await pool.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, metadata, ip)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        adminId,
        action,
        opts?.targetType ?? null,
        opts?.targetId ?? null,
        opts?.metadata ? JSON.stringify(opts.metadata) : null,
        ip,
      ]
    )
  } catch (err) {
    // Audit failure must never break the caller — log and continue.
    logger.error(serializeErr(err), 'admin audit log failure')
  }
}
