import { defineConfig } from '@playwright/test'

// Servers are started by scripts/e2e-ui.mjs (fresh engine database + gateway jar + Vite). Run: npm run e2e:ui
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    // E2E_CHANNEL=msedge|chrome drives an already-installed browser (no download). Unset = Playwright's own Chromium.
    channel: process.env.E2E_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
