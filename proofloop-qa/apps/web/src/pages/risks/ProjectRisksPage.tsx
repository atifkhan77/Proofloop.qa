import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import { ShieldAlert, ArrowLeft, Loader2, AlertCircle, Plus } from 'lucide-react';
import { getProjectRisks, type Risk, type RiskLevel } from '@/lib/api/risks';
import { getProject } from '@/lib/api/projects';
import { getProjectRequirements, type RequirementSummary } from '@/lib/api/requirements';
import { getApiStatus } from '@/lib/api-error';
import { canCreateRisk } from '@/lib/permissions';
import { useAuth } from '@/contexts/auth-context';
import CreateRiskModal from '@/components/risks/CreateRiskModal';

/** Project risk register; QA_ENGINEER and above can log new risks. */

const LEVEL_BADGE: Record<RiskLevel, string> = {
  CRITICAL: 'text-red-500 bg-red-500/10 border-red-500/20',
  HIGH: 'text-orange-500 bg-orange-500/10 border-orange-500/20',
  MEDIUM: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20',
  LOW: 'text-green-500 bg-green-500/10 border-green-500/20',
};

export default function ProjectRisksPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();
  const [risks, setRisks] = useState<Risk[]>([]);
  const [projectName, setProjectName] = useState('');
  const [requirements, setRequirements] = useState<RequirementSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const allowCreate = canCreateRisk(user?.role);

  useEffect(() => {
    const fetchData = async () => {
      if (!projectId) return;
      try {
        const [risksData, projectData, reqsData] = await Promise.all([
          getProjectRisks(projectId),
          getProject(projectId),
          getProjectRequirements(projectId),
        ]);
        setRisks(risksData);
        setProjectName(projectData.name);
        setRequirements(reqsData);
      } catch (err) {
        setError(getApiStatus(err) === 404 ? 'Project not found' : 'Failed to load risks');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [projectId]);

  // Keep the API's order: riskScore desc, then newest first (stable sort keeps the
  // just-created risk ahead of older equal-score ones).
  const handleRiskCreated = (newRisk: Risk) => {
    setRisks((prev) => [newRisk, ...prev].sort((a, b) => b.riskScore - a.riskScore));
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center" role="status" aria-label="Loading risks">
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

      <div className="flex items-center justify-between border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Risk Register</h1>
          <p className="mt-1 text-sm text-sidebar-foreground">Project-wide risk analysis and mitigation tracking.</p>
        </div>
        {allowCreate && (
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Risk
          </button>
        )}
      </div>

      {risks.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-sidebar/50">
          <ShieldAlert className="mb-4 h-10 w-10 text-sidebar-foreground opacity-50" />
          <h3 className="text-lg font-medium text-foreground">No risks identified</h3>
          <p className="mt-1 text-sm text-sidebar-foreground">Risks logged against requirements will appear here.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-sidebar shadow-sm">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-sidebar-accent">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-sidebar-foreground">Level</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-sidebar-foreground">Risk</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-sidebar-foreground">Requirement</th>
                <th scope="col" className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-sidebar-foreground">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-sidebar">
              {risks.map((risk) => (
                <tr key={risk.id} className="transition-colors hover:bg-sidebar-accent/50">
                  <td className="whitespace-nowrap px-6 py-4">
                    <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold ${LEVEL_BADGE[risk.level]}`}>
                      {risk.level}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-foreground">{risk.title}</div>
                    <div className="mt-1 max-w-sm truncate text-sm text-sidebar-foreground" title={risk.description}>{risk.description}</div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <div className="text-sm text-foreground">{risk.requirement?.reqId}</div>
                    <div className="max-w-[200px] truncate text-xs text-sidebar-foreground">{risk.requirement?.title}</div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-center">
                    <div className="text-sm font-bold text-foreground">{risk.riskScore}</div>
                    <div className="text-xs text-sidebar-foreground">P:{risk.probability} × I:{risk.impact}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {allowCreate && (
        <CreateRiskModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSuccess={handleRiskCreated}
          requirements={requirements}
        />
      )}
    </div>
  );
}
