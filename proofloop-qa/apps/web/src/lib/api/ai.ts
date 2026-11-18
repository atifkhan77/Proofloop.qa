import { api } from '../api-client';

export interface GeneratedTestCaseDraft {
  title: string;
  description: string;
  preconditions: string;
  steps: Array<{
    stepNumber: number;
    action: string;
    expectedResult: string;
  }>;
}

export interface GenerateTestCasesResponse {
  requirementId: string;
  reqId: string;
  title: string;
  drafts: GeneratedTestCaseDraft[];
  savedTestCases?: any[];
}

export interface RootCauseAnalysisResult {
  hypothesis: string;
  likelyCulprit: string;
  severityAssessment: string;
  suggestedRemediation: string;
}

export interface DefectRootCauseResponse {
  defectId: string;
  bugId: string;
  hypothesis?: string;
  analysis?: RootCauseAnalysisResult;
  cached?: boolean;
}

export interface ExecutionRootCauseResponse {
  executionId: string;
  runId: string;
  status: string;
  hypothesis?: string;
  analysis?: RootCauseAnalysisResult;
}

export const generateTestCases = async (
  requirementId: string,
  autoSave = false,
): Promise<GenerateTestCasesResponse> => {
  const res = await api.post<GenerateTestCasesResponse>(
    `/requirements/${encodeURIComponent(requirementId)}/ai/generate-test-cases`,
    { autoSave },
  );
  return res.data;
};

export const getDefectRootCause = async (
  defectId: string,
  refresh = false,
): Promise<DefectRootCauseResponse> => {
  const res = await api.get<DefectRootCauseResponse>(
    `/defects/${encodeURIComponent(defectId)}/root-cause${refresh ? '?refresh=true' : ''}`,
  );
  return res.data;
};

export const getExecutionRootCause = async (
  executionId: string,
): Promise<ExecutionRootCauseResponse> => {
  const res = await api.get<ExecutionRootCauseResponse>(
    `/automation/executions/${encodeURIComponent(executionId)}/root-cause`,
  );
  return res.data;
};
