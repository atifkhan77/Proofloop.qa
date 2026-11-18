import { useEffect, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Loader2, AlertCircle, Plus, Trash2 } from 'lucide-react';
import { createTestCase, type TestCase, type CreateTestCaseData } from '@/lib/api/test-cases';
import type { RequirementSummary } from '@/lib/api/requirements';
import { getApiErrorMessage } from '@/lib/api-error';

// Mirrors apps/api/src/validations/test-case.validation.ts (steps have no stepNumber).
const testCaseSchema = z.object({
  tcId: z.string().trim().toUpperCase().min(1, 'Test Case ID is required'),
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().optional(),
  preconditions: z.string().trim().optional(),
  testData: z.string().trim().optional(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  testType: z.enum(['UI', 'API', 'DATABASE', 'REGRESSION', 'FUNCTIONAL', 'SECURITY']),
  automationStatus: z.enum(['MANUAL', 'AUTOMATED', 'IN_PROGRESS']),
  requirementId: z.string().optional(),
  steps: z.array(
    z.object({
      action: z.string().trim().min(1, 'Action is required'),
      expectedResult: z.string().trim().min(1, 'Expected result is required'),
    }),
  ),
});

type TestCaseForm = z.infer<typeof testCaseSchema>;

interface CreateTestCaseModalProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (testCase: TestCase) => void;
  requirements: RequirementSummary[];
}

const inputClass =
  'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';
const stepInputClass =
  'block w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-sm text-foreground focus:border-primary focus:bg-sidebar focus:outline-none focus:ring-1 focus:ring-primary';

const DEFAULTS: TestCaseForm = {
  tcId: '',
  title: '',
  description: '',
  preconditions: '',
  testData: '',
  priority: 'MEDIUM',
  testType: 'FUNCTIONAL',
  automationStatus: 'MANUAL',
  requirementId: '',
  steps: [{ action: '', expectedResult: '' }],
};

export default function CreateTestCaseModal({ projectId, isOpen, onClose, onSuccess, requirements }: CreateTestCaseModalProps) {
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TestCaseForm>({
    resolver: zodResolver(testCaseSchema),
    defaultValues: DEFAULTS,
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'steps' });

  // Every exit path resets form + server error.
  const close = () => {
    reset(DEFAULTS);
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

  const onSubmit = async (data: TestCaseForm) => {
    try {
      setServerError(null);
      // Drop empty optional fields instead of sending "".
      const payload: CreateTestCaseData = {
        ...data,
        description: data.description || undefined,
        preconditions: data.preconditions || undefined,
        testData: data.testData || undefined,
        requirementId: data.requirementId || undefined,
      };
      const created = await createTestCase(projectId, payload);
      // POST response has no requirement summary; attach it so the table renders immediately.
      const req = payload.requirementId ? requirements.find((r) => r.id === payload.requirementId) : undefined;
      onSuccess(req ? { ...created, requirement: { reqId: req.reqId, title: req.title } } : created);
      close();
    } catch (error) {
      setServerError(getApiErrorMessage(error, 'Failed to create test case'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-tc-title"
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-sidebar p-6 shadow-lg"
      >
        <div className="mb-5 flex items-center justify-between border-b border-border pb-4">
          <h2 id="create-tc-title" className="text-xl font-semibold text-foreground">Design Test Case</h2>
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

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Metadata */}
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="tc-id" className="block text-sm font-medium text-foreground">Test Case ID</label>
                  <input id="tc-id" placeholder="e.g., TC-001" {...register('tcId')} aria-invalid={!!errors.tcId} className={inputClass} autoComplete="off" autoFocus />
                  {errors.tcId && <p className="mt-1 text-xs text-red-500">{errors.tcId.message}</p>}
                </div>
                <div>
                  <label htmlFor="tc-req" className="block text-sm font-medium text-foreground">Link Requirement (Optional)</label>
                  <select id="tc-req" {...register('requirementId')} className={inputClass}>
                    <option value="">-- Standalone Test --</option>
                    {requirements.map((req) => (
                      <option key={req.id} value={req.id}>
                        {req.reqId}: {req.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="tc-title" className="block text-sm font-medium text-foreground">Title</label>
                <input id="tc-title" {...register('title')} aria-invalid={!!errors.title} className={inputClass} autoComplete="off" />
                {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title.message}</p>}
              </div>

              <div>
                <label htmlFor="tc-description" className="block text-sm font-medium text-foreground">Description (Optional)</label>
                <textarea
                  id="tc-description"
                  {...register('description')}
                  rows={2}
                  className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                />
              </div>

              <div>
                <label htmlFor="tc-testData" className="block text-sm font-medium text-foreground">Test Data (Optional)</label>
                <textarea
                  id="tc-testData"
                  {...register('testData')}
                  rows={2}
                  placeholder="e.g., user@example.com, ValidPassword123"
                  className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="tc-type" className="block text-sm font-medium text-foreground">Type</label>
                  <select id="tc-type" {...register('testType')} className={inputClass}>
                    <option value="FUNCTIONAL">Functional</option>
                    <option value="UI">UI</option>
                    <option value="API">API</option>
                    <option value="DATABASE">Database</option>
                    <option value="REGRESSION">Regression</option>
                    <option value="SECURITY">Security</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="tc-priority" className="block text-sm font-medium text-foreground">Priority</label>
                  <select id="tc-priority" {...register('priority')} className={inputClass}>
                    <option value="HIGH">High</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="LOW">Low</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="tc-automation" className="block text-sm font-medium text-foreground">Automation</label>
                  <select id="tc-automation" {...register('automationStatus')} className={inputClass}>
                    <option value="MANUAL">Manual</option>
                    <option value="IN_PROGRESS">In Progress</option>
                    <option value="AUTOMATED">Automated</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="tc-preconditions" className="block text-sm font-medium text-foreground">Preconditions (Optional)</label>
                <textarea id="tc-preconditions" {...register('preconditions')} rows={2} className={`${inputClass} resize-none`} />
              </div>
            </div>

            {/* Execution steps (numbered by position; server assigns the same 1..n) */}
            <div className="flex h-full flex-col space-y-4 md:border-l md:border-border md:pl-6">
              <div className="flex items-center justify-between">
                <span className="block text-sm font-semibold text-foreground">Execution Steps</span>
                <button
                  type="button"
                  onClick={() => append({ action: '', expectedResult: '' })}
                  className="flex items-center text-xs font-medium text-primary transition-colors hover:text-primary/80"
                >
                  <Plus className="mr-1 h-3 w-3" /> Add Step
                </button>
              </div>

              <ol className="max-h-[50vh] flex-1 space-y-3 overflow-y-auto pr-2" aria-label="Execution steps">
                {fields.map((field, index) => {
                  const stepErrors = errors.steps?.[index];
                  return (
                    <li key={field.id} className="relative rounded-lg border border-border bg-background p-3 pl-8 shadow-sm">
                      <span
                        aria-hidden="true"
                        className="absolute left-2 top-3 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-sidebar-accent text-xs font-bold text-foreground"
                      >
                        {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        aria-label={`Remove step ${index + 1}`}
                        className="absolute right-2 top-2 text-sidebar-foreground transition-colors hover:text-red-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <div className="mt-1 space-y-2 pr-6">
                        <div>
                          <input
                            aria-label={`Step ${index + 1} action`}
                            placeholder="Action to perform..."
                            {...register(`steps.${index}.action`)}
                            aria-invalid={!!stepErrors?.action}
                            className={stepInputClass}
                          />
                          {stepErrors?.action && <p className="text-xs text-red-500">{stepErrors.action.message}</p>}
                        </div>
                        <div className="border-t border-border/50 pt-2">
                          <input
                            aria-label={`Step ${index + 1} expected result`}
                            placeholder="Expected result..."
                            {...register(`steps.${index}.expectedResult`)}
                            aria-invalid={!!stepErrors?.expectedResult}
                            className={stepInputClass}
                          />
                          {stepErrors?.expectedResult && <p className="text-xs text-red-500">{stepErrors.expectedResult.message}</p>}
                        </div>
                      </div>
                    </li>
                  );
                })}
                {fields.length === 0 && (
                  <li className="py-6 text-center text-sm italic text-sidebar-foreground">No execution steps defined.</li>
                )}
              </ol>
            </div>
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
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Save Test Case
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
