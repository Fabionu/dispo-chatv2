// ── Member admin, from the terminal ─────────────────────────────────────────
// A small operator tool for the things a company admin needs to do to an
// account but has no UI for yet: fix a name, correct an email, reset a
// password, or unstick a member whose verification email never arrived.
//
//   cd server
//   npm run member -- list
//   npm run member -- set-password  driver@optima.local 'NewPassw0rd!'
//   npm run member -- set-name      driver@optima.local 'Olivia Park'
//   npm run member -- set-email     old@optima.local     new@optima.local
//   npm run member -- verify        driver@optima.local
//
// WHY A SCRIPT AND NOT A SCREEN. The in-app version of this is a real feature —
// it needs an admin-only endpoint, a rule for who may edit whom, and session
// revocation (see the note under `set-password`), and each of those is a
// product decision. This exists so the operator is not blocked while those are
// decided. It is deliberately NOT a stepping stone to the UI: when the endpoint
// lands, the UI should call the endpoint, and this stays as the break-glass
// path for when nobody can sign in at all.
//
// It writes to whatever `server/.env` points at. That is the SAME database the
// deployed app uses, so every command here prints the host it is about to touch
// and what it changed.
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import pg from 'pg'

type Row = {
  id: string
  email: string
  display_name: string
  role: string
  email_verified_at: string | null
  workspace_id: string
  workspace_name: string | null
}

const SELECT = `
  select u.id, u.email, u.display_name, u.role, u.email_verified_at,
         u.workspace_id, w.name as workspace_name
    from users u
    left join workspaces w on w.id = u.workspace_id`

function usage(): never {
  console.error(`
member — edit a member's identity or credentials

  npm run member -- list [nameOrEmailFragment]
  npm run member -- set-password <email|id> '<new password>'
  npm run member -- set-name     <email|id> '<display name>'
  npm run member -- set-email    <email|id> <newEmail>
  npm run member -- verify       <email|id>

<email|id> is an email address, or the account id printed by \`list\`. Use the
id when the same address exists in more than one company.
`)
  process.exit(1)
}

function connect(): pg.Client {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set — run this from the server/ directory.')
    process.exit(1)
  }
  // Say which database is about to be written to. The one failure mode this
  // tool has is being pointed at production while you think it is local, and
  // the host is the only thing that tells them apart.
  let host = 'unknown host'
  try {
    host = new URL(url).host
  } catch {
    /* an odd connection string still connects; the banner is a courtesy */
  }
  console.log(`· database: ${host}\n`)
  return new pg.Client({
    connectionString: url,
    ssl: /supabase|sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
  })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Every command resolves its target the way LOGIN does — `lower(email)`, and
// never a soft-deleted row — so what this tool edits is exactly what can sign
// in. A duplicate email across workspaces is legal in this schema (the unique
// constraint is per workspace), and the login handler is written to cope with
// it, so an ambiguous match must NOT be guessed at.
//
// Which is why every command takes an ID as well as an email: `list` prints the
// id of each account, and passing one picks a single row with no ambiguity.
// That is the answer to "two accounts, same address, which one is mine" — the
// email cannot distinguish them, so the id has to.
async function findOne(client: pg.Client, target: string): Promise<Row> {
  const key = target.trim()
  const byId = UUID.test(key)
  const { rows } = await client.query<Row>(
    byId
      ? `${SELECT} where u.id = $1 and u.deleted_at is null`
      : `${SELECT} where lower(u.email) = lower($1) and u.deleted_at is null`,
    [key],
  )
  if (rows.length === 0) {
    console.error(`No live account matches ${key}.`)
    process.exit(1)
  }
  if (rows.length > 1) {
    console.error(`${rows.length} accounts share ${key}, in different companies:\n`)
    for (const r of rows) console.error(`  ${r.id}  ${describe(r)}`)
    console.error('\nThe same address in two companies — the email cannot say which you mean.')
    console.error('Re-run with the id of the one you want, e.g.:')
    console.error(`  npm run member -- set-password ${rows[0].id} '<new password>'`)
    process.exit(1)
  }
  return rows[0]
}

function describe(r: Row): string {
  const verified = r.email_verified_at ? '' : '  ⚠ UNVERIFIED (cannot sign in)'
  return `${r.display_name} <${r.email}>  ${r.role}  · ${r.workspace_name ?? r.workspace_id}${verified}`
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (!command) usage()

  const client = connect()
  await client.connect()
  try {
    if (command === 'list') {
      const fragment = args[0] ?? ''
      const { rows } = await client.query<Row>(
        `${SELECT}
          where u.deleted_at is null
            and ($1 = '' or u.email ilike '%' || $1 || '%' or u.display_name ilike '%' || $1 || '%')
          order by w.name asc, u.display_name asc
          limit 200`,
        [fragment],
      )
      if (rows.length === 0) {
        console.log('No members matched.')
        return
      }
      for (const r of rows) console.log(`${r.id}  ${describe(r)}`)
      console.log(
        `\n${rows.length} member(s). Every command takes an id as well as an email — use` +
          '\nthe id when one address appears against more than one company.',
      )
      return
    }

    if (command === 'set-password') {
      const [email, password] = args
      if (!email || !password) usage()
      if (password.length < 8) {
        console.error('Password must be at least 8 characters (the app enforces this too).')
        process.exit(1)
      }
      const target = await findOne(client, email)
      // Same algorithm and cost as routes/auth.ts, so the hash is
      // indistinguishable from one the app wrote itself.
      const hash = await bcrypt.hash(password, 10)
      await client.query('update users set password_hash = $1 where id = $2', [hash, target.id])
      console.log(`Password set for ${describe(target)}`)
      // Sessions are stateless 7-day JWTs with no server-side store, so this
      // does NOT end sessions the member already has. Say so plainly: a reset
      // meant to lock someone out does not, on its own, lock them out.
      console.log(
        '\n⚠ Existing sessions still work. Sessions are 7-day JWTs with no server-side\n' +
          '  store, so any device already signed in stays signed in until that expires.',
      )
      return
    }

    if (command === 'set-name') {
      const [email, name] = args
      if (!email || !name?.trim()) usage()
      const target = await findOne(client, email)
      await client.query('update users set display_name = $1 where id = $2', [name.trim(), target.id])
      console.log(`Renamed ${target.display_name} → ${name.trim()}  <${target.email}>`)
      return
    }

    if (command === 'set-email') {
      const [current, next] = args
      if (!current || !next) usage()
      const normalised = next.trim().toLowerCase()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalised)) {
        console.error(`${next} does not look like an email address.`)
        process.exit(1)
      }
      const target = await findOne(client, current)
      // `users` is unique on (workspace_id, email), so a clash inside the same
      // workspace would be a constraint error; check first for a readable one.
      const { rows: clash } = await client.query<{ id: string }>(
        `select id from users
          where workspace_id = $1 and lower(email) = $2 and deleted_at is null and id <> $3`,
        [target.workspace_id, normalised, target.id],
      )
      if (clash.length > 0) {
        console.error(`${normalised} is already used by another member of this workspace.`)
        process.exit(1)
      }
      await client.query('update users set email = $1 where id = $2', [normalised, target.id])
      console.log(`Email changed ${target.email} → ${normalised}  (${target.display_name})`)
      if (target.email_verified_at) {
        // The old address was verified; the new one has not been. Left as-is on
        // purpose rather than silently clearing it — clearing would lock the
        // member out, which is not what "fix a typo in an email" should do.
        console.log(
          '\nNote: this account stays marked verified. If the new address needs proving,\n' +
            "  clear it with:  update users set email_verified_at = null where id = '" +
            target.id +
            "';",
        )
      }
      return
    }

    if (command === 'verify') {
      const [email] = args
      if (!email) usage()
      const target = await findOne(client, email)
      if (target.email_verified_at) {
        console.log(`Already verified: ${describe(target)}`)
        return
      }
      await client.query('update users set email_verified_at = now() where id = $1', [target.id])
      console.log(`Marked verified: ${describe(target)}`)
      return
    }

    usage()
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
