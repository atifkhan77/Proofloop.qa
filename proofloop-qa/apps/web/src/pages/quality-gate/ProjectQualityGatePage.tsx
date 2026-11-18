import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Sliders,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  Bug,
  FileCheck,
  X,
} from 'lucide-react';
import {
  getQualityGateEvaluation,
  updateQualityGateConfig,
  type QualityGateEvaluation,
  type QualityGateConfig,
} from '@/lib/api/quality-gate';
import { getProject, type Project } from '@/lib/api/projects';
import { getApiErrorMessage } from '@/lib/api-error';
import { useAuth } from '@/contexts/auth-context';

export default function ProjectQualityGatePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [evaluation, setEvaluation] = useState<QualityGateEvaluation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [configForm, setConfigForm] = useState<Partial<QualityGateConfig>>({
    requireFullCoverage: false,
    requireCriticalRiskCoverage: true,
    maxActiveCriticalDefects: 0,
    maxActiveHighDefects: 2,
  });
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const canConfigure = user?.role === 'ADMIN' || user?.role === 'QA_LEAD';

  const fetchData = async () => {
    if (!projectId) return;
    try {
      setError(null);
      const [proj, evalData] = await Promise.all([
        getProject(projectId),
        getQualityGateEvaluation(projectId),
      ]);
      setProject(proj);
      setEvaluation(evalData);
      if (evalData.config) {
        setConfigForm({
          requireFullCoverage: evalData.config.requireFullCoverage,
          requireCriticalRiskCoverage: evalData.config.requireCriticalRiskCoverage,
          maxActiveCriticalDefects: evalData.config.maxActiveCriticalDefects,
          maxActiveHighDefects: evalData.config.maxActiveHighDefects,
        });
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to evaluate quality gate'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [projectId]);

  const handleReevaluate = async () => {
    if (!projectId) return;
    try {
      setIsEvaluating(true);
      setError(null);
      const updated = await getQualityGateEvaluation(projectId, true);
      setEvaluation(updated);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Re-evaluation failed'));
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    try {
      setIsSavingConfig(true);
      setConfigError(null);
      await updateQualityGateConfig(projectId, configForm);
      setIsConfigModalOpen(false);
      // Re-evaluate immediately with new config
      const updated = await getQualityGateEvaluation(projectId);
      setEvaluation(updated);
    } catch (err) {
      setConfigError(getApiErrorMessage(err, 'Failed to save quality gate configuration'));
    } finally {
      setIsSavingConfig(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center" role="status" aria-label="Loading quality gate">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !evaluation) {
    return (
      <div className="space-y-4">
        <Link to={`/projects/${projectId}`} className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to {project?.name || 'Project'}
        </Link>
        <div className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-4 text-red-500" role="alert">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{error || 'Unable to load quality gate evaluation'}</span>
        </div>
      </div>
    );
  }

  const { status, isReleaseReady, blockingReasons, criteria, metrics } = evaluation;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <Link to={`/projects/${projectId}`} className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground mb-3">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to {project?.name || 'Project'}
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Release Quality Gate
            </h1>
            <p className="mt-1 text-sm text-sidebar-foreground">
              Automated Go / No-Go decision engine based on requirement coverage, risk mitigation, and defect thresholds.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {canConfigure && (
              <button
                type="button"
                onClick={() => setIsConfigModalOpen(true)}
                className="inline-flex items-center rounded-md border border-border bg-sidebar px-3.5 py-2 text-sm font-medium text-foreground hover:bg-sidebar-accent transition-colors"
              >
                <Sliders className="mr-2 h-4 w-4 text-sidebar-foreground" />
                Configure Gate
              </button>
            )}
            <button
              type="button"
              disabled={isEvaluating}
              onClick={handleReevaluate}
              className="inline-flex items-center rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <RotateCcw className={`mr-2 h-4 w-4 ${isEvaluating ? 'animate-spin' : ''}`} />
              Re-evaluate
            </button>
          </div>
        </div>
      </div>

      {/* Big Go / No-Go Banner */}
      <div
        className={`rounded-2xl border p-8 shadow-sm transition-all ${
          isReleaseReady
            ? 'border-green-500/30 bg-green-500/10 text-green-500'
            : 'border-red-500/30 bg-red-500/10 text-red-500'
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center space-x-5">
            <div
              className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl ${
                isReleaseReady ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
              }`}
            >
              {isReleaseReady ? <CheckCircle2 className="h-10 w-10" /> : <XCircle className="h-10 w-10" />}
            </div>
            <div>
              <div className="flex items-center space-x-3">
                <span className="text-3xl font-extrabold tracking-tight">
                  {isReleaseReady ? 'RELEASE READY: GO' : 'RELEASE BLOCKED: NO-GO'}
                </span>
                <span
                  className={`rounded-full px-3 py-0.5 text-xs font-bold uppercase tracking-wider ${
                    isReleaseReady ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
                  }`}
                >
                  {status}
                </span>
              </div>
              <p className="mt-1 text-sm text-sidebar-foreground">
                {isReleaseReady
                  ? 'All quality gates passed. This build meets the criteria for production release.'
                  : `${blockingReasons.length} blocking criterion(s) must be resolved before release.`}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-sidebar-foreground font-semibold">Requirement Coverage</p>
            <p className="text-3xl font-bold text-foreground mt-0.5">{metrics.requirementCoverageRate}%</p>
          </div>
        </div>
      </div>

      {/* Blocking Reasons Box if NO-GO */}
      {!isReleaseReady && blockingReasons.length > 0 && (
        <div className="rounded-xl border border-red-500/20 bg-sidebar p-6 shadow-sm">
          <div className="flex items-center space-x-2 text-red-400 font-semibold mb-3">
            <ShieldAlert className="h-5 w-5" />
            <span>Blocking Conditions</span>
          </div>
          <ul className="space-y-2 list-disc list-inside text-sm text-foreground">
            {blockingReasons.map((reason, idx) => (
              <li key={idx} className="leading-relaxed">
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Quality Gate Criteria Cards */}
      <div>
        <h2 className="text-lg font-bold text-foreground mb-4">Gate Criteria Breakdown</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Requirement Coverage */}
          <div className="rounded-xl border border-border bg-sidebar p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground">
                Full Coverage
              </span>
              <FileCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xl font-bold text-foreground">{criteria.fullCoverage.current}</p>
              <p className="text-xs text-sidebar-foreground mt-1">
                {criteria.fullCoverage.required ? 'Strict 100% required' : 'Informational (not blocking)'}
              </p>
            </div>
            <div className="pt-2 border-t border-border flex items-center justify-between">
              <span className="text-xs text-sidebar-foreground">Status</span>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  criteria.fullCoverage.passed ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                }`}
              >
                {criteria.fullCoverage.passed ? 'Passed' : 'Failed'}
              </span>
            </div>
          </div>

          {/* Critical Risk Coverage */}
          <div className="rounded-xl border border-border bg-sidebar p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground">
                Critical Risks
              </span>
              <ShieldCheck className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-xl font-bold text-foreground">{criteria.criticalRisks.current}</p>
              <p className="text-xs text-sidebar-foreground mt-1">
                {criteria.criticalRisks.required ? 'All critical risks must be mitigated' : 'Optional'}
              </p>
            </div>
            <div className="pt-2 border-t border-border flex items-center justify-between">
              <span className="text-xs text-sidebar-foreground">Status</span>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  criteria.criticalRisks.passed ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                }`}
              >
                {criteria.criticalRisks.passed ? 'Passed' : 'Failed'}
              </span>
            </div>
          </div>

          {/* Critical Defects Threshold */}
          <div className="rounded-xl border border-border bg-sidebar p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground">
                Critical Defects
              </span>
              <Bug className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <p className="text-xl font-bold text-foreground">
                {criteria.criticalDefects.current} Active
              </p>
              <p className="text-xs text-sidebar-foreground mt-1">
                Max allowed: {criteria.criticalDefects.maxAllowed}
              </p>
            </div>
            <div className="pt-2 border-t border-border flex items-center justify-between">
              <span className="text-xs text-sidebar-foreground">Status</span>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  criteria.criticalDefects.passed ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                }`}
              >
                {criteria.criticalDefects.passed ? 'Passed' : 'Failed'}
              </span>
            </div>
          </div>

          {/* High Defects Threshold */}
          <div className="rounded-xl border border-border bg-sidebar p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground">
                High Defects
              </span>
              <Bug className="h-5 w-5 text-orange-500" />
            </div>
            <div>
              <p className="text-xl font-bold text-foreground">
                {criteria.highDefects.current} Active
              </p>
              <p className="text-xs text-sidebar-foreground mt-1">
                Max allowed: {criteria.highDefects.maxAllowed}
              </p>
            </div>
            <div className="pt-2 border-t border-border flex items-center justify-between">
              <span className="text-xs text-sidebar-foreground">Status</span>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  criteria.highDefects.passed ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                }`}
              >
                {criteria.highDefects.passed ? 'Passed' : 'Failed'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Configure Gate Modal */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="gate-config-title"
            className="w-full max-w-lg rounded-xl border border-border bg-sidebar p-6 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
              <h3 id="gate-config-title" className="text-lg font-bold text-foreground">
                Configure Release Quality Gate
              </h3>
              <button
                type="button"
                onClick={() => setIsConfigModalOpen(false)}
                className="text-sidebar-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {configError && (
              <div className="mb-4 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
                {configError}
              </div>
            )}

            <form onSubmit={handleSaveConfig} className="space-y-4">
              <div className="space-y-3">
                <label className="flex items-start space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={configForm.requireFullCoverage}
                    onChange={(e) =>
                      setConfigForm((prev) => ({ ...prev, requireFullCoverage: e.target.checked }))
                    }
                    className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <div>
                    <span className="text-sm font-medium text-foreground block">
                      Require 100% Requirement Coverage
                    </span>
                    <span className="text-xs text-sidebar-foreground block">
                      Block release if even a single requirement has 0 test cases or active critical bugs.
                    </span>
                  </div>
                </label>

                <label className="flex items-start space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={configForm.requireCriticalRiskCoverage}
                    onChange={(e) =>
                      setConfigForm((prev) => ({ ...prev, requireCriticalRiskCoverage: e.target.checked }))
                    }
                    className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <div>
                    <span className="text-sm font-medium text-foreground block">
                      Require Critical Risk Mitigation
                    </span>
                    <span className="text-xs text-sidebar-foreground block">
                      Block release if any high/critical risk is missing test coverage.
                    </span>
                  </div>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div>
                  <label htmlFor="gate-max-crit" className="block text-xs font-medium text-sidebar-foreground mb-1">
                    Max Active Critical Defects
                  </label>
                  <input
                    id="gate-max-crit"
                    type="number"
                    min="0"
                    value={configForm.maxActiveCriticalDefects ?? 0}
                    onChange={(e) =>
                      setConfigForm((prev) => ({
                        ...prev,
                        maxActiveCriticalDefects: parseInt(e.target.value, 10) || 0,
                      }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="gate-max-high" className="block text-xs font-medium text-sidebar-foreground mb-1">
                    Max Active High Defects
                  </label>
                  <input
                    id="gate-max-high"
                    type="number"
                    min="0"
                    value={configForm.maxActiveHighDefects ?? 2}
                    onChange={(e) =>
                      setConfigForm((prev) => ({
                        ...prev,
                        maxActiveHighDefects: parseInt(e.target.value, 10) || 0,
                      }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsConfigModalOpen(false)}
                  className="rounded-md px-4 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingConfig}
                  className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {isSavingConfig ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
