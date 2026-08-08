#!/usr/bin/env node
/**
 * create-admin.js — promote a user to role='admin' OR create a new
 * admin from scratch.
 *
 * Usage:
 *   node scripts/dev/create-admin.js <email> [password]
 *
 * If the user exists, only their role is promoted (password is left
 * untouched). If the user doesn't exist, a fresh admin row is created
 * with the given password (bcrypt hashed, cost 13 to match register).
 *
 * The email is verified automatically — admins are trusted operators.
 *
 * Idempotent: re-running on an already-admin user is a no-op.
 */

const path = require('path')
const bcrypt = require(path.resolve('/home/telchar/barriotech/node_modules/bcryptjs'))
const { Client } = require(path.resolve('/home/telchar/barriotech/node_modules/pg'))
require(path.resolve('/home/telchar/barriotech/node_modules/dotenv')).config({
  path: '/home/telchar/barriotech/apps/web/.env',
})

const BCRYPT_COST = 13

async function main() {
  const [email, password] = process.argv.slice(2)
  if (!email) {
    console.error('usage: node scripts/dev/create-admin.js <email> [password]')
    process.exit(2)
  }

  const c = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'gps_street_sellers',
  })
  await c.connect()
  try {
    await c.query('BEGIN')

    const existing = await c.query('SELECT id, role, email_verified FROM users WHERE email = $1', [email])
    if (existing.rows.length > 0) {
      const user = existing.rows[0]
      if (user.role === 'admin') {
        console.log(`✓ ${email} ya es admin — nada que hacer`)
        await c.query('COMMIT')
        return
      }
      // Promotion path: the users_role_immutable trigger (migration 020)
      // blocks any UPDATE that changes role. We temporarily disable it,
      // promote, then re-enable. The BEGIN/COMMIT wraps the whole sequence
      // so a mid-flight failure leaves the trigger in its original state.
      await c.query('ALTER TABLE users DISABLE TRIGGER users_role_immutable')
      try {
        await c.query("UPDATE users SET role = 'admin', email_verified = true WHERE id = $1", [user.id])
      } finally {
        await c.query('ALTER TABLE users ENABLE TRIGGER users_role_immutable')
      }
      console.log(`✓ ${email} promovido a admin (id=${user.id})`)
    } else {
      if (!password) {
        console.error('El usuario no existe. Pasa un password para crearlo.')
        process.exit(2)
      }
      if (password.length < 8) {
        console.error('Password debe tener ≥ 8 caracteres')
        process.exit(2)
      }
      const hash = await bcrypt.hash(password, BCRYPT_COST)
      const result = await c.query(
        `INSERT INTO users (email, password_hash, name, role, email_verified)
         VALUES ($1, $2, $3, 'admin', true)
         RETURNING id`,
        [email, hash, email.split('@')[0]]
      )
      console.log(`✓ Admin creado: ${email} (id=${result.rows[0].id})`)
    }

    await c.query('COMMIT')
  } catch (err) {
    await c.query('ROLLBACK')
    console.error('Error:', err.message)
    process.exit(1)
  } finally {
    await c.end()
  }
}

main()
