// Usage: node scripts/run-gateway.mjs [--test]
// Default: run the Spring Boot gateway (port 8080) with .env loaded. APP_DB_PATH is resolved to an
// absolute path so the gateway and the Python engine always open the same SQLite file.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { loadEnv, run } from './lib.mjs'

const env = loadEnv()
mkdirSync(path.dirname(env.APP_DB_PATH), { recursive: true })
const mode = process.argv[2]
const args = mode === '--test' ? ['-q', '-f', 'gateway/pom.xml', 'test'] : ['-f', 'gateway/pom.xml', 'spring-boot:run']
process.exit(await run('mvn', args, { env }))
