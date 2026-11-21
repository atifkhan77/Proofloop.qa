import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * SSRF Guard & Private Network Prevention Tests
 * Tests rejection of private IP addresses, cloud metadata endpoints, and non-http(s) protocols.
 */

const API = 'http://localhost:4000/api/';
const runId = Date.now();
const PASSWORD = 'Passw0rd!';

test.describe('SSRF Guard: Private Network Prevention', () => {
  let admin: APIRequestContext;
  let orgId: string;
  let projectId: string;
  let collectionId: string;

  test.beforeAll(async () => {
    const anon = await request.newContext({ baseURL: API });
    const regRes = await anon.post('auth/register', {
      data: {
        email: `ssrf-test-${runId}@example.com`,
        password: PASSWORD,
        firstName: 'SSRF',
        lastName: 'Guard',
        organizationName: `SSRF Test Org ${runId}`,
      },
    });
    expect(regRes.status()).toBe(201);
    const body = await regRes.json();
    orgId = body.user.organizationId;
    admin = await request.newContext({
      baseURL: API,
      extraHTTPHeaders: { Authorization: `Bearer ${body.token}` },
    });

    const pRes = await admin.post('projects', { data: { name: 'SSRF Audit Project' } });
    expect(pRes.status()).toBe(201);
    projectId = (await pRes.json()).id;

    const cRes = await admin.post(`projects/${projectId}/api-collections`, {
      data: { name: 'SSRF Tests' },
    });
    expect(cRes.status()).toBe(201);
    collectionId = (await cRes.json()).id;
  });

  test.afterAll(async () => {
    if (orgId) {
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
    await prisma.$disconnect();
  });

  const forbiddenEndpoints = [
    'http://127.0.0.1:8080/admin',
    'http://localhost:3000/secret',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1:9000/internal',
    'http://172.16.0.1:8080/metrics',
    'http://192.168.1.1/setup',
    'file:///etc/passwd',
  ];

  for (const target of forbiddenEndpoints) {
    test(`rejects execution to forbidden endpoint: ${target}`, async () => {
      // 1. Create request
      const createRes = await admin.post(`projects/${projectId}/api-collections/${collectionId}/requests`, {
        data: {
          name: `SSRF Probe - ${target}`,
          method: 'GET',
          endpoint: target,
        },
      });

      // Creation might reject invalid scheme (like file://) or accept URL string
      if (createRes.status() === 201) {
        const reqItem = await createRes.json();
        // 2. Executing must be blocked by SSRF Guard
        const execRes = await admin.post(`api-intelligence/requests/${reqItem.id}/execute`);
        expect([400, 422]).toContain(execRes.status());
        const errBody = await execRes.json();
        expect(errBody.error).toMatch(/SSRF Blocked|private_network|disallowed_scheme|Invalid/i);
      } else {
        expect([400, 422]).toContain(createRes.status());
      }
    });
  }
});
