import { useEffect, useState } from 'react';
import { Sparkles, Bot, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { getProjects, type Project } from '@/lib/api/projects';
import { api } from '@/lib/api-client';
import { generateTestCases, type GeneratedTestCaseDraft } from '@/lib/api/ai';

interface RequirementOption {
  id: string;
  reqId: string;
  title: string;
  description: string;
}

export default function AiQaBrainPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [requirements, setRequirements] = useState<RequirementOption[]>([]);
  const [selectedReqId, setSelectedReqId] = useState<string>('');
  const [selectedReq, setSelectedReq] = useState<RequirementOption | null>(null);

  const [autoSave, setAutoSave] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<GeneratedTestCaseDraft[]>([]);
  const [savedCases, setSavedCases] = useState<any[]>([]);

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
      setRequirements([]);
      setSelectedReqId('');
      setSelectedReq(null);
      return;
    }

    // Fetch traceability / requirements for this project
    api
      .get(`/projects/${selectedProjectId}/traceability`)
      .then((res: any) => {
        const matrix = res.data?.matrix || [];
        const reqs = matrix.map((item: any) => ({
          id: item.requirement.id,
          reqId: item.requirement.reqId,
          title: item.requirement.title,
          description: item.requirement.description || '',
        }));
        setRequirements(reqs);
        if (reqs.length > 0) {
          setSelectedReqId(reqs[0].id);
          setSelectedReq(reqs[0]);
        } else {
          setSelectedReqId('');
          setSelectedReq(null);
        }
      })
      .catch(() => {
        setRequirements([]);
        setSelectedReqId('');
        setSelectedReq(null);
      });
  }, [selectedProjectId]);

  const handleRequirementChange = (reqId: string) => {
    setSelectedReqId(reqId);
    const found = requirements.find((r) => r.id === reqId) || null;
    setSelectedReq(found);
  };

  const handleGenerate = async () => {
    if (!selectedReqId) {
      setError('Please select a requirement to analyze.');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await generateTestCases(selectedReqId, autoSave);
      setDrafts(response.drafts || []);
      setSavedCases(response.savedTestCases || []);
      if (response.savedTestCases && response.savedTestCases.length > 0) {
        setSuccessMessage(
          `Successfully synthesized ${response.savedTestCases.length} verified test cases directly into the test suite!`,
        );
      } else {
        setSuccessMessage(`Synthesized ${response.drafts.length} test case drafts.`);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to generate test cases');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Bot className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                AI QA Brain <span className="text-xs px-2 py-0.5 rounded bg-primary/20 text-primary">Intelligence</span>
              </h1>
              <p className="text-sm text-sidebar-foreground">
                Autonomous test case generation, requirement gap detection, and test synthesis.
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

      {/* Control Panel */}
      <div className="rounded-xl border border-border bg-sidebar p-6 shadow-sm space-y-4">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> Target Specification Input
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-sidebar-foreground mb-1">Select Project</label>
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

          <div>
            <label className="block text-xs font-medium text-sidebar-foreground mb-1">Select Requirement</label>
            <select
              value={selectedReqId}
              onChange={(e) => handleRequirementChange(e.target.value)}
              disabled={requirements.length === 0}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            >
              {requirements.length === 0 ? (
                <option value="">No requirements found for this project</option>
              ) : (
                requirements.map((r) => (
                  <option key={r.id} value={r.id}>
                    [{r.reqId}] {r.title}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {selectedReq && (
          <div className="mt-4 p-4 rounded-lg bg-background border border-border space-y-2">
            <div className="flex items-center justify-between text-xs text-sidebar-foreground">
              <span className="font-mono text-primary font-semibold">{selectedReq.reqId}</span>
              <span className="text-muted-foreground">Specification Context</span>
            </div>
            <h3 className="text-sm font-medium text-foreground">{selectedReq.title}</h3>
            <p className="text-xs text-sidebar-foreground whitespace-pre-wrap">
              {selectedReq.description || 'No detailed description provided.'}
            </p>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
          <label className="flex items-center gap-2 text-sm text-sidebar-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={autoSave}
              onChange={(e) => setAutoSave(e.target.checked)}
              className="rounded border-border text-primary focus:ring-primary"
            />
            <span>Auto-save generated test cases to project test suite (TC-NNN)</span>
          </label>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating || !selectedReqId}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Synthesizing Tests...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" /> Synthesize Test Cases
              </>
            )}
          </button>
        </div>
      </div>

      {/* Generated Test Cases Output */}
      {drafts.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              Generated Test Suite ({drafts.length} Cases)
            </h2>
            {savedCases.length > 0 && (
              <span className="text-xs font-medium text-emerald-500 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                All Persisted as Active Tests
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4">
            {drafts.map((draft, idx) => {
              const saved = savedCases[idx];
              return (
                <div
                  key={idx}
                  className="rounded-xl border border-border bg-sidebar p-5 shadow-sm space-y-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary">
                          {saved ? saved.tcId : `Draft #${idx + 1}`}
                        </span>
                        <h3 className="text-sm font-semibold text-foreground">{draft.title}</h3>
                      </div>
                      <p className="text-xs text-sidebar-foreground mt-1">{draft.description}</p>
                    </div>
                  </div>

                  {draft.preconditions && (
                    <div className="text-xs text-muted-foreground bg-background p-2.5 rounded border border-border">
                      <strong className="text-foreground">Preconditions: </strong>
                      {draft.preconditions}
                    </div>
                  )}

                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="min-w-full divide-y divide-border text-xs">
                      <thead className="bg-sidebar-accent">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-sidebar-foreground w-12">Step</th>
                          <th className="px-4 py-2 text-left font-medium text-sidebar-foreground">Action</th>
                          <th className="px-4 py-2 text-left font-medium text-sidebar-foreground">Expected Result</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-sidebar">
                        {draft.steps.map((st) => (
                          <tr key={st.stepNumber}>
                            <td className="px-3 py-2 text-muted-foreground font-mono">{st.stepNumber}</td>
                            <td className="px-4 py-2 text-foreground">{st.action}</td>
                            <td className="px-4 py-2 text-sidebar-foreground">{st.expectedResult}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
