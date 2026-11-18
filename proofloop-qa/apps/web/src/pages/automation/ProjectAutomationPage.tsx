import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import { ArrowLeft, Loader2, AlertCircle, PlayCircle, Bot, Globe, History, Plus, FileCode2 } from 'lucide-react';
import {
  getAutomationProjects,
  getAutomationExecutions,
  getEnvironments,
  type AutomationProject,
  type AutomationExecution,
  type Environment,
} from '@/lib/api/automation';
import { getProject } from '@/lib/api/projects';
import { getApiErrorMessage, getApiStatus } from '@/lib/api-error';
import { canCreateEnvironment, canManageAutomation } from '@/lib/permissions';
import { useAuth } from '@/contexts/auth-context';
import ManageEnvironmentsModal from '@/components/automation/ManageEnvironmentsModal';
import TriggerExecutionModal from '@/components/automation/TriggerExecutionModal';
import CreateAutomationProjectModal from '@/components/automation/CreateAutomationProjectModal';
import ExecutionHistory from '@/components/automation/ExecutionHistory';
import ScriptsModal from '@/components/automation/ScriptsModal';

interface HistoryState {
  open: boolean;
  isLoading: boolean;
  error: string | null;
  executions?: AutomationExecution[];
}

export default function ProjectAutomationPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();

  const [automationProjects, setAutomationProjects] = useState<AutomationProject[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [projectName, setProjectName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isEnvModalOpen, setIsEnvModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [triggerTarget, setTriggerTarget] = useState<{ id: string; name: string } | null>(null);
  const [scriptsTarget, setScriptsTarget] = useState<{ id: string; name: string } | null>(null);
  const [history, setHistory] = useState<Record<string, HistoryState>>({});

  const allowAutomation = canManageAutomation(user?.role);
  const allowEnvironments = canCreateEnvironment(user?.role);

  useEffect(() => {
    const fetchData = async () => {
      if (!projectId) return;
      try {
        // Environments are loaded here (not in the modal) so the Run dialog always has them.
        const [autoData, projectData, envData] = await Promise.all([
          getAutomationProjects(projectId),
          getProject(projectId),
          getEnvironments(projectId),
        ]);
        setAutomationProjects(autoData);
        setProjectName(projectData.name);
        setEnvironments(envData);
      } catch (err) {
        setError(getApiStatus(err) === 404 ? 'Project not found' : 'Failed to load Automation Lab');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [projectId]);

  /** (Re)load run history. Always fetched fresh: the worker changes statuses in the background. */
  const loadHistory = async (automationProjectId: string) => {
    setHistory((prev) => ({
      ...prev,
      [automationProjectId]: { open: true, isLoading: true, error: null, executions: prev[automationProjectId]?.executions },
    }));
    try {
      const executions = await getAutomationExecutions(automationProjectId);
      setHistory((prev) => ({ ...prev, [automationProjectId]: { open: true, isLoading: false, error: null, executions } }));
    } catch (err) {
      setHistory((prev) => ({
        ...prev,
        [automationProjectId]: { open: true, isLoading: false, error: getApiErrorMessage(err, 'Failed to load run history') },
      }));
    }
  };

  const toggleHistory = (automationProjectId: string) => {
    const current = history[automationProjectId];
    if (current?.open) {
      setHistory((prev) => ({ ...prev, [automationProjectId]: { ...current, open: false } }));
      return;
    }
    void loadHistory(automationProjectId);
  };

  const handleExecutionStarted = (execution: AutomationExecution) => {
    const id = execution.automationProjectId;
    setAutomationProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, _count: { executions: (p._count?.executions ?? 0) + 1 } } : p)),
    );
    // If history was already loaded, show the new run at the top (newest first, like the API).
    setHistory((prev) => {
      const current = prev[id];
      if (!current?.executions) return prev;
      return { ...prev, [id]: { ...current, executions: [execution, ...current.executions].slice(0, 50) } };
    });
  };

  const handleScriptCountChange = (automationProjectId: string, scripts: number) => {
    setAutomationProjects((prev) =>
      prev.map((p) => (p.id === automationProjectId ? { ...p, _count: { executions: p._count?.executions ?? 0, scripts } } : p)),
    );
  };

  const handleEnvironmentCreated = (env: Environment) => {
    setEnvironments((prev) => [...prev, env].sort((a, b) => a.name.localeCompare(b.name)));
  };

  // Newest first, matching the API's createdAt desc ordering.
  const handleAutomationProjectCreated = (created: AutomationProject) => {
    setAutomationProjects((prev) => [{ ...created, _count: { executions: 0, scripts: 0 } }, ...prev]);
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center" role="status" aria-label="Loading Automation Lab">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link to="/" className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
        </Link>
        <div className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-4 text-red-500" role="alert">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to={`/projects/${projectId}`} className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to {projectName}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Automation Lab</h1>
          <p className="mt-1 text-sm text-sidebar-foreground">Generate Playwright scripts from test cases, then run them with your repository's tests in a Docker sandbox.</p>
        </div>
        <div className="flex space-x-3">
          {allowEnvironments && (
            <button
              type="button"
              onClick={() => setIsEnvModalOpen(true)}
              className="flex items-center rounded-md border border-border bg-sidebar px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-sidebar-accent"
            >
              <Globe className="mr-2 h-4 w-4 text-primary" aria-hidden="true" /> Environments
            </button>
          )}
          {allowAutomation && (
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> New Automation Project
            </button>
          )}
        </div>
      </div>

      {automationProjects.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-sidebar/50">
          <Bot className="mb-4 h-10 w-10 text-sidebar-foreground opacity-50" />
          <h3 className="text-lg font-medium text-foreground">No Automation Projects</h3>
          <p className="mt-1 text-sm text-sidebar-foreground">Register a repository to start executing automated tests.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {automationProjects.map((proj) => {
            const runs = history[proj.id];
            const count = proj._count?.executions ?? 0;
            return (
              <article key={proj.id} aria-labelledby={`auto-${proj.id}-name`} className="rounded-xl border border-border bg-sidebar p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center space-x-3">
                    <div className="rounded-lg bg-primary/10 p-2 text-primary">
                      <Bot className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <h3 id={`auto-${proj.id}-name`} className="truncate font-semibold text-foreground">{proj.name}</h3>
                      <span className="font-mono text-xs text-sidebar-foreground">{proj.framework}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setScriptsTarget({ id: proj.id, name: proj.name })}
                    aria-label={`Scripts for ${proj.name}`}
                    className="flex shrink-0 items-center rounded-md bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                  >
                    <FileCode2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Scripts ({proj._count?.scripts ?? 0})
                  </button>
                  {allowAutomation && (
                    <button
                      type="button"
                      onClick={() => setTriggerTarget({ id: proj.id, name: proj.name })}
                      aria-label={`Run ${proj.name}`}
                      className="flex shrink-0 items-center rounded-md bg-green-500/10 px-3 py-1.5 text-xs font-semibold text-green-500 transition-colors hover:bg-green-500/20"
                    >
                      <PlayCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Run
                    </button>
                  )}
                  </div>
                </div>

                {proj.description && <p className="mt-3 text-sm text-sidebar-foreground">{proj.description}</p>}

                {proj.repository && (
                  <div className="mt-4 truncate rounded-lg border border-border/50 bg-sidebar-accent/30 p-3 font-mono text-xs text-sidebar-foreground">
                    {proj.repository} {proj.branch && <span className="ml-2 text-primary">@{proj.branch}</span>}
                  </div>
                )}

                <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-sm">
                  <span className="text-sidebar-foreground">
                    <History className="mb-0.5 mr-1 inline h-4 w-4" aria-hidden="true" />
                    {count} {count === 1 ? 'Execution' : 'Executions'}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleHistory(proj.id)}
                    aria-expanded={!!runs?.open}
                    aria-controls={`auto-${proj.id}-history`}
                    className="font-medium text-primary hover:underline"
                  >
                    {runs?.open ? 'Hide History' : 'View History'}
                  </button>
                </div>

                {runs?.open && (
                  <div id={`auto-${proj.id}-history`} className="mt-4">
                    <ExecutionHistory
                      automationProjectName={proj.name}
                      executions={runs.executions}
                      isLoading={runs.isLoading}
                      error={runs.error}
                      onRefresh={() => void loadHistory(proj.id)}
                    />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {projectId && allowEnvironments && (
        <ManageEnvironmentsModal
          projectId={projectId}
          isOpen={isEnvModalOpen}
          onClose={() => setIsEnvModalOpen(false)}
          environments={environments}
          onEnvironmentCreated={handleEnvironmentCreated}
        />
      )}

      {projectId && allowAutomation && (
        <CreateAutomationProjectModal
          projectId={projectId}
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={handleAutomationProjectCreated}
        />
      )}

      {projectId && (
        <ScriptsModal
          projectId={projectId}
          target={scriptsTarget}
          canEdit={allowAutomation}
          onClose={() => setScriptsTarget(null)}
          onCountChange={handleScriptCountChange}
        />
      )}

      {allowAutomation && (
        <TriggerExecutionModal
          target={triggerTarget}
          onClose={() => setTriggerTarget(null)}
          onSuccess={handleExecutionStarted}
          environments={environments}
        />
      )}
    </div>
  );
}
