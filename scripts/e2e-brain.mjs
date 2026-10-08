// Real-browser end-to-end check of the Second Brain loop with the REAL engine API.
//   1. engine pipeline generates + publishes a FRESH database (claims, ground truth, app.db)
//   2. engine API (8000), gateway jar (8080, ENGINE_URL) and Vite (5173) start
//   3. Playwright drives: close UNFOUNDED -> co-sign -> exception -> simulate -> approve -> re-run -> diff
// Must run from a normal terminal (sandboxed shells cannot bind ports). Run: npm run e2e:brain
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { ROOT, enginePython, loadEnv, run } from './lib.mjs'

const isWin = process.platform === 'win32'
const dir = path.join(ROOT, 'data', 'e2e-brain')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const env0 = { ...loadEnv(), DATA_DIR: dir, APP_DB_PATH: path.join(dir, 'app.db'), DEMO_MODE: 'true',
  ENGINE_URL: 'http://127.0.0.1:8000', ENGINE_TOKEN: 'dev-engine-token' }

console.log('== 1/4 engine pipeline: fresh databases')
let code = await run(enginePython, ['-m', 'claimshield.pipeline'], { cwd: path.join(ROOT, 'engine'), env: env0 })
if (code) process.exit(code)

console.log('== 2/4 gateway: build jar')
code = await run('mvn', ['-q', '-f', 'gateway/pom.xml', '-DskipTests', 'package'], { env: env0 })
if (code) process.exit(code)

const children = []
function start(name, cmd, args, env, opts = {}) {
  const c = spawn(cmd, args, { cwd: opts.cwd ?? ROOT, env, shell: !!opts.shell, stdio: ['ignore', 'pipe', 'pipe'] })
  const tag = (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`))
  c.stdout.on('data', tag)
  c.stderr.on('data', tag)
  children.push(c)
}
function stopAll() {
  for (const c of children) {
    if (!c.pid || c.exitCode !== null) continue
    if (isWin) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' })
    else c.kill('SIGTERM')
  }
}
async function waitFor(url, label, ms = 120_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).ok) return
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${label} did not become ready at ${url}`)
}

process.on('SIGINT', () => { stopAll(); process.exit(130) })
let result = 1
try {
  console.log('== 3/4 start engine (8000), gateway (8080) and web (5173)')
  const channel = process.env.E2E_CHANNEL ?? (isWin ? 'msedge' : '')
  const env = { ...env0, E2E_CHANNEL: channel === 'chromium' ? '' : channel }
  start('engine', enginePython, ['-m', 'uvicorn', 'claimshield.api.main:app', '--host', '127.0.0.1', '--port', '8000'], env,
    { cwd: path.join(ROOT, 'engine') })
  await waitFor('http://127.0.0.1:8000/openapi.json', 'engine')
  start('gateway', 'java', ['-jar', path.join('gateway', 'target', 'gateway-0.0.1-SNAPSHOT.jar')], env)
  start('web', 'npm', ['--prefix', 'web', 'run', 'dev', '--', '--strictPort'], env, { shell: isWin })
  await waitFor('http://localhost:8080/api/health', 'gateway')
  await waitFor('http://localhost:5173/', 'web')

  console.log('== 4/4 Playwright (real browser)')
  result = await run('npx', ['playwright', 'test', 'brain.spec.ts'], { cwd: path.join(ROOT, 'web'), env })
} catch (e) {
  console.error(String(e))
} finally {
  stopAll()
}
console.log(result === 0 ? '\nSecond Brain end-to-end: PASSED' : '\nSecond Brain end-to-end: FAILED')
process.exit(result)
