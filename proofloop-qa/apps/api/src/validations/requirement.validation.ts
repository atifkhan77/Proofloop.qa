import { z } from 'zod';

export const requirementSchema = z.object({
  // Uppercased so 'req-001' and 'REQ-001' collide on @@unique([projectId, reqId]).
  reqId: z.string().trim().toUpperCase().min(1, 'Requirement ID is required'), // e.g., REQ-001
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().min(1, 'Description is required'),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW'], { errorMap: () => ({ message: 'Invalid priority' }) }),
  businessCriticality: z.enum(['CRITICAL', 'HIGH', 'MODERATE', 'LOW'], {
    errorMap: () => ({ message: 'Invalid criticality' }),
  }),
});
