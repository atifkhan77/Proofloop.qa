import { useState } from 'react';
import { useForm, useFieldArray, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, AlertCircle, Send, Settings, Shield, CheckSquare, Trash2, Database, FileJson, type LucideIcon } from 'lucide-react';
import {
  HTTP_METHODS,
  ASSERTION_TYPES,
  ASSERTION_OPERATORS,
  ASSERTION_DATA_TYPES,
  type Assertion,
  type AssertionDataType,
  type AuthConfig,
  type CreateApiRequestData,
  type JsonValue,
} from '@/lib/api/api-intelligence';
import { METHOD_COLORS } from './method-colors';

// ---------- Form model (UI rows) and validation mirroring the API schemas ----------

const kvRow = z.object({ key: z.string(), value: z.string() });

const NUMERIC_TYPES = ['status', 'responseTime'];
const NUMERIC_OPERATORS = ['greater_than', 'less_than'];
const needsNumber = (type: string, operator: string) => NUMERIC_TYPES.includes(type) || NUMERIC_OPERATORS.includes(operator);
const needsPath = (type: string) => type === 'header' || type === 'body';

/**
 * Value type actually used (mirrors the API, API-22): status/responseTime and numeric
 * comparisons are numbers, `contains` is text; otherwise the user's choice.
 */
const effectiveType = (row: { type: string; operator: string; dataType?: AssertionDataType }): AssertionDataType =>
  needsNumber(row.type, row.operator) ? 'number' : row.operator === 'contains' ? 'string' : (row.dataType ?? 'string');
const typeIsFixed = (row: { type: string; operator: string }) => needsNumber(row.type, row.operator) || row.operator === 'contains';

const formSchema = z.object({
  name: z.string().trim().min(1, 'Request name is required'),
  method: z.enum(HTTP_METHODS),
  endpoint: z.string().trim().min(1, 'Endpoint URL is required'),
  headers: z.array(kvRow),
  queryParams: z.array(kvRow),
  auth: z
    .object({
      type: z.enum(['none', 'bearer', 'basic', 'apiKey']),
      token: z.string(),
      username: z.string(),
      password: z.string(),
      key: z.string(),
      value: z.string(),
      in: z.enum(['header', 'query']),
    })
    .superRefine((a, ctx) => {
      const required = (field: 'token' | 'username' | 'key' | 'value', message: string) => {
        if (!a[field].trim()) ctx.addIssue({ code: 'custom', path: [field], message });
      };
      if (a.type === 'bearer') required('token', 'Bearer token is required');
      if (a.type === 'basic') required('username', 'Username is required');
      if (a.type === 'apiKey') {
        required('key', 'API key name is required');
        required('value', 'API key value is required');
      }
    }),
  bodyStr: z.string().refine((s) => {
    if (!s.trim()) return true;
    try {
      JSON.parse(s);
      return true;
    } catch {
      return false;
    }
  }, 'Body must be valid JSON'),
  assertions: z.array(
    z
      .object({
        type: z.enum(ASSERTION_TYPES),
        path: z.string(),
        operator: z.enum(ASSERTION_OPERATORS),
        // Optional: not rendered (a display-only select is shown) when the API fixes the type.
        dataType: z.enum(ASSERTION_DATA_TYPES).optional(),
        value: z.string(),
      })
      .superRefine((a, ctx) => {
        if (needsPath(a.type) && !a.path.trim()) {
          ctx.addIssue({ code: 'custom', path: ['path'], message: a.type === 'body' ? 'JSONPath is required' : 'Header name is required' });
        }
        if (a.operator === 'exists') return;
        const dataType = effectiveType(a);
        if (dataType === 'null') return; // no value needed
        if (!a.value.trim()) {
          ctx.addIssue({ code: 'custom', path: ['value'], message: 'Value is required' });
        } else if (dataType === 'number' && !Number.isFinite(Number(a.value))) {
          ctx.addIssue({ code: 'custom', path: ['value'], message: 'Value must be a number' });
        } else if (dataType === 'boolean' && !/^(true|false)$/i.test(a.value.trim())) {
          ctx.addIssue({ code: 'custom', path: ['value'], message: 'Value must be true or false' });
        }
      }),
  ),
});

type FormValues = z.infer<typeof formSchema>;

const DEFAULT_VALUES: FormValues = {
  name: '',
  method: 'GET',
  endpoint: '',
  headers: [{ key: '', value: '' }],
  queryParams: [{ key: '', value: '' }],
  auth: { type: 'none', token: '', username: '', password: '', key: '', value: '', in: 'header' },
  bodyStr: '',
  assertions: [{ type: 'status', operator: 'equals', value: '200', path: '', dataType: 'number' }],
};

// ---------- UI rows -> API payload ----------

const rowsToRecord = (rows: { key: string; value: string }[]) =>
  Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value.trim()]));

function toAuth(a: FormValues['auth']): AuthConfig | undefined {
  switch (a.type) {
    case 'bearer':
      return { type: 'bearer', token: a.token.trim() };
    case 'basic':
      return { type: 'basic', username: a.username.trim(), password: a.password };
    case 'apiKey':
      return { type: 'apiKey', key: a.key.trim(), value: a.value.trim(), in: a.in };
    default:
      return undefined; // server default { type: 'none' }
  }
}

function typedValue(value: string, dataType: AssertionDataType): string | number | boolean | null {
  if (dataType === 'number') return Number(value);
  if (dataType === 'boolean') return value.trim().toLowerCase() === 'true';
  if (dataType === 'null') return null;
  return value;
}

// Every row is kept (the user removes rows explicitly). `exists` has no value; path only for header/body.
function toAssertion(a: FormValues['assertions'][number]): Assertion {
  const base = { type: a.type, operator: a.operator, ...(needsPath(a.type) ? { path: a.path.trim() } : {}) };
  if (a.operator === 'exists') return base;
  const dataType = effectiveType(a);
  return { ...base, dataType, value: typedValue(a.value, dataType) };
}

function toPayload(data: FormValues): CreateApiRequestData {
  return {
    name: data.name,
    method: data.method,
    endpoint: data.endpoint,
    headers: rowsToRecord(data.headers),
    queryParams: rowsToRecord(data.queryParams),
    ...(data.bodyStr.trim() ? { body: JSON.parse(data.bodyStr) as JsonValue } : {}),
    auth: toAuth(data.auth),
    assertions: data.assertions.map(toAssertion),
  };
}

// ---------- Component ----------

type TabId = 'params' | 'headers' | 'auth' | 'body' | 'assertions';

const TABS: { id: TabId; icon: LucideIcon; label: string; field: keyof FieldErrors<FormValues> }[] = [
  { id: 'params', icon: Settings, label: 'Params', field: 'queryParams' },
  { id: 'headers', icon: Database, label: 'Headers', field: 'headers' },
  { id: 'auth', icon: Shield, label: 'Auth', field: 'auth' },
  { id: 'body', icon: FileJson, label: 'Body', field: 'bodyStr' },
  { id: 'assertions', icon: CheckSquare, label: 'Assertions', field: 'assertions' },
];

const OPERATOR_LABELS: Record<(typeof ASSERTION_OPERATORS)[number], string> = {
  equals: 'Equals (==)',
  not_equals: 'Not Equals (!=)',
  contains: 'Contains',
  exists: 'Exists',
  greater_than: 'Greater Than (>)',
  less_than: 'Less Than (<)',
};

const TYPE_LABELS: Record<(typeof ASSERTION_TYPES)[number], string> = {
  status: 'Status Code',
  responseTime: 'Response Time (ms)',
  body: 'JSON Body',
  header: 'Header',
};

const cell =
  'rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';
const field =
  'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';
const fieldError = 'mt-1 text-xs text-red-500';

interface RequestBuilderFormProps {
  onSubmit: (data: CreateApiRequestData) => Promise<void>;
  onCancel: () => void;
  serverError: string | null;
}

export default function RequestBuilderForm({ onSubmit, onCancel, serverError }: RequestBuilderFormProps) {
  const [activeTab, setActiveTab] = useState<TabId>('params');

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: DEFAULT_VALUES });

  const headerRows = useFieldArray({ control, name: 'headers' });
  const paramRows = useFieldArray({ control, name: 'queryParams' });
  const assertionRows = useFieldArray({ control, name: 'assertions' });

  const authType = watch('auth.type');
  const method = watch('method');
  const assertionValues = watch('assertions');

  const tabsWithErrors = TABS.filter((t) => errors[t.field]);

  const kvEditor = (
    rows: { fields: { id: string }[]; remove: (index: number) => void; append: (row: { key: string; value: string }) => void },
    name: 'headers' | 'queryParams',
    label: string,
    keyPlaceholder: string,
  ) => (
    <div className="space-y-2">
      {rows.fields.map((row, index) => (
        <div key={row.id} className="flex space-x-2">
          <input aria-label={`${label} ${index + 1} name`} placeholder={keyPlaceholder} {...register(`${name}.${index}.key`)} className={`min-w-0 flex-1 font-mono ${cell}`} />
          <input aria-label={`${label} ${index + 1} value`} placeholder="Value" {...register(`${name}.${index}.value`)} className={`min-w-0 flex-1 font-mono ${cell}`} />
          <button
            type="button"
            onClick={() => rows.remove(index)}
            aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
            className="rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-red-500"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => rows.append({ key: '', value: '' })} className="mt-2 text-sm font-medium text-primary hover:underline">
        + Add {label}
      </button>
    </div>
  );

  return (
    <form onSubmit={handleSubmit((data) => onSubmit(toPayload(data)))} className="flex h-full flex-col" noValidate aria-label="New API request">
      {/* Top bar: name, method, endpoint */}
      <div className="space-y-3 border-b border-border bg-sidebar p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="req-name" className="sr-only">Request Name</label>
            <input
              id="req-name"
              placeholder="Request Name (e.g., Get User Profile)"
              {...register('name')}
              aria-invalid={!!errors.name}
              className="w-full max-w-md bg-transparent text-lg font-bold text-foreground placeholder:text-sidebar-foreground/50 focus:outline-none"
              autoComplete="off"
              autoFocus
            />
            {errors.name && <p className={fieldError}>{errors.name.message}</p>}
          </div>
          <div className="flex space-x-2">
            <button type="button" onClick={onCancel} className="rounded-md px-4 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="mr-2 h-4 w-4" aria-hidden="true" />}
              Save Request
            </button>
          </div>
        </div>
        <div>
          <div className="flex rounded-md shadow-sm">
            <label htmlFor="req-method" className="sr-only">Method</label>
            <select
              id="req-method"
              {...register('method')}
              className={`rounded-l-md border border-r-0 border-border bg-background px-3 py-2 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-primary ${METHOD_COLORS[method]}`}
            >
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <label htmlFor="req-endpoint" className="sr-only">Endpoint URL</label>
            <input
              id="req-endpoint"
              placeholder="{{baseUrl}}/v1/users"
              {...register('endpoint')}
              aria-invalid={!!errors.endpoint}
              className="min-w-0 flex-1 rounded-r-md border border-border bg-background px-4 py-2 font-mono text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              autoComplete="off"
            />
          </div>
          {errors.endpoint && <p className={fieldError}>{errors.endpoint.message}</p>}
        </div>
      </div>

      {serverError && (
        <div className="mx-4 mt-4 flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-red-500" role="alert">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{serverError}</span>
        </div>
      )}
      {tabsWithErrors.length > 0 && (
        <p className="mx-4 mt-4 text-sm font-medium text-red-500">
          Fix the errors in: {tabsWithErrors.map((t) => t.label).join(', ')}
        </p>
      )}

      {/* Tabs */}
      <div className="mt-2 flex overflow-x-auto border-b border-border px-4" role="tablist" aria-label="Request sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`flex shrink-0 items-center border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-sidebar-foreground hover:text-foreground'
            }`}
          >
            <tab.icon className="mr-2 h-4 w-4" aria-hidden="true" /> {tab.label}
            {errors[tab.field] && <span className="ml-1.5 h-2 w-2 rounded-full bg-red-500" aria-label="has errors" />}
          </button>
        ))}
      </div>

      <div id={`panel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`} className="flex-1 overflow-y-auto bg-background p-4">
        {activeTab === 'params' && kvEditor(paramRows, 'queryParams', 'Query param', 'Key')}

        {activeTab === 'headers' && kvEditor(headerRows, 'headers', 'Header', 'Header-Key')}

        {activeTab === 'auth' && (
          <div className="max-w-lg space-y-4">
            <p className="text-xs text-sidebar-foreground">
              Use a reference like <code className="font-mono">{'{{API_TOKEN}}'}</code> instead of a real secret.
            </p>
            <div>
              <label htmlFor="auth-type" className="block text-sm font-medium text-foreground">Authorization Type</label>
              <select id="auth-type" {...register('auth.type')} className={field}>
                <option value="none">No Auth</option>
                <option value="bearer">Bearer Token</option>
                <option value="basic">Basic Auth</option>
                <option value="apiKey">API Key</option>
              </select>
            </div>
            {authType === 'bearer' && (
              <div>
                <label htmlFor="auth-token" className="block text-sm font-medium text-foreground">Token</label>
                <input id="auth-token" placeholder="{{API_TOKEN}}" {...register('auth.token')} className={`${field} font-mono`} autoComplete="off" />
                {errors.auth?.token && <p className={fieldError}>{errors.auth.token.message}</p>}
              </div>
            )}
            {authType === 'basic' && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="auth-username" className="block text-sm font-medium text-foreground">Username</label>
                  <input id="auth-username" {...register('auth.username')} className={`${field} font-mono`} autoComplete="off" />
                  {errors.auth?.username && <p className={fieldError}>{errors.auth.username.message}</p>}
                </div>
                <div>
                  <label htmlFor="auth-password" className="block text-sm font-medium text-foreground">Password</label>
                  <input id="auth-password" type="password" placeholder="{{API_PASSWORD}}" {...register('auth.password')} className={`${field} font-mono`} autoComplete="new-password" />
                </div>
              </div>
            )}
            {authType === 'apiKey' && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="auth-key" className="block text-sm font-medium text-foreground">Key</label>
                  <input id="auth-key" placeholder="X-API-Key" {...register('auth.key')} className={`${field} font-mono`} autoComplete="off" />
                  {errors.auth?.key && <p className={fieldError}>{errors.auth.key.message}</p>}
                </div>
                <div>
                  <label htmlFor="auth-value" className="block text-sm font-medium text-foreground">Value</label>
                  <input id="auth-value" placeholder="{{API_KEY}}" {...register('auth.value')} className={`${field} font-mono`} autoComplete="off" />
                  {errors.auth?.value && <p className={fieldError}>{errors.auth.value.message}</p>}
                </div>
                <div>
                  <label htmlFor="auth-in" className="block text-sm font-medium text-foreground">Add to</label>
                  <select id="auth-in" {...register('auth.in')} className={field}>
                    <option value="header">Header</option>
                    <option value="query">Query Params</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'body' && (
          <div className="flex h-full flex-col">
            <label htmlFor="req-body" className="mb-2 text-sm font-semibold text-foreground">JSON Body (Optional)</label>
            <textarea
              id="req-body"
              {...register('bodyStr')}
              aria-invalid={!!errors.bodyStr}
              rows={10}
              className="w-full flex-1 resize-y rounded-md border border-border bg-background px-4 py-3 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
              placeholder={'{\n  "key": "value"\n}'}
              spellCheck={false}
            />
            {errors.bodyStr && <p className={fieldError}>{errors.bodyStr.message}</p>}
          </div>
        )}

        {activeTab === 'assertions' && (
          <div className="space-y-3">
            {assertionRows.fields.map((row, index) => {
              const current = assertionValues[index];
              const rowErrors = errors.assertions?.[index];
              const n = index + 1;
              return (
                <div key={row.id} className="rounded-md border border-border bg-sidebar/50 p-2">
                  <div className="flex flex-wrap items-start gap-2">
                    <select aria-label={`Assertion ${n} type`} {...register(`assertions.${index}.type`)} className={`w-40 ${cell}`}>
                      {ASSERTION_TYPES.map((t) => (
                        <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                      ))}
                    </select>
                    {current && needsPath(current.type) && (
                      <input
                        aria-label={`Assertion ${n} ${current.type === 'body' ? 'JSONPath' : 'header name'}`}
                        placeholder={current.type === 'body' ? '$.user.id' : 'Header Name'}
                        {...register(`assertions.${index}.path`)}
                        className={`w-40 font-mono ${cell}`}
                      />
                    )}
                    <select aria-label={`Assertion ${n} operator`} {...register(`assertions.${index}.operator`)} className={`w-44 ${cell}`}>
                      {ASSERTION_OPERATORS.map((o) => (
                        <option key={o} value={o}>{OPERATOR_LABELS[o]}</option>
                      ))}
                    </select>
                    {/* Value type (API-22). Fixed to Number/String where the API requires it. */}
                    {current?.operator !== 'exists' &&
                      (current && typeIsFixed(current) ? (
                        // Display only (not registered): the API decides the type for these rules.
                        <select aria-label={`Assertion ${n} value type`} disabled value={effectiveType(current)} className={`w-28 opacity-60 ${cell}`}>
                          <option value={effectiveType(current)}>{effectiveType(current) === 'number' ? 'Number' : 'String'}</option>
                        </select>
                      ) : (
                        <select aria-label={`Assertion ${n} value type`} {...register(`assertions.${index}.dataType`)} className={`w-28 ${cell}`}>
                          <option value="string">String</option>
                          <option value="number">Number</option>
                          <option value="boolean">Boolean</option>
                          <option value="null">Null</option>
                        </select>
                      ))}
                    <input
                      aria-label={`Assertion ${n} value`}
                      placeholder={
                        current?.operator === 'exists' || (current && effectiveType(current) === 'null')
                          ? 'No value needed'
                          : current && effectiveType(current) === 'boolean'
                            ? 'true / false'
                            : 'Value'
                      }
                      // readOnly: value not needed for `exists` / null, but the field stays focusable.
                      readOnly={current?.operator === 'exists' || (!!current && effectiveType(current) === 'null')}
                      {...register(`assertions.${index}.value`)}
                      className={`min-w-0 flex-1 font-mono read-only:opacity-50 ${cell}`}
                    />
                    <button
                      type="button"
                      onClick={() => assertionRows.remove(index)}
                      aria-label={`Remove assertion ${n}`}
                      className="rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  {rowErrors?.path && <p className={fieldError}>{`Assertion ${n}: ${rowErrors.path.message}`}</p>}
                  {rowErrors?.value && <p className={fieldError}>{`Assertion ${n}: ${rowErrors.value.message}`}</p>}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => assertionRows.append({ type: 'status', operator: 'equals', value: '', path: '', dataType: 'string' })}
              className="mt-2 text-sm font-medium text-primary hover:underline"
            >
              + Add Assertion
            </button>
          </div>
        )}
      </div>
    </form>
  );
}
