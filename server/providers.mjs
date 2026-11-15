// Vision providers for Engine 1. Each adapter takes { images: [{ base64, mimeType }] }
// (1–4 photos of ONE donation; a single { base64, mimeType } is also accepted),
// calls a real vision model and returns the model's raw JSON object.
// normalizeScan() (scanSchema.mjs) then validates it.
//
// To add a provider: write one function with the same signature and add it
// to PROVIDERS. Nothing else in the app needs to change.

import { SCAN_JSON_SCHEMA, SCAN_PROMPT, ScanError, extractJson } from './scanSchema.mjs'

async function postJson(url, headers, body, timeoutMs, fetchImpl) {
  const ctrl = new AbortController()
  let timer
  // The limit covers the WHOLE exchange (headers + body). Some models send
  // headers at once and then think for a long time before the body arrives.
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort()
      reject(new ScanError('TIMEOUT', `Vision model did not answer within ${Math.round(timeoutMs / 1000)} s`, 504))
    }, timeoutMs)
  })
  let res
  let text
  try {
    const exchange = (async () => {
      const r = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      return { r, t: await r.text() }
    })()
    exchange.catch(() => {}) // the deadline may win; avoid an unhandled rejection
    ;({ r: res, t: text } = await Promise.race([exchange, deadline]))
  } catch (err) {
    if (err instanceof ScanError) throw err
    if (err && err.name === 'AbortError') throw new ScanError('TIMEOUT', `Vision model did not answer within ${Math.round(timeoutMs / 1000)} s`, 504)
    throw new ScanError('PROVIDER_UNREACHABLE', 'Could not reach the vision model provider', 502)
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    const badKey = /API_KEY_INVALID|API key not valid|UNAUTHENTICATED|PERMISSION_DENIED/i.test(text)
    const code =
      res.status === 401 || res.status === 403 || badKey
        ? 'PROVIDER_AUTH'
        : res.status === 429
          ? 'PROVIDER_RATE_LIMIT'
          : res.status === 503 || /UNAVAILABLE|overloaded|high demand/i.test(text)
            ? 'PROVIDER_BUSY'
            : 'PROVIDER_ERROR'
    // Log the provider's detail server-side only; never echo keys or raw bodies to the browser.
    console.warn(`[food-scan] provider HTTP ${res.status}: ${text.slice(0, 300)}`)
    const err = new ScanError(code, `Vision provider returned HTTP ${res.status}`, res.status === 429 ? 429 : 502)
    err.httpStatus = res.status
    throw err
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new ScanError('INVALID_RESPONSE', 'Provider response was not JSON')
  }
}

// ---------------------------------------------------------------- Gemini
// Google AI Studio key (free tier available). Structured output via responseJsonSchema.
/** Normalise input to a list of photos. */
export function photosOf(input) {
  if (Array.isArray(input?.images)) return input.images
  return [{ base64: input.base64, mimeType: input.mimeType }]
}

const photoLead = (n) =>
  n > 1 ? `The ${n} photos below all show ONE surplus-food donation from different angles. Treat them together as evidence for that single donation.` : 'The photo below shows one surplus-food donation.'

export async function geminiScan(input, cfg, fetchImpl = fetch) {
  const photos = photosOf(input)
  const model = cfg.GEMINI_MODEL || 'gemini-2.5-flash'
  // AI Studio keys (both the old AIza… and the new AQ.Ab… format) use the
  // Gemini API. Set GEMINI_VERTEX=1 only for a Vertex AI express-mode key.
  const vertex = cfg.GEMINI_VERTEX === '1'
  const base = (cfg.GEMINI_BASE_URL || (vertex ? 'https://aiplatform.googleapis.com' : 'https://generativelanguage.googleapis.com')).replace(/\/$/, '')
  const url = vertex
    ? `${base}/v1/publishers/google/models/${encodeURIComponent(model)}:generateContent`
    : `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`
  // 2.5 Flash models "think" before answering by default, which can take
  // 20 s+ on a photo. Describing a photo doesn't need it, so turn it off.
  // Gemini 3 models take a thinking level instead; "low" keeps photo scans quick.
  const fastThinking = /2\.5-flash/.test(model)
    ? { thinkingConfig: { thinkingBudget: 0 } }
    : /gemini-3/.test(model)
      ? { thinkingConfig: { thinkingLevel: 'low' } }
      : {}
  const request = (withSchema) => ({
    contents: [
      {
        role: 'user',
        parts: [
          { text: photoLead(photos.length) },
          ...photos.map((p) => ({ inline_data: { mime_type: p.mimeType, data: p.base64 } })),
          { text: SCAN_PROMPT },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      ...(withSchema ? { responseJsonSchema: SCAN_JSON_SCHEMA, ...fastThinking } : {}),
    },
  })
  let data
  try {
    data = await postJson(url, { 'x-goog-api-key': cfg.GEMINI_API_KEY }, request(true), cfg.timeoutMs, fetchImpl)
  } catch (err) {
    // HTTP 400 usually means this model/API version rejected the schema.
    // Retry once in plain JSON mode; the prompt still lists every field and
    // normalizeScan() still validates the reply, so nothing is guessed.
    if (!(err instanceof ScanError) || err.httpStatus !== 400 || err.code === 'PROVIDER_AUTH') throw err
    console.warn('[food-scan] Gemini rejected the schema; retrying in plain JSON mode')
    data = await postJson(url, { 'x-goog-api-key': cfg.GEMINI_API_KEY }, request(false), cfg.timeoutMs, fetchImpl)
  }
  const cand = data?.candidates?.[0]
  if (!cand) {
    const blocked = data?.promptFeedback?.blockReason
    throw new ScanError('INVALID_RESPONSE', blocked ? `Image was blocked by the provider (${blocked})` : 'Model returned no candidates')
  }
  const text = (cand.content?.parts ?? []).map((p) => p.text ?? '').join('')
  return { raw: extractJson(text), model }
}

// ---------------------------------------------------------------- Claude
// Anthropic Messages API. A forced tool call gives schema-shaped JSON.
export async function anthropicScan(input, cfg, fetchImpl = fetch) {
  const photos = photosOf(input)
  const model = cfg.ANTHROPIC_MODEL || 'claude-haiku-5-5'
  const data = await postJson(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': cfg.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    {
      model,
      max_tokens: 1200,
      temperature: 0.1,
      tools: [{ name: 'report_food_scan', description: 'Report the visual food screening result.', input_schema: SCAN_JSON_SCHEMA }],
      tool_choice: { type: 'tool', name: 'report_food_scan' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: photoLead(photos.length) },
            ...photos.map((p) => ({ type: 'image', source: { type: 'base64', media_type: p.mimeType, data: p.base64 } })),
            { type: 'text', text: SCAN_PROMPT },
          ],
        },
      ],
    },
    cfg.timeoutMs,
    fetchImpl,
  )
  const tool = (data?.content ?? []).find((b) => b.type === 'tool_use')
  if (tool && tool.input && typeof tool.input === 'object') return { raw: tool.input, model }
  const text = (data?.content ?? []).map((b) => b.text ?? '').join('')
  return { raw: extractJson(text), model }
}

// Busy/slow models are common on the free tier. Try the chosen model, retry
// it once after a short pause if Google says it's overloaded, then fall back
// to the other models listed in GEMINI_FALLBACK_MODELS. Every answer still
// comes from a real model; nothing is substituted.
const SWITCH_ON = new Set(['PROVIDER_BUSY', 'PROVIDER_RATE_LIMIT', 'TIMEOUT', 'PROVIDER_ERROR', 'INVALID_RESPONSE', 'PROVIDER_UNREACHABLE'])
export async function geminiWithFallback(image, cfg, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const primary = cfg.GEMINI_MODEL || 'gemini-2.5-flash'
  const fallbacks = String(cfg.GEMINI_FALLBACK_MODELS || '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m && m !== primary)
  const plan = [primary, primary, ...fallbacks].slice(0, 5)
  const started = Date.now()
  const budget = cfg.totalBudgetMs ?? 85_000
  let last
  for (let i = 0; i < plan.length; i++) {
    const left = budget - (Date.now() - started)
    if (left < 5_000) break
    const model = plan[i]
    const retrySame = i === 1
    // Retry the same model once for temporary problems (busy, rate limit, a
    // slow answer, or a garbled reply), then move on to the backups.
    const temporary = new Set(['PROVIDER_BUSY', 'PROVIDER_RATE_LIMIT', 'TIMEOUT', 'INVALID_RESPONSE', 'PROVIDER_UNREACHABLE'])
    if (retrySame && !(last && temporary.has(last.code))) continue
    if (retrySame) await sleep(last?.code === 'PROVIDER_RATE_LIMIT' ? 3000 : 1500)
    try {
      const t0 = Date.now()
      const out = await geminiScan(image, { ...cfg, GEMINI_MODEL: model, timeoutMs: Math.min(cfg.timeoutMs, left) }, fetchImpl)
      console.log(`[food-scan] ok · ${model} · ${((Date.now() - t0) / 1000).toFixed(1)} s${i > 0 ? ` (attempt ${i + 1})` : ''}`)
      return out
    } catch (err) {
      last = err
      if (!(err instanceof ScanError) || !SWITCH_ON.has(err.code)) throw err
      console.warn(`[food-scan] ${model}: ${err.code}${i + 1 < plan.length ? ', trying next option' : ''}`)
    }
  }
  if (last && last.code === 'PROVIDER_BUSY')
    throw new ScanError('PROVIDER_BUSY', 'Google’s AI is overloaded right now. Wait a few seconds and press Try again.', 503)
  throw last ?? new ScanError('PROVIDER_ERROR', 'No vision model answered', 502)
}

export const PROVIDERS = {
  gemini: { scan: geminiWithFallback, keyVar: 'GEMINI_API_KEY' },
  anthropic: { scan: anthropicScan, keyVar: 'ANTHROPIC_API_KEY' },
}

/** Which provider is usable with this config, or null (with the reason). */
export function resolveProvider(cfg) {
  const wanted = (cfg.VISION_PROVIDER || '').toLowerCase()
  if (wanted) {
    const p = PROVIDERS[wanted]
    if (!p) return { provider: null, reason: `VISION_PROVIDER="${wanted}" is not supported (use gemini or anthropic)` }
    if (!cfg[p.keyVar]) return { provider: null, reason: `VISION_PROVIDER=${wanted} but ${p.keyVar} is not set` }
    return { provider: wanted, reason: null }
  }
  for (const [name, p] of Object.entries(PROVIDERS)) if (cfg[p.keyVar]) return { provider: name, reason: null }
  return { provider: null, reason: 'No vision API key configured. Set GEMINI_API_KEY (or ANTHROPIC_API_KEY) in .env' }
}
