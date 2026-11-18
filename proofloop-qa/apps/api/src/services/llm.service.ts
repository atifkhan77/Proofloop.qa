import axios from 'axios';
import { safeAgents, assertSafeUrl } from '../utils/ssrf-guard';

export interface GeneratedTestCaseDraft {
  title: string;
  description: string;
  preconditions: string;
  steps: Array<{
    stepNumber: number;
    action: string;
    expectedResult: string;
  }>;
}

export interface RootCauseAnalysisResult {
  hypothesis: string;
  likelyCulprit: string;
  severityAssessment: string;
  suggestedRemediation: string;
}

/**
 * Intelligent QA generation engine that generates structured test cases from requirements.
 * Connects to external LLMs if AI_API_KEY is configured, or provides high-fidelity deterministic
 * QA test patterns based on requirement semantics.
 */
export async function generateTestCasesForRequirement(requirement: {
  title: string;
  description: string;
  reqId: string;
}): Promise<GeneratedTestCaseDraft[]> {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL || 'https://api.openai.com/v1';

  if (apiKey) {
    try {
      await assertSafeUrl(baseUrl);
      const prompt = `As a Senior QA Automation Engineer, generate 3-4 comprehensive test cases (positive, negative, and edge-case) for this requirement:
Requirement ID: ${requirement.reqId}
Title: ${requirement.title}
Description: ${requirement.description}

Return ONLY valid JSON matching this structure:
[
  {
    "title": "string",
    "description": "string",
    "preconditions": "string",
    "steps": [
      { "stepNumber": 1, "action": "string", "expectedResult": "string" }
    ]
  }
]`;

      const res = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          ...safeAgents,
          timeout: 15000,
        },
      );

      const content = res.data?.choices?.[0]?.message?.content;
      if (content) {
        const cleaned = content.replace(/```json\n?|\n?```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (err) {
      console.warn('[llm.service] External LLM call failed, falling back to rule-based generator:', (err as Error).message);
    }
  }

  // Fallback intelligent QA draft generator
  const t = requirement.title.trim();
  const d = requirement.description.trim();

  return [
    {
      title: `[Happy Path] Verify successful flow for: ${t}`,
      description: `Validates that a user can successfully complete standard operations satisfying requirement ${requirement.reqId} (${d}).`,
      preconditions: 'User is authenticated with valid credentials and required permissions.',
      steps: [
        {
          stepNumber: 1,
          action: `Navigate to the feature view and submit valid input matching requirement specifications: "${t}".`,
          expectedResult: 'System accepts the request and initiates processing without error.',
        },
        {
          stepNumber: 2,
          action: 'Wait for confirmation response or database state change.',
          expectedResult: 'HTTP 200/201 OK response received with success notification displayed.',
        },
      ],
    },
    {
      title: `[Negative Validation] Reject malformed or missing fields for: ${t}`,
      description: `Ensures robust server and client validation when required data attributes are omitted or invalid for ${requirement.reqId}.`,
      preconditions: 'User has access to the form/API endpoint.',
      steps: [
        {
          stepNumber: 1,
          action: 'Submit payload with missing mandatory fields or invalid data types.',
          expectedResult: 'System returns HTTP 400 Bad Request with field-level validation errors.',
        },
        {
          stepNumber: 2,
          action: 'Verify error indicators appear on UI without state corruption.',
          expectedResult: 'Clear validation banners displayed with helpful remediation text.',
        },
      ],
    },
    {
      title: `[Security & RBAC] Unauthorized access protection for: ${t}`,
      description: `Verifies that unauthenticated or non-privileged users cannot execute actions defined in ${requirement.reqId}.`,
      preconditions: 'User session has VIEWER role or is unauthenticated.',
      steps: [
        {
          stepNumber: 1,
          action: 'Attempt to perform state-changing mutation (POST/PUT/DELETE) without sufficient privileges.',
          expectedResult: 'Request is rejected with HTTP 401 Unauthorized or HTTP 403 Forbidden.',
        },
        {
          stepNumber: 2,
          action: 'Confirm audit log records access denial.',
          expectedResult: 'Audit event logged with caller identity and timestamp.',
        },
      ],
    },
  ];
}

// ---------- Playwright script generation ----------

export interface ScriptSourceTestCase {
  tcId: string;
  title: string;
  description: string | null;
  preconditions: string | null;
  testData: string | null;
  testType: string;
  steps: Array<{ stepNumber: number; action: string; expectedResult: string }>;
}

export interface GeneratedScriptResult {
  code: string;
  source: 'AI' | 'TEMPLATE';
  model: string | null;
  /** Set when an LLM was configured but its output was unusable, so the template was used. */
  warning?: string;
}

const MAX_SCRIPT_LENGTH = 100_000;

/** Lowercase file-system-safe slug, e.g. "TC-001 Login works!" -> "tc-001-login-works". */
export function slugify(value: string, maxLength = 60): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'test';
}

export function scriptFileName(testCase: { tcId: string; title: string }): string {
  return `${slugify(`${testCase.tcId} ${testCase.title}`)}.spec.ts`;
}

/** Strips a surrounding ```ts fence (models often add one despite instructions). */
function stripCodeFence(content: string): string {
  const fenced = content.match(/```(?:typescript|ts|javascript|js)?\s*\n([\s\S]*?)```/);
  return (fenced ? fenced[1] : content).trim();
}

/** Minimal shape check: a usable spec imports Playwright Test and declares a test. */
function looksLikePlaywrightSpec(code: string): boolean {
  return code.includes('@playwright/test') && /\btest(\.\w+)?\(/.test(code) && code.length <= MAX_SCRIPT_LENGTH;
}

/** JS string literal for embedding user text in generated code (JSON escaping is valid TS). */
const lit = (value: string) => JSON.stringify(value);

/** Comment-safe single line (user text must not close a block comment or break the line). */
const commentText = (value: string) => value.replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ').trim();

/**
 * Deterministic fallback when no LLM is configured or its output is unusable. Every step becomes a
 * test.step with a TODO; the test is marked test.fixme so it reports SKIPPED, never a false PASS.
 */
function templateScript(tc: ScriptSourceTestCase): string {
  const steps = [...tc.steps].sort((a, b) => a.stepNumber - b.stepNumber);
  const lines: string[] = [
    "import { test, expect } from '@playwright/test';",
    '',
    `// ${commentText(`${tc.tcId}: ${tc.title}`)}`,
    '// Generated from a template (no LLM configured). Implement each step, then remove test.fixme.',
  ];
  if (tc.preconditions) lines.push(`// Preconditions: ${commentText(tc.preconditions)}`);
  if (tc.testData) lines.push(`// Test data: ${commentText(tc.testData)}`);
  lines.push('', `test.fixme(${lit(`${tc.tcId}: ${tc.title}`)}, async ({ page }) => {`, "  await page.goto('/');");
  if (steps.length === 0) {
    lines.push('', '  // TODO: this test case has no steps yet.', '  await expect(page).toHaveURL(/.*/);');
  }
  for (const step of steps) {
    lines.push(
      '',
      `  await test.step(${lit(`Step ${step.stepNumber}: ${step.action}`)}, async () => {`,
      `    // Expected: ${commentText(step.expectedResult)}`,
      '    // TODO: implement this step.',
      '  });',
    );
  }
  lines.push('});', '');
  return lines.join('\n');
}

/**
 * Turns a test case into a Playwright Test spec (TypeScript). Uses the configured
 * OpenAI-compatible LLM (AI_API_KEY / AI_BASE_URL / AI_MODEL), else the template above.
 * The spec must use relative URLs: the worker sets baseURL from the run's environment.
 */
export async function generatePlaywrightScript(tc: ScriptSourceTestCase): Promise<GeneratedScriptResult> {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.AI_MODEL || 'gpt-4o-mini';

  if (!apiKey) {
    return { code: templateScript(tc), source: 'TEMPLATE', model: null };
  }

  const steps = [...tc.steps]
    .sort((a, b) => a.stepNumber - b.stepNumber)
    .map((s) => `${s.stepNumber}. Action: ${s.action}\n   Expected: ${s.expectedResult}`)
    .join('\n');

  const prompt = `You are a Senior QA Automation Engineer. Write ONE Playwright Test spec file in TypeScript for this test case.

Test case ${tc.tcId}: ${tc.title}
Type: ${tc.testType}
Description: ${tc.description || '-'}
Preconditions: ${tc.preconditions || '-'}
Test data: ${tc.testData || '-'}
Steps:
${steps || '(no steps)'}

Rules:
- Start with: import { test, expect } from '@playwright/test';
- One test() named "${tc.tcId}: <title>"; wrap each step in await test.step('Step N: ...', async () => { ... }).
- Use RELATIVE URLs only (page.goto('/...')); baseURL is configured by the runner. Never hard-code hosts.
- Prefer user-facing locators: getByRole, getByLabel, getByText, getByTestId. No fixed waits (no waitForTimeout).
- Assert every expected result with expect(). For API test cases use the request fixture.
- Read credentials or secrets from process.env (e.g. process.env.TEST_USER_EMAIL), never hard-code them.
- Where a selector is unknown, choose the most likely accessible one and add a short // TODO comment.
- Return ONLY the TypeScript code, no explanations, no markdown fences.`;

  try {
    await assertSafeUrl(baseUrl);
    const res = await axios.post(
      `${baseUrl}/chat/completions`,
      { model, messages: [{ role: 'user', content: prompt }], temperature: 0.2 },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        ...safeAgents,
        timeout: 60_000,
      },
    );
    const content: unknown = res.data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      const code = stripCodeFence(content);
      if (looksLikePlaywrightSpec(code)) {
        return { code: code.endsWith('\n') ? code : `${code}\n`, source: 'AI', model };
      }
    }
    console.warn('[llm.service] LLM returned no usable Playwright spec; using template');
    return { code: templateScript(tc), source: 'TEMPLATE', model: null, warning: 'AI output was not a valid Playwright spec; a template was generated instead.' };
  } catch (err) {
    console.warn('[llm.service] Script generation LLM call failed, using template:', (err as Error).message);
    return { code: templateScript(tc), source: 'TEMPLATE', model: null, warning: 'AI provider call failed; a template was generated instead.' };
  }
}

/**
 * Generates an automated Root Cause Hypothesis from a failed execution or stack trace.
 */
export async function analyzeRootCause(errorDetails: {
  title?: string;
  errorMessage?: string;
  stackTrace?: string;
  httpStatus?: number;
  url?: string;
}): Promise<RootCauseAnalysisResult> {
  const msg = errorDetails.errorMessage || errorDetails.title || 'Unknown failure';
  const stack = errorDetails.stackTrace || '';
  const status = errorDetails.httpStatus;

  if (status === 404) {
    return {
      hypothesis: 'Resource not found at target destination or route unmapped.',
      likelyCulprit: 'API Routing / Resource Identification',
      severityAssessment: 'HIGH',
      suggestedRemediation: 'Verify URL parameter encoding and verify database record existence before executing request.',
    };
  }

  if (status === 401 || status === 403) {
    return {
      hypothesis: 'Authentication or RBAC permission barrier rejected execution.',
      likelyCulprit: 'Access Control / Token Expiry',
      severityAssessment: 'CRITICAL',
      suggestedRemediation: 'Check token validity, renew JWT header, and verify required role permissions.',
    };
  }

  if (status && status >= 500) {
    return {
      hypothesis: 'Unhandled server exception or downstream database connection drop.',
      likelyCulprit: 'Backend Service Fault',
      severityAssessment: 'CRITICAL',
      suggestedRemediation: 'Inspect backend error logs, verify database connection pooling, and add defensive error handling.',
    };
  }

  if (msg.toLowerCase().includes('timeout') || stack.toLowerCase().includes('timeout')) {
    return {
      hypothesis: 'Operation timed out waiting for DOM element or external HTTP socket response.',
      likelyCulprit: 'Network Latency / Slow DOM Rendering',
      severityAssessment: 'MEDIUM',
      suggestedRemediation: 'Increase explicit assertion timeout or check target server responsiveness.',
    };
  }

  return {
    hypothesis: `Failure occurred during execution: "${msg}". Analysis indicates potential assertion or schema mismatch.`,
    likelyCulprit: 'Data Contract or Assertion Assertion Rule',
    severityAssessment: 'HIGH',
    suggestedRemediation: 'Inspect request payload schema and verify test preconditions match current environment data.',
  };
}
