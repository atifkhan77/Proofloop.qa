import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import { Network, ArrowLeft, Loader2, AlertCircle, Plus, FolderGit2 } from 'lucide-react';
import { getApiCollections, createApiCollection, type ApiCollection } from '@/lib/api/api-intelligence';
import { getProject } from '@/lib/api/projects';
import { useAuth } from '@/contexts/auth-context';
import { canManageApiIntelligence } from '@/lib/permissions';
import { getApiErrorMessage, getApiStatus } from '@/lib/api-error';

const inputClass =
  'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export default function ProjectApiCollectionsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();

  const [collections, setCollections] = useState<ApiCollection[]>([]);
  const [projectName, setProjectName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [newColDesc, setNewColDesc] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const allowCreate = canManageApiIntelligence(user?.role);

  useEffect(() => {
    const fetchData = async () => {
      if (!projectId) return;
      try {
        const [colData, projData] = await Promise.all([getApiCollections(projectId), getProject(projectId)]);
        setCollections(colData);
        setProjectName(projData.name);
      } catch (err) {
        setError(getApiStatus(err) === 404 ? 'Project not found' : 'Failed to load API Collections');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [projectId]);

  const closeForm = () => {
    setIsCreating(false);
    setNewColName('');
    setNewColDesc('');
    setNameError(null);
    setCreateError(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    // Mirrors the API rule (trim, then required), so "   " gets a message instead of a silent no-op.
    if (!newColName.trim()) {
      setNameError('Collection name is required');
      return;
    }
    try {
      setIsSaving(true);
      setNameError(null);
      setCreateError(null);
      const newCol = await createApiCollection(projectId, { name: newColName, description: newColDesc });
      setCollections((prev) =>
        [...prev, { ...newCol, _count: { requests: 0 } }].sort((a, b) => a.name.localeCompare(b.name)),
      );
      closeForm();
    } catch (err) {
      setCreateError(getApiErrorMessage(err, 'Failed to create collection'));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center" role="status" aria-label="Loading API collections">
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">API Intelligence</h1>
          <p className="mt-1 text-sm text-sidebar-foreground">Design state-aware API test collections and assertions.</p>
        </div>
        {allowCreate && !isCreating && (
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> New Collection
          </button>
        )}
      </div>

      {isCreating && (
        <section aria-labelledby="create-collection-title" className="rounded-xl border border-border bg-sidebar p-5 shadow-sm">
          <h2 id="create-collection-title" className="mb-4 text-lg font-semibold text-foreground">Create API Collection</h2>
          {createError && (
            <div className="mb-4 flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-red-500" role="alert">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span className="text-sm font-medium">{createError}</span>
            </div>
          )}
          <form onSubmit={handleCreate} className="max-w-lg space-y-4" noValidate>
            <div>
              <label htmlFor="col-name" className="block text-sm font-medium text-foreground">Collection Name</label>
              <input
                id="col-name"
                value={newColName}
                onChange={(e) => setNewColName(e.target.value)}
                aria-invalid={!!nameError}
                className={inputClass}
                autoComplete="off"
                autoFocus
              />
              {nameError && <p className="mt-1 text-xs text-red-500">{nameError}</p>}
            </div>
            <div>
              <label htmlFor="col-desc" className="block text-sm font-medium text-foreground">Description (Optional)</label>
              <textarea id="col-desc" rows={2} value={newColDesc} onChange={(e) => setNewColDesc(e.target.value)} className={`${inputClass} resize-none`} />
            </div>
            <div className="flex space-x-3 pt-2">
              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Save Collection
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-md px-4 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {collections.length === 0 ? (
        !isCreating && (
          <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-sidebar/50">
            <Network className="mb-4 h-10 w-10 text-sidebar-foreground opacity-50" />
            <h3 className="text-lg font-medium text-foreground">No API Collections</h3>
            <p className="mt-1 text-sm text-sidebar-foreground">Group your API tests into logical flows.</p>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {collections.map((col) => {
            const count = col._count?.requests ?? 0;
            return (
              <Link
                key={col.id}
                to={`/api-collections/${col.id}`}
                className="group flex flex-col justify-between rounded-xl border border-border bg-sidebar p-5 shadow-sm transition-all hover:border-primary/50 hover:shadow-md"
              >
                <div>
                  <div className="mb-2 flex items-center space-x-3">
                    <FolderGit2 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    <h3 className="truncate font-semibold text-foreground">{col.name}</h3>
                  </div>
                  {col.description && <p className="line-clamp-2 text-sm text-sidebar-foreground">{col.description}</p>}
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-xs text-sidebar-foreground">
                  <span>
                    {count} {count === 1 ? 'Request' : 'Requests'}
                  </span>
                  <span className="font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">Open Builder &rarr;</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
