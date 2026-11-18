import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router';
import { ArrowLeft, Loader2, AlertCircle, Plus, Bug, Search } from 'lucide-react';
import { getProjectDefectsPage, type Defect, type DefectSeverity, type DefectStatus } from '@/lib/api/defects';
import { getProject } from '@/lib/api/projects';
import { useAuth } from '@/contexts/auth-context';
import { canManageDefects } from '@/lib/permissions';
import { getApiStatus } from '@/lib/api-error';
import ManageDefectModal from '@/components/defects/ManageDefectModal';

const SEVERITY_STYLES: Record<DefectSeverity, string> = {
  CRITICAL: 'bg-red-500/10 text-red-500 border-red-500/20',
  HIGH: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  MEDIUM: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  LOW: 'bg-sidebar-accent text-sidebar-foreground border-border',
};

const STATUS_STYLES: Record<DefectStatus, string> = {
  OPEN: 'bg-red-500/10 text-red-500 border-red-500/20',
  IN_PROGRESS: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  IN_REVIEW: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  CLOSED: 'bg-green-500/10 text-green-500 border-green-500/20',
};

/** Server-side paging (PERF-03): large projects no longer download every defect. */
const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;

export default function ProjectDefectsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();

  const [defects, setDefects] = useState<Defect[]>([]);
  const [projectName, setProjectName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const requestSeq = useRef(0);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDefect, setEditingDefect] = useState<Defect | null>(null);

  const allowManage = canManageDefects(user?.role);

  useEffect(() => {
    if (!projectId) return;
    getProject(projectId)
      .then((p) => setProjectName(p.name))
      .catch(() => {}); // the defects request below reports 404 / failures
  }, [projectId]);

  // Search runs on the server: debounce typing, and start again at the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
      setOffset(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!projectId) return;
    const seq = ++requestSeq.current; // ignore responses that arrive after a newer request
    setIsPageLoading(true);
    getProjectDefectsPage(projectId, { limit: PAGE_SIZE, offset, q: debouncedQuery || undefined })
      .then((page) => {
        if (seq !== requestSeq.current) return;
        setDefects(page.items);
        setTotal(page.total);
        setError(null);
      })
      .catch((err) => {
        if (seq !== requestSeq.current) return;
        setError(getApiStatus(err) === 404 ? 'Project not found' : 'Failed to load defects');
      })
      .finally(() => {
        if (seq !== requestSeq.current) return;
        setIsLoading(false);
        setIsPageLoading(false);
      });
  }, [projectId, offset, debouncedQuery]);

  // Newest first on create (matches the API's createdAt desc ordering); replace in place on edit.
  const handleDefectSaved = (saved: Defect, isEdit: boolean) => {
    if (isEdit) {
      setDefects((prev) => prev.map((d) => (d.id === saved.id ? saved : d)));
      return;
    }
    setTotal((t) => t + 1);
    if (offset === 0) setDefects((prev) => [saved, ...prev].slice(0, PAGE_SIZE));
  };

  const closeModal = useCallback(() => setIsModalOpen(false), []);

  const openCreateModal = () => {
    setEditingDefect(null);
    setIsModalOpen(true);
  };

  const openEditModal = (defect: Defect) => {
    setEditingDefect(defect);
    setIsModalOpen(true);
  };

  const query = debouncedQuery;
  const filteredDefects = defects;
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + defects.length, total);

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center" role="status" aria-label="Loading defects">
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

      <div className="flex flex-col justify-between gap-4 border-b border-border pb-5 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Defect Intelligence</h1>
          <p className="mt-1 text-sm text-sidebar-foreground">Track and resolve active bugs across the project.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sidebar-foreground" aria-hidden="true" />
            <input
              type="search"
              aria-label="Search defects"
              placeholder="Search bugs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-4 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {allowManage && (
            <button
              type="button"
              onClick={openCreateModal}
              className="flex shrink-0 items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> Report Bug
            </button>
          )}
        </div>
      </div>

      {filteredDefects.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-sidebar/50">
          <Bug className="mb-4 h-10 w-10 text-sidebar-foreground opacity-50" aria-hidden="true" />
          <h3 className="text-lg font-medium text-foreground">No defects found</h3>
          <p className="mt-1 text-sm text-sidebar-foreground">
            {query ? 'Try adjusting your search.' : 'No defects have been reported for this project.'}
          </p>
        </div>
      ) : (
        // `relative`: the sr-only "Actions" header is position:absolute; without a positioned
        // ancestor here it escapes this scroll container and widens the whole page on phones.
        <div className="relative overflow-x-auto rounded-xl border border-border bg-sidebar shadow-sm">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-sidebar-accent text-left text-xs font-medium uppercase tracking-wider text-sidebar-foreground">
              <tr>
                <th scope="col" className="px-4 py-3">Bug ID &amp; Title</th>
                <th scope="col" className="px-4 py-3">Severity</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Reporter</th>
                <th scope="col" className="px-4 py-3">Assignee</th>
                {allowManage && (
                  <th scope="col" className="px-4 py-3 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-sidebar text-sm">
              {filteredDefects.map((defect) => (
                <tr key={defect.id} className="transition-colors hover:bg-sidebar-accent/50">
                  <td className="max-w-sm px-4 py-4 align-top">
                    <div className="font-bold text-foreground">{defect.bugId}</div>
                    <div className="truncate text-sidebar-foreground" title={defect.title}>{defect.title}</div>
                  </td>
                  <td className="px-4 py-4 align-top">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_STYLES[defect.severity]}`}>
                      {defect.severity}
                    </span>
                  </td>
                  <td className="px-4 py-4 align-top">
                    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[defect.status]}`}>
                      {defect.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 align-top text-sidebar-foreground">{fullName(defect.reporter)}</td>
                  <td className="whitespace-nowrap px-4 py-4 align-top text-sidebar-foreground">
                    {defect.assignee ? fullName(defect.assignee) : <span className="italic opacity-70">Unassigned</span>}
                  </td>
                  {allowManage && (
                    <td className="px-4 py-4 text-right align-top">
                      {/* Always visible (hover-only controls are unreachable on touch, cf. UI-08). */}
                      <button
                        type="button"
                        onClick={() => openEditModal(defect)}
                        aria-label={`Edit ${defect.bugId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <nav className="flex items-center justify-between text-sm text-sidebar-foreground" aria-label="Defect pages">
          <span aria-live="polite">
            {isPageLoading ? 'Loading…' : `Showing ${pageStart}–${pageEnd} of ${total}`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              disabled={offset === 0 || isPageLoading}
              className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-sidebar-accent disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total || isPageLoading}
              className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-sidebar-accent disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </nav>
      )}

      {projectId && allowManage && (
        <ManageDefectModal
          projectId={projectId}
          isOpen={isModalOpen}
          onClose={closeModal}
          onSuccess={handleDefectSaved}
          existingDefect={editingDefect}
        />
      )}
    </div>
  );
}
