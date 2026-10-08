// Starts web (5173), gateway (8080) and engine (8000) together with prefixed logs.
// Ctrl+C stops all three. Zero dependencies (replaces `concurrently`, whose shell-quote dependency has a critical advisory).
import { spawn, spawnSync } from 'node:child_process'
import { ROOT } from './lib.mjs'

const isWin = process.platform === 'win32'
const services = [
  { name: 'web', color: '36', cmd: 'npm', args: ['--prefix', 'web', 'run', 'dev'] },
  { name: 'gateway', color: '32', cmd: 'node', args: ['scripts/run-gateway.mjs'] },
  { name: 'engine', color: '35', cmd: 'node', args: ['scripts/run-engine.mjs'] },
]

const children = []
let stopping = false

function prefix(svc, stream, target) {
  let buf = ''
  stream.on('data', (chunk) => {
    buf += chunk.toString()
    const lines = buf.split(/\r?\n/)
    buf = lines.pop() ?? ''
    for (const l of lines) target.write(`\x1b[${svc.color}m[${svc.name}]\x1b[0m ${l}\n`)
  })
}

function killTree(child) {
  if (!child.pid || child.exitCode !== null) return
  if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill('SIGTERM')
}

function stopAll(code = 0) {
  if (stopping) return
  stopping = true
  children.forEach(killTree)
  setTimeout(() => process.exit(code), 500)
}

for (const svc of services) {
  const child = spawn(svc.cmd, svc.args, {
    cwd: ROOT,
    shell: isWin && svc.cmd === 'npm',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  prefix(svc, child.stdout, process.stdout)
  prefix(svc, child.stderr, process.stderr)
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`[${svc.name}] exited with code ${code}; stopping the others`)
      stopAll(code ?? 1)
    }
  })
  children.push(child)
}

process.on('SIGINT', () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))
