// Real-browser end-to-end check of milestone M1.
//   1. engine generates + publishes a FRESH database
//   2. the gateway jar starts on it (8080), Vite starts (5173, proxying /api)
//   3. Playwright drives the real UI through review -> approval -> action -> close -> audit verify
// Must run from a normal terminal (sandboxed shells cannot bind ports). Run: npm run e2e:ui
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { ROOT, loadEnv, run } from './lib.mjs'

const isWin = process.platform === 'win32'
const dir = path.join(ROOT, 'data', 'e2e-ui')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

console.log('== 1/4 engine: fresh database')
// absolute path: the engine process runs with engine/ as its working directory
let code = await run(process.execPath, ['scripts/run-engine.mjs', '--module', 'claimshield.make_fixture',
  path.join(dir, 'serving.db')], { env: loadEnv() })
if (code) process.exit(code)
copyFileSync(path.join(dir, 'serving.db'), path.join(dir, 'app.db'))

console.log('== 2/4 gateway: build jar')
code = await run('mvn', ['-q', '-f', 'gateway/pom.xml', '-DskipTests', 'package'], { env: loadEnv() })
if (code) process.exit(code)

const children = []
function start(name, cmd, args, env, shell = false) {
  const c = spawn(cmd, args, { cwd: ROOT, env, shell, stdio: ['ignore', 'pipe', 'pipe'] })
  const tag = (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`))
  c.stdout.on('data', tag)
  c.stderr.on('data', tag)
  children.push(c)
  return c
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
  console.log('== 3/4 start gateway (8080) and web (5173)')
  // Windows always has Edge, so use it by default (no browser download). Override with E2E_CHANNEL=chrome|chromium.
  const channel = process.env.E2E_CHANNEL ?? (isWin ? 'msedge' : '')
  const env = { ...loadEnv(), APP_DB_PATH: path.join(dir, 'app.db'), DEMO_MODE: 'true',
    E2E_CHANNEL: channel === 'chromium' ? '' : channel }
  start('gateway', 'java', ['-jar', path.join('gateway', 'target', 'gateway-0.0.1-SNAPSHOT.jar')], env)
  start('web', 'npm', ['--prefix', 'web', 'run', 'dev', '--', '--strictPort'], env, isWin)
  await waitFor('http://localhost:8080/api/health', 'gateway')
  await waitFor('http://localhost:5173/', 'web')

  console.log('== 4/4 Playwright (real browser)')
  result = await run('npx', ['playwright', 'test'], { cwd: path.join(ROOT, 'web'), env })
} catch (e) {
  console.error(String(e))
} finally {
  stopAll()
}
console.log(result === 0 ? '\nUI end-to-end: PASSED' : '\nUI end-to-end: FAILED')
process.exit(result)
