import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Loader2, AlertCircle, Bug } from 'lucide-react';
import {
  createDefect,
  updateDefect,
  DEFECT_SEVERITIES,
  DEFECT_STATUSES,
  type Defect,
} from '@/lib/api/defects';
import { getProjectTestCases, type TestCase } from '@/lib/api/test-cases';
import { getProjectMembers, type ProjectMember } from '@/lib/api/projects';
import { getApiErrorMessage } from '@/lib/api-error';

// Mirrors apps/api/src/validations/defect.validation.ts.
const defectSchema = z.object({
  bugId: z.string().trim().toUpperCase().min(1, 'Bug ID is required'),
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().min(1, 'Description is required'),
  stepsToReproduce: z.string().trim(),
  severity: z.enum(DEFECT_SEVERITIES),
  status: z.enum(DEFECT_STATUSES),
  // Optional: no test case is a valid choice (the select is disabled in edit mode).
  testCaseId: z.string().trim().optional(),
  assigneeId: z.string().trim(),
});

type DefectForm = z.infer<typeof defectSchema>;

const EMPTY: DefectForm = {
  bugId: '',
  title: '',
  description: '',
  stepsToReproduce: '',
  severity: 'MEDIUM',
  status: 'OPEN',
  testCaseId: '',
  assigneeId: '',
};

const STATUS_LABELS: Record<(typeof DEFECT_STATUSES)[number], string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  CLOSED: 'Closed',
};

interface ManageDefectModalProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (defect: Defect, isEdit: boolean) => void;
  existingDefect?: Defect | null;
  initialValues?: Partial<DefectForm> & { testExecutionId?: string };
}

const field =
  'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export default function ManageDefectModal({ projectId, isOpen, onClose, onSuccess, existingDefect, initialValues }: ManageDefectModalProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [testCasesFailed, setTestCasesFailed] = useState(false);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [membersFailed, setMembersFailed] = useState(false);
  const isEdit = !!existingDefect;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DefectForm>({ resolver: zodResolver(defectSchema), defaultValues: EMPTY });

  // Load the project's test cases and team members, and fill the form each time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    setServerError(null);
    setTestCasesFailed(false);
    setMembersFailed(false);

    getProjectTestCases(projectId)
      .then(setTestCases)
      .catch(() => setTestCasesFailed(true));

    getProjectMembers(projectId)
      .then(setMembers)
      .catch(() => setMembersFailed(true));

    reset(
      existingDefect
        ? {
            bugId: existingDefect.bugId,
            title: existingDefect.title,
            description: existingDefect.description,
            stepsToReproduce: existingDefect.stepsToReproduce ?? '',
            severity: existingDefect.severity,
            status: existingDefect.status,
            testCaseId: existingDefect.testCaseId ?? '',
            assigneeId: existingDefect.assigneeId ?? '',
          }
        : {
            ...EMPTY,
            ...(initialValues || {}),
          },
    );
  }, [isOpen, existingDefect, initialValues, projectId, reset]);

  // Close on Escape.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const onSubmit = async (data: DefectForm) => {
    try {
      setServerError(null);
      const result = existingDefect
        ? // Edit: '' is sent as-is so the API clears steps / unassigns ('' -> null).
          // Bug ID and linked test case are fixed after creation (not accepted by the API).
          await updateDefect(existingDefect.id, {
            title: data.title,
            description: data.description,
            stepsToReproduce: data.stepsToReproduce,
            severity: data.severity,
            status: data.status,
            assigneeId: data.assigneeId,
          })
        : await createDefect(projectId, {
            bugId: data.bugId,
            title: data.title,
            description: data.description,
            severity: data.severity,
            status: data.status,
            stepsToReproduce: data.stepsToReproduce || undefined,
            testCaseId: data.testCaseId || undefined,
            testExecutionId: initialValues?.testExecutionId,
            assigneeId: data.assigneeId || undefined,
          });
      onSuccess(result, isEdit);
      onClose();
    } catch (error) {
      setServerError(getApiErrorMessage(error, `Failed to ${isEdit ? 'update' : 'create'} defect`));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="defect-modal-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-sidebar p-6 shadow-lg"
      >
        <div className="mb-5 flex shrink-0 items-center justify-between">
          <h2 id="defect-modal-title" className="flex items-center text-xl font-semibold text-foreground">
            <Bug className="mr-2 h-5 w-5 text-red-500" aria-hidden="true" />
            {existingDefect ? `Edit Defect: ${existingDefect.bugId}` : 'Report New Defect'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1 text-sidebar-foreground hover:bg-sidebar-accent">
            <X className="h-5 w-5" />
          </button>
        </div>

        {serverError && (
          <div className="mb-4 flex shrink-0 items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-red-500" role="alert">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="text-sm font-medium">{serverError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 overflow-y-auto pb-2 pr-2" noValidate>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="def-bugId" className="block text-sm font-medium text-foreground">Bug ID</label>
              {/* Disabled in edit mode (spec): the Bug ID cannot change. react-hook-form 7.91
                  keeps the value of a natively disabled input (verified, ISSUE-LOG TEST-20). */}
              <input
                id="def-bugId"
                disabled={isEdit}
                placeholder="e.g., BUG-001"
                {...register('bugId')}
                aria-invalid={!!errors.bugId}
                className={`${field} disabled:opacity-60`}
                autoComplete="off"
              />
              {errors.bugId && <p className="mt-1 text-xs text-red-500">{errors.bugId.message}</p>}
            </div>
            <div>
              <label htmlFor="def-title" className="block text-sm font-medium text-foreground">Title</label>
              <input id="def-title" placeholder="Summary of the issue" {...register('title')} aria-invalid={!!errors.title} className={field} autoComplete="off" />
              {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="def-severity" className="block text-sm font-medium text-foreground">Severity</label>
              <select id="def-severity" {...register('severity')} className={field}>
                {DEFECT_SEVERITIES.map((s) => (
                  <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="def-status" className="block text-sm font-medium text-foreground">Status</label>
              <select id="def-status" {...register('status')} className={field}>
                {DEFECT_STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="def-description" className="block text-sm font-medium text-foreground">Description</label>
            <textarea id="def-description" rows={3} {...register('description')} aria-invalid={!!errors.description} className={`${field} resize-none`} />
            {errors.description && <p className="mt-1 text-xs text-red-500">{errors.description.message}</p>}
          </div>

          <div>
            <label htmlFor="def-steps" className="block text-sm font-medium text-foreground">Steps to Reproduce (Optional)</label>
            <textarea id="def-steps" rows={3} {...register('stepsToReproduce')} className={`${field} resize-none`} />
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-border pt-2 md:grid-cols-2">
            <div>
              <label htmlFor="def-tc" className="block text-sm font-medium text-foreground">Linked Test Case (Optional)</label>
              {/* The API does not accept testCaseId on update, so the link is fixed after creation. */}
              <select id="def-tc" {...register('testCaseId')} disabled={isEdit} className={`${field} disabled:opacity-60`}>
                <option value="">-- None --</option>
                {testCases.map((tc) => (
                  <option key={tc.id} value={tc.id}>{tc.tcId} - {tc.title}</option>
                ))}
              </select>
              {isEdit && <p className="mt-1 text-xs text-sidebar-foreground">The linked test case cannot be changed after creation.</p>}
              {testCasesFailed && <p className="mt-1 text-xs text-yellow-500">Test cases could not be loaded.</p>}
            </div>
            <div>
              <label htmlFor="def-assignee" className="block text-sm font-medium text-foreground">Assignee (Optional)</label>
              <select
                id="def-assignee"
                {...register('assigneeId')}
                className={field}
              >
                <option value="">-- Unassigned --</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.firstName} {m.lastName} ({m.role}) - {m.email}
                  </option>
                ))}
              </select>
              {isEdit && <p className="mt-1 text-xs text-sidebar-foreground">Select '-- Unassigned --' to remove current assignee.</p>}
              {membersFailed && <p className="mt-1 text-xs text-yellow-500">Team members could not be loaded.</p>}
            </div>
          </div>

          <div className="mt-4 flex shrink-0 justify-end space-x-3 border-t border-border pt-4">
            <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {isEdit ? 'Update Defect' : 'Create Defect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
