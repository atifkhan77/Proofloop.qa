import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import { prisma } from '@proofloop/prisma';

const runId = Date.now();
const ORG_NAME = `DirectoryVault Org ${runId}`;
const ADMIN_EMAIL = `admin-${runId}@example.com`;
const LEAD_EMAIL = `lead-${runId}@example.com`;
const PASSWORD = 'Passw0rd!123';
const TOKEN_KEY = 'proofloop-auth-token';

test.describe.configure({ mode: 'serial' });

let orgId: string;
let projectId: string;
let adminId: string;
let leadId: string;
let envId: string;

test.beforeAll(async () => {
  const hash = await bcrypt.hash(PASSWORD, 10);

  const org = await prisma.organization.create({
    data: { name: ORG_NAME },
  });
  orgId = org.id;

  const admin = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      passwordHash: hash,
      firstName: 'Alice',
      lastName: 'Director',
      role: 'ADMIN',
      organizationId: orgId,
    },
  });
  adminId = admin.id;

  const lead = await prisma.user.create({
    data: {
      email: LEAD_EMAIL,
      passwordHash: hash,
      firstName: 'Bob',
      lastName: 'Lead',
      role: 'QA_LEAD',
      organizationId: orgId,
    },
  });
  leadId = lead.id;

  const proj = await prisma.project.create({
    data: {
      name: `Project Vault ${runId}`,
      organizationId: orgId,
    },
  });
  projectId = proj.id;

  const env = await prisma.projectEnvironment.create({
    data: {
      name: 'STAGING',
      baseUrl: 'https://staging.example.com',
      projectId,
    },
  });
  envId = env.id;
});

test.afterAll(async () => {
  await prisma.defect.deleteMany({ where: { projectId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.$disconnect();
});

test.describe('Task 1C: Team Directory in Defects', () => {
  test('API: GET /projects/:projectId/members returns active team members', async ({ request }) => {
    // Log in as lead
    const loginRes = await request.post('http://localhost:4000/api/auth/login', {
      data: { email: LEAD_EMAIL, password: PASSWORD },
    });
    expect(loginRes.status()).toBe(200);
    const { token } = await loginRes.json();

    const membersRes = await request.get(`http://localhost:4000/api/projects/${projectId}/members`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(membersRes.status()).toBe(200);
    const members = await membersRes.json();
    expect(members.length).toBeGreaterThanOrEqual(2);

    const alice = members.find((m: any) => m.email === ADMIN_EMAIL);
    const bob = members.find((m: any) => m.email === LEAD_EMAIL);
    expect(alice).toBeDefined();
    expect(bob).toBeDefined();
    expect(alice.role).toBe('ADMIN');
    expect(bob.role).toBe('QA_LEAD');
  });

  test('UI: ManageDefectModal renders Team Directory dropdown and assigns user', async ({ page, request }) => {
    // Obtain admin token
    const loginRes = await request.post('http://localhost:4000/api/auth/login', {
      data: { email: ADMIN_EMAIL, password: PASSWORD },
    });
    const { token } = await loginRes.json();

    await page.goto('/login');
    await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, token] as const);

    await page.goto(`/projects/${projectId}/defects`);
    await expect(page.getByRole('heading', { name: 'Defect Intelligence' })).toBeVisible();

    // Open New Defect Modal
    await page.getByRole('button', { name: /report bug/i }).click();
    const modal = page.getByRole('dialog', { name: /report new defect/i });
    await expect(modal).toBeVisible();

    // Verify Assignee is a <select> dropdown with team members
    const assigneeSelect = modal.getByLabel(/assignee/i);
    await expect(assigneeSelect).toBeVisible();
    await expect(assigneeSelect.getByRole('option', { name: /-- unassigned --/i })).toBeAttached();
    await expect(assigneeSelect.getByRole('option', { name: /Bob Lead \(QA_LEAD\)/i })).toBeAttached();

    // Fill form and select Bob Lead as assignee
    await modal.getByLabel('Bug ID').fill('BUG-101');
    await modal.getByLabel('Title').fill('Payment webhook signature mismatch');
    await modal.getByLabel('Description').fill('Webhook HMAC signature fails validation on staging');
    await assigneeSelect.selectOption({ label: `Bob Lead (QA_LEAD) - ${LEAD_EMAIL}` });

    await modal.getByRole('button', { name: /create defect/i }).click();

    // Verify defect appears in table with assignee Bob Lead
    await expect(page.getByText('BUG-101')).toBeVisible();
    await expect(page.getByText('Payment webhook signature mismatch')).toBeVisible();
    await expect(page.getByText('Bob Lead')).toBeVisible();
  });
});

test.describe('Task 1D: Variables Vault in ManageEnvironmentsModal', () => {
  test('UI: Expanding environment opens Variables Vault, creates secret variable, displays masked value', async ({ page, request }) => {
    const loginRes = await request.post('http://localhost:4000/api/auth/login', {
      data: { email: ADMIN_EMAIL, password: PASSWORD },
    });
    const { token } = await loginRes.json();

    await page.goto('/login');
    await page.evaluate(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, token] as const);

    await page.goto(`/projects/${projectId}/automation`);
    await expect(page.getByRole('heading', { name: 'Automation Lab' })).toBeVisible();

    // Open Environments modal
    await page.getByRole('button', { name: /environments/i }).click();
    const modal = page.getByRole('dialog', { name: /manage environments/i });
    await expect(modal).toBeVisible();

    // STAGING environment is listed
    const envItem = modal.getByRole('listitem').filter({ hasText: 'STAGING' });
    await expect(envItem).toBeVisible();

    // Click on STAGING to expand Variables Vault
    await envItem.getByRole('button', { name: /variables vault/i }).click();
    await expect(envItem.getByText('Add Environment Variable')).toBeVisible();

    // Fill Add Variable subform
    await envItem.getByLabel(/variable key/i).fill('AUTH_TOKEN');
    await envItem.getByLabel(/variable value/i).fill('super-secret-vault-token-999');
    await envItem.getByLabel(/secret \(masked in api responses\)/i).check();

    await envItem.getByRole('button', { name: /add variable/i }).click();

    // Verify variable appears in list with masked value and Secret badge
    await expect(envItem.getByText('AUTH_TOKEN')).toBeVisible();
    await expect(envItem.getByText('********')).toBeVisible();
    await expect(envItem.getByText('Secret', { exact: true })).toBeVisible();

    // Add a non-secret variable
    await envItem.getByLabel(/variable key/i).fill('MAX_RETRIES');
    await envItem.getByLabel(/variable value/i).fill('5');
    await envItem.getByRole('button', { name: /add variable/i }).click();

    await expect(envItem.getByText('MAX_RETRIES')).toBeVisible();
    await expect(envItem.getByText('5')).toBeVisible();
  });
});
