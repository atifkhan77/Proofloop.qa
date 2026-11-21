/**
 * Runs Playwright tests in a throwaway Docker container.
 *
 * Security model: repository code (npm lifecycle scripts, playwright.config, the tests themselves)
 * and LLM-generated scripts are untrusted. They only ever execute inside the container, which gets
 * a COPY of the workspace (no bind mount), no host secrets (only the run's environment variables),
 * resource limits, and no-new-privileges. The host only runs `git clone` with hooks disabled.
 */
import { spawn } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface SandboxScript {
  fileName: string;
  code: string;
}

export interface SandboxInput {
  executionId: string;
  repository: string | null;
  branch: string | null;
  scripts: SandboxScript[];
  baseUrl: string | null;
  /** Environment variables from the run's environment (passed to the tests). */
  variables: Array<{ key: string; value: string; isSecret: boolean }>;
}

export interface TestResult {
  title: string;
  file: string;
  project: string;
  status: 'passed' | 'failed' | 'flaky' | 'skipped';
  durationMs: number;
  error?: string;
}

export interface SandboxResult {
  status: 'PASSED' | 'FAILED';
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  results: TestResult[];
  logs: string;
}

/** Default image, used when the repository's Playwright version is unknown or has no image. */
const IMAGE = process.env.PLAYWRIGHT_IMAGE || 'mcr.microsoft.com/playwright:v1.64.1-noble';
/** @playwright/test version matching IMAGE's browsers. */
const PLAYWRIGHT_VERSION = process.env.PLAYWRIGHT_VERSION || '1.64.1';
const IMAGE_REPOSITORY = 'mcr.microsoft.com/playwright';
/** Ubuntu flavours of the official images, newest first (older releases only have jammy/focal). */
const IMAGE_DISTROS = ['noble', 'jammy', 'focal'];
const PULL_TIMEOUT_MS = Number(process.env.IMAGE_PULL_TIMEOUT_MS) || 15 * 60_000;
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS) || 20 * 60_000;
const SEMVER = /^\d+\.\d+\.\d+$/;
const CLONE_TIMEOUT_MS = 2 * 60_000;
const MAX_LOG_CHARS = 64_000;
const MAX_RESULTS = 500;
const MAX_ERROR_CHARS = 2_000;

/** Names the tests may not override (runner plumbing). */
const RESERVED_VARS = new Set(['BASE_URL', 'CI', 'REPO_DIR', 'HOME', 'PATH', 'PLAYWRIGHT_BROWSERS_PATH', 'PLAYWRIGHT_JSON_OUTPUT_NAME']);
const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SCRIPT_FILE_NAME = /^[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)*\.spec\.ts$/;
const BRANCH_NAME = /^[A-Za-z0-9._/-]+$/;

/**
 * Keeps the first ~1/8 of `max` characters (runner setup: clone, image, install) and the last
 * ~7/8 (where the failures and summary are), dropping the middle.
 */
class LogBuffer {
  private head = '';
  private chunks: string[] = [];
  private size = 0;
  private dropped = false;
  private readonly headMax: number;
  private readonly tailMax: number;
  constructor(max: number) {
    this.headMax = Math.floor(max / 8);
    this.tailMax = max - this.headMax;
  }
  write(text: string) {
    if (this.head.length < this.headMax) {
      const room = this.headMax - this.head.length;
      this.head += text.slice(0, room);
      text = text.slice(room);
      if (!text) return;
    }
    this.chunks.push(text);
    this.size += text.length;
    while (this.size > this.tailMax * 2 && this.chunks.length > 1) {
      this.size -= this.chunks.shift()!.length;
      this.dropped = true;
    }
  }
  line(text: string) {
    this.write(`${text}\n`);
  }
  toString() {
    const tail = this.chunks.join('');
    if (tail.length <= this.tailMax && !this.dropped) return this.head + tail;
    return `${this.head}\n[... output truncated ...]\n${tail.slice(-this.tailMax)}`;
  }
}

interface ProcResult {
  code: number | null;
  timedOut: boolean;
}

/** Runs a host command (no shell), streaming output into the log. */
function run(cmd: string, args: string[], log: LogBuffer, opts: { timeoutMs: number; cwd?: string; env?: NodeJS.ProcessEnv; onTimeout?: () => void }): Promise<ProcResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, windowsHide: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      opts.onTimeout?.();
      child.kill();
    }, opts.timeoutMs);
    child.stdout.on('data', (d: Buffer) => log.write(d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => log.write(d.toString('utf8')));
    child.on('error', (err) => {
      clearTimeout(timer);
      log.line(`[runner] Failed to start ${cmd}: ${err.message}`);
      resolve({ code: null, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut });
    });
  });
}

/** Quiet host command, used for docker housekeeping. */
async function quiet(cmd: string, args: string[], timeoutMs = 60_000): Promise<ProcResult & { output: string }> {
  const log = new LogBuffer(8_000);
  const result = await run(cmd, args, log, { timeoutMs });
  return { ...result, output: log.toString() };
}

/** Inside the container "localhost" is the container itself: point it at the Docker host. */
export function containerBaseUrl(baseUrl: string | null): string | null {
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    if (['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname)) url.hostname = 'host.docker.internal';
    return url.toString().replace(/\/$/, '');
  } catch {
    return baseUrl;
  }
}

/** Directory (relative to the repo root, '' = root) holding the Playwright config, or null. */
async function findPlaywrightConfigDir(repoDir: string): Promise<string | null> {
  const isConfig = (name: string) => /^playwright\.config\.(ts|js|mjs|cjs|mts|cts)$/.test(name);
  const queue: Array<{ rel: string; depth: number }> = [{ rel: '', depth: 0 }];
  while (queue.length) {
    const { rel, depth } = queue.shift()!; // breadth-first: the shallowest config wins
    const entries = await fs.readdir(path.join(repoDir, rel), { withFileTypes: true }).catch(() => []);
    if (entries.some((e) => e.isFile() && isConfig(e.name))) return rel;
    if (depth >= 3) continue;
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
        queue.push({ rel: rel ? `${rel}/${e.name}` : e.name, depth: depth + 1 });
      }
    }
  }
  return null;
}

const readText = (file: string) => fs.readFile(file, 'utf8').catch(() => null);

/**
 * Exact @playwright/test version the repository installs, from its lockfile (npm, pnpm, yarn) or
 * an exact pin in package.json. Looks in the config directory first, then the repository root
 * (monorepo workspaces lock at the root). null = unknown (e.g. only a "^1.45.0" range).
 */
export async function detectPlaywrightVersion(repoDir: string, configDir: string): Promise<string | null> {
  const dirs = configDir ? [path.join(repoDir, configDir), repoDir] : [repoDir];
  for (const dir of dirs) {
    const npmLock = await readText(path.join(dir, 'package-lock.json'));
    if (npmLock) {
      try {
        const lock = JSON.parse(npmLock) as {
          packages?: Record<string, { version?: string }>;
          dependencies?: Record<string, { version?: string }>;
        };
        const version = lock.packages?.['node_modules/@playwright/test']?.version ?? lock.dependencies?.['@playwright/test']?.version;
        if (version && SEMVER.test(version)) return version;
      } catch {
        /* malformed lockfile: try the next source */
      }
    }

    const pnpmLock = await readText(path.join(dir, 'pnpm-lock.yaml'));
    const pnpm = pnpmLock?.match(/['/]?@playwright\/test@(\d+\.\d+\.\d+)/);
    if (pnpm) return pnpm[1];

    const yarnLock = await readText(path.join(dir, 'yarn.lock'));
    const yarn = yarnLock?.match(/"?@playwright\/test@[^\n]*:\n\s+version:?\s+"?(\d+\.\d+\.\d+)/);
    if (yarn) return yarn[1];

    const pkg = await readText(path.join(dir, 'package.json'));
    if (pkg) {
      try {
        const json = JSON.parse(pkg) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        const spec = (json.devDependencies?.['@playwright/test'] ?? json.dependencies?.['@playwright/test'])?.replace(/^=/, '');
        if (spec && SEMVER.test(spec)) return spec;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

/** Local image present? */
async function hasImage(image: string): Promise<boolean> {
  return (await quiet('docker', ['image', 'inspect', '--format', '{{.Id}}', image], 30_000)).code === 0;
}

/**
 * Official Playwright image for `version` (local first, else pulled), so the repository's tests
 * use browsers that already match and nothing is downloaded at run time. Falls back to the
 * default image (whose browsers then get installed by the run script).
 */
async function resolveImage(version: string | null, log: LogBuffer): Promise<{ image: string; version: string }> {
  const fallback = { image: IMAGE, version: PLAYWRIGHT_VERSION };
  if (!version) {
    log.line(`[runner] Repository Playwright version unknown (no lockfile or exact pin); using ${IMAGE}`);
    return fallback;
  }
  if (version === PLAYWRIGHT_VERSION) return fallback;

  const candidates = IMAGE_DISTROS.map((distro) => `${IMAGE_REPOSITORY}:v${version}-${distro}`);
  for (const image of candidates) {
    if (await hasImage(image)) {
      log.line(`[runner] Repository uses Playwright ${version}; using cached image ${image}`);
      return { image, version };
    }
  }
  for (const image of candidates) {
    log.line(`[runner] Repository uses Playwright ${version}; pulling ${image} (first run for this version only)`);
    const pull = await quiet('docker', ['pull', '--quiet', image], PULL_TIMEOUT_MS);
    if (pull.code === 0) return { image, version };
  }
  log.line(`[runner] No official image for Playwright ${version}; using ${IMAGE} (browsers will be downloaded, slower)`);
  return fallback;
}

const GENERATED_CONFIG = `import { defineConfig, devices } from '@playwright/test';

// Written by the PROOFLOOP worker for generated scripts.
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 2,
  reporter: [['list'], ['json', { outputFile: '/work/out/generated.json' }]],
  use: {
    baseURL: process.env.BASE_URL || undefined,
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
`;

/**
 * Container entrypoint. Paths arrive as env vars (never interpolated into the script).
 * Exit code: 0 only if every suite that ran exited 0.
 */
const RUN_SH = `#!/usr/bin/env bash
set -u
mkdir -p /work/out
status=0
install_deps() {
  if [ -f package-lock.json ]; then npm ci --no-audit --no-fund || npm install --no-audit --no-fund
  elif [ -f package.json ]; then npm install --no-audit --no-fund
  fi
}
if [ -n "\${REPO_DIR:-}" ]; then
  echo "=== Repository tests ($REPO_DIR) ==="
  if [ "$REPO_DIR" != "/work/repo" ] && [ -f /work/repo/package.json ]; then
    (cd /work/repo && install_deps) || echo "[runner] repository root install failed"
  fi
  cd "$REPO_DIR" || exit 1
  if ! install_deps; then echo "[runner] npm install failed"; status=1
  else
    # No-op when the image already has this Playwright version's browsers.
    npx --no-install playwright install || true
    PLAYWRIGHT_JSON_OUTPUT_NAME=/work/out/repo.json npx --no-install playwright test --reporter=list,json || status=1
  fi
fi
if [ -d /work/generated ]; then
  echo "=== Generated scripts ==="
  cd /work/generated || exit 1
  if ! npm install --no-audit --no-fund; then echo "[runner] npm install failed"; status=1
  else
    npx --no-install playwright test || status=1
  fi
fi
exit $status
`;

interface JsonReport {
  suites?: JsonSuite[];
  errors?: Array<{ message?: string }>;
}
interface JsonSuite {
  title: string;
  file?: string;
  specs?: Array<{
    title: string;
    file?: string;
    tests?: Array<{
      projectName?: string;
      status?: 'expected' | 'unexpected' | 'flaky' | 'skipped';
      results?: Array<{ duration?: number; error?: { message?: string }; errors?: Array<{ message?: string }> }>;
    }>;
  }>;
  suites?: JsonSuite[];
}

const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

function collectResults(report: JsonReport, prefix: string, out: TestResult[]) {
  const walk = (suite: JsonSuite, titles: string[]) => {
    const here = suite.file && suite.title === suite.file ? titles : [...titles, suite.title].filter(Boolean);
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        const last = results[results.length - 1];
        const status: TestResult['status'] =
          test.status === 'expected' ? 'passed' : test.status === 'unexpected' ? 'failed' : test.status === 'flaky' ? 'flaky' : 'skipped';
        const message = last?.error?.message ?? last?.errors?.[0]?.message;
        out.push({
          title: [...here, spec.title].join(' › '),
          file: `${prefix}${spec.file ?? suite.file ?? ''}`,
          project: test.projectName ?? '',
          status,
          durationMs: results.reduce((sum, r) => sum + (r.duration ?? 0), 0),
          ...(message && status === 'failed' ? { error: stripAnsi(message).slice(0, MAX_ERROR_CHARS) } : {}),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
}

async function readReport(file: string): Promise<JsonReport | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as JsonReport;
  } catch {
    return null;
  }
}

/** Replaces secret values in the log so they are not stored in the DB. */
function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 4) out = out.split(secret).join('***');
  }
  return out;
}

export async function runInSandbox(input: SandboxInput): Promise<SandboxResult> {
  const log = new LogBuffer(MAX_LOG_CHARS);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'proofloop-run-'));
  const ws = path.join(root, 'ws'); // copied into the container
  const envFile = path.join(root, 'run.env'); // read by the docker CLI only, never copied
  const container = `proofloop-run-${input.executionId}`;
  const secrets = input.variables.filter((v) => v.isSecret).map((v) => v.value);

  const fail = (message: string): SandboxResult => {
    log.line(`[runner] ${message}`);
    return { status: 'FAILED', passedCount: 0, failedCount: 0, skippedCount: 0, results: [], logs: redact(log.toString(), secrets) };
  };

  try {
    await fs.mkdir(ws, { recursive: true });

    const docker = await quiet('docker', ['version', '--format', '{{.Server.Version}}'], 30_000);
    if (docker.code !== 0) return fail('Docker is not available on the worker host. Start Docker and retry.');

    // ---- Repository (cloned on the host with hooks and non-http(s) transports disabled) ----
    let repoDir: string | null = null;
    let runtime = { image: IMAGE, version: PLAYWRIGHT_VERSION };
    if (input.repository) {
      const branch = input.branch?.trim() || null;
      if (branch && (!BRANCH_NAME.test(branch) || branch.startsWith('-') || branch.includes('..'))) {
        return fail(`Invalid branch name: ${branch}`);
      }
      log.line(`[runner] Cloning ${input.repository}${branch ? ` (${branch})` : ''}`);
      const cloneArgs = [
        '-c', `core.hooksPath=${os.platform() === 'win32' ? 'NUL' : '/dev/null'}`,
        '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.http.allow=always',
        'clone', '--depth', '1', '--single-branch', '--no-recurse-submodules',
        ...(branch ? ['--branch', branch] : []),
        '--', input.repository, path.join(ws, 'repo'),
      ];
      const clone = await run('git', cloneArgs, log, {
        timeoutMs: CLONE_TIMEOUT_MS,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '' },
      });
      if (clone.code !== 0) return fail(clone.timedOut ? 'git clone timed out' : 'git clone failed (private repositories are not supported yet)');

      const configDir = await findPlaywrightConfigDir(path.join(ws, 'repo'));
      if (configDir === null) {
        log.line('[runner] No playwright.config.* found in the repository (searched 3 levels deep); repository tests skipped');
      } else {
        repoDir = configDir ? `/work/repo/${configDir}` : '/work/repo';
        // Match the image to the repository's Playwright so its browsers are already installed.
        runtime = await resolveImage(await detectPlaywrightVersion(path.join(ws, 'repo'), configDir), log);
      }
    }

    // ---- Approved generated scripts ----
    const scripts = input.scripts.filter((s) => SCRIPT_FILE_NAME.test(s.fileName));
    if (scripts.length !== input.scripts.length) log.line('[runner] Skipped scripts with invalid file names');
    if (scripts.length > 0) {
      const testsDir = path.join(ws, 'generated', 'tests');
      await fs.mkdir(testsDir, { recursive: true });
      for (const s of scripts) await fs.writeFile(path.join(testsDir, s.fileName), s.code, 'utf8');
      await fs.writeFile(path.join(ws, 'generated', 'playwright.config.ts'), GENERATED_CONFIG, 'utf8');
      await fs.writeFile(
        path.join(ws, 'generated', 'package.json'),
        // Same version as the image's browsers (the repository's, when it runs too).
        JSON.stringify({ private: true, devDependencies: { '@playwright/test': runtime.version } }, null, 2),
        'utf8',
      );
      log.line(`[runner] ${scripts.length} approved generated script(s)`);
    }

    if (!repoDir && scripts.length === 0) return fail('Nothing to run: no Playwright tests in the repository and no approved scripts.');

    await fs.writeFile(path.join(ws, 'run.sh'), RUN_SH, 'utf8');

    // ---- Environment for the tests (env file: values never appear in the process list) ----
    const baseUrl = containerBaseUrl(input.baseUrl);
    const envLines = ['CI=1'];
    if (baseUrl) envLines.push(`BASE_URL=${baseUrl}`);
    if (repoDir) envLines.push(`REPO_DIR=${repoDir}`);
    for (const v of input.variables) {
      if (!VAR_NAME.test(v.key) || RESERVED_VARS.has(v.key.toUpperCase()) || /[\r\n]/.test(v.value)) {
        log.line(`[runner] Environment variable ${v.key} skipped (reserved, invalid name, or multi-line value)`);
        continue;
      }
      envLines.push(`${v.key}=${v.value}`);
    }
    await fs.writeFile(envFile, `${envLines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
    if (baseUrl) log.line(`[runner] BASE_URL=${baseUrl}`);

    // ---- Container: create, copy workspace in, run, copy reports out ----
    await quiet('docker', ['rm', '-f', container]); // leftover from a crashed attempt of the same job
    const create = await quiet('docker', [
      'create', '--name', container, '--init',
      '--memory', process.env.SANDBOX_MEMORY || '4g', '--cpus', process.env.SANDBOX_CPUS || '2',
      '--pids-limit', '2048', '--shm-size', '1g',
      '--cap-drop=NET_RAW',
      '--security-opt', 'no-new-privileges',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=512m',
      '--add-host', 'host.docker.internal:host-gateway',
      '--env-file', envFile,
      '-w', '/work',
      runtime.image, 'bash', '/work/run.sh',
    ], 120_000);
    if (create.code !== 0) return fail(`docker create failed: ${create.output.trim()}`);

    const copyIn = await quiet('docker', ['cp', `${ws}${path.sep}.`, `${container}:/work`], 300_000);
    if (copyIn.code !== 0) return fail(`docker cp failed: ${copyIn.output.trim()}`);

    log.line(`[runner] Starting sandbox ${runtime.image}`);
    const started = Date.now();
    const exec = await run('docker', ['start', '-a', container], log, {
      timeoutMs: RUN_TIMEOUT_MS,
      onTimeout: () => void quiet('docker', ['kill', container]),
    });
    log.line(`[runner] Sandbox exited with code ${exec.code ?? 'n/a'} after ${Math.round((Date.now() - started) / 1000)}s`);

    const outDir = path.join(root, 'out');
    await quiet('docker', ['cp', `${container}:/work/out`, outDir], 120_000);

    // ---- Results ----
    const results: TestResult[] = [];
    let reportsOk = true;
    const reportErrors: string[] = [];
    for (const [name, prefix, expected] of [
      ['repo.json', 'repo/', !!repoDir],
      ['generated.json', 'generated/', scripts.length > 0],
    ] as const) {
      if (!expected) continue;
      const report = await readReport(path.join(outDir, name));
      if (!report) {
        reportsOk = false;
        log.line(`[runner] No Playwright report for ${prefix.slice(0, -1)} tests (install or config error, see log above)`);
        continue;
      }
      for (const e of report.errors ?? []) if (e.message) reportErrors.push(stripAnsi(e.message).slice(0, MAX_ERROR_CHARS));
      collectResults(report, prefix, results);
    }

    const passedCount = results.filter((r) => r.status === 'passed' || r.status === 'flaky').length;
    const failedCount = results.filter((r) => r.status === 'failed').length;
    const skippedCount = results.filter((r) => r.status === 'skipped').length;
    for (const e of reportErrors) log.line(`[playwright] ${e}`);

    let status: SandboxResult['status'] = 'PASSED';
    if (exec.timedOut) {
      log.line(`[runner] Run timed out after ${Math.round(RUN_TIMEOUT_MS / 60_000)} min and was killed`);
      status = 'FAILED';
    } else if (exec.code !== 0 || !reportsOk || failedCount > 0 || reportErrors.length > 0) {
      status = 'FAILED';
    } else if (passedCount === 0) {
      log.line('[runner] No test passed (all skipped or none found); run marked FAILED');
      status = 'FAILED';
    }

    return {
      status,
      passedCount,
      failedCount,
      skippedCount,
      results: results.slice(0, MAX_RESULTS).map((r) => (r.error ? { ...r, error: redact(r.error, secrets) } : r)),
      logs: redact(log.toString(), secrets),
    };
  } catch (error) {
    return fail(`Runner error: ${(error as Error).message}`);
  } finally {
    await quiet('docker', ['rm', '-f', container]).catch(() => undefined);
    if (existsSync(root)) await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}
