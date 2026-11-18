import type http from 'node:http';
import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma } from '@proofloop/prisma';
import { TARGET, startTarget } from './helpers/target-server';

/**
 * Module 6 execution engine: SSRF guard (pre-check, connect-time DNS check, redirects),
 * auth injection, assertion evaluation, result recording, RBAC/tenancy.
 *
 * Target server: 127.0.0.1:4999, the ONLY address the API is allowed to reach in tests
 * (SSRF_ALLOWED_TARGETS in playwright.config.ts). Everything else must be blocked.
 */

const API = 'http://localhost:4000/api/';
const runId = Date.now();
const ORG_PREFIX = `E2E ApiExec ${runId}`;

test.describe.configure({ mode: 'serial' });

let target: http.Server;
let anon: APIRequestContext;
let admin: APIRequestContext;
let viewer: APIRequestContext;
let other: APIRequestContext;
let collectionId: string;
let otherRequestId: string;
let projectId: string;
let otherEnvId: string;

async function register(tag: string) {
  const r = await anon.post('auth/register', {
    data: { email: `e2e-apiexec-${tag}-${runId}@example.com`, password: 'Passw0rd!', firstName: 'E', lastName: tag, organizationName: `${ORG_PREFIX} ${tag}` },
  });
  return (await r.json()) as { token: string; user: { id: string; organizationId: string } };
}
const client = (token: string) => request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

/** Creates a stored request and executes it; returns the HTTP response. */
async function run(data: Record<string, unknown>) {
  const created = await admin.post(`api-collections/${collectionId}/requests`, { data: { method: 'GET', ...data, name: data.name ?? 'r' } });
  expect(created.status(), await created.text()).toBe(201);
  const id = (await created.json()).id;
  return { id, res: await admin.post(`api-requests/${id}/execute`) };
}

test.beforeAll(async () => {
  target = await startTarget();
  anon = await request.newContext({ baseURL: API });
  const a = await register('admin');
  admin = await client(a.token);
  const v = await register('viewer');
  await prisma.user.update({ where: { id: v.user.id }, data: { role: 'VIEWER', organizationId: a.user.organizationId } });
  viewer = await client(v.token);
  const o = await register('other');
  other = await client(o.token);

  projectId = (await (await admin.post('projects', { data: { name: 'Exec' } })).json()).id;
  collectionId = (await (await admin.post(`projects/${projectId}/api-collections`, { data: { name: 'Exec' } })).json()).id;
  const oProject = (await (await other.post('projects', { data: { name: 'O' } })).json()).id;
  const oColl = (await (await other.post(`projects/${oProject}/api-collections`, { data: { name: 'O' } })).json()).id;
  otherRequestId = (await (await other.post(`api-collections/${oColl}/requests`, { data: { name: 'o', method: 'GET', endpoint: `${TARGET}/json` } })).json()).id;
  otherEnvId = (await (await other.post(`projects/${oProject}/environments`, { data: { name: 'OTHER', baseUrl: TARGET } })).json()).id;
});

test.afterAll(async () => {
  await Promise.all([anon, admin, viewer, other].map((c) => c?.dispose()));
  await new Promise((r) => target?.close(r));
  await prisma.organization.deleteMany({ where: { name: { startsWith: ORG_PREFIX } } });
  await prisma.$disconnect();
});

// ---------- Execution + assertions ----------

test('passing run: all assertion kinds evaluated, result recorded', async () => {
  const { id, res } = await run({
    endpoint: `${TARGET}/json`,
    assertions: [
      { type: 'status', operator: 'equals', value: 200 },
      { type: 'header', path: 'X-Request-Id', operator: 'equals', value: 'abc-123' },
      { type: 'header', path: 'content-type', operator: 'contains', value: 'json' },
      { type: 'body', path: '$.user.name', operator: 'equals', value: 'Ada' },
      { type: 'body', path: '$.active', operator: 'equals', value: false, dataType: 'boolean' },
      { type: 'body', path: '$.count', operator: 'greater_than', value: 2 },
      { type: 'body', path: '$.items[0].id', operator: 'equals', value: 7 },
      { type: 'body', path: '$.items.0.id', operator: 'exists' },
      { type: 'body', path: '$.missing', operator: 'not_equals', value: 'x' },
      { type: 'responseTime', operator: 'less_than', value: 5000 },
    ],
  });
  expect(res.status()).toBe(201);
  const execution = await res.json();
  expect(execution).toMatchObject({ status: 'PASSED', statusCode: 200, errorMessage: null, requestId: id });
  expect(execution.responseBody).toEqual({ id: 1, user: { name: 'Ada' }, active: false, count: 3, items: [{ id: 7 }] });
  expect(execution.responseTime).toBeGreaterThanOrEqual(0);
  expect(await prisma.apiExecution.count({ where: { requestId: id } })).toBe(1);
});

test('failing assertion: FAILED with a readable message naming the first failed rule', async () => {
  const { res } = await run({
    endpoint: `${TARGET}/json`,
    assertions: [
      { type: 'status', operator: 'equals', value: 200 },
      { type: 'body', path: '$.user.name', operator: 'equals', value: 'Bob' },
      { type: 'status', operator: 'equals', value: 500 },
    ],
  });
  const execution = await res.json();
  expect(execution.status).toBe('FAILED');
  expect(execution.statusCode).toBe(200);
  expect(execution.errorMessage).toBe("Assertion failed on [body $.user.name]: expected equals 'Bob' (string) but got 'Ada'");
});

test('evaluator edge cases: built-in properties, null comparisons, missing values', async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ type: 'body', path: '$.toString', operator: 'exists' }, "expected to exist but got '(missing)'"],
    [{ type: 'body', path: '$.__proto__', operator: 'exists' }, "expected to exist but got '(missing)'"],
    [{ type: 'body', path: '$.nothing', operator: 'greater_than', value: -1 }, "expected greater than '-1' (number) but got '(missing)'"],
    [{ type: 'body', path: '$.user', operator: 'equals', value: 'x' }, `expected equals 'x' (string) but got '{"name":"Ada"}'`],
  ];
  for (const [assertion, message] of cases) {
    const execution = await (await run({ endpoint: `${TARGET}/json`, assertions: [assertion] })).res.json();
    expect(execution.status, JSON.stringify(assertion)).toBe('FAILED');
    expect(execution.errorMessage).toContain(message);
  }
});

test('4xx responses are results, not errors; no assertions = PASSED', async () => {
  const notFound = await (await run({ endpoint: `${TARGET}/status/404`, assertions: [{ type: 'status', operator: 'equals', value: 404 }] })).res.json();
  expect(notFound).toMatchObject({ status: 'PASSED', statusCode: 404, responseBody: { error: 'nope' } });
  const none = await (await run({ endpoint: `${TARGET}/text` })).res.json();
  expect(none).toMatchObject({ status: 'PASSED', statusCode: 200, responseBody: 'plain text' });
});

test('falsy response body 0 is stored as 0, not null', async () => {
  const execution = await (await run({ endpoint: `${TARGET}/zero` })).res.json();
  expect(execution.responseBody).toBe(0);
});

test('auth injection, query params, headers and JSON body reach the target unchanged; stored request not mutated', async () => {
  const cases: [Record<string, unknown>, (echo: { headers: Record<string, string>; query: Record<string, string> }) => void][] = [
    [{ type: 'bearer', token: 'tok-1' }, (e) => expect(e.headers.authorization).toBe('Bearer tok-1')],
    [{ type: 'basic', username: 'ada', password: 'pw' }, (e) => expect(e.headers.authorization).toBe(`Basic ${Buffer.from('ada:pw').toString('base64')}`)],
    [{ type: 'apiKey', key: 'X-Api-Key', value: 'k-1', in: 'header' }, (e) => expect(e.headers['x-api-key']).toBe('k-1')],
    [{ type: 'apiKey', key: 'api_key', value: 'k-2', in: 'query' }, (e) => expect(e.query.api_key).toBe('k-2')],
  ];
  for (const [auth, check] of cases) {
    const { id, res } = await run({
      method: 'POST',
      endpoint: `${TARGET}/echo`,
      headers: { 'X-Trace': 't-1' },
      queryParams: { page: '2' },
      body: { hello: 'world' },
      auth,
    });
    const echo = (await res.json()).responseBody;
    expect(echo.method).toBe('POST');
    expect(echo.headers['x-trace']).toBe('t-1');
    expect(echo.query.page).toBe('2');
    expect(echo.body).toEqual({ hello: 'world' });
    check(echo);
    const stored = await prisma.apiRequest.findUniqueOrThrow({ where: { id } });
    expect(stored.headers).toEqual({ 'X-Trace': 't-1' }); // auth header not written back
    expect(stored.queryParams).toEqual({ page: '2' });
  }
});

test('network failure and oversized response are recorded as FAILED with statusCode 0', async () => {
  const reset = await (await run({ endpoint: `${TARGET}/reset` })).res.json();
  expect(reset).toMatchObject({ status: 'FAILED', statusCode: 0 });
  expect(reset.errorMessage).toBeTruthy();

  const big = await (await run({ endpoint: `${TARGET}/big` })).res.json();
  expect(big).toMatchObject({ status: 'FAILED', statusCode: 0 });
  expect(big.errorMessage).toMatch(/maxContentLength/);
});

test('same-host redirect is followed', async () => {
  const execution = await (await run({ endpoint: `${TARGET}/redirect-ok`, assertions: [{ type: 'body', path: '$.id', operator: 'equals', value: 1 }] })).res.json();
  expect(execution).toMatchObject({ status: 'PASSED', statusCode: 200 });
});

// ---------- SSRF ----------

test('SSRF: internal and special-purpose targets are blocked with 403 and nothing is recorded', async () => {
  const blocked = [
    'http://127.0.0.1:4000/api/health',
    'http://localhost:4000/api/health', // via DNS
    'http://0x7f000001:4000/', // hex IPv4, normalised by the URL parser
    'http://2130706433:4000/', // decimal IPv4
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://192.168.1.1/',
    'http://100.64.0.1/',
    'http://0.0.0.0:4000/',
    'http://[::1]:4000/',
    'http://[::ffff:127.0.0.1]:4000/',
    'http://[::ffff:7f00:1]:4000/',
    'http://[fd12:3456::1]/',
    'http://[fe80::1]/',
  ];
  for (const endpoint of blocked) {
    const { id, res } = await run({ endpoint });
    expect(res.status(), endpoint).toBe(403);
    expect((await res.json()).error, endpoint).toMatch(/^SSRF Blocked/);
    expect(await prisma.apiExecution.count({ where: { requestId: id } }), endpoint).toBe(0);
  }
});

test('SSRF: redirects to internal addresses are blocked (literal IP, hostname via connect-time DNS, non-http)', async () => {
  for (const path of ['/redirect-ip', '/redirect-host', '/redirect-file']) {
    const { id, res } = await run({ endpoint: `${TARGET}${path}` });
    expect(res.status(), path).toBe(403);
    expect((await res.json()).error, path).toMatch(/^SSRF Blocked/);
    expect(await prisma.apiExecution.count({ where: { requestId: id } }), path).toBe(0);
  }
});

test('invalid endpoints: variables, relative paths, non-http protocols -> 400; unknown host -> 400', async () => {
  for (const endpoint of ['{{baseUrl}}/users', '/users', 'ftp://example.com/x', 'file:///etc/passwd']) {
    const { res } = await run({ endpoint });
    expect(res.status(), endpoint).toBe(400);
  }
  const { res } = await run({ endpoint: 'http://does-not-exist.invalid/' });
  expect(res.status()).toBe(400);
  expect(await res.json()).toEqual({ error: 'Endpoint host not found' });
});

// ---------- Typed assertions (API-22) ----------

test('typed comparisons: right type passes; wrong type, missing and null never coerce into a match', async () => {
  // /json: { id: 1, user: { name: 'Ada' }, active: false, count: 3, items: [...] }; /echo without body: { body: null, ... }
  const cases: [string, Record<string, unknown>, 'PASSED' | 'FAILED'][] = [
    ['/json', { type: 'body', path: '$.active', operator: 'equals', value: false, dataType: 'boolean' }, 'PASSED'],
    ['/json', { type: 'body', path: '$.count', operator: 'equals', value: 3, dataType: 'number' }, 'PASSED'],
    ['/json', { type: 'body', path: '$.user.name', operator: 'equals', value: 'Ada', dataType: 'string' }, 'PASSED'],
    ['/echo', { type: 'body', path: '$.body', operator: 'equals', dataType: 'null' }, 'PASSED'],
    ['/json', { type: 'header', path: 'X-Total-Count', operator: 'greater_than', value: 2 }, 'PASSED'], // header text "3" as number
    ['/json', { type: 'header', path: 'content-length', operator: 'greater_than', value: 0 }, 'FAILED'], // absent (chunked response)
    ['/json', { type: 'body', path: '$.missing', operator: 'not_equals', value: false, dataType: 'boolean' }, 'PASSED'],
    ['/json', { type: 'body', path: '$.active', operator: 'equals', value: 'false', dataType: 'string' }, 'FAILED'], // boolean is not text
    ['/json', { type: 'body', path: '$.count', operator: 'equals', value: '3', dataType: 'string' }, 'FAILED'], // number is not text
    ['/json', { type: 'body', path: '$.missing', operator: 'equals', value: false, dataType: 'boolean' }, 'FAILED'], // Boolean(undefined) trap
    ['/json', { type: 'body', path: '$.missing', operator: 'equals', value: 'undefined', dataType: 'string' }, 'FAILED'], // String(undefined) trap
    ['/echo', { type: 'body', path: '$.body', operator: 'equals', value: 0, dataType: 'number' }, 'FAILED'], // Number(null) = 0 trap
    ['/json', { type: 'body', path: '$.user.name', operator: 'equals', dataType: 'null' }, 'FAILED'],
  ];
  for (const [path, assertion, expected] of cases) {
    const execution = await (await run({ endpoint: `${TARGET}${path}`, assertions: [assertion] })).res.json();
    expect(execution.status, JSON.stringify(assertion)).toBe(expected);
  }
});

test('rules stored without dataType (before API-22) infer it from the value; numeric rules stay numeric', async () => {
  const created = await admin.post(`api-collections/${collectionId}/requests`, { data: { name: 'legacy', method: 'GET', endpoint: `${TARGET}/json` } });
  const id = (await created.json()).id;
  await prisma.apiRequest.update({
    where: { id },
    data: {
      assertions: [
        { type: 'status', operator: 'equals', value: '200' }, // text in an old rule
        { type: 'responseTime', operator: 'less_than', value: 5000 },
        { type: 'body', path: '$.active', operator: 'equals', value: false },
        { type: 'body', path: '$.user.name', operator: 'equals', value: 'Ada' },
      ],
    },
  });
  const execution = await (await admin.post(`api-requests/${id}/execute`)).json();
  expect(execution).toMatchObject({ status: 'PASSED', errorMessage: null });
});

test('VIEWER: GET execution keeps the outcome but redacts body and error text (incl. falsy body 0)', async () => {
  const failing = (await (await run({ endpoint: `${TARGET}/json`, assertions: [{ type: 'body', path: '$.user.name', operator: 'equals', value: 'Bob' }] })).res.json()).id;
  const zero = (await (await run({ endpoint: `${TARGET}/zero` })).res.json()).id;
  const broken = (await (await run({ endpoint: `${TARGET}/reset` })).res.json()).id;

  const v = await (await viewer.get(`api-executions/${failing}`)).json();
  expect(v).toMatchObject({ status: 'FAILED', statusCode: 200 });
  expect(v.responseTime).toEqual(expect.any(Number));
  expect(v.responseBody).toEqual({ _redacted: 'Response body hidden for VIEWER role' });
  expect(v.errorMessage).toBe('Execution or assertion failed [details redacted for VIEWER]');
  expect(JSON.stringify(v)).not.toContain('Ada');

  expect((await (await viewer.get(`api-executions/${zero}`)).json()).responseBody).toEqual({ _redacted: 'Response body hidden for VIEWER role' });
  const b = await (await viewer.get(`api-executions/${broken}`)).json();
  expect(b).toMatchObject({ statusCode: 0, responseBody: null, errorMessage: 'Execution or assertion failed [details redacted for VIEWER]' });

  const w = await (await admin.get(`api-executions/${failing}`)).json();
  expect(w.responseBody.user.name).toBe('Ada');
  expect(w.errorMessage).toContain("got 'Ada'");
  expect((await (await admin.get(`api-executions/${zero}`)).json()).responseBody).toBe(0);
});

// ---------- Environments: {{baseUrl}} resolution ----------

const createEnv = async (name: string, baseUrl?: string) => {
  const res = await admin.post(`projects/${projectId}/environments`, { data: { name, ...(baseUrl !== undefined ? { baseUrl } : {}) } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id as string;
};

async function runWithEnv(endpoint: string, environmentId?: string) {
  const created = await admin.post(`api-collections/${collectionId}/requests`, { data: { name: 'env', method: 'GET', endpoint } });
  const id = (await created.json()).id;
  return admin.post(`api-requests/${id}/execute`, { data: environmentId === undefined ? {} : { environmentId } });
}

test('{{baseUrl}} is replaced with the environment base URL (trailing slash, spacing, sub-path); environment recorded', async () => {
  const qa = await createEnv('QA', `${TARGET}/`); // trailing slash must not produce "//"
  const v1 = await createEnv('V1', `${TARGET}/v1`);

  const res = await runWithEnv('{{ baseUrl }}/echo?x=1', qa);
  expect(res.status()).toBe(201);
  const execution = await res.json();
  expect(execution).toMatchObject({ status: 'PASSED', statusCode: 200, environmentId: qa, environment: { name: 'QA' } });
  expect(execution.responseBody.path).toBe('/echo');
  expect(execution.responseBody.query).toEqual({ x: '1' });

  const sub = await (await runWithEnv('{{baseUrl}}/json', v1)).json();
  expect(sub).toMatchObject({ status: 'PASSED', statusCode: 200 });
  expect(sub.responseBody.id).toBe(1); // served at /v1/json

  // Environment without {{baseUrl}} in the endpoint: allowed, still recorded.
  const plain = await (await runWithEnv(`${TARGET}/json`, qa)).json();
  expect(plain.environmentId).toBe(qa);
});

test('{{baseUrl}} errors: no environment, environment without base URL, foreign environment', async () => {
  const noEnv = await runWithEnv('{{baseUrl}}/json');
  expect(noEnv.status()).toBe(400);
  expect(await noEnv.json()).toEqual({ error: 'Select an environment to resolve {{baseUrl}}' });

  const bare = await createEnv('BARE');
  const noBase = await runWithEnv('{{baseUrl}}/json', bare);
  expect(noBase.status()).toBe(400);
  expect(await noBase.json()).toEqual({ error: 'Environment BARE has no base URL' });

  const foreign = await runWithEnv('{{baseUrl}}/json', otherEnvId);
  expect(foreign.status()).toBe(400);
  expect((await foreign.json()).details).toEqual({ environmentId: ['Invalid environment for this project'] });
});

test('the RESOLVED URL is SSRF-checked: an environment pointing at an internal address is blocked', async () => {
  const internal = await createEnv('INTERNAL', 'http://127.0.0.1:4000');
  const res = await runWithEnv('{{baseUrl}}/api/health', internal);
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toMatch(/^SSRF Blocked/);
});

test('GET /api-executions/:id returns the run (incl. environment); VIEWER can read; other org 404; no token 401', async () => {
  const qa = (await prisma.projectEnvironment.findFirstOrThrow({ where: { projectId, name: 'QA' } })).id;
  const execution = await (await runWithEnv('{{baseUrl}}/json', qa)).json();

  const own = await admin.get(`api-executions/${execution.id}`);
  expect(own.status()).toBe(200);
  expect(await own.json()).toMatchObject({ id: execution.id, status: 'PASSED', environment: { name: 'QA' } });
  expect((await viewer.get(`api-executions/${execution.id}`)).status()).toBe(200);
  expect((await other.get(`api-executions/${execution.id}`)).status()).toBe(404);
  expect((await admin.get('api-executions/00000000-0000-0000-0000-000000000000')).status()).toBe(404);
  expect((await anon.get(`api-executions/${execution.id}`)).status()).toBe(401);
});

// ---------- RBAC & tenancy ----------

test('VIEWER 403, other org 404, unknown 404, no token 401', async () => {
  const { id } = await run({ endpoint: `${TARGET}/json` });
  expect((await viewer.post(`api-requests/${id}/execute`)).status()).toBe(403);
  expect((await admin.post(`api-requests/${otherRequestId}/execute`)).status()).toBe(404);
  expect((await admin.post('api-requests/00000000-0000-0000-0000-000000000000/execute')).status()).toBe(404);
  expect((await anon.post(`api-requests/${id}/execute`)).status()).toBe(401);
});
