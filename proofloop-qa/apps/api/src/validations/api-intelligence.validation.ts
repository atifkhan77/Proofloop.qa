import { z } from 'zod';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

const nonEmpty = (field: string) => z.string().trim().min(1, `${field} is required`);

/**
 * Auth config (API-07). One shape per type, so the execution engine never sees e.g. a
 * bearer config without a token. Secrets should be references like {{API_TOKEN}} (API-05).
 */
export const authSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('bearer'), token: nonEmpty('Bearer token') }),
  // Basic auth allows an empty password (RFC 7617), but not a missing one.
  z.object({ type: z.literal('basic'), username: nonEmpty('Username'), password: z.string() }),
  z.object({
    type: z.literal('apiKey'),
    key: nonEmpty('API key name'),
    value: nonEmpty('API key value'),
    in: z.enum(['header', 'query']).default('header'),
  }),
]);

export const ASSERTION_DATA_TYPES = ['string', 'number', 'boolean', 'null'] as const;
export type AssertionDataType = (typeof ASSERTION_DATA_TYPES)[number];

type ScalarValue = string | number | boolean | null;

/** status / responseTime and numeric comparisons are always numbers, whatever the client sends. */
export const isNumericOnly = (type: string, operator: string) =>
  type === 'status' || type === 'responseTime' || operator === 'greater_than' || operator === 'less_than';

/** Type of a stored value without dataType (assertions saved before API-22). */
export const inferDataType = (value: unknown): AssertionDataType =>
  value === null ? 'null' : typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string';

/** Converts `value` to `dataType`; undefined = not convertible. */
function toTyped(value: ScalarValue | undefined, dataType: AssertionDataType): ScalarValue | undefined {
  switch (dataType) {
    case 'number': {
      if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
      return undefined;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string' && /^(true|false)$/i.test(value.trim())) return value.trim().toLowerCase() === 'true';
      return undefined;
    }
    case 'null':
      return value === null || value === undefined || value === '' ? null : undefined;
    default:
      return value === undefined || value === null ? undefined : String(value);
  }
}

/**
 * Assertion rule (API-07, typed values API-22). Output is normalised: `dataType` is always set
 * (except for `exists`) and `value` is stored in that type, so the engine compares strictly.
 */
export const assertionSchema = z
  .object({
    type: z.enum(['status', 'header', 'body', 'responseTime']),
    path: z.string().trim().optional(), // header name, or JSONPath for body assertions
    operator: z.enum(['equals', 'not_equals', 'contains', 'exists', 'greater_than', 'less_than']),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    dataType: z.enum(ASSERTION_DATA_TYPES).optional(),
  })
  .superRefine((a, ctx) => {
    if ((a.type === 'header' || a.type === 'body') && !a.path) {
      ctx.addIssue({ code: 'custom', path: ['path'], message: `path is required for ${a.type} assertions` });
    }
    if (a.operator === 'exists') return;
    if (isNumericOnly(a.type, a.operator) && a.dataType && a.dataType !== 'number') {
      ctx.addIssue({ code: 'custom', path: ['dataType'], message: `${a.type === 'status' || a.type === 'responseTime' ? a.type : a.operator} requires dataType number` });
      return;
    }
    if (a.operator === 'contains' && a.dataType && a.dataType !== 'string') {
      ctx.addIssue({ code: 'custom', path: ['dataType'], message: 'contains requires dataType string' });
      return;
    }
    const dataType = isNumericOnly(a.type, a.operator) ? 'number' : (a.dataType ?? inferDataType(a.value));
    if (dataType !== 'null' && a.value === undefined) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: `value is required for operator ${a.operator}` });
    } else if (toTyped(a.value, dataType) === undefined && dataType !== 'null') {
      ctx.addIssue({ code: 'custom', path: ['value'], message: `value must be a ${dataType === 'boolean' ? 'boolean (true or false)' : dataType}` });
    } else if (dataType === 'null' && toTyped(a.value, 'null') === undefined) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'value must be empty for dataType null' });
    }
  })
  .transform((a) => {
    const { value, dataType, ...rest } = a;
    if (a.operator === 'exists') return rest;
    const effective = isNumericOnly(a.type, a.operator) ? 'number' : (dataType ?? inferDataType(value));
    return { ...rest, dataType: effective, value: toTyped(value, effective) as ScalarValue };
  });

export type AuthConfig = z.infer<typeof authSchema>;

/** Assertion as stored (dataType may be missing on rules saved before API-22). */
export interface Assertion {
  type: 'status' | 'header' | 'body' | 'responseTime';
  path?: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'exists' | 'greater_than' | 'less_than';
  value?: string | number | boolean | null;
  dataType?: AssertionDataType;
}

/** POST /api-requests/:requestId/execute. '' = no environment. */
export const executeApiRequestSchema = z.object({
  environmentId: z.string().trim().optional(),
});

export const createApiCollectionSchema = z.object({
  name: z.string().trim().min(1, 'Collection name is required'),
  description: z.string().trim().optional(),
});

export const createApiRequestSchema = z.object({
  name: z.string().trim().min(1, 'Request name is required'),
  method: z.enum(HTTP_METHODS, { errorMap: () => ({ message: 'Invalid HTTP method' }) }),
  // Flexible on purpose (absolute URL or {{baseUrl}}/path). SSRF is enforced by the runner (API-06).
  endpoint: z.string().trim().min(1, 'Endpoint URL is required'),
  headers: z.record(z.string()).optional(),
  queryParams: z.record(z.string()).optional(),
  // JSON object, array, string, number, boolean or null. Omitted/null = no body.
  body: z.any().optional(),
  auth: authSchema.optional(),
  assertions: z.array(assertionSchema).optional(),
});
