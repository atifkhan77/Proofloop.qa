import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import { ArrowLeft, Loader2, AlertCircle, Plus, Send } from 'lucide-react';
import {
  getApiCollection,
  getApiRequests,
  createApiRequest,
  getApiExecution,
  type ApiCollectionDetail,
  type ApiExecution,
  type ApiRequest,
  type CreateApiRequestData,
} from '@/lib/api/api-intelligence';
import { getEnvironments, type Environment } from '@/lib/api/automation';
import RunRequestModal from '@/components/api-intelligence/RunRequestModal';
import ExecutionConsole from '@/components/api-intelligence/ExecutionConsole';

const POLL_INTERVAL_MS = 1000;
const POLL_MAX_ATTEMPTS = 60;
import { getApiErrorMessage, getApiStatus } from '@/lib/api-error';
import { canManageApiIntelligence } from '@/lib/permissions';
import { useAuth } from '@/contexts/auth-context';
import RequestBuilderForm from '@/components/api-intelligence/RequestBuilderForm';
import RequestDetails from '@/components/api-intelligence/RequestDetails';
import { METHOD_COLORS } from '@/components/api-intelligence/method-colors';

export default function ApiCollectionDetailPage() {
  const { collectionId } = useParams<{ collectionId: string }>();
  const { user } = useAuth();
  const allowCreate = canManageApiIntelligence(user?.role);

  const [collection, setCollection] = useState<ApiCollectionDetail | null>(null);
  const [requests, setRequests] = useState<ApiRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environmentsFailed, setEnvironmentsFailed] = useState(false);
  const [runTarget, setRunTarget] = useState<{ id: string; name: string; endpoint: string } | null>(null);
  // Latest run per request, so switching requests never shows another request's result.
  const [results, setResults] = useState<Record<string, ApiExecution>>({});

  useEffect(() => {
    const fetchData = async () => {
      if (!collectionId) return;
      try {
        const [collectionData, requestData] = await Promise.all([getApiCollection(collectionId), getApiRequests(collectionId)]);
        setCollection(collectionData);
        setRequests(requestData);
        try {
          setEnvironments(await getEnvironments(collectionData.project.id));
        } catch {
          setEnvironmentsFailed(true); // page still usable; the run dialog says so
        }
      } catch (err) {
        setError(getApiStatus(err) === 404 ? 'API Collection not found' : 'Failed to load requests');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [collectionId]);

  // Poll runs that are not finished. Execution is synchronous today, so results normally arrive
  // final and this does nothing; it keeps the UI ready for queued execution. Cleared on unmount.
  const pendingIds = Object.values(results)
    .filter((r) => r.status === 'PENDING')
    .map((r) => r.id)
    .join(',');
  useEffect(() => {
    if (!pendingIds) return;
    let cancelled = false;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      const ids = pendingIds.split(',');
      const latest = await Promise.all(ids.map((id) => getApiExecution(id).catch(() => null)));
      if (cancelled) return;
      setResults((prev) => {
        const next = { ...prev };
        for (const execution of latest) if (execution) next[execution.requestId] = execution;
        return next;
      });
      if (attempts >= POLL_MAX_ATTEMPTS) clearInterval(timer);
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pendingIds]);

  const handleExecuted = (execution: ApiExecution) => {
    setResults((prev) => ({ ...prev, [execution.requestId]: execution }));
  };

  const selected = requests.find((r) => r.id === selectedId) ?? null;

  const startCreate = () => {
    setSelectedId(null);
    setServerError(null);
    setIsCreating(true); // RequestBuilderForm mounts fresh, so the form starts empty
  };

  const selectRequest = (id: string) => {
    setIsCreating(false);
    setSelectedId(id);
  };

  const handleCreate = async (payload: CreateApiRequestData) => {
    if (!collectionId) return;
    try {
      setServerError(null);
      const created = await createApiRequest(collectionId, payload);
      setRequests((prev) => [...prev, created]); // server appends (highest sequence number)
      setIsCreating(false);
      setSelectedId(created.id);
    } catch (err) {
      setServerError(getApiErrorMessage(err, 'Failed to save request'));
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center" role="status" aria-label="Loading API requests">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !collection) {
    return (
      <div className="space-y-4">
        <Link to="/api-collections" className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to API Intelligence
        </Link>
        <div className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-4 text-red-500" role="alert">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{error ?? 'Failed to load requests'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link
        to={`/projects/${collection.project.id}/api-collections`}
        className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to {collection.project.name} collections
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{collection.name}</h1>
        {collection.description && <p className="mt-1 text-sm text-sidebar-foreground">{collection.description}</p>}
      </div>

      {/* Master-detail: stacked on small screens, side by side from md. */}
      <div className="flex min-h-[600px] flex-col overflow-hidden rounded-xl border border-border md:h-[calc(100vh-14rem)] md:flex-row">
        <nav aria-label="API requests" className="flex max-h-72 shrink-0 flex-col border-b border-border bg-sidebar/30 md:max-h-none md:w-72 md:border-r md:border-b-0">
          <div className="flex items-center justify-between border-b border-border bg-sidebar p-4">
            <span className="font-bold text-foreground">API Requests</span>
            {allowCreate && (
              <button
                type="button"
                onClick={startCreate}
                aria-label="New request"
                className="rounded-md p-1 text-sidebar-foreground transition-colors hover:bg-primary/10 hover:text-primary"
              >
                <Plus className="h-5 w-5" aria-hidden="true" />
              </button>
            )}
          </div>
          <ul className="flex-1 space-y-1 overflow-y-auto p-2">
            {requests.length === 0 && !isCreating && (
              <li className="p-4 text-center text-xs text-sidebar-foreground">
                {allowCreate ? 'No requests. Click + to build one.' : 'No requests yet.'}
              </li>
            )}
            {requests.map((req) => {
              const active = selectedId === req.id && !isCreating;
              return (
                <li key={req.id}>
                  <button
                    type="button"
                    onClick={() => selectRequest(req.id)}
                    aria-current={active ? 'true' : undefined}
                    className={`flex w-full items-center space-x-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      active ? 'bg-primary/10 text-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent'
                    }`}
                  >
                    <span className={`w-12 shrink-0 text-[10px] font-bold ${METHOD_COLORS[req.method]}`}>{req.method}</span>
                    <span className="truncate font-medium">{req.name}</span>
                  </button>
                </li>
              );
            })}
            {isCreating && (
              <li className="flex w-full items-center space-x-3 rounded-md bg-primary/10 px-3 py-2 text-left text-sm text-foreground">
                <span className="w-12 text-[10px] font-bold text-sidebar-foreground">NEW</span>
                <span className="truncate font-medium italic">Unsaved Request...</span>
              </li>
            )}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
          {isCreating ? (
            <RequestBuilderForm onSubmit={handleCreate} onCancel={() => setIsCreating(false)} serverError={serverError} />
          ) : selected ? (
            <div className="flex-1 overflow-y-auto">
              <RequestDetails
                request={selected}
                onRun={allowCreate ? () => setRunTarget({ id: selected.id, name: selected.name, endpoint: selected.endpoint }) : undefined}
                isRunning={results[selected.id]?.status === 'PENDING'}
              />
              {results[selected.id] && <ExecutionConsole execution={results[selected.id]} />}
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-sidebar-foreground">
              <Send className="mb-4 h-12 w-12 opacity-20" aria-hidden="true" />
              <h2 className="text-xl font-medium text-foreground">API Workspace</h2>
              <p className="mt-1 text-sm">
                {allowCreate ? 'Select a request from the list or create a new one.' : 'Select a request from the list.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {allowCreate && (
        <RunRequestModal
          target={runTarget}
          environments={environments}
          environmentsFailed={environmentsFailed}
          onClose={() => setRunTarget(null)}
          onExecuted={handleExecuted}
        />
      )}
    </div>
  );
}
