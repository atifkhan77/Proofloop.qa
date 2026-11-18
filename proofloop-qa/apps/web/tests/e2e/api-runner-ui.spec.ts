import type http from 'node:http';
import { test, expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { prisma } from '@proofloop/prisma';
import { TARGET, startTarget } from './helpers/target-server';

/**
 * Module 6 runner UI: run dialog (environment, {{baseUrl}}), response console, per-request
 * results, polling of PENDING runs, RBAC. Executes against the local target server.
 */

const API = 'http://localhost:4000/api/';
const TOKEN_KEY = 'proofloop-auth-token';
const runId = Date.now();
const ORG = `E2E ApiRun ${runId}`;

test.describe.configure({ mode: 'serial' });

let target: http.Server;
let api: APIRequestContext;
let token: string;
let userId: string;
let collectionId: string;

test.beforeAll(async () => {
  target = await startTarget();
  const anon = await request.newContext({ baseURL: API });
  const reg = await (
    await anon.post('auth/register', {
      data: { email: `e2e-apirun-${runId}@example.com`, password: 'Passw0rd!', firstName: 'R', lastName: 'U', organizationName: ORG },
    })
  ).json();
  token = reg.token;
  userId = reg.user.id;
  await anon.dispose();
  api = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

  const projectId = (await (await api.post('projects', { data: { name: 'Runner' } })).json()).id;
  await api.post(`projects/${projectId}/environments`, { data: { name: 'QA', baseUrl: TARGET } });
  collectionId = (await (await api.post(`projects/${projectId}/api-collections`, { data: { name: 'Runner' } })).json()).id;
  const add = (data: Record<string, unknown>) => api.post(`api-collections/${collectionId}/requests`, { data: { method: 'GET', ...data } });
  await add({
    name: 'Get JSON',
    endpoint: '{{baseUrl}}/json',
    assertions: [
      { type: 'status', operator: 'equals', value: 200 },
      { type: 'body', path: '$.user.name', operator: 'equals', value: 'Ada' },
    ],
  });
  await add({ name: 'Wrong name', endpoint: '{{baseUrl}}/json', assertions: [{ type: 'body', path: '$.user.name', operator: 'equals', value: 'Bob' }] });
  await add({ name: 'Broken', endpoint: `${TARGET}/reset` });
});

test.afterAll(async () => {
  await api?.dispose();
  await new Promise((r) => target?.close(r));
  await prisma.organization.deleteMany({ where: { name: ORG } });
  await prisma.$disconnect();
});

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, token] as const);
});

const select = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'API requests' }).getByRole('button', { name: new RegExp(name) }).click();

async function run(page: Page, requestName: string, environment?: string) {
  await select(page, requestName);
  await page.getByRole('button', { name: 'Run Request' }).click();
  const dialog = page.getByRole('dialog', { name: `Run: ${requestName}` });
  if (environment) await dialog.getByLabel('Environment').selectOption({ label: `${environment} (${TARGET})` });
  await dialog.getByRole('button', { name: 'Send Request' }).click();
  return dialog;
}

const consolePanel = (page: Page) => page.getByRole('region', { name: 'Response Output' });

test('run with an environment: {{baseUrl}} resolved, console shows PASSED, HTTP 200, env and body', async ({ page }) => {
  await page.goto(`/api-collections/${collectionId}`);
  await select(page, 'Get JSON');
  await page.getByRole('button', { name: 'Run Request' }).click();
  const dialog = page.getByRole('dialog', { name: 'Run: Get JSON' });
  await expect(dialog).toContainText("and the environment's variables are substituted");
  await expect(dialog).toContainText("Secret variables are only sent to the environment's base URL host.");
  await dialog.getByLabel('Environment').selectOption({ label: `QA (${TARGET})` });
  await dialog.getByRole('button', { name: 'Send Request' }).click();
  await expect(dialog).toBeHidden();

  const out = consolePanel(page);
  await expect(out).toContainText('PASSED');
  await expect(out).toContainText('HTTP200');
  await expect(out).toContainText('ENVQA');
  await expect(out.getByLabel('Response body')).toContainText('"name": "Ada"');
});

test('failed assertion: console shows the error AND the response body', async ({ page }) => {
  await page.goto(`/api-collections/${collectionId}`);
  await run(page, 'Wrong name', 'QA');
  const out = consolePanel(page);
  await expect(out).toContainText('FAILED');
  await expect(out.getByRole('alert')).toHaveText("Assertion failed on [body $.user.name]: expected equals 'Bob' (string) but got 'Ada'");
  await expect(out.getByLabel('Response body')).toContainText('"name": "Ada"');
});

test('network failure: "No response" instead of HTTP 0', async ({ page }) => {
  await page.goto(`/api-collections/${collectionId}`);
  await run(page, 'Broken');
  const out = consolePanel(page);
  await expect(out).toContainText('FAILED');
  await expect(out).toContainText('HTTPNo response');
  await expect(out.getByRole('alert')).not.toBeEmpty();
});

test('results stay with their request when switching between requests', async ({ page }) => {
  await page.goto(`/api-collections/${collectionId}`);
  await run(page, 'Get JSON', 'QA');
  await expect(consolePanel(page)).toContainText('PASSED');
  await select(page, 'Broken'); // not run in this page session
  await expect(consolePanel(page)).toHaveCount(0);
  await select(page, 'Get JSON');
  await expect(consolePanel(page)).toContainText('PASSED');
});

test('{{baseUrl}} without an environment: API message in the dialog; Escape closes and clears it', async ({ page }) => {
  await page.goto(`/api-collections/${collectionId}`);
  const dialog = await run(page, 'Get JSON');
  await expect(dialog.getByRole('alert')).toHaveText('Select an environment to resolve {{baseUrl}}');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Run Request' }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('PENDING runs are polled until final (queued execution path)', async ({ page }) => {
  // The engine is synchronous today; simulate a queued run to exercise the polling path.
  let polls = 0;
  await page.route('**/api/api-requests/*/execute', async (route) => {
    const real = await route.fetch();
    const body = await real.json();
    await route.fulfill({ status: 201, json: { ...body, status: 'PENDING' } });
  });
  await page.route('**/api/api-executions/*', async (route) => {
    polls += 1;
    const real = await route.fetch();
    const body = await real.json();
    await route.fulfill({ json: polls < 2 ? { ...body, status: 'PENDING' } : body });
  });

  await page.goto(`/api-collections/${collectionId}`);
  await run(page, 'Get JSON', 'QA');
  const out = consolePanel(page);
  await expect(out.getByRole('status')).toHaveText(/Waiting for result/);
  await expect(page.getByRole('button', { name: 'Executing...' })).toBeDisabled();
  await expect(out).toContainText('PASSED', { timeout: 10_000 });
  expect(polls).toBeGreaterThanOrEqual(2);
  const settled = polls;
  await page.waitForTimeout(2500);
  expect(polls).toBe(settled); // polling stopped once the run was final
});

test('VIEWER sees requests but no Run button', async ({ page }) => {
  await prisma.user.update({ where: { id: userId }, data: { role: 'VIEWER' } });
  await page.goto(`/api-collections/${collectionId}`);
  await select(page, 'Get JSON');
  await expect(page.getByRole('heading', { name: 'Get JSON', level: 2 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run Request' })).toHaveCount(0);
});
