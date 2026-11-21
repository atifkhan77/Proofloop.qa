import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * Quality Gate Evaluation Engine Tests
 * Tests calculation thresholds: requirement coverage, critical risks, and defect caps.
 */

const API = 'http://localhost:4000/api/';
const runId = Date.now();
const PASSWORD = 'Passw0rd!';

test.describe('Quality Gate: Evaluation Engine & Thresholds', () => {
  let admin: APIRequestContext;
  let orgId: string;
  let projectId: string;

  test.beforeAll(async () => {
    const anon = await request.newContext({ baseURL: API });
    const regRes = await anon.post('auth/register', {
      data: {
        email: `qg-eval-${runId}@example.com`,
        password: PASSWORD,
        firstName: 'QG',
        lastName: 'Lead',
        organizationName: `QG Org ${runId}`,
      },
    });
    expect(regRes.status()).toBe(201);
    const body = await regRes.json();
    orgId = body.user.organizationId;
    admin = await request.newContext({
      baseURL: API,
      extraHTTPHeaders: { Authorization: `Bearer ${body.token}` },
    });

    const pRes = await admin.post('projects', { data: { name: 'QG Eval Project' } });
    expect(pRes.status()).toBe(201);
    projectId = (await pRes.json()).id;
  });

  test.afterAll(async () => {
    if (orgId) {
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
    await prisma.$disconnect();
  });

  test('configures quality gate policy and evaluates initial state', async () => {
    // 1. Update config
    const putRes = await admin.put(`projects/${projectId}/quality-gate/config`, {
      data: {
        requireFullCoverage: true,
        requireCriticalRiskCoverage: true,
        maxActiveCriticalDefects: 0,
        maxActiveHighDefects: 1,
      },
    });
    expect(putRes.status()).toBe(200);
    const config = await putRes.json();
    expect(config.requireFullCoverage).toBe(true);
    expect(config.maxActiveHighDefects).toBe(1);

    // 2. Evaluate Quality Gate with 0 requirements -> PASS
    const evalRes = await admin.post(`projects/${projectId}/quality-gate/evaluate`);
    expect(evalRes.status()).toBe(200);
    const evalData = await evalRes.json();
    expect(evalData.status).toBe('PASS');
    expect(evalData.blockingReasons).toHaveLength(0);
  });

  test('blocks release when active high defects exceed policy threshold', async () => {
    // Inject 2 HIGH defects (threshold was set to max 1)
    for (let i = 1; i <= 2; i++) {
      const defRes = await admin.post(`projects/${projectId}/defects`, {
        data: {
          bugId: `BUG-QG-HIGH-${i}`,
          title: `High Defect ${i}`,
          description: 'Blocks gate',
          severity: 'HIGH',
          status: 'OPEN',
        },
      });
      expect(defRes.status()).toBe(201);
    }

    // Re-evaluate -> must BLOCK
    const evalRes = await admin.post(`projects/${projectId}/quality-gate/evaluate`);
    expect(evalRes.status()).toBe(200);
    const evalData = await evalRes.json();
    expect(evalData.status).toBe('BLOCK');
    expect(evalData.blockingReasons.some((r: string) => /high defects/i.test(r))).toBe(true);
  });
});
