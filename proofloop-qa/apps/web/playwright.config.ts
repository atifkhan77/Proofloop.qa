import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// apps/web is "type": "module", so __dirname is not defined.
const configDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * PROOFLOOP QA product regression tests (our own app, not user tests —
 * those belong to packages/playwright-engine).
 *
 * Preconditions: `npm run infra:up` (Postgres + Redis) and schema pushed.
 * Playwright starts the API and the Vite dev server itself.
 */
const repoRoot = path.resolve(configDir, '../..');

// Root .env holds DATABASE_URL, used by the test teardown to delete test data.
process.loadEnvFile(path.join(repoRoot, '.env'));

export default defineConfig({
  testDir: './tests/e2e',
  // Tests share one database; keep them serial and deterministic.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run dev -w @proofloop/api',
      cwd: repoRoot,
      // TEST-ONLY: lets the API execution engine reach the local target server started by
      // api-execution-api.spec.ts. Everything else stays blocked by the SSRF guard.
      // 127.0.0.1:5433 = the test Postgres, used as a Database Sentinel target (SEC-03).
      // (An API you already run yourself without this variable makes those tests fail.)
      // API_EXECUTION_RATE_LIMIT: the suite runs ~70 executions per org within a minute; the
      // 429 test (api-variables-api.spec.ts) sends limit+1 requests from a fresh organization.
      env: { ...(process.env as Record<string, string>), SSRF_ALLOWED_TARGETS: '127.0.0.1:4999,127.0.0.1:5433', API_EXECUTION_RATE_LIMIT: '200' },
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      cwd: configDir,
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Execution worker (no HTTP port): ready once it logs its startup line.
      // A worker you already run yourself is fine too – BullMQ hands each job to one worker.
      name: 'Worker',
      command: 'npm run dev -w @proofloop/worker',
      cwd: repoRoot,
      wait: { stdout: /PROOFLOOP Worker ready/ },
      stdout: 'pipe',
      timeout: 60_000,
    },
  ],
});
