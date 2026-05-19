import bcrypt from 'bcryptjs'
import { pool } from './pool.js'

async function main() {
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

    const email = 'maroonyelnats@yahoo.com'
    const password = '123'
    const hash = await bcrypt.hash(password, 10)

    await client.query(
      `insert into users (workspace_id, email, password_hash, display_name, role)
       values ($1, $2, $3, $4, 'admin')
       on conflict (workspace_id, email)
         do update set password_hash = excluded.password_hash`,
      [workspaceId, email, hash, 'Test Dispatcher'],
    )

    await client.query('commit')
    console.log(`✓ seeded workspace 'optima' with user ${email} / ${password}`)
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
