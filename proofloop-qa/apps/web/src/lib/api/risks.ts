import { api } from '../api-client';

export type RiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface Risk {
  id: string;
  title: string;
  description: string;
  probability: number;
  impact: number;
  riskScore: number; // computed server-side
  level: RiskLevel; // computed server-side
  mitigation: string | null;
  requirementId: string;
  requirement?: {
    reqId: string;
    title: string;
  };
  createdAt: string;
}

export type CreateRiskData = {
  title: string;
  description: string;
  probability: number;
  impact: number;
  mitigation?: string;
};

export const getProjectRisks = async (projectId: string): Promise<Risk[]> => {
  const response = await api.get<Risk[]>(`/projects/${encodeURIComponent(projectId)}/risks`);
  return response.data;
};

export const createRisk = async (requirementId: string, data: CreateRiskData): Promise<Risk> => {
  const response = await api.post<Risk>(`/requirements/${encodeURIComponent(requirementId)}/risks`, data);
  return response.data;
};
