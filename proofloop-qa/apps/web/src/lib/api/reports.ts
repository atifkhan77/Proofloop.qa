import { api } from '../api-client';

export interface ReportSummary {
  totalRequirements: number;
  coveredRequirements: number;
  uncoveredNoTestCases: number;
  blockedByCriticalBugs: number;
  requirementCoverageRate: number;
  totalTestCases: number;
  automatedTestCases: number;
  automationRate: number;
  totalDefects: number;
  activeDefects: number;
  criticalDefects: number;
  totalExecuted: number;
  totalPassed: number;
  totalFailed: number;
  overallPassRate: number;
  activeTestCycles: number;
}

export interface RequirementReportItem {
  id: string;
  reqId: string;
  title: string;
  priority: string;
  moduleName: string;
  testCaseCount: number;
  criticalBugsCount: number;
  isCovered: boolean;
}

export interface DefectDensityModule {
  id: string;
  name: string;
  activeBugs: number;
  criticalBugs: number;
  highBugs: number;
  mediumBugs: number;
  lowBugs: number;
  requirementCount: number;
  testCaseCount: number;
  density: number;
}

export interface PassRateTimelineItem {
  date: string;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  passRate: number;
}

export interface ProjectReportsData {
  summary: ReportSummary;
  requirementCoverage: {
    totalRequirements: number;
    coveredRequirements: number;
    uncoveredNoTestCases: number;
    blockedByCriticalBugs: number;
    coverageRate: number;
    requirements: RequirementReportItem[];
  };
  defectDensity: {
    totalActiveBugs: number;
    modules: DefectDensityModule[];
  };
  passRateTimeline: PassRateTimelineItem[];
}

export const getProjectReports = async (projectId: string): Promise<ProjectReportsData> => {
  const res = await api.get<ProjectReportsData>(`/projects/${encodeURIComponent(projectId)}/reports`);
  return res.data;
};
