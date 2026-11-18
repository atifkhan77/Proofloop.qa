import { api } from '../api-client';

export interface QualityGateConfig {
  id?: string;
  projectId: string;
  requireFullCoverage: boolean;
  requireCriticalRiskCoverage: boolean;
  maxActiveCriticalDefects: number;
  maxActiveHighDefects: number;
}

export interface QualityGateCriteriaItem {
  required?: boolean;
  maxAllowed?: number;
  passed: boolean;
  current: string | number;
}

export interface QualityGateEvaluation {
  isReleaseReady: boolean;
  status: 'GO' | 'NO_GO';
  blockingReasons: string[];
  criteria: {
    fullCoverage: QualityGateCriteriaItem;
    criticalRisks: QualityGateCriteriaItem;
    criticalDefects: QualityGateCriteriaItem;
    highDefects: QualityGateCriteriaItem;
  };
  metrics: {
    requirementCoverageRate: number;
    totalRequirements: number;
    coveredRequirements: number;
    activeCriticalDefects: number;
    activeHighDefects: number;
    criticalRisksCovered: boolean;
    overallPassRate: number;
  };
  config: QualityGateConfig;
}

export const getQualityGateEvaluation = async (
  projectId: string,
  notify = false,
): Promise<QualityGateEvaluation> => {
  const res = await api.get<QualityGateEvaluation>(
    `/projects/${encodeURIComponent(projectId)}/quality-gate/evaluate${notify ? '?notify=true' : ''}`,
  );
  return res.data;
};

export const getQualityGateConfig = async (projectId: string): Promise<QualityGateConfig> => {
  const res = await api.get<QualityGateConfig>(
    `/projects/${encodeURIComponent(projectId)}/quality-gate/config`,
  );
  return res.data;
};

export const updateQualityGateConfig = async (
  projectId: string,
  data: Partial<QualityGateConfig>,
): Promise<QualityGateConfig> => {
  const res = await api.put<QualityGateConfig>(
    `/projects/${encodeURIComponent(projectId)}/quality-gate/config`,
    data,
  );
  return res.data;
};
