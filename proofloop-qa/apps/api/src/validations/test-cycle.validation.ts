import { z } from 'zod';

export const TEST_CYCLE_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'ABORTED'] as const;
export const TEST_EXECUTION_STATUSES = ['PENDING', 'PASSED', 'FAILED', 'SKIPPED', 'BLOCKED'] as const;

export const createTestCycleSchema = z.object({
  name: z.string().trim().min(1, 'Cycle name is required'),
  description: z.string().trim().optional(),
  environmentId: z.string().trim().optional(),
  testCaseIds: z.array(z.string().trim()).min(1, 'Select at least one test case for this cycle'),
});

export const updateTestCycleSchema = z.object({
  name: z.string().trim().min(1, 'Cycle name is required').optional(),
  description: z.string().trim().optional().or(z.literal('')),
  status: z.enum(TEST_CYCLE_STATUSES, { errorMap: () => ({ message: 'Invalid cycle status' }) }).optional(),
  environmentId: z.string().trim().optional().or(z.literal('')),
});

export const addTestCasesToCycleSchema = z.object({
  testCaseIds: z.array(z.string().trim()).min(1, 'Select at least one test case to add'),
});

export const recordExecutionSchema = z.object({
  status: z.enum(TEST_EXECUTION_STATUSES, { errorMap: () => ({ message: 'Invalid execution status' }) }),
  notes: z.string().trim().optional().or(z.literal('')),
});
