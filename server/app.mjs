// HTTP handler for the SECOND-SERVE AI backend. Exported as a factory so
// tests can call it with a stub fetch and no real network.
//
//   GET  /api/health     -> is a vision provider configured?
//   POST /api/food-scan  -> { image: "data:image/jpeg;base64,..." } -> FoodScan

import { PROVIDERS, resolveProvider } from './providers.mjs'
import { ScanError, normalizeScan } from './scanSchema.mjs'

export const LIMITS = {
  maxBodyBytes: 6 * 1024 * 1024, // JSON envelope incl. base64 overhead
  maxImageBytes: 4 * 1024 * 1024, // decoded image
  minImageBytes: 2 * 1024, // smaller than this is not a usable photo
  ratePerMinute: 12, // per client IP
}

const MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** Check the real file signature, not just the declared type. */
export function sniffImage(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

/** Validate a data URL; returns { base64, mimeType, bytes } or throws ScanError(400). */
export function parseImage(dataUrl) {
  if (typeof dataUrl !== 'string') throw new ScanError('BAD_IMAGE', 'Send the photo as a data URL in "image"', 400)
  const m = dataUrl.match(/^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/)
  if (!m) throw new ScanError('BAD_IMAGE', 'Image must be a base64 data URL', 400)
  const declared = m[1].toLowerCase()
  if (!MIME.has(declared)) throw new ScanError('UNSUPPORTED_TYPE', 'Use a JPEG, PNG or WebP photo', 415)
  const base64 = m[2].replace(/\s/g, '')
  const buf = Buffer.from(base64, 'base64')
  if (buf.length > LIMITS.maxImageBytes) throw new ScanError('TOO_LARGE', 'Photo is larger than 4 MB', 413)
  if (buf.length < LIMITS.minImageBytes) throw new ScanError('BAD_IMAGE', 'Photo is too small to analyse', 400)
  const real = sniffImage(buf)
  if (!real) throw new ScanError('BAD_IMAGE', 'File is not a valid image', 400)
  if (real !== declared) throw new ScanError('BAD_IMAGE', 'Image content does not match its declared type', 400)
  return { base64, mimeType: real, bytes: buf.length }
}

function send(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(json)
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0
    let tooBig = false
    const chunks = []
    // Keep draining an oversized body (without storing it) so the client
    // receives a clean 413 instead of a reset connection.
    req.on('data', (c) => {
      size += c.length
      if (size > limit * 3) req.destroy() // abusive upload: just drop it
      else if (size > limit) tooBig = true
      else chunks.push(c)
    })
    req.on('end', () =>
      tooBig ? reject(new ScanError('TOO_LARGE', 'Photo is larger than 4 MB', 413)) : resolve(Buffer.concat(chunks).toString('utf8')),
    )
    req.on('error', reject)
  })
}

const RETRYABLE = new Set(['TIMEOUT', 'PROVIDER_UNREACHABLE', 'PROVIDER_ERROR', 'PROVIDER_RATE_LIMIT', 'INVALID_RESPONSE', 'RATE_LIMITED'])

export function createApiHandler(cfg, { fetchImpl = fetch, clock = Date.now } = {}) {
  const hits = new Map() // ip -> timestamps within the last minute

  function rateLimited(ip) {
    const now = clock()
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
    recent.push(now)
    hits.set(ip, recent)
    if (hits.size > 5000) hits.clear() // crude memory cap for a demo server
    return recent.length > LIMITS.ratePerMinute
  }

  return async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://local')
    try {
      if (url.pathname === '/api/health' && req.method === 'GET') {
        const { provider, reason } = resolveProvider(cfg)
        return send(res, 200, {
          ok: true,
          vision: {
            configured: provider !== null,
            provider,
            model: provider === 'gemini' ? cfg.GEMINI_MODEL || 'gemini-2.5-flash' : provider === 'anthropic' ? cfg.ANTHROPIC_MODEL || 'claude-haiku-5-5' : null,
            reason,
          },
        })
      }

      if (url.pathname === '/api/food-scan') {
        if (req.method !== 'POST') throw new ScanError('METHOD', 'Use POST', 405)
        if (!String(req.headers['content-type'] ?? '').includes('application/json'))
          throw new ScanError('BAD_REQUEST', 'Content-Type must be application/json', 415)
        const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'local').split(',')[0].trim()
        if (rateLimited(ip)) throw new ScanError('RATE_LIMITED', 'Too many scans — wait a minute and try again', 429)

        const { provider, reason } = resolveProvider(cfg)
        if (!provider) throw new ScanError('NOT_CONFIGURED', reason, 503)

        let body
        try {
          body = JSON.parse(await readBody(req, LIMITS.maxBodyBytes))
        } catch (e) {
          if (e instanceof ScanError) throw e
          throw new ScanError('BAD_REQUEST', 'Body must be JSON', 400)
        }
        const image = parseImage(body?.image)

        const started = clock()
        const { raw, model } = await PROVIDERS[provider].scan(image, cfg, fetchImpl)
        const scan = normalizeScan(raw)
        return send(res, 200, {
          ok: true,
          scan,
          meta: { provider, model, latencyMs: clock() - started, imageBytes: image.bytes, inference: 'live', at: new Date(clock()).toISOString() },
        })
      }

      return send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Unknown API route', retryable: false } })
    } catch (err) {
      const e = err instanceof ScanError ? err : new ScanError('INTERNAL', 'Unexpected server error', 500)
      if (!(err instanceof ScanError)) console.error('[food-scan]', err)
      return send(res, e.status, { ok: false, error: { code: e.code, message: e.message, retryable: RETRYABLE.has(e.code) } })
    }
  }
}
