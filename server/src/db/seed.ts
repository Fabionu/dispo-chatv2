import bcrypt from 'bcryptjs'
import { pool } from './pool.js'
import { isProd } from '../env.js'

// Local-development seed. Creates two workspaces with a few users each so the
// connections flow (same-workspace DM vs. cross-workspace connect → accept →
// DM) can actually be exercised end-to-end.
//
// Safety:
//  - Refuses to run when NODE_ENV=production (set SEED_ALLOW_PROD=1 to force,
//    e.g. for a throwaway staging DB — never do this against real data).
//  - All accounts share SEED_PASSWORD (default 'devpassword') to keep manual
//    testing painless. Emails use the reserved `.local` TLD so they can never
//    collide with a real inbox.

const PASSWORD = process.env.SEED_PASSWORD ?? 'devpassword'

type WorkspaceSeed = {
  slug: string
  name: string
}

type UserSeed = {
  workspaceSlug: string
  email: string
  displayName: string
  role: 'admin' | 'dispatcher' | 'driver' | 'partner'
}

const WORKSPACES: WorkspaceSeed[] = [
  { slug: 'optima', name: 'Optima Logistics' },
  { slug: 'northstar', name: 'North Star Freight' },
]

const USERS: UserSeed[] = [
  // Optima — the existing default admin stays at its historical email so
  // anyone with muscle memory keeps working.
  {
    workspaceSlug: 'optima',
    email: process.env.SEED_EMAIL ?? 'dispatcher@dispo-chat.local',
    displayName: 'Dev Dispatcher',
    role: 'admin',
  },
  {
    workspaceSlug: 'optima',
    email: 'driver@optima.local',
    displayName: 'Olivia Park',
    role: 'driver',
  },
  // North Star — second workspace, so cross-company connect requests have
  // somewhere real to flow to.
  {
    workspaceSlug: 'northstar',
    email: 'dispatcher@northstar.local',
    displayName: 'Marcus Reyes',
    role: 'admin',
  },
  {
    workspaceSlug: 'northstar',
    email: 'driver@northstar.local',
    displayName: 'Hannah Liu',
    role: 'driver',
  },
]

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

    const workspaceIds = new Map<string, string>()
    for (const ws of WORKSPACES) {
      const { rows } = await client.query<{ id: string }>(
        `insert into workspaces (name, slug) values ($1, $2)
           on conflict (slug) do update set name = excluded.name
           returning id`,
        [ws.name, ws.slug],
      )
      workspaceIds.set(ws.slug, rows[0].id)
    }

    const hash = await bcrypt.hash(PASSWORD, 10)
    for (const u of USERS) {
      const workspaceId = workspaceIds.get(u.workspaceSlug)
      if (!workspaceId) {
        throw new Error(`Unknown workspace slug: ${u.workspaceSlug}`)
      }
      await client.query(
        `insert into users (workspace_id, email, password_hash, display_name, role)
         values ($1, $2, $3, $4, $5)
         on conflict (workspace_id, email)
           do update set
             password_hash = excluded.password_hash,
             display_name = excluded.display_name,
             role = excluded.role`,
        [workspaceId, u.email.toLowerCase(), hash, u.displayName, u.role],
      )
    }

    await client.query('commit')

    console.log('✓ seeded workspaces and users\n')
    console.log(`  shared password:  ${PASSWORD}\n`)
    for (const ws of WORKSPACES) {
      const wsUsers = USERS.filter((u) => u.workspaceSlug === ws.slug)
      console.log(`  ${ws.name} (${ws.slug})`)
      for (const u of wsUsers) {
        console.log(`    ${u.role.padEnd(10)} ${u.email}  — ${u.displayName}`)
      }
      console.log('')
    }
    console.log('  Try:')
    console.log('    1. sign in as dispatcher@dispo-chat.local (Optima)')
    console.log('    2. + → Search for a connection → find Marcus or Hannah at North Star')
    console.log('    3. Connect, then sign in as that user in another browser/profile')
    console.log('    4. Accept from the rail, then DM\n')
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
