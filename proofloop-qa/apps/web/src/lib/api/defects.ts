import { api } from '../api-client';

// Mirrors apps/api/src/validations/defect.validation.ts and defect.controller.ts.

export const DEFECT_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export const DEFECT_STATUSES = ['OPEN', 'IN_PROGRESS', 'IN_REVIEW', 'CLOSED'] as const;
export type DefectSeverity = (typeof DEFECT_SEVERITIES)[number];
export type DefectStatus = (typeof DEFECT_STATUSES)[number];

export interface DefectUser {
  id: string;
  firstName: string;
  lastName: string;
}

export interface Defect {
  id: string;
  bugId: string;
  title: string;
  description: string;
  stepsToReproduce: string | null;
  severity: DefectSeverity;
  status: DefectStatus;
  projectId: string;
  testCaseId: string | null;
  testCase?: { id: string; tcId: string; title: string } | null; // detail endpoint only
  reporterId: string;
  reporter: DefectUser;
  assigneeId: string | null;
  assignee?: DefectUser | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDefectPayload {
  bugId: string;
  title: string;
  description: string;
  stepsToReproduce?: string;
  severity: DefectSeverity;
  status?: DefectStatus;
  testCaseId?: string;
  testExecutionId?: string;
  jiraTicketId?: string;
  assigneeId?: string;
}

/** PATCH body. Bug ID, test case and reporter cannot be changed. '' clears steps / unassigns. */
export interface UpdateDefectPayload {
  title?: string;
  description?: string;
  stepsToReproduce?: string;
  severity?: DefectSeverity;
  status?: DefectStatus;
  assigneeId?: string;
}

const enc = encodeURIComponent;

export const getProjectDefects = async (projectId: string): Promise<Defect[]> => {
  const response = await api.get<Defect[]>(`/projects/${enc(projectId)}/defects`);
  return response.data;
};

export interface DefectPage {
  items: Defect[];
  total: number;
}

/** One page (newest first), optionally filtered by Bug ID / title (case-insensitive). */
export const getProjectDefectsPage = async (
  projectId: string,
  params: { limit: number; offset: number; q?: string },
): Promise<DefectPage> => {
  const response = await api.get<Defect[]>(`/projects/${enc(projectId)}/defects`, {
    params: { limit: params.limit, offset: params.offset, ...(params.q ? { q: params.q } : {}) },
  });
  return { items: response.data, total: Number(response.headers['x-total-count'] ?? response.data.length) };
};

export const createDefect = async (projectId: string, data: CreateDefectPayload): Promise<Defect> => {
  const response = await api.post<Defect>(`/projects/${enc(projectId)}/defects`, data);
  return response.data;
};

export const updateDefect = async (defectId: string, data: UpdateDefectPayload): Promise<Defect> => {
  const response = await api.patch<Defect>(`/defects/${enc(defectId)}`, data);
  return response.data;
};
