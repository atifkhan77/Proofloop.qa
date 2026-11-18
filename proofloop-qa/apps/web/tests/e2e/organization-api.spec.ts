import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma, type Role } from '@proofloop/prisma';

/**
 * Organization user management: list, role changes, soft delete (deactivation), last-admin
 * safeguards incl. concurrency, deactivated users blocked (token + login), ADMIN-only routes.
 */

const API = 'http://localhost:4000/api/';
const runId = Date.now();
const ORG_PREFIX = `E2E OrgMgmt ${runId}`;
const PASSWORD = 'Passw0rd!';

test.describe.configure({ mode: 'serial' });

let anon: APIRequestContext;
let orgId: string;
const users: Record<string, { id: string; email: string; ctx: APIRequestContext }> = {};

async function register(tag: string, firstName: string) {
  const email = `e2e-org-${tag}-${runId}@example.com`;
  const res = await anon.post('auth/register', {
    data: { email, password: PASSWORD, firstName, lastName: 'Test', organizationName: `${ORG_PREFIX} ${tag}` },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  const ctx = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${body.token}` } });
  return { id: body.user.id as string, organizationId: body.user.organizationId as string, email, ctx };
}

async function member(tag: string, firstName: string, role: Role) {
  const u = await register(tag, firstName);
  await prisma.user.update({ where: { id: u.id }, data: { role, organizationId: orgId } });
  users[tag] = u;
}

const activeAdmins = () => prisma.user.count({ where: { organizationId: orgId, role: 'ADMIN', deletedAt: null } });

test.beforeAll(async () => {
  anon = await request.newContext({ baseURL: API });
  const a = await register('admin', 'Alice');
  orgId = a.organizationId;
  users.admin = a;
  await member('admin2', 'Bob', 'ADMIN');
  await member('lead', 'Carol', 'QA_LEAD');
  await member('engineer', 'Dave', 'QA_ENGINEER');
  await member('viewer', 'Erin', 'VIEWER');
  users.other = await register('other', 'Zed');
});

test.afterAll(async () => {
  await anon?.dispose();
  await Promise.all(Object.values(users).map((u) => u.ctx.dispose()));
  const orgs = { name: { startsWith: ORG_PREFIX } };
  await prisma.defect.deleteMany({ where: { project: { organization: orgs } } }); // Restrict reporter (DEF-02)
  await prisma.organization.deleteMany({ where: orgs });
  await prisma.$disconnect();
});

// ---------- Access ----------

test('ADMIN lists active users (sorted, no password hash); other roles 403; no token 401', async () => {
  const res = await users.admin.ctx.get('organization/users');
  expect(res.status()).toBe(200);
  const list = await res.json();
  expect(list.map((u: { firstName: string; role: string }) => [u.firstName, u.role])).toEqual([
    ['Alice', 'ADMIN'],
    ['Bob', 'ADMIN'],
    ['Carol', 'QA_LEAD'],
    ['Dave', 'QA_ENGINEER'],
    ['Erin', 'VIEWER'],
  ]);
  expect(Object.keys(list[0]).sort()).toEqual(['createdAt', 'email', 'firstName', 'id', 'lastName', 'role']);

  for (const tag of ['lead', 'engineer', 'viewer']) {
    expect((await users[tag].ctx.get('organization/users')).status(), tag).toBe(403);
    expect((await users[tag].ctx.patch(`organization/users/${users.viewer.id}/role`, { data: { role: 'ADMIN' } })).status(), tag).toBe(403);
    expect((await users[tag].ctx.delete(`organization/users/${users.viewer.id}`)).status(), tag).toBe(403);
  }
  expect((await anon.get('organization/users')).status()).toBe(401);
});

test('routes do not intercept other /api requests (health public, unknown path 404 for non-admins)', async () => {
  expect((await anon.get('health')).status()).toBe(200);
  expect((await users.viewer.ctx.get('definitely-not-a-route')).status()).toBe(404);
  expect((await users.viewer.ctx.get('projects')).status()).toBe(200);
});

// ---------- Roles ----------

test('role change: valid, invalid role 400, other org / unknown user 404', async () => {
  const res = await users.admin.ctx.patch(`organization/users/${users.viewer.id}/role`, { data: { role: 'QA_ENGINEER' } });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ id: users.viewer.id, role: 'QA_ENGINEER' });
  expect((await prisma.user.findUniqueOrThrow({ where: { id: users.viewer.id } })).role).toBe('QA_ENGINEER');
  await users.admin.ctx.patch(`organization/users/${users.viewer.id}/role`, { data: { role: 'VIEWER' } });

  const bad = await users.admin.ctx.patch(`organization/users/${users.viewer.id}/role`, { data: { role: 'SUPERUSER' } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).details).toEqual({ role: ['Invalid role'] });

  expect((await users.admin.ctx.patch(`organization/users/${users.other.id}/role`, { data: { role: 'VIEWER' } })).status()).toBe(404);
  expect((await users.admin.ctx.patch('organization/users/00000000-0000-0000-0000-000000000000/role', { data: { role: 'VIEWER' } })).status()).toBe(404);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: users.other.id } })).role).toBe('ADMIN'); // untouched
});

test('last administrator cannot be demoted', async () => {
  expect((await users.admin.ctx.patch(`organization/users/${users.admin2.id}/role`, { data: { role: 'QA_LEAD' } })).status()).toBe(200);
  expect(await activeAdmins()).toBe(1);
  const res = await users.admin.ctx.patch(`organization/users/${users.admin.id}/role`, { data: { role: 'VIEWER' } });
  expect(res.status()).toBe(400);
  expect(await res.json()).toEqual({ error: 'Cannot demote the last administrator of the organization' });
  await prisma.user.update({ where: { id: users.admin2.id }, data: { role: 'ADMIN' } });
});

test('concurrent demotions of the two admins never leave the organization without an admin', async () => {
  for (let round = 0; round < 8; round++) {
    await prisma.user.updateMany({ where: { id: { in: [users.admin.id, users.admin2.id] } }, data: { role: 'ADMIN' } });
    const [a, b] = await Promise.all([
      users.admin.ctx.patch(`organization/users/${users.admin2.id}/role`, { data: { role: 'QA_LEAD' } }),
      users.admin2.ctx.patch(`organization/users/${users.admin.id}/role`, { data: { role: 'QA_LEAD' } }),
    ]);
    const statuses = [a.status(), b.status()].sort();
    expect(await activeAdmins(), `round ${round}: ${statuses}`).toBe(1);
    expect(statuses.filter((s) => s === 200), `round ${round}`).toHaveLength(1);
    expect([400, 403, 409], `round ${round}: ${statuses}`).toContain(statuses[1]);
  }
  await prisma.user.updateMany({ where: { id: { in: [users.admin.id, users.admin2.id] } }, data: { role: 'ADMIN' } });
});

// ---------- Soft delete ----------

test('deactivation safeguards: not yourself; other org / unknown user 404', async () => {
  const self = await users.admin.ctx.delete(`organization/users/${users.admin.id}`);
  expect(self.status()).toBe(400);
  expect(await self.json()).toEqual({ error: 'You cannot deactivate your own account' });
  expect((await users.admin.ctx.delete(`organization/users/${users.other.id}`)).status()).toBe(404);
  expect((await users.admin.ctx.delete('organization/users/00000000-0000-0000-0000-000000000000')).status()).toBe(404);
});

// The "last administrator" rule for deactivation cannot be reached by sequential calls: the
// caller is an active admin and cannot target themselves, so any other admin target means at
// least 2 admins. It matters when two admins deactivate each other at the same moment.
test('concurrent mutual deactivation of the two admins leaves exactly one active admin', async () => {
  for (let round = 0; round < 8; round++) {
    await prisma.user.updateMany({ where: { id: { in: [users.admin.id, users.admin2.id] } }, data: { role: 'ADMIN', deletedAt: null } });
    const [a, b] = await Promise.all([
      users.admin.ctx.delete(`organization/users/${users.admin2.id}`),
      users.admin2.ctx.delete(`organization/users/${users.admin.id}`),
    ]);
    const statuses = [a.status(), b.status()].sort();
    expect(await activeAdmins(), `round ${round}: ${statuses}`).toBe(1);
    expect(statuses.filter((s) => s === 204), `round ${round}`).toHaveLength(1);
    // Loser: 400 (last admin), 401 (already deactivated before its request was authenticated) or 409 (serialization).
    expect([400, 401, 409], `round ${round}: ${statuses}`).toContain(statuses.find((s) => s !== 204));
  }
  await prisma.user.updateMany({ where: { id: { in: [users.admin.id, users.admin2.id] } }, data: { role: 'ADMIN', deletedAt: null } });
});
test('deactivated user: token rejected, login 403 only with the right password, hidden from list, row kept', async () => {
  // A defect reported by Dave keeps its reporter after deactivation (soft delete, DEF-02).
  const project = (await (await users.admin.ctx.post('projects', { data: { name: 'Soft delete' } })).json()).id;
  const defect = await users.engineer.ctx.post(`projects/${project}/defects`, { data: { bugId: 'B-1', title: 't', description: 'd', severity: 'LOW' } });
  expect(defect.status()).toBe(201);

  expect((await users.admin.ctx.delete(`organization/users/${users.engineer.id}`)).status()).toBe(204);

  const withToken = await users.engineer.ctx.get('projects');
  expect(withToken.status()).toBe(401);
  expect(await withToken.json()).toEqual({ error: 'Unauthorized: Account deactivated' });

  const login = await anon.post('auth/login', { data: { email: users.engineer.email, password: PASSWORD } });
  expect(login.status()).toBe(403);
  expect(await login.json()).toEqual({ error: 'Account has been deactivated. Contact your administrator.' });
  const wrongPassword = await anon.post('auth/login', { data: { email: users.engineer.email, password: 'Wrong-pass1' } });
  expect(wrongPassword.status()).toBe(401); // same as any bad login: no hint that the account exists
  expect(await wrongPassword.json()).toEqual({ error: 'Invalid credentials' });

  const list = await (await users.admin.ctx.get('organization/users')).json();
  expect(list.map((u: { id: string }) => u.id)).not.toContain(users.engineer.id);
  expect((await users.admin.ctx.patch(`organization/users/${users.engineer.id}/role`, { data: { role: 'VIEWER' } })).status()).toBe(404);
  expect((await users.admin.ctx.delete(`organization/users/${users.engineer.id}`)).status()).toBe(404);

  const row = await prisma.user.findUniqueOrThrow({ where: { id: users.engineer.id } });
  expect(row.deletedAt).not.toBeNull();
  const d = await prisma.defect.findFirstOrThrow({ where: { projectId: project } });
  expect(d.reporterId).toBe(users.engineer.id);

  // Deactivated users cannot be assigned new defects.
  const assign = await users.admin.ctx.patch(`defects/${d.id}`, { data: { assigneeId: users.engineer.id } });
  expect(assign.status()).toBe(400);
  expect((await assign.json()).details).toEqual({ assigneeId: ['Invalid Assignee ID'] });
});
