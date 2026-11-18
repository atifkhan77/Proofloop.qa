import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * Module 6 UI regression: API collections page, request builder (validation, row ->
 * JSON conversion, assertions incl. `exists`), request details, picker, RBAC/redaction.
 */

const API = 'http://localhost:4000/api/';
const TOKEN_KEY = 'proofloop-auth-token';
const runId = Date.now();
const ORG = `E2E ApiUi ${runId}`;
const PROJECT = `API UI Project ${runId}`;
const COLLECTION = 'Users API';

test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;
let token: string;
let userId: string;
let projectId: string;
let collectionId: string;

test.beforeAll(async () => {
  const anon = await request.newContext({ baseURL: API });
  const reg = await (
    await anon.post('auth/register', {
      data: { email: `e2e-apiui-${runId}@example.com`, password: 'Passw0rd!', firstName: 'A', lastName: 'U', organizationName: ORG },
    })
  ).json();
  token = reg.token;
  userId = reg.user.id;
  await anon.dispose();
  api = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  projectId = (await (await api.post('projects', { data: { name: PROJECT } })).json()).id;
});

test.afterAll(async () => {
  await api?.dispose();
  await prisma.organization.deleteMany({ where: { name: ORG } });
  await prisma.$disconnect();
});

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, token] as const);
});

// ---------- Collections page ----------

test('project page links to API Intelligence; empty state shown', async ({ page }) => {
  await page.goto(`/projects/${projectId}`);
  await page.getByRole('main').getByRole('link', { name: /API Intelligence/ }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/api-collections$`));
  await expect(page.getByRole('heading', { name: 'API Intelligence', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: `Back to ${PROJECT}` })).toBeVisible();
  await expect(page.getByText('No API Collections')).toBeVisible();
});

test('create collection: blank name message, then create; duplicate shows API 409', async ({ page }) => {
  await page.goto(`/projects/${projectId}/api-collections`);
  await page.getByRole('button', { name: 'New Collection' }).click();
  const form = page.getByRole('region', { name: 'Create API Collection' });
  await form.getByLabel('Collection Name').fill('   ');
  await form.getByRole('button', { name: 'Save Collection' }).click();
  await expect(form.getByText('Collection name is required')).toBeVisible();

  await form.getByLabel('Collection Name').fill(`  ${COLLECTION}  `);
  await form.getByLabel('Description (Optional)').fill('User endpoints');
  await form.getByRole('button', { name: 'Save Collection' }).click();
  await expect(form).toBeHidden();
  const card = page.getByRole('link', { name: new RegExp(COLLECTION) });
  await expect(card).toContainText('0 Requests');
  await expect(card).toContainText('User endpoints');

  await page.getByRole('button', { name: 'New Collection' }).click();
  await form.getByLabel('Collection Name').fill(COLLECTION);
  await form.getByRole('button', { name: 'Save Collection' }).click();
  await expect(form.getByRole('alert')).toHaveText('An API Collection with this name already exists in this project');
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(form).toBeHidden();

  collectionId = (await prisma.apiCollection.findFirstOrThrow({ where: { projectId, name: COLLECTION } })).id;
});

test('direct visit / refresh of /api-collections pages is served by the web app, not proxied to the API', async ({ page }) => {
  // The dev proxy used to match the '/api' prefix, so these URLs returned Express "Cannot GET".
  for (const path of ['/api-collections', `/api-collections/${collectionId}`]) {
    await page.goto(path);
    await expect(page.getByText(/Cannot GET/)).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  }
  // API paths are still proxied.
  expect((await page.request.get('/api/health')).status()).toBe(200);
});

test('sidebar API Intelligence opens the project picker, then the collections page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'API Intelligence' }).click();
  await expect(page).toHaveURL(/\/api-collections$/);
  await expect(page.getByRole('heading', { name: 'API Intelligence', level: 1 })).toBeVisible();
  await expect(page.getByText('Coming soon')).toHaveCount(0);
  await page.getByRole('link', { name: new RegExp(PROJECT) }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/api-collections$`));
});

// ---------- Builder ----------

test('collection card opens the builder with title, back link and empty state', async ({ page }) => {
  await page.goto(`/projects/${projectId}/api-collections`);
  await page.getByRole('link', { name: new RegExp(COLLECTION) }).click();
  await expect(page).toHaveURL(new RegExp(`/api-collections/${collectionId}$`));
  await expect(page.getByRole('heading', { name: COLLECTION, level: 1 })).toBeVisible();
  await expect(page.getByText('No requests. Click + to build one.')).toBeVisible();
  await page.getByRole('link', { name: `Back to ${PROJECT} collections` }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/api-collections$`));
});

test('builder validation: name/endpoint, invalid JSON, bearer token, assertion path and number', async ({ page }) => {
  await page.goto(`/api-collections/${collectionId}`);
  await page.getByRole('button', { name: 'New request' }).click();
  const form = page.getByRole('form', { name: 'New API request' });

  await form.getByRole('tab', { name: 'Body' }).click();
  await form.getByLabel('JSON Body (Optional)').fill('{ not json');
  await form.getByRole('tab', { name: 'Auth' }).click();
  await form.getByLabel('Authorization Type').selectOption('bearer');
  await form.getByRole('tab', { name: 'Assertions' }).click();
  await form.getByLabel('Assertion 1 value', { exact: true }).fill('abc'); // status needs a number
  await form.getByRole('button', { name: '+ Add Assertion' }).click();
  await form.getByLabel('Assertion 2 type').selectOption('body');
  await form.getByLabel('Assertion 2 operator').selectOption('exists');

  await form.getByRole('button', { name: 'Save Request' }).click();
  await expect(form.getByText('Request name is required')).toBeVisible();
  await expect(form.getByText('Endpoint URL is required')).toBeVisible();
  await expect(form.getByText('Fix the errors in: Auth, Body, Assertions')).toBeVisible();
  await expect(form.getByText('Assertion 1: Value must be a number')).toBeVisible();
  await expect(form.getByText('Assertion 2: JSONPath is required')).toBeVisible();
  await form.getByRole('tab', { name: 'Auth' }).click();
  await expect(form.getByText('Bearer token is required')).toBeVisible();
  await form.getByRole('tab', { name: 'Body' }).click();
  await expect(form.getByText('Body must be valid JSON')).toBeVisible();
  expect(await prisma.apiRequest.count({ where: { collectionId } })).toBe(0);

  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(form).toBeHidden();
});

test('create full request: rows -> JSON, numeric values, `exists` assertion kept, body parsed', async ({ page }) => {
  await page.goto(`/api-collections/${collectionId}`);
  await page.getByRole('button', { name: 'New request' }).click();
  const form = page.getByRole('form', { name: 'New API request' });

  await form.getByLabel('Request Name').fill('Create user');
  await form.getByLabel('Method').selectOption('POST');
  await form.getByLabel('Endpoint URL').fill('{{baseUrl}}/users');

  await form.getByLabel('Query param 1 name').fill('notify');
  await form.getByLabel('Query param 1 value').fill('true');
  await form.getByRole('tab', { name: 'Headers' }).click();
  await form.getByLabel('Header 1 name').fill('Content-Type');
  await form.getByLabel('Header 1 value').fill('application/json');
  await form.getByRole('button', { name: '+ Add Header' }).click();
  await form.getByLabel('Header 2 name').fill('   '); // blank rows are dropped

  await form.getByRole('tab', { name: 'Auth' }).click();
  await form.getByLabel('Authorization Type').selectOption('bearer');
  await form.getByLabel('Token').fill('{{API_TOKEN}}');

  await form.getByRole('tab', { name: 'Body' }).click();
  await form.getByLabel('JSON Body (Optional)').fill('{"email":"a@example.com","active":false}');

  await form.getByRole('tab', { name: 'Assertions' }).click();
  await form.getByLabel('Assertion 1 value', { exact: true }).fill('201');
  await form.getByRole('button', { name: '+ Add Assertion' }).click();
  await form.getByLabel('Assertion 2 type').selectOption('body');
  await form.getByLabel('Assertion 2 JSONPath').fill('$.id');
  await form.getByLabel('Assertion 2 operator').selectOption('exists');
  await form.getByRole('button', { name: '+ Add Assertion' }).click();
  await form.getByLabel('Assertion 3 type').selectOption('responseTime');
  await form.getByLabel('Assertion 3 operator').selectOption('less_than');
  await form.getByLabel('Assertion 3 value', { exact: true }).fill('500');

  await form.getByRole('button', { name: 'Save Request' }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Create user', level: 2 })).toBeVisible();

  const saved = await prisma.apiRequest.findFirstOrThrow({ where: { collectionId, name: 'Create user' } });
  expect(saved.method).toBe('POST');
  expect(saved.endpoint).toBe('{{baseUrl}}/users');
  expect(saved.queryParams).toEqual({ notify: 'true' });
  expect(saved.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(saved.auth).toEqual({ type: 'bearer', token: '{{API_TOKEN}}' });
  expect(saved.body).toEqual({ email: 'a@example.com', active: false });
  expect(saved.assertions).toEqual([
    { type: 'status', operator: 'equals', value: 201, dataType: 'number' },
    { type: 'body', path: '$.id', operator: 'exists' },
    { type: 'responseTime', operator: 'less_than', value: 500, dataType: 'number' },
  ]);
  expect(saved.sequenceNumber).toBe(1);
});

test('value type selector: boolean/null saved typed; status and comparisons fixed to Number; bad boolean rejected', async ({ page }) => {
  await page.goto(`/api-collections/${collectionId}`);
  await page.getByRole('button', { name: 'New request' }).click();
  const form = page.getByRole('form', { name: 'New API request' });
  await form.getByLabel('Request Name').fill('Typed checks');
  await form.getByLabel('Endpoint URL').fill('{{baseUrl}}/users/1');
  await form.getByRole('tab', { name: 'Assertions' }).click();

  // Row 1 (status): type fixed to Number.
  await expect(form.getByLabel('Assertion 1 value type')).toBeDisabled();
  await expect(form.getByLabel('Assertion 1 value type')).toHaveValue('number');

  await form.getByRole('button', { name: '+ Add Assertion' }).click();
  await form.getByLabel('Assertion 2 type').selectOption('body');
  await form.getByLabel('Assertion 2 JSONPath').fill('$.active');
  await form.getByLabel('Assertion 2 value type').selectOption('boolean');
  await form.getByLabel('Assertion 2 value', { exact: true }).fill('yes');

  await form.getByRole('button', { name: '+ Add Assertion' }).click();
  await form.getByLabel('Assertion 3 type').selectOption('body');
  await form.getByLabel('Assertion 3 JSONPath').fill('$.deletedAt');
  await form.getByLabel('Assertion 3 value type').selectOption('null');
  await expect(form.getByLabel('Assertion 3 value', { exact: true })).toHaveAttribute('readonly', '');

  await form.getByRole('button', { name: '+ Add Assertion' }).click();
  await form.getByLabel('Assertion 4 type').selectOption('body');
  await form.getByLabel('Assertion 4 JSONPath').fill('$.age');
  await form.getByLabel('Assertion 4 operator').selectOption('greater_than');
  await expect(form.getByLabel('Assertion 4 value type')).toBeDisabled();
  await form.getByLabel('Assertion 4 value', { exact: true }).fill('17');

  await form.getByRole('button', { name: 'Save Request' }).click();
  await expect(form.getByText('Assertion 2: Value must be true or false')).toBeVisible();
  await form.getByLabel('Assertion 2 value', { exact: true }).fill('false');
  await form.getByRole('button', { name: 'Save Request' }).click();
  await expect(form).toBeHidden();

  const saved = await prisma.apiRequest.findFirstOrThrow({ where: { collectionId, name: 'Typed checks' } });
  expect(saved.assertions).toEqual([
    { type: 'status', operator: 'equals', value: 200, dataType: 'number' },
    { type: 'body', path: '$.active', operator: 'equals', value: false, dataType: 'boolean' },
    { type: 'body', path: '$.deletedAt', operator: 'equals', value: null, dataType: 'null' },
    { type: 'body', path: '$.age', operator: 'greater_than', value: 17, dataType: 'number' },
  ]);

  // Details show the type so "false" (text) and false (boolean) are distinguishable.
  const list = page.getByRole('article', { name: 'Typed checks' }).getByRole('region', { name: 'Assertions' }).getByRole('listitem');
  await expect(list.nth(1)).toHaveText(/\$\.active\s*equals\s*false\s*\(boolean\)/);
  await expect(list.nth(2)).toHaveText(/\$\.deletedAt\s*equals\s*null\s*\(null\)/);
  await prisma.apiRequest.delete({ where: { id: saved.id } }); // keep later request counts stable
});

test('details view shows params, headers, auth summary (no secret), body and assertions', async ({ page }) => {
  await page.goto(`/api-collections/${collectionId}`);
  await page.getByRole('navigation', { name: 'API requests' }).getByRole('button', { name: /Create user/ }).click();
  const details = page.getByRole('article', { name: 'Create user' });
  await expect(details).toContainText('{{baseUrl}}/users');
  await expect(details.getByRole('region', { name: 'Query Parameters' })).toContainText('notify');
  await expect(details.getByRole('region', { name: 'Headers' })).toContainText('application/json');
  await expect(details.getByRole('region', { name: 'Auth' })).toHaveText(/Bearer Token/);
  await expect(details).not.toContainText('{{API_TOKEN}}'); // secret fields never rendered
  await expect(details.getByRole('region', { name: 'Body' })).toContainText('"active": false');
  const assertions = details.getByRole('region', { name: 'Assertions' }).getByRole('listitem');
  await expect(assertions).toHaveText([/status\s*equals\s*201/, /body\s*\$\.id\s*exists/, /responseTime\s*less than\s*500/]);
});

test('server 400 message is shown (not the generic axios text)', async ({ page }) => {
  await page.route('**/api/api-collections/*/requests', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 400, json: { error: 'Validation failed', details: { endpoint: ['Endpoint rejected by server'] } } })
      : route.continue(),
  );
  await page.goto(`/api-collections/${collectionId}`);
  await page.getByRole('button', { name: 'New request' }).click();
  const form = page.getByRole('form', { name: 'New API request' });
  await form.getByLabel('Request Name').fill('Rejected');
  await form.getByLabel('Endpoint URL').fill('/x');
  await form.getByRole('button', { name: 'Save Request' }).click();
  await expect(form.getByRole('alert')).toHaveText('Endpoint rejected by server');
});

test('unknown collection and unknown project show not-found errors', async ({ page }) => {
  const unknown = '00000000-0000-0000-0000-000000000000';
  await page.goto(`/api-collections/${unknown}`);
  await expect(page.getByRole('alert')).toHaveText('API Collection not found');
  await page.goto(`/projects/${unknown}/api-collections`);
  await expect(page.getByRole('alert')).toHaveText('Project not found');
});

test('builder fits a phone screen without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/api-collections/${collectionId}`);
  await page.getByRole('button', { name: 'New request' }).click();
  await expect(page.getByRole('form', { name: 'New API request' })).toBeVisible();
  const overflow = await page.getByRole('main').evaluate((m) => m.scrollWidth - m.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('VIEWER: no create controls; header secrets arrive redacted', async ({ page }) => {
  await api.post(`api-collections/${collectionId}/requests`, {
    data: { name: 'Raw secret', method: 'GET', endpoint: '/me', headers: { Authorization: 'Bearer raw-secret' } },
  });
  await prisma.user.update({ where: { id: userId }, data: { role: 'VIEWER' } });

  await page.goto(`/projects/${projectId}/api-collections`);
  await expect(page.getByRole('link', { name: new RegExp(COLLECTION) })).toContainText('2 Requests');
  await expect(page.getByRole('button', { name: 'New Collection' })).toHaveCount(0);

  await page.goto(`/api-collections/${collectionId}`);
  await expect(page.getByRole('button', { name: 'New request' })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'API requests' }).getByRole('button', { name: /Raw secret/ }).click();
  const headers = page.getByRole('article', { name: 'Raw secret' }).getByRole('region', { name: 'Headers' });
  await expect(headers).toContainText('********');
  await expect(page.getByRole('main')).not.toContainText('raw-secret');
});
