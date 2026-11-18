import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { X, Loader2, AlertCircle, PlayCircle } from 'lucide-react';
import { triggerExecution, type AutomationExecution, type Environment } from '@/lib/api/automation';
import { getApiErrorMessage } from '@/lib/api-error';

interface TriggerForm {
  environmentId: string; // '' = no environment
}

interface TriggerExecutionModalProps {
  /** Automation project to run; null = closed. */
  target: { id: string; name: string } | null;
  onClose: () => void;
  onSuccess: (execution: AutomationExecution) => void;
  environments: Environment[];
}

const inputClass =
  'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export default function TriggerExecutionModal({ target, onClose, onSuccess, environments }: TriggerExecutionModalProps) {
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<TriggerForm>({ defaultValues: { environmentId: '' } });

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

  const onSubmit = async ({ environmentId }: TriggerForm) => {
    try {
      setServerError(null);
      const execution = await triggerExecution(target.id, {
        environmentId: environmentId || undefined, // omit -> stored as null
        trigger: 'MANUAL',
      });
      // POST response has no projectEnvironment; add the name for display (copy, no mutation).
      const env = environments.find((e) => e.id === execution.environmentId);
      onSuccess(env ? { ...execution, projectEnvironment: { name: env.name } } : execution);
      close();
    } catch (error) {
      setServerError(getApiErrorMessage(error, 'Failed to trigger execution'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trigger-modal-title"
        className="w-full max-w-md rounded-xl border border-border bg-sidebar p-6 shadow-lg"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="trigger-modal-title" className="text-xl font-semibold text-foreground">Trigger Execution</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded-full p-1 text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-6 text-sm text-sidebar-foreground">
          You are about to run tests for <span className="font-semibold text-foreground">{target.name}</span>.
        </p>

        {serverError && (
          <div className="mb-4 flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-red-500" role="alert">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="text-sm font-medium">{serverError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div>
            <label htmlFor="trigger-env" className="block text-sm font-medium text-foreground">Target Environment (Optional)</label>
            <select id="trigger-env" {...register('environmentId')} className={inputClass}>
              <option value="">-- No Environment --</option>
              {environments.map((env) => (
                <option key={env.id} value={env.id}>{env.name}</option>
              ))}
            </select>
            {environments.length === 0 && (
              <p className="mt-1 text-xs text-sidebar-foreground">No environments configured. Add them under Environments.</p>
            )}
          </div>

          <div className="mt-6 flex justify-end space-x-3 border-t border-border pt-4">
            <button
              type="button"
              onClick={close}
              className="rounded-md px-4 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <PlayCircle className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              Start Run
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
