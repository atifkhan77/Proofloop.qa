import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { createModule, type Module } from '@/lib/api/projects';
import { getApiErrorMessage } from '@/lib/api-error';

// Mirrors apps/api/src/validations/project.validation.ts → createModuleSchema.
const moduleSchema = z.object({
  name: z.string().trim().min(1, 'Module name is required'),
  description: z.string().trim().optional(),
});

type ModuleForm = z.infer<typeof moduleSchema>;

interface CreateModuleModalProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (module: Module) => void;
}

const inputClass =
  'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export default function CreateModuleModal({ projectId, isOpen, onClose, onSuccess }: CreateModuleModalProps) {
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ModuleForm>({
    resolver: zodResolver(moduleSchema),
  });

  const close = () => {
    reset();
    setServerError(null);
    onClose();
  };

  // Close on Escape.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!isOpen) return null;

  const onSubmit = async (data: ModuleForm) => {
    try {
      setServerError(null);
      const newModule = await createModule(projectId, data);
      onSuccess(newModule);
      close();
    } catch (error) {
      // 409 duplicate name → "A module with this name already exists in this project"
      setServerError(getApiErrorMessage(error, 'Failed to create module'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-module-title"
        className="w-full max-w-md rounded-xl border border-border bg-sidebar p-6 shadow-lg"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="create-module-title" className="text-xl font-semibold text-foreground">Create New Module</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded-full p-1 text-sidebar-foreground hover:bg-sidebar-accent"
          >
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
            <label htmlFor="module-name" className="block text-sm font-medium text-foreground">Module Name</label>
            <input
              id="module-name"
              {...register('name')}
              aria-invalid={!!errors.name}
              className={inputClass}
              autoComplete="off"
              autoFocus
            />
            {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
          </div>

          <div>
            <label htmlFor="module-description" className="block text-sm font-medium text-foreground">Description (Optional)</label>
            <textarea id="module-description" {...register('description')} rows={3} className={`${inputClass} resize-none`} />
          </div>

          <div className="flex justify-end space-x-3 pt-2">
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
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Create Module
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
