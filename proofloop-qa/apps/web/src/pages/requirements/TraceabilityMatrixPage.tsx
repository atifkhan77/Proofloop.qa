import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import { ArrowLeft, Loader2, AlertCircle, FileX, CheckCircle2, XCircle } from 'lucide-react';
import { getTraceabilityMatrix, type TraceabilityRow } from '@/lib/api/traceability';
import { getProject } from '@/lib/api/projects';
import { getApiErrorMessage } from '@/lib/api-error';

export default function TraceabilityMatrixPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [matrix, setMatrix] = useState<TraceabilityRow[]>([]);
  const [projectName, setProjectName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!projectId) return;
      try {
        const [matrixData, projectData] = await Promise.all([
          getTraceabilityMatrix(projectId),
          getProject(projectId),
        ]);
        setMatrix(matrixData);
        setProjectName(projectData.name);
      } catch (err) {
        setError(getApiErrorMessage(err, 'Failed to load traceability matrix'));
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [projectId]);

  // Group by module for cleaner table rendering
  const groupedMatrix = matrix.reduce((acc, row) => {
    const moduleName = row.module.name;
    if (!acc[moduleName]) acc[moduleName] = [];
    acc[moduleName].push(row);
    return acc;
  }, {} as Record<string, TraceabilityRow[]>);

  if (isLoading) return (
    <div className="flex h-96 items-center justify-center" role="status">
      <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
      <span className="sr-only">Loading matrix...</span>
    </div>
  );

  if (error) return (
    <div className="space-y-4">
      <Link to={projectId ? `/projects/${projectId}` : '/'} className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Project Dashboard
      </Link>
      <div className="flex items-center space-x-2 rounded-md bg-red-500/10 p-4 text-red-500 border border-red-500/20" role="alert">
        <AlertCircle className="h-5 w-5 shrink-0" />
        <span className="text-sm font-medium">{error}</span>
      </div>
    </div>
  );

  const totalReqs = matrix.length;
  const missingTests = matrix.filter((r) => !r.hasTestCoverage).length;
  // Only defects linked to a requirement via a test case (see traceability.controller.ts).
  const totalActiveBugs = matrix.reduce((sum, r) => sum + r.activeDefects.length, 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <Link to={`/projects/${projectId}`} className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to {projectName || 'Project'}
      </Link>

      <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-border pb-5 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Traceability Matrix</h1>
          <p className="text-sm text-sidebar-foreground mt-1">Requirement to Risk and Test Case mappings.</p>
        </div>
        <dl className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <div className="flex flex-col items-end border-r border-border pr-4">
            <dt className="text-sidebar-foreground">Total Requirements</dt>
            <dd className="font-bold text-foreground text-lg">{totalReqs}</dd>
          </div>
          <div className="flex flex-col items-end border-r border-border pr-4">
            <dt className="text-sidebar-foreground">Missing Test Coverage</dt>
            <dd className={`font-bold text-lg ${missingTests > 0 ? 'text-red-500' : 'text-green-500'}`}>{missingTests}</dd>
          </div>
          <div className="flex flex-col items-end" title="Open defects linked to a requirement through one of its test cases">
            <dt className="text-sidebar-foreground">Active Bugs (linked)</dt>
            <dd className={`font-bold text-lg ${totalActiveBugs > 0 ? 'text-red-500' : 'text-green-500'}`}>{totalActiveBugs}</dd>
          </div>
        </dl>
      </div>

      {matrix.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-sidebar/50">
          <FileX className="h-10 w-10 text-sidebar-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium text-foreground">No requirements found</h3>
          <p className="mt-1 text-sm text-sidebar-foreground">Create requirements in a module to generate the matrix.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-sidebar shadow-sm">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-sidebar-accent">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sidebar-foreground uppercase">Requirement</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sidebar-foreground uppercase">Coverage Status</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sidebar-foreground uppercase">Risks Identified</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sidebar-foreground uppercase">Test Cases</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sidebar-foreground uppercase">Active Defects</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-sidebar">
              {Object.entries(groupedMatrix).map(([moduleName, reqs]) => (
                <React.Fragment key={moduleName}>
                  <tr className="bg-sidebar-accent/50 border-t border-border">
                    <td colSpan={5} className="px-4 py-2 text-xs font-bold text-foreground uppercase tracking-wider">
                      Module: {moduleName}
                    </td>
                  </tr>
                  {reqs.map((req) => (
                    <tr key={req.id} className="hover:bg-sidebar-accent/30 transition-colors">
                      <td className="px-4 py-4 align-top max-w-xs">
                        <div className="text-sm font-bold text-foreground">{req.reqId}</div>
                        <div className="text-xs text-sidebar-foreground truncate" title={req.title}>{req.title}</div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <div className="flex flex-col gap-2">
                          <span className={`inline-flex items-center text-xs font-medium ${req.hasTestCoverage ? 'text-green-500' : 'text-red-500'}`}>
                            {req.hasTestCoverage ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}
                            {req.hasTestCoverage ? 'Tests Linked' : 'Missing Tests'}
                          </span>
                          <span className={`inline-flex items-center text-xs font-medium ${req.hasRisksIdentified ? 'text-green-500' : 'text-yellow-500'}`}>
                            {req.hasRisksIdentified ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <AlertCircle className="mr-1 h-3 w-3" />}
                            {req.hasRisksIdentified ? 'Risks Logged' : 'No Risks'}
                          </span>
                          {/* "No Active Bugs", not "Bug Free": without tests no defect can be linked. */}
                          <span className={`inline-flex items-center text-xs font-medium ${req.hasActiveDefects ? 'text-red-500' : 'text-green-500'}`}>
                            {req.hasActiveDefects ? <AlertCircle className="mr-1 h-3 w-3" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
                            {req.hasActiveDefects
                              ? `${req.activeDefects.length} Active ${req.activeDefects.length === 1 ? 'Bug' : 'Bugs'}`
                              : 'No Active Bugs'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top max-w-[200px]">
                        {req.risks.length > 0 ? (
                          <ul className="space-y-1">
                            {req.risks.map((risk) => (
                              <li key={risk.id} className="text-xs text-sidebar-foreground truncate" title={risk.title}>
                                <span className={`font-semibold mr-1 ${risk.level === 'CRITICAL' ? 'text-red-500' : risk.level === 'HIGH' ? 'text-orange-500' : 'text-foreground'}`}>
                                  [{risk.level}]
                                </span>
                                {risk.title}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-xs italic text-sidebar-foreground">None</span>
                        )}
                      </td>
                      <td className="px-4 py-4 align-top max-w-[250px]">
                        {req.testCases.length > 0 ? (
                          <ul className="space-y-1">
                            {req.testCases.map((tc) => (
                              <li key={tc.id} className="text-xs text-sidebar-foreground truncate">
                                <Link to={`/test-cases/${tc.id}`} className="font-semibold text-primary hover:underline mr-1">
                                  {tc.tcId}
                                </Link>
                                <span title={tc.title}>- {tc.title}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-xs italic text-red-500">Coverage Required</span>
                        )}
                      </td>
                      <td className="px-4 py-4 align-top max-w-[250px]">
                        {req.activeDefects.length > 0 ? (
                          <ul className="space-y-1">
                            {req.activeDefects.map((bug) => (
                              <li key={bug.id} className="text-xs text-sidebar-foreground truncate" title={`${bug.bugId}: ${bug.title} (${bug.severity}, ${bug.status.replace('_', ' ')})`}>
                                <Link to={`/projects/${projectId}/defects`} className="font-semibold text-red-500 hover:underline mr-1">
                                  {bug.bugId}
                                </Link>
                                <span>- {bug.title}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-xs italic text-sidebar-foreground">No active bugs</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
