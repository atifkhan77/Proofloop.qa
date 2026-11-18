import { execFileSync } from 'node:child_process';
import { test, expect, request } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * DB outage must NOT log users out: auth middleware returns 503 (not 401) when
 * the user lookup fails, so the web client keeps the token.
 *
 * Stops the shared Postgres container, so it is opt-in:
 *   $env:E2E_DB_OUTAGE='1'; npm run test:e2e -w @proofloop/web -- db-outage
 */

const CONTAINER = 'proofloop-postgres'; // docker-compose.yml container_name
const API = 'http://localhost:4000/api/';
const TOKEN_KEY = 'proofloop-auth-token';
const runId = Date.now();
const ORG = `E2E Outage ${runId}`;

test.skip(!process.env.E2E_DB_OUTAGE, 'opt-in: set E2E_DB_OUTAGE=1 (stops the Postgres container)');
test.describe.configure({ mode: 'serial' });

function docker(...args: string[]) {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

async function waitForHealthy() {
  await expect
    .poll(() => docker('inspect', '-f', '{{.State.Health.Status}}', CONTAINER), { timeout: 30_000 })
    .toBe('healthy');
}

test.afterAll(async () => {
  // Always bring the DB back, even if a test failed mid-outage.
  if (docker('inspect', '-f', '{{.State.Running}}', CONTAINER) !== 'true') docker('start', CONTAINER);
  await waitForHealthy();
  await prisma.organization.deleteMany({ where: { name: ORG } });
  await prisma.$disconnect();
});

test('API returns 503 (not 401) and the browser keeps its token during a DB outage', async ({ page }) => {
  const anon = await request.newContext({ baseURL: API });
  const reg = await anon.post('auth/register', {
    data: { email: `e2e-outage-${runId}@example.com`, password: 'Passw0rd!', firstName: 'O', lastName: 'U', organizationName: ORG },
  });
  expect(reg.status()).toBe(201);
  const { token } = await reg.json();

  await page.goto('/login');
  await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, token] as const);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  docker('stop', CONTAINER);
  try {
    const authed = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    const me = await authed.get('auth/me');
    expect(me.status()).toBe(503);
    expect((await me.json()).error).toBe('Service temporarily unavailable');
    await authed.dispose();

    // Session restore fails, but the token must survive (no mass logout).
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate((k) => localStorage.getItem(k), TOKEN_KEY)).toBe(token);
  } finally {
    docker('start', CONTAINER);
    await waitForHealthy();
  }

  // DB back: the same token restores the session without logging in again.
  await expect(async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });

  await anon.dispose();
});
