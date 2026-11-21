import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * Security E2E: Strict Multi-Tenant Data Isolation
 * Verifies that Tenant B cannot access, read, or modify resources belonging to Tenant A.
 */

const API = 'http://localhost:4000/api/';
const runId = Date.now();
const PASSWORD = 'Passw0rd!';

test.describe.configure({ mode: 'serial' });

let anon: APIRequestContext;
let clientA: APIRequestContext;
let clientB: APIRequestContext;

let userA: { id: string; organizationId: string; token: string };
let userB: { id: string; organizationId: string; token: string };
let projAId: string;
let reqAId: string;

async function register(tag: string) {
  const email = `tenant-${tag}-${runId}@example.com`;
  const res = await anon.post('auth/register', {
    data: {
      email,
      password: PASSWORD,
      firstName: 'Tenant',
      lastName: tag,
      organizationName: `Org ${tag} ${runId}`,
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  const ctx = await request.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${body.token}` },
  });
  return { id: body.user.id as string, organizationId: body.user.organizationId as string, token: body.token as string, ctx };
}

test.beforeAll(async () => {
  anon = await request.newContext({ baseURL: API });
  userA = await register('Alpha');
  clientA = userA.ctx;

  userB = await register('Beta');
  clientB = userB.ctx;

  // 1. Create Project and Requirement under Tenant A
  const pRes = await clientA.post('projects', { data: { name: 'Alpha Secret Project' } });
  expect(pRes.status()).toBe(201);
  projAId = (await pRes.json()).id;

  const rRes = await clientA.post(`projects/${projAId}/requirements`, {
    data: {
      reqId: 'REQ-ALPHA-01',
      title: 'Top Secret Requirement',
      description: 'Proprietary data for Tenant A only',
      priority: 'HIGH',
    },
  });
  expect(rRes.status()).toBe(201);
  reqAId = (await rRes.json()).id;
});

test.afterAll(async () => {
  await prisma.organization.deleteMany({
    where: { id: { in: [userA?.organizationId, userB?.organizationId].filter(Boolean) } },
  });
  await prisma.$disconnect();
});

test('Tenant B cannot read Tenant A project (404/403)', async () => {
  const res = await clientB.get(`projects/${projAId}`);
  expect([403, 404]).toContain(res.status());
});

test('Tenant B cannot read Tenant A requirements', async () => {
  const res = await clientB.get(`projects/${projAId}/requirements`);
  expect([403, 404]).toContain(res.status());
});

test('Tenant B cannot create defect in Tenant A project', async () => {
  const res = await clientB.post(`projects/${projAId}/defects`, {
    data: {
      bugId: 'BUG-INJECT-01',
      title: 'Malicious Cross-Tenant Defect',
      description: 'Attempting to inject into Tenant A',
      severity: 'CRITICAL',
      status: 'OPEN',
    },
  });
  expect([403, 404]).toContain(res.status());
});

test('Tenant B cannot access Tenant A requirement detail', async () => {
  const res = await clientB.get(`projects/${projAId}/requirements/${reqAId}`);
  expect([403, 404]).toContain(res.status());
});
