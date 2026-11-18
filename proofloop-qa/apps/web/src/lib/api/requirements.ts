import { api } from '../api-client';

export interface Requirement {
  id: string;
  reqId: string;
  title: string;
  description: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  businessCriticality: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
  moduleId: string;
  projectId: string;
  createdAt: string;
  _count?: {
    testCases: number;
    risks: number;
  };
}

export type CreateRequirementData = Omit<Requirement, 'id' | 'moduleId' | 'projectId' | 'createdAt' | '_count'>;

export interface RequirementSummary {
  id: string;
  reqId: string;
  title: string;
}

/** Flat list of all requirements in a project, sorted by reqId. */
export const getProjectRequirements = async (projectId: string): Promise<RequirementSummary[]> => {
  const response = await api.get<RequirementSummary[]>(`/projects/${encodeURIComponent(projectId)}/requirements`);
  return response.data;
};

export const getRequirements = async (moduleId: string): Promise<Requirement[]> => {
  const response = await api.get<Requirement[]>(`/modules/${encodeURIComponent(moduleId)}/requirements`);
  return response.data;
};

export const createRequirement = async (moduleId: string, data: CreateRequirementData): Promise<Requirement> => {
  const response = await api.post<Requirement>(`/modules/${encodeURIComponent(moduleId)}/requirements`, data);
  return response.data;
};
