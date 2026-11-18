import { z } from 'zod';
import { safeUrlSchema } from './common.validation';

export const createAutomationProjectSchema = z.object({
  name: z.string().trim().min(1, 'Automation project name is required'),
  description: z.string().trim().optional(),
  // Trim first, then validate; '' means "no repository".
  repository: safeUrlSchema.optional().or(z.literal('')),
  branch: z.string().trim().optional(),
});

export const triggerExecutionSchema = z.object({
  environmentId: z.string().trim().optional(),
  trigger: z.enum(['MANUAL', 'SCHEDULED', 'CI_CD']).default('MANUAL'),
});

/** Plain file name only: written into the sandbox workspace, so no path separators or "..". */
export const SCRIPT_FILE_NAME = /^[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)*\.spec\.ts$/;

export const generateScriptSchema = z.object({
  testCaseId: z.string().trim().min(1, 'testCaseId is required'),
});

export const updateScriptSchema = z
  .object({
    code: z.string().min(1, 'Script code is required').max(100_000, 'Script is too large (max 100,000 characters)').optional(),
    fileName: z
      .string()
      .trim()
      .max(120)
      .regex(SCRIPT_FILE_NAME, 'Use lowercase letters, digits, "-" or "_", ending in .spec.ts')
      .optional(),
    status: z.enum(['DRAFT', 'APPROVED']).optional(),
  })
  .refine((d) => d.code !== undefined || d.fileName !== undefined || d.status !== undefined, {
    message: 'Nothing to update',
  });
