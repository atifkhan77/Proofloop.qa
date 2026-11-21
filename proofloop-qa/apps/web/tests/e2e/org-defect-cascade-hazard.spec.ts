import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * Integration Hazard: Organization Cascade with Active Defects (DEF-02 verification)
 * Verifies that deleting an organization with reported defects cascades cleanly
 * without Postgres foreign key deadlock or 500 error.
 */

const API = 'http://localhost:4000/api/';
const runId = Date.now();
const PASSWORD = 'Passw0rd!';

test.describe('Integration Hazard: Organization Cascade with Active Defects', () => {
  let anon: APIRequestContext;

  test.beforeAll(async () => {
    anon = await request.newContext({ baseURL: API });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('should handle organization deletion cleanly when defects exist', async () => {
    // 1. Register temporary organization and admin
    const uniqueEmail = `hazard-cascade-${runId}@example.com`;
    const regRes = await anon.post('auth/register', {
      data: {
        email: uniqueEmail,
        password: PASSWORD,
        firstName: 'Hazard',
        lastName: 'Admin',
        organizationName: `Cascade Hazard Org ${runId}`,
      },
    });
    expect(regRes.status()).toBe(201);
    const { token, user } = await regRes.json();
    const admin = await request.newContext({
      baseURL: API,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });

    // 2. Create Project & Defect
    const projRes = await admin.post('projects', {
      data: { name: 'Cascade Hazard Project' },
    });
    expect(projRes.status()).toBe(201);
    const project = await projRes.json();

    const defectRes = await admin.post(`projects/${project.id}/defects`, {
      data: {
        bugId: 'BUG-CASCADE-01',
        title: 'Cascade blocker test bug',
        description: 'Verifying defect reporter cascade',
        severity: 'HIGH',
        status: 'OPEN',
      },
    });
    expect(defectRes.status()).toBe(201);

    // 3. Delete organization via Prisma directly (simulating tenant teardown)
    // Previously failed with P2003 foreign key constraint violation on Defect.reporter Restrict.
    await expect(
      prisma.organization.delete({
        where: { id: user.organizationId },
      })
    ).resolves.toBeDefined();

    // Verify user and defect were cascaded
    const defectCheck = await prisma.defect.findFirst({ where: { projectId: project.id } });
    expect(defectCheck).toBeNull();
  });
});
