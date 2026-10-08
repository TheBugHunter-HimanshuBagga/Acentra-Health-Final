// One-time setup for a fresh clone: Python venv + packages, web packages, Java build, .env.
import { copyFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { ROOT, enginePython, run } from './lib.mjs'

const step = async (label, cmd, args, opts) => {
  console.log(`\n=== ${label}`)
  const code = await run(cmd, args, opts)
  if (code !== 0) {
    console.error(`FAILED: ${label}`)
    process.exit(code)
  }
}

if (!existsSync(path.join(ROOT, '.env'))) {
  copyFileSync(path.join(ROOT, '.env.example'), path.join(ROOT, '.env'))
  console.log('Created .env from .env.example (add your API keys there; never commit it).')
}
if (!existsSync(enginePython)) {
  await step('Create Python venv (3.12+)', process.platform === 'win32' ? 'python' : 'python3', ['-m', 'venv', 'engine/.venv'])
}
await step('Install Python packages', enginePython, ['-m', 'pip', 'install', '-r', 'engine/requirements.txt'])
await step('Install web packages', 'npm', ['--prefix', 'web', 'install'])
await step('Build gateway (downloads Maven dependencies)', 'mvn', ['-q', '-f', 'gateway/pom.xml', '-DskipTests', 'package'])
console.log('\nSetup complete. Start everything with: npm install && npm run dev')
