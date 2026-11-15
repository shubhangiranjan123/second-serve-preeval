// SECOND-SERVE data API: accounts, shared state, live updates, actions,
// photos, documents, audit log. All writes go through core.applyAction(),
// the same rules the browser uses, with the actor taken from the session.
//
//   POST /api/auth/login        { userId, pin }           → sets session cookie
//   POST /api/auth/signup       { role, name, pin }       → donor / NGO self-registration
//   POST /api/auth/logout
//   GET  /api/auth/accounts     accounts for the sign-in picker (no secrets)
//   GET  /api/session           { mode, user }
//   GET  /api/state             { version, state, user }  (filtered for the role)
//   GET  /api/stream            Server-Sent Events: the same, pushed on every change
//   POST /api/action            { action }                → { ok, result, version }
//   GET  /api/photos/:key       donation photo thumbnails
//   POST /api/docs              TrustCheck document upload (base64 JSON)
//   GET  /api/docs/:id          document (coordinator or uploader only)
//   GET  /api/audit             audit log (coordinator)
//   POST /api/admin/import      replace data with a browser export (coordinator)
//   GET  /api/lan               this computer's Wi-Fi addresses, for the phone QR

import { randomUUID } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { COOKIE, SESSION_HOURS, hashPin, limiter, newToken, readCookie, sessionCookie, tokenHash, validPin, verifyPin } from './auth.mjs'

const json = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra })
  res.end(JSON.stringify(body))
}
const err = (res, status, code, message) => json(res, status, { ok: false, error: { code, message } })

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0
    let tooBig = false
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit * 3) req.destroy()
      else if (size > limit) tooBig = true
      else chunks.push(c)
    })
    req.on('end', () => {
      if (tooBig) return reject(Object.assign(new Error('Request too large'), { status: 413, code: 'TOO_LARGE' }))
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(Object.assign(new Error('Body must be JSON'), { status: 400, code: 'BAD_REQUEST' }))
      }
    })
    req.on('error', reject)
  })
}

const clientIp = (req) => String(req.socket?.remoteAddress ?? 'local')

// ---------------------------------------------------------------- demo accounts
// Clearly marked demo PINs, printed on the sign-in screen. Override the
// coordinator PIN with SS_COORDINATOR_PIN; disable all demo accounts with SS_DEMO=0.
export const DEMO_PINS = { coordinator: '2468', donor: '1111', ngo: '2222', runner: '3333' }

function seedUsers(db, state, coordinatorPin) {
  const add = (u) => {
    if (!db.userByRoleName(u.role, u.name)) db.insertUser(u)
  }
  add({ role: 'coordinator', name: 'Coordinator', pinHash: hashPin(coordinatorPin), demo: true })
  const apps = state.applications ?? []
  const donors = [...new Set([...state.donations.map((d) => d.donor), ...apps.filter((a) => a.role === 'donor').map((a) => a.orgName)])]
  for (const name of donors) add({ role: 'donor', name, donorName: name, pinHash: hashPin(DEMO_PINS.donor), applicationId: apps.find((a) => a.role === 'donor' && a.orgName === name)?.id ?? null, demo: true })
  for (const n of state.ngos) add({ role: 'ngo', name: n.name, ngoId: n.id, pinHash: hashPin(DEMO_PINS.ngo), applicationId: apps.find((a) => a.role === 'recipient' && a.ngoId === n.id)?.id ?? null, demo: true })
  for (const r of state.runners) add({ role: 'runner', name: r.name, runnerId: r.id, pinHash: hashPin(DEMO_PINS.runner), demo: true })
}

export function actorOf(u) {
  return {
    role: u.role,
    name: u.name,
    userId: u.id,
    donorName: u.donor_name ?? undefined,
    ngoId: u.ngo_id ?? null,
    runnerId: u.runner_id ?? undefined,
    applicationId: u.application_id ?? null,
  }
}

const publicUser = (u) => ({ id: u.id, role: u.role, name: u.name, donorName: u.donor_name, ngoId: u.ngo_id, runnerId: u.runner_id, applicationId: u.application_id, demo: !!u.demo })

/** What each role is allowed to see. Coordinators see everything. */
export function sanitize(state, u) {
  if (u.role === 'coordinator') return state
  const apps = (state.applications ?? []).filter((a) => a.id === u.application_id)
  return { ...state, applications: apps }
}

// ---------------------------------------------------------------- blobs
const IMG = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': null }
const isWebp = (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'
function sniff(buf, mime) {
  if (mime === 'image/webp') return isWebp(buf)
  if (mime === 'application/pdf') return buf.toString('ascii', 0, 5) === '%PDF-'
  const sig = IMG[mime]
  return !!sig && sig.every((b, i) => buf[i] === b)
}

function parseDataUrl(s, maxBytes) {
  const m = typeof s === 'string' && s.match(/^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]+)$/)
  if (!m) return null
  const bytes = Buffer.from(m[2], 'base64')
  if (bytes.length > maxBytes || !sniff(bytes, m[1])) return null
  return { mime: m[1], bytes }
}

// ---------------------------------------------------------------- API
export function createDataApi({ db, core, demo = true, coordinatorPin = DEMO_PINS.coordinator, log = console, loginsPer5Min = 30 }) {
  // Load or create the data.
  let state = db.loadState()
  if (!state) {
    state = core.freshState(Date.now())
    db.saveDiff(null, state)
  } else {
    state = core.withTrust(state)
  }
  if (db.userCount() === 0 && demo) seedUsers(db, state, coordinatorPin)
  db.pruneSessions()

  const streams = new Set()
  const loginLimit = limiter(loginsPer5Min, 5 * 60_000) // per device; wrong PINs also lock the account after 5
  const signupLimit = limiter(5, 60 * 60_000)
  const uploadLimit = limiter(30, 60_000)

  function currentUser(req) {
    const t = readCookie(req, COOKIE)
    return t ? db.sessionUser(tokenHash(t)) ?? null : null
  }

  function broadcast() {
    const version = db.version()
    for (const s of streams) {
      const u = db.userById(s.userId)
      if (!u) {
        s.res.end()
        streams.delete(s)
        continue
      }
      s.res.write(`event: state\ndata: ${JSON.stringify({ version, state: sanitize(state, u), user: publicUser(u) })}\n\n`)
    }
  }

  /** Move photo data URLs out of the JSON into the photos table. */
  function externalisePhotos(next, donationId) {
    const d = next.donations.find((x) => x.id === donationId)
    const sc = d?.screening
    if (!sc) return next
    const urls = []
    for (const [i, p] of (sc.photos ?? (sc.photo ? [sc.photo] : [])).entries()) {
      if (typeof p === 'string' && p.startsWith('/api/photos/')) {
        urls.push(p)
        continue
      }
      const parsed = parseDataUrl(p, 400_000)
      if (!parsed) continue
      const key = `${donationId}-${i}-${randomUUID().slice(0, 8)}`
      db.putPhoto(key, donationId, parsed.mime, parsed.bytes)
      urls.push(`/api/photos/${key}`)
    }
    const screening = { ...sc, photos: urls, photo: urls[0] }
    return { ...next, donations: next.donations.map((x) => (x.id === donationId ? { ...x, screening } : x)) }
  }

  function commit(next, user, action, ok, detail) {
    db.audit({ userId: user?.id, userName: user?.name, role: user?.role, action, target: detail?.target, ok, detail })
    if (!ok) return db.version()
    const version = db.saveDiff(state, next)
    state = next
    // Keep NGO accounts linked to the NGO record TrustCheck creates on approval.
    for (const u of db.usersWithApplication()) {
      const app = (state.applications ?? []).find((a) => a.id === u.application_id)
      if (app && u.role === 'ngo' && (app.ngoId ?? null) !== (u.ngo_id ?? null)) db.updateUser(u.id, { ngo_id: app.ngoId ?? null })
    }
    broadcast()
    return version
  }

  function startSession(res, u, req) {
    const { token, hash } = newToken()
    db.createSession(hash, u.id, Date.now() + SESSION_HOURS * 3_600_000, clientIp(req))
    db.updateUser(u.id, { last_login: Date.now(), failed_logins: 0, locked_until: 0 })
    return sessionCookie(token, SESSION_HOURS * 3600)
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://local')
    const path = url.pathname
    const method = req.method

    try {
      // ---------------- public
      if (path === '/api/session' && method === 'GET') {
        const u = currentUser(req)
        return json(res, 200, { ok: true, mode: 'server', user: u ? publicUser(u) : null, demo })
      }
      if (path === '/api/auth/accounts' && method === 'GET') {
        return json(res, 200, { ok: true, accounts: db.listUsers().map((u) => ({ id: u.id, role: u.role, name: u.name })), demoPins: demo ? DEMO_PINS : null })
      }
      if (path === '/api/lan' && method === 'GET') {
        const addresses = Object.values(networkInterfaces())
          .flat()
          .filter((i) => i && i.family === 'IPv4' && !i.internal)
          .map((i) => i.address)
        return json(res, 200, { ok: true, addresses })
      }
      if (path === '/api/auth/login' && method === 'POST') {
        const body = await readJson(req, 4096)
        if (loginLimit(clientIp(req))) return err(res, 429, 'RATE_LIMITED', 'Too many sign-in attempts. Wait a few minutes.')
        const u = db.userById(Number(body.userId))
        if (!u) return err(res, 401, 'BAD_LOGIN', 'Wrong account or PIN.')
        if (u.locked_until > Date.now()) return err(res, 429, 'LOCKED', 'Too many wrong PINs. Try again in a few minutes.')
        if (!validPin(String(body.pin ?? '')) || !verifyPin(String(body.pin), u.pin_hash)) {
          const fails = u.failed_logins + 1
          db.updateUser(u.id, { failed_logins: fails, locked_until: fails >= 5 ? Date.now() + 5 * 60_000 : 0 })
          db.audit({ userId: u.id, userName: u.name, role: u.role, action: 'login', ok: false })
          return err(res, 401, 'BAD_LOGIN', 'Wrong account or PIN.')
        }
        const cookie = startSession(res, u, req)
        db.audit({ userId: u.id, userName: u.name, role: u.role, action: 'login', ok: true })
        return json(res, 200, { ok: true, user: publicUser(db.userById(u.id)) }, { 'set-cookie': cookie })
      }
      if (path === '/api/auth/signup' && method === 'POST') {
        const body = await readJson(req, 4096)
        if (signupLimit(clientIp(req))) return err(res, 429, 'RATE_LIMITED', 'Too many new accounts from this device. Try later.')
        const role = body.role
        const name = String(body.name ?? '').trim()
        if (role !== 'donor' && role !== 'ngo') return err(res, 400, 'BAD_ROLE', 'Sign up as a donor or an NGO. Runners are added by the coordinator.')
        if (name.length < 3 || name.length > 80) return err(res, 400, 'BAD_NAME', 'Organisation name must be 3–80 characters.')
        if (!validPin(String(body.pin ?? ''))) return err(res, 400, 'BAD_PIN', 'Choose a PIN of 4–8 digits.')
        if (db.userByRoleName(role, name)) return err(res, 409, 'TAKEN', 'An account with that name already exists. Sign in instead.')
        const id = db.insertUser({ role, name, pinHash: hashPin(String(body.pin)), donorName: role === 'donor' ? name : null })
        const u = db.userById(Number(id))
        const cookie = startSession(res, u, req)
        db.audit({ userId: u.id, userName: u.name, role: u.role, action: 'signup', ok: true })
        return json(res, 200, { ok: true, user: publicUser(u) }, { 'set-cookie': cookie })
      }
      if (path === '/api/auth/logout' && method === 'POST') {
        const t = readCookie(req, COOKIE)
        if (t) db.deleteSession(tokenHash(t))
        return json(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', 0) })
      }
      if (path.startsWith('/api/photos/') && method === 'GET') {
        // Photos are thumbnails of food, needed on public screens like the room wall.
        const p = db.getPhoto(decodeURIComponent(path.slice('/api/photos/'.length)))
        if (!p) return err(res, 404, 'NOT_FOUND', 'No such photo')
        res.writeHead(200, { 'content-type': p.mime, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' })
        return res.end(Buffer.from(p.bytes))
      }

      // ---------------- signed in
      const isData = ['/api/state', '/api/stream', '/api/action', '/api/docs', '/api/audit', '/api/admin/import'].some((p) => path === p || path.startsWith(p + '/'))
      if (!isData) return false
      const u = currentUser(req)
      if (!u) return err(res, 401, 'SIGN_IN', 'Sign in first.')

      if (path === '/api/state' && method === 'GET') return json(res, 200, { ok: true, version: db.version(), state: sanitize(state, u), user: publicUser(u) })

      if (path === '/api/stream' && method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' })
        res.write(`retry: 3000\nevent: state\ndata: ${JSON.stringify({ version: db.version(), state: sanitize(state, u), user: publicUser(u) })}\n\n`)
        const entry = { res, userId: u.id }
        streams.add(entry)
        const ping = setInterval(() => res.write(': ping\n\n'), 20_000)
        req.on('close', () => {
          clearInterval(ping)
          streams.delete(entry)
        })
        return true
      }

      if (path === '/api/action' && method === 'POST') {
        const body = await readJson(req, 3 * 1024 * 1024)
        const action = body.action
        const actor = actorOf(u)
        let out
        try {
          out = core.applyAction(state, action, actor, Date.now())
        } catch (e) {
          if (e instanceof core.ActionError) {
            commit(null, u, String(action?.type ?? 'unknown'), false, { message: e.message })
            return err(res, e.status, e.code, e.message)
          }
          throw e
        }
        let next = out.state
        if (action.type === 'addDonation' && out.result.donation) {
          next = externalisePhotos(next, out.result.donation.id)
          out.result.donation = next.donations.find((d) => d.id === out.result.donation.id)
        }
        if (action.type === 'splitDonation' && out.result.donation) {
          // the copy shares the original's photo URLs; nothing to store
        }
        if (action.type === 'submitApplication' && out.result.application) {
          const app = out.result.application
          for (const d of app.docs ?? []) if (typeof d.url === 'string' && d.url.startsWith('/api/docs/')) db.linkDoc(d.url.slice('/api/docs/'.length), app.id, u.role === 'coordinator' ? null : u.id)
          if (u.role !== 'coordinator') db.updateUser(u.id, { application_id: app.id })
        }
        const target = action.donationId ?? action.id ?? action.ngoId ?? action.runnerId ?? out.result.donation?.id ?? out.result.application?.id
        const version = commit(next, u, action.type, true, { target: target != null ? String(target) : undefined })
        return json(res, 200, { ok: true, result: out.result, version })
      }

      if (path === '/api/docs' && method === 'POST') {
        if (uploadLimit(String(u.id))) return err(res, 429, 'RATE_LIMITED', 'Too many uploads. Wait a minute.')
        const body = await readJson(req, 8 * 1024 * 1024)
        const mime = String(body.type ?? '')
        if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(mime)) return err(res, 415, 'TYPE', 'Use PDF, JPEG, PNG or WebP.')
        const bytes = Buffer.from(String(body.data ?? ''), 'base64')
        if (!bytes.length || bytes.length > 5 * 1024 * 1024) return err(res, 413, 'SIZE', 'Files must be under 5 MB.')
        if (!sniff(bytes, mime)) return err(res, 400, 'CONTENT', 'The file content doesn’t match its type.')
        const id = randomUUID()
        db.putDoc({ id, uploadedBy: u.id, kind: String(body.kind ?? 'Other').slice(0, 60), name: String(body.name ?? 'file').slice(0, 120), mime, size: bytes.length, bytes })
        db.audit({ userId: u.id, userName: u.name, role: u.role, action: 'uploadDoc', target: id, ok: true })
        return json(res, 200, { ok: true, id, url: `/api/docs/${id}` })
      }
      if (path.startsWith('/api/docs/') && method === 'GET') {
        const d = db.getDoc(path.slice('/api/docs/'.length))
        if (!d) return err(res, 404, 'NOT_FOUND', 'No such document')
        const mayRead = u.role === 'coordinator' || d.uploaded_by === u.id || (d.application_id != null && d.application_id === u.application_id)
        if (!mayRead) return err(res, 403, 'FORBIDDEN', 'You can’t open this document.')
        res.writeHead(200, {
          'content-type': d.mime,
          'content-disposition': `inline; filename="${String(d.name).replace(/[^\w.\- ]/g, '_')}"`,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
        })
        return res.end(Buffer.from(d.bytes))
      }

      if (path === '/api/audit' && method === 'GET') {
        if (u.role !== 'coordinator') return err(res, 403, 'FORBIDDEN', 'Coordinators only.')
        return json(res, 200, { ok: true, entries: db.auditList(Number(url.searchParams.get('limit') ?? 100)) })
      }
      if (path === '/api/admin/import' && method === 'POST') {
        if (u.role !== 'coordinator') return err(res, 403, 'FORBIDDEN', 'Coordinators only.')
        const body = await readJson(req, 12 * 1024 * 1024)
        if (!core.isState(body.state)) return err(res, 400, 'BAD_STATE', 'That isn’t SECOND-SERVE data.')
        let next = core.withTrust(body.state)
        for (const d of next.donations) next = externalisePhotos(next, d.id)
        const version = commit(next, u, 'import', true, { target: `${next.donations.length} listings` })
        return json(res, 200, { ok: true, version })
      }
      return err(res, 404, 'NOT_FOUND', 'Unknown API route')
    } catch (e) {
      if (e && e.status) return err(res, e.status, e.code ?? 'BAD_REQUEST', e.message)
      log.error('[data]', e)
      return err(res, 500, 'INTERNAL', 'Unexpected server error')
    }
  }

  return { handle, currentUser, getState: () => state, close: () => streams.forEach((s) => s.res.end()) }
}
