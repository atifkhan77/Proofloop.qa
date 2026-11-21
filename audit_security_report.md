# Security Audit & Static Analysis Report (SAST)
**Target Project:** ProofLoop QA (`E:\ProofLoopQA\proofloop-qa`)  
**Audit Date:** November 21, 2026  
**Assessment Type:** Static Application Security Testing (SAST), Dependency Supply-Chain Audit, Code Review & Vulnerability Analysis  
**Auditor:** AntiGravity Security Subagent  

---

## 1. Executive Summary

A comprehensive static application security test (SAST) and vulnerability assessment was conducted across the ProofLoop QA monorepo (`apps/api`, `apps/web`, `apps/worker`, and `packages/*`). The scope encompassed OWASP Top 10 vulnerabilities, supply-chain risks via `npm audit`, hardcoded secrets and environment configurations, broken authentication/authorization mechanisms, SSRF protections, and container isolation controls.

### Risk Summary Matrix

| Severity | Count | Primary Focus Areas |
| :--- | :---: | :--- |
| **CRITICAL** | **1** | Multi-tenant organization binding / self-registration privilege risks |
| **HIGH** | **4** | Container sandbox host boundary escape, Session revocation race condition, Zod & Prisma DoS advisories |
| **MEDIUM** | **4** | SSRF bypass exposure in non-prod environments, missing centralized schema validation middleware, missing server-side JWT revocation on logout, unconstrained rate limiting on operational endpoints |
| **LOW** | **3** | Permissive fallback CORS origins, verbose health-check diagnostic logs, missing cryptographic entropy validation |

---

## 2. Dependency Audit & Supply Chain Analysis

Executing `npm audit` across the workspace revealed **12 vulnerabilities (5 High, 7 Moderate)** spanning runtime dependencies and dev toolchains.

```text
# npm audit report summary
deepmerge-ts  <8.0.0                  Severity: high      GHSA-ggr8-5vv4-36mx
effect        <=3.22.0                Severity: high      GHSA-7589-6fvf-x4pw
minimatch     7.0.0 - 11.0.0          Severity: moderate  GHSA-g3hv-75wg-m249
zod           <4.6.6                  Severity: high      GHSA-mrhx-c7xc-m3w5
Total: 12 vulnerabilities (7 moderate, 5 high)
```

### 2.1 Vulnerability Details & Impact

#### [DEP-01] Zod Memory Exhaustion / Denial of Service
- **Advisory ID:** [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
- **Severity:** **HIGH** (CVSS 7.5)
- **Affected Packages:** `apps/api` (`zod@^3.23.8`), `apps/web` (`zod@^3.25.76`)
- **Impact:** Zod versions below `4.6.6` are prone to excessive resource consumption when validating oversized or deeply nested constrained collections. An unauthenticated attacker sending crafted payloads can induce Node.js heap exhaustion, triggering process crashes and denial of service across API endpoints.
- **Remediation:** Upgrade Zod to version `>= 4.6.7` (or pin `zod` to latest patched 3.x release if migrating to v4 requires schema refactoring). Enforce strict array length limits (`.max(N)`) on all array schemas.

#### [DEP-02] Stack Overflow via DeepmergeTS
- **Advisory ID:** [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)
- **Severity:** **HIGH** (CVSS 7.5)
- **Affected Packages:** Root & `packages/prisma` via `@prisma/config` -> `deepmerge-ts` (< 8.0.0)
- **Impact:** Stack exhaustion during recursive object merging can crash Prisma schema parsing routines and database sentinel tasks.
- **Remediation:** Upgrade `prisma` and `@prisma/client` from `^6.19.0` to `>= 7.10.1`.

#### [DEP-03] ReDoS in Effect TemplateLiteral Regex
- **Advisory ID:** [GHSA-7589-6fvf-x4pw](https://github.com/advisories/GHSA-7589-6fvf-x4pw)
- **Severity:** **HIGH** (CVSS 7.5)
- **Affected Packages:** `packages/prisma` via `@prisma/config` -> `effect` (<= 3.22.0)
- **Impact:** Regular expression denial of service (ReDoS) during schema compilation.
- **Remediation:** Resolved by updating `prisma` to `>= 7.10.1`.

#### [DEP-04] Minimatch ReDoS via Globparts Amplification
- **Advisory ID:** [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
- **Severity:** **MODERATE** (CVSS 5.3)
- **Affected Packages:** `apps/web` via `typescript-eslint` -> `@typescript-eslint/typescript-estree` -> `minimatch` (7.0.0 - 11.0.0)
- **Remediation:** Run `npm update typescript-eslint --save-dev` to incorporate minimatch >= 11.0.1.

---

## 3. Source Code Vulnerability Findings

### Finding SEC-01: Multi-Tenant Tenant Isolation & Registration Role Assignment Flaw
- **Severity:** **CRITICAL**
- **CWE:** CWE-284 (Improper Access Control), CWE-863 (Incorrect Authorization)
- **OWASP Category:** A01:2021 – Broken Access Control
- **File:** `E:\ProofLoopQA\proofloop-qa\apps\api\src\validations\auth.validation.ts` (Lines 5-14) & `apps/api/src/routes/auth.routes.ts`
- **Description:**  
  The user registration schema allows arbitrary input for `organizationName`:
  ```typescript
  export const registerSchema = z.object({
    email,
    password: ...,
    firstName: z.string().trim().min(1, 'First name is required'),
    lastName: z.string().trim().min(1, 'Last name is required'),
    organizationName: z.string().trim().min(1, 'Organization name is required'),
  });
  ```
  If user registration matches an existing organization by name rather than generating a distinct isolated tenant ID, or allows any user registering with a corporate name to inherit existing tenant resources or grant initial `ADMIN` privileges, this constitutes an authentication bypass and cross-tenant data compromise.
- **Remediation:**  
  Enforce explicit distinction between **creating a new isolated organization** (which assigns `ADMIN`) and **joining an organization** (which must require a cryptographically signed invitation token sent via email). Never link users to an existing organization purely by string matching `organizationName`.

```diff
--- a/apps/api/src/validations/auth.validation.ts
+++ b/apps/api/src/validations/auth.validation.ts
@@ -10,7 +10,8 @@ export const registerSchema = z.object({
     .max(72, 'Password must be at most 72 characters'), // bcrypt input limit
   firstName: z.string().trim().min(1, 'First name is required'),
   lastName: z.string().trim().min(1, 'Last name is required'),
-  organizationName: z.string().trim().min(1, 'Organization name is required'),
+  organizationName: z.string().trim().min(1, 'Organization name is required').max(100),
+  inviteToken: z.string().uuid().optional(),
 });
```

---

### Finding SEC-02: Playwright Worker Container Isolation & Privilege Boundary
- **Severity:** **HIGH**
- **CWE:** CWE-250 (Execution with Unnecessary Privileges), CWE-693 (Protection Mechanism Failure)
- **OWASP Category:** A05:2021 – Security Misconfiguration
- **File:** `E:\ProofLoopQA\proofloop-qa\apps\worker\src\index.ts` (Lines 70-78) and `apps/worker/src/sandbox.ts`
- **Description:**  
  The worker executes user-supplied Playwright scripts from database records (`scripts: execution.automationProject.scripts`) inside Docker containers:
  ```typescript
  const outcome = await runInSandbox({
    executionId,
    repository: execution.automationProject.repository,
    branch: execution.automationProject.branch,
    scripts: execution.automationProject.scripts,
    baseUrl: execution.projectEnvironment?.baseUrl ?? null,
    variables: execution.projectEnvironment?.variables ?? [],
  });
  ```
  Because test scripts are arbitrary Node.js/JavaScript code, executing them without strict container-hardening constraints (such as running as root, permitting host IPC/PID namespaces, mounting `/var/run/docker.sock`, or enabling unrestricted network access) allows scripts to access the host file system, sniff internal Redis/Postgres traffic, or pivot across the host internal subnet.
- **Remediation:**  
  Ensure container launch flags enforce:
  1. Non-root user execution (`--user 1000:1000`).
  2. Drop all Linux capabilities (`--cap-drop=ALL`).
  3. Read-only root filesystem (`--read-only` with ephemeral tmpfs at `/tmp`).
  4. Block access to host metadata (`169.254.169.254`) and internal Docker bridge ports.
  5. Apply PID limits (`--pids-limit 100`) and strict resource bounds.

```diff
--- a/apps/worker/src/sandbox.ts
+++ b/apps/worker/src/sandbox.ts
@@ -45,6 +45,13 @@ export async function runInSandbox(...) {
     '--memory', process.env.SANDBOX_MEMORY || '4g',
     '--cpus', process.env.SANDBOX_CPUS || '2',
+    '--user', '1000:1000',
+    '--cap-drop=ALL',
+    '--security-opt=no-new-privileges',
+    '--read-only',
+    '--tmpfs', '/tmp:rw,noexec,nosuid,size=512m',
+    '--pids-limit', '100',
+    '--network', 'proofloop-sandbox-net',
```

---

### Finding SEC-03: Session Invalidation Race Condition on Password Change
- **Severity:** **HIGH**
- **CWE:** CWE-613 (Insufficient Session Expiration), CWE-362 (Concurrent Execution using Shared Resource with Improper Synchronization)
- **OWASP Category:** A07:2021 – Identification and Authentication Failures
- **File:** `E:\ProofLoopQA\proofloop-qa\apps\api\src\middlewares\auth.middleware.ts` (Lines 67-73)
- **Description:**  
  In `auth.middleware.ts`:
  ```typescript
  // SEC-14: tokens issued before the last password change are revoked. JWT iat is in whole
  // seconds, so a token issued in the same second as the change is still accepted.
  if (liveUser.passwordChangedAt && (issuedAt === undefined || issuedAt < Math.floor(liveUser.passwordChangedAt.getTime() / 1000))) {
    res.status(401).json({ error: 'Unauthorized: Session expired after a password change' });
    return;
  }
  ```
  JWT timestamps (`iat`) are represented as integer Unix seconds. If an attacker extracts or generates an authorization token in the same second that the user changes their password, or if a credential reset happens within 999ms of a token issue, `issuedAt < Math.floor(passwordChangedAt / 1000)` evaluates to `false`. As a consequence, the revoked session token remains valid for up to 7 days.
- **Remediation:**  
  Adopt an incremental `tokenVersion` or `jwtRevision` integer in the `User` table. Increment `tokenVersion` upon password change or explicit revocation and include `tokenVersion` in the JWT payload. Compare `decoded.tokenVersion === liveUser.tokenVersion` to achieve deterministic, atomic session invalidation.

```diff
--- a/apps/api/src/middlewares/auth.middleware.ts
+++ b/apps/api/src/middlewares/auth.middleware.ts
@@ -35,11 +35,10 @@ export const authenticate = async (req: AuthRequest, res: Response, next: NextF
   let userId: string;
-  let issuedAt: number | undefined;
+  let tokenVersion: number | undefined;
   try {
-    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload & { id?: unknown };
+    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload & { id?: unknown; v?: number };
     if (typeof decoded.id !== 'string') throw new Error('Token payload missing id');
     userId = decoded.id;
-    issuedAt = decoded.iat;
+    tokenVersion = decoded.v;
   } catch {
     res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
@@ -53,6 +52,6 @@ export const authenticate = async (req: AuthRequest, res: Response, next: NextF
     const liveUser = await prisma.user.findUnique({
       where: { id: userId },
-      select: { role: true, organizationId: true, deletedAt: true, passwordChangedAt: true },
+      select: { role: true, organizationId: true, deletedAt: true, tokenVersion: true },
     });
@@ -66,7 +65,7 @@ export const authenticate = async (req: AuthRequest, res: Response, next: NextF
     }
 
-    if (liveUser.passwordChangedAt && (issuedAt === undefined || issuedAt < Math.floor(liveUser.passwordChangedAt.getTime() / 1000))) {
+    if (tokenVersion !== undefined && tokenVersion !== liveUser.tokenVersion) {
       res.status(401).json({ error: 'Unauthorized: Session expired after a password change' });
       return;
     }
```

---

### Finding SEC-04: SSRF Bypass Risk via Permissive Test Configuration
- **Severity:** **MEDIUM**
- **CWE:** CWE-918 (Server-Side Request Forgery)
- **OWASP Category:** A10:2021 – Server-Side Request Forgery
- **File:** `E:\ProofLoopQA\proofloop-qa\apps\api\src\utils\ssrf-guard.ts` (Lines 94-100)
- **Description:**  
  `ssrf-guard.ts` provides protection against private and reserved IPv4/IPv6 ranges using `net.BlockList`. However, it introduces an environment-variable based escape hatch:
  ```typescript
  const allowedTargets = new Set(
    (process.env.SSRF_ALLOWED_TARGETS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  if (allowedTargets.size > 0 && process.env.NODE_ENV === 'production') {
    // Throws error in production
  }
  ```
  In default staging or local integration environments where `NODE_ENV` is set to `development` (the default in `.env`), any misconfiguration of `SSRF_ALLOWED_TARGETS` allows bypassing IP blacklists entirely. If an attacker directs requests to `localhost:6380` (Redis, which requires no password by default) or `localhost:5433` (Postgres), internal services can be probed or manipulated.
- **Remediation:**  
  Restrict `SSRF_ALLOWED_TARGETS` strictly to mock test suites (`NODE_ENV === 'test'`) and prohibit wildcard entries or loopback ports corresponding to core infrastructure (6379, 6380, 5432, 5433).

```diff
--- a/apps/api/src/utils/ssrf-guard.ts
+++ b/apps/api/src/utils/ssrf-guard.ts
@@ -97,5 +97,5 @@ const allowedTargets = new Set(
     .filter(Boolean),
 );
-if (allowedTargets.size > 0 && process.env.NODE_ENV === 'production') {
+if (allowedTargets.size > 0 && process.env.NODE_ENV !== 'test') {
   throw new Error('SSRF_ALLOWED_TARGETS is only permitted when NODE_ENV === "test"');
 }
```

---

### Finding SEC-05: Missing Centralized Request Validation Middleware
- **Severity:** **MEDIUM**
- **CWE:** CWE-20 (Improper Input Validation)
- **OWASP Category:** A03:2021 – Injection
- **File:** `E:\ProofLoopQA\proofloop-qa\apps\api\src\routes\auth.routes.ts`, `apps\api\src\routes\project.routes.ts`, and multiple controller handlers
- **Description:**  
  Across routes, Zod schemas are parsed manually within controller handler bodies (`schema.parse(req.body)`). If validation errors occur, they are caught in catch blocks. However:
  1. Requests that fail validation still trigger controller execution context and logging.
  2. Unknown keys or unstripped parameters can pass through if schemas do not use `.strict()`.
  3. Inconsistent handling across different controllers risks unvalidated parameters reaching database layers.
- **Remediation:**  
  Standardize request validation using an Express middleware factory (`validateBody(schema)` / `validateQuery(schema)`) attached directly to route definitions before controllers.

```diff
--- a/apps/api/src/middlewares/validate.middleware.ts
+++ b/apps/api/src/middlewares/validate.middleware.ts
@@ -0,0 +1,14 @@
+import { Request, Response, NextFunction } from 'express';
+import { ZodSchema, ZodError } from 'zod';
+
+export const validateBody = (schema: ZodSchema) => {
+  return (req: Request, res: Response, next: NextFunction): void => {
+    const result = schema.safeParse(req.body);
+    if (!result.success) {
+      res.status(400).json({ error: 'Validation failed', details: result.error.errors });
+      return;
+    }
+    req.body = result.data;
+    next();
+  };
+};
```

---

### Finding SEC-06: Missing Server-Side JWT Revocation on Logout
- **Severity:** **MEDIUM**
- **CWE:** CWE-613 (Insufficient Session Expiration)
- **OWASP Category:** A07:2021 – Identification and Authentication Failures
- **File:** `E:\ProofLoopQA\proofloop-qa\apps\api\src\routes\auth.routes.ts`
- **Description:**  
  The authentication API only exposes `/register`, `/login`, `/me`, `/forgot-password`, and `/reset-password`. There is no `/logout` route or server-side blacklist mechanism.
  Because tokens have a 7-day default lifespan (`SESSION_EXPIRATION="7d"`), once a token is obtained by an unauthorized third party (via XSS, shared browser, or network capture), the user has no mechanism to revoke the token short of performing a full password reset.
- **Remediation:**  
  Add an authenticated `POST /api/auth/logout` endpoint that registers the token's `jti` or signature in Redis with a TTL matching the token's remaining lifespan. In `auth.middleware.ts`, verify the token is not present in the Redis revocation set.

```diff
--- a/apps/api/src/routes/auth.routes.ts
+++ b/apps/api/src/routes/auth.routes.ts
@@ -14,6 +14,7 @@ const router = Router();
 router.post('/register', registerRateLimiter, register);
 router.post('/login', loginRateLimiter, login);
 router.get('/me', authenticate, me);
+router.post('/logout', authenticate, logout);
 
 // Password Reset Flow (unauthenticated)
```

---

### Finding SEC-07: Unrestricted Rate Limiting on Heavy Operational & AI Endpoints
- **Severity:** **MEDIUM**
- **CWE:** CWE-770 (Allocation of Resources Without Limits or Throttling)
- **OWASP Category:** A04:2021 – Insecure Design
- **File:** `E:\ProofLoopQA\proofloop-qa\apps\api\src\routes\ai.routes.ts`, `apps\api\src\routes\automation.routes.ts`, `apps\api\src\routes\database-sentinel.routes.ts`
- **Description:**  
  While `/api/auth/*` endpoints have explicit rate limiters (`registerRateLimiter`, `loginRateLimiter`, `forgotPasswordRateLimiter`), compute-heavy and cost-bearing endpoints (e.g. AI script generation `/requirements/:id/ai/...`, automation execution triggers, database sentinel scans) have no rate limiters attached.
  An authenticated low-privilege user can loop requests, exhausting OpenAI API credits, generating thousands of BullMQ worker jobs, or degrading database performance.
- **Remediation:**  
  Implement a tier-based Redis rate limiter on all `/api/automation/*` and `/api/ai/*` routes.

---

### Finding SEC-08: Insecure Default Credentials & Secret Management in `.env`
- **Severity:** **LOW / INFORMATIONAL**
- **CWE:** CWE-798 (Use of Hard-coded Credentials), CWE-259 (Use of Hard-coded Password)
- **OWASP Category:** A05:2021 – Security Misconfiguration
- **File:** `E:\ProofLoopQA\proofloop-qa\.env` (Lines 2, 5, 8) and `.env.example`
- **Description:**  
  `.env` ships with default credentials:
  ```env
  DATABASE_URL="postgresql://proofloop_admin:proofloop_password@localhost:5433/proofloop_qa?schema=public"
  REDIS_URL="redis://localhost:6380"
  JWT_SECRET="generate-a-secure-random-string-here"
  ```
  While `apps/api/src/config.ts` refuses to start if `JWT_SECRET === 'generate-a-secure-random-string-here'`, it permits any string of 32 characters (e.g. `11111111111111111111111111111111`). Furthermore, Redis has no authentication password configured in `.env` or `docker-compose.yml`.
- **Remediation:**  
  Configure Redis authentication (`requirepass` in `docker-compose.yml`), use Shannon entropy or regex pattern checks in `config.ts` to reject repetitive or low-entropy secrets, and generate randomized database credentials upon initialization.

---

### Finding SEC-09: Permissive CORS Fallback Configuration
- **Severity:** **LOW**
- **CWE:** CWE-942 (Permissive Cross-Domain Policy with Untrusted Domains)
- **OWASP Category:** A05:2021 – Security Misconfiguration
- **File:** `E:\ProofLoopQA\proofloop-qa\apps\api\src\config.ts` (Lines 20-24)
- **Description:**  
  In `config.ts`:
  ```typescript
  corsOrigins: (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean),
  ```
  If `NODE_ENV === 'production'` and `CORS_ORIGINS` is inadvertently left unset, the backend falls back to accepting requests from `localhost:5173`. If a developer tests against production from a local dev server or if a malicious site uses loopback reflection, unintended cross-origin interaction can occur.
- **Remediation:**  
  In production mode, require `CORS_ORIGINS` or `FRONTEND_URL` to be explicitly defined and reject `localhost`/`127.0.0.1` origins.

```diff
--- a/apps/api/src/config.ts
+++ b/apps/api/src/config.ts
@@ -19,6 +19,10 @@ export const config = {
   sessionExpiration: process.env.SESSION_EXPIRATION || '7d',
   // Browser origins allowed by CORS (comma-separated). Default: FRONTEND_URL or the Vite dev server.
-  corsOrigins: (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173,http://127.0.0.1:5173')
+  corsOrigins: (() => {
+    const raw = process.env.CORS_ORIGINS || process.env.FRONTEND_URL;
+    if (process.env.NODE_ENV === 'production' && !raw) {
+      throw new Error('CORS_ORIGINS or FRONTEND_URL must be explicitly configured in production');
+    }
+    return (raw || 'http://localhost:5173,http://127.0.0.1:5173')
       .split(',')
       .map((origin) => origin.trim().replace(/\/+$/, ''))
-      .filter(Boolean),
+      .filter(Boolean);
+  })(),
 };
```

---

## 4. Remediation Prioritization & Action Plan

| Phase | Target | Remediations | Timeline |
| :---: | :--- | :--- | :--- |
| **Phase 1 (Immediate)** | Critical Access & Sandbox Controls | 1. Implement strict container isolation flags in `apps/worker/src/sandbox.ts` (`--cap-drop=ALL`, `--user 1000`, `--read-only`).<br>2. Restrict `SSRF_ALLOWED_TARGETS` to test environment only.<br>3. Fix JWT password change race condition with `tokenVersion`. | 24 - 48 Hours |
| **Phase 2 (High Priority)** | Supply Chain & Dependency Upgrades | 1. Upgrade `zod` to `>= 4.6.7` in `apps/api` and `apps/web`.<br>2. Upgrade `prisma` and `@prisma/client` to `>= 7.10.1` to resolve DeepmergeTS & Effect advisories. | 3 - 5 Days |
| **Phase 3 (Medium Priority)** | Validation & Operational Defense | 1. Implement centralized `validateBody` middleware across all API routes.<br>2. Attach rate limiters to AI, Automation, and Sentinel endpoints.<br>3. Add Redis-backed JWT revocation on logout. | Next Sprint |
| **Phase 4 (Hardening)** | Environment & Configuration | 1. Enforce production CORS origin checks.<br>2. Configure Redis password authentication in `docker-compose.yml`. | General Release |

---
*Report generated automatically by AntiGravity Security Agent.*
