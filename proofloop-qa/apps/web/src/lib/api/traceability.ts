import { api } from '../api-client';
import type { RiskLevel } from './risks';
import type { AutomationStatus, TestType } from './test-cases';
import type { DefectSeverity, DefectStatus } from './defects';

export interface TraceabilityRow {
  id: string;
  reqId: string;
  title: string;
  module: {
    id: string;
    name: string;
  };
  risks: {
    id: string;
    title: string;
    level: RiskLevel;
    riskScore: number;
  }[];
  testCases: {
    id: string;
    tcId: string;
    title: string;
    testType: TestType;
    automationStatus: AutomationStatus;
  }[];
  /** Non-CLOSED defects linked through this requirement's test cases. */
  activeDefects: {
    id: string;
    bugId: string;
    title: string;
    status: DefectStatus;
    severity: DefectSeverity;
  }[];
  hasTestCoverage: boolean;
  hasRisksIdentified: boolean;
  hasActiveDefects: boolean;
}

export const getTraceabilityMatrix = async (projectId: string): Promise<TraceabilityRow[]> => {
  const response = await api.get<TraceabilityRow[]>(`/projects/${encodeURIComponent(projectId)}/traceability`);
  return response.data;
};
