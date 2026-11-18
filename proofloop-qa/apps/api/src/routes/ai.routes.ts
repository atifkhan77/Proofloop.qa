import { Router } from 'express';
import { authenticate, requireRole } from '../middlewares/auth.middleware';
import {
  generateTestCases,
  getRootCauseForDefect,
  getRootCauseForExecution,
} from '../controllers/ai.controller';

const router = Router();

// AI QA Brain: Generate test cases from requirements
router.post(
  '/requirements/:requirementId/ai/generate-test-cases',
  authenticate,
  requireRole(['ADMIN', 'QA_LEAD', 'QA_ENGINEER']),
  generateTestCases
);

router.post(
  '/ai/generate-test-cases',
  authenticate,
  requireRole(['ADMIN', 'QA_LEAD', 'QA_ENGINEER']),
  generateTestCases
);

// Root Cause Analyzer
router.get(
  '/defects/:defectId/root-cause',
  authenticate,
  getRootCauseForDefect
);

router.get(
  '/automation/executions/:executionId/root-cause',
  authenticate,
  getRootCauseForExecution
);

router.get(
  '/ai/root-cause/defect/:defectId',
  authenticate,
  getRootCauseForDefect
);

router.get(
  '/ai/root-cause/execution/:executionId',
  authenticate,
  getRootCauseForExecution
);

export default router;
