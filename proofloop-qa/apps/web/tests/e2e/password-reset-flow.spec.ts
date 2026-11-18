import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@proofloop/prisma';

const runId = Date.now();
const ORG_NAME = `PasswordReset Org ${runId}`;
const USER_EMAIL = `reset-user-${runId}@example.com`;
const DEACTIVATED_EMAIL = `deactivated-${runId}@example.com`;
const INITIAL_PASSWORD = 'OldPassw0rd!123';
const NEW_PASSWORD = 'BrandNewSecurePassw0rd!456';

test.describe.configure({ mode: 'serial' });

/** The API stores only SHA-256(token); tests seed the DB the same way. */
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

let orgId: string;
let userId: string;
let deactivatedUserId: string;

test.beforeAll(async () => {
  const hash = await bcrypt.hash(INITIAL_PASSWORD, 10);

  const org = await prisma.organization.create({
    data: { name: ORG_NAME },
  });
  orgId = org.id;

  const user = await prisma.user.create({
    data: {
      email: USER_EMAIL,
      passwordHash: hash,
      firstName: 'Alice',
      lastName: 'ResetTest',
      role: 'ADMIN',
      organizationId: orgId,
    },
  });
  userId = user.id;

  const deactivated = await prisma.user.create({
    data: {
      email: DEACTIVATED_EMAIL,
      passwordHash: hash,
      firstName: 'Dan',
      lastName: 'Deactivated',
      role: 'VIEWER',
      organizationId: orgId,
      deletedAt: new Date(),
    },
  });
  deactivatedUserId = deactivated.id;
});

test.afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.$disconnect();
});

test.describe('Password Reset Backend Security & API', () => {
  test('forgot-password: anti-enumeration returns 200 for non-existent email without error', async ({ request }) => {
    const res = await request.post('http://localhost:4000/api/auth/forgot-password', {
      data: { email: 'nonexistent-random-user@example.com' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.message).toContain('If an account exists, a reset link has been sent');
  });

  test('forgot-password: deactivated user returns 200 but does NOT generate a reset token', async ({ request }) => {
    const res = await request.post('http://localhost:4000/api/auth/forgot-password', {
      data: { email: DEACTIVATED_EMAIL },
    });
    expect(res.status()).toBe(200);

    const userInDb = await prisma.user.findUniqueOrThrow({ where: { id: deactivatedUserId } });
    expect(userInDb.resetToken).toBeNull();
  });

  test('forgot-password: validation rejects invalid email format', async ({ request }) => {
    const res = await request.post('http://localhost:4000/api/auth/forgot-password', {
      data: { email: 'not-an-email' },
    });
    expect(res.status()).toBe(400);
  });

  test('forgot-password: generates 64-char hex token and 15-minute expiry for active user', async ({ request }) => {
    const beforeTime = Date.now();
    const res = await request.post('http://localhost:4000/api/auth/forgot-password', {
      data: { email: `  ${USER_EMAIL.toUpperCase()}  ` }, // Test trim & lowercase
    });
    expect(res.status()).toBe(200);

    const userInDb = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(userInDb.resetToken).toBeDefined();
    expect(userInDb.resetToken?.length).toBe(64); // 32 bytes hex = 64 characters
    expect(userInDb.resetTokenExpiry).toBeDefined();

    const expiryTime = userInDb.resetTokenExpiry!.getTime();
    const diffMinutes = (expiryTime - beforeTime) / (60 * 1000);
    expect(diffMinutes).toBeGreaterThan(14.5);
    expect(diffMinutes).toBeLessThan(15.5);
  });

  test('reset-password: rejects expired token', async ({ request }) => {
    // Manually set token to expired in the past
    const expiredToken = 'expired-dummy-token-1234567890abcdef1234567890abcdef';
    await prisma.user.update({
      where: { id: userId },
      data: {
        resetToken: sha256(expiredToken),
        resetTokenExpiry: new Date(Date.now() - 60 * 1000), // 1 min ago
      },
    });

    const res = await request.post('http://localhost:4000/api/auth/reset-password', {
      data: { token: expiredToken, newPassword: 'ValidNewPassword123' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid or expired password reset token');
  });

  test('reset-password: rejects password with less than 8 characters', async ({ request }) => {
    const res = await request.post('http://localhost:4000/api/auth/reset-password', {
      data: { token: 'any-token', newPassword: 'short' },
    });
    expect(res.status()).toBe(400);
  });

  test('reset-password: valid token updates password and invalidates token', async ({ request }) => {
    const validToken = 'valid-test-token-1234567890abcdef1234567890abcdef';
    await prisma.user.update({
      where: { id: userId },
      data: {
        resetToken: sha256(validToken),
        resetTokenExpiry: new Date(Date.now() + 10 * 60 * 1000), // 10 mins from now
      },
    });

    const res = await request.post('http://localhost:4000/api/auth/reset-password', {
      data: { token: validToken, newPassword: NEW_PASSWORD },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.message).toContain('Password has been successfully reset');

    // Token must be invalidated in DB
    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(updatedUser.resetToken).toBeNull();
    expect(updatedUser.resetTokenExpiry).toBeNull();

    // Reusing the same token should fail
    const reuseRes = await request.post('http://localhost:4000/api/auth/reset-password', {
      data: { token: validToken, newPassword: 'AnotherPassword999' },
    });
    expect(reuseRes.status()).toBe(400);

    // Old password should now fail to authenticate
    const oldLogin = await request.post('http://localhost:4000/api/auth/login', {
      data: { email: USER_EMAIL, password: INITIAL_PASSWORD },
    });
    expect(oldLogin.status()).toBe(401);

    // New password authenticates successfully
    const newLogin = await request.post('http://localhost:4000/api/auth/login', {
      data: { email: USER_EMAIL, password: NEW_PASSWORD },
    });
    expect(newLogin.status()).toBe(200);
    const loginBody = await newLogin.json();
    expect(loginBody.token).toBeDefined();
    expect(loginBody.user.email).toBe(USER_EMAIL);
    // Regression: login used to return resetToken / resetTokenExpiry with the user.
    expect(Object.keys(loginBody.user).sort()).toEqual(['email', 'firstName', 'id', 'lastName', 'organizationId', 'role']);
  });

  test('reset-password: tokens issued before the reset are revoked (SEC-14)', async ({ request }) => {
    // Arrange: a session from before the reset (iat has 1 s granularity, so wait past it)
    const before = await request.post('http://localhost:4000/api/auth/login', { data: { email: USER_EMAIL, password: NEW_PASSWORD } });
    const oldToken = (await before.json()).token as string;
    expect((await request.get('http://localhost:4000/api/auth/me', { headers: { Authorization: `Bearer ${oldToken}` } })).status()).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const resetToken = 'sec14-reset-token-1234567890abcdef1234567890abcdef';
    await prisma.user.update({
      where: { id: userId },
      data: { resetToken: sha256(resetToken), resetTokenExpiry: new Date(Date.now() + 10 * 60 * 1000) },
    });

    // Act
    const reset = await request.post('http://localhost:4000/api/auth/reset-password', { data: { token: resetToken, newPassword: NEW_PASSWORD } });

    // Assert: old session rejected, a fresh login works
    expect(reset.status()).toBe(200);
    const stale = await request.get('http://localhost:4000/api/auth/me', { headers: { Authorization: `Bearer ${oldToken}` } });
    expect(stale.status()).toBe(401);
    expect((await stale.json()).error).toBe('Unauthorized: Session expired after a password change');
    const fresh = await request.post('http://localhost:4000/api/auth/login', { data: { email: USER_EMAIL, password: NEW_PASSWORD } });
    const freshToken = (await fresh.json()).token as string;
    expect((await request.get('http://localhost:4000/api/auth/me', { headers: { Authorization: `Bearer ${freshToken}` } })).status()).toBe(200);
  });

  test('reset-password: the value stored in the database is not a usable token (stored hashed)', async ({ request }) => {
    // Arrange: a real reset request stores the token hash
    await request.post('http://localhost:4000/api/auth/forgot-password', { data: { email: USER_EMAIL } });
    const stored = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).resetToken!;
    expect(stored).toMatch(/^[0-9a-f]{64}$/);

    // Act: someone who can read the database tries the stored value as the token
    const res = await request.post('http://localhost:4000/api/auth/reset-password', {
      data: { token: stored, newPassword: 'TakeoverPassw0rd!' },
    });

    // Assert
    expect(res.status()).toBe(400);
    const login = await request.post('http://localhost:4000/api/auth/login', {
      data: { email: USER_EMAIL, password: NEW_PASSWORD },
    });
    expect(login.status()).toBe(200);
  });
});

test.describe('Password Reset UI Flow', () => {
  test('Login UI contains "Forgot password?" link that navigates to /forgot-password', async ({ page }) => {
    await page.goto('/login');
    const forgotLink = page.getByRole('link', { name: /forgot password\?/i });
    await expect(forgotLink).toBeVisible();

    await forgotLink.click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  });

  test('Forgot Password page submits email and displays confirmation banner', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email address').fill(USER_EMAIL);
    await page.getByRole('button', { name: /send reset instructions/i }).click();

    await expect(page.getByText('Check your email for reset instructions.')).toBeVisible();
    await expect(page.getByRole('link', { name: /back to sign in/i })).toBeVisible();
  });

  test('Reset Password page without token displays warning alert', async ({ page }) => {
    await page.goto('/reset-password');
    await expect(page.getByRole('alert')).toContainText(/invalid or missing reset token/i);
    await expect(page.getByRole('link', { name: /request a new link/i })).toBeVisible();
  });

  test('Reset Password page with valid token resets password and allows sign-in', async ({ page }) => {
    // 1. Set a fresh token in DB
    const uiResetToken = 'ui-flow-token-abcdef1234567890abcdef1234567890';
    await prisma.user.update({
      where: { id: userId },
      data: {
        resetToken: uiResetToken,
        resetTokenExpiry: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    // 2. Visit reset password with token query param
    await page.goto(`/reset-password?token=${uiResetToken}`);
    await expect(page.getByRole('heading', { name: 'Set new password' })).toBeVisible();

    // 3. Fill mismatched passwords -> validation error
    await page.getByLabel('New Password').fill('BrandNewPass123!');
    await page.getByLabel('Confirm Password').fill('MismatchingPass123!');
    await page.getByRole('button', { name: /reset password/i }).click();
    await expect(page.getByText('Passwords do not match')).toBeVisible();

    // 4. Fill matching password and submit
    const finalPassword = 'FinalUpdatedSecret2026!';
    await page.getByLabel('Confirm Password').fill('BrandNewPass123!');
    await page.getByLabel('New Password').fill(finalPassword);
    await page.getByLabel('Confirm Password').fill(finalPassword);
    await page.getByRole('button', { name: /reset password/i }).click();

    // 5. Verify success banner
    await expect(page.getByText('Password has been successfully reset.')).toBeVisible();

    // 6. Navigate to login and sign in with the new password
    await page.goto('/login');
    await page.getByLabel('Email address').fill(USER_EMAIL);
    await page.getByLabel('Password').fill(finalPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // 7. Verify successful dashboard landing
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  });
});
