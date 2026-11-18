import { Router } from 'express';
import { createTestCase, getProjectTestCases, getTestCaseById } from '../controllers/test-case.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

/**
 * Mounted at /api. `authenticate` is attached PER ROUTE (not router.use) so this
 * router does not intercept unrelated /api requests such as /api/health.
 */
const router = Router();

// List test cases for a project
router.get('/projects/:projectId/test-cases', authenticate, getProjectTestCases);

// Create a test case (with optional steps) inside a project
router.post(
  '/projects/:projectId/test-cases',
  authenticate,
  requireRole(['ADMIN', 'QA_LEAD', 'QA_ENGINEER']),
  createTestCase,
);

// Single test case with ordered steps
router.get('/test-cases/:testCaseId', authenticate, getTestCaseById);

export default router;
