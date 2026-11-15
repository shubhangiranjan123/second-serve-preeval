// Backend: shared rules (applyAction) and the HTTP data API on a real
// SQLite database (in a temp file), exercised over HTTP like a browser would.
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import * as core from '../src/lib/core'
import { ActionError, applyAction, freshState, type Actor } from '../src/lib/actions'
import { MIN } from '../src/lib/engine'
// @ts-expect-error — plain .mjs server modules
import { openDb } from '../server/db.mjs'
// @ts-expect-error — plain .mjs server modules
import { createDataApi } from '../server/data.mjs'
import type { AppState } from '../src/types'
import { NOW } from './fixtures'

const coord: Actor = { role: 'coordinator', name: 'Coordinator' }
const input = (over = {}) => ({
  name: 'Veg pulao',
  donor: 'The Green Kitchen',
  category: 'Meals' as const,
  servings: 20,
  quantity: 20,
  unit: 'servings',
  area: 'Sector 17',
  address: 'Gate 1',
  storage: 'Chilled' as const,
  diet: 'Veg' as const,
  description: '',
  prepMinutes: 10,
  travelEstimate: 20,
  safeHours: 4,
  ...over,
})
const screened = { screening: { outcome: 'pass' as const, visual: 'Visually acceptable' as const, rules: [], reviewReasons: [], screenedAt: NOW, ai: null, edited: [] } }

function run(s: AppState, a: Parameters<typeof applyAction>[1], actor: Actor = coord) {
  return applyAction(s, a, actor, NOW)
}
function expectFail(fn: () => unknown, code: string) {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionError)
    expect((e as ActionError).code).toBe(code)
    return
  }
  throw new Error(`expected ${code}`)
}

describe('Shared rules: roles and permissions', () => {
  const s = freshState(NOW)
  test('donors list only as themselves', () => {
    const r = run(s, { type: 'addDonation', input: input({ donor: 'Someone Else' }), extras: screened }, { role: 'donor', name: 'The Green Kitchen', donorName: 'The Green Kitchen' })
    expect(r.result.donation?.donor).toBe('The Green Kitchen')
  })
  test('runners and NGOs cannot list food, reset, or approve TrustCheck', () => {
    const runner: Actor = { role: 'runner', name: 'Meera', runnerId: 2 }
    expectFail(() => run(s, { type: 'addDonation', input: input(), extras: screened }, runner), 'FORBIDDEN')
    expectFail(() => run(s, { type: 'reset' }, runner), 'FORBIDDEN')
    expectFail(() => run(s, { type: 'reviewApplication', id: 4, action: 'approve' }, { role: 'ngo', name: 'Roti', ngoId: 104 }), 'FORBIDDEN')
  })
  test('a runner can take a run only for themselves, and only one at a time', () => {
    let st = run(s, { type: 'addDonation', input: input(), extras: screened, autoMatch: true }).state
    const d = st.donations[0]
    expect(d.status).toBe('Reserved')
    // a runner who is on shift and not already on a run
    const free = st.runners.find((r) => r.onShift && !st.donations.some((x) => x.runnerId === r.id && x.status === 'Reserved'))!
    const other = st.runners.find((r) => r.id !== free.id)!
    const me: Actor = { role: 'runner', name: free.name, runnerId: free.id }
    expectFail(() => run(st, { type: 'assignRunner', donationId: d.id, runnerId: other.id }, me), 'FORBIDDEN')
    st = run(st, { type: 'assignRunner', donationId: d.id, runnerId: free.id }, me).state
    st = run(st, { type: 'addDonation', input: input({ name: 'Second tray' }), extras: screened, autoMatch: true }).state
    expectFail(() => run(st, { type: 'assignRunner', donationId: st.donations[0].id, runnerId: free.id }, me), 'CONFLICT')
  })
  test('only the NGO a rescue is addressed to can decline or confirm it', () => {
    const st = run(s, { type: 'addDonation', input: input(), extras: screened, autoMatch: true }).state
    const d = st.donations[0]
    const other = st.ngos.find((n) => n.id !== d.ngoId)!
    expectFail(() => run(st, { type: 'ngoDecline', donationId: d.id, reason: 'nope' }, { role: 'ngo', name: other.name, ngoId: other.id }), 'FORBIDDEN')
  })
})

describe('Shared rules: rescue flow', () => {
  test('publish → auto-match → runner → NGO confirms → delivered once, counted once', () => {
    let st = freshState(NOW)
    const before = st.history.length
    const pub = run(st, { type: 'addDonation', input: input(), extras: screened, autoMatch: true })
    expect(pub.result.matchedTo).toBeTruthy()
    st = pub.state
    const d = st.donations[0]
    const ngoActor: Actor = { role: 'ngo', name: 'x', ngoId: d.ngoId! }
    const free = st.runners.find((r) => r.onShift && !st.donations.some((x) => x.runnerId === r.id && x.status === 'Reserved'))!
    const runner: Actor = { role: 'runner', name: free.name, runnerId: free.id }
    st = run(st, { type: 'assignRunner', donationId: d.id, runnerId: free.id }, runner).state
    expectFail(() => run(st, { type: 'ngoConfirmReceipt', donationId: d.id }, ngoActor), 'INVALID') // not picked up yet
    st = run(st, { type: 'advance', donationId: d.id }, runner).state
    st = run(st, { type: 'ngoConfirmReceipt', donationId: d.id }, ngoActor).state
    const done = st.donations.find((x) => x.id === d.id)!
    expect(done.status).toBe('Delivered')
    expect(done.receivedBy).toBeTruthy()
    expect(st.history.length).toBe(before + 1)
    expectFail(() => run(st, { type: 'advance', donationId: d.id }, runner), 'INVALID')
  })
  test('NGO decline → automatic fallback to the next NGO, never back to the decliner', () => {
    let st = freshState(NOW)
    st = run(st, { type: 'addDonation', input: input({ category: 'Bakery', storage: 'Ambient', unit: 'items' }), extras: screened, autoMatch: true }).state
    const d = st.donations[0]
    const first = d.ngoId!
    const out = run(st, { type: 'ngoDecline', donationId: d.id, reason: 'No space' }, { role: 'ngo', name: 'x', ngoId: first })
    const after = out.state.donations.find((x) => x.id === d.id)!
    expect(after.declinedBy).toContain(first)
    expect(after.ngoId).not.toBe(first)
    expect(out.result.matchedTo).toBeTruthy()
    expect(after.status).toBe('Reserved')
  })
  test('server re-checks the gates: a stale screen can’t reserve an ineligible NGO', () => {
    let st = freshState(NOW)
    st = run(st, { type: 'addDonation', input: input({ diet: 'Non-veg' }), extras: screened }).state
    const d = st.donations[0]
    const saathi = st.ngos.find((n) => n.name.startsWith('Saathi'))! // veg-only
    expectFail(() => run(st, { type: 'reserve', donationId: d.id, ngoId: saathi.id, score: 99 }), 'NOT_ELIGIBLE')
  })
  test('a listing without AI screening always waits for a human check', () => {
    const r = run(freshState(NOW), { type: 'addDonation', input: input(), autoMatch: true })
    expect(r.result.donation?.status).toBe('In review')
    expect(r.result.matchedTo).toBeUndefined()
  })
  test('duplicate listing is refused; invalid input is refused with a reason', () => {
    const st = run(freshState(NOW), { type: 'addDonation', input: input(), extras: screened }).state
    expectFail(() => run(st, { type: 'addDonation', input: input(), extras: screened }), 'DUPLICATE')
    expectFail(() => run(st, { type: 'addDonation', input: input({ servings: 0 }), extras: screened }), 'INVALID')
    expectFail(() => run(st, { type: 'addDonation', input: input({ safeHours: 99 }), extras: screened }), 'INVALID')
  })
  test('a runner on a run can’t go off shift', () => {
    let st = run(freshState(NOW), { type: 'addDonation', input: input(), extras: screened, autoMatch: true }).state
    const free = st.runners.find((r) => r.onShift && !st.donations.some((x) => x.runnerId === r.id && x.status === 'Reserved'))!
    st = run(st, { type: 'assignRunner', donationId: st.donations[0].id, runnerId: free.id }).state
    expectFail(() => run(st, { type: 'toggleShift', runnerId: free.id }, { role: 'runner', name: free.name, runnerId: free.id }), 'INVALID')
  })
  test('TrustCheck approval is refused without checklist + matching check', () => {
    const st = freshState(NOW)
    const roti = st.applications!.find((a) => a.orgName === 'Roti Bank Manimajra')!
    expectFail(() => run(st, { type: 'reviewApplication', id: roti.id, action: 'approve' }), 'INVALID')
  })
  test('expired food can’t be approved after review', () => {
    let st = run(freshState(NOW), { type: 'addDonation', input: input({ safeHours: 1 }) }).state
    const d = st.donations[0]
    st = { ...st, donations: st.donations.map((x) => (x.id === d.id ? { ...x, safeUntil: NOW - MIN } : x)) }
    expectFail(() => run(st, { type: 'approveReview', donationId: d.id }), 'INVALID')
  })
})

// ---------------------------------------------------------------- HTTP

let server: Server
let base = ''
let dir = ''
let api: ReturnType<typeof createDataApi>

function boot() {
  const db = openDb(join(dir, 'test.db'))
  api = createDataApi({ db, core, demo: true, log: { error: () => {} }, loginsPer5Min: 10_000 })
  server = createServer((req, res) => {
    Promise.resolve(api.handle(req, res)).then((h) => {
      if (h === false) {
        res.writeHead(404)
        res.end()
      }
    })
  })
  return new Promise<void>((r) =>
    server.listen(0, () => {
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
      r()
    }),
  ).then(() => db)
}

type Jar = { cookie?: string }
async function call(path: string, body?: unknown, jar: Jar = {}) {
  const res = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(jar.cookie ? { cookie: jar.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const set = res.headers.get('set-cookie')
  if (set) jar.cookie = set.split(';')[0]
  return { status: res.status, body: await res.json().catch(() => null) }
}
async function signIn(name: string, pin: string, jar: Jar = {}) {
  const accounts = (await call('/api/auth/accounts')).body.accounts as Array<{ id: number; name: string }>
  const acc = accounts.find((a) => a.name === name)!
  const r = await call('/api/auth/login', { userId: acc.id, pin }, jar)
  return { jar, r }
}

describe('HTTP data API (real SQLite file)', () => {
  let db: ReturnType<typeof openDb>
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ss-'))
    db = await boot()
  })
  afterAll(() => {
    api.close()
    server.close()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test('seeded demo accounts; no data without signing in', async () => {
    const a = await call('/api/auth/accounts')
    expect(a.body.accounts.length).toBeGreaterThan(10)
    expect(a.body.accounts[0]).not.toHaveProperty('pin_hash')
    expect((await call('/api/state')).status).toBe(401)
  })

  test('wrong PIN refused; 5 wrong PINs lock the account', async () => {
    const accounts = (await call('/api/auth/accounts')).body.accounts as Array<{ id: number; name: string }>
    const kabir = accounts.find((a) => a.name === 'Kabir Singh')!
    for (let i = 0; i < 5; i++) expect((await call('/api/auth/login', { userId: kabir.id, pin: '0000' })).status).toBe(401)
    expect((await call('/api/auth/login', { userId: kabir.id, pin: '3333' })).body.error.code).toBe('LOCKED')
  })

  test('role-filtered state: NGOs only see their own TrustCheck application', async () => {
    const { jar } = await signIn('Haven Night Shelter', '2222')
    const st = (await call('/api/state', undefined, jar)).body.state
    expect(st.applications.length).toBe(1)
    expect(st.applications[0].orgName).toBe('Haven Night Shelter')
    const { jar: cj } = await signIn('Coordinator', '2468')
    expect((await call('/api/state', undefined, cj)).body.state.applications.length).toBeGreaterThan(5)
  })

  test('full rescue over HTTP with photos stored in the database', async () => {
    const { jar: donor } = await signIn('The Green Kitchen', '1111')
    const tinyJpeg = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 1)]).toString('base64')
    const extras = { screening: { ...screened.screening, photo: tinyJpeg, photos: [tinyJpeg] } }
    const pub = await call('/api/action', { action: { type: 'addDonation', input: input({ name: 'HTTP pulao' }), extras, autoMatch: true } }, donor)
    expect(pub.body.ok).toBe(true)
    const d = pub.body.result.donation
    expect(d.screening.photos[0]).toMatch(/^\/api\/photos\//)
    const photo = await fetch(base + d.screening.photos[0])
    expect(photo.headers.get('content-type')).toBe('image/jpeg')
    expect(pub.body.result.matchedTo).toBeTruthy()

    const st0 = (await call('/api/state', undefined, donor)).body.state as AppState
    const free = st0.runners.find((r) => r.onShift && !st0.donations.some((x) => x.runnerId === r.id && x.status === 'Reserved'))!
    const { jar: runner } = await signIn(free.name, '3333')
    expect((await call('/api/action', { action: { type: 'assignRunner', donationId: d.id, runnerId: free.id } }, runner)).body.ok).toBe(true)
    expect((await call('/api/action', { action: { type: 'advance', donationId: d.id } }, runner)).body.ok).toBe(true)
    const ngoName = (await call('/api/state', undefined, runner)).body.state.ngos.find((n: { id: number }) => n.id === d.ngoId)?.name
    const { jar: ngo } = await signIn(ngoName, '2222')
    expect((await call('/api/action', { action: { type: 'ngoConfirmReceipt', donationId: d.id } }, ngo)).body.ok).toBe(true)
    const st = (await call('/api/state', undefined, donor)).body.state
    expect(st.donations.find((x: { id: number }) => x.id === d.id).status).toBe('Delivered')
    // persisted in real tables
    const row = db.prep('SELECT status FROM donations WHERE id = ?').get(d.id)
    expect(row.status).toBe('Delivered')
    expect(db.prep('SELECT COUNT(*) AS n FROM rescues WHERE donation_id = ?').get(d.id).n).toBe(1)
  })

  test('forbidden actions are refused and written to the audit log', async () => {
    const { jar } = await signIn('Meera Kapoor', '3333')
    const r = await call('/api/action', { action: { type: 'reset' } }, jar)
    expect(r.status).toBe(403)
    const { jar: cj } = await signIn('Coordinator', '2468')
    const log = (await call('/api/audit', undefined, cj)).body.entries as Array<{ action: string; ok: number; user_name: string }>
    expect(log.some((e) => e.action === 'reset' && e.ok === 0 && e.user_name === 'Meera Kapoor')).toBe(true)
    expect((await call('/api/audit', undefined, jar)).status).toBe(403)
  })

  test('live stream pushes a new state to other signed-in screens', async () => {
    const { jar: watcher } = await signIn('Coordinator', '2468')
    const ctrl = new AbortController()
    const res = await fetch(base + '/api/stream', { headers: { cookie: watcher.cookie! }, signal: ctrl.signal })
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    const read = async () => {
      const { value } = await reader.read()
      buf += dec.decode(value)
    }
    await read() // initial state
    const before = (buf.match(/event: state/g) ?? []).length
    const { jar: runner } = await signIn('Kabir Singh', '3333').catch(() => ({ jar: {} as Jar })) // may be locked from the earlier test
    const { jar: c2 } = await signIn('Coordinator', '2468')
    expect((await call('/api/action', { action: { type: 'toggleShift', runnerId: 3 } }, c2)).body.ok).toBe(true)
    for (let i = 0; i < 5 && (buf.match(/event: state/g) ?? []).length <= before; i++) await read()
    expect((buf.match(/event: state/g) ?? []).length).toBeGreaterThan(before)
    ctrl.abort()
    void runner
  })

  test('donor/NGO sign-up, then TrustCheck: NGO account gets linked to its new NGO record on approval', async () => {
    const jar: Jar = {}
    const up = await call('/api/auth/signup', { role: 'ngo', name: 'Sector 22 Langar', pin: '4321' }, jar)
    expect(up.body.ok).toBe(true)
    const draft = {
      ...core.freshState(NOW).applications![0],
      id: 0,
      role: 'recipient',
      status: 'Not Submitted',
      orgName: 'Sector 22 Langar',
      orgType: 'Community kitchen',
      area: 'Sector 22',
      ngoId: null,
      demo: false,
      checks: [],
      checklist: {},
      history: [],
    }
    const sub = await call('/api/action', { action: { type: 'submitApplication', draft } }, jar)
    expect(sub.body.ok).toBe(true)
    const appId = sub.body.result.application.id
    const { jar: cj } = await signIn('Coordinator', '2468')
    const keys = ['identity', 'registration', 'contact', 'storage', 'capacity']
    for (const key of keys) await call('/api/action', { action: { type: 'toggleTrustItem', id: appId, key } }, cj)
    await call('/api/action', { action: { type: 'addTrustCheck', id: appId, check: { portal: 'Site visit', checkedOn: '2026-11-14', result: 'Match', reference: '', notes: '' } } }, cj)
    const ok = await call('/api/action', { action: { type: 'reviewApplication', id: appId, action: 'approve' } }, cj)
    expect(ok.body.ok).toBe(true)
    const me = (await call('/api/session', undefined, jar)).body.user
    expect(me.ngoId).toBeGreaterThan(0)
    expect(me.applicationId).toBe(appId)
  })

  test('documents: type sniffing, owner-only access', async () => {
    const { jar: donor } = await signIn('The Green Kitchen', '1111')
    const pdf = Buffer.from('%PDF-1.4 test').toString('base64')
    const up = await call('/api/docs', { kind: 'FSSAI licence', name: 'l.pdf', type: 'application/pdf', data: pdf }, donor)
    expect(up.body.ok).toBe(true)
    const fake = await call('/api/docs', { kind: 'x', name: 'x.pdf', type: 'application/pdf', data: Buffer.from('not a pdf').toString('base64') }, donor)
    expect(fake.body.error.code).toBe('CONTENT')
    const own = await fetch(base + up.body.url, { headers: { cookie: donor.cookie! } })
    expect(own.status).toBe(200)
    const { jar: other } = await signIn('Sunday Bakehouse', '1111')
    expect((await fetch(base + up.body.url, { headers: { cookie: other.cookie! } })).status).toBe(403)
  })

  test('data survives a server restart', async () => {
    const { jar: cj } = await signIn('Coordinator', '2468')
    const v1 = (await call('/api/state', undefined, cj)).body
    api.close()
    server.close()
    db.close()
    db = await boot()
    const v2 = (await call('/api/state', undefined, cj)).body // same session cookie still valid
    expect(v2.ok).toBe(true)
    expect(v2.state.donations.length).toBe(v1.state.donations.length)
    expect(v2.version).toBe(v1.version)
  })
})
