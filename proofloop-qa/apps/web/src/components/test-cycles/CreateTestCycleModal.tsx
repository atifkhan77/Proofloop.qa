import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Loader2, AlertCircle, Search, CheckSquare, Square } from 'lucide-react';
import { createTestCycle, type TestCycle } from '@/lib/api/test-cycles';
import { getEnvironments, type Environment } from '@/lib/api/automation';
import { getProjectTestCases, type TestCase } from '@/lib/api/test-cases';
import { getApiErrorMessage } from '@/lib/api-error';

const formSchema = z.object({
  name: z.string().trim().min(1, 'Cycle name is required'),
  description: z.string().trim().optional(),
  environmentId: z.string().trim().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface CreateTestCycleModalProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (cycle: TestCycle) => void;
}

export default function CreateTestCycleModal({ projectId, isOpen, onClose, onSuccess }: CreateTestCycleModalProps) {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [selectedTcIds, setSelectedTcIds] = useState<Set<string>>(new Set());
  const [tcSearch, setTcSearch] = useState('');
  const [isLoadingDependencies, setIsLoadingDependencies] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', description: '', environmentId: '' },
  });

  const close = () => {
    reset();
    setServerError(null);
    setSelectedTcIds(new Set());
    setTcSearch('');
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;

    const loadData = async () => {
      try {
        setIsLoadingDependencies(true);
        const [envs, cases] = await Promise.all([
          getEnvironments(projectId),
          getProjectTestCases(projectId),
        ]);
        setEnvironments(envs);
        setTestCases(cases);
        // Default: select all test cases for regression cycle
        setSelectedTcIds(new Set(cases.map((c) => c.id)));
      } catch (err) {
        setServerError(getApiErrorMessage(err, 'Failed to load environments and test cases'));
      } finally {
        setIsLoadingDependencies(false);
      }
    };

    loadData();
  }, [isOpen, projectId]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        close();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting]);

  if (!isOpen) return null;

  const toggleSelectAll = () => {
    if (selectedTcIds.size === testCases.length) {
      setSelectedTcIds(new Set());
    } else {
      setSelectedTcIds(new Set(testCases.map((c) => c.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedTcIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onSubmit = async (values: FormValues) => {
    if (selectedTcIds.size === 0) {
      setServerError('Please select at least one test case for this cycle');
      return;
    }
    try {
      setServerError(null);
      const cycle = await createTestCycle(projectId, {
        name: values.name.trim(),
        description: values.description?.trim() || undefined,
        environmentId: values.environmentId?.trim() || undefined,
        testCaseIds: Array.from(selectedTcIds),
      });
      onSuccess(cycle);
      close();
    } catch (err) {
      setServerError(getApiErrorMessage(err, 'Failed to create test cycle'));
    }
  };

  const filteredCases = testCases.filter((tc) => {
    if (!tcSearch.trim()) return true;
    const q = tcSearch.toLowerCase().trim();
    return tc.tcId.toLowerCase().includes(q) || tc.title.toLowerCase().includes(q);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-labelledby="create-cycle-title"
        aria-modal="true"
        className="relative w-full max-w-2xl rounded-xl border border-border bg-sidebar p-6 shadow-xl flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h2 id="create-cycle-title" className="text-lg font-bold text-foreground">
              New Test Execution Cycle
            </h2>
            <p className="mt-1 text-xs text-sidebar-foreground">
              Group test cases into a structured manual execution cycle (e.g. Release 2.0 Regression).
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close dialog"
            className="rounded-md p-1.5 text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {serverError && (
          <div className="mt-4 flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-red-500 text-xs font-medium" role="alert">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4 flex-1 overflow-y-auto pr-1">
          <div>
            <label htmlFor="cycle-name" className="block text-xs font-medium text-foreground mb-1">
              Cycle Name <span className="text-red-500">*</span>
            </label>
            <input
              id="cycle-name"
              type="text"
              placeholder="e.g., Release 2.0 Regression Cycle"
              {...register('name')}
              className="w-full rounded-md border border-border bg-sidebar px-3 py-2 text-sm text-foreground placeholder:text-sidebar-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="cycle-env" className="block text-xs font-medium text-foreground mb-1">
                Target Environment (Optional)
              </label>
              <select
                id="cycle-env"
                {...register('environmentId')}
                className="w-full rounded-md border border-border bg-sidebar px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">-- No Environment --</option>
                {environments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name} {env.baseUrl ? `(${env.baseUrl})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="cycle-desc" className="block text-xs font-medium text-foreground mb-1">
                Description (Optional)
              </label>
              <input
                id="cycle-desc"
                type="text"
                placeholder="Scope, build number or target version"
                {...register('description')}
                className="w-full rounded-md border border-border bg-sidebar px-3 py-2 text-sm text-foreground placeholder:text-sidebar-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Test Case Selection */}
          <div className="border border-border rounded-lg p-3 bg-sidebar-accent/20">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-border pb-3 mb-3">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-foreground">Select Test Cases</span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                  {selectedTcIds.size} of {testCases.length} Selected
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-sidebar-foreground" />
                  <input
                    type="text"
                    placeholder="Filter test cases..."
                    value={tcSearch}
                    onChange={(e) => setTcSearch(e.target.value)}
                    className="w-36 sm:w-48 rounded-md border border-border bg-sidebar pl-8 pr-2.5 py-1 text-xs text-foreground placeholder:text-sidebar-foreground focus:border-primary focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="inline-flex items-center rounded border border-border px-2.5 py-1 text-xs text-foreground hover:bg-sidebar-accent transition-colors"
                >
                  {selectedTcIds.size === testCases.length ? (
                    <>
                      <CheckSquare className="mr-1 h-3.5 w-3.5 text-primary" /> Deselect All
                    </>
                  ) : (
                    <>
                      <Square className="mr-1 h-3.5 w-3.5" /> Select All
                    </>
                  )}
                </button>
              </div>
            </div>

            {isLoadingDependencies ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : filteredCases.length === 0 ? (
              <div className="py-8 text-center text-xs text-sidebar-foreground">
                {testCases.length === 0 ? 'No test cases exist in this project yet.' : 'No matching test cases found.'}
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 divide-y divide-border/50">
                {filteredCases.map((tc) => {
                  const isChecked = selectedTcIds.has(tc.id);
                  return (
                    <div
                      key={tc.id}
                      onClick={() => toggleSelectOne(tc.id)}
                      className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-sidebar-accent/50 cursor-pointer transition-colors text-xs"
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} // handled by parent onClick
                          className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary cursor-pointer"
                        />
                        <span className="font-mono font-semibold text-foreground shrink-0">{tc.tcId}</span>
                        <span className="truncate text-sidebar-foreground">{tc.title}</span>
                      </div>
                      <div className="flex items-center space-x-1.5 shrink-0 ml-2">
                        <span className="rounded bg-sidebar-accent px-1.5 py-0.5 text-[10px] text-sidebar-foreground uppercase">
                          {tc.testType}
                        </span>
                        <span className="rounded bg-sidebar-accent px-1.5 py-0.5 text-[10px] text-sidebar-foreground">
                          {tc.priority}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-border flex justify-end space-x-3">
            <button
              type="button"
              onClick={close}
              disabled={isSubmitting}
              className="rounded-md border border-border bg-transparent px-4 py-2 text-sm font-medium text-foreground hover:bg-sidebar-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || testCases.length === 0}
              className="flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Test Cycle
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
