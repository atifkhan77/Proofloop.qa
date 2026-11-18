import type http from 'node:http';
import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma } from '@proofloop/prisma';
import { TARGET, startTarget } from './helpers/target-server';

/**
 * API-23 environment variables (vault, substitution, secret host binding), API-12 request-body
 * redaction for VIEWERs, API-30 per-organization execution rate limit.
 */

const API = 'http://localhost:4000/api/';
const runId = Date.now();
const ORG_PREFIX = `E2E ApiVars ${runId}`;
const SECRET = `raw-secret-${runId}`;
const RATE_LIMIT = 200; // API_EXECUTION_RATE_LIMIT in playwright.config.ts

test.describe.configure({ mode: 'serial' });

let target: http.Server;
let anon: APIRequestContext;
let admin: APIRequestContext;
let engineer: APIRequestContext;
let viewer: APIRequestContext;
let other: APIRequestContext;
let qaEnvId: string;
let bareEnvId: string;
let otherEnvId: string;
let collectionId: string;

async function register(tag: string) {
  const r = await anon.post('auth/register', {
    data: { email: `e2e-apivars-${tag}-${runId}@example.com`, password: 'Passw0rd!', firstName: 'V', lastName: tag, organizationName: `${ORG_PREFIX} ${tag}` },
  });
  expect(r.status()).toBe(201);
  return (await r.json()) as { token: string; user: { id: string; organizationId: string } };
}
const client = (token: string) => request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

async function createAndRun(data: Record<string, unknown>, environmentId?: string, as: APIRequestContext = admin) {
  const created = await as.post(`api-collections/${collectionId}/requests`, { data: { name: 'v', method: 'GET', ...data } });
  expect(created.status(), await created.text()).toBe(201);
  const id = (await created.json()).id as string;
  return { id, res: await as.post(`api-requests/${id}/execute`, { data: environmentId ? { environmentId } : {} }) };
}

test.beforeAll(async () => {
  target = await startTarget();
  anon = await request.newContext({ baseURL: API });
  const a = await register('admin');
  admin = await client(a.token);
  for (const [role, assign] of [['QA_ENGINEER', (c: APIRequestContext) => (engineer = c)], ['VIEWER', (c: APIRequestContext) => (viewer = c)]] as const) {
    const u = await register(role.toLowerCase());
    await prisma.user.update({ where: { id: u.user.id }, data: { role, organizationId: a.user.organizationId } });
    assign(await client(u.token));
  }
  const o = await register('other');
  other = await client(o.token);

  const projectId = (await (await admin.post('projects', { data: { name: 'Vars' } })).json()).id;
  qaEnvId = (await (await admin.post(`projects/${projectId}/environments`, { data: { name: 'QA', baseUrl: TARGET } })).json()).id;
  bareEnvId = (await (await admin.post(`projects/${projectId}/environments`, { data: { name: 'BARE' } })).json()).id;
  collectionId = (await (await admin.post(`projects/${projectId}/api-collections`, { data: { name: 'Vars' } })).json()).id;
  const oProject = (await (await other.post('projects', { data: { name: 'O' } })).json()).id;
  otherEnvId = (await (await other.post(`projects/${oProject}/environments`, { data: { name: 'O' } })).json()).id;
});

test.afterAll(async () => {
  await Promise.all([anon, admin, engineer, viewer, other].map((c) => c?.dispose()));
  await new Promise((r) => target?.close(r));
  await prisma.organization.deleteMany({ where: { name: { startsWith: ORG_PREFIX } } });
  await prisma.$disconnect();
});

// ---------- Vault CRUD ----------

test('create variables: secret value never returned (create, list, any role); stored raw', async () => {
  const secret = await admin.post(`environments/${qaEnvId}/variables`, { data: { key: ' API_TOKEN ', value: SECRET, isSecret: true } });
  expect(secret.status()).toBe(201);
  expect(await secret.json()).toMatchObject({ key: 'API_TOKEN', value: '********', isSecret: true });

  const plain = await engineer.post(`environments/${qaEnvId}/variables`, { data: { key: 'USER_ID', value: '42' } });
  expect(await plain.json()).toMatchObject({ key: 'USER_ID', value: '42', isSecret: false });
  await admin.post(`environments/${qaEnvId}/variables`, { data: { key: 'API_KEY', value: `key-${SECRET}`, isSecret: true } });

  for (const c of [admin, engineer, viewer]) {
    const list = await (await c.get(`environments/${qaEnvId}/variables`)).json();
    expect(list.map((v: { key: string; value: string }) => [v.key, v.value])).toEqual([
      ['API_KEY', '********'],
      ['API_TOKEN', '********'],
      ['USER_ID', '42'],
    ]);
  }
  const stored = await prisma.environmentVariable.findFirstOrThrow({ where: { environmentId: qaEnvId, key: 'API_TOKEN' } });
  expect(stored.value).toBe(SECRET);
});

test('variable validation: key format, reserved baseUrl, empty value, non-boolean isSecret, duplicate 409', async () => {
  for (const data of [
    { key: 'BAD-KEY', value: 'x' },
    { key: 'has space', value: 'x' },
    { key: '', value: 'x' },
    { key: 'baseUrl', value: 'http://x' },
    { key: 'BASEURL', value: 'http://x' },
    { key: 'OK', value: '' },
    { key: 'OK', value: 'x', isSecret: 'yes' },
  ]) {
    expect((await admin.post(`environments/${qaEnvId}/variables`, { data })).status(), JSON.stringify(data)).toBe(400);
  }
  const dup = await admin.post(`environments/${qaEnvId}/variables`, { data: { key: 'USER_ID', value: '1' } });
  expect(dup.status()).toBe(409);
  expect(await dup.json()).toEqual({ error: 'A variable with this key already exists in this environment' });
});

test('variable RBAC & tenancy: VIEWER 403 on create; other org / unknown env 404; no token 401; not under /projects', async () => {
  expect((await viewer.post(`environments/${qaEnvId}/variables`, { data: { key: 'V', value: 'x' } })).status()).toBe(403);
  expect((await other.get(`environments/${qaEnvId}/variables`)).status()).toBe(404);
  expect((await other.post(`environments/${qaEnvId}/variables`, { data: { key: 'X', value: 'x' } })).status()).toBe(404);
  expect((await admin.get(`environments/${otherEnvId}/variables`)).status()).toBe(404);
  expect((await admin.get('environments/00000000-0000-0000-0000-000000000000/variables')).status()).toBe(404);
  expect((await anon.get(`environments/${qaEnvId}/variables`)).status()).toBe(401);
  expect((await admin.get(`projects/${qaEnvId}/variables`)).status()).toBe(404);
  // Regression: an alias POST /projects/:environmentId/variables was once added (ROUTE-02).
  expect((await admin.post(`projects/${qaEnvId}/variables`, { data: { key: 'ALIAS', value: 'x' } })).status()).toBe(404);
});

// ---------- Substitution ----------

test('variables are substituted in endpoint path, headers, query, auth and body strings', async () => {
  const { res } = await createAndRun(
    {
      method: 'POST',
      endpoint: '{{baseUrl}}/echo',
      headers: { 'X-User': 'user-{{USER_ID}}' },
      queryParams: { id: '{{ USER_ID }}' },
      body: { nested: ['{{USER_ID}}', { deep: 'v={{USER_ID}}' }], n: 1 },
      auth: { type: 'bearer', token: '{{API_TOKEN}}' },
    },
    qaEnvId,
  );
  expect(res.status()).toBe(201);
  const echo = (await res.json()).responseBody;
  expect(echo.headers['x-user']).toBe('user-42');
  expect(echo.query.id).toBe('42');
  expect(echo.body).toEqual({ nested: ['42', { deep: 'v=42' }], n: 1 });
  expect(echo.headers.authorization).toBe(`Bearer ${SECRET}`); // secret reached the baseUrl host
});

test('secrets are bound to the environment base URL host (no exfiltration to other hosts)', async () => {
  const cases = [
    'https://example.com/collect?t={{API_TOKEN}}', // secret in query of a foreign host
    'http://{{API_TOKEN}}.example.com/', // secret in the host itself
    '{{baseUrl}}.example.com/x?t={{API_TOKEN}}', // base URL used as a prefix of another host
  ];
  for (const endpoint of cases) {
    const { id, res } = await createAndRun({ endpoint }, qaEnvId);
    expect(res.status(), endpoint).toBe(400);
    const body = JSON.stringify(await res.json());
    expect(body, endpoint).toContain('{{API_TOKEN}}');
    expect(body, endpoint).not.toContain(SECRET); // message names the variable, never the value
    expect(await prisma.apiExecution.count({ where: { requestId: id } })).toBe(0);
  }
  const foreignHeader = await createAndRun({ endpoint: 'https://example.com/', headers: { 'X-API-Key': '{{API_KEY}}' } }, qaEnvId);
  expect(foreignHeader.res.status()).toBe(400);
  expect((await foreignHeader.res.json()).error).toBe(
    "Secret variables ({{API_KEY}}) can only be sent to the environment's base URL host (127.0.0.1:4999)",
  );

  // Non-secret variables may go anywhere (SSRF rules still apply).
  await admin.post(`environments/${qaEnvId}/variables`, { data: { key: 'TARGET_URL', value: TARGET } });
  const plain = await createAndRun({ endpoint: '{{TARGET_URL}}/json' }, qaEnvId);
  expect(plain.res.status()).toBe(201);
});

test('secret in an environment without base URL is rejected', async () => {
  await admin.post(`environments/${bareEnvId}/variables`, { data: { key: 'BARE_SECRET', value: SECRET, isSecret: true } });
  const { res } = await createAndRun({ endpoint: `${TARGET}/echo`, headers: { 'X-K': '{{BARE_SECRET}}' } }, bareEnvId);
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toBe('Secret variables ({{BARE_SECRET}}) require the environment to have a base URL');
});

test('with secrets, redirects are not followed (3xx returned); without secrets they are', async () => {
  const withSecret = await (await createAndRun({ endpoint: '{{baseUrl}}/redirect-ok', headers: { 'X-API-Key': '{{API_KEY}}' } }, qaEnvId)).res.json();
  expect(withSecret.statusCode).toBe(302);
  const without = await (await createAndRun({ endpoint: '{{baseUrl}}/redirect-ok' }, qaEnvId)).res.json();
  expect(without.statusCode).toBe(200);
});

test('unresolved variables -> 400 naming them; prototype keys are not variables', async () => {
  const withEnv = await createAndRun({ endpoint: '{{baseUrl}}/json', headers: { 'X-A': '{{MISSING}}' } }, qaEnvId);
  expect(await withEnv.res.json()).toEqual({ error: 'Unresolved variables: {{MISSING}} (not defined in environment QA)' });
  const noEnv = await createAndRun({ endpoint: `${TARGET}/json`, body: { a: '{{USER_ID}}' } });
  expect(await noEnv.res.json()).toEqual({ error: 'Unresolved variables: {{USER_ID}} (select an environment that defines them)' });
  for (const name of ['__proto__', 'constructor', 'toString']) {
    const r = await createAndRun({ endpoint: '{{baseUrl}}/json', headers: { 'X-P': `{{${name}}}` } }, qaEnvId);
    expect(r.res.status(), name).toBe(400);
  }
});

test('foreign-project environment still rejected (variables do not bypass API-33)', async () => {
  const { res } = await createAndRun({ endpoint: '{{baseUrl}}/json' }, otherEnvId);
  expect(res.status()).toBe(400);
  expect((await res.json()).details).toEqual({ environmentId: ['Invalid environment for this project'] });
});

// ---------- API-12: request body redaction ----------

test('VIEWER: request bodies hidden (incl. falsy 0); writers see them', async () => {
  const fresh = (await (await admin.post(`projects/${(await prisma.apiCollection.findUniqueOrThrow({ where: { id: collectionId } })).projectId}/api-collections`, { data: { name: 'Bodies' } })).json()).id;
  await admin.post(`api-collections/${fresh}/requests`, { data: { name: 'login', method: 'POST', endpoint: '/login', body: { username: 'ada', password: 'hunter2' } } });
  await admin.post(`api-collections/${fresh}/requests`, { data: { name: 'zero', method: 'POST', endpoint: '/z', body: 0 } });
  await admin.post(`api-collections/${fresh}/requests`, { data: { name: 'none', method: 'GET', endpoint: '/n' } });

  const v = await (await viewer.get(`api-collections/${fresh}/requests`)).json();
  expect(v.map((r: { body: unknown }) => r.body)).toEqual([
    { _redacted: 'Request body hidden for VIEWER role' },
    { _redacted: 'Request body hidden for VIEWER role' },
    null,
  ]);
  expect(JSON.stringify(v)).not.toContain('hunter2');
  const w = await (await engineer.get(`api-collections/${fresh}/requests`)).json();
  expect(w[0].body.password).toBe('hunter2');
  expect(w[1].body).toBe(0);
});

// ---------- API-30: rate limit ----------

test('execution rate limit is per organization: limit+1 -> 429, other org unaffected', async () => {
  test.setTimeout(120_000);
  const fresh = await register(`limit`);
  const limited = await client(fresh.token);
  const p = (await (await limited.post('projects', { data: { name: 'L' } })).json()).id;
  const c = (await (await limited.post(`projects/${p}/api-collections`, { data: { name: 'L' } })).json()).id;
  // Invalid endpoint: rejected with 400 before any network call, but still counted.
  const id = (await (await limited.post(`api-collections/${c}/requests`, { data: { name: 'x', method: 'GET', endpoint: '/x' } })).json()).id;

  const statuses: number[] = [];
  for (let batch = 0; batch < RATE_LIMIT; batch += 20) {
    const n = Math.min(20, RATE_LIMIT - batch);
    statuses.push(...(await Promise.all(Array.from({ length: n }, () => limited.post(`api-requests/${id}/execute`)))).map((r) => r.status()));
  }
  expect(statuses.filter((s) => s === 400)).toHaveLength(RATE_LIMIT);

  const over = await limited.post(`api-requests/${id}/execute`);
  expect(over.status()).toBe(429);
  expect(await over.json()).toEqual({ error: 'Too many requests: Rate limit exceeded for your organization' });
  expect(over.headers()['ratelimit-policy']).toBeTruthy();

  // Another organization keeps its own budget.
  const ok = await createAndRun({ endpoint: `${TARGET}/json` });
  expect(ok.res.status()).toBe(201);
  await limited.dispose();
});
