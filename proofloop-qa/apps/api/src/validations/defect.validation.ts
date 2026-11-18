import { z } from 'zod';

export const DEFECT_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export const DEFECT_STATUSES = ['OPEN', 'IN_PROGRESS', 'IN_REVIEW', 'CLOSED'] as const;

const severity = z.enum(DEFECT_SEVERITIES, { errorMap: () => ({ message: 'Invalid severity' }) });
const status = z.enum(DEFECT_STATUSES, { errorMap: () => ({ message: 'Invalid status' }) });

export const createDefectSchema = z.object({
  // Uppercase so BUG-001 and bug-001 collide on @@unique([projectId, bugId]) (cf. DATA-04).
  bugId: z.string().trim().toUpperCase().min(1, 'Bug ID is required'),
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().min(1, 'Description is required'),
  stepsToReproduce: z.string().trim().optional(),
  severity,
  status: status.default('OPEN'),
  testCaseId: z.string().trim().optional(),
  testExecutionId: z.string().trim().optional(),
  jiraTicketId: z.string().trim().optional(),
  assigneeId: z.string().trim().optional(),
});

export const updateDefectSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').optional(),
  description: z.string().trim().min(1, 'Description is required').optional(),
  stepsToReproduce: z.string().trim().optional(), // '' clears it (stored as null)
  severity: severity.optional(),
  status: status.optional(),
  assigneeId: z.string().trim().optional().or(z.literal('')), // '' unassigns
});

/** GET /projects/:id/defects query (PERF-03). limit omitted = full list. */
export const listDefectsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().max(100).optional(),
});
