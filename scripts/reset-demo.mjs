// Restore the demo database to its known-good snapshot. Run with the gateway and engine STOPPED.
//   data/demo/app.db.snapshot  ->  data/app.db
// The snapshot is produced once by the pipeline plus demo preparation (see docs/ClaimShield_Nexus_Execution_Plan.md).
import { copyFileSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { ROOT, loadEnv } from './lib.mjs'

const target = loadEnv().APP_DB_PATH
const snapshot = path.join(ROOT, 'data', 'demo', 'app.db.snapshot')
if (!existsSync(snapshot)) {
  console.error(`No snapshot at ${snapshot}. Build the demo data first, then save it there.`)
  process.exit(1)
}
for (const suffix of ['', '-wal', '-shm']) rmSync(target + suffix, { force: true })
copyFileSync(snapshot, target)
console.log(`Demo database restored: ${target}`)
