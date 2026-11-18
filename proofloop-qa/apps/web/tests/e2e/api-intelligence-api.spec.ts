import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma, type Role } from '@proofloop/prisma';

/**
 * Module 6 API regression: API Intelligence backend.
 * Collections (validation, uniqueness), requests (method enum, JSON fields, body
 * preservation, server-assigned sequence incl. concurrency), RBAC, tenancy.
 */

const API = 'http://localhost:4000/api/';
const runId = Date.now();
const ORG_PREFIX = `E2E ApiIntel ${runId}`;

test.describe.configure({ mode: 'serial' });

let anon: APIRequestContext;
let admin: APIRequestContext;
let engineer: APIRequestContext;
let viewer: APIRequestContext;
let other: APIRequestContext;
let orgAId: string;
let projectId: string;
let project2Id: string;
let otherProjectId: string;
let collectionId: string;
let otherCollectionId: string;

async function register(tag: string) {
  const res = await anon.post('auth/register', {
    data: {
      email: `e2e-apiintel-${tag}-${runId}@example.com`,
      password: 'Passw0rd!',
      firstName: 'E2E',
      lastName: tag,
      organizationName: `${ORG_PREFIX} ${tag}`,
    },
  });
  expect(res.status()).toBe(201);
  const { user, token } = await res.json();
  return { id: user.id as string, organizationId: user.organizationId as string, token: token as string };
}

const client = (token: string) =>
  request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

async function memberOfOrgA(role: Role) {
  const u = await register(role.toLowerCase());
  await prisma.user.update({ where: { id: u.id }, data: { role, organizationId: orgAId } });
  return client(u.token);
}

const minimalRequest = (name: string) => ({ name, method: 'GET', endpoint: '/health' });

test.beforeAll(async () => {
  anon = await request.newContext({ baseURL: API });
  const a = await register('admin');
  orgAId = a.organizationId;
  admin = await client(a.token);
  engineer = await memberOfOrgA('QA_ENGINEER');
  viewer = await memberOfOrgA('VIEWER');
  other = await client((await register('other')).token);

  projectId = (await (await admin.post('projects', { data: { name: 'API Project' } })).json()).id;
  project2Id = (await (await admin.post('projects', { data: { name: 'API Project 2' } })).json()).id;
  otherProjectId = (await (await other.post('projects', { data: { name: 'Other API' } })).json()).id;
  otherCollectionId = (
    await (await other.post(`projects/${otherProjectId}/api-collections`, { data: { name: 'Other Coll' } })).json()
  ).id;
});

test.afterAll(async () => {
  await Promise.all([anon, admin, engineer, viewer, other].map((c) => c?.dispose()));
  await prisma.organization.deleteMany({ where: { name: { startsWith: ORG_PREFIX } } });
  await prisma.$disconnect();
});

// ---------- Collections ----------

test('create collection: name/description trimmed, empty description -> null', async () => {
  const res = await admin.post(`projects/${projectId}/api-collections`, {
    data: { name: '  Users API  ', description: '  CRUD for users  ' },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body).toMatchObject({ name: 'Users API', description: 'CRUD for users', projectId });
  collectionId = body.id;

  const res2 = await admin.post(`projects/${projectId}/api-collections`, { data: { name: 'Auth API', description: '   ' } });
  expect(res2.status()).toBe(201);
  expect((await res2.json()).description).toBeNull();
});

test('collection validation: blank name 400; duplicate 409; same name in another project allowed', async () => {
  const blank = await admin.post(`projects/${projectId}/api-collections`, { data: { name: '   ' } });
  expect(blank.status()).toBe(400);
  expect((await blank.json()).details.name).toEqual(['Collection name is required']);

  const dup = await admin.post(`projects/${projectId}/api-collections`, { data: { name: 'Users API' } });
  expect(dup.status()).toBe(409);
  expect(await dup.json()).toEqual({ error: 'An API Collection with this name already exists in this project' });

  expect((await admin.post(`projects/${project2Id}/api-collections`, { data: { name: 'Users API' } })).status()).toBe(201);
});

// ---------- Requests ----------

test('create request: defaults for JSON fields, omitted body stored as null, sequence 1', async () => {
  const res = await admin.post(`api-collections/${collectionId}/requests`, {
    data: { name: '  List users ', method: 'GET', endpoint: ' /users ' },
  });
  expect(res.status()).toBe(201);
  expect(await res.json()).toMatchObject({
    name: 'List users',
    method: 'GET',
    endpoint: '/users',
    headers: {},
    queryParams: {},
    auth: { type: 'none' },
    assertions: [],
    body: null,
    sequenceNumber: 1,
    collectionId,
  });
});

test('create request: headers, query params, JSON body, auth and assertions stored as sent', async () => {
  const payload = {
    name: 'Create user',
    method: 'POST',
    endpoint: '{{baseUrl}}/users',
    headers: { 'Content-Type': 'application/json', 'X-Trace': 'abc' },
    queryParams: { notify: 'true' },
    body: { email: 'a@example.com', roles: ['QA'], profile: { age: 30 } },
    auth: { type: 'bearer', token: '{{API_TOKEN}}' },
    assertions: [
      { type: 'status', operator: 'equals', value: 201 },
      { type: 'body', path: '$.id', operator: 'exists' },
      { type: 'header', path: 'content-type', operator: 'contains', value: 'json' },
      { type: 'responseTime', operator: 'less_than', value: 500 },
    ],
  };
  const res = await admin.post(`api-collections/${collectionId}/requests`, { data: payload });
  expect(res.status()).toBe(201);
  expect(await res.json()).toMatchObject({ ...payload, sequenceNumber: 2 });
});

test('falsy bodies are preserved (0, false, "", []) and JSON null is stored as null', async () => {
  const cases: [string, unknown][] = [
    ['zero', 0],
    ['false', false],
    ['empty string', ''],
    ['empty array', []],
    ['null', null],
  ];
  for (const [name, body] of cases) {
    const res = await admin.post(`api-collections/${collectionId}/requests`, {
      data: { name: `Body ${name}`, method: 'PUT', endpoint: '/x', body },
    });
    expect(res.status(), name).toBe(201);
    expect((await res.json()).body, name).toEqual(body);
  }
});

test('request validation: method enum, blank name/endpoint, non-string header values', async () => {
  const badMethod = await admin.post(`api-collections/${collectionId}/requests`, {
    data: { name: 'x', method: 'FETCH', endpoint: '/x' },
  });
  expect(badMethod.status()).toBe(400);
  expect((await badMethod.json()).details.method).toEqual(['Invalid HTTP method']);

  const blanks = await admin.post(`api-collections/${collectionId}/requests`, {
    data: { name: '  ', method: 'GET', endpoint: '   ' },
  });
  expect(blanks.status()).toBe(400);
  const details = (await blanks.json()).details;
  expect(details.name).toEqual(['Request name is required']);
  expect(details.endpoint).toEqual(['Endpoint URL is required']);

  const badHeader = await admin.post(`api-collections/${collectionId}/requests`, {
    data: { name: 'x', method: 'GET', endpoint: '/x', headers: { 'X-Num': 5 } },
  });
  expect(badHeader.status()).toBe(400);

  const badAssertions = await admin.post(`api-collections/${collectionId}/requests`, {
    data: { name: 'x', method: 'GET', endpoint: '/x', assertions: { type: 'status' } },
  });
  expect(badAssertions.status()).toBe(400);
});

test('auth schema: each type requires its own fields; unknown keys stripped; apiKey defaults to header', async () => {
  const post = (auth: unknown) =>
    admin.post(`api-collections/${collectionId}/requests`, { data: { name: 'auth', method: 'GET', endpoint: '/x', auth } });

  for (const bad of [
    { type: 'bearer' },
    { type: 'bearer', token: '   ' },
    { type: 'basic', password: 'p' },
    { type: 'basic', username: 'u' },
    { type: 'apiKey', key: 'X-API-Key' },
    { type: 'apiKey', key: 'k', value: 'v', in: 'cookie' },
    { type: 'oauth2', token: 't' },
    {},
  ]) {
    const res = await post(bad);
    expect(res.status(), JSON.stringify(bad)).toBe(400);
  }

  // Empty basic password is valid (RFC 7617); created requests are removed again to keep counts stable.
  const basic = await post({ type: 'basic', username: 'u', password: '' });
  expect(basic.status()).toBe(201);
  const apiKey = await post({ type: 'apiKey', key: 'X-API-Key', value: '{{API_KEY}}', extra: 'dropped' });
  expect(apiKey.status()).toBe(201);
  expect((await apiKey.json()).auth).toEqual({ type: 'apiKey', key: 'X-API-Key', value: '{{API_KEY}}', in: 'header' });
  await prisma.apiRequest.deleteMany({ where: { id: { in: [(await basic.json()).id, (await apiKey.json()).id] } } });
});

test('assertion schema: path for header/body, value unless exists, numeric value for comparisons', async () => {
  const post = (assertions: unknown) =>
    admin.post(`api-collections/${collectionId}/requests`, { data: { name: 'assert', method: 'GET', endpoint: '/x', assertions } });

  const cases: [unknown, string][] = [
    [{ type: 'status', value: 200 }, 'operator missing'],
    [{ type: 'jsonPath', operator: 'exists' }, 'unknown type'],
    [{ type: 'body', operator: 'exists' }, 'body without path'],
    [{ type: 'header', operator: 'equals', value: 'x' }, 'header without path'],
    [{ type: 'status', operator: 'equals' }, 'equals without value'],
    [{ type: 'responseTime', operator: 'less_than', value: 'abc' }, 'non-numeric for less_than'],
    [{ type: 'status', operator: 'matches', value: 200 }, 'unknown operator'],
    [{ type: 'body', path: '$.a', operator: 'equals', value: { nested: true } }, 'object value'],
  ];
  for (const [assertion, label] of cases) {
    const res = await post([assertion]);
    expect(res.status(), label).toBe(400);
  }

  const ok = await post([{ type: 'header', path: 'x-request-id', operator: 'exists' }]);
  expect(ok.status()).toBe(201);
  await prisma.apiRequest.delete({ where: { id: (await ok.json()).id } });
});

test('typed assertions are validated and stored normalised (dataType + typed value)', async () => {
  const post = (assertions: unknown) =>
    admin.post(`api-collections/${collectionId}/requests`, { data: { name: 'typed', method: 'GET', endpoint: '/x', assertions } });

  for (const [assertion, message] of [
    [{ type: 'status', operator: 'equals', value: 200, dataType: 'string' }, 'status requires dataType number'],
    [{ type: 'body', path: '$.a', operator: 'greater_than', value: 1, dataType: 'boolean' }, 'greater_than requires dataType number'],
    [{ type: 'body', path: '$.a', operator: 'contains', value: 'x', dataType: 'number' }, 'contains requires dataType string'],
    [{ type: 'body', path: '$.a', operator: 'equals', value: 'yes', dataType: 'boolean' }, 'value must be a boolean (true or false)'],
    [{ type: 'body', path: '$.a', operator: 'equals', value: 'abc', dataType: 'number' }, 'value must be a number'],
    [{ type: 'body', path: '$.a', operator: 'equals', value: 'x', dataType: 'null' }, 'value must be empty for dataType null'],
    [{ type: 'body', path: '$.a', operator: 'equals', dataType: 'pumpkin', value: 'x' }, undefined],
  ] as [Record<string, unknown>, string | undefined][]) {
    const res = await post([assertion]);
    expect(res.status(), JSON.stringify(assertion)).toBe(400);
    if (message) expect(JSON.stringify(await res.json()), JSON.stringify(assertion)).toContain(message);
  }

  const ok = await post([
    { type: 'body', path: '$.a', operator: 'equals', value: 'TRUE', dataType: 'boolean' },
    { type: 'body', path: '$.b', operator: 'equals', value: '42', dataType: 'number' },
    { type: 'body', path: '$.c', operator: 'equals', value: '', dataType: 'null' },
    { type: 'body', path: '$.d', operator: 'not_equals', value: 7 }, // no dataType: inferred
    { type: 'status', operator: 'equals', value: '201' }, // numeric-only: text converted
    { type: 'body', path: '$.e', operator: 'exists', value: 'ignored', dataType: 'string' },
  ]);
  expect(ok.status()).toBe(201);
  const saved = await ok.json();
  expect(saved.assertions).toEqual([
    { type: 'body', path: '$.a', operator: 'equals', value: true, dataType: 'boolean' },
    { type: 'body', path: '$.b', operator: 'equals', value: 42, dataType: 'number' },
    { type: 'body', path: '$.c', operator: 'equals', value: null, dataType: 'null' },
    { type: 'body', path: '$.d', operator: 'not_equals', value: 7, dataType: 'number' },
    { type: 'status', operator: 'equals', value: 201, dataType: 'number' },
    { type: 'body', path: '$.e', operator: 'exists' },
  ]);
  await prisma.apiRequest.delete({ where: { id: saved.id } }); // keep later counts stable
});

test('list requests: ordered by sequence 1..n; collection list shows request counts, sorted by name', async () => {
  const list = await (await admin.get(`api-collections/${collectionId}/requests`)).json();
  expect(list.map((r: { sequenceNumber: number }) => r.sequenceNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(list[0].name).toBe('List users');
  expect(list[1].name).toBe('Create user');

  const colls = await (await admin.get(`projects/${projectId}/api-collections`)).json();
  expect(colls.map((c: { name: string; _count: { requests: number } }) => [c.name, c._count.requests])).toEqual([
    ['Auth API', 0],
    ['Users API', 7],
  ]);
});

test('concurrent request creation gets unique, gap-free sequence numbers (no 500s)', async () => {
  const fresh = (await (await admin.post(`projects/${projectId}/api-collections`, { data: { name: 'Concurrency' } })).json()).id;
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) => admin.post(`api-collections/${fresh}/requests`, { data: minimalRequest(`R${i}`) })),
  );
  expect(results.map((r) => r.status())).toEqual([201, 201, 201, 201, 201]);
  const seqs = (await Promise.all(results.map((r) => r.json()))).map((r) => r.sequenceNumber).sort();
  expect(seqs).toEqual([1, 2, 3, 4, 5]);
});

// ---------- RBAC & tenancy ----------

test('QA_ENGINEER can create; VIEWER can read but gets 403 on create', async () => {
  expect((await engineer.post(`projects/${projectId}/api-collections`, { data: { name: 'Eng Coll' } })).status()).toBe(201);
  expect((await engineer.post(`api-collections/${collectionId}/requests`, { data: minimalRequest('Eng req') })).status()).toBe(201);

  expect((await viewer.get(`projects/${projectId}/api-collections`)).status()).toBe(200);
  expect((await viewer.get(`api-collections/${collectionId}/requests`)).status()).toBe(200);
  expect((await viewer.post(`projects/${projectId}/api-collections`, { data: { name: 'V' } })).status()).toBe(403);
  expect((await viewer.post(`api-collections/${collectionId}/requests`, { data: minimalRequest('V') })).status()).toBe(403);
});

test('other org: 404 on project collections and on collection requests (read and write)', async () => {
  expect((await admin.get(`projects/${otherProjectId}/api-collections`)).status()).toBe(404);
  expect((await admin.post(`projects/${otherProjectId}/api-collections`, { data: { name: 'Steal' } })).status()).toBe(404);
  expect((await admin.get(`api-collections/${otherCollectionId}/requests`)).status()).toBe(404);
  expect((await admin.post(`api-collections/${otherCollectionId}/requests`, { data: minimalRequest('Steal') })).status()).toBe(404);
  expect(await prisma.apiRequest.count({ where: { collectionId: otherCollectionId } })).toBe(0);
});

test('unknown ids 404; no token 401', async () => {
  const unknown = '00000000-0000-0000-0000-000000000000';
  expect((await admin.get(`projects/${unknown}/api-collections`)).status()).toBe(404);
  const notFound = await admin.get(`api-collections/${unknown}/requests`);
  expect(notFound.status()).toBe(404);
  expect(await notFound.json()).toEqual({ error: 'API Collection not found' });
  expect((await anon.get(`projects/${projectId}/api-collections`)).status()).toBe(401);
  expect((await anon.get(`api-collections/${collectionId}/requests`)).status()).toBe(401);
  expect((await anon.post(`api-collections/${collectionId}/requests`, { data: minimalRequest('x') })).status()).toBe(401);
});

// ---------- Secret redaction for VIEWERs (API-05) ----------

test('VIEWER gets credentials redacted; writers get raw values; stored data unchanged', async () => {
  const secretsId = (await (await admin.post(`projects/${projectId}/api-collections`, { data: { name: 'Secrets' } })).json()).id;
  const bearer = {
    name: 'Bearer',
    method: 'GET',
    endpoint: '/me',
    headers: { Authorization: 'Bearer raw-1', 'X-API-Key': 'raw-2', Cookie: 'sid=raw-3', 'X-Auth-Token': 'raw-4', Accept: 'application/json' },
    queryParams: { api_key: 'raw-5', access_token: 'raw-6', page: '2' },
    auth: { type: 'bearer', token: 'raw-7' },
  };
  const basic = { name: 'Basic', method: 'GET', endpoint: '/b', auth: { type: 'basic', username: 'alice', password: 'raw-8' } };
  const apiKey = { name: 'ApiKey', method: 'GET', endpoint: '/k', auth: { type: 'apiKey', key: 'api_key', value: 'raw-9', in: 'query' } };
  for (const r of [bearer, basic, apiKey]) {
    expect((await admin.post(`api-collections/${secretsId}/requests`, { data: r })).status()).toBe(201);
  }

  const asViewer = await (await viewer.get(`api-collections/${secretsId}/requests`)).json();
  expect(JSON.stringify(asViewer)).not.toMatch(/raw-\d/);
  expect(asViewer[0].headers).toEqual({
    Authorization: '********',
    'X-API-Key': '********',
    Cookie: '********',
    'X-Auth-Token': '********',
    Accept: 'application/json', // non-sensitive values stay readable
  });
  expect(asViewer[0].queryParams).toEqual({ api_key: '********', access_token: '********', page: '2' });
  expect(asViewer[0].auth).toEqual({ type: 'bearer', token: '********' });
  expect(asViewer[1].auth).toEqual({ type: 'basic', username: 'alice', password: '********' });
  expect(asViewer[2].auth).toEqual({ type: 'apiKey', key: 'api_key', value: '********', in: 'query' });

  for (const writer of [admin, engineer]) {
    const raw = await (await writer.get(`api-collections/${secretsId}/requests`)).json();
    expect(raw[0].headers.Authorization).toBe('Bearer raw-1');
    expect(raw[0].auth.token).toBe('raw-7');
    expect(raw[1].auth.password).toBe('raw-8');
  }

  const stored = await prisma.apiRequest.findMany({ where: { collectionId: secretsId }, orderBy: { sequenceNumber: 'asc' } });
  expect(JSON.stringify(stored.map((s) => [s.headers, s.queryParams, s.auth]))).toMatch(/raw-1.*raw-7.*raw-8.*raw-9/);
});

test('deleting a project cascades to its collections, requests and executions', async () => {
  const req = await prisma.apiRequest.findFirstOrThrow({ where: { collectionId } });
  await prisma.apiExecution.create({ data: { status: 'PASSED', responseTime: 12, statusCode: 200, requestId: req.id } });
  await prisma.project.delete({ where: { id: projectId } });
  expect(await prisma.apiCollection.count({ where: { projectId } })).toBe(0);
  expect(await prisma.apiRequest.count({ where: { collectionId } })).toBe(0);
  expect(await prisma.apiExecution.count({ where: { requestId: req.id } })).toBe(0);
});

test('/api/health still public and unknown /api paths still 404', async () => {
  const health = await anon.get('health');
  expect(health.status()).toBe(200);
  expect((await anon.get('definitely-not-a-route')).status()).toBe(404);
});
