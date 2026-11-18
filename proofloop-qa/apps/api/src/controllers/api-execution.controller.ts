import { Response } from 'express';
import axios, { type AxiosResponse } from 'axios';
import { Prisma } from '@proofloop/prisma';
import { prisma } from '../db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { handleError } from '../utils/http-error';
import {
  assertSafeUrl,
  checkRedirect,
  isSsrfError,
  safeAgents,
  InvalidEndpointError,
  SsrfBlockedError,
} from '../utils/ssrf-guard';
import { describeFailure, evaluateAssertions } from '../utils/assertions';
import { executeApiRequestSchema, type Assertion, type AuthConfig } from '../validations/api-intelligence.validation';
import { resolveRequest, type ResolvedRequest, type ResolvableEnvironment } from '../utils/variables';

const TIMEOUT_MS = 10_000;
/** Responses are held in memory and stored in Postgres: cap them. */
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;

const DNS_NOT_FOUND = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'EAI_NODATA']);

export const executeApiRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;
    const { environmentId } = executeApiRequestSchema.parse(req.body ?? {});

    const apiRequest = await prisma.apiRequest.findFirst({
      where: { id: requestId, collection: { project: { organizationId: req.user!.organizationId } } },
      include: { collection: { select: { projectId: true } } },
    });

    if (!apiRequest) {
      res.status(404).json({ error: 'API Request not found' });
      return;
    }

    // Environment must belong to the request's PROJECT (not just the org; API-33 / DATA-08).
    // Variables incl. raw secret values are loaded here, server-side only.
    let environment: ResolvableEnvironment & { id: string } | null = null;
    if (environmentId) {
      environment = await prisma.projectEnvironment.findFirst({
        where: { id: environmentId, projectId: apiRequest.collection.projectId },
        select: { id: true, name: true, baseUrl: true, variables: { select: { key: true, value: true, isSecret: true } } },
      });
      if (!environment) {
        res.status(400).json({
          error: 'Validation failed',
          details: { environmentId: ['Invalid environment for this project'] },
        });
        return;
      }
    }

    // 1. Resolve {{KEY}} everywhere, then SSRF layer 1 on the FINAL URL (shape, protocol, every address).
    let url: URL;
    let resolved: ResolvedRequest;
    try {
      resolved = resolveRequest(
        {
          endpoint: apiRequest.endpoint,
          headers: (apiRequest.headers as Record<string, string> | null) ?? {},
          queryParams: (apiRequest.queryParams as Record<string, string> | null) ?? {},
          auth: apiRequest.auth as Record<string, unknown> | null,
          body: apiRequest.body,
        },
        environment,
      );
      url = await assertSafeUrl(resolved.endpoint);
    } catch (error) {
      if (error instanceof InvalidEndpointError) {
        res.status(400).json({ error: error.message });
      } else if (error instanceof SsrfBlockedError) {
        res.status(403).json({ error: error.message });
      } else if (DNS_NOT_FOUND.has((error as NodeJS.ErrnoException).code ?? '')) {
        res.status(400).json({ error: 'Endpoint host not found' });
      } else {
        throw error;
      }
      return;
    }

    // 2. Request config from the RESOLVED parts (fresh copies: stored JSON is never mutated).
    const headers: Record<string, string> = { ...resolved.headers };
    const params: Record<string, string> = { ...resolved.queryParams };
    const auth = resolved.auth as AuthConfig | null;

    if (auth?.type === 'bearer') {
      headers['Authorization'] = `Bearer ${auth.token}`;
    } else if (auth?.type === 'basic') {
      headers['Authorization'] = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
    } else if (auth?.type === 'apiKey') {
      if (auth.in === 'query') params[auth.key] = auth.value;
      else headers[auth.key] = auth.value;
    }

    // 3. Execute. SSRF layers 2+3 apply to every connection and redirect hop.
    const startTime = performance.now();
    let response: AxiosResponse | undefined;
    let executionError: string | null = null;

    try {
      response = await axios.request({
        method: apiRequest.method,
        url: url.toString(),
        headers,
        params,
        data: resolved.body ?? undefined,
        timeout: TIMEOUT_MS,
        maxContentLength: MAX_RESPONSE_BYTES,
        // With secrets, never follow redirects: the trusted host could forward custom headers
        // (e.g. X-API-Key) to another host. The 3xx is returned as the result instead.
        maxRedirects: resolved.usesSecrets ? 0 : MAX_REDIRECTS,
        beforeRedirect: checkRedirect,
        ...safeAgents,
        proxy: false, // ignore HTTP(S)_PROXY env vars: they would bypass the agents' DNS check
        validateStatus: () => true, // 4xx/5xx are results to assert on, not errors
      });
    } catch (error) {
      if (isSsrfError(error)) {
        res.status(403).json({ error: (error as Error).message.startsWith('SSRF Blocked') ? (error as Error).message : 'SSRF Blocked: request was redirected or resolved to a non-public address' });
        return;
      }
      executionError = (error as Error).message; // network error, timeout, oversized response
    }

    const responseTime = Math.round(performance.now() - startTime);

    // 4. Evaluate assertions (only when a response arrived).
    let passed = false;
    let errorMessage = executionError;
    if (response) {
      const result = evaluateAssertions(apiRequest.assertions as Assertion[] | null, {
        status: response.status,
        headers: response.headers as Record<string, unknown>,
        data: response.data,
        responseTime,
      });
      passed = result.passed;
      if (!result.passed) errorMessage = describeFailure(result.failedAssertion);
    }

    // 5. Record. `data || null` would turn valid bodies 0, false and "" into null.
    const data: unknown = response?.data;
    const execution = await prisma.apiExecution.create({
      data: {
        status: passed ? 'PASSED' : 'FAILED',
        responseTime,
        statusCode: response?.status ?? 0,
        responseBody: data === undefined || data === null ? Prisma.DbNull : (data as Prisma.InputJsonValue),
        errorMessage,
        requestId: apiRequest.id,
        environmentId: environment?.id ?? null,
      },
      include: { environment: { select: { name: true } } },
    });

    res.status(201).json(execution);
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * GET /api-executions/:executionId — for polling. Execution is currently synchronous, so a
 * run returned by POST .../execute is already final; this endpoint also serves history/reload.
 */
export const getApiExecution = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const execution = await prisma.apiExecution.findFirst({
      where: {
        id: req.params.executionId,
        request: { collection: { project: { organizationId: req.user!.organizationId } } },
      },
      include: { environment: { select: { name: true } } },
    });

    if (!execution) {
      res.status(404).json({ error: 'Execution not found' });
      return;
    }

    // API-38: VIEWERs see the outcome (status, HTTP code, timing) but not the payload or the
    // error text (assertion messages quote response values). `!== null`, not truthiness:
    // falsy bodies (0, false, "") are payload too.
    if (req.user!.role === 'VIEWER') {
      res.json({
        ...execution,
        responseBody: execution.responseBody !== null ? { _redacted: 'Response body hidden for VIEWER role' } : null,
        errorMessage: execution.errorMessage !== null ? 'Execution or assertion failed [details redacted for VIEWER]' : null,
      });
      return;
    }

    res.json(execution);
  } catch (error) {
    handleError(error, res);
  }
};
