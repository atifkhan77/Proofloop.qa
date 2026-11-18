import { useEffect, useState } from 'react';
import { useParams, Link, useLocation } from 'react-router';
import { Plus, FileText, ArrowLeft, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { getRequirements, type Requirement } from '@/lib/api/requirements';
import { getModule } from '@/lib/api/projects';
import { getApiStatus } from '@/lib/api-error';
import { canCreateRequirement } from '@/lib/permissions';
import { useAuth } from '@/contexts/auth-context';
import { generateTestCases } from '@/lib/api/ai';
import CreateRequirementModal from '@/components/requirements/CreateRequirementModal';

/** Passed via <Link state> from ProjectDetailPage. Absent on a fresh tab / direct visit. */
export interface RequirementsLinkState {
  projectId?: string;
  projectName?: string;
  moduleName?: string;
}

interface ModuleContext {
  moduleName: string;
  projectId: string;
  projectName: string;
}

function contextFromState(state: RequirementsLinkState | null): ModuleContext | null {
  return state?.moduleName && state.projectId && state.projectName
    ? { moduleName: state.moduleName, projectId: state.projectId, projectName: state.projectName }
    : null;
}

const PRIORITY_BADGE: Record<Requirement['priority'], string> = {
  HIGH: 'text-red-500 bg-red-500/10',
  MEDIUM: 'text-yellow-500 bg-yellow-500/10',
  LOW: 'text-green-500 bg-green-500/10',
};

export default function RequirementsPage() {
  const { moduleId } = useParams<{ moduleId: string }>();
  const { state } = useLocation() as { state: RequirementsLinkState | null };
  const { user } = useAuth();
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);
  // Router state first (no extra request); otherwise filled from GET /modules/:id.
  const [moduleContext, setModuleContext] = useState<ModuleContext | null>(() => contextFromState(state));

  const allowCreate = canCreateRequirement(user?.role);
  // Stable boolean dependency: whether navigation already supplied the context.
  const hasStateContext = contextFromState(state) !== null;

  useEffect(() => {
    const fetchData = async () => {
      if (!moduleId) return;
      try {
        const [reqs, mod] = await Promise.all([
          getRequirements(moduleId),
          // Breadcrumb is cosmetic: a failure here must not hide the requirements.
          hasStateContext ? Promise.resolve(null) : getModule(moduleId).catch(() => null),
        ]);
        setRequirements(reqs);
        if (mod) {
          setModuleContext({ moduleName: mod.name, projectId: mod.project.id, projectName: mod.project.name });
        }
      } catch (err) {
        setError(getApiStatus(err) === 404 ? 'Module not found' : 'Failed to load requirements');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [moduleId, hasStateContext]);

  const handleRequirementCreated = (newRequirement: Requirement) => {
    // POST response has no _count; a new requirement has no links yet.
    setRequirements((prev) => [{ ...newRequirement, _count: { testCases: 0, risks: 0 } }, ...prev]);
  };

  const handleAiGenerate = async (reqId: string) => {
    setAiLoadingId(reqId);
    try {
      const res = await generateTestCases(reqId, true);
      const addedCount = res.savedTestCases?.length || res.drafts?.length || 0;
      setRequirements((prev) =>
        prev.map((r) =>
          r.id === reqId
            ? { ...r, _count: { testCases: (r._count?.testCases || 0) + addedCount, risks: r._count?.risks ?? 0 } }
            : r,
        ),
      );
    } catch (err: any) {
      alert(err.response?.data?.error || err.message || 'Failed to synthesize test cases');
    } finally {
      setAiLoadingId(null);
    }
  };

  // Dashboard fallback only if both router state and GET /modules/:id are unavailable.
  const backLink = moduleContext ? (
    <Link to={`/projects/${moduleContext.projectId}`} className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground">
      <ArrowLeft className="mr-2 h-4 w-4" /> Back to {moduleContext.projectName}
    </Link>
  ) : (
    <Link to="/" className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground">
      <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
    </Link>
  );

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center" role="status" aria-label="Loading requirements">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        {backLink}
        <div className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-4 text-red-500" role="alert">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {backLink}

      <div className="flex items-center justify-between border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {moduleContext ? `${moduleContext.moduleName} Requirements` : 'Module Requirements'}
          </h1>
          <p className="mt-1 text-sm text-sidebar-foreground">Define and track the specifications for this module.</p>
        </div>
        {allowCreate && (
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Requirement
          </button>
        )}
      </div>

      {requirements.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-sidebar/50">
          <FileText className="mb-4 h-10 w-10 text-sidebar-foreground opacity-50" />
          <h3 className="text-lg font-medium text-foreground">No requirements yet</h3>
          <p className="mt-1 text-sm text-sidebar-foreground">Start defining the business logic for this module.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-sidebar shadow-sm">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-sidebar-accent">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-sidebar-foreground">ID</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-sidebar-foreground">Title</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-sidebar-foreground">Priority</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-sidebar-foreground">Criticality</th>
                <th scope="col" className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-sidebar-foreground">Tests</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-sidebar-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-sidebar">
              {requirements.map((req) => (
                <tr key={req.id} className="transition-colors hover:bg-sidebar-accent/50">
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-foreground">{req.reqId}</td>
                  <td className="max-w-xs truncate px-6 py-4 text-sm text-sidebar-foreground" title={req.title}>{req.title}</td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${PRIORITY_BADGE[req.priority]}`}>
                      {req.priority}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-sidebar-foreground">{req.businessCriticality}</td>
                  <td className="whitespace-nowrap px-6 py-4 text-center text-sm text-sidebar-foreground">{req._count?.testCases ?? 0}</td>
                  <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                    {allowCreate && (
                      <button
                        type="button"
                        onClick={() => handleAiGenerate(req.id)}
                        disabled={aiLoadingId === req.id}
                        className="inline-flex items-center gap-1 rounded bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                        title="Synthesize 3-5 verified test cases with AI QA Brain"
                      >
                        {aiLoadingId === req.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3" />
                        )}
                        AI Tests
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {moduleId && allowCreate && (
        <CreateRequirementModal
          moduleId={moduleId}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSuccess={handleRequirementCreated}
        />
      )}
    </div>
  );
}
