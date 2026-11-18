import { api } from '../api-client';

// Subsets of the API JSON (apps/api/src/controllers/automation.controller.ts, environment.controller.ts).

export type ExecutionStatus = 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED';
export type ExecutionTrigger = 'MANUAL' | 'SCHEDULED' | 'CI_CD';

export interface Environment {
  id: string;
  name: string;
  baseUrl: string | null;
}

export interface AutomationProject {
  id: string;
  name: string;
  description: string | null;
  framework: string;
  repository: string | null;
  branch: string | null;
  projectId: string;
  _count?: { executions: number; scripts?: number }; // list only (POST response has no _count)
  createdAt: string;
}

export interface AutomationExecution {
  id: string;
  runId: string;
  status: ExecutionStatus;
  trigger: ExecutionTrigger;
  automationProjectId: string;
  environmentId: string | null;
  projectEnvironment?: { name: string } | null; // list only
  startTime: string | null;
  endTime: string | null;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  /** Tail of the sandbox console output (finished runs). */
  logs?: string | null;
  results?: ExecutionTestResult[] | null;
  createdAt: string;
}

/** One Playwright test outcome (apps/worker/src/sandbox.ts TestResult). */
export interface ExecutionTestResult {
  title: string;
  file: string;
  project: string;
  status: 'passed' | 'failed' | 'flaky' | 'skipped';
  durationMs: number;
  error?: string;
}

export type ScriptStatus = 'DRAFT' | 'APPROVED';

/** Playwright spec generated from a test case (apps/api/src/controllers/script.controller.ts). */
export interface GeneratedScript {
  id: string;
  fileName: string;
  code: string;
  status: ScriptStatus;
  source: 'AI' | 'TEMPLATE';
  model: string | null;
  testCaseId: string;
  automationProjectId: string;
  testCase: { tcId: string; title: string };
  createdAt: string;
  updatedAt: string;
  /** Generate response only: AI fell back to the template. */
  warning?: string | null;
}

export interface UpdateScriptData {
  code?: string;
  fileName?: string;
  status?: ScriptStatus;
}

export interface CreateEnvironmentData {
  name: string;
  baseUrl?: string;
}

export interface CreateAutomationProjectData {
  name: string;
  description?: string;
  repository?: string;
  branch?: string;
}

export interface TriggerExecutionData {
  environmentId?: string;
  trigger?: ExecutionTrigger;
}

// ---------- Environments ----------

export const getEnvironments = async (projectId: string): Promise<Environment[]> => {
  const response = await api.get<Environment[]>(`/projects/${encodeURIComponent(projectId)}/environments`);
  return response.data;
};

export const createEnvironment = async (projectId: string, data: CreateEnvironmentData): Promise<Environment> => {
  const response = await api.post<Environment>(`/projects/${encodeURIComponent(projectId)}/environments`, data);
  return response.data;
};

// ---------- Automation projects ----------

export const getAutomationProjects = async (projectId: string): Promise<AutomationProject[]> => {
  const response = await api.get<AutomationProject[]>(`/projects/${encodeURIComponent(projectId)}/automation`);
  return response.data;
};

export const createAutomationProject = async (
  projectId: string,
  data: CreateAutomationProjectData,
): Promise<AutomationProject> => {
  const response = await api.post<AutomationProject>(`/projects/${encodeURIComponent(projectId)}/automation`, data);
  return response.data;
};

// ---------- Executions ----------

/** Newest first, at most 50 (server limit). */
export const getAutomationExecutions = async (automationProjectId: string): Promise<AutomationExecution[]> => {
  const response = await api.get<AutomationExecution[]>(
    `/automation/${encodeURIComponent(automationProjectId)}/executions`,
  );
  return response.data;
};

/** One run including logs and per-test results (the list omits them). */
export const getAutomationExecution = async (executionId: string): Promise<AutomationExecution> => {
  const response = await api.get<AutomationExecution>(`/automation/executions/${encodeURIComponent(executionId)}`);
  return response.data;
};

export const triggerExecution = async (
  automationProjectId: string,
  data: TriggerExecutionData,
): Promise<AutomationExecution> => {
  const response = await api.post<AutomationExecution>(
    `/automation/${encodeURIComponent(automationProjectId)}/executions`,
    data,
  );
  return response.data;
};

// ---------- Generated scripts ----------

export const getScripts = async (automationProjectId: string): Promise<GeneratedScript[]> => {
  const response = await api.get<GeneratedScript[]>(`/automation/${encodeURIComponent(automationProjectId)}/scripts`);
  return response.data;
};

/** Generates or regenerates (resets to DRAFT) the script for a test case. */
export const generateScript = async (automationProjectId: string, testCaseId: string): Promise<GeneratedScript> => {
  const response = await api.post<GeneratedScript>(
    `/automation/${encodeURIComponent(automationProjectId)}/scripts/generate`,
    { testCaseId },
    { timeout: 90_000 }, // LLM call
  );
  return response.data;
};

export const updateScript = async (scriptId: string, data: UpdateScriptData): Promise<GeneratedScript> => {
  const response = await api.patch<GeneratedScript>(`/automation/scripts/${encodeURIComponent(scriptId)}`, data);
  return response.data;
};

export const deleteScript = async (scriptId: string): Promise<void> => {
  await api.delete(`/automation/scripts/${encodeURIComponent(scriptId)}`);
};

// ---------- Environment Variables (Vault) ----------

export interface EnvironmentVariable {
  id: string;
  key: string;
  value: string;
  isSecret: boolean;
  environmentId: string;
  createdAt: string;
}

export interface CreateVariableData {
  key: string;
  value: string;
  isSecret?: boolean;
}

export const getEnvironmentVariables = async (environmentId: string): Promise<EnvironmentVariable[]> => {
  const response = await api.get<EnvironmentVariable[]>(
    `/environments/${encodeURIComponent(environmentId)}/variables`,
  );
  return response.data;
};

export const createEnvironmentVariable = async (
  environmentId: string,
  data: CreateVariableData,
): Promise<EnvironmentVariable> => {
  const response = await api.post<EnvironmentVariable>(
    `/environments/${encodeURIComponent(environmentId)}/variables`,
    data,
  );
  return response.data;
};
