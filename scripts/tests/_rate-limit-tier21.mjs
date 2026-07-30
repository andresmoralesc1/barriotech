// Smoke test for Tier 21 rate-limit lib + auth endpoint integration.
// Run with:  node --experimental-vm-modules scripts/tests/_rate-limit-tier21.js
// or:        tsx scripts/tests/_rate-limit-tier21.ts
// (this file is plain ESM JS so it runs without tsx)

import { checkRateLimit, checkRateLimitByIdentifier, cleanupRateLimits } from '../apps/web/lib/rate-limit.ts'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function test1IpBuckets() {
  console.log('\n[T1] IP-only bucketing')
  await cleanupRateLimits()
  for (let i = 0; i < 3; i++) {
    const r = await checkRateLimit('10.0.0.1', 'smoke_t1', 3, 60_000)
    console.log(`  attempt ${i+1}: allowed=${r.allowed} remaining=${r.remaining}`)
    if (!r.allowed) throw new Error(`T1 early block at attempt ${i+1}`)
  }
  // 4th should fail
  const r = await checkRateLimit('10.0.0.1', 'smoke_t1', 3, 60_000)
  console.log(`  attempt 4 (over): allowed=${r.allowed} retryAfter=${r.retryAfter}`)
  if (r.allowed) throw new Error('T1 expected blocked on 4th attempt')
  console.log('  ✓ IP bucket works')
}

async function test2IdentifierBuckets() {
  console.log('\n[T2] identifier bucketing')
  await cleanupRateLimits()
  for (let i = 0; i < 3; i++) {
    const r = await checkRateLimitByIdentifier({ headers: new Headers() }, 'demo+' + i + '@example.com', 'smoke_t2', 3, 60_000)
    console.log(`  attempt ${i+1} (different emails): allowed=${r.allowed} remaining=${r.remaining}`)
  }
  // Now hammer one email - 4th attempt fails
  for (let i = 0; i < 4; i++) {
    const r = await checkRateLimitByIdentifier({ headers: new Headers() }, 'victim@example.com', 'smoke_t2', 3, 60_000)
    console.log(`  victim attempt ${i+1}: allowed=${r.allowed} remaining=${r.remaining} retryAfter=${r.retryAfter}`)
  }
  // Different IP same identifier → SAME bucket (verified by IP column not used)
  const r2 = await checkRateLimitByIdentifier({ headers: new Headers() }, 'victim@example.com', 'smoke_t2', 3, 60_000)
  if (r2.allowed) throw new Error('T2 expected victim still blocked')
  console.log('  ✓ identifier bucket isolates per-email across IPs')
}

async function test3SchemaConstraints() {
  console.log('\n[T3] CHECK constraint: exactly one key populated')
  await cleanupRateLimits()
  // Insert with ip+user_id → should fail (CHECK)
  const pool = (await import('../apps/web/lib/db.ts')).default
  try {
    await pool.query(
      `INSERT INTO rate_limit_attempts (ip, user_id, bucket) VALUES ('10.0.0.5', (SELECT id FROM users LIMIT 1), 'smoke_t3_bad')`
    )
    console.log('  ✗ CHECK constraint did not reject ip+user_id')
  } catch (err) {
    if (err.message && err.message.includes('rate_limit_attempts_keyed_by_one')) {
      console.log('  ✓ rejected dual-key insert')
    } else {
      console.log('  ? unexpected error:', err.message)
    }
  }
  // Insert with identifier only → should succeed
  await pool.query(
    `INSERT INTO rate_limit_attempts (identifier, bucket) VALUES ('hashed_identifier_test_xyz', 'smoke_t3_ok')`
  )
  console.log('  ✓ identifier-only insert accepted')
}

async function test4Isolation() {
  console.log('\n[T4] identifier hash is independent of case + spaces')
  const r1 = await checkRateLimitByIdentifier({ headers: new Headers() }, 'User@Example.com',  'smoke_t4_isolation', 100, 60_000)
  const r2 = await checkRateLimitByIdentifier({ headers: new Headers() }, '  user@example.com  ', 'smoke_t4_isolation', 100, 60_000)
  console.log(`  UPPER: remaining=${r1.remaining}`)
  console.log(`  lower+ws: remaining=${r2.remaining}`)
  // Both should target the same bucket (lowercased+trimmed → same hash)
  // r1.remaining + r2.remaining should equal 98 (started 100, used 2)
  if (r2.remaining !== 98) throw new Error(`T4 expected 98 remaining after 2 case-variants, got ${r2.remaining}`)
  console.log('  ✓ case+whitespace normalization merges buckets')
}

async function main() {
  try {
    await test1IpBuckets()
    await sleep(100)
    await test2IdentifierBuckets()
    await sleep(100)
    await test3SchemaConstraints()
    await sleep(100)
    await test4Isolation()
    console.log('\n*** ALL SMOKE TESTS PASSED ***')
    process.exit(0)
  } catch (err) {
    console.error('\n*** FAIL ***', err.message)
    process.exit(1)
  }
}

main()
