// Development: build the shared rules, then run the backend and Vite together
// (works on Windows too). Vite listens on the Wi-Fi as well, so phones can open
// the app at http://<this-computer's-IP>:5173.
import { spawn, spawnSync } from 'node:child_process'

const built = spawnSync('npx vite build -c vite.server.config.ts --logLevel warn', { stdio: 'inherit', shell: true })
if (built.status) process.exit(built.status)

const procs = [
  spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.mjs'], { stdio: 'inherit' }),
  spawn('npx vite --host', { stdio: 'inherit', shell: true }),
]
const stop = () => procs.forEach((p) => p.kill())
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
procs.forEach((p) => p.on('exit', (code) => { if (code) { stop(); process.exit(code) } }))
