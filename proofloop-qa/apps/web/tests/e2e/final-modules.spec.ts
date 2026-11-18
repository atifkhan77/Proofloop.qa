import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { prisma } from '@proofloop/prisma';

/**
 * ProofLoop Master QA Specification: Final Modules Verification Suite
 * Phase 2: Quality Gates & Intelligence
 * Phase 3: AI QA Brain, Root Cause Analyzer, Evidence Explorer & Database Sentinel
 */

const API = 'http://localhost:4000/api/';
const TOKEN_KEY = 'proofloop-auth-token';
const runId = Date.now();
const ORG_PREFIX = `E2E FinalQA ${runId}`;
const PASSWORD = 'Passw0rd!';

test.describe.configure({ mode: 'serial' });

let anon: APIRequestContext;
let adminApi: APIRequestContext;

let orgId: string;
let adminToken: string;
let projectId: string;
let moduleId: string;
let environmentId: string;
let reqId: string;
let defectId: string;
let executionId: string;

async function registerAdmin() {
  const email = `final-qa-admin-${runId}@example.com`;
  const res = await anon.post('auth/register', {
    data: {
      email,
      password: PASSWORD,
      firstName: 'FinalQA',
      lastName: 'Admin',
      organizationName: `${ORG_PREFIX} Org`,
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

  const admin = await registerAdmin();
  adminApi = admin.ctx;
  adminToken = admin.token;
  orgId = admin.organizationId;

  // Create Project
  const projRes = await adminApi.post('projects', { data: { name: `Final Modules Project ${runId}` } });
  expect(projRes.status()).toBe(201);
  projectId = (await projRes.json()).id;

  // Create Module
  const modRes = await adminApi.post(`projects/${projectId}/modules`, { data: { name: `Checkout Engine ${runId}` } });
  expect(modRes.status()).toBe(201);
  moduleId = (await modRes.json()).id;

  // Create Environment
  const envRes = await adminApi.post(`projects/${projectId}/environments`, {
    data: { name: 'Staging Sentinel' },
  });
  expect(envRes.status()).toBe(201);
  environmentId = (await envRes.json()).id;

  // Create Requirement
  const reqRes = await adminApi.post(`modules/${moduleId}/requirements`, {
    data: {
      reqId: 'REQ-FINAL-01',
      title: 'Checkout 3D Secure Verification Flow',
      description: 'Customer initiates payment and completes OTP bank verification within 120 seconds.',
      priority: 'HIGH',
      businessCriticality: 'CRITICAL',
    },
  });
  expect(reqRes.status()).toBe(201);
  reqId = (await reqRes.json()).id;

  // Create Defect for Root Cause Analyzer
  const defRes = await adminApi.post(`projects/${projectId}/defects`, {
    data: {
      bugId: 'BUG-101',
      title: 'Payment Gateway Timeout on OTP Submission',
      description: 'API returns 504 Gateway Timeout during high concurrency webhook processing.',
      severity: 'CRITICAL',
      status: 'OPEN',
      stepsToReproduce: '1. Initiate payment\n2. Wait 30s\n3. Submit OTP',
    },
  });
  expect(defRes.status()).toBe(201);
  defectId = (await defRes.json()).id;

  // Seed an AutomationProject and AutomationExecution for Evidence Explorer & Root Cause
  const autoProj = await prisma.automationProject.create({
    data: {
      name: 'Playwright E2E Suite',
      framework: 'PLAYWRIGHT',
      repository: 'https://github.com/example/e2e-tests',
      projectId,
    },
  });

  const exec = await prisma.automationExecution.create({
    data: {
      runId: 'RUN-101',
      status: 'FAILED',
      trigger: 'MANUAL',
      passedCount: 8,
      failedCount: 2,
      skippedCount: 0,
      logUrl: 'https://storage.example.com/logs/run-101.log',
      automationProjectId: autoProj.id,
      environmentId: environmentId,
      artifacts: [
        {
          id: 'art-101-1',
          name: 'step-3-timeout-screenshot.png',
          type: 'screenshot',
          url: '/placeholder-evidence.png',
          sizeBytes: 94200,
        },
        {
          id: 'art-101-2',
          name: 'playwright-test.log',
          type: 'log',
          url: '/placeholder-log.txt',
          sizeBytes: 8192,
        },
      ],
    },
  });
  executionId = exec.id;
});

test.afterAll(async () => {
  await anon?.dispose();
  await adminApi?.dispose();

  const orgs = { name: { startsWith: ORG_PREFIX } };
  await prisma.defect.deleteMany({ where: { project: { organization: orgs } } });
  await prisma.testExecution.deleteMany({ where: { testCycle: { project: { organization: orgs } } } });
  await prisma.testCycle.deleteMany({ where: { project: { organization: orgs } } });
  await prisma.automationExecution.deleteMany({ where: { automationProject: { project: { organization: orgs } } } });
  await prisma.automationProject.deleteMany({ where: { project: { organization: orgs } } });
  await prisma.qualityGateConfig.deleteMany({ where: { project: { organization: orgs } } });
  await prisma.testCase.deleteMany({ where: { project: { organization: orgs } } });
  await prisma.requirement.deleteMany({ where: { module: { project: { organization: orgs } } } });
  await prisma.environmentVariable.deleteMany({ where: { environment: { project: { organization: orgs } } } });
  await prisma.projectEnvironment.deleteMany({ where: { project: { organization: orgs } } });
  await prisma.module.deleteMany({ where: { project: { organization: orgs } } });
  await prisma.project.deleteMany({ where: { organization: orgs } });
  await prisma.organization.deleteMany({ where: orgs });
  await prisma.$disconnect();
});

// =========================================================================
// 1. RELEASE QUALITY GATE TESTS
// =========================================================================

test.describe('Release Quality Gate', () => {
  test('evaluates release readiness with blocking criteria and returns NO_GO when critical defect is active', async () => {
    // Act: evaluate quality gate for project
    const res = await adminApi.get(`projects/${projectId}/quality-gate/evaluate`);
    expect(res.status()).toBe(200);

    const data = await res.json();
    // Assert: Since we created a CRITICAL defect and requirement has 0 test cases, status must be NO_GO
    expect(data.status).toBe('NO_GO');
    expect(data.isReleaseReady).toBe(false);
    expect(data.blockingReasons.length).toBeGreaterThan(0);
    expect(data.criteria.criticalDefects.passed).toBe(false);
  });

  test('updates quality gate config thresholds', async () => {
    // Arrange: update config to allow 1 critical defect
    const updateRes = await adminApi.put(`projects/${projectId}/quality-gate/config`, {
      data: {
        maxActiveCriticalDefects: 2,
        maxActiveHighDefects: 5,
        requireFullCoverage: false,
        requireCriticalRiskCoverage: false,
      },
    });
    expect(updateRes.status()).toBe(200);

    // Act: evaluate again
    const res = await adminApi.get(`projects/${projectId}/quality-gate/evaluate`);
    const data = await res.json();

    // Assert: Now critical defects criteria passes under the new threshold
    expect(data.criteria.criticalDefects.passed).toBe(true);
  });

  test('UI displays Release Quality Gate page and criteria indicators', async ({ page }) => {
    // Arrange: login as admin
    await page.goto('/login');
    await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, adminToken] as const);

    // Act: navigate to project quality gate
    await page.goto(`/projects/${projectId}/releases`);

    // Assert: Header and criteria elements are visible
    await expect(page.getByRole('heading', { name: /release quality gate/i })).toBeVisible();
    await expect(page.getByText(/gate criteria breakdown/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /configure gate/i })).toBeVisible();
  });
});

// =========================================================================
// 2. AI QA BRAIN TESTS
// =========================================================================

test.describe('AI QA Brain', () => {
  test('synthesizes structured test case drafts from requirement and auto-saves to test suite', async () => {
    // Act: trigger AI test generation
    const res = await adminApi.post(`requirements/${reqId}/ai/generate-test-cases`, {
      data: { autoSave: true },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    // Assert: drafts returned with steps
    expect(body.drafts.length).toBeGreaterThanOrEqual(3);
    expect(body.drafts[0]).toHaveProperty('title');
    expect(body.drafts[0]).toHaveProperty('steps');
    expect(body.drafts[0].steps.length).toBeGreaterThan(0);

    // Assert: savedTestCases persisted in database
    expect(body.savedTestCases.length).toBe(body.drafts.length);
    expect(body.savedTestCases[0].tcId).toMatch(/^TC-\d{3}$/);

    // Verify persisted in DB
    const dbCases = await prisma.testCase.findMany({ where: { requirementId: reqId } });
    expect(dbCases.length).toBe(body.drafts.length);
  });

  test('UI displays AI QA Brain page and renders synthesis studio', async ({ page }) => {
    // Arrange: login
    await page.goto('/login');
    await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, adminToken] as const);

    // Act: navigate to /ai-brain
    await page.goto('/ai-brain');

    // Assert: Page elements
    await expect(page.getByRole('heading', { name: /ai qa brain/i })).toBeVisible();
    await expect(page.getByText(/target specification input/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /synthesize test cases/i })).toBeVisible();
  });
});

// =========================================================================
// 3. ROOT CAUSE ANALYZER TESTS
// =========================================================================

test.describe('Root Cause Analyzer', () => {
  test('generates failure hypothesis and diagnostic classification for a defect', async () => {
    // Act: call root-cause endpoint for defect
    const res = await adminApi.get(`defects/${defectId}/root-cause`);
    expect(res.status()).toBe(200);

    const data = await res.json();
    // Assert: contains hypothesis and structured analysis
    expect(data.hypothesis).toBeTruthy();
    expect(data.analysis).toHaveProperty('likelyCulprit');
    expect(data.analysis).toHaveProperty('suggestedRemediation');

    // Verify stored on defect record
    const updatedDef = await prisma.defect.findUnique({ where: { id: defectId } });
    expect(updatedDef?.rootCauseHypothesis).toBe(data.hypothesis);
  });

  test('generates failure diagnostic for an automation execution run', async () => {
    // Act: call root-cause endpoint for execution
    const res = await adminApi.get(`automation/executions/${executionId}/root-cause`);
    expect(res.status()).toBe(200);

    const data = await res.json();
    // Assert: contains analysis
    expect(data.hypothesis).toBeTruthy();
    expect(data.analysis).toHaveProperty('likelyCulprit');
  });

  test('UI displays Root Cause Analyzer with defect/run tabs', async ({ page }) => {
    // Arrange: login
    await page.goto('/login');
    await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, adminToken] as const);

    // Act: navigate to /root-cause
    await page.goto('/root-cause');

    // Assert: Heading and tabs
    await expect(page.getByRole('heading', { name: /root cause analyzer/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /defects/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /runs/i })).toBeVisible();
  });
});

// =========================================================================
// 4. EVIDENCE EXPLORER TESTS
// =========================================================================

test.describe('Evidence Explorer', () => {
  test('fetches captured artifacts and execution history for project', async () => {
    // Act: get evidence for project
    const res = await adminApi.get(`projects/${projectId}/evidence`);
    expect(res.status()).toBe(200);

    const list = await res.json();
    // Assert: execution run present with artifacts
    expect(list.length).toBeGreaterThan(0);
    const item = list.find((e: any) => e.id === executionId);
    expect(item).toBeTruthy();
    expect(item.artifacts.length).toBe(2);
    expect(item.artifacts[0].type).toBe('screenshot');
    expect(item.artifacts[1].type).toBe('log');
  });

  test('UI displays Evidence Explorer page and artifact gallery', async ({ page }) => {
    // Arrange: login
    await page.goto('/login');
    await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, adminToken] as const);

    // Act: navigate to /evidence
    await page.goto('/evidence');

    // Assert: Page elements
    await expect(page.getByRole('heading', { name: /evidence explorer/i })).toBeVisible();
    await expect(page.getByText(/execution runs/i)).toBeVisible();
  });
});

// =========================================================================
// 5. DATABASE SENTINEL TESTS
// =========================================================================

test.describe('Database Sentinel', () => {
  test('executes safe read-only SELECT query successfully', async () => {
    // Arrange: a target database is required (no fallback to the app database). The test DB on
    // 127.0.0.1:5433 is reachable only because playwright.config.ts lists it in SSRF_ALLOWED_TARGETS.
    const target = process.env.DATABASE_URL!.replace('@localhost:', '@127.0.0.1:');
    const conn = await adminApi.put(`environments/${environmentId}/database/connection`, {
      data: { connectionString: target },
    });
    expect(conn.status()).toBe(200);

    // Act: execute read-only query in environment
    const res = await adminApi.post(`environments/${environmentId}/database/query`, {
      data: { query: 'SELECT 1 as sentinel_val, NOW() as test_time;' },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    // Assert: result structure
    expect(body.rowCount).toBe(1);
    expect(body.rows[0].sentinel_val).toBe(1);
    expect(body).toHaveProperty('executedAt');
  });

  test('blocks data mutation statements with 400 Security Violation', async () => {
    // Act: attempt DROP TABLE
    const dropRes = await adminApi.post(`environments/${environmentId}/database/query`, {
      data: { query: 'DROP TABLE "User";' },
    });
    // Assert: Security violation rejected
    expect(dropRes.status()).toBe(400);
    const dropBody = await dropRes.json();
    expect(dropBody.error).toMatch(/Security Violation/i);

    // Act: attempt INSERT INTO
    const insertRes = await adminApi.post(`environments/${environmentId}/database/query`, {
      data: { query: 'INSERT INTO "Project" (id, name) VALUES (\'malicious\', \'hack\');' },
    });
    // Assert: Security violation rejected
    expect(insertRes.status()).toBe(400);
    const insertBody = await insertRes.json();
    expect(insertBody.error).toMatch(/Security Violation/i);
  });

  test('UI displays Database Sentinel SQL console and read-only badge', async ({ page }) => {
    // Arrange: login
    await page.goto('/login');
    await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, adminToken] as const);

    // Act: navigate to /database
    await page.goto('/database');

    // Assert: Page elements
    await expect(page.getByRole('heading', { name: /database sentinel/i })).toBeVisible();
    await expect(page.getByText('STRICT READ-ONLY')).toBeVisible();
    await expect(page.getByRole('button', { name: /run sentinel query/i })).toBeVisible();
  });
});
