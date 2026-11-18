import {
  inferDataType,
  isNumericOnly,
  type Assertion,
  type AssertionDataType,
} from '../validations/api-intelligence.validation';

export interface ResponseSnapshot {
  status: number;
  headers: Record<string, unknown>;
  data: unknown;
  responseTime: number;
}

export interface AssertionFailure extends Assertion {
  actualValue: unknown;
}

const MISSING = undefined;

/**
 * Minimal JSONPath subset: "$", "$.a.b", "$.items[0].id", "$.items.0.id" (also without "$.").
 * Only OWN properties are read, so "$.toString" or "$.__proto__" never resolve to built-ins.
 */
export function getValueAtPath(root: unknown, path: string): unknown {
  const trimmed = path.trim();
  const clean = trimmed === '$' ? '' : trimmed.replace(/^\$\.?/, '');
  if (!clean) return root;

  const segments = clean.replace(/\[(\d+)\]/g, '.$1').split('.').filter((s) => s !== '');
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return MISSING;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return MISSING;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Text form used for equals/contains until typed values exist (API-22): objects as JSON. */
const asText = (v: unknown): string => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v));

/** A real number, or a non-empty numeric string. null, '', true, [] etc. are NOT numbers. */
function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A real boolean, or "true"/"false" text (header values are always text). */
function asBoolean(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string' && /^(true|false)$/i.test(v.trim())) return v.trim().toLowerCase() === 'true';
  return null;
}

/**
 * Actual value in the comparison domain of `dataType`; undefined = not of that type
 * (missing fields, wrong JSON types). Never coerces null/missing into 0, false or "undefined".
 */
function actualAs(actual: unknown, dataType: AssertionDataType): unknown {
  switch (dataType) {
    case 'number':
      return asNumber(actual) ?? undefined;
    case 'boolean':
      return asBoolean(actual) ?? undefined;
    case 'null':
      return actual === null ? null : undefined;
    default:
      return typeof actual === 'string' ? actual : undefined;
  }
}

/** Typed comparison (API-22). `dataType` decides the domain; values of another type never match. */
export function evaluateOperator(
  actual: unknown,
  operator: Assertion['operator'],
  expected: unknown,
  dataType: AssertionDataType,
): boolean {
  if (operator === 'exists') return actual !== undefined && actual !== null;

  if (operator === 'contains') {
    // Strings: substring. Arrays/objects: their JSON text (e.g. a tag inside a list).
    if (actual === undefined || actual === null) return false;
    return asText(actual).includes(String(expected));
  }

  const typed = actualAs(actual, dataType);
  // Expected in the same domain (rules saved before API-22 may hold e.g. "200" as text).
  const exp = dataType === 'null' ? null : dataType === 'string' ? String(expected) : actualAs(expected, dataType);
  switch (operator) {
    case 'equals':
      return typed !== undefined && exp !== undefined && typed === exp;
    case 'not_equals':
      return typed === undefined || typed !== exp;
    case 'greater_than':
    case 'less_than': {
      if (typeof typed !== 'number' || typeof exp !== 'number') return false;
      return operator === 'greater_than' ? typed > exp : typed < exp;
    }
    default:
      return false;
  }
}

/** dataType for a stored rule: numeric-only rules are numbers; older rules infer from the value. */
const dataTypeOf = (a: Assertion): AssertionDataType =>
  isNumericOnly(a.type, a.operator) ? 'number' : (a.dataType ?? inferDataType(a.value));

function actualFor(assertion: Assertion, response: ResponseSnapshot): unknown {
  switch (assertion.type) {
    case 'status':
      return response.status;
    case 'responseTime':
      return response.responseTime;
    case 'header': {
      if (!assertion.path) return MISSING;
      const name = assertion.path.toLowerCase(); // Node lowercases incoming header names
      const value = response.headers[name];
      return Array.isArray(value) ? value.join(', ') : value;
    }
    case 'body':
      return assertion.path ? getValueAtPath(response.data, assertion.path) : response.data;
    default:
      return MISSING;
  }
}

/** Stops at the first failing assertion (rules are evaluated in stored order). */
export function evaluateAssertions(
  assertions: Assertion[] | null | undefined,
  response: ResponseSnapshot,
): { passed: true } | { passed: false; failedAssertion: AssertionFailure } {
  for (const assertion of assertions ?? []) {
    const actualValue = actualFor(assertion, response);
    if (!evaluateOperator(actualValue, assertion.operator, assertion.value, dataTypeOf(assertion))) {
      return { passed: false, failedAssertion: { ...assertion, actualValue } };
    }
  }
  return { passed: true };
}

const show = (v: unknown) => (v === undefined ? '(missing)' : asText(v));

export function describeFailure(f: AssertionFailure): string {
  const target = f.path ? `${f.type} ${f.path}` : f.type;
  const expected =
    f.operator === 'exists' ? 'to exist' : `${f.operator.replace('_', ' ')} '${show(f.value)}' (${dataTypeOf(f)})`;
  return `Assertion failed on [${target}]: expected ${expected} but got '${show(f.actualValue)}'`;
}
