import { useEffect, useState } from 'react';
import { Microscope, AlertTriangle, RefreshCw, CheckCircle, Loader2, ShieldAlert } from 'lucide-react';
import { getProjects, type Project } from '@/lib/api/projects';
import { api } from '@/lib/api-client';
import { getDefectRootCause, getExecutionRootCause, type RootCauseAnalysisResult } from '@/lib/api/ai';

interface DefectItem {
  id: string;
  bugId: string;
  title: string;
  severity: string;
  status: string;
  rootCauseHypothesis?: string | null;
}

interface ExecutionItem {
  id: string;
  runId: string;
  status: string;
  failedCount: number;
  passedCount: number;
  trigger: string;
  rootCauseHypothesis?: string | null;
  createdAt: string;
}

export default function RootCauseAnalyzerPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'defects' | 'executions'>('defects');

  const [defects, setDefects] = useState<DefectItem[]>([]);
  const [executions, setExecutions] = useState<ExecutionItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [selectedItemName, setSelectedItemName] = useState<string>('');

  const [isLoadingList, setIsLoadingList] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysis, setAnalysis] = useState<RootCauseAnalysisResult | null>(null);
  const [hypothesis, setHypothesis] = useState<string | null>(null);
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
    if (!selectedProjectId) return;
    setIsLoadingList(true);
    setAnalysis(null);
    setHypothesis(null);
    setSelectedId('');

    Promise.all([
      api.get(`/projects/${selectedProjectId}/defects`).catch(() => ({ data: [] })),
      api.get(`/projects/${selectedProjectId}/automation`).catch(() => ({ data: [] })),
    ])
      .then(([defectsRes, autoRes]) => {
        const dList = defectsRes.data || [];
        setDefects(dList);

        // Extract executions from automation projects
        const autoProjects = autoRes.data || [];
        const execs: ExecutionItem[] = [];
        autoProjects.forEach((ap: any) => {
          if (Array.isArray(ap.executions)) {
            ap.executions.forEach((ex: any) => {
              execs.push({
                id: ex.id,
                runId: ex.runId,
                status: ex.status,
                failedCount: ex.failedCount,
                passedCount: ex.passedCount,
                trigger: ex.trigger,
                rootCauseHypothesis: ex.rootCauseHypothesis,
                createdAt: ex.createdAt,
              });
            });
          }
        });
        setExecutions(execs);
      })
      .finally(() => setIsLoadingList(false));
  }, [selectedProjectId]);

  const handleSelectDefect = async (defect: DefectItem, forceRefresh = false) => {
    setSelectedId(defect.id);
    setSelectedItemName(`[${defect.bugId}] ${defect.title}`);
    setIsAnalyzing(true);
    setError(null);

    try {
      const res = await getDefectRootCause(defect.id, forceRefresh);
      setHypothesis(res.hypothesis || null);
      setAnalysis(res.analysis || null);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to inspect root cause');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSelectExecution = async (exec: ExecutionItem) => {
    setSelectedId(exec.id);
    setSelectedItemName(`[Run ${exec.runId}] Failure Diagnostic`);
    setIsAnalyzing(true);
    setError(null);

    try {
      const res = await getExecutionRootCause(exec.id);
      setHypothesis(res.hypothesis || null);
      setAnalysis(res.analysis || null);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to inspect execution root cause');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-red-500/10 text-red-500">
              <Microscope className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                Root Cause Analyzer <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-500 font-mono">Telemetry</span>
              </h1>
              <p className="text-sm text-sidebar-foreground">
                Deep failure diagnostics, automated culprit detection, and remediation planning.
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
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Master-Detail Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Failure Targets */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex rounded-lg border border-border bg-sidebar p-1">
            <button
              type="button"
              onClick={() => setActiveTab('defects')}
              className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${
                activeTab === 'defects'
                  ? 'bg-primary text-primary-foreground shadow'
                  : 'text-sidebar-foreground hover:text-foreground'
              }`}
            >
              Defects ({defects.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('executions')}
              className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${
                activeTab === 'executions'
                  ? 'bg-primary text-primary-foreground shadow'
                  : 'text-sidebar-foreground hover:text-foreground'
              }`}
            >
              Runs ({executions.length})
            </button>
          </div>

          <div className="rounded-xl border border-border bg-sidebar overflow-hidden shadow-sm">
            <div className="p-3 border-b border-border bg-sidebar-accent/50 text-xs font-semibold text-sidebar-foreground uppercase tracking-wider">
              {activeTab === 'defects' ? 'Logged Defects' : 'Automation Execution Runs'}
            </div>

            {isLoadingList ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : activeTab === 'defects' ? (
              defects.length === 0 ? (
                <div className="p-8 text-center text-xs text-sidebar-foreground">No defects recorded</div>
              ) : (
                <div className="divide-y divide-border max-h-[550px] overflow-y-auto">
                  {defects.map((def) => (
                    <div
                      key={def.id}
                      onClick={() => handleSelectDefect(def)}
                      className={`p-3.5 transition-colors cursor-pointer text-left hover:bg-sidebar-accent/50 ${
                        selectedId === def.id ? 'bg-sidebar-accent border-l-4 border-primary' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-mono font-bold text-foreground">{def.bugId}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/10 text-red-500">
                          {def.severity}
                        </span>
                      </div>
                      <p className="text-xs text-foreground font-medium truncate">{def.title}</p>
                      {def.rootCauseHypothesis && (
                        <span className="inline-block mt-1 text-[10px] text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                          Analyzed
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : executions.length === 0 ? (
              <div className="p-8 text-center text-xs text-sidebar-foreground">No automation runs found</div>
            ) : (
              <div className="divide-y divide-border max-h-[550px] overflow-y-auto">
                {executions.map((ex) => (
                  <div
                    key={ex.id}
                    onClick={() => handleSelectExecution(ex)}
                    className={`p-3.5 transition-colors cursor-pointer text-left hover:bg-sidebar-accent/50 ${
                      selectedId === ex.id ? 'bg-sidebar-accent border-l-4 border-primary' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-mono font-bold text-foreground">Run #{ex.runId}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          ex.status === 'PASSED'
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : 'bg-red-500/10 text-red-500'
                        }`}
                      >
                        {ex.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-sidebar-foreground">
                      <span>Failed: {ex.failedCount}</span>
                      <span>•</span>
                      <span>Passed: {ex.passedCount}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Diagnostic & Root Cause Report */}
        <div className="lg:col-span-7">
          <div className="rounded-xl border border-border bg-sidebar p-6 shadow-sm min-h-[500px]">
            {isAnalyzing ? (
              <div className="flex h-96 flex-col items-center justify-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm font-medium text-foreground">Executing deep telemetry & code analysis...</p>
                <p className="text-xs text-sidebar-foreground">Isolating failure pattern and stack trace anomalies</p>
              </div>
            ) : !selectedId ? (
              <div className="flex h-96 flex-col items-center justify-center gap-2 text-center text-sidebar-foreground">
                <Microscope className="h-10 w-10 opacity-30 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">No Failure Target Selected</h3>
                <p className="text-xs max-w-sm">
                  Select a defect or execution run from the left panel to trigger automated root-cause analysis.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-primary">Diagnostic Target</span>
                    <h2 className="text-base font-semibold text-foreground">{selectedItemName}</h2>
                  </div>

                  {activeTab === 'defects' && (
                    <button
                      type="button"
                      onClick={() => {
                        const def = defects.find((d) => d.id === selectedId);
                        if (def) handleSelectDefect(def, true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-background text-xs font-medium text-foreground hover:bg-sidebar-accent transition-colors"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Re-Analyze
                    </button>
                  )}
                </div>

                {/* Hypothesis Card */}
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                    <ShieldAlert className="h-4 w-4" /> Root Cause Hypothesis
                  </div>
                  <p className="text-sm text-foreground leading-relaxed">
                    {hypothesis || 'Diagnostic completed. Analyzing telemetry patterns.'}
                  </p>
                </div>

                {/* Structured Breakdown */}
                {analysis && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg border border-border bg-background space-y-1">
                      <span className="text-[10px] font-semibold text-sidebar-foreground uppercase tracking-wider">
                        Likely Culprit
                      </span>
                      <p className="text-xs font-semibold text-red-500">{analysis.likelyCulprit}</p>
                    </div>

                    <div className="p-4 rounded-lg border border-border bg-background space-y-1">
                      <span className="text-[10px] font-semibold text-sidebar-foreground uppercase tracking-wider">
                        Severity Assessment
                      </span>
                      <p className="text-xs font-semibold text-amber-500">{analysis.severityAssessment}</p>
                    </div>

                    <div className="md:col-span-2 p-4 rounded-lg border border-border bg-background space-y-2">
                      <span className="text-[10px] font-semibold text-sidebar-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> Recommended Action & Fix
                      </span>
                      <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                        {analysis.suggestedRemediation}
                      </p>
                    </div>
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
