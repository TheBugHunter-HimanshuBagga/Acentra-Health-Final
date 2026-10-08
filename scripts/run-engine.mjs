// Usage: node scripts/run-engine.mjs [--test | --lint | --module <python.module> [args...]]
// Default: start the internal engine API on 127.0.0.1:8000 with auto-reload.
import path from 'node:path'
import { ROOT, enginePython, loadEnv, run } from './lib.mjs'
import { existsSync } from 'node:fs'

if (!existsSync(enginePython)) {
  console.error('Engine virtualenv missing. Run: npm run setup')
  process.exit(1)
}
const cwd = path.join(ROOT, 'engine')
const env = loadEnv()
const [mode, ...rest] = process.argv.slice(2)

let args
if (mode === '--test') args = ['-m', 'pytest', ...rest]
else if (mode === '--lint') args = ['-m', 'ruff', 'check', '.', '--exclude', '.venv']
else if (mode === '--module') args = ['-m', ...rest]
else
  args = ['-m', 'uvicorn', 'claimshield.api.main:app', '--host', '127.0.0.1', '--port', '8000', '--reload']

process.exit(await run(enginePython, args, { cwd, env }))
