import { useEffect, useState } from 'react';
import { Camera, FileText, Download, CheckCircle2, XCircle, Clock, Loader2, AlertCircle } from 'lucide-react';
import { getProjects, type Project } from '@/lib/api/projects';
import { getProjectEvidence, type ExecutionEvidenceItem } from '@/lib/api/evidence';

export default function EvidenceExplorerPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [evidenceList, setEvidenceList] = useState<ExecutionEvidenceItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<ExecutionEvidenceItem | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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
    if (!selectedProjectId) {
      setEvidenceList([]);
      setSelectedItem(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    getProjectEvidence(selectedProjectId)
      .then((data) => {
        setEvidenceList(data);
        if (data.length > 0) {
          setSelectedItem(data[0]);
        } else {
          setSelectedItem(null);
        }
      })
      .catch((err: any) => {
        setError(err.response?.data?.error || err.message || 'Failed to load evidence records');
      })
      .finally(() => setIsLoading(false));
  }, [selectedProjectId]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500">
              <Camera className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                Evidence Explorer <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-500 font-mono">Artifacts</span>
              </h1>
              <p className="text-sm text-sidebar-foreground">
                Centralized archive of Playwright screenshots, network HAR logs, execution traces, and DOM snapshots.
              </p>
            </div>
          </div>
        </div>

        <div className="w-full sm:w-64">
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-500 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Master-Detail Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Execution List */}
        <div className="lg:col-span-5 space-y-3">
          <div className="rounded-xl border border-border bg-sidebar overflow-hidden shadow-sm">
            <div className="p-3 border-b border-border bg-sidebar-accent/50 text-xs font-semibold text-sidebar-foreground uppercase tracking-wider">
              Execution Runs ({evidenceList.length})
            </div>

            {isLoading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : evidenceList.length === 0 ? (
              <div className="p-8 text-center text-xs text-sidebar-foreground">
                No automation executions recorded for this project yet.
              </div>
            ) : (
              <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
                {evidenceList.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setSelectedItem(item)}
                    className={`p-4 transition-colors cursor-pointer text-left hover:bg-sidebar-accent/50 ${
                      selectedItem?.id === item.id ? 'bg-sidebar-accent border-l-4 border-indigo-500' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="font-mono font-bold text-foreground">Run #{item.runId}</span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                          item.status === 'PASSED'
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : 'bg-red-500/10 text-red-500'
                        }`}
                      >
                        {item.status === 'PASSED' ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                        {item.status}
                      </span>
                    </div>

                    <p className="text-xs text-sidebar-foreground font-medium truncate mb-1">
                      {item.projectName} • {item.environmentName}
                    </p>

                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(item.createdAt).toLocaleDateString()} {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span>{item.artifacts.length} artifact(s)</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Artifacts & Evidence Inspection */}
        <div className="lg:col-span-7">
          <div className="rounded-xl border border-border bg-sidebar p-6 shadow-sm min-h-[500px]">
            {!selectedItem ? (
              <div className="flex h-96 flex-col items-center justify-center gap-2 text-center text-sidebar-foreground">
                <Camera className="h-10 w-10 opacity-30 text-indigo-500" />
                <h3 className="text-sm font-semibold text-foreground">No Execution Run Selected</h3>
                <p className="text-xs max-w-sm">
                  Select a test execution from the left roster to inspect forensic screenshots, step-by-step logs, and execution traces.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-500">Forensic Evidence</span>
                    <h2 className="text-lg font-bold text-foreground">Run #{selectedItem.runId} Artifact Archive</h2>
                    <p className="text-xs text-sidebar-foreground mt-0.5">
                      {selectedItem.projectName} • {selectedItem.environmentName} • Trigger: {selectedItem.trigger}
                    </p>
                  </div>

                  <div className="text-right">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-bold ${
                        selectedItem.status === 'PASSED'
                          ? 'bg-emerald-500/10 text-emerald-500'
                          : 'bg-red-500/10 text-red-500'
                      }`}
                    >
                      {selectedItem.status}
                    </span>
                    <div className="text-xs text-sidebar-foreground mt-1">
                      {selectedItem.passedCount} passed / {selectedItem.failedCount} failed
                    </div>
                  </div>
                </div>

                {/* Evidence Artifacts Grid */}
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    Captured Artifacts ({selectedItem.artifacts.length})
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectedItem.artifacts.map((art) => (
                      <div
                        key={art.id}
                        className="rounded-lg border border-border bg-background p-4 flex flex-col justify-between space-y-3 hover:border-indigo-500/40 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <div className="p-2 rounded bg-sidebar border border-border text-indigo-500">
                            {art.type === 'screenshot' ? (
                              <Camera className="h-5 w-5" />
                            ) : (
                              <FileText className="h-5 w-5" />
                            )}
                          </div>
                          <div className="overflow-hidden">
                            <h4 className="text-xs font-semibold text-foreground truncate" title={art.name}>
                              {art.name}
                            </h4>
                            <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wider">
                              {art.type} {art.sizeBytes ? `• ${(art.sizeBytes / 1024).toFixed(1)} KB` : ''}
                            </span>
                          </div>
                        </div>

                        {art.type === 'screenshot' && (
                          <div className="w-full h-32 rounded bg-sidebar flex items-center justify-center border border-border/50 overflow-hidden">
                            <div className="text-center p-3">
                              <Camera className="h-8 w-8 mx-auto text-muted-foreground/40 mb-1" />
                              <span className="text-[10px] text-muted-foreground">Failure Viewport Snapshot</span>
                            </div>
                          </div>
                        )}

                        <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
                          <span className="text-muted-foreground text-[10px]">Secure Storage Bucket</span>
                          <a
                            href={art.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-semibold text-indigo-500 hover:text-indigo-400"
                          >
                            <Download className="h-3 w-3" /> View
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Associated Root Cause Telemetry */}
                {selectedItem.rootCauseHypothesis && (
                  <div className="p-4 rounded-lg bg-background border border-border space-y-1">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                      Diagnostic Hypothesis
                    </span>
                    <p className="text-xs text-foreground leading-relaxed">
                      {selectedItem.rootCauseHypothesis}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
