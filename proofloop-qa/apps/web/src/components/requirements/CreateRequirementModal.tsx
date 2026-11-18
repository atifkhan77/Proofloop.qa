import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { createRequirement, type Requirement, type CreateRequirementData } from '@/lib/api/requirements';
import { getApiErrorMessage } from '@/lib/api-error';

// Mirrors apps/api/src/validations/requirement.validation.ts.
const requirementSchema = z.object({
  reqId: z.string().trim().toUpperCase().min(1, 'Requirement ID is required'),
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().min(1, 'Description is required'),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  businessCriticality: z.enum(['CRITICAL', 'HIGH', 'MODERATE', 'LOW']),
});

interface CreateRequirementModalProps {
  moduleId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (requirement: Requirement) => void;
}

const inputClass =
  'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export default function CreateRequirementModal({ moduleId, isOpen, onClose, onSuccess }: CreateRequirementModalProps) {
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateRequirementData>({
    resolver: zodResolver(requirementSchema),
    defaultValues: {
      priority: 'MEDIUM',
      businessCriticality: 'MODERATE',
    },
  });

  // Every exit path (X, Cancel, Escape, success) resets form and server error.
  const close = () => {
    reset();
    setServerError(null);
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!isOpen) return null;

  const onSubmit = async (data: CreateRequirementData) => {
    try {
      setServerError(null);
      const newRequirement = await createRequirement(moduleId, data);
      onSuccess(newRequirement);
      close();
    } catch (error) {
      // 409 → "A requirement with this ID already exists in this project"
      setServerError(getApiErrorMessage(error, 'Failed to create requirement'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-requirement-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-sidebar p-6 shadow-lg"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="create-requirement-title" className="text-xl font-semibold text-foreground">Create New Requirement</h2>
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="req-id" className="block text-sm font-medium text-foreground">Requirement ID</label>
              <input
                id="req-id"
                placeholder="e.g., REQ-001"
                {...register('reqId')}
                aria-invalid={!!errors.reqId}
                className={inputClass}
                autoComplete="off"
                autoFocus
              />
              {errors.reqId && <p className="mt-1 text-xs text-red-500">{errors.reqId.message}</p>}
            </div>

            <div>
              <label htmlFor="req-title" className="block text-sm font-medium text-foreground">Title</label>
              <input
                id="req-title"
                placeholder="Brief summary"
                {...register('title')}
                aria-invalid={!!errors.title}
                className={inputClass}
                autoComplete="off"
              />
              {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title.message}</p>}
            </div>
          </div>

          <div>
            <label htmlFor="req-description" className="block text-sm font-medium text-foreground">Detailed Description</label>
            <textarea
              id="req-description"
              {...register('description')}
              aria-invalid={!!errors.description}
              rows={4}
              className={`${inputClass} resize-none`}
            />
            {errors.description && <p className="mt-1 text-xs text-red-500">{errors.description.message}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="req-priority" className="block text-sm font-medium text-foreground">Priority</label>
              <select id="req-priority" {...register('priority')} className={inputClass}>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
              {errors.priority && <p className="mt-1 text-xs text-red-500">{errors.priority.message}</p>}
            </div>

            <div>
              <label htmlFor="req-criticality" className="block text-sm font-medium text-foreground">Business Criticality</label>
              <select id="req-criticality" {...register('businessCriticality')} className={inputClass}>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MODERATE">Moderate</option>
                <option value="LOW">Low</option>
              </select>
              {errors.businessCriticality && <p className="mt-1 text-xs text-red-500">{errors.businessCriticality.message}</p>}
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
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
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Create Requirement
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
