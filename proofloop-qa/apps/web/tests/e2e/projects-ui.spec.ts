import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { prisma, type Role } from '@proofloop/prisma';

/**
 * Phase 2 UI regression: dashboard project list, create-project modal,
 * project detail / modules, and role-based visibility of create buttons.
 */

const runId = Date.now();
const ORG = `E2E UiOrg ${runId}`;
const EMAIL = `e2e-ui-${runId}@example.com`;
const PASSWORD = 'Passw0rd!';
const PROJECT = `UI Project ${runId}`;

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;
let userId: string;

test.beforeAll(async ({ browser, baseURL }) => {
  // Explicit context so tests can open extra tabs sharing the same login.
  context = await browser.newContext({ baseURL });
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
  await prisma.organization.deleteMany({ where: { name: ORG } });
  await prisma.$disconnect();
});

/** Change role in DB; a reload re-runs /auth/me, which returns the DB role. */
async function setRole(role: Role) {
  await prisma.user.update({ where: { id: userId }, data: { role } });
  await page.reload();
}

test('admin sees empty dashboard after registering', async () => {
  await page.goto('/register');
  await page.getByLabel('First Name').fill('UI');
  await page.getByLabel('Last Name').fill('Admin');
  await page.getByLabel('Organization Name').fill(ORG);
  await page.getByLabel('Work Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByText('No projects yet')).toBeVisible();

  const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
  userId = user.id;
});

test('blank project name shows validation error; Escape closes modal', async () => {
  await page.getByRole('button', { name: 'New Project' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create New Project' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Project Name').fill('   ');
  await dialog.getByRole('button', { name: 'Create Project' }).click();
  await expect(dialog.getByText('Project name is required')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('create project adds a card and closes the modal', async () => {
  await page.getByRole('button', { name: 'New Project' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create New Project' });
  // Reopened modal must be reset after Escape.
  await expect(dialog.getByLabel('Project Name')).toHaveValue('');
  await dialog.getByLabel('Project Name').fill(`  ${PROJECT}  `);
  await dialog.getByLabel('Description (Optional)').fill('Checkout flows');
  await dialog.getByRole('button', { name: 'Create Project' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: new RegExp(PROJECT) })).toBeVisible();
  await expect(page.getByText('Checkout flows')).toBeVisible();
});

test('project persists after reload', async () => {
  await page.reload();
  await expect(page.getByRole('link', { name: new RegExp(PROJECT) })).toBeVisible();
});

test('opening a project shows its empty module list', async () => {
  await page.getByRole('link', { name: new RegExp(PROJECT) }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
  // Heading is the project name (from GET /projects/:id).
  await expect(page.getByRole('heading', { name: PROJECT, level: 1 })).toBeVisible();
  await expect(page.getByText('No modules yet')).toBeVisible();
});

test('create module adds a card', async () => {
  await page.getByRole('button', { name: 'New Module' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create New Module' });
  await dialog.getByLabel('Module Name').fill('Checkout');
  await dialog.getByRole('button', { name: 'Create Module' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: /Checkout/ })).toBeVisible();
});

test('duplicate module name shows the API 409 message', async () => {
  await page.getByRole('button', { name: 'New Module' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create New Module' });
  await dialog.getByLabel('Module Name').fill('Checkout');
  await dialog.getByRole('button', { name: 'Create Module' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('A module with this name already exists in this project');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

// ---------- Requirements UI ----------

let requirementsUrl: string;

test('module card opens its requirements page with module/project context', async () => {
  await page.getByRole('link', { name: /Checkout/ }).click();
  await expect(page).toHaveURL(/\/modules\/[0-9a-f-]+\/requirements$/);
  requirementsUrl = page.url();
  await expect(page.getByRole('heading', { name: 'Checkout Requirements', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: `Back to ${PROJECT}` })).toBeVisible();
  await expect(page.getByText('No requirements yet')).toBeVisible();
});

test('blank requirement fields show validation errors', async () => {
  await page.getByRole('button', { name: 'New Requirement' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create New Requirement' });
  await dialog.getByLabel('Requirement ID').fill('   ');
  await dialog.getByRole('button', { name: 'Create Requirement' }).click();
  await expect(dialog.getByText('Requirement ID is required')).toBeVisible();
  await expect(dialog.getByText('Title is required')).toBeVisible();
  await expect(dialog.getByText('Description is required')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('create requirement adds a table row with chosen enums', async () => {
  await page.getByRole('button', { name: 'New Requirement' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create New Requirement' });
  await expect(dialog.getByLabel('Requirement ID')).toHaveValue(''); // reset after Escape
  await expect(dialog.getByLabel('Priority')).toHaveValue('MEDIUM'); // default
  await dialog.getByLabel('Requirement ID').fill(' REQ-001 ');
  await dialog.getByLabel('Title').fill('Guest checkout');
  await dialog.getByLabel('Detailed Description').fill('User can pay without an account');
  await dialog.getByLabel('Priority').selectOption('HIGH');
  await dialog.getByLabel('Business Criticality').selectOption('CRITICAL');
  await dialog.getByRole('button', { name: 'Create Requirement' }).click();
  await expect(dialog).toBeHidden();

  const row = page.getByRole('row', { name: /REQ-001/ });
  await expect(row.getByRole('cell').nth(0)).toHaveText('REQ-001');
  await expect(row.getByRole('cell').nth(1)).toHaveText('Guest checkout');
  await expect(row.getByRole('cell').nth(2)).toHaveText('HIGH');
  await expect(row.getByRole('cell').nth(3)).toHaveText('CRITICAL');
  await expect(row.getByRole('cell').nth(4)).toHaveText('0');
});

test('duplicate requirement ID shows the API 409 message', async () => {
  await page.getByRole('button', { name: 'New Requirement' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create New Requirement' });
  await dialog.getByLabel('Requirement ID').fill('REQ-001');
  await dialog.getByLabel('Title').fill('Dup');
  await dialog.getByLabel('Detailed Description').fill('Dup');
  await dialog.getByRole('button', { name: 'Create Requirement' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('A requirement with this ID already exists in this project');
  // Closing via X clears the server error for the next open.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'New Requirement' }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('reload keeps module/project context (router state lives in history)', async () => {
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Checkout Requirements', level: 1 })).toBeVisible();
  await expect(page.getByRole('row', { name: /REQ-001/ })).toBeVisible();
});

test('direct visit in a new tab loads module/project context from GET /modules/:id', async () => {
  // New tab = fresh history (no router state), same context = same login token.
  const fresh = await context.newPage();
  try {
    const moduleCall = fresh.waitForResponse((r) => /\/api\/modules\/[0-9a-f-]+$/.test(r.url()));
    await fresh.goto(requirementsUrl);
    expect((await moduleCall).status()).toBe(200);
    await expect(fresh.getByRole('heading', { name: 'Checkout Requirements', level: 1 })).toBeVisible();
    await fresh.getByRole('link', { name: `Back to ${PROJECT}` }).click();
    await expect(fresh.getByRole('heading', { name: PROJECT, level: 1 })).toBeVisible();
  } finally {
    await fresh.close();
  }
});

test('navigating from the project page does not call GET /modules/:id (router state used)', async () => {
  const calls: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/modules\/[0-9a-f-]+$/.test(r.url())) calls.push(r.url());
  });
  await page.getByRole('link', { name: `Back to ${PROJECT}` }).click();
  await page.getByRole('link', { name: /Checkout/ }).click();
  await expect(page.getByRole('heading', { name: 'Checkout Requirements', level: 1 })).toBeVisible();
  expect(calls).toEqual([]);
});

test('if GET /modules/:id fails, requirements still load with generic heading', async () => {
  const fresh = await context.newPage();
  try {
    await fresh.route(/\/api\/modules\/[0-9a-f-]+$/, (route) => route.fulfill({ status: 500, body: '{}' }));
    await fresh.goto(requirementsUrl);
    await expect(fresh.getByRole('heading', { name: 'Module Requirements', level: 1 })).toBeVisible();
    await expect(fresh.getByRole('link', { name: 'Back to Dashboard' })).toBeVisible();
    await expect(fresh.getByRole('row', { name: /REQ-001/ })).toBeVisible();
  } finally {
    await fresh.close();
  }
});

test('requirement IDs are case-insensitive: lowercase duplicate is rejected', async () => {
  await page.getByRole('button', { name: 'New Requirement' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create New Requirement' });
  await dialog.getByLabel('Requirement ID').fill('req-001');
  await dialog.getByLabel('Title').fill('Lowercase dup');
  await dialog.getByLabel('Detailed Description').fill('Should collide with REQ-001');
  await dialog.getByRole('button', { name: 'Create Requirement' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('A requirement with this ID already exists in this project');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('unknown module id shows "Module not found"', async () => {
  await page.goto('/modules/00000000-0000-0000-0000-000000000000/requirements');
  await expect(page.getByRole('alert')).toHaveText('Module not found');
});

test('unknown project id shows "Project not found"', async () => {
  await page.goto('/projects/00000000-0000-0000-0000-000000000000');
  await expect(page.getByRole('alert')).toHaveText('Project not found');
});

test('QA_ENGINEER: no "New Project", but can create modules', async () => {
  await page.goto('/');
  await setRole('QA_ENGINEER');
  await expect(page.getByRole('link', { name: new RegExp(PROJECT) })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Project' })).toHaveCount(0);
  await page.getByRole('link', { name: new RegExp(PROJECT) }).click();
  await expect(page.getByRole('button', { name: 'New Module' })).toBeVisible();
});

test('VIEWER: read-only, no create buttons anywhere', async () => {
  await setRole('VIEWER');
  await expect(page.getByRole('link', { name: /Checkout/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Module' })).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByRole('link', { name: new RegExp(PROJECT) })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Project' })).toHaveCount(0);
  await page.goto(requirementsUrl);
  await expect(page.getByRole('row', { name: /REQ-001/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Requirement' })).toHaveCount(0);
});
