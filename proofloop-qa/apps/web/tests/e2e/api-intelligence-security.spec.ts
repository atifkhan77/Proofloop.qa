import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * Module 6 security scenarios (user-supplied spec, corrected to the implemented API):
 * vault masking + duplicates (API-23), variable substitution before the SSRF check (API-23),
 * request-body redaction for VIEWERs (API-12), per-organization rate limit (API-30).
 *
 * Corrections vs. the pasted version (each observed in a verbatim run):
 *  - variables live at /api/environments/:id/variables (was /api/projects/:id/variables -> 404)
 *  - {{TEST_VAR}} is defined (unresolved variables are rejected with 400 before the SSRF check)
 *  - the VIEWER is moved into the admin's organization (a separate org gets 404)
 *  - the limit is API_EXECUTION_RATE_LIMIT from playwright.config.ts (200), not 30
 *  - serial mode + "E2E " org names + cleanup (a failing non-serial run repeated beforeAll 4x and left 8 orgs)
 */

const API = 'http://localhost:4000/api/';
const runId = Date.now();
const ORG_PREFIX = `E2E ApiSec ${runId}`;
const RATE_LIMIT = 200; // must match API_EXECUTION_RATE_LIMIT in playwright.config.ts

test.describe.configure({ mode: 'serial' });

let anon: APIRequestContext;
let admin: APIRequestContext;
let viewer: APIRequestContext;
let environmentId: string;
let collectionId: string;
let requestId: string;

async function register(tag: string) {
  const res = await anon.post('auth/register', {
    data: { email: `e2e-apisec-${tag}-${runId}@example.com`, password: 'Passw0rd!', firstName: 'S', lastName: tag, organizationName: `${ORG_PREFIX} ${tag}` },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { token: string; user: { id: string; organizationId: string } };
}
const client = (token: string) => request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

test.beforeAll(async () => {
  anon = await request.newContext({ baseURL: API });
  const a = await register('admin');
  admin = await client(a.token);
  const v = await register('viewer');
  await prisma.user.update({ where: { id: v.user.id }, data: { role: 'VIEWER', organizationId: a.user.organizationId } });
  viewer = await client(v.token);

  const projectId = (await (await admin.post('projects', { data: { name: 'Security Test Project' } })).json()).id;
  environmentId = (await (await admin.post(`projects/${projectId}/environments`, { data: { name: 'VAULT_TEST', baseUrl: '' } })).json()).id;
  collectionId = (await (await admin.post(`projects/${projectId}/api-collections`, { data: { name: 'Core Collection' } })).json()).id;
  const created = await admin.post(`api-collections/${collectionId}/requests`, {
    data: {
      name: 'Injection Test',
      method: 'POST',
      endpoint: 'http://{{TARGET_HOST}}',
      body: { secretPayload: 'hidden-data', injected: '{{TEST_VAR}}' },
    },
  });
  expect(created.status()).toBe(201);
  requestId = (await created.json()).id;
});

test.afterAll(async () => {
  await Promise.all([anon, admin, viewer].map((c) => c?.dispose()));
  await prisma.organization.deleteMany({ where: { name: { startsWith: ORG_PREFIX } } });
  await prisma.$disconnect();
});

test('API-23: vault masks secrets (create + list) and rejects duplicate keys', async () => {
  const vars = `environments/${environmentId}/variables`;
  expect((await admin.post(vars, { data: { key: 'TARGET_HOST', value: '127.0.0.1', isSecret: false } })).status()).toBe(201);
  expect((await admin.post(vars, { data: { key: 'TEST_VAR', value: 'injected-value', isSecret: false } })).status()).toBe(201);

  const secret = await admin.post(vars, { data: { key: 'API_TOKEN', value: 'super-secret-123', isSecret: true } });
  expect(secret.status()).toBe(201);
  expect((await secret.json()).value).toBe('********');

  const dup = await admin.post(vars, { data: { key: 'API_TOKEN', value: 'different', isSecret: false } });
  expect(dup.status()).toBe(409);

  const list: { key: string; value: string }[] = await (await admin.get(vars)).json();
  expect(list.find((v) => v.key === 'API_TOKEN')?.value).toBe('********');
  expect(list.find((v) => v.key === 'TARGET_HOST')?.value).toBe('127.0.0.1');
  expect(JSON.stringify(list)).not.toContain('super-secret-123');
});

test('API-23: variables are resolved before the SSRF check (TARGET_HOST -> 127.0.0.1 is blocked)', async () => {
  const res = await admin.post(`api-requests/${requestId}/execute`, { data: { environmentId } });
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toContain('SSRF Blocked');
  expect(await prisma.apiExecution.count({ where: { requestId } })).toBe(0);
});

test('API-12: request bodies are redacted for VIEWERs but visible to ADMINs', async () => {
  const asAdmin = await (await admin.get(`api-collections/${collectionId}/requests`)).json();
  expect(asAdmin[0].body.secretPayload).toBe('hidden-data');

  const viewerRes = await viewer.get(`api-collections/${collectionId}/requests`);
  expect(viewerRes.status()).toBe(200);
  const asViewer = await viewerRes.json();
  expect(asViewer[0].body._redacted).toBeDefined();
  expect(asViewer[0].body.secretPayload).toBeUndefined();
});

test('API-30: execution is rate-limited per organization (limit + 1 -> 429)', async () => {
  test.setTimeout(120_000);
  // Fresh organization: its budget is untouched by the earlier tests.
  const fresh = await register('limit');
  const limited = await client(fresh.token);
  const p = (await (await limited.post('projects', { data: { name: 'L' } })).json()).id;
  const c = (await (await limited.post(`projects/${p}/api-collections`, { data: { name: 'L' } })).json()).id;
  // Literal 127.0.0.1 endpoint: blocked by the SSRF guard (403) without any network call, but counted.
  const id = (await (await limited.post(`api-collections/${c}/requests`, { data: { name: 'x', method: 'GET', endpoint: 'http://127.0.0.1/' } })).json()).id;

  const statuses: number[] = [];
  for (let sent = 0; sent < RATE_LIMIT; sent += 20) {
    const batch = Math.min(20, RATE_LIMIT - sent);
    statuses.push(...(await Promise.all(Array.from({ length: batch }, () => limited.post(`api-requests/${id}/execute`)))).map((r) => r.status()));
  }
  expect(statuses.every((s) => s === 403)).toBe(true);

  const over = await limited.post(`api-requests/${id}/execute`);
  expect(over.status()).toBe(429);
  expect((await over.json()).error).toBe('Too many requests: Rate limit exceeded for your organization');
  await limited.dispose();
});
