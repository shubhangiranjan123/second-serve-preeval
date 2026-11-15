// Run a read-only query on the SECOND-SERVE database.
// Usage: node scripts/sql.mjs listings | ngos | activity | "SELECT ..."
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(process.env.SS_DB_PATH || 'data/second-serve.db', { readOnly: true })
const presets = {
  listings: `SELECT id, status, donor, json_extract(data, '$.name') AS food, json_extract(data, '$.servings') AS servings
             FROM donations ORDER BY created_at DESC`,
  ngos: `SELECT n.name, SUM(r.servings) AS meals, COUNT(*) AS rescues
         FROM rescues r JOIN ngos n ON n.id = r.ngo_id GROUP BY n.name ORDER BY meals DESC`,
  activity: `SELECT datetime(at/1000, 'unixepoch', 'localtime') AS time, user_name, role, action,
             CASE ok WHEN 1 THEN 'ok' ELSE 'refused' END AS result FROM audit ORDER BY id DESC LIMIT 20`,
}
const arg = process.argv[2] || 'listings'
const sql = presets[arg] || arg
if (!/^\s*(select|with)\b/i.test(sql)) { console.error('Only SELECT queries are allowed.'); process.exit(1) }
console.table(db.prepare(sql).all())
db.close()
