import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import { ArrowLeft, Loader2, AlertCircle, PlayCircle, FileText, CheckCircle2 } from 'lucide-react';
import { getTestCase, type TestCase } from '@/lib/api/test-cases';
import { getApiErrorMessage } from '@/lib/api-error';

export default function TestCaseDetailPage() {
  const { testCaseId } = useParams<{ testCaseId: string }>();
  const [testCase, setTestCase] = useState<TestCase | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!testCaseId) return;
      try {
        const data = await getTestCase(testCaseId);
        setTestCase(data);
      } catch (err) {
        setError(getApiErrorMessage(err, 'Failed to load test case details'));
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [testCaseId]);

  if (isLoading) return (
    <div className="flex h-96 items-center justify-center" role="status">
      <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
      <span className="sr-only">Loading test case details...</span>
    </div>
  );

  if (error || !testCase) return (
    <div className="space-y-4">
      <Link to="/" className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
      </Link>
      <div className="flex items-center space-x-2 rounded-md bg-red-500/10 p-4 text-red-500 border border-red-500/20" role="alert">
        <AlertCircle className="h-5 w-5 shrink-0" />
        <span className="text-sm font-medium">{error || 'Test case not found'}</span>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 max-w-5xl">
      <Link to={`/projects/${testCase.projectId}/test-cases`} className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Test Case Studio
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between border-b border-border pb-5 gap-4">
        <div>
          <div className="flex items-center space-x-3 mb-2">
            <span className="rounded-md bg-primary/10 px-2.5 py-1 text-sm font-bold text-primary border border-primary/20">
              {testCase.tcId}
            </span>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${testCase.automationStatus === 'AUTOMATED' ? 'bg-green-500/10 text-green-500 border-green-500/20' : testCase.automationStatus === 'IN_PROGRESS' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' : 'bg-sidebar-accent text-sidebar-foreground border-border'}`}>
              {testCase.automationStatus === 'AUTOMATED' && <PlayCircle className="mr-1 h-3 w-3" />}
              {testCase.automationStatus.replace('_', ' ')}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{testCase.title}</h1>
          {testCase.description && (
            <p className="text-sm text-sidebar-foreground mt-2">{testCase.description}</p>
          )}
        </div>
      </div>

      {/* Metadata Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-sidebar p-4">
          <p className="text-xs font-medium text-sidebar-foreground uppercase tracking-wider mb-1">Priority & Type</p>
          <p className="text-sm font-semibold text-foreground">
            {testCase.priority} • {testCase.testType}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-sidebar p-4 md:col-span-2">
          <p className="text-xs font-medium text-sidebar-foreground uppercase tracking-wider mb-1">Target Requirement</p>
          {testCase.requirement ? (
            <div className="flex items-center space-x-2">
              <FileText className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">{testCase.requirement.reqId}</span>
              <span className="text-sm text-sidebar-foreground truncate">— {testCase.requirement.title}</span>
            </div>
          ) : (
            <p className="text-sm italic text-sidebar-foreground">Standalone (No linked requirement)</p>
          )}
        </div>
      </div>

      {/* Context: Preconditions & Test Data */}
      {(testCase.preconditions || testCase.testData) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {testCase.preconditions && (
            <div className="rounded-xl border border-border bg-sidebar/50 p-4">
              <p className="text-xs font-medium text-sidebar-foreground uppercase tracking-wider mb-2">Preconditions</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">{testCase.preconditions}</p>
            </div>
          )}
          {testCase.testData && (
            <div className="rounded-xl border border-border bg-sidebar/50 p-4">
              <p className="text-xs font-medium text-sidebar-foreground uppercase tracking-wider mb-2">Test Data</p>
              <p className="text-sm text-foreground font-mono bg-background p-2 rounded border border-border whitespace-pre-wrap">{testCase.testData}</p>
            </div>
          )}
        </div>
      )}

      {/* Execution Steps */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-4">Execution Steps</h3>
        {(!testCase.steps || testCase.steps.length === 0) ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center bg-sidebar/50">
            <p className="text-sm text-sidebar-foreground">No execution steps defined for this test case.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {testCase.steps.map((step) => (
              <div key={step.id || step.stepNumber} className="flex gap-4 rounded-xl border border-border bg-sidebar p-4 shadow-sm">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent border border-border text-sm font-bold text-foreground">
                  {step.stepNumber}
                </div>
                <div className="flex-1 space-y-3">
                  <div>
                    <p className="text-xs font-medium text-sidebar-foreground uppercase tracking-wider mb-1">Action</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{step.action}</p>
                  </div>
                  <div className="border-t border-border/50 pt-3">
                    <p className="text-xs font-medium text-sidebar-foreground uppercase tracking-wider mb-1 flex items-center">
                      <CheckCircle2 className="h-3 w-3 mr-1 text-green-500" /> Expected Result
                    </p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{step.expectedResult}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
