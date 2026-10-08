import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The Second Brain loop in a REAL browser against the real gateway AND the real engine:
 * close a case UNFOUNDED -> supervisor co-signs the precedent -> exception is drafted -> simulated on real data ->
 * submitted -> a different person (governance) approves -> the engine re-runs -> the funnel diff names the change.
 */
function password(user: string): string {
  const file = path.resolve(process.cwd(), '../gateway/src/main/resources/demo-users.csv')
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const [u, , , p] = line.split(',')
    if (u === user) return p
  }
  throw new Error(`no demo user ${user}`)
}

async function actAs(page: Page, role: string) {
  await page.getByLabel('Demo: act as role').selectOption(role)
  await expect(page.getByText(`(${role})`).first()).toBeVisible()
}

interface QueueItem { caseId: string; tier: string }
interface CaseHeader { hardFactAlerts: boolean; ruleIds: string[]; status: string; tier: string; hypotheses: { code: string }[] }

/** A case that a person could legitimately close as a harmless pattern: no recorded-fact rule involved. */
async function candidateCase(page: Page): Promise<string> {
  const q = await (await page.request.get('/api/queue?horizon=90&capacityHours=1000')).json() as { items: QueueItem[] }
  for (const item of q.items) {
    const h = await (await page.request.get(`/api/cases/${item.caseId}`)).json() as CaseHeader
    // a look-alike of a legitimate high-acuity provider (decoy D1 in the synthetic data): impossible-timing + utilization
    // signals, no recorded fact. Excepting a real scheme is BLOCKed by the simulation's ground-truth check, by design.
    if (!h.hardFactAlerts && h.status === 'NEW' && h.tier === 'MEDIUM' && h.ruleIds.includes('R-TIME-01') && h.ruleIds.includes('S-UTL')) return item.caseId
  }
  throw new Error('no suitable case in this run')
}

test('closing a case teaches the system: co-sign, exception, simulation, approval, re-run, diff', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Username').fill('investigator')
  await page.getByLabel('Password').fill(password('investigator'))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('heading', { name: 'Executive dashboard' })).toBeVisible()
  await expect(page.getByText('The analysis engine is unavailable')).toHaveCount(0)

  const caseId = await candidateCase(page)
  await page.goto(`/cases/${caseId}`)
  await expect(page.getByRole('heading', { name: caseId })).toBeVisible()

  // reject the proposal with a reason, then close the case as UNFOUNDED with a written rationale
  await page.getByRole('radio', { name: 'Reject' }).click()
  await page.getByLabel('Reason code').selectOption('LEGIT_CLINICAL_PATTERN')
  await page.getByRole('button', { name: 'Record decision' }).click()
  await expect(page.getByText('Status: IN_REVIEW')).toBeVisible()
  await page.getByLabel('Outcome').selectOption('UNFOUNDED')
  await page.locator('#closeReason').selectOption('LEGIT_CLINICAL_PATTERN')
  await page.getByLabel(/Rationale/).fill('Records show the pattern is explained by the specialty and the patient mix, so no action is needed.')
  await page.getByRole('button', { name: 'Close case' }).click()
  await expect(page.getByText('Status: CLOSED')).toBeVisible()

  // a supervisor co-signs the precedent (a second person: the closer cannot)
  await actAs(page, 'SUPERVISOR')
  await page.getByRole('link', { name: 'Precedents' }).first().click()
  await expect(page.getByRole('heading', { name: 'Waiting for a supervisor' })).toBeVisible()
  await page.getByRole('button', { name: 'Co-sign as precedent' }).click()
  await expect(page.getByRole('status')).toContainText('now an active precedent', { timeout: 60_000 })

  // draft the exception from the precedent, simulate it on real data, submit it
  await page.getByRole('button', { name: 'Propose exception' }).first().click()
  await expect(page.getByRole('heading', { name: 'Rules and exceptions' })).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Simulate' }).click()
  await expect(page.getByLabel('Simulation result')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Submit for approval' }).click()
  await expect(page.getByText('Waiting for governance approval')).toBeVisible()

  // the proposer cannot approve; governance can
  await actAs(page, 'GOVERNANCE')
  await page.getByLabel(/Decision notes/).fill('Simulation reviewed: narrow scope, no confirmed case touched.')
  await page.getByRole('button', { name: 'Approve and re-run' }).click()

  // the engine re-runs; the run history shows a new run compared with the previous one
  await expect(page.getByText(/Last re-run: done/)).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText(/compared with RUN-001/)).toBeVisible()
  await expect(page.getByText('Approved and active').first()).toBeVisible()

  // everything is on the audit trail
  await actAs(page, 'AUDITOR')
  await page.getByRole('link', { name: 'Audit' }).click()
  for (const ev of ['PRECEDENT_CREATED', 'EXCEPTION_PROPOSED', 'EXCEPTION_APPROVED']) {
    await expect(page.getByText(ev).first()).toBeVisible()
  }
  await page.getByRole('button', { name: 'Verify chain' }).click()
  await expect(page.getByText(/Chain verified: \d+ events intact/)).toBeVisible()
})
