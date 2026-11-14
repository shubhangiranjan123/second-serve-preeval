// Vision providers for Engine 1. Each adapter takes { base64, mimeType },
// calls a real vision model and returns the model's raw JSON object.
// normalizeScan() (scanSchema.mjs) then validates it.
//
// To add a provider: write one function with the same signature and add it
// to PROVIDERS. Nothing else in the app needs to change.

import { SCAN_JSON_SCHEMA, SCAN_PROMPT, ScanError, extractJson } from './scanSchema.mjs'

async function postJson(url, headers, body, timeoutMs, fetchImpl) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch (err) {
    if (err && err.name === 'AbortError') throw new ScanError('TIMEOUT', `Vision model did not answer within ${Math.round(timeoutMs / 1000)} s`, 504)
    throw new ScanError('PROVIDER_UNREACHABLE', 'Could not reach the vision model provider', 502)
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  if (!res.ok) {
    const code = res.status === 401 || res.status === 403 ? 'PROVIDER_AUTH' : res.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_ERROR'
    // Log the provider's detail server-side only; never echo keys or raw bodies to the browser.
    console.warn(`[food-scan] provider HTTP ${res.status}: ${text.slice(0, 300)}`)
    throw new ScanError(code, `Vision provider returned HTTP ${res.status}`, res.status === 429 ? 429 : 502)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new ScanError('INVALID_RESPONSE', 'Provider response was not JSON')
  }
}

// ---------------------------------------------------------------- Gemini
// Google AI Studio key (free tier available). Structured output via responseJsonSchema.
export async function geminiScan({ base64, mimeType }, cfg, fetchImpl = fetch) {
  const model = cfg.GEMINI_MODEL || 'gemini-2.5-flash'
  const base = (cfg.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '')
  const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const data = await postJson(
    url,
    { 'x-goog-api-key': cfg.GEMINI_API_KEY },
    {
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mimeType, data: base64 } }, { text: SCAN_PROMPT }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseJsonSchema: SCAN_JSON_SCHEMA,
      },
    },
    cfg.timeoutMs,
    fetchImpl,
  )
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
export async function anthropicScan({ base64, mimeType }, cfg, fetchImpl = fetch) {
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
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
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

export const PROVIDERS = {
  gemini: { scan: geminiScan, keyVar: 'GEMINI_API_KEY' },
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
