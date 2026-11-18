import { CheckSquare, Database, Settings, Shield, FileJson, PlayCircle, Loader2 } from 'lucide-react';
import type { ApiRequest, AuthConfig } from '@/lib/api/api-intelligence';
import { METHOD_COLORS } from './method-colors';

/** Type label for rules saved before API-22 (no dataType stored). */
const inferType = (v: unknown) => (v === null ? 'null' : typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string');

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Database; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-3 flex items-center text-sm font-semibold text-foreground">
        <Icon className="mr-2 h-4 w-4" aria-hidden="true" /> {title}
      </h3>
      {children}
    </section>
  );
}

function KeyValueTable({ values }: { values: Record<string, string> }) {
  return (
    <dl className="rounded-lg border border-border bg-sidebar p-3">
      {Object.entries(values).map(([key, val]) => (
        <div key={key} className="flex justify-between gap-4 border-b border-border/50 py-1 font-mono text-sm last:border-0">
          <dt className="text-sidebar-foreground">{key}</dt>
          <dd className="break-all font-semibold text-foreground">{val}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Non-secret auth summary: secret fields (token/password/value) are never rendered. */
function authSummary(auth: AuthConfig): string {
  switch (auth.type) {
    case 'bearer':
      return 'Bearer Token';
    case 'basic':
      return `Basic Auth (user: ${auth.username})`;
    case 'apiKey':
      return `API Key "${auth.key}" in ${auth.in}`;
    default:
      return 'No Auth';
  }
}

const hasEntries = (r: Record<string, string> | null): r is Record<string, string> => !!r && Object.keys(r).length > 0;

interface RequestDetailsProps {
  request: ApiRequest;
  /** Omitted for roles that cannot execute (VIEWER). */
  onRun?: () => void;
  isRunning?: boolean;
}

export default function RequestDetails({ request, onRun, isRunning = false }: RequestDetailsProps) {
  return (
    <article aria-labelledby="request-title" className="p-6">
      <div className="mb-6 flex items-center space-x-3">
        <span className={`text-lg font-bold ${METHOD_COLORS[request.method]}`}>{request.method}</span>
        <h2 id="request-title" className="text-xl font-bold text-foreground">{request.name}</h2>
      </div>

      <div className="mb-6 break-all rounded-lg border border-border bg-sidebar p-4 font-mono text-sm text-foreground">
        {request.endpoint}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {hasEntries(request.queryParams) && (
          <Section title="Query Parameters" icon={Settings}>
            <KeyValueTable values={request.queryParams} />
          </Section>
        )}

        {hasEntries(request.headers) && (
          <Section title="Headers" icon={Database}>
            <KeyValueTable values={request.headers} />
          </Section>
        )}

        <Section title="Auth" icon={Shield}>
          <p className="rounded-lg border border-border bg-sidebar p-3 text-sm text-foreground">
            {request.auth ? authSummary(request.auth) : 'No Auth'}
          </p>
        </Section>

        {request.assertions && request.assertions.length > 0 && (
          <Section title="Assertions" icon={CheckSquare}>
            <ul className="space-y-2 rounded-lg border border-border bg-sidebar p-3">
              {request.assertions.map((a, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded border border-border bg-background p-2 font-mono text-sm">
                  <span className="font-bold text-primary">{a.type}</span>
                  {a.path && <span className="text-sidebar-foreground">{a.path}</span>}
                  <span className="italic text-foreground">{a.operator.replace('_', ' ')}</span>
                  {/* JSON form: "false" (text) and false (boolean) look different. */}
                  {a.operator !== 'exists' && a.value !== undefined && <span className="font-bold text-green-500">{JSON.stringify(a.value)}</span>}
                  {a.operator !== 'exists' && (
                    <span className="text-xs text-sidebar-foreground">({a.dataType ?? inferType(a.value)})</span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {request.body !== null && (
          <Section title="Body" icon={FileJson}>
            <pre className="overflow-x-auto rounded-lg border border-border bg-sidebar p-3 font-mono text-sm text-foreground">
              {JSON.stringify(request.body, null, 2)}
            </pre>
          </Section>
        )}
      </div>

      {onRun && (
        <div className="mt-8 flex justify-end border-t border-border pt-4">
          <button
            type="button"
            onClick={onRun}
            disabled={isRunning}
            className="flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <PlayCircle className="mr-2 h-4 w-4" aria-hidden="true" />}
            {isRunning ? 'Executing...' : 'Run Request'}
          </button>
        </div>
      )}
    </article>
  );
}
