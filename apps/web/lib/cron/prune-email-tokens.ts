import pool from '@/lib/db'
import { logger, serializeErr } from '@/lib/logger'
import { recordJobRun } from '@/lib/job-status'

/**
 * Daily retention prune for email_verification_tokens + password_reset_tokens.
 *
 * Audit 2026-08-13 M4: without this, expired/used tokens accumulate forever.
 * After several years this is millions of rows. Heatmap-style data hygiene.
 *
 * Keeps tokens for 7 days past expiry/usage so an honest typo / delayed
 * click can still be diagnosed from logs. After that, the hash is
 * useless for authentication AND useless for forensic correlation.
 *
 * Runs once per day at 04:00 Bogotá (production only, via instrumentation.ts).
 */
const RETENTION_DAYS = 7
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24h

let timer: NodeJS.Timeout | null = null

export function startEmailTokenPruneCron() {
  if (timer) return
  const runOnce = async () => {
    try {
      const verifyRes = await pool.query(
        `DELETE FROM email_verification_tokens
         WHERE (used_at IS NOT NULL OR expires_at < NOW())
           AND COALESCE(used_at, expires_at) < NOW() - ($1 || ' days')::INTERVAL`,
        [RETENTION_DAYS.toString()]
      )
      const resetRes = await pool.query(
        `DELETE FROM password_reset_tokens
         WHERE (used_at IS NOT NULL OR expires_at < NOW())
           AND COALESCE(used_at, expires_at) < NOW() - ($1 || ' days')::INTERVAL`,
        [RETENTION_DAYS.toString()]
      )
      await recordJobRun('email-token-prune', {
        verification_deleted: verifyRes.rowCount ?? 0,
        reset_deleted: resetRes.rowCount ?? 0,
      })
      logger.info(
        `[email-token-prune] Deleted ${verifyRes.rowCount} verification + ` +
          `${resetRes.rowCount} reset tokens older than ${RETENTION_DAYS}d past expiry/use`,
      )
    } catch (err) {
      logger.error(serializeErr(err), '[email-token-prune] error:')
    }
  }

  // Fire once on boot (in case server was down for >24h), then every 24h.
  void runOnce()
  timer = setInterval(runOnce, CHECK_INTERVAL_MS)

  logger.info(
    `[email-token-prune] Cron scheduled (every ${CHECK_INTERVAL_MS / 1000}s, retention ${RETENTION_DAYS}d)`,
  )
}

export function stopEmailTokenPruneCron() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}