import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Plus,
  History,
  CheckCircle2,
  XCircle,
  Clock,
  PauseCircle,
  Play,
} from 'lucide-react';
import { getProjectTestCycles, type TestCycle, type CycleStatus } from '@/lib/api/test-cycles';
import { getProject, type Project } from '@/lib/api/projects';
import { getApiErrorMessage } from '@/lib/api-error';
import { useAuth } from '@/contexts/auth-context';
import { canManageTestCycles } from '@/lib/permissions';
import CreateTestCycleModal from '@/components/test-cycles/CreateTestCycleModal';

const STATUS_BADGES: Record<CycleStatus, string> = {
  PLANNED: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  IN_PROGRESS: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  COMPLETED: 'bg-green-500/10 text-green-500 border-green-500/20',
  ABORTED: 'bg-sidebar-accent text-sidebar-foreground border-border',
};

export default function ProjectTestCyclesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [cycles, setCycles] = useState<TestCycle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'ALL' | CycleStatus>('ALL');

  const canManage = canManageTestCycles(user?.role);

  const fetchData = async () => {
    if (!projectId) return;
    try {
      const [proj, cycleList] = await Promise.all([
        getProject(projectId),
        getProjectTestCycles(projectId),
      ]);
      setProject(proj);
      setCycles(cycleList);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load test cycles'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [projectId]);

  const handleCycleCreated = (newCycle: TestCycle) => {
    setCycles((prev) => [newCycle, ...prev]);
    fetchData();
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center" role="status" aria-label="Loading test cycles">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const filteredCycles = cycles.filter((c) => {
    if (statusFilter === 'ALL') return true;
    return c.status === statusFilter;
  });

  return (
    <div className="space-y-6">
      <div>
        <Link to={`/projects/${projectId}`} className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground mb-3">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to {project?.name || 'Project'}
        </Link>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Test Execution Cycles</h1>
            <p className="mt-1 text-sm text-sidebar-foreground">
              Group test cases into manual test runs, track execution passes and defects.
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="mr-2 h-4 w-4" />
              New Test Cycle
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-4 text-red-500" role="alert">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-1">
        {(['ALL', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'ABORTED'] as const).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(status)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === status
                ? 'bg-primary text-primary-foreground'
                : 'border border-border text-sidebar-foreground hover:bg-sidebar-accent'
            }`}
          >
            {status === 'ALL' ? `All (${cycles.length})` : `${status.replace('_', ' ')} (${cycles.filter((c) => c.status === status).length})`}
          </button>
        ))}
      </div>

      {filteredCycles.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-sidebar/50">
          <History className="mb-4 h-10 w-10 text-sidebar-foreground opacity-50" />
          <h3 className="text-lg font-medium text-foreground">No test execution cycles found</h3>
          <p className="mt-1 text-sm text-sidebar-foreground">
            {canManage ? 'Create a regression or release cycle to begin executing test cases.' : 'No cycles configured yet.'}
          </p>
          {canManage && (
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="mt-4 flex items-center rounded-md bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Test Cycle
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {filteredCycles.map((cycle) => {
            const stats = cycle.stats || {
              totalCount: 0,
              passedCount: 0,
              failedCount: 0,
              skippedCount: 0,
              pendingCount: 0,
              blockedCount: 0,
              passRate: 0,
            };
            return (
              <div
                key={cycle.id}
                className="group flex flex-col justify-between rounded-xl border border-border bg-sidebar p-5 shadow-sm hover:border-primary/50 transition-all"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-xs font-semibold text-primary">{cycle.cycleId}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase border ${STATUS_BADGES[cycle.status]}`}>
                          {cycle.status.replace('_', ' ')}
                        </span>
                      </div>
                      <h2 className="mt-1 font-bold text-foreground text-base group-hover:text-primary transition-colors">
                        {cycle.name}
                      </h2>
                    </div>

                    {cycle.environment && (
                      <span className="shrink-0 rounded bg-sidebar-accent px-2 py-1 text-xs font-medium text-sidebar-foreground">
                        {cycle.environment.name}
                      </span>
                    )}
                  </div>

                  {cycle.description && (
                    <p className="text-xs text-sidebar-foreground line-clamp-2 mt-1 mb-3">
                      {cycle.description}
                    </p>
                  )}

                  {/* Progress bar */}
                  <div className="mt-4 space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-sidebar-foreground">Execution Progress</span>
                      <span className="font-semibold text-foreground">{stats.passRate}% Pass Rate</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-sidebar-accent overflow-hidden flex">
                      <div className="bg-green-500 h-full" style={{ width: `${(stats.passedCount / (stats.totalCount || 1)) * 100}%` }} title="Passed" />
                      <div className="bg-red-500 h-full" style={{ width: `${(stats.failedCount / (stats.totalCount || 1)) * 100}%` }} title="Failed" />
                      <div className="bg-amber-500 h-full" style={{ width: `${(stats.blockedCount / (stats.totalCount || 1)) * 100}%` }} title="Blocked" />
                      <div className="bg-gray-400 h-full" style={{ width: `${(stats.skippedCount / (stats.totalCount || 1)) * 100}%` }} title="Skipped" />
                    </div>
                  </div>

                  {/* Counters */}
                  <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
                    <div className="rounded bg-sidebar-accent/50 p-2">
                      <div className="flex items-center justify-center text-green-500 mb-1">
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        <span className="font-bold">{stats.passedCount}</span>
                      </div>
                      <span className="text-[10px] text-sidebar-foreground">Passed</span>
                    </div>

                    <div className="rounded bg-sidebar-accent/50 p-2">
                      <div className="flex items-center justify-center text-red-500 mb-1">
                        <XCircle className="h-3.5 w-3.5 mr-1" />
                        <span className="font-bold">{stats.failedCount}</span>
                      </div>
                      <span className="text-[10px] text-sidebar-foreground">Failed</span>
                    </div>

                    <div className="rounded bg-sidebar-accent/50 p-2">
                      <div className="flex items-center justify-center text-yellow-500 mb-1">
                        <PauseCircle className="h-3.5 w-3.5 mr-1" />
                        <span className="font-bold">{stats.skippedCount + stats.blockedCount}</span>
                      </div>
                      <span className="text-[10px] text-sidebar-foreground">Skip/Block</span>
                    </div>

                    <div className="rounded bg-sidebar-accent/50 p-2">
                      <div className="flex items-center justify-center text-sidebar-foreground mb-1">
                        <Clock className="h-3.5 w-3.5 mr-1" />
                        <span className="font-bold">{stats.pendingCount}</span>
                      </div>
                      <span className="text-[10px] text-sidebar-foreground">Pending</span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-border flex items-center justify-between">
                  <span className="text-[11px] text-sidebar-foreground">
                    Created {new Date(cycle.createdAt).toLocaleDateString()}
                  </span>
                  <Link
                    to={`/test-cycles/${cycle.id}`}
                    className="inline-flex items-center rounded-md bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                  >
                    <Play className="mr-1.5 h-3.5 w-3.5" />
                    Open Runner &rarr;
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {projectId && (
        <CreateTestCycleModal
          projectId={projectId}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSuccess={handleCycleCreated}
        />
      )}
    </div>
  );
}
