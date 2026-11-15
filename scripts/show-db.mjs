// Read-only tour of the SECOND-SERVE database, for demos.
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const file = resolve(process.argv[2] || process.env.SS_DB_PATH || 'data/second-serve.db')
if (!existsSync(file)) {
  console.error(`No database at ${file}. Start the app once (npm run dev) to create it.`)
  process.exit(1)
}
const db = new DatabaseSync(file, { readOnly: true })
const time = (ms) => (ms ? new Date(ms).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '')
const show = (title, rows) => {
  console.log(`\n=== ${title} ===`)
  if (rows.length) console.table(rows)
  else console.log('(empty)')
}

console.log(`Database file: ${file}`)
show('Tables (row counts)',
  ['donations', 'ngos', 'runners', 'rescues', 'applications', 'users', 'sessions', 'audit', 'photos', 'documents']
    .map((t) => ({ table: t, rows: db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n })))
show('Latest donations',
  db.prepare('SELECT id, status, donor, ngo_id, runner_id, safe_until, created_at FROM donations ORDER BY created_at DESC LIMIT 8').all()
    .map((r) => ({ ...r, safe_until: time(r.safe_until), created_at: time(r.created_at) })))
show('Delivered rescues',
  db.prepare('SELECT donation_id, ngo_id, servings, delivered_at FROM rescues ORDER BY delivered_at DESC LIMIT 8').all()
    .map((r) => ({ ...r, delivered_at: time(r.delivered_at) })))
show('Accounts (PINs are stored only as scrypt hashes)',
  db.prepare("SELECT id, role, name, substr(pin_hash, 1, 24) || '...' AS pin_hash, failed_logins, last_login FROM users ORDER BY role, name LIMIT 20").all()
    .map((r) => ({ ...r, last_login: time(r.last_login) })))
show('Activity log (latest 12)',
  db.prepare('SELECT at, user_name, role, action, target, ok FROM audit ORDER BY id DESC LIMIT 12').all()
    .map((r) => ({ ...r, at: time(r.at), ok: r.ok ? 'ok' : 'refused' })))
show('Stored photos',
  db.prepare('SELECT key, donation_id, mime, length(bytes) AS bytes FROM photos ORDER BY created_at DESC LIMIT 5').all())
db.close()
