import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma, type Role } from '@proofloop/prisma';

/**
 * Module 5 API regression: Automation Lab backend.
 * Automation projects (validation, URL safety, uniqueness), execution triggers
 * (sequential run IDs incl. concurrency, environment scoping), RBAC, tenancy.
 * Environments have no API yet, so they are seeded directly via Prisma.
 */

const API = 'http://localhost:4000/api/';
const runId = Date.now();
const ORG_PREFIX = `E2E AutoOrg ${runId}`;

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
let autoId: string;
let ownEnvId: string;
let project2EnvId: string;
let otherOrgEnvId: string;

async function register(tag: string) {
  const res = await anon.post('auth/register', {
    data: {
      email: `e2e-auto-${tag}-${runId}@example.com`,
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

test.beforeAll(async () => {
  anon = await request.newContext({ baseURL: API });
  const a = await register('admin');
  orgAId = a.organizationId;
  admin = await client(a.token);
  engineer = await memberOfOrgA('QA_ENGINEER');
  viewer = await memberOfOrgA('VIEWER');
  other = await client((await register('other')).token);

  projectId = (await (await admin.post('projects', { data: { name: 'Auto Project' } })).json()).id;
  project2Id = (await (await admin.post('projects', { data: { name: 'Auto Project 2' } })).json()).id;
  otherProjectId = (await (await other.post('projects', { data: { name: 'Other Auto' } })).json()).id;

  ownEnvId = (await prisma.projectEnvironment.create({ data: { name: 'STAGING', projectId } })).id;
  project2EnvId = (await prisma.projectEnvironment.create({ data: { name: 'UAT', projectId: project2Id } })).id;
  otherOrgEnvId = (await prisma.projectEnvironment.create({ data: { name: 'PROD', projectId: otherProjectId } })).id;
});

test.afterAll(async () => {
  await Promise.all([anon, admin, engineer, viewer, other].map((c) => c?.dispose()));
  await prisma.organization.deleteMany({ where: { name: { startsWith: ORG_PREFIX } } });
  await prisma.$disconnect();
});

// ---------- Automation projects ----------

test('create automation project: trimmed fields, PLAYWRIGHT default, empty repository -> null', async () => {
  const res = await admin.post(`projects/${projectId}/automation`, {
    data: { name: '  Smoke Suite  ', repository: '  https://github.com/acme/smoke  ', branch: ' main ' },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  autoId = body.id;
  expect(body).toMatchObject({
    name: 'Smoke Suite',
    repository: 'https://github.com/acme/smoke',
    branch: 'main',
    framework: 'PLAYWRIGHT',
    projectId,
  });

  const res2 = await admin.post(`projects/${projectId}/automation`, { data: { name: 'Regression', repository: '' } });
  expect(res2.status()).toBe(201);
  expect((await res2.json()).repository).toBeNull();
});

test('repository must be an http(s) URL (javascript:, file:, garbage rejected)', async () => {
  for (const repository of ['javascript:alert(1)', 'file:///etc/passwd', 'not a url', 'ftp://example.com/repo']) {
    const res = await admin.post(`projects/${projectId}/automation`, { data: { name: `Bad ${repository}`, repository } });
    expect(res.status(), repository).toBe(400);
    expect((await res.json()).details.repository).toEqual(['Must be a valid HTTP or HTTPS URL']);
  }
});

test('blank name rejected; duplicate name in same project 409, allowed in another project', async () => {
  const blank = await admin.post(`projects/${projectId}/automation`, { data: { name: '   ' } });
  expect(blank.status()).toBe(400);
  expect((await blank.json()).details.name).toEqual(['Automation project name is required']);

  const dup = await admin.post(`projects/${projectId}/automation`, { data: { name: 'Smoke Suite' } });
  expect(dup.status()).toBe(409);
  expect((await dup.json()).error).toBe('An automation project with this name already exists');

  expect((await admin.post(`projects/${project2Id}/automation`, { data: { name: 'Smoke Suite' } })).status()).toBe(201);
});

// ---------- Executions ----------

test('trigger: PENDING, default MANUAL trigger, sequential RUN-001 / RUN-002', async () => {
  const r1 = await admin.post(`automation/${autoId}/executions`, { data: {} });
  expect(r1.status()).toBe(201);
  expect(await r1.json()).toMatchObject({ runId: 'RUN-001', status: 'PENDING', trigger: 'MANUAL', environmentId: null });

  const r2 = await engineer.post(`automation/${autoId}/executions`, { data: { trigger: 'CI_CD', environmentId: ownEnvId } });
  expect(r2.status()).toBe(201);
  expect(await r2.json()).toMatchObject({ runId: 'RUN-002', trigger: 'CI_CD', environmentId: ownEnvId });
});

test('concurrent triggers get unique, gap-free run IDs (no 500s)', async () => {
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => admin.post(`automation/${autoId}/executions`, { data: {} })),
  );
  expect(responses.map((r) => r.status())).toEqual([201, 201, 201, 201, 201]);
  const ids = (await Promise.all(responses.map((r) => r.json()))).map((e: { runId: string }) => e.runId).sort();
  expect(ids).toEqual(['RUN-003', 'RUN-004', 'RUN-005', 'RUN-006', 'RUN-007']);
});

test('environment from another project, another org, or unknown id is rejected (400)', async () => {
  for (const environmentId of [project2EnvId, otherOrgEnvId, 'not-a-real-id']) {
    const res = await admin.post(`automation/${autoId}/executions`, { data: { environmentId } });
    expect(res.status(), environmentId).toBe(400);
    expect((await res.json()).details).toEqual({ environmentId: ['Invalid environment for this project'] });
  }
  expect(await prisma.automationExecution.count({ where: { automationProjectId: autoId } })).toBe(7);
});

test('invalid trigger value rejected', async () => {
  const res = await admin.post(`automation/${autoId}/executions`, { data: { trigger: 'NIGHTLY' } });
  expect(res.status()).toBe(400);
  expect((await res.json()).details.trigger).toBeDefined();
});

// ---------- List ----------

test('list: newest first with execution counts; VIEWER can read', async () => {
  const res = await viewer.get(`projects/${projectId}/automation`);
  expect(res.status()).toBe(200);
  const list = await res.json();
  expect(list.map((a: { name: string }) => a.name)).toEqual(['Regression', 'Smoke Suite']);
  expect(list.find((a: { name: string }) => a.name === 'Smoke Suite')._count).toEqual({ executions: 7 });
});

// ---------- Executions list ----------

test('executions list: newest first, environment name included; VIEWER can read', async () => {
  const res = await viewer.get(`automation/${autoId}/executions`);
  expect(res.status()).toBe(200);
  const list = await res.json();
  expect(list).toHaveLength(7);
  const created = list.map((e: { createdAt: string }) => e.createdAt);
  expect(created).toEqual([...created].sort().reverse());
  const run2 = list.find((e: { runId: string }) => e.runId === 'RUN-002');
  expect(run2.projectEnvironment).toEqual({ name: 'STAGING' });
  expect(list.find((e: { runId: string }) => e.runId === 'RUN-001').projectEnvironment).toBeNull();
});

test('executions list is capped at the 50 most recent', async () => {
  const bulk = await admin.post(`projects/${projectId}/automation`, { data: { name: 'Bulk' } });
  const bulkId = (await bulk.json()).id;
  await prisma.automationExecution.createMany({
    data: Array.from({ length: 55 }, (_, i) => ({
      runId: `RUN-${String(i + 1).padStart(3, '0')}`,
      status: 'PASSED',
      trigger: 'MANUAL',
      automationProjectId: bulkId,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
    })),
  });
  const list = await (await admin.get(`automation/${bulkId}/executions`)).json();
  expect(list).toHaveLength(50);
  expect(list[0].runId).toBe('RUN-055');
  expect(list[49].runId).toBe('RUN-006');
});

test('executions list: other org / unknown 404, no token 401', async () => {
  expect((await other.get(`automation/${autoId}/executions`)).status()).toBe(404);
  expect((await admin.get('automation/not-a-real-id/executions')).status()).toBe(404);
  expect((await anon.get(`automation/${autoId}/executions`)).status()).toBe(401);
});

// ---------- Environments API ----------

test('create environment: name trimmed + uppercased, baseUrl trimmed, empty baseUrl -> null', async () => {
  const res = await engineer.post(`projects/${project2Id}/environments`, {
    data: { name: '  qa  ', baseUrl: '  https://qa.example.com  ' },
  });
  expect(res.status()).toBe(201);
  expect(await res.json()).toMatchObject({ name: 'QA', baseUrl: 'https://qa.example.com', projectId: project2Id });

  const res2 = await admin.post(`projects/${project2Id}/environments`, { data: { name: 'dev', baseUrl: '' } });
  expect(res2.status()).toBe(201);
  expect((await res2.json()).baseUrl).toBeNull();
});

test('environment validation: blank name, unsafe or invalid baseUrl', async () => {
  const blank = await admin.post(`projects/${project2Id}/environments`, { data: { name: '   ' } });
  expect(blank.status()).toBe(400);
  expect((await blank.json()).details.name).toEqual(['Environment name is required']);

  for (const baseUrl of ['javascript:alert(1)', 'file:///etc/passwd', 'not a url']) {
    const res = await admin.post(`projects/${project2Id}/environments`, { data: { name: 'BAD', baseUrl } });
    expect(res.status(), baseUrl).toBe(400);
    expect((await res.json()).details.baseUrl).toEqual(['Must be a valid HTTP or HTTPS URL']);
  }
});

test('duplicate environment name (case-insensitive) returns 409', async () => {
  const res = await admin.post(`projects/${project2Id}/environments`, { data: { name: 'Qa' } });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toBe('An environment with this name already exists in this project');
});

test('environments list sorted by name; created environment usable for a run', async () => {
  const list = await (await viewer.get(`projects/${project2Id}/environments`)).json();
  expect(list.map((e: { name: string }) => e.name)).toEqual(['DEV', 'QA', 'UAT']);

  const auto2 = await admin.post(`projects/${project2Id}/automation`, { data: { name: 'Env Suite' } });
  const qaEnv = list.find((e: { name: string }) => e.name === 'QA');
  const run = await admin.post(`automation/${(await auto2.json()).id}/executions`, { data: { environmentId: qaEnv.id } });
  expect(run.status()).toBe(201);
  expect((await run.json()).environmentId).toBe(qaEnv.id);
});

test('environments RBAC & tenancy: VIEWER 403 create, other org 404, no token 401', async () => {
  expect((await viewer.post(`projects/${project2Id}/environments`, { data: { name: 'V' } })).status()).toBe(403);
  expect((await other.get(`projects/${project2Id}/environments`)).status()).toBe(404);
  expect((await other.post(`projects/${project2Id}/environments`, { data: { name: 'X' } })).status()).toBe(404);
  expect((await anon.get(`projects/${project2Id}/environments`)).status()).toBe(401);
});

// ---------- RBAC & tenancy ----------

test('VIEWER cannot create or trigger (403)', async () => {
  expect((await viewer.post(`projects/${projectId}/automation`, { data: { name: 'V' } })).status()).toBe(403);
  expect((await viewer.post(`automation/${autoId}/executions`, { data: {} })).status()).toBe(403);
});

test('other org: 404 on list, create and trigger; no token 401', async () => {
  expect((await other.get(`projects/${projectId}/automation`)).status()).toBe(404);
  expect((await other.post(`projects/${projectId}/automation`, { data: { name: 'X' } })).status()).toBe(404);
  expect((await other.post(`automation/${autoId}/executions`, { data: {} })).status()).toBe(404);
  expect((await anon.get(`projects/${projectId}/automation`)).status()).toBe(401);
  expect((await anon.post(`automation/${autoId}/executions`, { data: {} })).status()).toBe(401);
});

test('unknown automation project 404', async () => {
  expect((await admin.post('automation/not-a-real-id/executions', { data: {} })).status()).toBe(404);
});

// ---------- Data model ----------

test('deleting an environment keeps its executions (environmentId set to null)', async () => {
  await prisma.projectEnvironment.delete({ where: { id: ownEnvId } });
  const run2 = await prisma.automationExecution.findFirstOrThrow({ where: { automationProjectId: autoId, runId: 'RUN-002' } });
  expect(run2.environmentId).toBeNull();
});

test('/api/health still public and unknown /api paths still 404', async () => {
  expect((await anon.get('health')).status()).toBe(200);
  expect((await anon.get('definitely-not-a-route')).status()).toBe(404);
});
