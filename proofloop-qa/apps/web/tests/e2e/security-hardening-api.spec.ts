import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * Regression tests for the 2026-11-12 security review (ISSUE-LOG SEC-01 .. SEC-10).
 * Each test reproduces the original exploit and asserts it is now blocked.
 */

const API = 'http://localhost:4000/api/';
const runId = Date.now();
const ORG_PREFIX = `E2E SecHardening ${runId}`;
const PASSWORD = 'Passw0rd!';

test.describe.configure({ mode: 'serial' });

let anon: APIRequestContext;
let admin: APIRequestContext;
let engineer: APIRequestContext;
let viewer: APIRequestContext;
let projectId: string;
let environmentId: string;
let defectId: string;

async function register(tag: string) {
  const res = await anon.post('auth/register', {
    data: { email: `e2e-sec-${tag}-${runId}@example.com`, password: PASSWORD, firstName: 'Sec', lastName: tag, organizationName: `${ORG_PREFIX} ${tag}` },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { token: string; user: { id: string; organizationId: string; email: string } };
}
const client = (token: string) => request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });

test.beforeAll(async () => {
  anon = await request.newContext({ baseURL: API });
  const a = await register('admin');
  admin = await client(a.token);
  const e = await register('engineer');
  await prisma.user.update({ where: { id: e.user.id }, data: { role: 'QA_ENGINEER', organizationId: a.user.organizationId } });
  engineer = await client(e.token);
  const v = await register('viewer');
  await prisma.user.update({ where: { id: v.user.id }, data: { role: 'VIEWER', organizationId: a.user.organizationId } });
  viewer = await client(v.token);

  projectId = (await (await admin.post('projects', { data: { name: 'Security Hardening' } })).json()).id;
  environmentId = (await (await admin.post(`projects/${projectId}/environments`, { data: { name: 'SEC' } })).json()).id;
  const defect = await admin.post(`projects/${projectId}/defects`, {
    data: { bugId: 'BUG-SEC-1', title: 'Checkout fails', description: 'Pay button does nothing', severity: 'HIGH' },
  });
  expect(defect.status()).toBe(201);
  defectId = (await defect.json()).id;
});

test.afterAll(async () => {
  await Promise.all([anon, admin, engineer, viewer].map((c) => c?.dispose()));
  const orgs = await prisma.organization.findMany({ where: { name: { startsWith: ORG_PREFIX } }, select: { id: true } });
  // Defect.reporter is Restrict (DEF-02): delete defects before the organization.
  await prisma.defect.deleteMany({ where: { project: { organizationId: { in: orgs.map((o) => o.id) } } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs.map((o) => o.id) } } });
  await prisma.$disconnect();
});

test('SEC-01: Database Sentinel never queries the application database (no connection = 400)', async () => {
  // Arrange: environment without a target connection (the old code fell back to the app DB)
  // Act
  const res = await admin.post(`environments/${environmentId}/database/query`, {
    data: { query: 'SELECT count(*) AS users FROM "User"' },
  });

  // Assert
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body).toEqual({ error: 'No target database configured for this environment' });
  expect(body).not.toHaveProperty('rows');
});

test('SEC-02: Sentinel connection must be a public postgres host; only ADMIN/QA_LEAD may set it', async () => {
  const path = `environments/${environmentId}/database/connection`;
  // Arrange / Act / Assert: internal hosts (app DB on 5432, private network, metadata) are refused
  for (const connectionString of [
    'postgresql://u:p@127.0.0.1:5432/proofloop',
    'postgres://u:p@10.0.0.5:5432/db',
    'postgresql://u:p@169.254.169.254/db',
  ]) {
    const res = await admin.put(path, { data: { connectionString } });
    expect(res.status(), connectionString).toBe(400);
    expect((await res.json()).error).toBe('Database host must be a public address');
  }
  // Non-postgres schemes are a validation error
  expect((await admin.put(path, { data: { connectionString: 'mysql://u:p@db.example.com/x' } })).status()).toBe(400);
  // QA_ENGINEER can still run queries but cannot change the connection (holds credentials)
  expect((await engineer.put(path, { data: { connectionString: '' } })).status()).toBe(403);
  // Nothing was stored
  const env = await prisma.projectEnvironment.findUniqueOrThrow({ where: { id: environmentId } });
  expect(env.dbConnectionString).toBeNull();
});

test('SEC-03: Sentinel queries run in a READ ONLY transaction (side-effecting SELECT rejected)', async () => {
  // Arrange: point the environment at the test database (allowed via SSRF_ALLOWED_TARGETS)
  const target = process.env.DATABASE_URL!.replace('@localhost:', '@127.0.0.1:');
  expect((await admin.put(`environments/${environmentId}/database/connection`, { data: { connectionString: target } })).status()).toBe(200);
  const before = await prisma.$queryRawUnsafe<{ n: number }[]>('SELECT count(*)::int AS n FROM pg_largeobject_metadata');

  // Act: lo_create() is a write hidden inside a SELECT; the regex gate cannot see it
  const res = await admin.post(`environments/${environmentId}/database/query`, { data: { query: 'SELECT lo_create(0)' } });

  // Assert
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toMatch(/read-only transaction/i);
  const after = await prisma.$queryRawUnsafe<{ n: number }[]>('SELECT count(*)::int AS n FROM pg_largeobject_metadata');
  expect(after[0].n).toBe(before[0].n);
});

test('SEC-04: environment list/create never return dbConnectionString', async () => {
  // Arrange: the environment now has a connection string (SEC-03)
  expect((await prisma.projectEnvironment.findUniqueOrThrow({ where: { id: environmentId } })).dbConnectionString).not.toBeNull();

  // Act
  const list = await viewer.get(`projects/${projectId}/environments`);
  const created = await admin.post(`projects/${projectId}/environments`, { data: { name: 'SEC2' } });

  // Assert
  expect(list.status()).toBe(200);
  for (const env of await list.json()) expect(env).not.toHaveProperty('dbConnectionString');
  expect(await created.json()).not.toHaveProperty('dbConnectionString');
});

test('SEC-05: Slack webhook URL is hidden from VIEWER and QA_ENGINEER; internal webhook targets refused', async () => {
  // Arrange
  const hook = 'https://hooks.slack.com/services/T0000/B0000/SECRETSECRET';
  expect((await admin.put(`projects/${projectId}/integrations/slack`, { data: { enabled: true, webhookUrl: hook } })).status()).toBe(200);

  // Act
  const asViewer = (await (await viewer.get(`projects/${projectId}/integrations`)).json()).find((i: { type: string }) => i.type === 'SLACK');
  const asEngineer = (await (await engineer.get(`projects/${projectId}/integrations`)).json()).find((i: { type: string }) => i.type === 'SLACK');
  const asAdmin = (await (await admin.get(`projects/${projectId}/integrations`)).json()).find((i: { type: string }) => i.type === 'SLACK');
  const internal = await admin.put(`projects/${projectId}/integrations/slack`, { data: { enabled: true, webhookUrl: 'http://169.254.169.254/latest/meta-data' } });

  // Assert
  expect(asViewer.webhookUrl).toBe('********');
  expect(asViewer.hasWebhookUrl).toBe(true);
  expect(asEngineer.webhookUrl).toBe('********');
  expect(asAdmin.webhookUrl).toBe(hook);
  expect(internal.status()).toBe(400);
  expect((await internal.json()).error).toMatch(/SSRF Blocked/);
});

test('SEC-06: VIEWER cannot trigger LLM analysis or Slack notifications through GET', async () => {
  // Act
  const rootCause = await viewer.get(`defects/${defectId}/root-cause`);
  const notify = await viewer.get(`projects/${projectId}/quality-gate/evaluate?notify=true`);
  const evaluate = await viewer.get(`projects/${projectId}/quality-gate/evaluate`);

  // Assert
  expect(rootCause.status()).toBe(403);
  expect((await prisma.defect.findUniqueOrThrow({ where: { id: defectId } })).rootCauseHypothesis).toBeNull();
  expect(notify.status()).toBe(403);
  expect(evaluate.status()).toBe(200); // reading the gate is still allowed

  // A cached analysis stays readable for VIEWERs
  expect((await engineer.get(`defects/${defectId}/root-cause`)).status()).toBe(200);
  const cached = await viewer.get(`defects/${defectId}/root-cause`);
  expect(cached.status()).toBe(200);
  expect((await cached.json()).cached).toBe(true);
  expect((await viewer.get(`defects/${defectId}/root-cause?refresh=true`)).status()).toBe(403);
});

test('SEC-07: failed logins are rate-limited per account (AUTH-14)', async () => {
  // Arrange: a fresh address so earlier runs/tests do not share the counter
  const email = `e2e-sec-bruteforce-${runId}@example.com`;
  const statuses: number[] = [];

  // Act: 11 wrong passwords (limit 10 per 15 minutes)
  for (let i = 0; i < 11; i++) {
    statuses.push((await anon.post('auth/login', { data: { email, password: `wrong-${i}` } })).status());
  }

  // Assert
  expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
  expect(statuses[10]).toBe(429);
  // Other accounts from the same IP are not locked out
  const other = await anon.post('auth/login', { data: { email: `e2e-sec-admin-${runId}@example.com`, password: PASSWORD } });
  expect(other.status()).toBe(200);
});

test('SEC-08: forgot-password is rate-limited per address', async () => {
  // Arrange
  const email = `e2e-sec-mailbomb-${runId}@example.com`;
  const statuses: number[] = [];

  // Act: limit 5 per 15 minutes
  for (let i = 0; i < 6; i++) statuses.push((await anon.post('auth/forgot-password', { data: { email } })).status());

  // Assert
  expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
  expect(statuses[5]).toBe(429);
});

test('SEC-09: malformed JSON / oversized bodies get JSON errors without stack traces', async () => {
  // Act
  const malformed = await anon.post('auth/login', { headers: { 'Content-Type': 'application/json' }, data: '{"email":' });
  const oversized = await anon.post('auth/login', {
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(1_100_000) }),
  });

  // Assert
  expect(malformed.status()).toBe(400);
  expect(await malformed.json()).toEqual({ error: 'Malformed JSON in request body' });
  expect(oversized.status()).toBe(413);
  expect(await oversized.json()).toEqual({ error: 'Request body too large' });
});

test('SEC-10: CORS only allows the web app origin', async () => {
  // Act
  const evil = await anon.get('health', { headers: { Origin: 'https://evil.example' } });
  const web = await anon.get('health', { headers: { Origin: 'http://localhost:5173' } });

  // Assert
  expect(evil.headers()['access-control-allow-origin']).toBeUndefined();
  expect(web.headers()['access-control-allow-origin']).toBe('http://localhost:5173');
});
