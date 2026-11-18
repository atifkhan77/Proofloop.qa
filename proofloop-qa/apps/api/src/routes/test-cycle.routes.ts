import { Router } from 'express';
import {
  getProjectTestCycles,
  createTestCycle,
  getTestCycleById,
  updateTestCycle,
  deleteTestCycle,
  addTestCasesToCycle,
  recordExecution,
} from '../controllers/test-cycle.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();
const writers = requireRole(['ADMIN', 'QA_LEAD', 'QA_ENGINEER']);
const leadsOrAdmins = requireRole(['ADMIN', 'QA_LEAD']);

router.get('/projects/:projectId/test-cycles', authenticate, getProjectTestCycles);
router.post('/projects/:projectId/test-cycles', authenticate, writers, createTestCycle);

router.get('/test-cycles/:id', authenticate, getTestCycleById);
router.patch('/test-cycles/:id', authenticate, writers, updateTestCycle);
router.delete('/test-cycles/:id', authenticate, leadsOrAdmins, deleteTestCycle);
router.post('/test-cycles/:id/test-cases', authenticate, writers, addTestCasesToCycle);

router.patch('/test-executions/:executionId', authenticate, writers, recordExecution);

export default router;
