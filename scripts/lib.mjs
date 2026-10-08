// Shared helpers for the dev scripts. Cross-platform (Windows, macOS, Linux). No dependencies.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'

/** Load .env (simple KEY=VALUE lines) over process.env. Resolve APP_DB_PATH against the repo root. */
export function loadEnv() {
  const env = { ...process.env }
  const file = path.join(ROOT, '.env')
  if (existsSync(file)) {
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const i = line.indexOf('=')
      if (i < 0) continue
      const key = line.slice(0, i).trim()
      const val = line.slice(i + 1).split(/\s+#/)[0].trim().replace(/^["']|["']$/g, '')
      if (!(key in env) || env[key] === '') env[key] = val
    }
  }
  const db = env.APP_DB_PATH || path.join('data', 'app.db')
  env.APP_DB_PATH = path.isAbsolute(db) ? db : path.join(ROOT, db)
  return env
}

export const enginePython = isWin
  ? path.join(ROOT, 'engine', '.venv', 'Scripts', 'python.exe')
  : path.join(ROOT, 'engine', '.venv', 'bin', 'python')

/** Run a command, inheriting stdio. Resolves with the exit code. */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: isWin && /^(mvn|npm|npx)$/i.test(cmd), // .cmd shims need a shell on Windows
      cwd: ROOT,
      ...opts,
    })
    child.on('exit', (code) => resolve(code ?? 1))
    child.on('error', (err) => {
      console.error(`failed to start ${cmd}:`, err.message)
      resolve(1)
    })
  })
}
