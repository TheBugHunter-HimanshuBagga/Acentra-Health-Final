import { expect, test, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** Two people on one laptop: an investigator asks for a specialist, a supervisor is notified and answers, and both see it. */
function password(user: string): string {
  const file = path.resolve(process.cwd(), '../gateway/src/main/resources/demo-users.csv')
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const [u, , , p] = line.split(',')
    if (u === user) return p
  }
  throw new Error(`no demo user ${user}`)
}

async function signIn(browser: Browser, user: string): Promise<Page> {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto('/login')
  await page.getByLabel('Username').fill(user)
  await page.getByLabel('Password').fill(password(user))
  await page.getByRole('button', { name: 'Sign in' }).click()
  const skip = page.getByRole('button', { name: 'Skip for now' })
  const dashboard = page.getByRole('heading', { name: 'Executive dashboard' })
  await expect(skip.or(dashboard)).toBeVisible({ timeout: 20_000 })
  if (await skip.isVisible()) await skip.click()
  await expect(dashboard).toBeVisible({ timeout: 20_000 })
  return page
}

test('a specialist is notified, joins, and the two people chat in the same conversation', async ({ browser }) => {
  const inv = await signIn(browser, 'investigator')
  await inv.getByRole('button', { name: 'Ask the assistant' }).click()
  await inv.getByLabel('Ask about a case, a policy or how this works').fill('I want to talk to a human specialist')
  await inv.getByRole('button', { name: 'Send' }).click()
  await inv.getByRole('button', { name: 'Connect me to a human specialist' }).click()
  await expect(inv.getByText('Waiting for a human specialist')).toBeVisible()

  // the supervisor signs in afterwards and still finds the request waiting in the bell
  const sup = await signIn(browser, 'supervisor')
  await expect(sup.getByRole('button', { name: /Notifications, \d+ unread/ })).toBeVisible({ timeout: 15_000 })
  await sup.getByRole('button', { name: /Notifications/ }).click()
  await sup.getByRole('button', { name: /needs a specialist/ }).first().click()
  await expect(sup.getByRole('heading', { name: 'Messages', level: 1 })).toBeVisible()
  await sup.getByRole('button', { name: 'Join the conversation' }).first().click()
  await sup.getByLabel('Reply').fill('Hello, I can help with that.')
  await sup.getByRole('button', { name: 'Send' }).click()
  await expect(sup.getByText('Hello, I can help with that.')).toBeVisible()

  // the investigator sees the specialist, hears about it in the bell, and answers
  await expect(inv.getByText(/Connected to/)).toBeVisible({ timeout: 15_000 })
  await expect(inv.getByText('Hello, I can help with that.')).toBeVisible({ timeout: 15_000 })
  await expect(inv.getByRole('button', { name: /Notifications/ })).toBeVisible()
  await inv.getByLabel(/Message the specialist|Ask about a case/).fill('Thank you, which policy applies?')
  await inv.getByRole('button', { name: 'Send' }).click()
  await expect(sup.getByText('Thank you, which policy applies?')).toBeVisible({ timeout: 15_000 })
})

test('a direct conversation with a case attached is separate from the assistant and notifies the other person', async ({ browser }) => {
  const sup = await signIn(browser, 'governance')
  await sup.getByRole('link', { name: 'Messages' }).first().click()
  await sup.getByRole('button', { name: /New conversation/ }).click()
  await sup.getByLabel('Who').selectOption('investigator')
  await sup.locator('#dm-case').selectOption({ index: 1 })
  await sup.getByLabel('Your message').fill('Please give your input on this case')
  await sup.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(sup.getByText('Attached case')).toBeVisible()

  const inv = await signIn(browser, 'investigator')
  await expect(inv.getByRole('button', { name: /Notifications, \d+ unread/ })).toBeVisible({ timeout: 15_000 })
  await inv.getByRole('button', { name: /Notifications/ }).click()
  const popover = inv.getByRole('dialog', { name: 'Notifications' })
  const box = await popover.boundingBox()
  const view = inv.viewportSize()!
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(view.width)          // the list stays on screen
  await popover.getByRole('button', { name: /sent you a message/ }).first().click()
  await expect(inv.getByText('Please give your input on this case', { exact: true })).toBeVisible()
  await expect(inv.getByRole('link', { name: 'Canvas' })).toBeVisible()
  await inv.getByLabel('Message', { exact: true }).fill('Thanks, I will review it now')
  await inv.getByRole('button', { name: 'Send message' }).click()
  await expect(sup.getByText('Thanks, I will review it now')).toBeVisible({ timeout: 15_000 })
})
