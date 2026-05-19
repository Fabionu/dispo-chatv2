import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './pool.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, 'migrations')

async function main() {
  const client = await pool.connect()
  try {
    await client.query(`
      create table if not exists _migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      )
    `)

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    const { rows } = await client.query<{ id: string }>('select id from _migrations')
    const applied = new Set(rows.map((r) => r.id))

    let applied_count = 0
    for (const file of files) {
      if (applied.has(file)) continue
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      console.log(`→ applying ${file}`)
      await client.query('begin')
      try {
        await client.query(sql)
        await client.query('insert into _migrations (id) values ($1)', [file])
        await client.query('commit')
        applied_count++
      } catch (err) {
        await client.query('rollback')
        throw err
      }
    }

    if (applied_count === 0) console.log('✓ database up to date')
    else console.log(`✓ applied ${applied_count} migration(s)`)
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
