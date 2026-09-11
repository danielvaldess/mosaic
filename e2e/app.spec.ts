import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Deterministic end-to-end test: the app runs with MOSAIC_LLM_URL pointed at a
 * local stub that mimics the OpenAI-compatible QVAC server, so no model is
 * downloaded and the whole desktop flow (onboarding, seeding, chat) is tested.
 */
const EXTRACTION = {
  customer: { name: 'Hospital DemoCare Pacific', city: 'Panama City', country: 'Panama' },
  equipment: [
    { modality: 'MR', quantity: 2 },
    { modality: 'CT', quantity: 1 },
  ],
  missingFields: [],
}

function startStub(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(EXTRACTION) } }],
          usage: { prompt_tokens: 12, completion_tokens: 12 },
        }))
        return
      }
      res.writeHead(404).end()
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port })
    })
  })
}

test('first run onboards, greets in the chosen language and chats; settings persist', async () => {
  const { server, port } = await startStub()
  const userData = mkdtempSync(join(tmpdir(), 'mosaic-e2e-'))
  const env = {
    ...process.env,
    PORT: '0',
    MOSAIC_USER_DATA_DIR: userData,
    MOSAIC_LLM_URL: `http://127.0.0.1:${port}/v1`,
    MOSAIC_LLM_MODEL: 'stub',
    MOSAIC_LLM_API_KEY: '',
  }
  let app: ElectronApplication | undefined
  try {
    // ── First run: onboarding flow ────────────────────────────────────────
    app = await electron.launch({ args: ['.'], env })
    let page = await app.firstWindow()
    await expect(page).toHaveTitle(/Mosaic/)
    await expect(page.locator('#step-1')).toBeVisible()
    await page.locator('.lang[data-lang="en"]').click()
    await page.locator('#name').fill('Daniel')
    await page.locator('#next-2').click()
    await expect(page.locator('#step-3')).toBeVisible()
    await page.locator('#skip-location').click()
    await page.locator('#finish').click()

    await expect(page.locator('#chat-input')).toBeVisible()
    await expect(page.locator('#messages')).toContainText('Daniel')
    await expect(page.locator('#lang-prompt')).toHaveCount(0)

    const stats = await page.evaluate(async () => {
      const response = await fetch('/api/stats')
      return response.json() as Promise<{ totalObservations: number }>
    })
    // Fresh desktop installs start empty: automatic demo seeding was removed.
    expect(stats.totalObservations).toBe(0)

    await page.locator('#chat-input').fill(
      'I am at Hospital DemoCare Pacific in Panama. They have two MR systems and one CT.',
    )
    await page.locator('#send-btn').click()
    await expect(page.locator('#messages')).toContainText(/MR/i, { timeout: 60_000 })
    await app.close()

    // ── Second run: onboarding is skipped and language stays locked ───────
    app = await electron.launch({ args: ['.'], env })
    page = await app.firstWindow()
    await expect(page.locator('#chat-input')).toBeVisible()
    await expect(page.locator('#step-1')).toHaveCount(0)
    await expect(page.locator('#lang-prompt')).toHaveCount(0)
    await expect(page.locator('#messages')).toContainText('Daniel')
  } finally {
    await app?.close()
    server.close()
    rmSync(userData, { recursive: true, force: true })
  }
})
