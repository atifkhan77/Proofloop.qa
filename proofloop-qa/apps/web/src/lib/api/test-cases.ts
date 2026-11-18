import { api } from '../api-client';

export type TestCasePriority = 'HIGH' | 'MEDIUM' | 'LOW';
export type TestType = 'UI' | 'API' | 'DATABASE' | 'REGRESSION' | 'FUNCTIONAL' | 'SECURITY';
export type AutomationStatus = 'MANUAL' | 'AUTOMATED' | 'IN_PROGRESS';

export interface TestStep {
  id: string;
  stepNumber: number; // server-assigned, 1..n
  action: string;
  expectedResult: string;
}

export interface TestCase {
  id: string;
  tcId: string;
  title: string;
  description: string | null;
  preconditions: string | null;
  testData: string | null;
  priority: TestCasePriority;
  testType: TestType;
  automationStatus: AutomationStatus;
  projectId: string;
  requirementId: string | null;
  requirement?: { reqId: string; title: string } | null; // list/detail only
  steps?: TestStep[]; // create/detail only
  _count?: { steps: number }; // list only
  createdAt: string;
}

/** POST body. Steps carry no stepNumber: the server numbers them by array order. */
export interface CreateTestCaseData {
  tcId: string;
  title: string;
  description?: string;
  preconditions?: string;
  testData?: string;
  priority: TestCasePriority;
  testType: TestType;
  automationStatus: AutomationStatus;
  requirementId?: string;
  steps?: { action: string; expectedResult: string }[];
}

export const getProjectTestCases = async (projectId: string): Promise<TestCase[]> => {
  const response = await api.get<TestCase[]>(`/projects/${encodeURIComponent(projectId)}/test-cases`);
  return response.data;
};

export const getTestCase = async (testCaseId: string): Promise<TestCase> => {
  const response = await api.get<TestCase>(`/test-cases/${encodeURIComponent(testCaseId)}`);
  return response.data;
};

export const createTestCase = async (projectId: string, data: CreateTestCaseData): Promise<TestCase> => {
  const response = await api.post<TestCase>(`/projects/${encodeURIComponent(projectId)}/test-cases`, data);
  return response.data;
};

/** Step count whether the object came from the list (_count) or from create (steps[]). */
export const stepCount = (tc: TestCase): number => tc._count?.steps ?? tc.steps?.length ?? 0;
