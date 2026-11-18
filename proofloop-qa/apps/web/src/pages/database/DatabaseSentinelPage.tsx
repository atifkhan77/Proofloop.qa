import { useEffect, useState } from 'react';
import { Database, ShieldCheck, Play, Key, AlertCircle, CheckCircle2, Loader2, Clock, Table } from 'lucide-react';
import { getProjects, type Project } from '@/lib/api/projects';
import { api } from '@/lib/api-client';
import {
  getDatabaseConnection,
  updateDatabaseConnection,
  executeSentinelQuery,
  type DatabaseConnectionInfo,
  type SentinelQueryResult,
} from '@/lib/api/database-sentinel';
import { useAuth } from '@/contexts/auth-context';
import { canManageDatabaseConnection } from '@/lib/permissions';

interface EnvironmentOption {
  id: string;
  name: string;
}

export default function DatabaseSentinelPage() {
  const { user } = useAuth();
  const canConfigure = canManageDatabaseConnection(user?.role);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [environments, setEnvironments] = useState<EnvironmentOption[]>([]);
  const [selectedEnvId, setSelectedEnvId] = useState<string>('');

  const [connInfo, setConnInfo] = useState<DatabaseConnectionInfo | null>(null);
  const [isEditingConn, setIsEditingConn] = useState<boolean>(false);
  const [newConnString, setNewConnString] = useState<string>('');

  const [query, setQuery] = useState<string>('SELECT 1 as sentinel_check, NOW() as current_timestamp;');
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [queryResult, setQueryResult] = useState<SentinelQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    getProjects()
      .then((data) => {
        setProjects(data);
        if (data.length > 0) {
          setSelectedProjectId(data[0].id);
        }
      })
      .catch(() => setError('Failed to load projects'));
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;

    api
      .get(`/projects/${selectedProjectId}/environments`)
      .then((res: any) => {
        const envs = res.data || [];
        setEnvironments(envs);
        if (envs.length > 0) {
          setSelectedEnvId(envs[0].id);
        } else {
          setSelectedEnvId('');
          setConnInfo(null);
        }
      })
      .catch(() => {
        setEnvironments([]);
        setSelectedEnvId('');
        setConnInfo(null);
      });
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedEnvId) {
      setConnInfo(null);
      return;
    }

    getDatabaseConnection(selectedEnvId)
      .then((info) => setConnInfo(info))
      .catch(() => setConnInfo(null));
  }, [selectedEnvId]);

  const handleUpdateConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEnvId) return;

    setError(null);
    setSuccessMessage(null);

    try {
      const updated = await updateDatabaseConnection(selectedEnvId, newConnString);
      setConnInfo(updated);
      setIsEditingConn(false);
      setNewConnString('');
      setSuccessMessage('Target database connection string updated securely.');
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to update connection string');
    }
  };

  const handleExecute = async () => {
    if (!selectedEnvId) {
      setError('Please select an environment first.');
      return;
    }
    if (!query.trim()) {
      setError('Please enter a SQL query.');
      return;
    }

    setIsExecuting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const result = await executeSentinelQuery(selectedEnvId, query);
      setQueryResult(result);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to execute query');
      setQueryResult(null);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
              <Database className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                Database Sentinel <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-500 font-mono">Read-Only Guard</span>
              </h1>
              <p className="text-sm text-sidebar-foreground">
                Safely inspect database state and verify end-to-end data persistence without mutating production records.
              </p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-500 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-500 text-sm">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Target Selector & Connection Bar */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-sidebar p-5 shadow-sm space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-sidebar-foreground">Target Scope</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-sidebar-foreground mb-1">Project</label>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-sidebar-foreground mb-1">Environment</label>
              <select
                value={selectedEnvId}
                onChange={(e) => setSelectedEnvId(e.target.value)}
                disabled={environments.length === 0}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              >
                {environments.length === 0 ? (
                  <option value="">No environments</option>
                ) : (
                  environments.map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.name}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-sidebar p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-sidebar-foreground">
              Target Connection State
            </h2>
            {canConfigure && (
              <button
                type="button"
                onClick={() => setIsEditingConn(!isEditingConn)}
                className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
              >
                <Key className="h-3 w-3" /> {isEditingConn ? 'Cancel' : 'Configure Connection'}
              </button>
            )}
          </div>

          {isEditingConn && canConfigure ? (
            <form onSubmit={handleUpdateConnection} className="space-y-2">
              <input
                type="password"
                placeholder="postgresql://user:password@host:5432/dbname"
                value={newConnString}
                onChange={(e) => setNewConnString(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="submit"
                  className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground font-semibold hover:bg-primary/90"
                >
                  Save Connection
                </button>
              </div>
            </form>
          ) : (
            <div className="flex items-center justify-between bg-background p-3 rounded-lg border border-border">
              <div className="flex items-center gap-2 text-xs">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                <span className="text-sidebar-foreground">
                  {connInfo?.hasConnectionString
                    ? 'Target PostgreSQL connection configured'
                    : 'No target database configured: queries are disabled until an admin or QA lead adds one'}
                </span>
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                {connInfo?.dbConnectionString || 'not configured'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* SQL Editor Console */}
      <div className="rounded-xl border border-border bg-sidebar p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">SQL Query Console</h2>
            <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
              STRICT READ-ONLY
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setQuery('SELECT 1 as test, NOW() as executed_at;')}
              className="text-[11px] px-2 py-1 rounded bg-background border border-border text-sidebar-foreground hover:text-foreground"
            >
              Ping Target
            </button>
            <button
              type="button"
              onClick={() => setQuery('SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\';')}
              className="text-[11px] px-2 py-1 rounded bg-background border border-border text-sidebar-foreground hover:text-foreground"
            >
              Inspect Tables
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background p-2 font-mono text-xs">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={4}
            className="w-full bg-transparent text-foreground focus:outline-none resize-none font-mono"
            placeholder="SELECT * FROM users LIMIT 10;"
          />
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-[11px] text-muted-foreground">
            Enforces strict AST guards: mutations (DROP, INSERT, UPDATE, DELETE, ALTER, TRUNCATE) are rejected immediately.
          </p>

          <button
            type="button"
            onClick={handleExecute}
            disabled={isExecuting || !selectedEnvId}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 py-2 text-xs font-semibold text-white shadow hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            {isExecuting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Querying Database...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" /> Run Sentinel Query
              </>
            )}
          </button>
        </div>
      </div>

      {/* Query Results */}
      {queryResult && (
        <div className="rounded-xl border border-border bg-sidebar p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-3">
              <Table className="h-4 w-4 text-emerald-500" />
              <h3 className="text-sm font-semibold text-foreground">Query Execution Results</h3>
              <span className="text-xs text-sidebar-foreground font-mono">
                {queryResult.rowCount} row(s) returned
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {queryResult.durationMs !== undefined && (
                <span className="flex items-center gap-1 font-mono">
                  <Clock className="h-3 w-3" /> {queryResult.durationMs}ms
                </span>
              )}
              <span>{queryResult.environmentName}</span>
            </div>
          </div>

          {queryResult.rows.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              Query completed with 0 matching rows.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full divide-y divide-border text-xs">
                <thead className="bg-sidebar-accent">
                  <tr>
                    {(queryResult.fields && queryResult.fields.length > 0
                      ? queryResult.fields
                      : Object.keys(queryResult.rows[0])
                    ).map((col) => (
                      <th
                        key={col}
                        className="px-4 py-2 text-left font-mono font-semibold text-sidebar-foreground uppercase tracking-wider"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-background">
                  {queryResult.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-sidebar-accent/50 transition-colors">
                      {(queryResult.fields && queryResult.fields.length > 0
                        ? queryResult.fields
                        : Object.keys(queryResult.rows[0])
                      ).map((col) => (
                        <td key={col} className="px-4 py-2 text-foreground font-mono whitespace-nowrap">
                          {typeof row[col] === 'object' && row[col] !== null
                            ? JSON.stringify(row[col])
                            : String(row[col] ?? 'NULL')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
