import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { X, PlayCircle, Loader2, AlertCircle } from 'lucide-react';
import { executeApiRequest, type ApiExecution } from '@/lib/api/api-intelligence';
import type { Environment } from '@/lib/api/automation';
import { getApiErrorMessage } from '@/lib/api-error';

interface RunForm {
  environmentId: string; // '' = no environment
}

interface RunRequestModalProps {
  /** Request to run; null = closed. */
  target: { id: string; name: string; endpoint: string } | null;
  environments: Environment[];
  /** Environments could not be loaded (the run still works without one). */
  environmentsFailed?: boolean;
  onClose: () => void;
  onExecuted: (execution: ApiExecution) => void;
}

const usesBaseUrl = (endpoint: string) => /\{\{\s*baseUrl\s*\}\}/.test(endpoint);

export default function RunRequestModal({ target, environments, environmentsFailed = false, onClose, onExecuted }: RunRequestModalProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<RunForm>({ defaultValues: { environmentId: '' } });

  const close = () => {
    reset();
    setServerError(null);
    onClose();
  };

  // Close on Escape.
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!target) return null;

  const onSubmit = async ({ environmentId }: RunForm) => {
    try {
      setServerError(null);
      const execution = await executeApiRequest(target.id, { environmentId: environmentId || undefined });
      onExecuted(execution);
      close();
    } catch (error) {
      setServerError(getApiErrorMessage(error, 'Failed to run request'));
    }
  };

  const needsBaseUrl = usesBaseUrl(target.endpoint);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-modal-title"
        className="w-full max-w-md rounded-xl border border-border bg-sidebar p-6 shadow-lg"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="run-modal-title" className="truncate text-lg font-semibold text-foreground">Run: {target.name}</h2>
          <button type="button" onClick={close} aria-label="Close" className="rounded-full p-1 text-sidebar-foreground hover:bg-sidebar-accent">
            <X className="h-5 w-5" />
          </button>
        </div>

        {serverError && (
          <div className="mb-4 flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-red-500" role="alert">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="text-sm font-medium">{serverError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div>
            <label htmlFor="run-env" className="block text-sm font-medium text-foreground">Environment</label>
            <select
              id="run-env"
              {...register('environmentId')}
              className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">-- No Environment --</option>
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                  {env.baseUrl ? ` (${env.baseUrl})` : ' (no base URL)'}
                </option>
              ))}
            </select>
            {/* Accurate to the backend (API-23): utils/variables.ts. */}
            <p className="mt-1 text-xs text-sidebar-foreground">
              <code className="font-mono">{'{{baseUrl}}'}</code> and the environment&apos;s variables are substituted.
              Secret variables are only sent to the environment&apos;s base URL host.
            </p>
            {environmentsFailed && (
              <p className="mt-1 text-xs text-yellow-500">Environments could not be loaded.</p>
            )}
            {needsBaseUrl && !environmentsFailed && environments.length === 0 && (
              <p className="mt-1 text-xs text-yellow-500">
                This endpoint uses {'{{baseUrl}}'}, but the project has no environments. Add one in the Automation Lab.
              </p>
            )}
          </div>

          <div className="mt-6 flex justify-end space-x-3 border-t border-border pt-4">
            <button type="button" onClick={close} className="rounded-md px-4 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <PlayCircle className="mr-2 h-4 w-4" aria-hidden="true" />}
              Send Request
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
