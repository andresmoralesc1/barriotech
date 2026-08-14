import { Pool } from 'pg'

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'gps_street_sellers',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // Audit 2026-08-14 (rate-limit auditor): CRIT-9 SET LOCAL had no
  // effect across pool.query() (different implicit transaction per
  // statement on potentially different connections). Pool-level
  // statement_timeout is enforced by the Postgres backend and survives
  // across all queries on the same connection. 5s is a balance —
  // tight enough to free a stuck connection quickly, generous enough
  // for the slowest legitimate query in the app.
  statement_timeout: 5000,
})

export default pool
