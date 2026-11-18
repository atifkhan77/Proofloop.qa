import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  PauseCircle,
  Clock,
  Search,
  Bug,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  FileText,
} from 'lucide-react';
import {
  getTestCycle,
  updateTestCycle,
  recordExecution,
  type TestCycle,
  type TestExecution,
  type ExecutionStatus,
  type CycleStatus,
} from '@/lib/api/test-cycles';
import { getApiErrorMessage } from '@/lib/api-error';
import { useAuth } from '@/contexts/auth-context';
import { canManageTestCycles } from '@/lib/permissions';
import ManageDefectModal from '@/components/defects/ManageDefectModal';
import { type Defect } from '@/lib/api/defects';

const STATUS_ICONS: Record<ExecutionStatus, React.ComponentType<{ className?: string }>> = {
  PASSED: CheckCircle2,
  FAILED: XCircle,
  SKIPPED: PauseCircle,
  BLOCKED: AlertTriangle,
  PENDING: Clock,
};

const STATUS_COLORS: Record<ExecutionStatus, string> = {
  PASSED: 'text-green-500 bg-green-500/10 border-green-500/20',
  FAILED: 'text-red-500 bg-red-500/10 border-red-500/20',
  SKIPPED: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
  BLOCKED: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
  PENDING: 'text-sidebar-foreground bg-sidebar-accent border-border',
};

export default function TestCycleDetailPage() {
  const { cycleId } = useParams<{ cycleId: string }>();
  const { user } = useAuth();
  const [cycle, setCycle] = useState<TestCycle | null>(null);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ExecutionStatus>('ALL');

  // Execution runner state
  const [notes, setNotes] = useState('');
  const [isRecording, setIsRecording] = useState(false);

  // Defect logging prompt / modal
  const [isDefectModalOpen, setIsDefectModalOpen] = useState(false);
  const [defectPrompt, setDefectPrompt] = useState<{ execution: TestExecution } | null>(null);

  const canManage = canManageTestCycles(user?.role);

  const fetchCycleData = async () => {
    if (!cycleId) return;
    try {
      const data = await getTestCycle(cycleId);
      setCycle(data);
      if (data.executions && data.executions.length > 0 && !selectedExecutionId) {
        setSelectedExecutionId(data.executions[0].id);
        setNotes(data.executions[0].notes || '');
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load test cycle'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCycleData();
  }, [cycleId]);

  const selectedExecution = cycle?.executions?.find((e) => e.id === selectedExecutionId) || null;

  const handleSelectExecution = (exec: TestExecution) => {
    setSelectedExecutionId(exec.id);
    setNotes(exec.notes || '');
    setDefectPrompt(null);
  };

  const handleStatusChange = async (newStatus: CycleStatus) => {
    if (!cycleId || !cycle) return;
    try {
      const updated = await updateTestCycle(cycleId, { status: newStatus });
      setCycle((prev) => (prev ? { ...prev, status: updated.status } : null));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to update cycle status'));
    }
  };

  const handleRecordResult = async (status: ExecutionStatus) => {
    if (!selectedExecutionId || !cycle) return;
    try {
      setIsRecording(true);
      setError(null);

      const res = await recordExecution(selectedExecutionId, {
        status,
        notes: notes.trim() || undefined,
      });

      // Update executions list
      setCycle((prev) => {
        if (!prev || !prev.executions) return prev;
        const nextExecutions = prev.executions.map((e) =>
          e.id === selectedExecutionId
            ? {
                ...e,
                status: res.status,
                notes: res.notes,
                executedAt: res.executedAt,
                executedBy: res.executedBy,
              }
            : e,
        );

        // Recalculate stats
        const totalCount = nextExecutions.length;
        const passedCount = nextExecutions.filter((e) => e.status === 'PASSED').length;
        const failedCount = nextExecutions.filter((e) => e.status === 'FAILED').length;
        const skippedCount = nextExecutions.filter((e) => e.status === 'SKIPPED').length;
        const pendingCount = nextExecutions.filter((e) => e.status === 'PENDING').length;
        const blockedCount = nextExecutions.filter((e) => e.status === 'BLOCKED').length;
        const passRate = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;

        return {
          ...prev,
          status: prev.status === 'PLANNED' ? 'IN_PROGRESS' : prev.status,
          executions: nextExecutions,
          stats: {
            totalCount,
            passedCount,
            failedCount,
            skippedCount,
            pendingCount,
            blockedCount,
            passRate,
          },
        };
      });

      if (status === 'FAILED') {
        setDefectPrompt({ execution: selectedExecution! });
      } else {
        setDefectPrompt(null);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to record execution result'));
    } finally {
      setIsRecording(false);
    }
  };

  const handleDefectCreated = (newDefect: Defect) => {
    // Attach to current execution
    if (cycle && selectedExecutionId) {
      setCycle((prev) => {
        if (!prev || !prev.executions) return prev;
        return {
          ...prev,
          executions: prev.executions.map((e) =>
            e.id === selectedExecutionId
              ? {
                  ...e,
                  defects: [
                    ...(e.defects || []),
                    {
                      id: newDefect.id,
                      bugId: newDefect.bugId,
                      title: newDefect.title,
                      severity: newDefect.severity,
                      status: newDefect.status,
                    },
                  ],
                }
              : e,
          ),
        };
      });
    }
    setDefectPrompt(null);
    setIsDefectModalOpen(false);
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center" role="status" aria-label="Loading execution runner">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !cycle) {
    return (
      <div className="space-y-4">
        <Link to="/" className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
        </Link>
        <div className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-4 text-red-500" role="alert">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{error || 'Test cycle not found'}</span>
        </div>
      </div>
    );
  }

  const executions = cycle.executions || [];
  const filteredExecutions = executions.filter((e) => {
    if (statusFilter !== 'ALL' && e.status !== statusFilter) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase().trim();
    return e.testCase.tcId.toLowerCase().includes(q) || e.testCase.title.toLowerCase().includes(q);
  });

  const currentIndex = executions.findIndex((e) => e.id === selectedExecutionId);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < executions.length - 1;

  const goToPrev = () => {
    if (hasPrev) handleSelectExecution(executions[currentIndex - 1]);
  };
  const goToNext = () => {
    if (hasNext) handleSelectExecution(executions[currentIndex + 1]);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div>
        <Link
          to={`/projects/${cycle.projectId}/test-cycles`}
          className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Test Cycles
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-5">
          <div>
            <div className="flex items-center space-x-3">
              <span className="font-mono text-sm font-bold text-primary">{cycle.cycleId}</span>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{cycle.name}</h1>
              {cycle.environment && (
                <span className="rounded bg-sidebar-accent px-2 py-0.5 text-xs text-sidebar-foreground font-mono">
                  {cycle.environment.name}
                </span>
              )}
            </div>
            {cycle.description && (
              <p className="mt-1 text-sm text-sidebar-foreground">{cycle.description}</p>
            )}
          </div>

          <div className="flex items-center space-x-3">
            <label htmlFor="cycle-status-select" className="text-xs font-medium text-sidebar-foreground">
              Cycle Status:
            </label>
            <select
              id="cycle-status-select"
              value={cycle.status}
              disabled={!canManage}
              onChange={(e) => handleStatusChange(e.target.value as CycleStatus)}
              className="rounded-md border border-border bg-sidebar px-3 py-1.5 text-xs font-semibold text-foreground focus:border-primary focus:outline-none"
            >
              <option value="PLANNED">Planned</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="COMPLETED">Completed</option>
              <option value="ABORTED">Aborted</option>
            </select>
          </div>
        </div>

        {/* Progress Bar & Summary Stats */}
        <div className="mt-4 rounded-xl border border-border bg-sidebar p-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs mb-2">
            <span className="font-semibold text-foreground">
              Pass Rate: <strong className="text-green-500">{cycle.stats.passRate}%</strong> ({cycle.stats.passedCount} / {cycle.stats.totalCount} Passed)
            </span>
            <div className="flex items-center space-x-4 text-sidebar-foreground">
              <span className="text-green-500">● {cycle.stats.passedCount} Passed</span>
              <span className="text-red-500">● {cycle.stats.failedCount} Failed</span>
              <span className="text-amber-500">● {cycle.stats.blockedCount} Blocked</span>
              <span className="text-gray-400">● {cycle.stats.skippedCount} Skipped</span>
              <span>● {cycle.stats.pendingCount} Pending</span>
            </div>
          </div>
          <div className="h-2.5 w-full rounded-full bg-sidebar-accent overflow-hidden flex">
            <div className="bg-green-500 h-full" style={{ width: `${(cycle.stats.passedCount / (cycle.stats.totalCount || 1)) * 100}%` }} />
            <div className="bg-red-500 h-full" style={{ width: `${(cycle.stats.failedCount / (cycle.stats.totalCount || 1)) * 100}%` }} />
            <div className="bg-amber-500 h-full" style={{ width: `${(cycle.stats.blockedCount / (cycle.stats.totalCount || 1)) * 100}%` }} />
            <div className="bg-gray-400 h-full" style={{ width: `${(cycle.stats.skippedCount / (cycle.stats.totalCount || 1)) * 100}%` }} />
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-4 text-red-500" role="alert">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      {/* Master-Detail Layout */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Left Sidebar: Test Cases List */}
        <div className="w-full lg:w-80 shrink-0 rounded-xl border border-border bg-sidebar p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-sidebar-foreground">
              Test Cases ({executions.length})
            </h2>
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={goToPrev}
                disabled={!hasPrev}
                aria-label="Previous test case"
                className="p-1 rounded text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={goToNext}
                disabled={!hasNext}
                aria-label="Next test case"
                className="p-1 rounded text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-sidebar-foreground" />
            <input
              type="text"
              placeholder="Search test cases..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-border bg-sidebar pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-sidebar-foreground focus:border-primary focus:outline-none"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex gap-1 overflow-x-auto pb-1 text-[11px]">
            {(['ALL', 'PENDING', 'PASSED', 'FAILED'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`rounded px-2 py-0.5 font-medium transition-colors ${
                  statusFilter === st ? 'bg-primary text-primary-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          {/* Executions List */}
          <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
            {filteredExecutions.length === 0 ? (
              <div className="py-8 text-center text-xs text-sidebar-foreground">No test cases match.</div>
            ) : (
              filteredExecutions.map((e) => {
                const Icon = STATUS_ICONS[e.status];
                const isSelected = e.id === selectedExecutionId;
                const hasDefects = e.defects && e.defects.length > 0;

                return (
                  <div
                    key={e.id}
                    onClick={() => handleSelectExecution(e)}
                    className={`flex flex-col p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border/60 hover:bg-sidebar-accent/50 text-sidebar-foreground'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <div className="flex items-center space-x-1.5 min-w-0">
                        <Icon className={`h-3.5 w-3.5 shrink-0 ${STATUS_COLORS[e.status].split(' ')[0]}`} />
                        <span className="font-mono font-bold text-foreground">{e.testCase.tcId}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        {hasDefects && (
                          <span className="rounded bg-red-500/10 px-1 py-0.2 text-[10px] text-red-500 font-bold border border-red-500/20">
                            {e.defects!.length} bug{e.defects!.length > 1 ? 's' : ''}
                          </span>
                        )}
                        <span className="rounded bg-sidebar-accent px-1.5 py-0.2 text-[10px] text-sidebar-foreground">
                          {e.testCase.priority}
                        </span>
                      </div>
                    </div>
                    <span className="truncate font-medium text-foreground">{e.testCase.title}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Main Workspace: Test Case Details & Execution Actions */}
        {selectedExecution ? (
          <div className="flex-1 w-full rounded-xl border border-border bg-sidebar p-6 shadow-sm space-y-6">
            {/* Defect Prompt Alert on Failure */}
            {defectPrompt && (
              <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-500">
                <div className="flex items-center space-x-3">
                  <AlertCircle className="h-5 w-5 shrink-0" />
                  <div>
                    <h4 className="text-sm font-bold text-foreground">Execution Failed</h4>
                    <p className="text-xs text-sidebar-foreground">
                      Would you like to log a defect for test case <strong>{selectedExecution.testCase.tcId}</strong>?
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsDefectModalOpen(true)}
                  className="flex items-center rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 transition-colors"
                >
                  <Bug className="mr-1.5 h-3.5 w-3.5" />
                  Log Defect Now
                </button>
              </div>
            )}

            {/* Test Case Overview */}
            <div>
              <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
                <div>
                  <div className="flex items-center space-x-2 mb-1.5">
                    <span className="font-mono text-sm font-bold text-primary">{selectedExecution.testCase.tcId}</span>
                    <span className="rounded bg-sidebar-accent px-2 py-0.5 text-xs text-sidebar-foreground uppercase font-medium">
                      {selectedExecution.testCase.testType}
                    </span>
                    <span className="rounded bg-sidebar-accent px-2 py-0.5 text-xs text-sidebar-foreground font-medium">
                      {selectedExecution.testCase.priority} Priority
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase border ${STATUS_COLORS[selectedExecution.status]}`}>
                      {selectedExecution.status}
                    </span>
                  </div>
                  <h2 className="text-xl font-bold text-foreground">{selectedExecution.testCase.title}</h2>
                  {selectedExecution.testCase.description && (
                    <p className="mt-1.5 text-sm text-sidebar-foreground">{selectedExecution.testCase.description}</p>
                  )}
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setIsDefectModalOpen(true)}
                    className="inline-flex items-center rounded-md border border-border bg-sidebar px-3 py-1.5 text-xs font-medium text-foreground hover:bg-sidebar-accent transition-colors"
                  >
                    <Bug className="mr-1.5 h-3.5 w-3.5 text-red-500" />
                    Log Defect
                  </button>
                </div>
              </div>

              {/* Preconditions & Test Data */}
              {(selectedExecution.testCase.preconditions || selectedExecution.testCase.testData) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 text-xs">
                  {selectedExecution.testCase.preconditions && (
                    <div className="rounded-lg border border-border bg-sidebar-accent/20 p-3">
                      <span className="font-semibold text-foreground block mb-1">Preconditions:</span>
                      <p className="text-sidebar-foreground">{selectedExecution.testCase.preconditions}</p>
                    </div>
                  )}
                  {selectedExecution.testCase.testData && (
                    <div className="rounded-lg border border-border bg-sidebar-accent/20 p-3">
                      <span className="font-semibold text-foreground block mb-1">Test Data:</span>
                      <p className="font-mono text-sidebar-foreground">{selectedExecution.testCase.testData}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Test Steps */}
            <div>
              <h3 className="text-sm font-bold text-foreground mb-3 flex items-center">
                <FileText className="mr-2 h-4 w-4 text-primary" /> Test Steps
              </h3>

              {(!selectedExecution.testCase.steps || selectedExecution.testCase.steps.length === 0) ? (
                <p className="text-xs text-sidebar-foreground italic">No individual steps recorded for this test case.</p>
              ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-border bg-sidebar-accent/50 uppercase tracking-wider text-sidebar-foreground font-semibold">
                      <tr>
                        <th className="px-4 py-2.5 w-12 text-center">#</th>
                        <th className="px-4 py-2.5">Action / Step</th>
                        <th className="px-4 py-2.5">Expected Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {selectedExecution.testCase.steps.map((st) => (
                        <tr key={st.id} className="hover:bg-sidebar-accent/30 transition-colors">
                          <td className="px-4 py-3 text-center font-bold text-sidebar-foreground">{st.stepNumber}</td>
                          <td className="px-4 py-3 font-medium text-foreground">{st.action}</td>
                          <td className="px-4 py-3 text-sidebar-foreground">{st.expectedResult}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Linked Defects Section */}
            {selectedExecution.defects && selectedExecution.defects.length > 0 && (
              <div className="rounded-lg border border-border bg-red-500/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-red-500 uppercase tracking-wider flex items-center">
                    <Bug className="mr-1.5 h-4 w-4" /> Linked Defects ({selectedExecution.defects.length})
                  </h4>
                </div>
                <div className="space-y-2">
                  {selectedExecution.defects.map((d) => (
                    <div key={d.id} className="flex items-center justify-between p-2 rounded bg-sidebar border border-border text-xs">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono font-bold text-red-500">{d.bugId}</span>
                        <span className="font-medium text-foreground">{d.title}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        {d.jiraTicketId && (
                          <span className="rounded bg-blue-500/10 text-blue-500 px-2 py-0.5 font-mono text-[10px] border border-blue-500/20">
                            Jira: {d.jiraTicketId}
                          </span>
                        )}
                        <span className="rounded bg-sidebar-accent px-2 py-0.5 text-[10px] uppercase text-sidebar-foreground font-semibold">
                          {d.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Execution Recording Controls */}
            <div className="rounded-xl border border-border bg-sidebar-accent/20 p-5 space-y-4">
              <h3 className="text-sm font-bold text-foreground">Record Test Execution Result</h3>

              <div>
                <label htmlFor="exec-notes" className="block text-xs font-medium text-foreground mb-1">
                  Execution Notes / Observations (Optional)
                </label>
                <textarea
                  id="exec-notes"
                  rows={2}
                  disabled={!canManage || isRecording}
                  placeholder="Notes on actual outcome, build environment, or logs..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-md border border-border bg-sidebar px-3 py-2 text-xs text-foreground placeholder:text-sidebar-foreground focus:border-primary focus:outline-none"
                />
              </div>

              {canManage && (
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    disabled={isRecording}
                    onClick={() => handleRecordResult('PASSED')}
                    className="flex items-center rounded-md bg-green-600 px-4 py-2 text-xs font-bold text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                  >
                    <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    Mark as Passed
                  </button>

                  <button
                    type="button"
                    disabled={isRecording}
                    onClick={() => handleRecordResult('FAILED')}
                    className="flex items-center rounded-md bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    <XCircle className="mr-1.5 h-4 w-4" />
                    Mark as Failed
                  </button>

                  <button
                    type="button"
                    disabled={isRecording}
                    onClick={() => handleRecordResult('BLOCKED')}
                    className="flex items-center rounded-md bg-amber-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
                  >
                    <AlertTriangle className="mr-1.5 h-4 w-4" />
                    Blocked
                  </button>

                  <button
                    type="button"
                    disabled={isRecording}
                    onClick={() => handleRecordResult('SKIPPED')}
                    className="flex items-center rounded-md border border-border bg-sidebar px-3.5 py-2 text-xs font-medium text-foreground hover:bg-sidebar-accent transition-colors disabled:opacity-50"
                  >
                    <PauseCircle className="mr-1.5 h-4 w-4" />
                    Skip
                  </button>

                  {isRecording && <Loader2 className="h-4 w-4 animate-spin text-primary ml-2" />}
                </div>
              )}

              {selectedExecution.executedAt && (
                <div className="text-[11px] text-sidebar-foreground pt-2 border-t border-border/50">
                  Last executed on {new Date(selectedExecution.executedAt).toLocaleString()}
                  {selectedExecution.executedBy && (
                    <span> by {selectedExecution.executedBy.firstName} {selectedExecution.executedBy.lastName}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex h-96 items-center justify-center rounded-xl border border-dashed border-border bg-sidebar/50 text-sidebar-foreground text-sm">
            Select a test case from the left to start execution.
          </div>
        )}
      </div>

      {/* Prefilled Defect Modal */}
      {selectedExecution && (
        <ManageDefectModal
          projectId={cycle.projectId}
          isOpen={isDefectModalOpen}
          onClose={() => setIsDefectModalOpen(false)}
          onSuccess={handleDefectCreated}
          initialValues={{
            bugId: '',
            title: `[Test Cycle ${cycle.cycleId}] ${selectedExecution.testCase.title} Failed`,
            description: `Test Case ${selectedExecution.testCase.tcId} failed during execution in cycle "${cycle.name}".\n\nExecution Notes:\n${notes || 'No notes provided.'}`,
            stepsToReproduce: selectedExecution.testCase.steps
              ? selectedExecution.testCase.steps.map((s) => `${s.stepNumber}. ${s.action} -> Expected: ${s.expectedResult}`).join('\n')
              : '',
            severity: 'HIGH',
            testCaseId: selectedExecution.testCase.id,
            testExecutionId: selectedExecution.id,
          }}
        />
      )}
    </div>
  );
}
