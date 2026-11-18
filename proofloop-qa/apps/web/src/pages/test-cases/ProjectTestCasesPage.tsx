import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import { TestTube, ArrowLeft, Loader2, AlertCircle, Plus, PlayCircle } from 'lucide-react';
import { getProjectTestCases, stepCount, type AutomationStatus, type TestCase } from '@/lib/api/test-cases';
import { getProject } from '@/lib/api/projects';
import { getProjectRequirements, type RequirementSummary } from '@/lib/api/requirements';
import { getApiStatus } from '@/lib/api-error';
import { canCreateTestCase } from '@/lib/permissions';
import { useAuth } from '@/contexts/auth-context';
import CreateTestCaseModal from '@/components/test-cases/CreateTestCaseModal';

const AUTOMATION_BADGE: Record<AutomationStatus, string> = {
  AUTOMATED: 'bg-green-500/10 text-green-500',
  IN_PROGRESS: 'bg-yellow-500/10 text-yellow-500',
  MANUAL: 'bg-sidebar-accent text-sidebar-foreground',
};

export default function ProjectTestCasesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [projectName, setProjectName] = useState('');
  const [requirements, setRequirements] = useState<RequirementSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const allowCreate = canCreateTestCase(user?.role);

  useEffect(() => {
    const fetchData = async () => {
      if (!projectId) return;
      try {
        const [testsData, projectData, reqsData] = await Promise.all([
          getProjectTestCases(projectId),
          getProject(projectId),
          getProjectRequirements(projectId),
        ]);
        setTestCases(testsData);
        setProjectName(projectData.name);
        setRequirements(reqsData);
      } catch (err) {
        setError(getApiStatus(err) === 404 ? 'Project not found' : 'Failed to load Test Case Studio');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [projectId]);

  // Newest first, matching the API's createdAt desc ordering.
  const handleTestCaseCreated = (newTestCase: TestCase) => {
    setTestCases((prev) => [newTestCase, ...prev]);
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center" role="status" aria-label="Loading test cases">
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Test Case Studio</h1>
          <p className="mt-1 text-sm text-sidebar-foreground">Design, link, and manage execution scenarios.</p>
        </div>
        {allowCreate && (
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="mr-2 h-4 w-4" /> New Test Case
          </button>
        )}
      </div>

      {testCases.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-sidebar/50">
          <TestTube className="mb-4 h-10 w-10 text-sidebar-foreground opacity-50" />
          <h3 className="text-lg font-medium text-foreground">No test cases designed</h3>
          <p className="mt-1 text-sm text-sidebar-foreground">Create execution scenarios to validate your requirements.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-sidebar shadow-sm">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-sidebar-accent">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase text-sidebar-foreground">ID &amp; Title</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase text-sidebar-foreground">Type &amp; Status</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase text-sidebar-foreground">Requirement</th>
                <th scope="col" className="px-6 py-3 text-center text-xs font-medium uppercase text-sidebar-foreground">Steps</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-sidebar">
              {testCases.map((tc) => (
                <tr
                  key={tc.id}
                  onClick={() => navigate(`/test-cases/${tc.id}`)}
                  className="cursor-pointer transition-colors hover:bg-sidebar-accent/50"
                >
                  <td className="px-6 py-4">
                    <Link
                      to={`/test-cases/${tc.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm font-bold text-primary hover:underline"
                    >
                      {tc.tcId}
                    </Link>
                    <div className="max-w-sm truncate text-sm text-sidebar-foreground" title={tc.title}>{tc.title}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      <span className="inline-flex w-fit items-center rounded-sm bg-sidebar-accent px-2 py-0.5 text-xs font-medium text-sidebar-foreground">
                        {tc.testType}
                      </span>
                      <span className={`inline-flex w-fit items-center rounded-sm px-2 py-0.5 text-xs font-medium ${AUTOMATION_BADGE[tc.automationStatus]}`}>
                        {tc.automationStatus === 'AUTOMATED' && <PlayCircle className="mr-1 h-3 w-3" aria-hidden="true" />}
                        {tc.automationStatus.replace('_', ' ')}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {tc.requirement ? (
                      <div>
                        <div className="text-sm text-foreground">{tc.requirement.reqId}</div>
                        <div className="max-w-[200px] truncate text-xs text-sidebar-foreground">{tc.requirement.title}</div>
                      </div>
                    ) : (
                      <span className="text-xs italic text-sidebar-foreground">Standalone</span>
                    )}
                  </td>
                  {/* stepCount(): list rows have _count, freshly created rows have steps[]. */}
                  <td className="px-6 py-4 text-center text-sm font-medium text-sidebar-foreground">{stepCount(tc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {projectId && allowCreate && (
        <CreateTestCaseModal
          projectId={projectId}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSuccess={handleTestCaseCreated}
          requirements={requirements}
        />
      )}
    </div>
  );
}
