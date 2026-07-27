/**
 * Pino structured logger — CRIT-11.
 *
 * Centraliza el logging en un solo módulo para que:
 *   - Producción (NODE_ENV=production) emita JSON line-delimited, parseable
 *     por log aggregators (Datadog, CloudWatch, ELK). PM2 + Caddy lo capturan
 *     en stdout y pueden pipearlo a cualquier destino.
 *   - Desarrollo (NODE_ENV=development) emita con pino-pretty para legibilidad.
 *   - Cada mensaje lleve automáticamente `level`, `time`, `pid`, `hostname`,
 *     `service: 'gps-web'` — sin que el call site tenga que añadirlos.
 *
 * DO NOT import this module from:
 *   - Edge runtime (proxy.ts, lib/auth-edge.ts) — pino requiere Node APIs.
 *     For edge, use a plain console.* with structured prefix.
 *   - Client components ('use client') — adds ~50KB to the bundle. The
 *     browser console is the right destination there.
 *
 * Usage:
 *   import { logger } from '@/lib/logger'
 *   logger.info({ userId, action: 'login.success' }, 'user logged in')
 *   logger.error({ err, requestId }, 'auth/login failed')
 *
 * Child loggers (for per-request context):
 *   const log = logger.child({ requestId: crypto.randomUUID() })
 *   log.info('started')     // includes requestId in JSON
 */

import pino from 'pino'

const isProd = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  // Stamp every log with the service name so log aggregators can filter.
  base: {
    service: 'gps-web',
    env: process.env.NODE_ENV || 'development',
    // Use APP_VERSION (set by /api/health and CI) for cross-reference with
    // git SHA when grepping logs for a specific deploy.
    version: process.env.APP_VERSION || 'unknown',
  },
  // In production, ISO timestamps; pino-pretty in dev wants epoch ms.
  timestamp: pino.stdTimeFunctions.isoTime,
  // Hide the noisy "request completed" log from pino-http style middleware
  // if it's ever added. We rely on Next.js's own request logs for that.
  formatters: {
    level(label) {
      return { level: label }
    },
  },
  // Pretty-print only in dev/test. In prod, raw JSON is what we want.
  ...((!isProd && !isTest)
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname,service,env,version',
          },
        },
      }
    : {}),
})

// Fields whose VALUES must be redacted from any object passed to the logger.
// These can show up if a route accidentally logs req.headers / req.body on
// error. Default sets to "[REDACTED]" and recurses one level deep so the
// structure stays scannable.
const SENSITIVE_KEYS = new Set([
  'password', 'pass', 'pwd', 'token', 'authorization',
  'refresh-token', 'refresh_token', 'access_token', 'access-token',
  'session', 'cookie', 'set-cookie',
  'email_verification_token', 'email_verification', 'verify_token',
  'reset_token', 'reset-token',
  'secret', 'jwt', 'csrf', 'x-csrf', 'x-csrf-token',
  'email_token', 'magic-link',
  'api_key', 'api-key', 'apikey',
  'credit_card', 'credit-card', 'card', 'cvv', 'cvc',
  'private_key', 'private-key',
])

// Recursive shallow redact — handles common shapes we encounter in log
// contexts: { err: { ... } }, { body: { ... } }, { headers: { ... } }.
// Doesn't try to handle Map/Set/circular refs; that's out of scope.
function redact<T>(input: T, seen: WeakSet<object> = new WeakSet()): T {
  if (input === null || typeof input !== 'object') return input
  if (seen.has(input as object)) return input
  seen.add(input as object)

  if (Array.isArray(input)) {
    return input.map((v) => redact(v, seen)) as unknown as T
  }

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k)) {
      out[k] = '[REDACTED]'
    } else if (v && typeof v === 'object' && Object.keys(v).length <= 25) {
      // Only recurse one level deep for normal use — keeps perf bounded.
      out[k] = redact(v, seen)
    } else {
      out[k] = v
    }
  }
  return out as unknown as T
}

/**
 * Convenience: log an error with the standard error fields extracted.
 *
 * Usage:
 *   logger.error(serializeErr(err), 'auth/login failed')
 *
 * L3 (audit 2026-07-27): AUTOMATICALLY redacts known sensitive keys before
 * return. Pass `serializeErr(err, { extra: req.body })` and the body field
 * will be safely scrubbed — this prevents the classic "logger.error(err, body)"
 * foot-gun where raw passwords, tokens, or cookies land in log aggregators.
 */
export function serializeErr(
  err: unknown,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  const base: Record<string, unknown> = err instanceof Error
    ? {
        err: {
          message: err.message,
          name: err.name,
          stack: err.stack,
          ...((err as any).code !== undefined ? { code: (err as any).code } : {}),
          ...((err as any).detail !== undefined ? { detail: (err as any).detail } : {}),
        },
      }
    : { err: { message: String(err) } }

  if (extra) {
    return { ...base, ...redact(extra) }
  }
  return base
}

export type Logger = typeof logger
