// SECOND-SERVE AI backend. Zero npm dependencies (Node 20.19+).
//
//   npm run server        -> API only on :8787 (Vite dev proxies /api here)
//   npm run start         -> API + the built app (dist/) on one port
//
// Secrets live in .env next to package.json and never reach the browser.

import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs'
import { extname, join, normalize, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApiHandler } from './app.mjs'
import { openDb } from './db.mjs'
import { createDataApi, DEMO_PINS } from './data.mjs'
import { networkInterfaces } from 'node:os'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Minimal .env reader: KEY=value lines, # comments, optional quotes. Real env wins. */
function loadEnv(file) {
  if (!existsSync(file)) return
  const buf = readFileSync(file)
  // Notepad may save as UTF-16 ("Unicode") or with a BOM: handle both.
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8')
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m || line.trim().startsWith('#')) continue
    const val = m[2].trim().replace(/^(['"])(.*)\1$/, '$2')
    if (process.env[m[1]] === undefined) process.env[m[1]] = val
  }
}
loadEnv(join(root, '.env'))

const cfg = {
  VISION_PROVIDER: process.env.VISION_PROVIDER,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GEMINI_FALLBACK_MODELS: process.env.GEMINI_FALLBACK_MODELS, // comma list, tried if the main model is busy
  GEMINI_VERTEX: process.env.GEMINI_VERTEX, // '1' only for a Vertex AI express key; AI Studio keys (AIza… or AQ.…) need nothing
  GEMINI_BASE_URL: process.env.GEMINI_BASE_URL, // optional: corporate proxy / test harness
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  timeoutMs: Number(process.env.VISION_TIMEOUT_MS) || 25_000, // per attempt; worst case ≈ 25 s + retry 25 s, backups within an 85 s budget
}

// ---- data backend (SQLite + accounts + live updates)
const corePath = join(root, 'server', 'build', 'core.mjs')
if (!existsSync(corePath)) {
  console.error('Missing server/build/core.mjs. Run: npm run build:core')
  process.exit(1)
}
const core = await import(pathToFileURL(corePath).href)
const dbFile = process.env.SS_DB_PATH || join(root, 'data', 'second-serve.db')
const db = openDb(dbFile)
const demo = process.env.SS_DEMO !== '0'
const data = createDataApi({ db, core, demo, coordinatorPin: process.env.SS_COORDINATOR_PIN || DEMO_PINS.coordinator })

const api = createApiHandler(cfg, { requireUser: (req) => data.currentUser(req) })
const serveStatic = process.argv.includes('--static')
const dist = join(root, 'dist')
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  if (path.startsWith('/api/')) {
    Promise.resolve(data.handle(req, res)).then((handled) => {
      if (handled === false) api(req, res)
    })
    return
  }
  if (!serveStatic) {
    res.writeHead(404).end('API server. Run the app with npm run dev.')
    return
  }
  let file = normalize(join(dist, decodeURIComponent(path)))
  if (!file.startsWith(dist)) return void res.writeHead(403).end()
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html')
  if (!existsSync(file)) return void res.writeHead(404).end('Run npm run build first.')
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
})

const port = Number(process.env.PORT) || 8787
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Stop the other SECOND-SERVE server or set PORT in .env.`)
  else console.error(err)
  process.exit(1)
})
server.listen(port, '0.0.0.0', () => {
  const configured = cfg.GEMINI_API_KEY ? 'gemini' : cfg.ANTHROPIC_API_KEY ? 'anthropic' : 'NONE (set GEMINI_API_KEY in .env)'
  const lan = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address)
  console.log(`second-serve backend on http://localhost:${port}  ·  database: ${dbFile}  ·  vision: ${cfg.VISION_PROVIDER || configured}${serveStatic ? '  ·  serving the app' : ''}`)
  if (serveStatic && lan.length) console.log(`On phones (same Wi-Fi): ${lan.map((ip) => `http://${ip}:${port}`).join('  ')}`)
  if (demo) console.log(`Demo PINs: coordinator ${process.env.SS_COORDINATOR_PIN ? '(custom)' : DEMO_PINS.coordinator} · donors ${DEMO_PINS.donor} · NGOs ${DEMO_PINS.ngo} · runners ${DEMO_PINS.runner}`)
})
const shutdown = () => {
  data.close()
  server.close(() => {
    db.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 1500).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
