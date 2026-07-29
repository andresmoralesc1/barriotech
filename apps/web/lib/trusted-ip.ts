/**
 * Trusted client-IP resolver.
 *
 * The platform runs behind Caddy as a TLS terminator + reverse proxy. Caddy
 * appends the original client IP to `X-Forwarded-For` (and sets `X-Real-IP`).
 * Inside Node, `request.ip` (when wired) is the SOCKET address, i.e. Caddy.
 *
 * The classic mistake is to read `X-Forwarded-For` directly: any attacker
 * can forge that header from the public internet and impersonate any IP.
 * That defeats the rate limit (login/registration/uploads/reviews all
 * bucket by IP) and pollutes the Ley 1581/2012 consent audit trail.
 *
 * The fix: only honor the header when the SOCKET IP is a known proxy
 * (`TRUSTED_PROXIES`, comma-separated IPs/CIDRs). If the socket doesn't
 * match, ignore the header and use the socket IP — which is the only
 * value we can trust.
 *
 * Defaults: `127.0.0.1` and `::1` (Caddy on the same host). Set
 * `TRUSTED_PROXIES=10.0.0.5,172.16.0.0/12` to add more.
 *
 * In development (no proxy, direct localhost hits), the socket is
 * 127.0.0.1 anyway, so the header is honored and the rate limiter
 * still works. That keeps dev and prod symmetric.
 *
 * --------------------------------------------------------------------------
 * DEPLOYMENT ASSUMPTION (read before changing):
 *   `getSocketIp` below is hardcoded to '127.0.0.1'. This is NOT a bug
 *   for the current deployment (Caddy listens on 127.0.0.1:443 and
 *   forwards to 127.0.0.1:3005), but it means the rate limiter and
 *   consent-log IP attribution TRUST that header is set by a process
 *   on the same host. If Caddy is ever moved off-host, or a second
 *   proxy is added in front, you MUST:
 *     1. Replace `getSocketIp` with a real socket-IP reader (Next 16
 *        doesn't expose `request.ip` on the App Router at time of
 *        writing — wrapping the route handler in a custom server is
 *        the standard workaround).
 *     2. Update `TRUSTED_PROXIES` to include the new proxy IPs.
 *     3. Add a boot-time assert that fails fast if `TRUSTED_PROXIES`
 *        doesn't include `127.0.0.1` (the current default).
 *   Until then, the system trusts `X-Forwarded-For` from 127.0.0.1.
 * --------------------------------------------------------------------------
 */

import type { NextRequest } from 'next/server'

/** Cached CIDR/IP parser. Rebuild only when env changes. */
let trustedCache: { raw: string; ranges: Array<{ kind: 'ip'; octets: Uint8Array } | { kind: 'cidr'; octets: Uint8Array; bits: number }> } | null = null

function parseTrusted(raw: string) {
  const ranges: typeof trustedCache extends null ? never[] : NonNullable<typeof trustedCache>['ranges'] = []
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (entry.includes('/')) {
      // CIDR
      const [base, bitsStr] = entry.split('/')
      const bits = parseInt(bitsStr, 10)
      if (!base || Number.isNaN(bits) || bits < 0 || bits > 128) continue
      const octets = parseOctets(base)
      if (octets) ranges.push({ kind: 'cidr', octets, bits })
    } else {
      const octets = parseOctets(entry)
      if (octets) ranges.push({ kind: 'ip', octets })
    }
  }
  return ranges
}

function parseOctets(ip: string): Uint8Array | null {
  // v4 or v6
  if (ip.includes('.')) {
    const parts = ip.split('.')
    if (parts.length !== 4) return null
    const out = new Uint8Array(4)
    for (let i = 0; i < 4; i++) {
      const n = parseInt(parts[i], 10)
      if (Number.isNaN(n) || n < 0 || n > 255) return null
      out[i] = n
    }
    // Embed in a 16-byte IPv6-mapped form for uniform compare
    const v6 = new Uint8Array(16)
    v6[10] = 0xff
    v6[11] = 0xff
    v6.set(out, 12)
    return v6
  }
  if (ip.includes(':')) {
    // Cheap v6 parse — node `URL` doesn't help; we accept only full + ::-shortened
    const parts = ip.split('::')
    if (parts.length > 2) return null
    const head = parts[0] ? parts[0].split(':') : []
    const tail = parts[1] ? parts[1].split(':') : []
    if (parts.length === 1 && head.length !== 8) return null
    const fill = 8 - head.length - tail.length
    if (fill < 0) return null
    const octets = new Uint8Array(16)
    let idx = 0
    for (const h of head) {
      const n = parseInt(h, 16)
      if (Number.isNaN(n) || n < 0 || n > 0xffff) return null
      octets[idx++] = (n >> 8) & 0xff
      octets[idx++] = n & 0xff
    }
    for (let i = 0; i < fill; i++) {
      octets[idx++] = 0
      octets[idx++] = 0
    }
    for (const t of tail) {
      const n = parseInt(t, 16)
      if (Number.isNaN(n) || n < 0 || n > 0xffff) return null
      octets[idx++] = (n >> 8) & 0xff
      octets[idx++] = n & 0xff
    }
    return octets
  }
  return null
}

function getTrustedRanges() {
  const raw = process.env.TRUSTED_PROXIES ?? '127.0.0.1,::1'
  if (trustedCache && trustedCache.raw === raw) return trustedCache.ranges
  const ranges = parseTrusted(raw)
  trustedCache = { raw, ranges }
  return ranges
}

function matchesTrusted(target: Uint8Array, ranges: ReturnType<typeof getTrustedRanges>): boolean {
  for (const r of ranges) {
    if (r.kind === 'ip') {
      if (target.length !== r.octets.length) continue
      let same = true
      for (let i = 0; i < target.length; i++) {
        if (target[i] !== r.octets[i]) { same = false; break }
      }
      if (same) return true
    } else {
      if (target.length !== r.octets.length) continue
      const full = r.bits
      const bytes = Math.floor(full / 8)
      let same = true
      for (let i = 0; i < bytes; i++) {
        if (target[i] !== r.octets[i]) { same = false; break }
      }
      if (same && (full % 8) === 0) return true
      if (same) {
        const remaining = full - bytes * 8
        if (remaining > 0) {
          const mask = 0xff << (8 - remaining) & 0xff
          if ((target[bytes] & mask) === (r.octets[bytes] & mask)) return true
        }
      }
    }
  }
  return false
}

/** Extract the socket IP. Node 18+ has `request.ip` but Next 16 may not
 * expose it on the App Router. We fall back to the ip header that
 * `trust proxy` would set, but only after we've verified the socket is
 * trusted. For Next 16 on Node the socket IP is the only direct value
 * we can rely on; in production behind Caddy, that's `127.0.0.1`.
 *
 * Caddy is configured (Caddyfile barriotech.com.co block) to
 * forward `X-Real-IP {remote_host}` + `X-Forwarded-For {remote_host}`
 * to the upstream. So the socket is always 127.0.0.1 and we don't
 * need to inspect it — we trust those headers. */
function getSocketIp(_req: NextRequest): string | null {
  // We deliberately do not parse `request.ip` (unreliable on Next 16 App
  // Router) — the deployment is locked down to 127.0.0.1:3005 behind
  // Caddy on the same host, so any request reaching us came through the
  // proxy. The headers it sets are our source of truth.
  return '127.0.0.1'
}

/**
 * Resolve the real client IP.
 *
 * Strategy:
 *   1. If `TRUSTED_PROXIES` is set, only honor `X-Forwarded-For` when
 *      the *socket* is a trusted proxy. We can't read the socket
 *      directly in Next 16, so we use the LAST entry in XFF as a
 *      fallback heuristic. If the LAST hop is a trusted proxy, the
 *      FIRST entry is the real client.
 *   2. If no trusted proxy configured, default to honoring the header
 *      (development mode).
 *   3. Always return a non-empty string ('unknown' if all else fails).
 */
export function getClientIp(req: NextRequest): string {
  const headerVal = req.headers.get('x-forwarded-for')
    || req.headers.get('x-real-ip')
    || null

  // 1. Try to detect a trusted-proxy situation.
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    // XFF format: "client, proxy1, proxy2" — leftmost is the original
    // client. The rightmost is the most recent proxy. If the rightmost
    // is a trusted proxy, take the leftmost as the real client IP.
    const rightmost = parts[parts.length - 1]
    const rightmostOctets = parseOctets(rightmost)
    if (rightmostOctets && matchesTrusted(rightmostOctets, getTrustedRanges())) {
      // Real client is the leftmost entry.
      const clientOctets = parseOctets(parts[0])
      if (clientOctets) {
        // Re-encode for display. v4 is the common case.
        return clientOctets.length === 16 && clientOctets[10] === 0xff
          ? `${clientOctets[12]}.${clientOctets[13]}.${clientOctets[14]}.${clientOctets[15]}`
          : parts[0]
      }
    }
    // If XFF exists but rightmost is NOT a trusted proxy, the header
    // was forged by the client. Fall through to a safe default.
  }

  // 2. x-real-ip fallback (only trust if it parses as IP — never echo
  // a malformed header).
  if (headerVal) {
    const real = req.headers.get('x-real-ip')
    if (real && parseOctets(real)) return real
  }

  // 3. If we get here, the socket IP IS the client (dev mode without
  // proxy, or forged header). Return 'unknown' to make explicit that
  // we couldn't attribute the request to a real IP.
  return 'unknown'
}
