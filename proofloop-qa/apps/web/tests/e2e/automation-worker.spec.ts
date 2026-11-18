import { execSync } from 'node:child_process';
import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * Module 5 worker regression: API enqueues a BullMQ job, apps/worker (started by
 * playwright.config.ts) moves the run PENDING -> RUNNING -> PASSED/FAILED.
 * The worker SIMULATES results (5-15 s, random outcome), so assertions check the
 * lifecycle and internal consistency, not specific numbers.
 */

const API = 'http://localhost:4000/api/';
const TOKEN_KEY = 'proofloop-auth-token';
const runId = Date.now();
const ORG = `E2E Worker ${runId}`;
const SUITE = 'Worker Suite';

test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;
let token: string;
let projectId: string;
let automationProjectId: string;
let environmentId: string;

test.beforeAll(async () => {
  const anon = await request.newContext({ baseURL: API });
  token = (
    await (
      await anon.post('auth/register', {
        data: { email: `e2e-worker-${runId}@example.com`, password: 'Passw0rd!', firstName: 'W', lastName: 'K', organizationName: ORG },
      })
    ).json()
  ).token;
  await anon.dispose();
  api = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  projectId = (await (await api.post('projects', { data: { name: `Worker Project ${runId}` } })).json()).id;
  automationProjectId = (await (await api.post(`projects/${projectId}/automation`, { data: { name: SUITE } })).json()).id;
  environmentId = (await (await api.post(`projects/${projectId}/environments`, { data: { name: 'QA' } })).json()).id;
});

test.afterAll(async () => {
  await api?.dispose();
  await prisma.organization.deleteMany({ where: { name: ORG } });
  await prisma.$disconnect();
});

type Run = {
  id: string;
  runId: string;
  status: string;
  startTime: string | null;
  endTime: string | null;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  logUrl: string | null;
  projectEnvironment: { name: string } | null;
};

const listRuns = async (): Promise<Run[]> => (await api.get(`automation/${automationProjectId}/executions`)).json();

test('triggered run goes PENDING -> RUNNING -> PASSED/FAILED with consistent results', async () => {
  test.setTimeout(90_000); // up to one earlier job (<=15 s) + this one (<=15 s), with slack

  const res = await api.post(`automation/${automationProjectId}/executions`, { data: { environmentId } });
  expect(res.status()).toBe(201);
  const created = await res.json();
  expect(created.status).toBe('PENDING');

  // Simulated runs take >= 5 s, so RUNNING is observable.
  await expect.poll(async () => (await listRuns())[0].status, { timeout: 30_000 }).toBe('RUNNING');
  const running = (await listRuns())[0];
  expect(running.startTime).not.toBeNull();
  expect(running.endTime).toBeNull();

  await expect
    .poll(async () => (await listRuns())[0].status, { timeout: 30_000, intervals: [1_000] })
    .toMatch(/^(PASSED|FAILED)$/);

  const run = (await listRuns())[0];
  expect(run.runId).toBe('RUN-001');
  expect(run.projectEnvironment?.name).toBe('QA');
  expect(run.logUrl).toBeNull(); // no fabricated log links
  const seconds = (Date.parse(run.endTime!) - Date.parse(run.startTime!)) / 1000;
  expect(seconds).toBeGreaterThanOrEqual(4.9);
  expect(seconds).toBeLessThanOrEqual(16);
  expect(run.skippedCount).toBeGreaterThanOrEqual(0);
  expect(run.skippedCount).toBeLessThanOrEqual(2);
  if (run.status === 'PASSED') {
    expect(run.failedCount).toBe(0);
    expect(run.passedCount).toBeGreaterThanOrEqual(10);
  } else {
    expect(run.failedCount).toBeGreaterThanOrEqual(1);
    expect(run.passedCount).toBeLessThanOrEqual(4);
  }
});

test('UI: Refresh in run history shows the finished result and counts', async ({ page }) => {
  test.setTimeout(90_000);
  await api.post(`automation/${automationProjectId}/executions`, { data: {} });

  await page.goto('/login');
  await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, token] as const);
  await page.goto(`/projects/${projectId}/automation`);
  const card = page.getByRole('article', { name: SUITE });
  await card.getByRole('button', { name: 'View History' }).click();
  const newest = card.getByRole('list', { name: `Run history for ${SUITE}` }).getByRole('listitem').first();
  await expect(newest).toContainText('RUN-002');

  await expect(async () => {
    await card.getByRole('button', { name: `Refresh run history for ${SUITE}` }).click();
    await expect(newest).toContainText(/PASSED|FAILED/, { timeout: 2_000 });
  }).toPass({ timeout: 60_000, intervals: [2_000] });
  await expect(newest).toContainText(/\d+ passed · \d+ failed · \d+ skipped · \d+s/);
});

// Opt-in: stops the proofloop-redis container. Run with:
//   $env:E2E_REDIS_OUTAGE='1'; npm run test:e2e -w @proofloop/web -- automation-worker
test('Redis down: trigger returns 503 fast, run is CANCELLED (not stuck PENDING), API stays up', async () => {
  test.skip(process.env.E2E_REDIS_OUTAGE !== '1', 'opt-in: set E2E_REDIS_OUTAGE=1');
  test.setTimeout(120_000);
  execSync('docker stop proofloop-redis', { stdio: 'ignore' });
  try {
    const started = Date.now();
    const res = await api.post(`automation/${automationProjectId}/executions`, { data: {} });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(res.status()).toBe(503);
    expect(await res.json()).toEqual({ error: 'Execution queue is unavailable, please retry' });

    const runs = await listRuns(); // API still serving
    expect(runs[0].runId).toBe('RUN-003');
    expect(runs[0].status).toBe('CANCELLED');
  } finally {
    execSync('docker start proofloop-redis', { stdio: 'ignore' });
  }
  // After Redis is back, triggering works again. Attempts made while the API's Redis connection
  // is still reconnecting are 503 + CANCELLED too, so the exact run number is not fixed.
  let createdRunId = '';
  await expect
    .poll(
      async () => {
        const r = await api.post(`automation/${automationProjectId}/executions`, { data: {} });
        if (r.status() === 201) createdRunId = (await r.json()).runId;
        return r.status();
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBe(201);

  const runs = (await listRuns()).reverse(); // oldest first
  expect(runs.map((r) => r.runId)).toEqual(runs.map((_, i) => `RUN-${String(i + 1).padStart(3, '0')}`)); // no gaps
  expect(runs.at(-1)!.runId).toBe(createdRunId);
  expect(runs.at(-1)!.status).not.toBe('CANCELLED');
  // Every run between the outage trigger and the successful one was cancelled, not left PENDING.
  for (const r of runs.slice(2, -1)) expect(r.status).toBe('CANCELLED');
});
