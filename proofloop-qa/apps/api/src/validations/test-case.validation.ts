import { z } from 'zod';

// No stepNumber: the server numbers steps 1..n from array order. Any client-sent
// stepNumber is stripped by z.object (unknown keys are dropped).
const testStepSchema = z.object({
  action: z.string().trim().min(1, 'Step action is required'),
  expectedResult: z.string().trim().min(1, 'Expected result is required'),
});

export const createTestCaseSchema = z.object({
  // Uppercased so 'tc-001' and 'TC-001' collide on @@unique([projectId, tcId]).
  tcId: z.string().trim().toUpperCase().min(1, 'Test Case ID is required'),
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().optional(),
  preconditions: z.string().trim().optional(),
  testData: z.string().trim().optional(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW'], { errorMap: () => ({ message: 'Invalid priority' }) }),
  testType: z.enum(['UI', 'API', 'DATABASE', 'REGRESSION', 'FUNCTIONAL', 'SECURITY'], {
    errorMap: () => ({ message: 'Invalid test type' }),
  }),
  automationStatus: z.enum(['MANUAL', 'AUTOMATED', 'IN_PROGRESS'], {
    errorMap: () => ({ message: 'Invalid automation status' }),
  }),
  requirementId: z.string().trim().optional(), // optional: exploratory tests may not map to a requirement
  steps: z.array(testStepSchema).optional(),
});
