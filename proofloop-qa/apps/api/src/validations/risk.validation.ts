import { z } from 'zod';

// riskScore / level are NOT accepted from the client: computed server-side.
export const createRiskSchema = z.object({
  title: z.string().trim().min(1, 'Risk title is required'),
  description: z.string().trim().min(1, 'Risk description is required'),
  probability: z.number().int().min(1, 'Probability must be at least 1').max(5, 'Probability cannot exceed 5'),
  impact: z.number().int().min(1, 'Impact must be at least 1').max(5, 'Impact cannot exceed 5'),
  mitigation: z.string().trim().optional(),
});
