// Engine 1 client: shrink the photo in the browser, send it to OUR backend
// (/api/food-scan), and return the model's structured reading.
//
// No API key ever lives in this file or anywhere in the frontend bundle.
// There is no fallback that invents a result: if the backend or the model
// fails, the caller gets an error and the listing is routed to manual review.

import type { Category } from '../types'

export type ConcernKind =
  | 'spoilage'
  | 'mould'
  | 'discoloration'
  | 'contamination'
  | 'pests'
  | 'foreign_object'
  | 'packaging'
  | 'other'

export type FoodScan = {
  isFood: boolean
  dishName: string
  items: string[]
  category: Category | 'Unknown'
  dietGuess: 'Veg' | 'Non-veg' | 'Unknown'
  visualAssessment: 'acceptable' | 'concerns' | 'uncertain'
  concerns: Array<{ kind: ConcernKind; detail: string; severity: 'low' | 'medium' | 'high' }>
  packaging: 'sealed' | 'covered' | 'open' | 'unclear'
  quantity: {
    inferable: boolean
    servings: number | null
    amount: number | null
    unit: 'servings' | 'boxes' | 'items' | 'kg' | null
    basis: string
  }
  confidence: { overall: number; identification: number; condition: number }
  reviewNotes: string[]
  description: string
}

export type ScanMeta = {
  provider: string
  model: string
  latencyMs: number
  imageBytes: number
  inference: 'live'
  at: string
}

export type ScanSuccess = { ok: true; scan: FoodScan; meta: ScanMeta }
export type ScanFailure = { ok: false; error: { code: string; message: string; retryable: boolean } }
export type ScanResponse = ScanSuccess | ScanFailure

export type VisionHealth = { configured: boolean; provider: string | null; model: string | null; reason: string | null }

export const UPLOAD = {
  maxInputBytes: 15 * 1024 * 1024, // what we accept from the camera roll before shrinking
  types: ['image/jpeg', 'image/png', 'image/webp'],
  maxSide: 1024, // long edge sent to the model
  thumbSide: 160, // square thumbnail kept with the listing
  clientTimeoutMs: 35_000,
}

/** Validate before doing any work. Returns an error message or null. */
export function checkFile(file: File): string | null {
  if (!UPLOAD.types.includes(file.type)) return 'Use a JPEG, PNG or WebP photo (HEIC isn’t supported — set your camera to “Most compatible”).'
  if (file.size > UPLOAD.maxInputBytes) return 'That photo is over 15 MB. Try a smaller one.'
  if (file.size < 2048) return 'That file is too small to be a usable photo.'
  return null
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that image.'))
    }
    img.src = url
  })
}

/**
 * Re-encode the photo as JPEG. This shrinks the upload (fewer tokens, faster,
 * cheaper), and drops EXIF metadata such as GPS location before it leaves
 * the device.
 */
export async function preparePhoto(file: File): Promise<{ dataUrl: string; thumb: string; width: number; height: number }> {
  const img = await loadImage(file)
  const scale = Math.min(1, UPLOAD.maxSide / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser can’t process images.')
  ctx.drawImage(img, 0, 0, w, h)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.84)

  const side = Math.min(img.width, img.height)
  const t = document.createElement('canvas')
  t.width = UPLOAD.thumbSide
  t.height = UPLOAD.thumbSide
  t.getContext('2d')?.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, UPLOAD.thumbSide, UPLOAD.thumbSide)
  return { dataUrl, thumb: t.toDataURL('image/jpeg', 0.7), width: w, height: h }
}

const FRIENDLY: Record<string, string> = {
  NOT_CONFIGURED: 'The AI scanner isn’t configured on the server yet (no API key).',
  TIMEOUT: 'The AI model took too long to answer.',
  PROVIDER_UNREACHABLE: 'The server couldn’t reach the AI provider.',
  PROVIDER_AUTH: 'The server’s AI key was rejected by the provider.',
  PROVIDER_RATE_LIMIT: 'The AI provider is rate-limiting us. Try again shortly.',
  RATE_LIMITED: 'Too many scans in a minute. Try again shortly.',
  PROVIDER_ERROR: 'The AI provider had an error on its side.',
  INVALID_RESPONSE: 'The AI returned something we couldn’t read.',
  NETWORK: 'Couldn’t reach the SECOND-SERVE AI backend. Is it running (npm run dev)?',
}

export function friendlyError(e: ScanFailure['error']) {
  return FRIENDLY[e.code] ?? e.message
}

export async function scanFood(dataUrl: string, signal?: AbortSignal): Promise<ScanResponse> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), UPLOAD.clientTimeoutMs)
  signal?.addEventListener('abort', () => ctrl.abort())
  try {
    const res = await fetch('/api/food-scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
      signal: ctrl.signal,
    })
    const body = (await res.json().catch(() => null)) as ScanResponse | null
    if (body && typeof body === 'object' && 'ok' in body) return body
    return { ok: false, error: { code: 'NETWORK', message: `Backend answered HTTP ${res.status}`, retryable: true } }
  } catch (err) {
    if (signal?.aborted) return { ok: false, error: { code: 'CANCELLED', message: 'Scan cancelled', retryable: true } }
    const timedOut = (err as Error)?.name === 'AbortError'
    return {
      ok: false,
      error: timedOut
        ? { code: 'TIMEOUT', message: 'Scan timed out', retryable: true }
        : { code: 'NETWORK', message: 'Network error', retryable: true },
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function visionHealth(): Promise<VisionHealth | null> {
  try {
    const res = await fetch('/api/health')
    if (!res.ok) return null
    const body = (await res.json()) as { vision?: VisionHealth }
    return body.vision ?? null
  } catch {
    return null
  }
}
