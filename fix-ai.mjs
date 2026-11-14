// One-command setup for the SECOND-SERVE AI scanner.
//
//   node fix-ai.mjs
//
// 1. Reads (or asks for) your Gemini API key and keeps it in .env.
// 2. Sets up up to 4 sample photos in public/samples/ for the scan screen.
// 3. Asks Google which models your key can use, tries them with the SAME
//    request the app sends (real photo, real schema), and picks the first
//    one that answers correctly and quickly.
// 4. Writes .env. Then run: npm run dev
//
// Nothing here fakes AI output: if no model answers, it says so and the app
// keeps working through "Continue without AI" (manual review).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline/promises'
import { geminiScan } from './server/providers.mjs'
import { normalizeScan } from './server/scanSchema.mjs'

const ok = (m) => console.log(`  \x1b[32m✔\x1b[0m ${m}`)
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`)
const bad = (m) => console.log(`  \x1b[31m✖\x1b[0m ${m}`)
const step = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`)

// ---------------------------------------------------------------- .env
function readEnv() {
  const env = {}
  if (!existsSync('.env')) return env
  const buf = readFileSync('.env')
  // Notepad may save as UTF-16 ("Unicode") or with a BOM: handle both.
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8')
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return env
}
function writeEnv(env) {
  const lines = Object.entries(env).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${v}`)
  writeFileSync('.env', lines.join('\n') + '\n', 'ascii')
}

step('1/4  API key')
const env = readEnv()
let key = (env.GEMINI_API_KEY || '').trim()
if (!key || key.includes('PASTE') || key.includes('YOUR')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  key = (await rl.question('  Paste your Gemini API key (from https://aistudio.google.com/app/apikey) and press Enter:\n  > ')).trim()
  rl.close()
}
key = key.replace(/^GEMINI_API_KEY=/, '').replace(/["'\s]/g, '')
if (!key) {
  bad('No key given. Run node fix-ai.mjs again when you have one.')
  process.exit(1)
}
ok(`Key found (starts ${key.slice(0, 6)}…, ${key.length} characters)`)
const base = (process.env.GEMINI_BASE_URL || env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '')

// ---------------------------------------------------------------- samples
step('2/4  Sample photos for the scan screen')
const IMG = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const samplesDir = join('public', 'samples')
mkdirSync(samplesDir, { recursive: true })
const isImg = (f) => IMG.has(extname(f).toLowerCase())
let sampleFiles = readdirSync(samplesDir).filter(isImg)
if (sampleFiles.length === 0) {
  // Nothing there yet: borrow your most recent photos (copies, originals untouched).
  const dirs = [join(homedir(), 'Downloads'), join(homedir(), 'Pictures'), join(homedir(), 'Desktop'), '.']
  const found = []
  for (const d of dirs) {
    if (!existsSync(d)) continue
    for (const f of readdirSync(d)) {
      const full = join(d, f)
      try {
        const st = statSync(full)
        if (st.isFile() && isImg(f) && st.size > 20_000 && st.size < 15_000_000) found.push({ full, f, t: st.mtimeMs })
      } catch {
        /* unreadable file: skip */
      }
    }
  }
  found.sort((a, b) => b.t - a.t)
  const seen = new Set()
  for (const { full, f } of found) {
    if (sampleFiles.length >= 4) break
    const size = statSync(full).size
    if (seen.has(size)) continue // same photo saved twice
    seen.add(size)
    const name = `sample-${sampleFiles.length + 1}${extname(f).toLowerCase().replace('.jpeg', '.jpg')}`
    copyFileSync(full, join(samplesDir, name))
    sampleFiles.push(name)
    ok(`${name}  ←  ${full}`)
  }
} else {
  ok(`Using ${sampleFiles.length} photo(s) already in public/samples`)
}
sampleFiles = sampleFiles.slice(0, 4)
writeFileSync(join(samplesDir, 'manifest.json'), JSON.stringify(sampleFiles.map((file, i) => ({ file, label: `Sample photo ${i + 1}` })), null, 2))
if (sampleFiles.length === 0) warn('No photos found. Put 1–4 food photos (jpg/png) in public\\samples and run this again.')
else warn('Wrong photos? Delete them from public\\samples, add your own food photos there, and run this again.')

// Test photo for the model check: first sample, else a tiny built-in image.
const testPhoto = sampleFiles[0] ? readFileSync(join(samplesDir, sampleFiles[0])) : null
const testMime = sampleFiles[0] ? ({ '.png': 'image/png', '.webp': 'image/webp' }[extname(sampleFiles[0])] ?? 'image/jpeg') : null

// ---------------------------------------------------------------- models
step('3/4  Finding a model your key can use')
let names = []
try {
  const res = await fetch(`${base}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    bad(`Google rejected the key: HTTP ${res.status} ${body.error?.message ?? ''}`)
    if (res.status === 400 || res.status === 401 || res.status === 403)
      warn('Create a new key at https://aistudio.google.com/app/apikey, then run node fix-ai.mjs again and paste it.')
    writeEnv({ ...env, GEMINI_API_KEY: key })
    process.exit(1)
  }
  names = (body.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
} catch (e) {
  bad(`Couldn't reach Google (${e.cause?.code ?? e.name}). Check your internet, or try a phone hotspot.`)
  process.exit(1)
}

const SKIP = /image|tts|audio|live|embed|vision-|thinking|native|computer|robotics|gemma|aqa|learnlm|nano|veo|imagen/i
const version = (n) => Number((n.match(/(\d+(?:\.\d+)?)/) ?? [0, 0])[1])
const candidates = names
  .filter((n) => /flash/i.test(n) && !SKIP.test(n))
  .sort((a, b) => {
    // Fast first: lite models answer a photo in a few seconds; previews last.
    const score = (n) => (/preview|exp/i.test(n) ? 2 : 0) + (/lite/i.test(n) ? 0 : 1)
    return score(a) - score(b) || version(b) - version(a) || a.length - b.length
  })
  .slice(0, 8)
if (candidates.length === 0) {
  bad(`Your key lists no usable Flash models. Models it has: ${names.slice(0, 15).join(', ') || 'none'}`)
  process.exit(1)
}
console.log(`  Trying: ${candidates.join(', ')}`)

let chosen = null
for (const model of candidates) {
  const t = Date.now()
  try {
    if (testPhoto) {
      // Same request shape as the app: 2 photos of one donation, analysed together.
      const second = sampleFiles[1] ? readFileSync(join(samplesDir, sampleFiles[1])) : testPhoto
      const images = [
        { base64: testPhoto.toString('base64'), mimeType: testMime },
        { base64: second.toString('base64'), mimeType: ({ '.png': 'image/png', '.webp': 'image/webp' }[extname(sampleFiles[1] ?? sampleFiles[0])] ?? 'image/jpeg') },
      ]
      const { raw } = await geminiScan({ images }, { GEMINI_API_KEY: key, GEMINI_MODEL: model, GEMINI_BASE_URL: base, timeoutMs: 30_000 })
      const scan = normalizeScan(raw)
      const secs = (Date.now() - t) / 1000
      ok(`${model} answered in ${secs.toFixed(1)} s → "${scan.dishName || 'unnamed'}" (${scan.category}, ${Math.round(scan.confidence.overall * 100)}% sure)`)
    } else {
      const res = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with OK' }] }] }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      ok(`${model} answered in ${((Date.now() - t) / 1000).toFixed(1)} s (text check only: no sample photo)`)
    }
    chosen = model
    break
  } catch (e) {
    bad(`${model}: ${e.message ?? e} (${((Date.now() - t) / 1000).toFixed(1)} s)`)
  }
}

// ---------------------------------------------------------------- write
step('4/4  Saving settings')
const next = { ...env, GEMINI_API_KEY: key, VISION_TIMEOUT_MS: '45000' }
delete next.VISION_PROVIDER
delete next.GEMINI_VERTEX
if (chosen) {
  next.GEMINI_MODEL = chosen
  // Backups for when Google says the main model is busy (503).
  next.GEMINI_FALLBACK_MODELS = candidates.filter((m) => m !== chosen).slice(0, 3).join(',')
  if (next.GEMINI_FALLBACK_MODELS) ok(`Backup models if it's busy: ${next.GEMINI_FALLBACK_MODELS}`)
}
writeEnv(next)
ok('.env saved')

if (chosen) {
  console.log(`\n\x1b[32m\x1b[1mAll set.\x1b[0m The AI scanner will use ${chosen}.`)
  console.log('Now run:  npm run dev   then open http://localhost:5173 and press Ctrl+F5.\n')
} else {
  console.log('\n\x1b[31m\x1b[1mNo model answered.\x1b[0m See the reasons above.')
  console.log('Common fixes: a new key from https://aistudio.google.com/app/apikey, or a phone hotspot.')
  console.log('The app still works: Scan → "Continue without AI" → approve in the rescue file.\n')
  process.exit(1)
}
