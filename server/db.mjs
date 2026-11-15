// SECOND-SERVE database: SQLite via Node's built-in node:sqlite (no npm
// packages, one file on disk: data/second-serve.db by default).
//
// Each entity has its own table with its key fields as real columns (for
// queries and indexes) plus the full record as JSON. The in-memory AppState
// is the working copy; after every action the changed rows are written in a
// single transaction, so a crash can't leave half an update on disk.

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY, status TEXT NOT NULL, donor TEXT NOT NULL, ngo_id INTEGER, runner_id INTEGER,
  safe_until INTEGER NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS donations_status ON donations(status);
CREATE INDEX IF NOT EXISTS donations_ngo ON donations(ngo_id);
CREATE INDEX IF NOT EXISTS donations_runner ON donations(runner_id);
CREATE TABLE IF NOT EXISTS ngos (id INTEGER PRIMARY KEY, name TEXT NOT NULL, verification TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS runners (id INTEGER PRIMARY KEY, name TEXT NOT NULL, on_shift INTEGER NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rescues (donation_id INTEGER PRIMARY KEY, ngo_id INTEGER, servings INTEGER NOT NULL, delivered_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS rescues_time ON rescues(delivered_at);
CREATE TABLE IF NOT EXISTS applications (id INTEGER PRIMARY KEY, role TEXT NOT NULL, status TEXT NOT NULL, org_name TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL CHECK (role IN ('coordinator','donor','ngo','runner')),
  name TEXT NOT NULL, pin_hash TEXT NOT NULL, donor_name TEXT, ngo_id INTEGER, runner_id INTEGER, application_id INTEGER,
  demo INTEGER NOT NULL DEFAULT 0, failed_logins INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, last_login INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS users_role_name ON users(role, name);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip TEXT);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, user_id INTEGER, user_name TEXT, role TEXT,
  action TEXT NOT NULL, target TEXT, ok INTEGER NOT NULL, detail TEXT);
CREATE INDEX IF NOT EXISTS audit_at ON audit(at);
CREATE TABLE IF NOT EXISTS photos (key TEXT PRIMARY KEY, donation_id INTEGER NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, application_id INTEGER, uploaded_by INTEGER, kind TEXT NOT NULL, name TEXT NOT NULL,
  mime TEXT NOT NULL, size INTEGER NOT NULL, bytes BLOB NOT NULL, created_at INTEGER NOT NULL);
`

const TABLES = {
  donations: {
    list: (s) => s.donations,
    key: (d) => d.id,
    sql: `INSERT INTO donations (id,status,donor,ngo_id,runner_id,safe_until,created_at,data,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET status=excluded.status, donor=excluded.donor, ngo_id=excluded.ngo_id, runner_id=excluded.runner_id,
          safe_until=excluded.safe_until, data=excluded.data, updated_at=excluded.updated_at`,
    row: (d, json, now) => [d.id, d.status, d.donor, d.ngoId, d.runnerId, d.safeUntil, d.createdAt, json, now],
    del: 'DELETE FROM donations WHERE id = ?',
  },
  ngos: {
    list: (s) => s.ngos,
    key: (n) => n.id,
    sql: `INSERT INTO ngos (id,name,verification,data,updated_at) VALUES (?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, verification=excluded.verification, data=excluded.data, updated_at=excluded.updated_at`,
    row: (n, json, now) => [n.id, n.name, n.verification, json, now],
    del: 'DELETE FROM ngos WHERE id = ?',
  },
  runners: {
    list: (s) => s.runners,
    key: (r) => r.id,
    sql: `INSERT INTO runners (id,name,on_shift,data,updated_at) VALUES (?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, on_shift=excluded.on_shift, data=excluded.data, updated_at=excluded.updated_at`,
    row: (r, json, now) => [r.id, r.name, r.onShift ? 1 : 0, json, now],
    del: 'DELETE FROM runners WHERE id = ?',
  },
  rescues: {
    list: (s) => s.history,
    key: (h) => h.donationId,
    sql: `INSERT INTO rescues (donation_id,ngo_id,servings,delivered_at,data) VALUES (?,?,?,?,?)
          ON CONFLICT(donation_id) DO UPDATE SET ngo_id=excluded.ngo_id, servings=excluded.servings, delivered_at=excluded.delivered_at, data=excluded.data`,
    row: (h, json) => [h.donationId, h.ngoId, h.servings, h.deliveredAt, json],
    del: 'DELETE FROM rescues WHERE donation_id = ?',
  },
  applications: {
    list: (s) => s.applications ?? [],
    key: (a) => a.id,
    sql: `INSERT INTO applications (id,role,status,org_name,data,updated_at) VALUES (?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET role=excluded.role, status=excluded.status, org_name=excluded.org_name, data=excluded.data, updated_at=excluded.updated_at`,
    row: (a, json, now) => [a.id, a.role, a.status, a.orgName, json, now],
    del: 'DELETE FROM applications WHERE id = ?',
  },
}

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(SCHEMA)
  const stmt = new Map()
  const prep = (sql) => {
    if (!stmt.has(sql)) stmt.set(sql, db.prepare(sql))
    return stmt.get(sql)
  }

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      db.exec('COMMIT')
      return out
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }

  const getSetting = (k) => prep('SELECT value FROM settings WHERE key = ?').get(k)?.value
  const setSetting = (k, v) => prep('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v)

  /** Read the whole AppState back from the tables (null if the DB is empty). */
  function loadState() {
    if (!getSetting('initialised')) return null
    const parse = (rows) => rows.map((r) => JSON.parse(r.data))
    const weights = getSetting('weights')
    return {
      version: 1,
      donations: parse(prep('SELECT data FROM donations ORDER BY created_at DESC, id DESC').all()),
      ngos: parse(prep('SELECT data FROM ngos ORDER BY id').all()),
      runners: parse(prep('SELECT data FROM runners ORDER BY id').all()),
      history: parse(prep('SELECT data FROM rescues ORDER BY delivered_at').all()),
      applications: parse(prep('SELECT data FROM applications ORDER BY id DESC').all()),
      ...(weights ? { weights: JSON.parse(weights) } : {}),
    }
  }

  /** Write only what changed between two states, atomically. */
  function saveDiff(prev, next, now = Date.now()) {
    tx(() => {
      for (const t of Object.values(TABLES)) {
        const before = new Map((prev ? t.list(prev) : []).map((x) => [t.key(x), JSON.stringify(x)]))
        const after = t.list(next)
        const seen = new Set()
        for (const x of after) {
          const k = t.key(x)
          seen.add(k)
          const json = JSON.stringify(x)
          if (before.get(k) !== json) prep(t.sql).run(...t.row(x, json, now))
        }
        for (const k of before.keys()) if (!seen.has(k)) prep(t.del).run(k)
      }
      if (JSON.stringify(prev?.weights ?? null) !== JSON.stringify(next.weights ?? null)) {
        if (next.weights) setSetting('weights', JSON.stringify(next.weights))
        else prep("DELETE FROM settings WHERE key = 'weights'").run()
      }
      setSetting('initialised', '1')
      setSetting('version', String(Number(getSetting('version') ?? 0) + 1))
    })
    return Number(getSetting('version'))
  }

  return {
    raw: db,
    tx,
    prep,
    getSetting,
    setSetting,
    loadState,
    saveDiff,
    version: () => Number(getSetting('version') ?? 0),

    // ---------------- users & sessions
    userCount: () => prep('SELECT COUNT(*) AS n FROM users').get().n,
    insertUser: (u) =>
      prep(
        'INSERT INTO users (role,name,pin_hash,donor_name,ngo_id,runner_id,application_id,demo,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      ).run(u.role, u.name, u.pinHash, u.donorName ?? null, u.ngoId ?? null, u.runnerId ?? null, u.applicationId ?? null, u.demo ? 1 : 0, Date.now()).lastInsertRowid,
    userById: (id) => prep('SELECT * FROM users WHERE id = ?').get(id),
    userByRoleName: (role, name) => prep('SELECT * FROM users WHERE role = ? AND name = ? COLLATE NOCASE').get(role, name),
    listUsers: () => prep('SELECT id, role, name, demo FROM users ORDER BY role, name').all(),
    updateUser: (id, fields) => {
      const cols = Object.keys(fields)
      if (!cols.length) return
      prep(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => fields[c]), id)
    },
    usersWithApplication: () => prep('SELECT * FROM users WHERE application_id IS NOT NULL').all(),
    createSession: (hash, userId, expiresAt, ip) => prep('INSERT INTO sessions (token_hash,user_id,created_at,expires_at,ip) VALUES (?,?,?,?,?)').run(hash, userId, Date.now(), expiresAt, ip),
    sessionUser: (hash) =>
      prep('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').get(hash, Date.now()),
    deleteSession: (hash) => prep('DELETE FROM sessions WHERE token_hash = ?').run(hash),
    pruneSessions: () => prep('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now()),

    // ---------------- audit
    audit: (e) =>
      prep('INSERT INTO audit (at,user_id,user_name,role,action,target,ok,detail) VALUES (?,?,?,?,?,?,?,?)').run(
        e.at ?? Date.now(), e.userId ?? null, e.userName ?? null, e.role ?? null, e.action, e.target ?? null, e.ok ? 1 : 0, e.detail ? JSON.stringify(e.detail).slice(0, 2000) : null,
      ),
    auditList: (limit = 100) => prep('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(Math.min(500, Math.max(1, limit))),

    // ---------------- blobs
    putPhoto: (key, donationId, mime, bytes) =>
      prep('INSERT INTO photos (key,donation_id,mime,bytes,created_at) VALUES (?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET mime=excluded.mime, bytes=excluded.bytes').run(key, donationId, mime, bytes, Date.now()),
    getPhoto: (key) => prep('SELECT mime, bytes FROM photos WHERE key = ?').get(key),
    putDoc: (d) => prep('INSERT INTO documents (id,application_id,uploaded_by,kind,name,mime,size,bytes,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(d.id, d.applicationId ?? null, d.uploadedBy ?? null, d.kind, d.name, d.mime, d.size, d.bytes, Date.now()),
    getDoc: (id) => prep('SELECT * FROM documents WHERE id = ?').get(id),
    linkDoc: (id, applicationId, userId) => prep('UPDATE documents SET application_id = ? WHERE id = ? AND (uploaded_by = ? OR ? IS NULL)').run(applicationId, id, userId, userId),
    close: () => db.close(),
  }
}
