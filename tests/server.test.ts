// AI backend: security, validation and failure handling (scenario 10).
// The provider's HTTP endpoint is replaced by a stub fetch here; these tests
// check OUR handling of replies, they are not a measurement of model quality.
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, test } from 'vitest'
// @ts-expect-error — plain .mjs server module
import { createApiHandler } from '../server/app.mjs'
// @ts-expect-error — plain .mjs server module
import { normalizeScan } from '../server/scanSchema.mjs'

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 7)])
const dataUrl = (buf: Buffer, mime = 'image/jpeg') => `data:${mime};base64,${buf.toString('base64')}`

const MODEL_REPLY = {
  isFood: true,
  dishName: 'Chole kulche',
  items: ['chole', 'kulche'],
  category: 'Meals',
  dietGuess: 'Veg',
  visualAssessment: 'acceptable',
  concerns: [],
  packaging: 'covered',
  quantity: { inferable: true, servings: 30, amount: null, unit: null, basis: '6 trays' },
  confidence: { overall: 0.86, identification: 0.9, condition: 0.82 },
  reviewNotes: [],
  description: 'Covered trays of chole and kulche.',
}

const geminiOk = (reply: unknown) => async () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }), { status: 200 })

let server: Server | null = null
afterEach(() => server?.close())

async function boot(cfg: Record<string, unknown>, fetchImpl: unknown) {
  server = createServer(createApiHandler({ timeoutMs: 200, ...cfg }, { fetchImpl }))
  await new Promise<void>((r) => server!.listen(0, r))
  const { port } = server!.address() as { port: number }
  return (path: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${port}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

describe('AI backend', () => {
  test('health reports missing configuration without leaking anything', async () => {
    const call = await boot({}, async () => new Response('{}'))
    const body = await (await call('/api/health')).json()
    expect(body.vision.configured).toBe(false)
    expect(body.vision.reason).toMatch(/GEMINI_API_KEY/)
  })

  test('no key → 503 NOT_CONFIGURED (no fake result)', async () => {
    const call = await boot({}, async () => new Response('{}'))
    const res = await call('/api/food-scan', { image: dataUrl(JPEG) })
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('NOT_CONFIGURED')
  })

  test('success → normalized scan with provider metadata; key goes in a header, not the URL', async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null
    const call = await boot({ GEMINI_API_KEY: 'secret-key' }, async (url: string, init: { headers: Record<string, string> }) => {
      seen = { url, headers: init.headers }
      return geminiOk(MODEL_REPLY)()
    })
    const res = await call('/api/food-scan', { image: dataUrl(JPEG) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.scan.dishName).toBe('Chole kulche')
    expect(body.meta).toMatchObject({ provider: 'gemini', inference: 'live' })
    expect(seen!.url).not.toContain('secret-key')
    expect(seen!.headers['x-goog-api-key']).toBe('secret-key')
    expect(JSON.stringify(body)).not.toContain('secret-key')
  })

  test('anthropic provider via forced tool call', async () => {
    const call = await boot({ ANTHROPIC_API_KEY: 'k' }, async () =>
      new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'report_food_scan', input: MODEL_REPLY }] }), { status: 200 }),
    )
    const body = await (await call('/api/food-scan', { image: dataUrl(JPEG) })).json()
    expect(body.meta.provider).toBe('anthropic')
    expect(body.scan.packaging).toBe('covered')
  })

  test('10a · provider timeout → 504 TIMEOUT, retryable', async () => {
    const call = await boot({ GEMINI_API_KEY: 'k' }, (_u: string, init: { signal: AbortSignal }) =>
      new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    )
    const res = await call('/api/food-scan', { image: dataUrl(JPEG) })
    expect(res.status).toBe(504)
    expect((await res.json()).error).toMatchObject({ code: 'TIMEOUT', retryable: true })
  })

  test('10b · provider 500 / bad key / unreachable map to clear codes', async () => {
    for (const [status, code] of [[500, 'PROVIDER_ERROR'], [403, 'PROVIDER_AUTH'], [429, 'PROVIDER_RATE_LIMIT']] as const) {
      const call = await boot({ GEMINI_API_KEY: 'k' }, async () => new Response('boom', { status }))
      expect((await (await call('/api/food-scan', { image: dataUrl(JPEG) })).json()).error.code).toBe(code)
      server!.close()
    }
    const call = await boot({ GEMINI_API_KEY: 'k' }, async () => {
      throw new TypeError('fetch failed')
    })
    expect((await (await call('/api/food-scan', { image: dataUrl(JPEG) })).json()).error.code).toBe('PROVIDER_UNREACHABLE')
  })

  test('10c · model returns prose instead of JSON → INVALID_RESPONSE (not a guessed scan)', async () => {
    const call = await boot({ GEMINI_API_KEY: 'k' }, async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Looks tasty!' }] } }] })))
    expect((await (await call('/api/food-scan', { image: dataUrl(JPEG) })).json()).error.code).toBe('INVALID_RESPONSE')
  })

  test('upload validation: type, signature, size', async () => {
    const call = await boot({ GEMINI_API_KEY: 'k' }, geminiOk(MODEL_REPLY))
    expect((await call('/api/food-scan', { image: dataUrl(JPEG, 'image/gif') })).status).toBe(415)
    expect((await call('/api/food-scan', { image: dataUrl(Buffer.alloc(4000, 1)) })).status).toBe(400) // not really a JPEG
    expect((await call('/api/food-scan', { image: dataUrl(Buffer.from([0xff, 0xd8, 0xff])) })).status).toBe(400) // too small
    expect((await call('/api/food-scan', { image: 'hello' })).status).toBe(400)
    const big = Buffer.concat([JPEG, Buffer.alloc(4.5 * 1024 * 1024)])
    expect((await call('/api/food-scan', { image: dataUrl(big) })).status).toBe(413)
  })

  test('rate limit: 13th scan in a minute → 429', async () => {
    const call = await boot({ GEMINI_API_KEY: 'k' }, geminiOk(MODEL_REPLY))
    let last = 0
    for (let i = 0; i < 13; i++) last = (await call('/api/food-scan', { image: dataUrl(JPEG) })).status
    expect(last).toBe(429)
  })
})

describe('normalizeScan', () => {
  test('garbage fields become conservative defaults, never invented values', () => {
    const s = normalizeScan({ isFood: 'yes', category: 'Pizza', visualAssessment: 'great', confidence: { overall: 7 }, quantity: { inferable: true } })
    expect(s.isFood).toBe(false)
    expect(s.category).toBe('Unknown')
    expect(s.visualAssessment).toBe('uncertain')
    expect(s.confidence.overall).toBe(1)
    expect(s.confidence.identification).toBe(0)
    expect(s.quantity.inferable).toBe(false) // claimed inferable but gave no numbers
  })

  test('"acceptable" with a medium concern is downgraded to "concerns"', () => {
    const s = normalizeScan({ ...MODEL_REPLY, concerns: [{ kind: 'mould', detail: 'spots', severity: 'medium' }] })
    expect(s.visualAssessment).toBe('concerns')
  })
})
