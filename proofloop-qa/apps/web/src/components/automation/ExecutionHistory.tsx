import { useState } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import ExecutionDetails from './ExecutionDetails';
import type { AutomationExecution, ExecutionStatus } from '@/lib/api/automation';

const STATUS_BADGE: Record<ExecutionStatus, string> = {
  PENDING: 'bg-yellow-500/10 text-yellow-500',
  RUNNING: 'bg-blue-500/10 text-blue-500',
  PASSED: 'bg-green-500/10 text-green-500',
  FAILED: 'bg-red-500/10 text-red-500',
  CANCELLED: 'bg-sidebar-accent text-sidebar-foreground',
};

const FINISHED: ExecutionStatus[] = ['PASSED', 'FAILED'];

interface ExecutionHistoryProps {
  /** Used for the accessible list name, e.g. "Run history for E2E Suite". */
  automationProjectName: string;
  executions: AutomationExecution[] | undefined; // undefined = not loaded yet
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
}

function duration(run: AutomationExecution): string | null {
  if (!run.startTime || !run.endTime) return null;
  const seconds = Math.round((new Date(run.endTime).getTime() - new Date(run.startTime).getTime()) / 1000);
  return `${seconds}s`;
}

/** Recent runs of one automation project (API returns newest first, max 50). */
export default function ExecutionHistory({ automationProjectName, executions, isLoading, error, onRefresh }: ExecutionHistoryProps) {
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const toolbar = (
    <div className="mb-2 flex justify-end">
      <button
        type="button"
        onClick={onRefresh}
        disabled={isLoading}
        aria-label={`Refresh run history for ${automationProjectName}`}
        className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-sidebar-foreground hover:bg-sidebar-accent disabled:opacity-50"
      >
        <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
      </button>
    </div>
  );

  if (isLoading && !executions) {
    return (
      <div className="flex justify-center py-4" role="status" aria-label="Loading run history">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <>
        {toolbar}
        <div className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-red-500" role="alert">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      </>
    );
  }

  if (!executions || executions.length === 0) {
    return (
      <>
        {toolbar}
        <p className="py-3 text-center text-sm text-sidebar-foreground">No runs yet.</p>
      </>
    );
  }

  return (
    <>
      {toolbar}
      <ul className="divide-y divide-border rounded-lg border border-border" aria-label={`Run history for ${automationProjectName}`}>
        {executions.map((run) => {
          const took = duration(run);
          return (
            <li key={run.id} className="px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold text-foreground">{run.runId}</span>
                <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[run.status]}`}>{run.status}</span>
                {FINISHED.includes(run.status) && (
                  <span className="text-xs text-sidebar-foreground">
                    {run.passedCount} passed · {run.failedCount} failed · {run.skippedCount} skipped
                    {took && ` · ${took}`}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-sidebar-foreground">
                <span>{run.projectEnvironment?.name ?? 'No environment'}</span>
                <span>{run.trigger.replace('_', '/')}</span>
                <time dateTime={run.createdAt}>{new Date(run.createdAt).toLocaleString()}</time>
                {FINISHED.includes(run.status) && (
                  <button
                    type="button"
                    onClick={() => setOpenRunId(openRunId === run.id ? null : run.id)}
                    aria-expanded={openRunId === run.id}
                    className="font-medium text-primary hover:underline"
                  >
                    {openRunId === run.id ? 'Hide details' : 'Details'}
                  </button>
                )}
              </div>
              </div>
              {openRunId === run.id && (
                <div className="mt-2">
                  <ExecutionDetails executionId={run.id} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
