import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { createRisk, type Risk } from '@/lib/api/risks';
import { getApiErrorMessage } from '@/lib/api-error';

// Mirrors apps/api/src/validations/risk.validation.ts (+ requirement picker).
const riskSchema = z.object({
  requirementId: z.string().min(1, 'Please select a requirement'),
  title: z.string().trim().min(1, 'Risk title is required'),
  description: z.string().trim().min(1, 'Risk description is required'),
  // valueAsNumber on the inputs: empty -> NaN, which z.number() rejects.
  probability: z
    .number({ invalid_type_error: 'Probability is required' })
    .int('Must be a whole number')
    .min(1, 'Probability must be at least 1')
    .max(5, 'Probability cannot exceed 5'),
  impact: z
    .number({ invalid_type_error: 'Impact is required' })
    .int('Must be a whole number')
    .min(1, 'Impact must be at least 1')
    .max(5, 'Impact cannot exceed 5'),
  mitigation: z.string().trim().optional(),
});

type RiskForm = z.infer<typeof riskSchema>;

export interface RequirementOption {
  id: string;
  reqId: string;
  title: string;
}

interface CreateRiskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (risk: Risk) => void;
  requirements: RequirementOption[];
}

const inputClass =
  'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export default function CreateRiskModal({ isOpen, onClose, onSuccess, requirements }: CreateRiskModalProps) {
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RiskForm>({
    resolver: zodResolver(riskSchema),
    defaultValues: { requirementId: '', probability: 3, impact: 3 },
  });

  // Every exit path resets form + server error.
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

  const onSubmit = async ({ requirementId, ...riskData }: RiskForm) => {
    try {
      setServerError(null);
      const newRisk = await createRisk(requirementId, riskData);
      // POST response has no requirement summary; attach it so the table renders immediately.
      const selected = requirements.find((r) => r.id === requirementId);
      onSuccess(selected ? { ...newRisk, requirement: { reqId: selected.reqId, title: selected.title } } : newRisk);
      close();
    } catch (error) {
      setServerError(getApiErrorMessage(error, 'Failed to create risk'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-risk-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-sidebar p-6 shadow-lg"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="create-risk-title" className="text-xl font-semibold text-foreground">Log New Risk</h2>
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
            <label htmlFor="risk-req" className="block text-sm font-medium text-foreground">Target Requirement</label>
            <select id="risk-req" {...register('requirementId')} aria-invalid={!!errors.requirementId} className={inputClass}>
              <option value="">-- Select a Requirement --</option>
              {requirements.map((req) => (
                <option key={req.id} value={req.id}>
                  {req.reqId}: {req.title}
                </option>
              ))}
            </select>
            {errors.requirementId && <p className="mt-1 text-xs text-red-500">{errors.requirementId.message}</p>}
            {requirements.length === 0 && (
              <p className="mt-1 text-xs text-sidebar-foreground">
                This project has no requirements yet. Add a requirement to a module first.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="risk-title" className="block text-sm font-medium text-foreground">Risk Title</label>
            <input id="risk-title" {...register('title')} aria-invalid={!!errors.title} className={inputClass} autoComplete="off" />
            {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title.message}</p>}
          </div>

          <div>
            <label htmlFor="risk-desc" className="block text-sm font-medium text-foreground">Description &amp; Impact</label>
            <textarea id="risk-desc" {...register('description')} aria-invalid={!!errors.description} rows={3} className={`${inputClass} resize-none`} />
            {errors.description && <p className="mt-1 text-xs text-red-500">{errors.description.message}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="risk-prob" className="block text-sm font-medium text-foreground">Probability (1-5)</label>
              <input
                id="risk-prob"
                type="number"
                min={1}
                max={5}
                step={1}
                {...register('probability', { valueAsNumber: true })}
                aria-invalid={!!errors.probability}
                className={inputClass}
              />
              {errors.probability && <p className="mt-1 text-xs text-red-500">{errors.probability.message}</p>}
            </div>

            <div>
              <label htmlFor="risk-imp" className="block text-sm font-medium text-foreground">Impact (1-5)</label>
              <input
                id="risk-imp"
                type="number"
                min={1}
                max={5}
                step={1}
                {...register('impact', { valueAsNumber: true })}
                aria-invalid={!!errors.impact}
                className={inputClass}
              />
              {errors.impact && <p className="mt-1 text-xs text-red-500">{errors.impact.message}</p>}
            </div>
          </div>

          <div>
            <label htmlFor="risk-mitigation" className="block text-sm font-medium text-foreground">Mitigation Strategy (Optional)</label>
            <textarea id="risk-mitigation" {...register('mitigation')} rows={2} className={`${inputClass} resize-none`} />
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button type="button" onClick={close} className="rounded-md px-4 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || requirements.length === 0}
              className="flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Log Risk
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
