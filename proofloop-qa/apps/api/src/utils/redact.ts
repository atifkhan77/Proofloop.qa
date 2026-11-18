/**
 * Defense in depth for API-05: secrets are masked in API responses for VIEWERs.
 * Stored data is never modified; callers get a redacted copy.
 */

export const REDACTED = '********';

// Header / query parameter NAMES that typically carry credentials. The spec names the
// Authorization header as an example; the others leak the same way (cookies, API keys, tokens).
const SENSITIVE_NAME = /(authorization|cookie|token|secret|passw(or)?d|api[-_]?key|session)/i;

// Auth config fields that hold the secret itself (key/username/type stay visible).
const SENSITIVE_AUTH_FIELDS = ['token', 'password', 'value'] as const;

type JsonRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is JsonRecord => typeof v === 'object' && v !== null && !Array.isArray(v);

function redactByName(values: unknown): unknown {
  if (!isRecord(values)) return values;
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, SENSITIVE_NAME.test(name) ? REDACTED : value]),
  );
}

function redactAuth(auth: unknown): unknown {
  if (!isRecord(auth)) return auth;
  const copy: JsonRecord = { ...auth };
  for (const field of SENSITIVE_AUTH_FIELDS) {
    if (typeof copy[field] === 'string' && copy[field] !== '') copy[field] = REDACTED;
  }
  return copy;
}

/**
 * Copy of an ApiRequest for VIEWERs: credential-bearing headers, query params and auth values
 * masked, and the request body hidden entirely (API-12: bodies carry passwords/PII, e.g. login).
 * `!== null` (not truthiness): falsy bodies 0 / false / "" are payload too.
 */
export function redactApiRequest<T extends { headers: unknown; queryParams: unknown; auth: unknown; body: unknown }>(
  request: T,
): T {
  return {
    ...request,
    headers: redactByName(request.headers),
    queryParams: redactByName(request.queryParams),
    auth: redactAuth(request.auth),
    body: request.body !== null && request.body !== undefined ? { _redacted: 'Request body hidden for VIEWER role' } : null,
  };
}

/**
 * One-line, credential-free summary of an error for server logs.
 * Logging an axios error object directly prints its `config` and `request` (incl. the
 * Authorization header with e.g. Jira email:token in Base64). This keeps only the error code,
 * HTTP status, message and a short excerpt of the response body.
 * No axios import on purpose: duck-typed so it also works for errors from other clients.
 */
export function describeError(err: unknown): string {
  if (!isRecord(err)) return String(err);
  const message = typeof err.message === 'string' ? err.message : String(err);
  if (err.isAxiosError !== true) {
    return typeof err.name === 'string' ? `${err.name}: ${message}` : message;
  }
  const parts = ['HTTP request failed'];
  if (typeof err.code === 'string') parts.push(err.code);
  const response = isRecord(err.response) ? err.response : undefined;
  if (response && typeof response.status === 'number') parts.push(`status ${response.status}`);
  parts.push(message);
  if (response && response.data !== undefined) {
    let data: string;
    try {
      data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    } catch {
      data = '[unserializable response body]';
    }
    parts.push(`response: ${data.length > 300 ? `${data.slice(0, 300)}…` : data}`);
  }
  return parts.join(' | ');
}
