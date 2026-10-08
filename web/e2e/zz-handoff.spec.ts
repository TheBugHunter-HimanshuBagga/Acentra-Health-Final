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
  await expect(sup.getByRole('heading', { name: /Specialist desk/ })).toBeVisible()
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
