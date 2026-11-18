import { z } from 'zod';

export const upsertQualityGateConfigSchema = z.object({
  requireFullCoverage: z.boolean().default(false),
  requireCriticalRiskCoverage: z.boolean().default(true),
  maxActiveCriticalDefects: z.number().int().min(0).default(0),
  maxActiveHighDefects: z.number().int().min(0).default(2),
});

export type UpsertQualityGateConfigInput = z.infer<typeof upsertQualityGateConfigSchema>;
