import crypto from 'node:crypto'

/**
 * Hash an identifier (email or phone) for use in audit logs.
 *
 * L5 (audit 2026-07-27): login failure paths emit `identifierHash`
 * instead of the raw email/phone so that:
 *
 *   - SIEM/observability tools can correlate probes against the same
 *     account across IPs (the hash is stable per identifier).
 *   - A log reader (engineer with DB access, a leaked log dump) cannot
 *     pivot back to the real email/phone and start credential stuffing
 *     from a different angle.
 *
 * Use a fast HMAC-SHA256 keyed with the JWT secret. We DON'T need slow
 * bcrypt — this is purely an observability hash, not a credential hash.
 * The HMAC key also ensures an attacker who reads the logs but doesn't
 * have the JWT secret can't brute-force the original identifier.
 */
export function hashForAudit(identifier: string): string {
  const key = process.env.JWT_SECRET
  if (!key) {
    // Fall back to a fast hash (not HMAC). Still avoids leaking clear
    // identifiers, but allows an attacker with logs to brute force via
    // dictionary — only used in dev where JWT_SECRET may be unset.
    return crypto.createHash('sha256').update(identifier).digest('hex').slice(0, 32)
  }
  return crypto.createHmac('sha256', key).update(identifier.toLowerCase().trim()).digest('hex').slice(0, 32)
}
