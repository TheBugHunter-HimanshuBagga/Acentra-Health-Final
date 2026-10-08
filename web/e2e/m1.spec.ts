import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** Milestone M1 in a REAL browser against the real gateway, with a freshly generated engine database. */
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

test('investigator reviews, supervisor approves, case is closed, audit chain verifies', async ({ page }) => {
  // sign in
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await page.getByLabel('Username').fill('investigator')
  await page.getByLabel('Password').fill(password('investigator'))
  await page.getByRole('button', { name: 'Sign in' }).click()

  // first sign-in: language selection (real PUT /api/me/prefs); pick Hindi, see the UI change, return to English
  await expect(page.getByRole('heading', { name: /Welcome to ClaimShield Nexus/ })).toBeVisible()
  await page.getByRole('radio', { name: /Hindi/ }).click()
  await expect(page.getByRole('button', { name: 'Skip for now' })).toHaveCount(0)   // the buttons are now in Hindi
  await page.getByRole('radio', { name: /English/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()

  // the dashboard is the landing page; open the queue from the sidebar
  await expect(page.getByRole('heading', { name: 'Executive dashboard' })).toBeVisible()
  await page.getByRole('link', { name: 'SIU queue' }).first().click()
  await expect(page.getByRole('heading', { name: 'SIU queue' })).toBeVisible()
  const caseLinks = page.getByRole('link', { name: /^CASE-\d{4}$/ })
  await expect.poll(() => caseLinks.count()).toBeGreaterThanOrEqual(8)
  await expect(page.getByLabel('HIGH confidence').first()).toBeVisible()

  // open the top case: evidence and claim lines are shown
  const caseId = (await caseLinks.first().textContent())!.trim()
  await caseLinks.first().click()
  await expect(page.getByRole('heading', { name: caseId })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Evidence', exact: true })).toBeVisible()
  // confidence is a separate axis from risk; impact figures explain themselves; the reasoning chain ends with a person
  await expect(page.getByRole('heading', { name: 'How sure are we, and why' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Case impact' })).toBeVisible()
  await expect(page.getByText('Why do we believe this?').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Reasoning chain' })).toBeVisible()
  await expect(page.getByRole('button', { name: /HUMAN REVIEW/ })).toBeVisible()
  await expect(page.getByText(/\d+ lines (have|were|duplicate|exceed)|equipment orders/).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Claim lines', exact: true })).toBeVisible()

  // intelligence views are real, not placeholders: timeline chart, network graph, 30/60/90 outlook, confidence
  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Monthly paid and flagged dollars' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Network', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '30, 60 and 90 day outlook' })).toBeVisible()
  await expect(page.getByLabel('30-day outlook')).toBeVisible()
  await expect(page.getByLabel('90-day outlook')).toBeVisible()
  await expect(page.getByText(/ranking score, not calibrated chances/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Confidence', exact: true })).toBeVisible()

  // Investigation brief: generate it, see the badge and the seven elements
  await page.getByRole('button', { name: 'Generate investigation brief' }).click()
  await expect(page.getByTestId('brief-badge')).toHaveText('Validated')
  for (const t of ['1. Evidence', '2. Timeline', '3. Network context', '4. Confidence', '5. Limitations',
    '6. Recommended human-review action', '7. Supporting case and risk context']) {
    await expect(page.getByRole('region', { name: t })).toBeVisible()
  }
  await expect(page.locator('body')).not.toContainText('{{')

  // Modify to a high-impact action: needs a reason, then waits for a supervisor
  await page.getByRole('radio', { name: 'Modify' }).click()
  await page.getByLabel('Action', { exact: true }).selectOption('PREPAY_REVIEW_FLAG')
  await page.getByLabel('Reason code').selectOption('NEEDS_RECORDS')
  await page.getByRole('button', { name: 'Record decision' }).click()
  await expect(page.getByText(/waits for a supervisor/)).toBeVisible()
  await expect(page.getByText('Status: ACTION_PROPOSED')).toBeVisible()
  await expect(page.getByText('Waiting for a supervisor to approve.')).toBeVisible()

  // the investigator cannot see the audit trail
  await page.getByRole('link', { name: 'Audit' }).click()
  await expect(page.getByText(/available to supervisors, governance and auditors/)).toBeVisible()
  await page.getByRole('link', { name: 'SIU queue' }).first().click()
  await page.getByRole('link', { name: caseId }).click()

  // a supervisor approves (two-person rule); the investigator then carries it out
  await actAs(page, 'SUPERVISOR')
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Status: ACTION_APPROVED')).toBeVisible()
  await actAs(page, 'INVESTIGATOR')
  await page.getByRole('button', { name: 'Carry out (simulated)' }).click()
  await expect(page.getByText('Status: ACTION_TAKEN')).toBeVisible()

  // final decision
  await page.getByLabel('Outcome').selectOption('CONFIRMED')
  await page.locator('#closeReason').selectOption('CONFIRMED_PATTERN')
  await page.getByLabel(/Rationale/).fill('Records received and they confirm the billing pattern flagged by the rule.')
  await page.getByRole('button', { name: 'Close case' }).click()
  await expect(page.getByText('Status: CLOSED')).toBeVisible()
  await expect(page.getByText(/Closed: CONFIRMED/)).toBeVisible()
  await expect(page.getByText(/approved by supervisor/)).toBeVisible()

  // audit: every step recorded, chain verifies
  await actAs(page, 'AUDITOR')
  await page.getByRole('link', { name: 'Audit' }).click()
  await expect(page.getByText('CASE_CLOSED')).toBeVisible()
  await expect(page.getByText('APPROVAL', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Verify chain' }).click()
  await expect(page.getByText(/Chain verified: \d+ events intact/)).toBeVisible()

  // the queue reflects the closed case
  await page.getByRole('link', { name: 'SIU queue' }).first().click()
  await expect(page.getByRole('row', { name: new RegExp(`${caseId}.*CLOSED`) })).toBeVisible()
})

test('a wrong password is refused with a clear message', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Username').fill('investigator')
  await page.getByLabel('Password').fill('definitely-not-it')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('incorrect')
  await expect(page.getByRole('heading', { name: 'Executive dashboard' })).toHaveCount(0)
})
