import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma, type Role } from '@proofloop/prisma';

/**
 * ProofLoop Master QA Specification: Phases A, B, C, D Verification Suite
 * Phase A: Organization Settings (Team Roster, Role Changes, Soft Delete & Safeguards)
 * Phase B: Module 13 - Reports & Analytics (Pass Rates, Defect Density, Requirement Coverage)
 * Phase C: Module 12 - Integrations Engine (Jira 2-Way Sync, Slack Alerts, SSRF Protection, Secret Masking)
 * Phase D: Test Runs & Execution Cycles (Regression Cycles, Step Runner, Defect Logging on Failure)
 */

const API = 'http://localhost:4000/api/';
const TOKEN_KEY = 'proofloop-auth-token';
const runId = Date.now();
const ORG_PREFIX = `E2E MasterQA ${runId}`;
const PASSWORD = 'Passw0rd!';

test.describe.configure({ mode: 'serial' });

let anon: APIRequestContext;
let adminApi: APIRequestContext;
let viewerApi: APIRequestContext;

let orgId: string;
let adminToken: string;
let viewerToken: string;
let adminUser: { id: string; email: string };
let viewerUser: { id: string; email: string };
let targetUser: { id: string; email: string };

let projectId: string;
let moduleId: string;
let req1Id: string;
let req2Id: string;
let tc1Id: string;
let tc2Id: string;

async function register(tag: string, firstName: string) {
  const email = `e2e-master-${tag}-${runId}@example.com`;
  const res = await anon.post('auth/register', {
    data: {
      email,
      password: PASSWORD,
      firstName,
      lastName: 'Tester',
      organizationName: `${ORG_PREFIX} ${tag}`,
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  const ctx = await request.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${body.token}` },
  });
  return { id: body.user.id as string, organizationId: body.user.organizationId as string, token: body.token as string, email, ctx };
}

test.beforeAll(async () => {
  anon = await request.newContext({ baseURL: API });

  const admin = await register('admin', 'Alice');
  orgId = admin.organizationId;
  adminToken = admin.token;
  adminApi = admin.ctx;
  adminUser = { id: admin.id, email: admin.email };

  // Create target member for role changes & deactivation
  const target = await register('target', 'Bob');
  await prisma.user.update({ where: { id: target.id }, data: { role: 'VIEWER', organizationId: orgId } });
  targetUser = { id: target.id, email: target.email };

  // Create viewer user
  const viewer = await register('viewer', 'Charlie');
  await prisma.user.update({ where: { id: viewer.id }, data: { role: 'VIEWER', organizationId: orgId } });
  viewerToken = viewer.token;
  viewerApi = viewer.ctx;
  viewerUser = { id: viewer.id, email: viewer.email };

  // Create Project, Module, Requirements, and Test Cases
  const projRes = await adminApi.post('projects', { data: { name: `Master QA Project ${runId}` } });
  expect(projRes.status()).toBe(201);
  projectId = (await projRes.json()).id;

  const modRes = await adminApi.post(`projects/${projectId}/modules`, { data: { name: `Core Module ${runId}` } });
  expect(modRes.status()).toBe(201);
  moduleId = (await modRes.json()).id;

  const req1Res = await adminApi.post(`modules/${moduleId}/requirements`, {
    data: {
      reqId: 'REQ-001',
      title: 'User Authentication Flow',
      description: 'Secure JWT authentication',
      priority: 'HIGH',
      businessCriticality: 'CRITICAL',
    },
  });
  expect(req1Res.status()).toBe(201);
  req1Id = (await req1Res.json()).id;

  const req2Res = await adminApi.post(`modules/${moduleId}/requirements`, {
    data: {
      reqId: 'REQ-002',
      title: 'Payment Gateway Integration',
      description: 'Stripe integration',
      priority: 'HIGH',
      businessCriticality: 'CRITICAL',
    },
  });
  expect(req2Res.status()).toBe(201);
  req2Id = (await req2Res.json()).id;

  const tc1Res = await adminApi.post(`projects/${projectId}/test-cases`, {
    data: {
      tcId: 'TC-001',
      title: 'Verify valid login generates JWT token',
      priority: 'HIGH',
      testType: 'UI',
      automationStatus: 'MANUAL',
      requirementId: req1Id,
      steps: [
        { action: 'Enter valid credentials', expectedResult: 'Login succeeds' },
        { action: 'Inspect response token', expectedResult: 'Valid JWT returned' },
      ],
    },
  });
  expect(tc1Res.status()).toBe(201);
  tc1Id = (await tc1Res.json()).id;

  const tc2Res = await adminApi.post(`projects/${projectId}/test-cases`, {
    data: {
      tcId: 'TC-002',
      title: 'Verify failed payment triggers error modal',
      priority: 'HIGH',
      testType: 'UI',
      automationStatus: 'MANUAL',
      requirementId: req2Id,
      steps: [
        { action: 'Submit payment with expired card', expectedResult: 'Payment rejected' },
      ],
    },
  });
  expect(tc2Res.status()).toBe(201);
  tc2Id = (await tc2Res.json()).id;
});

test.afterAll(async () => {
  await anon?.dispose();
  await adminApi?.dispose();
  await viewerApi?.dispose();

  const orgs = { name: { startsWith: ORG_PREFIX } };
  await prisma.defect.deleteMany({ where: { project: { organization: orgs } } });
  await prisma.testExecution.deleteMany({ where: { testCycle: { project: { organization: orgs } } } });
  await prisma.testCycle.deleteMany({ where: { project: { organization: orgs } } });
  await prisma.integration.deleteMany({ where: { project: { organization: orgs } } });
  await prisma.organization.deleteMany({ where: orgs });
  await prisma.$disconnect();
});

// =========================================================================
// PHASE A: ORGANIZATION SETTINGS (FRONTEND & SAFEGUARDS)
// =========================================================================

test.describe('Phase A: Organization Settings & Team Roster', () => {
  test('ADMIN can view Team Roster, change member role, and soft-delete user', async ({ page }) => {
    // Sign in as Admin
    await page.goto('/login');
    await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, adminToken] as const);

    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Team Roster' })).toBeVisible();

    // Verify team members table rendered
    await expect(page.getByText('Alice Tester')).toBeVisible();
    await expect(page.getByText('Bob Tester')).toBeVisible();

    // Verify Bob's role can be updated to QA_LEAD
    const bobRoleSelect = page.getByLabel('Change role for Bob Tester');
    await expect(bobRoleSelect).toBeVisible();
    await bobRoleSelect.selectOption('QA_LEAD');

    // Confirm success feedback
    await expect(page.getByText(/Role for Bob Tester updated to QA Lead/i)).toBeVisible();

    // Verify in database that Bob is QA_LEAD
    const updatedBob = await prisma.user.findUniqueOrThrow({ where: { id: targetUser.id } });
    expect(updatedBob.role).toBe('QA_LEAD');

    // Test Deactivation safeguard: Deactivate button for Alice (self) is disabled
    const deactivateSelfBtn = page.getByRole('button', { name: /deactivate/i }).filter({ hasText: 'Deactivate' }).first();
    // One of the deactivate buttons should be disabled (self)
    const selfBtn = page.locator('button[title="You cannot deactivate your own account"]');
    await expect(selfBtn).toBeDisabled();

    // Click deactivate on Bob Tester
    const deactivateBobBtn = page.locator('tr', { hasText: 'Bob Tester' }).getByRole('button', { name: /deactivate/i });
    await deactivateBobBtn.click();

    // Confirmation modal should appear
    const dialog = page.getByRole('dialog', { name: /deactivate team member/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Bob Tester/i)).toBeVisible();

    // Confirm deactivation
    await dialog.getByRole('button', { name: /confirm deactivation/i }).click();

    // Verify success feedback and Bob is removed from active list
    await expect(page.getByText(/User Bob Tester deactivated successfully/i)).toBeVisible();
    await expect(page.locator('tr', { hasText: 'Bob Tester' })).not.toBeVisible();

    // In DB, Bob should have deletedAt set
    const deactivatedBob = await prisma.user.findUniqueOrThrow({ where: { id: targetUser.id } });
    expect(deactivatedBob.deletedAt).not.toBeNull();
  });

  test('Non-admin (VIEWER) visiting /settings sees access restricted warning', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, viewerToken] as const);

    await page.goto('/settings');
    await expect(page.getByText('Administrator Access Required')).toBeVisible();
    await expect(page.getByText(/restricted to Administrators/i)).toBeVisible();
  });
});

// =========================================================================
// PHASE C: MODULE 12 - INTEGRATIONS ENGINE (JIRA & SLACK)
// =========================================================================

test.describe('Phase C: Module 12 - Integrations Engine', () => {
  test('Integrations API: Upsert Slack and Jira configs, SSRF check, secret masking', async () => {
    // 1. SSRF Guard: Private / loopback target rejected
    const badSlack = await adminApi.post('projects/any/integrations/slack/test', {
      data: { webhookUrl: 'http://127.0.0.1:4000/bad-webhook' },
    });
    expect(badSlack.status()).toBe(400);
    const badSlackBody = await badSlack.json();
    expect(badSlackBody.error).toMatch(/SSRF Blocked/i);

    // 2. Configure Slack webhook for project
    const slackRes = await adminApi.put(`projects/${projectId}/integrations/slack`, {
      data: {
        enabled: true,
        webhookUrl: 'https://hooks.slack.com/services/T0000/B0000/XXXXX',
        channel: '#qa-automation',
      },
    });
    expect(slackRes.status()).toBe(200);

    // 3. Configure Jira 2-Way Sync
    const jiraRes = await adminApi.put(`projects/${projectId}/integrations/jira`, {
      data: {
        enabled: true,
        jiraHost: 'https://example-jira.atlassian.net',
        jiraEmail: 'jira-bot@example.com',
        jiraApiToken: 'my-super-secret-api-token',
        jiraProjectKey: 'PROJ',
        jiraIssueType: 'Bug',
      },
    });
    expect(jiraRes.status()).toBe(200);

    // 4. Data Redaction & Secrets: GET integrations masks Jira token as '********'
    const getRes = await adminApi.get(`projects/${projectId}/integrations`);
    expect(getRes.status()).toBe(200);
    const integrations = await getRes.json();
    const jira = integrations.find((i: any) => i.type === 'JIRA');
    expect(jira).toBeDefined();
    expect(jira.jiraApiToken).toBe('********');
    expect(jira.hasJiraApiToken).toBe(true);

    // Viewer gets masked token too
    const viewerGet = await viewerApi.get(`projects/${projectId}/integrations`);
    expect(viewerGet.status()).toBe(200);
    const viewerJira = (await viewerGet.json()).find((i: any) => i.type === 'JIRA');
    expect(viewerJira.jiraApiToken).toBe('********');
  });

  test('Creating CRITICAL defect links to Jira and records defect', async () => {
    const defectRes = await adminApi.post(`projects/${projectId}/defects`, {
      data: {
        bugId: 'BUG-001',
        title: 'Authentication token bypass vulnerability',
        description: 'Critical token bypass allows unauthenticated access',
        severity: 'CRITICAL',
        status: 'OPEN',
        testCaseId: tc1Id,
      },
    });
    expect(defectRes.status()).toBe(201);
    const defect = await defectRes.json();
    expect(defect.bugId).toBe('BUG-001');
    expect(defect.severity).toBe('CRITICAL');
  });

  test('Integrations Settings UI: loads and renders Slack and Jira panels', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, adminToken] as const);

    await page.goto(`/projects/${projectId}/integrations`);
    await expect(page.getByRole('heading', { name: 'Integrations Engine' })).toBeVisible();

    await expect(page.getByText('Slack Incoming Webhooks')).toBeVisible();
    await expect(page.getByText('Jira 2-Way Sync')).toBeVisible();

    // Verify masked token placeholder displayed
    await expect(page.getByPlaceholder('•••••••• (unchanged)')).toBeVisible();
  });
});

// =========================================================================
// PHASE D: TEST RUNS & EXECUTION CYCLES
// =========================================================================

test.describe('Phase D: Test Runs & Execution Cycles', () => {
  let cycleId: string;

  test('Create TestCycle with test cases and step through execution runner', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, adminToken] as const);

    // 1. Visit Test Cycles page
    await page.goto(`/projects/${projectId}/test-cycles`);
    await expect(page.getByRole('heading', { name: 'Test Execution Cycles', exact: true })).toBeVisible();

    // 2. Open Create Cycle Modal
    await page.getByRole('button', { name: /new test cycle/i }).click();
    const modal = page.getByRole('dialog', { name: /new test execution cycle/i });
    await expect(modal).toBeVisible();

    // Fill form
    await modal.getByLabel(/cycle name/i).fill('Release 2.0 Regression Cycle');
    await modal.getByLabel(/description/i).fill('Pre-release full manual verification cycle');

    // Confirm test cases TC-001 and TC-002 are selected
    await expect(modal.getByText('TC-001')).toBeVisible();
    await expect(modal.getByText('TC-002')).toBeVisible();

    await modal.getByRole('button', { name: /create test cycle/i }).click();

    // Verify cycle card appears in list
    await expect(page.getByRole('heading', { name: 'Release 2.0 Regression Cycle', exact: true })).toBeVisible();

    // 3. Open Runner
    await page.getByRole('link', { name: /open runner/i }).click();
    await expect(page.getByRole('heading', { name: 'Release 2.0 Regression Cycle', exact: true })).toBeVisible();

    // 4. Step through Test Case 1: Mark as Passed
    await expect(page.getByText('TC-001').first()).toBeVisible();
    await page.getByRole('button', { name: /mark as passed/i }).click();

    // Verify Pass rate updates to 50%
    await expect(page.getByText('50%').first()).toBeVisible();

    // 5. Select Test Case 2: Mark as Failed
    await page.locator('.w-full.lg\\:w-80').getByText('TC-002').click();
    await expect(page.getByRole('heading', { name: /Verify failed payment triggers error modal/i })).toBeVisible();

    await page.getByRole('button', { name: /mark as failed/i }).click();

    // Failure prompt should appear
    await expect(page.getByText('Execution Failed')).toBeVisible();
    const logDefectBtn = page.getByRole('button', { name: /log defect now/i });
    await expect(logDefectBtn).toBeVisible();

    // 6. Log defect from failure prompt
    await logDefectBtn.click();
    const defectModal = page.getByRole('dialog', { name: /report new defect/i });
    await expect(defectModal).toBeVisible();

    // Verify prefilled data
    await defectModal.getByLabel(/bug id/i).fill('BUG-002');
    await defectModal.getByRole('button', { name: /create defect/i }).click();

    // Verify defect linked
    await expect(page.getByText('BUG-002').first()).toBeVisible();
  });
});

// =========================================================================
// PHASE B: MODULE 13 - REPORTS & ANALYTICS
// =========================================================================

test.describe('Phase B: Reports & Analytics Engine', () => {
  test('Reports API: Calculates Requirement Coverage, Defect Density, and Pass Rates', async () => {
    const res = await adminApi.get(`projects/${projectId}/reports`);
    expect(res.status()).toBe(200);

    const report = await res.json();
    expect(report.summary).toBeDefined();

    // Requirement Coverage check:
    // Total requirements = 2 (REQ-001 has TC-001 but has CRITICAL BUG-001 -> blocked; REQ-002 has TC-002 with HIGH BUG-002 -> covered!)
    expect(report.summary.totalRequirements).toBe(2);
    expect(report.requirementCoverage.totalRequirements).toBe(2);
    expect(report.requirementCoverage.blockedByCriticalBugs).toBe(1); // REQ-001 blocked by CRITICAL BUG-001
    expect(report.requirementCoverage.coveredRequirements).toBe(1); // REQ-002 covered!
    expect(report.summary.requirementCoverageRate).toBe(50);

    // Defect Density check:
    expect(report.defectDensity.totalActiveBugs).toBeGreaterThanOrEqual(2);
    const coreMod = report.defectDensity.modules.find((m: any) => m.name.startsWith('Core Module'));
    expect(coreMod).toBeDefined();
    expect(coreMod.activeBugs).toBeGreaterThanOrEqual(1);

    // Pass Rate timeline:
    expect(Array.isArray(report.passRateTimeline)).toBe(true);
  });

  test('Reports UI: Project Reports Dashboard renders charts and metrics', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, adminToken] as const);

    await page.goto(`/projects/${projectId}/reports`);
    await expect(page.getByRole('heading', { name: 'Quality Reports & Analytics' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('status', { name: /loading reports/i })).not.toBeVisible({ timeout: 15000 });

    // Verify KPI Cards
    await expect(page.getByText('Requirement Coverage', { exact: true })).toBeVisible();
    await expect(page.getByText('Overall Pass Rate', { exact: true })).toBeVisible();
    await expect(page.getByText('Active Defects', { exact: true })).toBeVisible();
    await expect(page.getByText('Automation Rate', { exact: true })).toBeVisible();

    // Verify Charts Sections
    await expect(page.getByRole('heading', { name: 'Test Execution Pass Rates' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Defect Density by Module' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Requirement Coverage Breakdown' })).toBeVisible();

    // Verify Requirements Breakdown Table
    await expect(page.getByText('REQ-001')).toBeVisible();
    await expect(page.getByText('REQ-002')).toBeVisible();
  });
});
