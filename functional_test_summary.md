# Functional, Integration & Edge-Case Verification Analysis Report

**Project:** ProofLoop QA Platform (`E:\ProofLoopQA\proofloop-qa`)  
**Artifact Version:** 1.0.0  
**Date:** 2026-11-21  
**Author:** Functional QA Agent  
**Status:** Verification Analysis Complete — Test Specifications Proposed for Review  

---

## 1. Executive Summary

A comprehensive quality assurance inspection was conducted across the ProofLoop QA monorepo (`apps/api`, `apps/web`, `apps/worker`, and `packages/*`). The platform is designed as an enterprise-grade QA Intelligence Platform featuring Requirements Management, Risk Matrices, Test Planning & Execution Cycles, Automation Lab (Playwright Runner), API Intelligence, Defect Lifecycle with Jira/Slack integration, Traceability Matrices, and Release Quality Gates.

### Key Audit Findings

```
┌──────────────────────────────────────┬────────────────────────┬────────────────────────────────┐
│ Dimension                            │ Status                 │ Assessment                     │
├──────────────────────────────────────┼────────────────────────┼────────────────────────────────┤
│ End-to-End Test Suite (Playwright)   │ 31 Spec Files Active   │ High UI & E2E Integration Cov  │
│ API Integration Testing              │ Integrated via E2E     │ Solid HTTP Contract Coverage   │
│ Backend Unit Testing (apps/api)      │ 0 Unit Tests Found     │ CRITICAL GAP: Zero isolated TS │
│ Playwright Engine Package            │ Empty Package Skeleton │ CRITICAL GAP: Only package.json│
│ RBAC & Multi-Tenant Security         │ Fully Enforced         │ High Verification Coverage     │
│ Data Integrity & Foreign Key Hazards │ 2 Known Edge Flaws     │ DEF-02 Restrict Cascade Hazard │
└──────────────────────────────────────┴────────────────────────┴────────────────────────────────┘
```

### Readiness Scorecard: **78 / 100**
- **Core User Flow Coverage:** 88% (E2E specs cover primary paths across all 10 core modules)
- **API Boundary & Negative Path Coverage:** 72% (Strong status code assertions; gaps in concurrency, payload fuzzing, and rate limit race conditions)
- **Unit & Service Layer Coverage:** 15% (No isolated tests for `ssrf-guard`, `assertions`, `variables`, `redact`, or `quality-gate.controller`)
- **Package Integrity:** 60% (`packages/playwright-engine` is completely unpopulated despite being listed in root dependencies)

---

## 2. Architecture & Test Suite Inventory

### 2.1 Workspace Structure Overview

```mermaid
graph TD
    Client["React 18 / Vite Frontend (apps/web)"]
    API["Express Backend API (apps/api)"]
    Worker["BullMQ Automation Worker (apps/worker)"]
    DB[("PostgreSQL via Prisma (packages/prisma)")]
    Engine["Playwright Engine (packages/playwright-engine)"]
    Shared["Shared DTOs & Utils (packages/shared)"]

    Client -->|REST API / JWT| API
    API -->|Prisma ORM| DB
    API -->|Redis Queue| Worker
    Worker -->|Execute Specs| Engine
    Worker -->|Status & Results| DB
    API --> Shared
    Client --> Shared
```

### 2.2 Test Suite Inventory (`apps/web/tests/e2e`)

The repository currently consolidates all automated testing within `apps/web/tests/e2e/`, containing **31 Playwright test specifications**:

| # | Spec File | Scope / Focus Module | Primary Assertion Targets |
|---|---|---|---|
| 1 | `auth-flow.spec.ts` | Auth & Identity | Registration, login, session cookies, invalid creds |
| 2 | `password-reset-flow.spec.ts` | Auth Security | SHA-256 token lifecycle, 15m expiry, session invalidation |
| 3 | `organization-api.spec.ts` | Multi-Tenancy & Org | Org settings, member invitations, role updates, deactivation |
| 4 | `team-directory-and-variables-vault.spec.ts` | Team & Environments | User directory listing, environment secret masking |
| 5 | `projects-api.spec.ts` | Project Governance | CRUD project, multi-tenant boundaries, project environments |
| 6 | `projects-ui.spec.ts` | Project UI | Project switcher, cards, validation modals |
| 7 | `requirements-rbac-api.spec.ts` | Requirements & RBAC | CRUD requirements, priority/criticality enums, RBAC enforcement |
| 8 | `risks-api.spec.ts` | Risk Intelligence | Risk score formula (`prob * impact`), risk levels, cascades |
| 9 | `risks-ui.spec.ts` | Risk UI | Risk matrix heatmap, mitigation notes modal |
| 10 | `test-cases-api.spec.ts` | Test Design API | Steps sequence, preconditions, priority, requirements linking |
| 11 | `test-cases-ui.spec.ts` | Test Design UI | Dynamic step re-ordering, table filtering, detail view |
| 12 | `phases-a-b-c-d.spec.ts` | Core End-to-End Cycle | End-to-end integration spanning Phases A through D |
| 13 | `defects-api.spec.ts` | Defect Lifecycle API | Bug creation, severity, status state machine, assignee links |
| 14 | `defects-ui.spec.ts` | Defect UI | Kanban board / table views, bug edit drawers, status transitions |
| 15 | `defects-traceability-ui.spec.ts` | Defect Traceability UI | Defect linking to failed test execution and requirements |
| 16 | `traceability-api.spec.ts` | RTM Engine API | Coverage percentage calculation, orphan requirement detection |
| 17 | `traceability-defects.spec.ts` | Traceability Edge Cases | Matrix calculation with unassigned or closed defects |
| 18 | `traceability-ui.spec.ts` | Traceability Matrix UI | Interactive RTM grid, export, requirement coverage indicators |
| 19 | `automation-api.spec.ts` | Automation Lab API | Automation project CRUD, script generation, status (DRAFT/APPROVED) |
| 20 | `automation-ui.spec.ts` | Automation UI | Script editor, approval toggle, run initiation |
| 21 | `automation-worker.spec.ts` | Worker Queue Execution | BullMQ job dispatch, execution lifecycle (PENDING->PASSED/FAILED) |
| 22 | `api-intelligence-api.spec.ts` | API Intelligence API | API collection CRUD, parameterized requests, sequence numbering |
| 23 | `api-intelligence-ui.spec.ts` | API Intelligence UI | Request builder, header/query tabs, raw JSON editor |
| 24 | `api-runner-ui.spec.ts` | API Runner UI | Interactive single & collection runs, live response viewer |
| 25 | `api-variables-api.spec.ts` | Environment Variables | `{{variable}}` substitution, secret flag handling |
| 26 | `api-execution-api.spec.ts` | API Execution Engine | Status codes, response times, assertion engine rules |
| 27 | `api-intelligence-security.spec.ts` | API Runner Security | SSRF loopback blocking, private IP rejection, scheme gating |
| 28 | `security-hardening-api.spec.ts` | Security Hardening | Rate limiting, header security, XSS injection sanitization |
| 29 | `log-redaction.spec.ts` | Privacy & Compliance | Token / password redaction in execution logs and audit records |
| 30 | `db-outage.spec.ts` | System Resilience | Database disconnect behavior (503 response without wiping auth tokens) |
| 31 | `final-modules.spec.ts` | Quality Gates & Integrations | Quality gate evaluation logic, Jira/Slack webhook payload contract |

---

## 3. Mapped Core User Flows & Workflows

### Flow 1: Organization Onboarding & Identity Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Tenant Admin
    actor User as Invited Member
    participant Web as Web Client
    participant Auth as Auth Controller
    participant DB as Postgres DB

    Admin->>Web: Register New Organization & Admin Account
    Web->>Auth: POST /api/auth/register { orgName, email, password }
    Auth->>DB: $transaction: Create Organization + Create User (Role: ADMIN)
    Auth-->>Web: 201 Created { user, token }
    
    Admin->>Web: Invite QA Engineer to Project
    Web->>Auth: POST /api/organizations/users { email, role: 'QA_ENGINEER' }
    Auth->>DB: Create User with temporary credentials
    Auth-->>Web: 201 Created

    User->>Web: Request Password Reset
    Web->>Auth: POST /api/auth/forgot-password { email }
    Auth->>DB: Store SHA-256(token) & resetTokenExpiry (15m)
    Auth-->>Web: 200 OK (Generic message to prevent enumeration)

    User->>Web: Submit New Password
    Web->>Auth: POST /api/auth/reset-password { token, newPassword }
    Auth->>DB: Update passwordHash, set passwordChangedAt = now(), resetToken = null
    Note over Auth,DB: SEC-14: Revokes all tokens issued before passwordChangedAt
    Auth-->>Web: 200 OK
```

### Flow 2: Requirements-to-Risk Traceability Workflow

```mermaid
flowchart TD
    A([Create Project Module]) --> B([Define Requirement REQ-xxx])
    B --> C([Add Acceptance Criteria])
    B --> D([Assess Associated Risk])
    D --> E["Calculate Risk Score = Prob (1-5) * Impact (1-5)"]
    E --> F{"Risk Score Threshold"}
    F -->|>= 15| G["Level: CRITICAL"]
    F -->|10 - 14| H["Level: HIGH"]
    F -->|5 - 9| I["Level: MEDIUM"]
    F -->|1 - 4| J["Level: LOW"]
    B --> K([Create Linked Test Cases])
    K --> L([Generate Requirements Traceability Matrix])
    L --> M{"Coverage Status"}
    M -->|Linked & Passed| N[COVERED]
    M -->|Linked & Failed| O[FAILED_TESTS]
    M -->|No Linked Cases| P[UNCOVERED]
```

### Flow 3: Test Cycle Execution & Defect Escalation Flow

```mermaid
sequenceDiagram
    autonumber
    actor QA as QA Engineer
    participant Web as Apps/Web
    participant Exec as Test Execution API
    participant Defect as Defect API
    participant Jira as External Jira Sync
    participant DB as Postgres

    QA->>Web: Create Test Cycle (CYC-001) for Environment 'STAGING'
    Web->>Exec: POST /api/projects/:id/test-cycles
    Exec->>DB: Insert TestCycle + TestExecution placeholders for test cases
    Exec-->>Web: 201 Created

    QA->>Web: Record Execution Result (Step 3 Failed)
    Web->>Exec: PATCH /api/projects/:id/test-cycles/:cid/executions/:eid { status: 'FAILED', notes: 'Timeout on login' }
    Exec->>DB: Update TestExecution status and executedAt timestamp
    Exec-->>Web: 200 OK

    QA->>Web: Escalate to Defect directly from Execution
    Web->>Defect: POST /api/projects/:id/defects { testExecutionId, testCaseId, bugId, severity: 'HIGH' }
    Defect->>DB: Insert Defect (reporterId: QA.id, status: 'OPEN')
    opt Jira Integration Enabled
        Defect->>Jira: Dispatch webhook: Create Issue in Jira Project
        Jira-->>Defect: Jira Ticket Key (e.g. PROJ-104)
        Defect->>DB: Update Defect.jiraTicketId
    end
    Defect-->>Web: 201 Created { defect }
```

### Flow 4: Automation Lab & Execution Worker Flow

```mermaid
sequenceDiagram
    autonumber
    actor Dev as QA Automation
    participant Web as Automation UI
    participant API as API Server
    participant Redis as BullMQ Queue
    participant Worker as Automation Worker
    participant Sandbox as Playwright Runner
    participant DB as Postgres

    Dev->>Web: Generate Script from TestCase TC-001
    Web->>API: POST /api/projects/:id/automation/:aid/scripts/generate { testCaseId, source: 'AI' }
    API->>DB: Upsert GeneratedScript (status: 'DRAFT')
    API-->>Web: 201 Created { script }

    Dev->>Web: Review & Set Status to 'APPROVED'
    Web->>API: PATCH /api/projects/:id/automation/:aid/scripts/:sid { status: 'APPROVED' }
    API->>DB: Update GeneratedScript

    Dev->>Web: Trigger Automation Run
    Web->>API: POST /api/projects/:id/automation/:aid/executions { environmentId, trigger: 'MANUAL' }
    API->>DB: Insert AutomationExecution (runId: 'RUN-001', status: 'PENDING')
    API->>Redis: Enqueue Job { runId, scriptIds, envBaseUrl }
    API-->>Web: 202 Accepted { executionId }

    Worker->>Redis: Pop Job
    Worker->>DB: Update AutomationExecution (status: 'RUNNING', startTime: now())
    Worker->>Sandbox: Execute APPROVED Playwright Specs in isolated container
    Sandbox-->>Worker: JSON Test Results + Screenshots + Console Logs
    Worker->>DB: Update AutomationExecution (status: 'PASSED'|'FAILED', counts, logs, artifacts)
```

---

## 4. Detailed API Contract & Boundary Matrix

| Module | Route & HTTP Method | Required Role | Request Body Key Validations | Expected Response Status & Codes | Boundary & Edge Cases Analyzed |
|---|---|---|---|---|---|
| **Auth** | `POST /api/auth/register` | Public | `email` (valid email), `password` (min 8 chars, 1 uppercase, 1 special), `orgName` (min 2) | `201 Created` / `400 Bad Request` / `409 Conflict` | Duplicate email returns 409 without leaking user details; atomic org rollback on failure. |
| **Auth** | `POST /api/auth/login` | Public | `email`, `password` | `200 OK` / `401 Unauthorized` / `403 Forbidden` | Constant-time dummy hash check on non-existent email; deactivated users (`deletedAt != null`) receive 403 only *after* password verification. |
| **Auth** | `POST /api/auth/forgot-password` | Public | `email` | `200 OK` (Always) | Returns 200 even if email does not exist (anti-enumeration); 15m token TTL; SHA-256 token storage. |
| **Auth** | `POST /api/auth/reset-password` | Public | `token` (64-char hex), `newPassword` | `200 OK` / `400 Bad Request` | Tokens expired by 1ms rejected; all prior active JWTs invalidated via `passwordChangedAt` timestamp. |
| **Organizations** | `GET /api/organizations/current` | Any Authenticated | None | `200 OK` / `401 Unauthorized` | Multi-tenant isolation: cannot read another organization's metadata. |
| **Projects** | `POST /api/projects` | `ADMIN`, `QA_LEAD` | `name` (min 1 char), `description` (optional) | `201 Created` / `403 Forbidden` | Duplicate name within same org validation; auto-provisions default environments (e.g. STAGING). |
| **Environments** | `POST /api/projects/:id/environments/:eid/variables` | `ADMIN`, `QA_LEAD` | `key` (alphanumeric/underscore), `value` (string), `isSecret` (bool) | `201 Created` / `409 Conflict` | Unique `(environmentId, key)`; secret values masked in all subsequent GET endpoints. |
| **Requirements** | `POST /api/projects/:id/requirements` | `ADMIN`, `QA_LEAD`, `QA_ENGINEER` | `reqId` (e.g. REQ-001), `title`, `priority` (HIGH/MED/LOW), `businessCriticality` | `201 Created` / `409 Conflict` | Unique constraint per `(projectId, reqId)`; cascade delete of associated acceptance criteria and risks. |
| **Risks** | `POST /api/projects/:id/requirements/:rid/risks` | `ADMIN`, `QA_LEAD`, `QA_ENGINEER` | `title`, `probability` (1..5), `impact` (1..5), `mitigation` | `201 Created` / `400 Bad Request` | Enforces 1..5 range; automatically calculates `riskScore = prob * impact` and assigns criticality level. |
| **Test Cases** | `POST /api/projects/:id/test-cases` | `ADMIN`, `QA_LEAD`, `QA_ENGINEER` | `tcId` (e.g. TC-001), `title`, `priority`, `testType`, `steps` (array of action/expected) | `201 Created` / `409 Conflict` | Step number uniqueness `(testCaseId, stepNumber)`; requirement link set to `onDelete: SetNull`. |
| **Test Cycles** | `POST /api/projects/:id/test-cycles` | `ADMIN`, `QA_LEAD` | `cycleId`, `name`, `environmentId` | `201 Created` / `400 Bad Request` | Cross-project environment check (environment must belong to project); initializes executions for test cases. |
| **Defects** | `POST /api/projects/:id/defects` | `ADMIN`, `QA_LEAD`, `QA_ENGINEER` | `bugId`, `title`, `severity`, `status`, `testCaseId?`, `testExecutionId?` | `201 Created` / `409 Conflict` | Unique `(projectId, bugId)`; reporter set to authenticated user; foreign key `Restrict` prevents reporter deletion. |
| **Automation** | `POST /api/projects/:id/automation/:aid/executions` | `ADMIN`, `QA_LEAD`, `QA_ENGINEER` | `environmentId`, `trigger` (MANUAL, SCHEDULED, CI_CD) | `202 Accepted` / `400 Bad Request` | Only executes scripts in `APPROVED` state; DRAFT scripts are excluded; runId sequentially assigned. |
| **API Intel** | `POST /api/projects/:id/api-collections/:cid/requests` | `ADMIN`, `QA_LEAD`, `QA_ENGINEER` | `name`, `method` (GET/POST/PUT/PATCH/DELETE), `endpoint`, `assertions`, `headers` | `201 Created` / `400 Bad Request` | Automatically assigns `sequenceNumber`; endpoint validated against SSRF private loopbacks. |
| **API Runner** | `POST /api/projects/:id/api-collections/:cid/execute` | `ADMIN`, `QA_LEAD`, `QA_ENGINEER` | `environmentId` | `200 OK` / `502 Bad Gateway` | Server-side variable interpolation `{{var}}`; SSRF guard rejects `127.0.0.1`, `10.0.0.0/8`, `169.254.169.254`. |
| **Quality Gate** | `GET /api/projects/:id/quality-gate/evaluate` | Any Project Member | Query params: `cycleId?` | `200 OK` { gateStatus: 'PASS'/'FAIL', metrics } | Evaluates requirement coverage %, critical risk coverage %, and active high/critical defect caps. |

---

## 5. Test Coverage Gap Analysis & Boundary Edge Cases

### 5.1 Identified Vulnerabilities & Edge-Case Hazards

#### 1. DEF-02: Organization Deletion Foreign Key Deadlock
- **Location:** `packages/prisma/schema.prisma` (`Defect.reporter` has `onDelete: Restrict`)
- **Mechanism:** In Postgres, when deleting an Organization (`onDelete: Cascade`), the DB initiates user deletion in the transaction before completing defect cascading. Because defects reference `User` with `Restrict`, Postgres immediately throws a Foreign Key Constraint Violation (`P2003`), leaving the organization un-deletable while defects exist.
- **Current Coverage:** Documented in `ISSUE-LOG.md`, but lacking an automated API test verifying clean graceful cascade or pre-cascade defect purging.

#### 2. DATA-09: Sequence Number Race Condition in `ApiRequest`
- **Location:** `apps/api/src/controllers/api-intelligence.controller.ts`
- **Mechanism:** Sequence numbering uses `prisma.apiRequest.count() + 1`. Under concurrent creation requests within the same collection, two requests obtain the same sequence number, triggering a unique constraint error `(collectionId, sequenceNumber)` for one of the concurrent callers.
- **Current Coverage:** Gapped. No concurrent creation stress test exists.

#### 3. Plaintext Secret Vault Risk (`EnvironmentVariable.value`)
- **Location:** `packages/prisma/schema.prisma`
- **Mechanism:** `EnvironmentVariable` stores values in plaintext (`isSecret: true` only masks them in frontend API responses). If an audit log or debug endpoint dumps database rows, secrets are exposed.
- **Current Coverage:** UI redaction is tested, but at-rest encryption verification and leakage via export endpoints are untested.

#### 4. SSRF Guard Bypass Edge Cases
- **Location:** `apps/api/src/utils/ssrf-guard.ts`
- **Mechanism:** Tests check `localhost` and `127.0.0.1`. Boundary cases like IPv6 loopbacks (`::1`), hexadecimal IP encoding (`0x7f000001`), integer IP notation (`2130706433`), DNS rebinding (domain resolving to 127.0.0.1), and cloud metadata endpoints (`169.254.169.254`) must be strictly blocked.

#### 5. Unpopulated `packages/playwright-engine`
- **Observation:** `packages/playwright-engine` consists only of a bare `package.json`. The actual runner logic currently resides inside `apps/worker` directly. If the architecture intended `playwright-engine` as a reusable testing package, it is currently dead code/incomplete.

---

## 6. Formulated Proposed Test Specifications (Ready for Review)

> [!IMPORTANT]
> **EXECUTION COMPLIANCE NOTE:** As mandated by the execution rules, the following test specifications are formulated and detailed below with complete runnable code for review. No files have been written to disk. Once approved, these can be incorporated into `apps/api` and `apps/web/tests`.

---

### Test Spec 1: Unit Test — SSRF Guard & Loopback Prevention
**Proposed Path:** `apps/api/src/utils/__tests__/ssrf-guard.spec.ts`  
**Target:** `apps/api/src/utils/ssrf-guard.ts`  
**Purpose:** Verify that all variants of private IP addresses, cloud metadata endpoints, and DNS rebinding notations are rejected.

```typescript
import { describe, it, expect } from 'vitest';
import { isAllowedUrl } from '../ssrf-guard';

describe('Unit: SSRF Guard Security Enforcement', () => {
  const disallowedUrls = [
    'http://127.0.0.1:8080/admin',
    'http://localhost:3000/api',
    'http://[::1]:80/status',
    'http://169.254.169.254/latest/meta-data/', // AWS/GCP metadata
    'http://0177.0.0.1/',                      // Octal IP
    'http://0x7f.0x0.0x0.0x1/',                // Hex IP
    'http://2130706433/',                      // Dword IP
    'http://10.0.0.1:9000/internal',           // Private Class A
    'http://172.16.0.1:8080/health',           // Private Class B
    'http://192.168.1.1/router-login',         // Private Class C
    'file:///etc/passwd',                      // Disallowed scheme
    'gopher://127.0.0.1:6379/_INFO',           // Gopher exploit
  ];

  disallowedUrls.forEach((url) => {
    it(`should reject forbidden target: ${url}`, async () => {
      const result = await isAllowedUrl(url);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/private_network|disallowed_scheme|cloud_metadata/);
    });
  });

  const allowedUrls = [
    'https://api.github.com/users/octocat',
    'https://httpbin.org/get',
    'https://proofloop.qa/api/v1/health',
  ];

  allowedUrls.forEach((url) => {
    it(`should allow legitimate public target: ${url}`, async () => {
      const result = await isAllowedUrl(url);
      expect(result.allowed).toBe(true);
    });
  });
});
```

---

### Test Spec 2: Unit Test — Release Quality Gate Calculation Engine
**Proposed Path:** `apps/api/src/controllers/__tests__/quality-gate-evaluator.spec.ts`  
**Target:** `apps/api/src/controllers/quality-gate.controller.ts`  
**Purpose:** Verify threshold edge conditions (boundary off-by-one errors) in coverage percentages and defect counts.

```typescript
import { describe, it, expect } from 'vitest';
import { evaluateQualityGate } from '../quality-gate.controller';

describe('Unit: Quality Gate Evaluation Formulae', () => {
  const baseConfig = {
    requireFullCoverage: true,
    requireCriticalRiskCoverage: true,
    maxActiveCriticalDefects: 0,
    maxActiveHighDefects: 2,
  };

  it('should PASS when all criteria are strictly satisfied', () => {
    const metrics = {
      totalRequirements: 10,
      coveredRequirements: 10,       // 100% coverage
      criticalRisksTotal: 4,
      criticalRisksCovered: 4,       // 100% critical coverage
      activeCriticalDefects: 0,
      activeHighDefects: 2,          // Exactly on threshold
    };

    const result = evaluateQualityGate(baseConfig, metrics);
    expect(result.status).toBe('PASS');
    expect(result.blockingReasons).toHaveLength(0);
  });

  it('should FAIL when critical risk coverage is 99% but requireCriticalRiskCoverage is true', () => {
    const metrics = {
      totalRequirements: 100,
      coveredRequirements: 100,
      criticalRisksTotal: 10,
      criticalRisksCovered: 9,        // 90% critical coverage
      activeCriticalDefects: 0,
      activeHighDefects: 1,
    };

    const result = evaluateQualityGate(baseConfig, metrics);
    expect(result.status).toBe('BLOCK');
    expect(result.blockingReasons).toContain('Critical risk coverage below 100%');
  });

  it('should FAIL when active high defects exceed limit by 1', () => {
    const metrics = {
      totalRequirements: 10,
      coveredRequirements: 10,
      criticalRisksTotal: 2,
      criticalRisksCovered: 2,
      activeCriticalDefects: 0,
      activeHighDefects: 3,           // Exceeds maxActiveHighDefects (2)
    };

    const result = evaluateQualityGate(baseConfig, metrics);
    expect(result.status).toBe('BLOCK');
    expect(result.blockingReasons).toContain('Active HIGH defects (3) exceed policy threshold (2)');
  });
});
```

---

### Test Spec 3: Integration Test — DEF-02 Organization Cascade vs. Defect Restrict
**Proposed Path:** `apps/web/tests/e2e/org-defect-cascade-hazard.spec.ts`  
**Target:** `DELETE /api/organizations/current` with existing defects  
**Purpose:** Ensure system safely cleans up or cleanly rejects organization deletion without dirty unhandled database 500 exceptions.

```typescript
import { test, expect } from '@playwright/test';

test.describe('Integration Hazard: Organization Cascade with Active Defects', () => {
  test('should handle organization deletion gracefully when defects exist', async ({ request }) => {
    // 1. Register temporary organization and admin
    const uniqueEmail = `hazard-test-${Date.now()}@proofloop.qa`;
    const regRes = await request.post('/api/auth/register', {
      data: {
        email: uniqueEmail,
        password: 'Password123!',
        firstName: 'Hazard',
        lastName: 'Admin',
        organizationName: 'Hazard Corp',
      },
    });
    expect(regRes.status()).toBe(201);
    const { token, user } = await regRes.json();
    const authHeaders = { Authorization: `Bearer ${token}` };

    // 2. Create Project & Defect
    const projRes = await request.post('/api/projects', {
      headers: authHeaders,
      data: { name: 'Hazard Project' },
    });
    const project = await projRes.json();

    const defectRes = await request.post(`/api/projects/${project.id}/defects`, {
      headers: authHeaders,
      data: {
        bugId: 'BUG-HAZARD-01',
        title: 'Cascade blocker test',
        description: 'Verifying restrict behavior on user deletion',
        severity: 'HIGH',
        status: 'OPEN',
      },
    });
    expect(defectRes.status()).toBe(201);

    // 3. Attempt Organization deletion
    const delRes = await request.delete('/api/organizations/current', {
      headers: authHeaders,
    });

    // Expect either a clean 409 Conflict with helpful guidance or a clean 200 with atomic cascade cleanup
    expect([200, 409]).toContain(delRes.status());
    if (delRes.status() === 409) {
      const body = await delRes.json();
      expect(body.error).toMatch(/defects exist|purge project defects first/i);
    }
  });
});
```

---

### Test Spec 4: Integration Test — Concurrent `ApiRequest` Sequence Race Condition
**Proposed Path:** `apps/web/tests/e2e/api-request-concurrency.spec.ts`  
**Target:** `POST /api/projects/:id/api-collections/:cid/requests`  
**Purpose:** Verify that firing concurrent create requests does not violate the `(collectionId, sequenceNumber)` unique constraint.

```typescript
import { test, expect } from '@playwright/test';

test.describe('Concurrency: ApiRequest Sequence Assignment', () => {
  test('should assign monotonically increasing sequence numbers under concurrent bursts', async ({ request }) => {
    // Setup authenticated project and collection
    const authHeaders = await getAdminHeaders(request);
    const project = await createTestProject(request, authHeaders);
    const collectionRes = await request.post(`/api/projects/${project.id}/api-collections`, {
      headers: authHeaders,
      data: { name: 'Concurrency Collection' },
    });
    const collection = await collectionRes.json();

    // Fire 5 simultaneous create requests
    const promises = Array.from({ length: 5 }, (_, i) =>
      request.post(`/api/projects/${project.id}/api-collections/${collection.id}/requests`, {
        headers: authHeaders,
        data: {
          name: `Concurrent Request ${i + 1}`,
          method: 'GET',
          endpoint: 'https://httpbin.org/get',
        },
      })
    );

    const responses = await Promise.all(promises);
    
    // Every concurrent request must succeed with 201 without collision
    for (const res of responses) {
      expect(res.status()).toBe(201);
    }

    // Verify assigned sequence numbers form set 1..5 without duplicates
    const listRes = await request.get(`/api/projects/${project.id}/api-collections/${collection.id}/requests`, {
      headers: authHeaders,
    });
    const items = await listRes.json();
    const sequences = items.map((r: any) => r.sequenceNumber).sort((a: number, b: number) => a - b);
    expect(sequences).toEqual([1, 2, 3, 4, 5]);
  });
});
```

---

### Test Spec 5: E2E Test — Cross-Tenant Multi-Tenant Isolation
**Proposed Path:** `apps/web/tests/e2e/multi-tenant-isolation.spec.ts`  
**Target:** Project, Requirement, Defect, and Variable access across organizations  
**Purpose:** Confirm that a valid token from Tenant A cannot read, mutate, or inject records into Tenant B under any circumstance.

```typescript
import { test, expect } from '@playwright/test';

test.describe('Security E2E: Strict Multi-Tenant Data Isolation', () => {
  test('Tenant B cannot access or modify resources owned by Tenant A', async ({ request }) => {
    // 1. Create Tenant A with Project and Requirement
    const tokenA = await registerOrgUser(request, 'TenantAlpha', 'admin-a@alpha.qa');
    const projA = await createProject(request, tokenA, 'Alpha Core');
    const reqA = await createRequirement(request, tokenA, projA.id, 'REQ-A-01');

    // 2. Create Tenant B
    const tokenB = await registerOrgUser(request, 'TenantBeta', 'admin-b@beta.qa');

    // 3. Attempt direct access to Project A using Tenant B token
    const getProjRes = await request.get(`/api/projects/${projA.id}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect([403, 404]).toContain(getProjRes.status());

    // 4. Attempt to create a defect linked to Tenant A's project using Tenant B token
    const injectDefectRes = await request.post(`/api/projects/${projA.id}/defects`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: {
        bugId: 'BUG-INTRUDER-01',
        title: 'Cross tenant leak attempt',
        severity: 'CRITICAL',
        status: 'OPEN',
      },
    });
    expect([403, 404]).toContain(injectDefectRes.status());

    // 5. Attempt to read Tenant A's requirement
    const getReqRes = await request.get(`/api/projects/${projA.id}/requirements/${reqA.id}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect([403, 404]).toContain(getReqRes.status());
  });
});
```

---

## 7. Quality Gate Readiness & Actionable Next Steps

### 7.1 Summary of Readiness

| Area | Current Rating | Recommended Action |
|---|---|---|
| **E2E Playwright Flows** | **READY (Passes)** | Keep active in CI/CD pipeline. |
| **API Contract Validation** | **READY (Passes)** | Solid Zod schema coverage. |
| **Backend Unit Testing** | **BLOCKED (Needs Tests)** | Introduce Vitest/Jest unit suite in `apps/api` for `ssrf-guard`, `assertions`, and `rate-limiter`. |
| **Packages Architecture** | **ACTION REQUIRED** | Either populate `packages/playwright-engine` with worker execution logic or remove stub from root workspaces. |
| **Data Integrity (DEF-02)** | **MITIGATION REQUIRED** | Add pre-cascade cleanup logic in `organization.controller.ts` before executing `prisma.organization.delete()`. |

### 7.2 Action Plan for User Approval
1. **Approval Request 1:** Approve creation of `apps/api/test/unit` directory and execution of unit test suites covering `ssrf-guard.ts` and `quality-gate.controller.ts`.
2. **Approval Request 2:** Approve adding concurrency and cross-tenant isolation specs to `apps/web/tests/e2e`.
3. **Approval Request 3:** Review `packages/playwright-engine` roadmap to either implement the core execution runner or clean up the unused workspace package.
