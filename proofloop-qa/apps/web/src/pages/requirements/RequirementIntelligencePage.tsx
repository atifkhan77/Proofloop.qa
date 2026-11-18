import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  FileText,
  Loader2,
  AlertCircle,
  Network,
  CheckCircle2,
  FolderGit2,
  ArrowRight,
  ExternalLink,
  Search,
} from 'lucide-react';
import { getProjects, type Project } from '@/lib/api/projects';
import { getProjectRequirements, type RequirementSummary } from '@/lib/api/requirements';
import { getApiErrorMessage } from '@/lib/api-error';

export default function RequirementIntelligencePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [requirements, setRequirements] = useState<RequirementSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingReqs, setIsLoadingReqs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        setError(null);
        const data = await getProjects();
        setProjects(data);
        if (data.length > 0) {
          setSelectedProjectId(data[0].id);
        }
      } catch (err) {
        setError(getApiErrorMessage(err, 'Failed to load projects'));
      } finally {
        setIsLoading(false);
      }
    };
    fetchProjects();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setRequirements([]);
      return;
    }
    const fetchReqs = async () => {
      try {
        setIsLoadingReqs(true);
        const reqs = await getProjectRequirements(selectedProjectId);
        setRequirements(reqs);
      } catch (err) {
        setError(getApiErrorMessage(err, 'Failed to load project requirements'));
      } finally {
        setIsLoadingReqs(false);
      }
    };
    fetchReqs();
  }, [selectedProjectId]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  const filteredRequirements = requirements.filter((r) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase().trim();
    return r.reqId.toLowerCase().includes(q) || r.title.toLowerCase().includes(q);
  });

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center" role="status" aria-label="Loading requirements">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Requirement Intelligence
          </h1>
          <p className="mt-1 text-sm text-sidebar-foreground">
            Central hub for requirements, business criticality mapping, and end-to-end quality traceability.
          </p>
        </div>

        {projects.length > 0 && (
          <div className="flex items-center space-x-3">
            <span className="text-xs font-medium text-sidebar-foreground whitespace-nowrap">Active Project:</span>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              aria-label="Select Project"
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-4 text-red-500" role="alert">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-sidebar/50 text-center p-6">
          <FileText className="h-10 w-10 text-sidebar-foreground opacity-50 mb-3" />
          <h3 className="text-base font-semibold text-foreground">No Projects Found</h3>
          <p className="text-xs text-sidebar-foreground mt-1 max-w-sm">
            Create your first project to start documenting requirements and generating traceability matrices.
          </p>
          <Link
            to="/"
            className="mt-4 inline-flex items-center rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Go to Projects
          </Link>
        </div>
      ) : (
        <>
          {/* Quick Hub Navigation Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Traceability Matrix Card */}
            <div className="rounded-xl border border-border bg-sidebar p-5 shadow-sm flex flex-col justify-between hover:border-primary/50 transition-all">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                    <Network className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-semibold text-sidebar-foreground uppercase tracking-wider">Module 4</span>
                </div>
                <h3 className="text-base font-bold text-foreground">Traceability Matrix</h3>
                <p className="mt-1 text-xs text-sidebar-foreground">
                  Flattened multi-tier matrix joining Requirements → Risks → Test Cases → Active Defects.
                </p>
              </div>
              <Link
                to={`/projects/${selectedProjectId}/traceability`}
                className="mt-4 inline-flex items-center text-xs font-semibold text-primary hover:text-primary/80"
              >
                Open Traceability Matrix <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </div>

            {/* Release Quality Gate Card */}
            <div className="rounded-xl border border-border bg-sidebar p-5 shadow-sm flex flex-col justify-between hover:border-primary/50 transition-all">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10 text-green-400">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-semibold text-sidebar-foreground uppercase tracking-wider">Gate</span>
                </div>
                <h3 className="text-base font-bold text-foreground">Release Quality Gate</h3>
                <p className="mt-1 text-xs text-sidebar-foreground">
                  Real-time automated GO / NO-GO release gate enforcing 100% test coverage and zero critical bugs.
                </p>
              </div>
              <Link
                to={`/projects/${selectedProjectId}/releases`}
                className="mt-4 inline-flex items-center text-xs font-semibold text-primary hover:text-primary/80"
              >
                Evaluate Quality Gate <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </div>

            {/* Project Modules & Requirements Card */}
            <div className="rounded-xl border border-border bg-sidebar p-5 shadow-sm flex flex-col justify-between hover:border-primary/50 transition-all">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
                    <FolderGit2 className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-semibold text-sidebar-foreground uppercase tracking-wider">Modules</span>
                </div>
                <h3 className="text-base font-bold text-foreground">Project Workspace</h3>
                <p className="mt-1 text-xs text-sidebar-foreground">
                  Manage module hierarchy, author acceptance criteria, and map requirement risks.
                </p>
              </div>
              <Link
                to={`/projects/${selectedProjectId}`}
                className="mt-4 inline-flex items-center text-xs font-semibold text-primary hover:text-primary/80"
              >
                Go to Project Modules <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {/* Requirements Directory List */}
          <div className="rounded-xl border border-border bg-sidebar shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-5 border-b border-border gap-3">
              <div>
                <h2 className="text-base font-bold text-foreground">
                  Requirements Directory for {selectedProject?.name}
                </h2>
                <p className="text-xs text-sidebar-foreground">
                  {requirements.length} functional requirement(s) tracked in this project
                </p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sidebar-foreground" />
                <input
                  type="search"
                  placeholder="Filter requirements..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-md border border-border bg-background py-1.5 pl-9 pr-3 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>
            </div>

            {isLoadingReqs ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : filteredRequirements.length === 0 ? (
              <div className="p-8 text-center text-sm text-sidebar-foreground">
                {searchQuery ? 'No requirements match your filter.' : 'No requirements found for this project.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-sidebar-accent/50 text-xs font-semibold text-sidebar-foreground uppercase tracking-wider border-b border-border">
                    <tr>
                      <th className="px-5 py-3">Requirement ID</th>
                      <th className="px-5 py-3">Title</th>
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredRequirements.map((reqItem) => (
                      <tr key={reqItem.id} className="hover:bg-sidebar-accent/30 transition-colors">
                        <td className="px-5 py-3 font-mono font-bold text-foreground">
                          {reqItem.reqId}
                        </td>
                        <td className="px-5 py-3 font-medium text-foreground">
                          {reqItem.title}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Link
                            to={`/projects/${selectedProjectId}/traceability`}
                            className="inline-flex items-center text-xs font-semibold text-primary hover:text-primary/80"
                          >
                            Trace <ExternalLink className="ml-1 h-3 w-3" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
