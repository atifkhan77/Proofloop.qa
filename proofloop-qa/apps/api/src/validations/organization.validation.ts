import { z } from 'zod';

export const updateUserRoleSchema = z.object({
  role: z.enum(['ADMIN', 'QA_LEAD', 'QA_ENGINEER', 'VIEWER'], { errorMap: () => ({ message: 'Invalid role' }) }),
});
