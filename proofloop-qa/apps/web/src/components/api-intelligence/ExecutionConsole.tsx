import { Activity, Clock, Loader2 } from 'lucide-react';
import type { ApiExecution } from '@/lib/api/api-intelligence';

/** Text for the response pane: strings as-is (HTML, plain text), everything else as JSON. */
const bodyText = (body: ApiExecution['responseBody']) =>
  typeof body === 'string' ? body : JSON.stringify(body, null, 2);

const statusClass = (code: number) =>
  code >= 200 && code < 300 ? 'text-green-500' : code >= 400 ? 'text-red-500' : 'text-yellow-500';

/** Result of the latest run of the selected request (theme-aware, both light and dark). */
export default function ExecutionConsole({ execution }: { execution: ApiExecution }) {
  const pending = execution.status === 'PENDING';
  const hasBody = execution.responseBody !== null && execution.responseBody !== undefined;

  return (
    <section aria-label="Response Output" className="flex min-h-[250px] flex-col border-t-4 border-sidebar-accent bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-sidebar p-3">
        <h3 className="flex items-center text-sm font-bold text-foreground">
          <Activity className="mr-2 h-4 w-4 text-primary" aria-hidden="true" /> Response Output
        </h3>
        {!pending && (
          <dl className="flex flex-wrap gap-x-4 font-mono text-xs font-bold">
            <div className="flex gap-1">
              <dt className="sr-only">Result</dt>
              <dd className={execution.status === 'PASSED' ? 'text-green-500' : 'text-red-500'}>{execution.status}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-sidebar-foreground">HTTP</dt>
              <dd className={execution.statusCode ? statusClass(execution.statusCode) : 'text-red-500'}>
                {execution.statusCode || 'No response'}
              </dd>
            </div>
            <div className="flex items-center gap-1 text-sidebar-foreground">
              <Clock className="h-3 w-3" aria-hidden="true" />
              <dt className="sr-only">Time</dt>
              <dd>{execution.responseTime} ms</dd>
            </div>
            {execution.environment && (
              <div className="flex gap-1 text-sidebar-foreground">
                <dt>ENV</dt>
                <dd>{execution.environment.name}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-auto bg-sidebar/40 p-4 font-mono text-sm text-foreground">
        {pending ? (
          <div className="flex h-full items-center justify-center text-sidebar-foreground" role="status">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" /> Waiting for result...
          </div>
        ) : (
          <>
            {/* Shown together: on an assertion failure the body is what explains it. */}
            {execution.errorMessage && (
              <p className="whitespace-pre-wrap text-red-500" role="alert">{execution.errorMessage}</p>
            )}
            {hasBody ? (
              <pre aria-label="Response body" className="whitespace-pre-wrap break-all">{bodyText(execution.responseBody)}</pre>
            ) : (
              !execution.errorMessage && <p className="text-sidebar-foreground">Empty response body.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
