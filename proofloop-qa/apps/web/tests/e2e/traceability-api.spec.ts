import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma, type Role } from '@proofloop/prisma';

/**
 * Traceability Matrix API regression: shape, ordering, coverage flags,
 * nested ordering, tenancy, and that the /api mount stays non-invasive.
 */

const API = 'http://localhost:4000/api/';
const runId = Date.now();
const ORG_PREFIX = `E2E RtmOrg ${runId}`;

test.describe.configure({ mode: 'serial' });

let anon: APIRequestContext;
let admin: APIRequestContext;
let viewer: APIRequestContext;
let other: APIRequestContext;
let projectId: string;
let emptyProjectId: string;
let reqIds: Record<string, string>;

type MatrixRow = {
  id: string;
  reqId: string;
  module: { id: string; name: string };
  risks: { title: string; level: string; riskScore: number }[];
  testCases: { tcId: string; testType: string; automationStatus: string }[];
  hasTestCoverage: boolean;
  hasRisksIdentified: boolean;
};

async function register(tag: string) {
  const res = await anon.post('auth/register', {
    data: {
      email: `e2e-rtm-${tag}-${runId}@example.com`,
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

test.beforeAll(async () => {
  anon = await request.newContext({ baseURL: API });
  const a = await register('admin');
  admin = await client(a.token);
  const v = await register('viewer');
  await prisma.user.update({ where: { id: v.id }, data: { role: 'VIEWER' as Role, organizationId: a.organizationId } });
  viewer = await client(v.token);
  other = await client((await register('other')).token);

  projectId = (await (await admin.post('projects', { data: { name: 'RTM Project' } })).json()).id;
  emptyProjectId = (await (await admin.post('projects', { data: { name: 'RTM Empty' } })).json()).id;

  // Modules created in non-alphabetical order to prove module-name ordering.
  const zeta = (await (await admin.post(`projects/${projectId}/modules`, { data: { name: 'Zeta' } })).json()).id;
  const alpha = (await (await admin.post(`projects/${projectId}/modules`, { data: { name: 'Alpha' } })).json()).id;

  const mkReq = async (moduleId: string, reqId: string) =>
    (
      await (
        await admin.post(`modules/${moduleId}/requirements`, {
          data: { reqId, title: `${reqId} title`, description: 'd', priority: 'HIGH', businessCriticality: 'HIGH' },
        })
      ).json()
    ).id as string;

  reqIds = {
    'REQ-Z1': await mkReq(zeta, 'REQ-Z1'),
    'REQ-A2': await mkReq(alpha, 'REQ-A2'),
    'REQ-A1': await mkReq(alpha, 'REQ-A1'),
  };

  // REQ-A1: two risks (scores 4 and 20), two test cases (created out of tcId order).
  for (const [title, p, i] of [['Low risk', 2, 2], ['Critical risk', 4, 5]] as const) {
    await admin.post(`requirements/${reqIds['REQ-A1']}/risks`, { data: { title, description: 'd', probability: p, impact: i } });
  }
  for (const tcId of ['TC-B', 'TC-A']) {
    await admin.post(`projects/${projectId}/test-cases`, {
      data: { tcId, title: `${tcId} title`, priority: 'HIGH', testType: 'UI', automationStatus: 'MANUAL', requirementId: reqIds['REQ-A1'] },
    });
  }
  // REQ-Z1: test case only. REQ-A2: nothing.
  await admin.post(`projects/${projectId}/test-cases`, {
    data: { tcId: 'TC-Z', title: 'z', priority: 'LOW', testType: 'API', automationStatus: 'AUTOMATED', requirementId: reqIds['REQ-Z1'] },
  });
  // Standalone test case: must not appear in the matrix.
  await admin.post(`projects/${projectId}/test-cases`, {
    data: { tcId: 'TC-STANDALONE', title: 's', priority: 'LOW', testType: 'UI', automationStatus: 'MANUAL' },
  });
});

test.afterAll(async () => {
  await Promise.all([anon, admin, viewer, other].map((c) => c?.dispose()));
  await prisma.organization.deleteMany({ where: { name: { startsWith: ORG_PREFIX } } });
  await prisma.$disconnect();
});

test('rows ordered by module name, then reqId', async () => {
  const res = await viewer.get(`projects/${projectId}/traceability`);
  expect(res.status()).toBe(200);
  const rows: MatrixRow[] = await res.json();
  expect(rows.map((r) => `${r.module.name}/${r.reqId}`)).toEqual(['Alpha/REQ-A1', 'Alpha/REQ-A2', 'Zeta/REQ-Z1']);
});

test('coverage flags reflect linked test cases and risks', async () => {
  const rows: MatrixRow[] = await (await viewer.get(`projects/${projectId}/traceability`)).json();
  const by = Object.fromEntries(rows.map((r) => [r.reqId, r]));
  expect([by['REQ-A1'].hasTestCoverage, by['REQ-A1'].hasRisksIdentified]).toEqual([true, true]);
  expect([by['REQ-A2'].hasTestCoverage, by['REQ-A2'].hasRisksIdentified]).toEqual([false, false]);
  expect([by['REQ-Z1'].hasTestCoverage, by['REQ-Z1'].hasRisksIdentified]).toEqual([true, false]);
});

test('nested risks sorted by score desc; test cases sorted by tcId; standalone excluded', async () => {
  const rows: MatrixRow[] = await (await viewer.get(`projects/${projectId}/traceability`)).json();
  const a1 = rows.find((r) => r.reqId === 'REQ-A1')!;
  expect(a1.risks.map((r) => [r.title, r.riskScore, r.level])).toEqual([
    ['Critical risk', 20, 'CRITICAL'],
    ['Low risk', 4, 'LOW'],
  ]);
  expect(a1.testCases.map((t) => t.tcId)).toEqual(['TC-A', 'TC-B']);
  const allTcIds = rows.flatMap((r) => r.testCases.map((t) => t.tcId));
  expect(allTcIds).not.toContain('TC-STANDALONE');
  // Nested selects stay minimal.
  expect(Object.keys(a1.risks[0]).sort()).toEqual(['id', 'level', 'riskScore', 'title']);
  expect(Object.keys(a1.testCases[0]).sort()).toEqual(['automationStatus', 'id', 'tcId', 'testType', 'title']);
});

test('empty project returns []', async () => {
  const res = await admin.get(`projects/${emptyProjectId}/traceability`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual([]);
});

test('other org / unknown project 404; no token 401', async () => {
  expect((await other.get(`projects/${projectId}/traceability`)).status()).toBe(404);
  expect((await admin.get('projects/not-a-real-id/traceability')).status()).toBe(404);
  expect((await anon.get(`projects/${projectId}/traceability`)).status()).toBe(401);
});

test('/api/health still public and unknown /api paths still 404', async () => {
  expect((await anon.get('health')).status()).toBe(200);
  expect((await anon.get('definitely-not-a-route')).status()).toBe(404);
});
