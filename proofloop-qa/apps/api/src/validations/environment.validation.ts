import { z } from 'zod';
import { safeUrlSchema } from './common.validation';

/** Environment variable for {{KEY}} substitution (API-23). */
export const createVariableSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Key is required')
    .regex(/^[a-zA-Z0-9_]+$/, 'Keys can only contain letters, numbers, and underscores')
    // {{baseUrl}} comes from the environment's own baseUrl field; a variable must not shadow it.
    .refine((k) => k.toLowerCase() !== 'baseurl', 'baseUrl is set on the environment itself'),
  value: z.string().min(1, 'Value is required'),
  isSecret: z.boolean().default(false),
});

export const createEnvironmentSchema = z.object({
  name: z.string().trim().toUpperCase().min(1, 'Environment name is required'),
  baseUrl: safeUrlSchema.optional().or(z.literal('')),
});
