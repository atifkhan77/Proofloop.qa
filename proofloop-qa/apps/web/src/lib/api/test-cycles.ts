import { api } from '../api-client';

export type CycleStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'ABORTED';
export type ExecutionStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'SKIPPED' | 'BLOCKED';

export interface TestCycleStats {
  totalCount: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  pendingCount: number;
  blockedCount: number;
  passRate: number;
}

export interface TestStep {
  id: string;
  stepNumber: number;
  action: string;
  expectedResult: string;
}

export interface TestCaseInExecution {
  id: string;
  tcId: string;
  title: string;
  description?: string | null;
  priority: string;
  testType: string;
  preconditions?: string | null;
  testData?: string | null;
  steps?: TestStep[];
}

export interface DefectInExecution {
  id: string;
  bugId: string;
  title: string;
  severity: string;
  status: string;
  jiraTicketId?: string | null;
}

export interface TestExecution {
  id: string;
  status: ExecutionStatus;
  notes?: string | null;
  executedAt?: string | null;
  executedBy?: { id: string; firstName: string; lastName: string } | null;
  testCase: TestCaseInExecution;
  defects?: DefectInExecution[];
}

export interface TestCycle {
  id: string;
  cycleId: string;
  name: string;
  description?: string | null;
  status: CycleStatus;
  environment?: { id: string; name: string; baseUrl?: string | null } | null;
  environmentId?: string | null;
  projectId: string;
  project?: { id: string; name: string };
  executions?: TestExecution[];
  stats: TestCycleStats;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTestCyclePayload {
  name: string;
  description?: string;
  environmentId?: string;
  testCaseIds: string[];
}

export interface UpdateTestCyclePayload {
  name?: string;
  description?: string;
  status?: CycleStatus;
  environmentId?: string;
}

export const getProjectTestCycles = async (projectId: string): Promise<TestCycle[]> => {
  const res = await api.get<TestCycle[]>(`/projects/${encodeURIComponent(projectId)}/test-cycles`);
  return res.data;
};

export const createTestCycle = async (projectId: string, data: CreateTestCyclePayload): Promise<TestCycle> => {
  const res = await api.post<TestCycle>(`/projects/${encodeURIComponent(projectId)}/test-cycles`, data);
  return res.data;
};

export const getTestCycle = async (cycleId: string): Promise<TestCycle> => {
  const res = await api.get<TestCycle>(`/test-cycles/${encodeURIComponent(cycleId)}`);
  return res.data;
};

export const updateTestCycle = async (cycleId: string, data: UpdateTestCyclePayload): Promise<TestCycle> => {
  const res = await api.patch<TestCycle>(`/test-cycles/${encodeURIComponent(cycleId)}`, data);
  return res.data;
};

export const deleteTestCycle = async (cycleId: string): Promise<void> => {
  await api.delete(`/test-cycles/${encodeURIComponent(cycleId)}`);
};

export const addTestCasesToCycle = async (cycleId: string, testCaseIds: string[]): Promise<{ addedCount: number }> => {
  const res = await api.post<{ addedCount: number }>(`/test-cycles/${encodeURIComponent(cycleId)}/test-cases`, { testCaseIds });
  return res.data;
};

export const recordExecution = async (
  executionId: string,
  data: { status: ExecutionStatus; notes?: string },
): Promise<TestExecution & { suggestDefect: boolean }> => {
  const res = await api.patch<TestExecution & { suggestDefect: boolean }>(
    `/test-executions/${encodeURIComponent(executionId)}`,
    data,
  );
  return res.data;
};
