import { z } from 'zod';

// trim() must run before min(1): checks apply in order, so `.min(1).trim()`
// would accept "   " and store an empty string.
export const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required'),
  description: z.string().trim().optional(),
});

export const createModuleSchema = z.object({
  name: z.string().trim().min(1, 'Module name is required'),
  description: z.string().trim().optional(),
});
