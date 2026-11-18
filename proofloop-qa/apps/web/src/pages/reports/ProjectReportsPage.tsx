import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  TrendingUp,
  Bug,
  FileCheck2,
  Bot,
  AlertTriangle,
  XCircle,
  Search,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  Cell,
  PieChart,
  Pie,
} from 'recharts';
import { getProjectReports, type ProjectReportsData } from '@/lib/api/reports';
import { getProject, type Project } from '@/lib/api/projects';
import { getApiErrorMessage } from '@/lib/api-error';

const PIE_COLORS = ['#22c55e', '#f59e0b', '#ef4444'];

export default function ProjectReportsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [data, setData] = useState<ProjectReportsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reqFilter, setReqFilter] = useState<'ALL' | 'COVERED' | 'NO_TESTS' | 'BLOCKED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      if (!projectId) return;
      try {
        const [proj, reports] = await Promise.all([
          getProject(projectId),
          getProjectReports(projectId),
        ]);
        setProject(proj);
        setData(reports);
      } catch (err) {
        setError(getApiErrorMessage(err, 'Failed to load project reports'));
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [projectId]);

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div>
          <Link to={`/projects/${projectId}`} className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground mb-3">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to {project?.name || 'Project'}
          </Link>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-5">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Quality Reports & Analytics
              </h1>
              <p className="mt-1 text-sm text-sidebar-foreground">
                Real-time quality intelligence, test execution pass rates, and requirement coverage metrics.
              </p>
            </div>
          </div>
        </div>
        <div className="flex h-64 items-center justify-center" role="status" aria-label="Loading reports">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link to={`/projects/${projectId}`} className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Project
        </Link>
        <div className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-4 text-red-500" role="alert">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{error || 'No data available'}</span>
        </div>
      </div>
    );
  }

  const { summary, requirementCoverage, defectDensity, passRateTimeline } = data;

  const coveragePieData = [
    { name: 'Covered', value: requirementCoverage.coveredRequirements },
    { name: 'No Test Cases', value: requirementCoverage.uncoveredNoTestCases },
    { name: 'Blocked by Critical Bug', value: requirementCoverage.blockedByCriticalBugs },
  ].filter((item) => item.value > 0);

  const filteredRequirements = requirementCoverage.requirements.filter((r) => {
    if (reqFilter === 'COVERED' && !r.isCovered) return false;
    if (reqFilter === 'NO_TESTS' && r.testCaseCount > 0) return false;
    if (reqFilter === 'BLOCKED' && (r.isCovered || r.testCaseCount === 0 || r.criticalBugsCount === 0)) return false;

    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      return r.reqId.toLowerCase().includes(q) || r.title.toLowerCase().includes(q) || r.moduleName.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <Link to={`/projects/${projectId}`} className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground mb-3">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to {project?.name || 'Project'}
        </Link>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Quality Reports & Analytics
            </h1>
            <p className="mt-1 text-sm text-sidebar-foreground">
              Real-time quality intelligence, test execution pass rates, and requirement coverage metrics.
            </p>
          </div>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Coverage */}
        <div className="rounded-xl border border-border bg-sidebar p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-sidebar-foreground uppercase tracking-wider">Requirement Coverage</span>
            <FileCheck2 className="h-5 w-5 text-primary" />
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-bold text-foreground">{summary.requirementCoverageRate}%</span>
            <span className="text-xs text-sidebar-foreground">
              {summary.coveredRequirements} / {summary.totalRequirements} Covered
            </span>
          </div>
          <div className="mt-3 h-2 w-full rounded-full bg-sidebar-accent overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.min(100, summary.requirementCoverageRate)}%` }}
            />
          </div>
        </div>

        {/* Pass Rate */}
        <div className="rounded-xl border border-border bg-sidebar p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-sidebar-foreground uppercase tracking-wider">Overall Pass Rate</span>
            <TrendingUp className="h-5 w-5 text-green-500" />
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-bold text-foreground">{summary.overallPassRate}%</span>
            <span className="text-xs text-sidebar-foreground">
              {summary.totalPassed} / {summary.totalExecuted} Executions
            </span>
          </div>
          <div className="mt-3 h-2 w-full rounded-full bg-sidebar-accent overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${Math.min(100, summary.overallPassRate)}%` }}
            />
          </div>
        </div>

        {/* Defect Density */}
        <div className="rounded-xl border border-border bg-sidebar p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-sidebar-foreground uppercase tracking-wider">Active Defects</span>
            <Bug className="h-5 w-5 text-red-500" />
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-bold text-foreground">{summary.activeDefects}</span>
            <span className="text-xs text-red-400 font-medium">
              {summary.criticalDefects} Critical
            </span>
          </div>
          <div className="mt-3 text-xs text-sidebar-foreground">
            Total logged: {summary.totalDefects} defects
          </div>
        </div>

        {/* Automation Rate */}
        <div className="rounded-xl border border-border bg-sidebar p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-sidebar-foreground uppercase tracking-wider">Automation Rate</span>
            <Bot className="h-5 w-5 text-blue-500" />
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-bold text-foreground">{summary.automationRate}%</span>
            <span className="text-xs text-sidebar-foreground">
              {summary.automatedTestCases} / {summary.totalTestCases} Automated
            </span>
          </div>
          <div className="mt-3 h-2 w-full rounded-full bg-sidebar-accent overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${Math.min(100, summary.automationRate)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pass Rate Timeline */}
        <div className="rounded-xl border border-border bg-sidebar p-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
            <div>
              <h2 className="text-base font-bold text-foreground">Test Execution Pass Rates</h2>
              <p className="text-xs text-sidebar-foreground">Pass rate trend across manual and automated runs</p>
            </div>
          </div>
          <div className="h-72 w-full">
            {passRateTimeline.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-sidebar-foreground">
                No execution history recorded yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={passRateTimeline} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="date" stroke="currentColor" className="text-xs text-sidebar-foreground" />
                  <YAxis domain={[0, 100]} unit="%" stroke="currentColor" className="text-xs text-sidebar-foreground" />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--sidebar)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--foreground)' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Line type="monotone" dataKey="passRate" name="Pass Rate (%)" stroke="#22c55e" strokeWidth={2.5} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="passed" name="Passed Runs" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="failed" name="Failed Runs" stroke="#ef4444" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Defect Density by Module */}
        <div className="rounded-xl border border-border bg-sidebar p-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
            <div>
              <h2 className="text-base font-bold text-foreground">Defect Density by Module</h2>
              <p className="text-xs text-sidebar-foreground">Active defects grouped by functional area</p>
            </div>
          </div>
          <div className="h-72 w-full">
            {defectDensity.modules.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-sidebar-foreground">
                No modules or defects found.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={defectDensity.modules} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="name" stroke="currentColor" className="text-xs text-sidebar-foreground" />
                  <YAxis allowDecimals={false} stroke="currentColor" className="text-xs text-sidebar-foreground" />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--sidebar)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--foreground)' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="criticalBugs" name="Critical" fill="#ef4444" stackId="a" />
                  <Bar dataKey="highBugs" name="High" fill="#f97316" stackId="a" />
                  <Bar dataKey="mediumBugs" name="Medium" fill="#eab308" stackId="a" />
                  <Bar dataKey="lowBugs" name="Low" fill="#64748b" stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Requirement Coverage Breakdown Section */}
      <div className="rounded-xl border border-border bg-sidebar p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-border pb-4 mb-6">
          <div>
            <h2 className="text-lg font-bold text-foreground">Requirement Coverage Breakdown</h2>
            <p className="text-xs text-sidebar-foreground">
              A requirement is fully covered when it has at least 1 linked test case and 0 active critical bugs.
            </p>
          </div>
          <div className="mt-3 md:mt-0 flex gap-2">
            <button
              type="button"
              onClick={() => setReqFilter('ALL')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                reqFilter === 'ALL' ? 'bg-primary text-primary-foreground' : 'border border-border text-sidebar-foreground hover:bg-sidebar-accent'
              }`}
            >
              All ({requirementCoverage.totalRequirements})
            </button>
            <button
              type="button"
              onClick={() => setReqFilter('COVERED')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                reqFilter === 'COVERED' ? 'bg-green-600 text-white' : 'border border-border text-sidebar-foreground hover:bg-sidebar-accent'
              }`}
            >
              Covered ({requirementCoverage.coveredRequirements})
            </button>
            <button
              type="button"
              onClick={() => setReqFilter('NO_TESTS')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                reqFilter === 'NO_TESTS' ? 'bg-amber-600 text-white' : 'border border-border text-sidebar-foreground hover:bg-sidebar-accent'
              }`}
            >
              No Tests ({requirementCoverage.uncoveredNoTestCases})
            </button>
            <button
              type="button"
              onClick={() => setReqFilter('BLOCKED')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                reqFilter === 'BLOCKED' ? 'bg-red-600 text-white' : 'border border-border text-sidebar-foreground hover:bg-sidebar-accent'
              }`}
            >
              Blocked by Critical ({requirementCoverage.blockedByCriticalBugs})
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Pie Chart */}
          <div className="flex flex-col items-center justify-center p-4 rounded-lg bg-sidebar-accent/30 border border-border">
            <div className="h-48 w-48">
              {coveragePieData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-sidebar-foreground">No Requirements</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={coveragePieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={3}
                    >
                      {coveragePieData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--sidebar)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--foreground)' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="mt-2 flex gap-4 text-xs">
              <span className="flex items-center gap-1 text-green-500 font-medium">
                <span className="h-2.5 w-2.5 rounded-full bg-green-500" /> Covered
              </span>
              <span className="flex items-center gap-1 text-amber-500 font-medium">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Missing Tests
              </span>
              <span className="flex items-center gap-1 text-red-500 font-medium">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Blocked
              </span>
            </div>
          </div>

          {/* Details Column */}
          <div className="lg:col-span-2 flex flex-col justify-center space-y-4">
            <div className="rounded-lg border border-border bg-sidebar p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center text-green-500 font-medium">
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Covered Requirements
                </span>
                <span className="font-bold text-foreground">{requirementCoverage.coveredRequirements}</span>
              </div>
              <p className="mt-1 text-xs text-sidebar-foreground">
                Linked to at least one test case with zero active critical severity defects.
              </p>
            </div>

            <div className="rounded-lg border border-border bg-sidebar p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center text-amber-500 font-medium">
                  <AlertTriangle className="mr-2 h-4 w-4" /> Missing Test Cases
                </span>
                <span className="font-bold text-foreground">{requirementCoverage.uncoveredNoTestCases}</span>
              </div>
              <p className="mt-1 text-xs text-sidebar-foreground">
                Requirements without any authoring or linked test cases.
              </p>
            </div>

            <div className="rounded-lg border border-border bg-sidebar p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center text-red-500 font-medium">
                  <XCircle className="mr-2 h-4 w-4" /> Blocked by Critical Bugs
                </span>
                <span className="font-bold text-foreground">{requirementCoverage.blockedByCriticalBugs}</span>
              </div>
              <p className="mt-1 text-xs text-sidebar-foreground">
                Requirements with test cases that have unresolved critical bugs reported.
              </p>
            </div>
          </div>
        </div>

        {/* Filtered Requirements Table */}
        <div className="space-y-3">
          <div className="flex items-center">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-sidebar-foreground" />
              <input
                type="text"
                placeholder="Search requirements..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search requirements"
                className="w-full rounded-md border border-border bg-sidebar pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-sidebar-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div className="relative overflow-x-auto rounded-lg border border-border bg-sidebar shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-sidebar-accent/50 text-xs uppercase tracking-wider text-sidebar-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Req ID</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Title</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Module</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold text-center">Test Cases</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold text-center">Critical Bugs</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-xs">
                {filteredRequirements.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-sidebar-foreground">
                      No requirements match the selected filter.
                    </td>
                  </tr>
                ) : (
                  filteredRequirements.map((r) => (
                    <tr key={r.id} className="hover:bg-sidebar-accent/30 transition-colors">
                      <td className="px-4 py-3 font-mono font-medium text-foreground">{r.reqId}</td>
                      <td className="px-4 py-3 font-medium text-foreground">{r.title}</td>
                      <td className="px-4 py-3 text-sidebar-foreground">{r.moduleName}</td>
                      <td className="px-4 py-3 text-center text-foreground font-medium">{r.testCaseCount}</td>
                      <td className="px-4 py-3 text-center">
                        {r.criticalBugsCount > 0 ? (
                          <span className="font-bold text-red-500">{r.criticalBugsCount}</span>
                        ) : (
                          <span className="text-sidebar-foreground">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.isCovered ? (
                          <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-500 border border-green-500/20">
                            Covered
                          </span>
                        ) : r.testCaseCount === 0 ? (
                          <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-500 border border-amber-500/20">
                            No Tests
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-500 border border-red-500/20">
                            Blocked
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
