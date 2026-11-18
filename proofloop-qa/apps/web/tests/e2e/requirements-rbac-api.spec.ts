import { createHmac } from 'node:crypto';
import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma, type Role } from '@proofloop/prisma';

/**
 * Phase 2 API regression: role-based access on projects/modules/requirements,
 * and requirement CRUD rules.
 *
 * The API has no endpoint to create non-ADMIN users or change roles, so test
 * users are moved into org A and re-roled directly in the DB, then log in again
 * (role and organizationId are read from the JWT, so a fresh token is required).
 */

const API = 'http://localhost:4000/api/';
const runId = Date.now();
const PASSWORD = 'Passw0rd!';
const ORG_PREFIX = `E2E ReqOrg ${runId}`;

test.describe.configure({ mode: 'serial' });

let anon: APIRequestContext;
const clients: Partial<Record<Role | 'OTHER_ORG', APIRequestContext>> = {};
let orgAId: string;
let projectId: string;
let moduleId: string;
let module2Id: string;
let otherProjectModuleId: string;

async function register(tag: string): Promise<{ id: string; organizationId: string; email: string }> {
  const email = `e2e-req-${tag}-${runId}@example.com`;
  const res = await anon.post('auth/register', {
    data: { email, password: PASSWORD, firstName: 'E2E', lastName: tag, organizationName: `${ORG_PREFIX} ${tag}` },
  });
  expect(res.status()).toBe(201);
  const { user } = await res.json();
  return { ...user, email };
}

async function login(email: string): Promise<APIRequestContext> {
  const res = await anon.post('auth/login', { data: { email, password: PASSWORD } });
  expect(res.status()).toBe(200);
  const { token } = await res.json();
  return request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}

/** Register a user, move them into org A with `role`, and return a client with a fresh token. */
async function memberOfOrgA(role: Role): Promise<APIRequestContext> {
  const u = await register(role.toLowerCase());
  await prisma.user.update({ where: { id: u.id }, data: { role, organizationId: orgAId } });
  return login(u.email);
}

function c(key: Role | 'OTHER_ORG'): APIRequestContext {
  const client = clients[key];
  if (!client) throw new Error(`client ${key} not initialised`);
  return client;
}

const validReq = (reqId: string) => ({
  reqId,
  title: 'User can log in',
  description: 'Valid credentials grant access',
  priority: 'HIGH',
  businessCriticality: 'CRITICAL',
});

test.beforeAll(async () => {
  anon = await request.newContext({ baseURL: API });

  const admin = await register('admin');
  orgAId = admin.organizationId;
  clients.ADMIN = await login(admin.email);
  clients.QA_LEAD = await memberOfOrgA('QA_LEAD');
  clients.QA_ENGINEER = await memberOfOrgA('QA_ENGINEER');
  clients.VIEWER = await memberOfOrgA('VIEWER');

  const other = await register('other');
  clients.OTHER_ORG = await login(other.email);
});

test.afterAll(async () => {
  await Promise.all([anon?.dispose(), ...Object.values(clients).map((cl) => cl?.dispose())]);
  // Org A cascades its projects/modules/requirements and moved users.
  await prisma.organization.deleteMany({ where: { name: { startsWith: ORG_PREFIX } } });
  await prisma.$disconnect();
});

// ---------- RBAC: projects ----------

test('VIEWER cannot create a project (403)', async () => {
  const res = await c('VIEWER').post('projects', { data: { name: 'V' } });
  expect(res.status()).toBe(403);
});

test('QA_ENGINEER cannot create a project (403)', async () => {
  expect((await c('QA_ENGINEER').post('projects', { data: { name: 'E' } })).status()).toBe(403);
});

test('QA_LEAD can create a project (201)', async () => {
  const res = await c('QA_LEAD').post('projects', { data: { name: 'Lead Project' } });
  expect(res.status()).toBe(201);
});

test('ADMIN can create a project (201)', async () => {
  const res = await c('ADMIN').post('projects', { data: { name: 'Main Project' } });
  expect(res.status()).toBe(201);
  projectId = (await res.json()).id;
});

test('VIEWER can list projects (200)', async () => {
  const res = await c('VIEWER').get('projects');
  expect(res.status()).toBe(200);
  expect((await res.json()).length).toBe(2);
});

// ---------- RBAC: modules ----------

test('VIEWER cannot create a module (403)', async () => {
  expect((await c('VIEWER').post(`projects/${projectId}/modules`, { data: { name: 'V' } })).status()).toBe(403);
});

test('QA_ENGINEER can create a module (201)', async () => {
  const res = await c('QA_ENGINEER').post(`projects/${projectId}/modules`, { data: { name: 'Auth' } });
  expect(res.status()).toBe(201);
  moduleId = (await res.json()).id;

  const res2 = await c('ADMIN').post(`projects/${projectId}/modules`, { data: { name: 'Billing' } });
  expect(res2.status()).toBe(201);
  module2Id = (await res2.json()).id;
});

test('VIEWER can list modules (200)', async () => {
  expect((await c('VIEWER').get(`projects/${projectId}/modules`)).status()).toBe(200);
});

// ---------- RBAC: requirements ----------

test('VIEWER cannot create a requirement (403)', async () => {
  const res = await c('VIEWER').post(`modules/${moduleId}/requirements`, { data: validReq('REQ-V') });
  expect(res.status()).toBe(403);
});

test('QA_ENGINEER can create a requirement; fields trimmed, projectId derived', async () => {
  const res = await c('QA_ENGINEER').post(`modules/${moduleId}/requirements`, {
    data: { ...validReq('  REQ-001  '), title: '  User can log in  ' },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.reqId).toBe('REQ-001');
  expect(body.title).toBe('User can log in');
  expect(body.moduleId).toBe(moduleId);
  expect(body.projectId).toBe(projectId);
});

test('VIEWER can list requirements with relation counts (200)', async () => {
  const res = await c('VIEWER').get(`modules/${moduleId}/requirements`);
  expect(res.status()).toBe(200);
  const list = await res.json();
  expect(list).toHaveLength(1);
  expect(list[0]._count).toEqual({ testCases: 0, risks: 0 });
});

// ---------- Requirement rules ----------

test('duplicate reqId in another module of the same project returns 409', async () => {
  const res = await c('ADMIN').post(`modules/${module2Id}/requirements`, { data: validReq('REQ-001') });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toBe('A requirement with this ID already exists in this project');
});

test('same reqId in a different project is allowed', async () => {
  const p2 = await c('ADMIN').post('projects', { data: { name: 'Second Project' } });
  const p2Id = (await p2.json()).id;
  const m = await c('ADMIN').post(`projects/${p2Id}/modules`, { data: { name: 'Auth' } });
  otherProjectModuleId = (await m.json()).id;
  const res = await c('ADMIN').post(`modules/${otherProjectModuleId}/requirements`, { data: validReq('REQ-001') });
  expect(res.status()).toBe(201);
});

test('reqId is uppercased on save', async () => {
  const res = await c('ADMIN').post(`modules/${moduleId}/requirements`, { data: validReq('  req-lower-1 ') });
  expect(res.status()).toBe(201);
  expect((await res.json()).reqId).toBe('REQ-LOWER-1');
});

test('reqId differing only by case is a duplicate (409)', async () => {
  const res = await c('ADMIN').post(`modules/${module2Id}/requirements`, { data: validReq('Req-Lower-1') });
  expect(res.status()).toBe(409);
});

// ---------- GET /modules/:moduleId ----------

test('GET /modules/:id returns module with only id+name of the parent project', async () => {
  const res = await c('VIEWER').get(`modules/${moduleId}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.id).toBe(moduleId);
  expect(body.name).toBe('Auth');
  expect(body.projectId).toBe(projectId);
  expect(body.project).toEqual({ id: projectId, name: 'Main Project' });
});

test('GET /modules/:id is 404 for another org / unknown id, 401 without token', async () => {
  expect((await c('OTHER_ORG').get(`modules/${moduleId}`)).status()).toBe(404);
  expect((await c('ADMIN').get('modules/not-a-real-id')).status()).toBe(404);
  expect((await anon.get(`modules/${moduleId}`)).status()).toBe(401);
});

test('invalid enums are rejected with field messages', async () => {
  const res = await c('ADMIN').post(`modules/${moduleId}/requirements`, {
    data: { ...validReq('REQ-002'), priority: 'URGENT', businessCriticality: 'meh' },
  });
  expect(res.status()).toBe(400);
  const { details } = await res.json();
  expect(details.priority).toEqual(['Invalid priority']);
  expect(details.businessCriticality).toEqual(['Invalid criticality']);
});

test('whitespace-only and missing fields are rejected', async () => {
  const res = await c('ADMIN').post(`modules/${moduleId}/requirements`, {
    data: { reqId: '   ', title: '   ' },
  });
  expect(res.status()).toBe(400);
  const { details } = await res.json();
  expect(details.reqId).toEqual(['Requirement ID is required']);
  expect(details.title).toEqual(['Title is required']);
  expect(details.description).toBeDefined();
  expect(details.priority).toBeDefined();
  expect(details.businessCriticality).toBeDefined();
});

test("other organization cannot read or write this org's requirements (404)", async () => {
  expect((await c('OTHER_ORG').get(`modules/${moduleId}/requirements`)).status()).toBe(404);
  expect(
    (await c('OTHER_ORG').post(`modules/${moduleId}/requirements`, { data: validReq('REQ-X') })).status(),
  ).toBe(404);
});

test('unknown module returns 404', async () => {
  expect((await c('ADMIN').get('modules/not-a-real-id/requirements')).status()).toBe(404);
});

// ---------- Stale JWT role ----------

test('demotion takes effect immediately for an already-issued token', async () => {
  const u = await register('demoted');
  const adminClient = await login(u.email); // token says ADMIN
  try {
    expect((await adminClient.post('projects', { data: { name: 'Before demotion' } })).status()).toBe(201);
    await prisma.user.update({ where: { id: u.id }, data: { role: 'VIEWER' } });
    // Same token, still claims ADMIN; server must use the DB role.
    expect((await adminClient.post('projects', { data: { name: 'After demotion' } })).status()).toBe(403);
  } finally {
    await adminClient.dispose();
  }
});

test('promotion takes effect immediately for an already-issued token', async () => {
  const u = await register('promoted');
  await prisma.user.update({ where: { id: u.id }, data: { role: 'VIEWER' } });
  const viewerClient = await login(u.email); // token says VIEWER
  try {
    expect((await viewerClient.post('projects', { data: { name: 'As viewer' } })).status()).toBe(403);
    await prisma.user.update({ where: { id: u.id }, data: { role: 'QA_LEAD' } });
    expect((await viewerClient.post('projects', { data: { name: 'As lead' } })).status()).toBe(201);
  } finally {
    await viewerClient.dispose();
  }
});

test('deleted user with a valid token gets 401 on read and write routes', async () => {
  const u = await register('deleted');
  const client = await login(u.email);
  try {
    await prisma.user.delete({ where: { id: u.id } });
    const write = await client.post('projects', { data: { name: 'Ghost' } });
    expect(write.status()).toBe(401);
    expect((await write.json()).error).toBe('Unauthorized: User no longer exists');
    expect((await client.get('projects')).status()).toBe(401);
    expect((await client.get('auth/me')).status()).toBe(401);
  } finally {
    await client.dispose();
  }
});

test('user moved to another org immediately loses read access to the old org', async () => {
  const u = await register('mover');
  await prisma.user.update({ where: { id: u.id }, data: { organizationId: orgAId, role: 'VIEWER' } });
  const client = await login(u.email); // token says org A
  try {
    expect((await client.get(`projects/${projectId}`)).status()).toBe(200);
    // Move back to their own org without re-login: old token still claims org A.
    await prisma.user.update({ where: { id: u.id }, data: { organizationId: u.organizationId } });
    expect((await client.get(`projects/${projectId}`)).status()).toBe(404);
    expect((await client.get(`projects/${projectId}/modules`)).status()).toBe(404);
    expect((await client.get(`modules/${moduleId}/requirements`)).status()).toBe(404);
  } finally {
    await client.dispose();
  }
});

// ---------- Token validation ----------

/** Sign a JWT with the real secret (JWT_SECRET loaded by playwright.config.ts). */
function signJwt(payload: object, alg: 'HS256' | 'HS512'): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = `${b64({ alg, typ: 'JWT' })}.${b64({ ...payload, iat: Math.floor(Date.now() / 1000) })}`;
  const hash = alg === 'HS256' ? 'sha256' : 'sha512';
  const sig = createHmac(hash, process.env.JWT_SECRET!).update(head).digest('base64url');
  return `${head}.${sig}`;
}

async function getWithToken(path: string, token: string) {
  const ctx = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  try {
    const res = await ctx.get(path);
    return { status: res.status(), body: await res.json() };
  } finally {
    await ctx.dispose();
  }
}

test('control: hand-signed HS256 token for a real user is accepted', async () => {
  const admin = await prisma.user.findFirstOrThrow({ where: { organizationId: orgAId, role: 'ADMIN' } });
  const res = await getWithToken('projects', signJwt({ id: admin.id }, 'HS256'));
  expect(res.status).toBe(200);
});

test('token signed with HS512 (correct secret) is rejected: algorithm pinned to HS256', async () => {
  const admin = await prisma.user.findFirstOrThrow({ where: { organizationId: orgAId, role: 'ADMIN' } });
  const res = await getWithToken('projects', signJwt({ id: admin.id }, 'HS512'));
  expect(res.status).toBe(401);
  expect(res.body.error).toBe('Unauthorized: Invalid or expired token');
});

test('validly signed token without an id is rejected (401)', async () => {
  const res = await getWithToken('projects', signJwt({ role: 'ADMIN' }, 'HS256'));
  expect(res.status).toBe(401);
});

// ---------- GET /projects/:projectId ----------

test('GET /projects/:id returns the project to its own org', async () => {
  const res = await c('VIEWER').get(`projects/${projectId}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.id).toBe(projectId);
  expect(body.name).toBe('Main Project');
});

test('GET /projects/:id is 404 for another org and for unknown ids', async () => {
  expect((await c('OTHER_ORG').get(`projects/${projectId}`)).status()).toBe(404);
  expect((await c('ADMIN').get('projects/not-a-real-id')).status()).toBe(404);
  expect((await anon.get(`projects/${projectId}`)).status()).toBe(401);
});

test('requirements without a token are rejected (401)', async () => {
  expect((await anon.get(`modules/${moduleId}/requirements`)).status()).toBe(401);
});
