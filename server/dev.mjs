// Runs the AI backend and the Vite dev server together (works on Windows too).
import { spawn } from 'node:child_process'

const procs = [
  spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit' }),
  // One command string + shell: works with npx on Windows without the
  // "args with shell" deprecation warning.
  spawn('npx vite', { stdio: 'inherit', shell: true }),
]
const stop = () => procs.forEach((p) => p.kill())
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
procs.forEach((p) => p.on('exit', (code) => { if (code) { stop(); process.exit(code) } }))
