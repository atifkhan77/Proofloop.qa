import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2, XCircle, MinusCircle, AlertTriangle } from 'lucide-react';
import { getAutomationExecution, type AutomationExecution, type ExecutionTestResult } from '@/lib/api/automation';
import { getApiErrorMessage } from '@/lib/api-error';

const RESULT_ICON: Record<ExecutionTestResult['status'], { icon: typeof CheckCircle2; className: string; label: string }> = {
  passed: { icon: CheckCircle2, className: 'text-green-500', label: 'Passed' },
  flaky: { icon: AlertTriangle, className: 'text-yellow-500', label: 'Flaky (passed on retry)' },
  failed: { icon: XCircle, className: 'text-red-500', label: 'Failed' },
  skipped: { icon: MinusCircle, className: 'text-sidebar-foreground', label: 'Skipped' },
};

/** Per-test results and console log of one finished run (loaded on demand). */
export default function ExecutionDetails({ executionId }: { executionId: string }) {
  const [execution, setExecution] = useState<AutomationExecution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAutomationExecution(executionId)
      .then((e) => !cancelled && setExecution(e))
      .catch((err) => !cancelled && setError(getApiErrorMessage(err, 'Failed to load run details')));
    return () => {
      cancelled = true;
    };
  }, [executionId]);

  if (error) {
    return (
      <div className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-2 text-red-500" role="alert">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span className="text-xs font-medium">{error}</span>
      </div>
    );
  }

  if (!execution) {
    return (
      <div className="flex justify-center py-2" role="status" aria-label="Loading run details">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      </div>
    );
  }

  // Failures first: they are what the reader opened the run for.
  const order = { failed: 0, flaky: 1, passed: 2, skipped: 3 } as const;
  const results = [...(execution.results ?? [])].sort((a, b) => order[a.status] - order[b.status]);

  return (
    <div className="space-y-2">
      {results.length === 0 ? (
        <p className="text-xs text-sidebar-foreground">No test results recorded. See the log for what happened.</p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto" aria-label="Test results">
          {results.map((r, i) => {
            const { icon: Icon, className, label } = RESULT_ICON[r.status];
            return (
              <li key={`${r.file}-${r.title}-${r.project}-${i}`} className="rounded-md bg-background/60 px-2 py-1.5 text-xs">
                <div className="flex items-start gap-2">
                  <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${className}`} aria-label={label} />
                  <div className="min-w-0 flex-1">
                    <span className="text-foreground">{r.title}</span>
                    <span className="ml-2 font-mono text-sidebar-foreground">
                      {r.file}
                      {r.project && ` [${r.project}]`} · {(r.durationMs / 1000).toFixed(1)}s
                    </span>
                    {r.error && <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-red-400">{r.error}</pre>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {execution.logs && (
        <div>
          <button type="button" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog} className="text-xs font-medium text-primary hover:underline">
            {showLog ? 'Hide console log' : 'Show console log'}
          </button>
          {showLog && (
            <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2 font-mono text-[11px] text-sidebar-foreground">
              {execution.logs}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
