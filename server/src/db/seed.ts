import bcrypt from 'bcryptjs'
import { pool } from './pool.js'
import { isProd } from '../env.js'

// Local-development seed. Creates one workspace + one admin user so a fresh
// clone can sign in immediately.
//
// Safety:
//  - Refuses to run when NODE_ENV=production (set SEED_ALLOW_PROD=1 to force,
//    e.g. for a throwaway staging DB — never do this against real data).
//  - Credentials come from SEED_EMAIL / SEED_PASSWORD env vars, with
//    development-only defaults. The default email uses the reserved
//    `.local` TLD so it can never collide with a real inbox.

const EMAIL = process.env.SEED_EMAIL ?? 'dispatcher@dispo-chat.local'
const PASSWORD = process.env.SEED_PASSWORD ?? 'devpassword'

async function main() {
  if (isProd && process.env.SEED_ALLOW_PROD !== '1') {
    console.error(
      'Refusing to seed: NODE_ENV=production.\n' +
        'Seeding is for local development. If this really is a throwaway ' +
        'database, set SEED_ALLOW_PROD=1 to override.',
    )
    process.exit(1)
  }

  if (PASSWORD.length < 8) {
    console.error(
      `SEED_PASSWORD is too short (${PASSWORD.length} chars). ` +
        'Use at least 8 — it must satisfy the same rule as real signups.',
    )
    process.exit(1)
  }

  const client = await pool.connect()
  try {
    await client.query('begin')

    const workspace = await client.query<{ id: string }>(
      `insert into workspaces (name, slug) values ($1, $2)
         on conflict (slug) do update set name = excluded.name
         returning id`,
      ['Optima Logistics', 'optima'],
    )
    const workspaceId = workspace.rows[0].id

    const hash = await bcrypt.hash(PASSWORD, 10)

    await client.query(
      `insert into users (workspace_id, email, password_hash, display_name, role)
       values ($1, $2, $3, $4, 'admin')
       on conflict (workspace_id, email)
         do update set password_hash = excluded.password_hash`,
      [workspaceId, EMAIL.toLowerCase(), hash, 'Dev Dispatcher'],
    )

    await client.query('commit')
    console.log(`✓ seeded workspace 'optima'`)
    console.log(`  sign in with:  ${EMAIL}  /  ${PASSWORD}`)
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
