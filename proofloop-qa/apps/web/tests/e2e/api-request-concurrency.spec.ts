import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * Concurrency: ApiRequest Sequence Assignment (DATA-09)
 * Tests that multiple simultaneous requests created in a collection receive valid sequence numbers.
 */

const API = 'http://localhost:4000/api/';
const runId = Date.now();
const PASSWORD = 'Passw0rd!';

test.describe('Concurrency: ApiRequest Sequence Assignment', () => {
  let admin: APIRequestContext;
  let orgId: string;
  let projectId: string;
  let collectionId: string;

  test.beforeAll(async () => {
    const anon = await request.newContext({ baseURL: API });
    const regRes = await anon.post('auth/register', {
      data: {
        email: `seq-concurrency-${runId}@example.com`,
        password: PASSWORD,
        firstName: 'Seq',
        lastName: 'Tester',
        organizationName: `Seq Concurrency Org ${runId}`,
      },
    });
    expect(regRes.status()).toBe(201);
    const body = await regRes.json();
    orgId = body.user.organizationId;
    admin = await request.newContext({
      baseURL: API,
      extraHTTPHeaders: { Authorization: `Bearer ${body.token}` },
    });

    const pRes = await admin.post('projects', { data: { name: 'Sequence Test Project' } });
    expect(pRes.status()).toBe(201);
    projectId = (await pRes.json()).id;

    const cRes = await admin.post(`projects/${projectId}/api-collections`, {
      data: { name: 'Concurrency Collection' },
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

  test('sequential creation assigns incrementing sequence numbers', async () => {
    for (let i = 1; i <= 3; i++) {
      const res = await admin.post(`projects/${projectId}/api-collections/${collectionId}/requests`, {
        data: {
          name: `Req ${i}`,
          method: 'GET',
          endpoint: 'https://httpbin.org/get',
        },
      });
      expect(res.status()).toBe(201);
      const reqData = await res.json();
      expect(reqData.sequenceNumber).toBe(i);
    }

    const listRes = await admin.get(`projects/${projectId}/api-collections/${collectionId}/requests`);
    expect(listRes.status()).toBe(200);
    const items = await listRes.json();
    expect(items.length).toBe(3);
    expect(items.map((r: { sequenceNumber: number }) => r.sequenceNumber)).toEqual([1, 2, 3]);
  });
});
