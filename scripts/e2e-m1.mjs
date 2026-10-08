// Milestone M1 end-to-end check against a FRESHLY generated engine database (no committed fixture involved):
//   1. the Python engine generates data, runs rules, builds cases/packs and publishes serving_* into data/e2e/serving.db
//   2. the Spring gateway test M1EndToEndIT drives the whole review flow through the real HTTP stack (MockMvc)
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { ROOT, loadEnv, run } from './lib.mjs'

const dir = path.join(ROOT, 'data', 'e2e')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const db = path.join(dir, 'serving.db')
const env = loadEnv()

console.log('== 1/2 engine: generate, detect, build cases, publish')
let code = await run(process.execPath, ['scripts/run-engine.mjs', '--module', 'claimshield.make_fixture', db], { env })
if (code !== 0) process.exit(code)

console.log('== 2/2 gateway: full review flow on the fresh database')
// Relative path (the test JVM runs in gateway/): absolute Windows paths with spaces get split by the shell.
code = await run('mvn', ['-q', '-f', 'gateway/pom.xml', 'test', '-Dtest=M1EndToEndIT',
  '-Dgateway.fixture=../data/e2e/serving.db'], { env })
console.log(code === 0 ? '\nM1 end-to-end: PASSED' : '\nM1 end-to-end: FAILED')
process.exit(code)
