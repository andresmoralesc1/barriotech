#!/usr/bin/env node
// scripts/cleanup-rate-limits.js
//
// L4 (audit 2026-07-27): periodic Janitor for rate_limit_attempts.
//
// The rate-limit module already exposes cleanupRateLimits() at
// apps/web/lib/rate-limit.ts which DELETEs rows older than 1 day.
// No scheduled job was calling it, so the table would have grown
// unbounded (one row per (ip, bucket) per attempt) — quietly increasing
// index size and SELECT latency.
//
// Wire one of the following (operator choice):
//
//   ── pm2 cron (preferred; uses the existing PM2 process):
//     pm2 install pm2-cron   # one-time
//     pm2 cron 0 4 * * * 'cd /home/telchar/gps-street-sellers && node scripts/cleanup-rate-limits.js >> /var/log/gps-cleanup.log 2>&1'
//
//   ── system cron (root crontab -e):
//     0 4 * * * cd /home/telchar/gps-street-sellers && node scripts/cleanup-rate-limits.js >> /var/log/gps-cleanup.log 2>&1
//
// Runs at 04:00 local — outside peak hours, before the daily metrics
// backup at 05:00.
//
// This script can also be run manually:
//
//   node scripts/cleanup-rate-limits.js
//
// Exit codes: 0 on success, 1 on DB error (cron will email the failure).

import process from 'node:process'
import fs from 'node:fs'
const PROJECT = '/home/telchar/gps-street-sellers'

function fail(msg, code = 1) {
  console.error(`[cleanup-rate-limits] ${msg}`)
  process.exit(code)
}

async function main() {
  // The cleanup function lives in lib/rate-limit.ts which is TypeScript.
  // Easiest path: shell out to a one-shot node script that imports it
  // via the compiled .next bundle. But that's brittle across Next.js
  // versions. Use a tiny inline PG query instead — the SQL is the
  // canonical truth anyway.
  const { Client } = await import('pg').catch(() => ({ Client: null }))
  if (!Client) {
    fail('pg module not installed (npm install pg)')
  }

  const url = process.env.DATABASE_URL || buildUrlFromEnv()
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const startedAt = Date.now()
    const result = await client.query(
      "DELETE FROM rate_limit_attempts WHERE attempted_at < NOW() - INTERVAL '1 day'"
    )
    const durationMs = Date.now() - startedAt
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      event: 'rate_limit_cleanup',
      deleted: result.rowCount,
      durationMs,
    }))
  } finally {
    await client.end()
  }
}

/**
 * Build a DATABASE_URL from the apps/web/.env we ship in this repo.
 * Mirrors lib/db.ts which reads DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD.
 */
function buildUrlFromEnv() {
  try {
    const envText = fs.readFileSync(`${PROJECT}/apps/web/.env`, 'utf8')
    const vars = Object.fromEntries(
      envText.split('\n')
        .filter((l) => l && !l.startsWith('#') && l.includes('='))
        .map((l) => {
          const i = l.indexOf('=')
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
        })
    )
    return `postgres://${encodeURIComponent(vars.DB_USER || 'postgres')}:${encodeURIComponent(vars.DB_PASSWORD || '')}@${vars.DB_HOST || 'localhost'}:${vars.DB_PORT || '5432'}/${vars.DB_NAME || 'gps_street_sellers'}`
  } catch (e) {
    fail(`cannot read .env: ${e.message}`)
  }
}

main().catch((e) => fail(`unexpected: ${e.stack || e.message}`))
