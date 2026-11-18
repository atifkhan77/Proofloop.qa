import { api } from '../api-client';

export interface EvidenceArtifact {
  id: string;
  name: string;
  type: 'log' | 'screenshot' | 'trace' | 'har' | 'video';
  url: string;
  sizeBytes?: number;
}

export interface ExecutionEvidenceItem {
  id: string;
  runId: string;
  status: string;
  trigger: string;
  projectName: string;
  environmentName: string;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  rootCauseHypothesis?: string | null;
  artifacts: EvidenceArtifact[];
  createdAt: string;
}

export interface ExecutionEvidenceDetail {
  executionId: string;
  runId: string;
  status: string;
  trigger: string;
  projectName: string;
  environmentName: string;
  startTime?: string | null;
  endTime?: string | null;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  rootCauseHypothesis?: string | null;
  artifacts: EvidenceArtifact[];
}

export const getProjectEvidence = async (projectId: string): Promise<ExecutionEvidenceItem[]> => {
  const res = await api.get<ExecutionEvidenceItem[]>(
    `/projects/${encodeURIComponent(projectId)}/evidence`,
  );
  return res.data;
};

export const getExecutionEvidence = async (executionId: string): Promise<ExecutionEvidenceDetail> => {
  const res = await api.get<ExecutionEvidenceDetail>(
    `/automation/executions/${encodeURIComponent(executionId)}/evidence`,
  );
  return res.data;
};
