import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * Phase 2 API regression: projects and modules, including tenant isolation.
 * Talks to the API directly (started by playwright.config.ts webServer).
 */

const API = 'http://localhost:4000/api/';
const runId = Date.now();
const ORG_A = `E2E ProjOrg A ${runId}`;
const ORG_B = `E2E ProjOrg B ${runId}`;

test.describe.configure({ mode: 'serial' });

let anon: APIRequestContext;
let a: APIRequestContext; // org A user
let b: APIRequestContext; // org B user
let projectId: string;

async function registerClient(org: string, tag: string): Promise<APIRequestContext> {
  const res = await anon.post('auth/register', {
    data: {
      email: `e2e-${tag}-${runId}@example.com`,
      password: 'Passw0rd!',
      firstName: 'E2E',
      lastName: tag,
      organizationName: org,
    },
  });
  expect(res.status()).toBe(201);
  const { token } = await res.json();
  return request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}

test.beforeAll(async () => {
  anon = await request.newContext({ baseURL: API });
  a = await registerClient(ORG_A, 'a');
  b = await registerClient(ORG_B, 'b');
});

test.afterAll(async () => {
  await Promise.all([anon?.dispose(), a?.dispose(), b?.dispose()]);
  // Projects, modules and users cascade-delete with the organization.
  await prisma.organization.deleteMany({ where: { name: { in: [ORG_A, ORG_B] } } });
  await prisma.$disconnect();
});

test('requests without a token are rejected', async () => {
  expect((await anon.get('projects')).status()).toBe(401);
  expect((await anon.post('projects', { data: { name: 'x' } })).status()).toBe(401);
});

test('create project trims the name', async () => {
  const res = await a.post('projects', { data: { name: '  Alpha  ', description: '  d  ' } });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.name).toBe('Alpha');
  expect(body.description).toBe('d');
  projectId = body.id;
});

test('whitespace-only project name is rejected with field details', async () => {
  const res = await a.post('projects', { data: { name: '   ' } });
  expect(res.status()).toBe(400);
  expect(await res.json()).toEqual({
    error: 'Validation failed',
    details: { name: ['Project name is required'] },
  });
});

test('missing project name is rejected', async () => {
  const res = await a.post('projects', { data: {} });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(Array.isArray(body.details.name)).toBe(true);
});

test('projects are isolated per organization', async () => {
  const listA = await (await a.get('projects')).json();
  expect(listA.map((p: { id: string }) => p.id)).toEqual([projectId]);
  const listB = await (await b.get('projects')).json();
  expect(listB).toEqual([]);
});

test('create module in own project', async () => {
  const res = await a.post(`projects/${projectId}/modules`, { data: { name: ' Login ' } });
  expect(res.status()).toBe(201);
  expect((await res.json()).name).toBe('Login');
});

test('duplicate module name in same project returns 409', async () => {
  const res = await a.post(`projects/${projectId}/modules`, { data: { name: 'Login' } });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toBe('A module with this name already exists in this project');
});

test('whitespace-only module name is rejected', async () => {
  const res = await a.post(`projects/${projectId}/modules`, { data: { name: '   ' } });
  expect(res.status()).toBe(400);
  expect((await res.json()).details).toEqual({ name: ['Module name is required'] });
});

test("other organization cannot read or write this project's modules", async () => {
  expect((await b.post(`projects/${projectId}/modules`, { data: { name: 'X' } })).status()).toBe(404);
  expect((await b.get(`projects/${projectId}/modules`)).status()).toBe(404);
});

test('unknown project id returns 404', async () => {
  expect((await a.get('projects/not-a-real-id/modules')).status()).toBe(404);
});

test('list modules returns only the valid one', async () => {
  const res = await a.get(`projects/${projectId}/modules`);
  expect(res.status()).toBe(200);
  const names = (await res.json()).map((m: { name: string }) => m.name);
  expect(names).toEqual(['Login']);
});
