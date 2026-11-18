import { Router } from 'express';
import {
  createAutomationProject,
  getAutomationProjects,
  getAutomationExecutions,
  getAutomationExecution,
  triggerExecution,
} from '../controllers/automation.controller';
import { getScripts, generateScript, updateScript, deleteScript, downloadScript } from '../controllers/script.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

/**
 * Mounted at /api. `authenticate` is attached PER ROUTE (not router.use) so this
 * router does not intercept unrelated /api requests such as /api/health.
 */
const router = Router();

const writers = requireRole(['ADMIN', 'QA_LEAD', 'QA_ENGINEER']);

// View and create Automation Projects
router.get('/projects/:projectId/automation', authenticate, getAutomationProjects);
router.post('/projects/:projectId/automation', authenticate, writers, createAutomationProject);

// List test runs and trigger a new test run
router.get('/automation/:automationProjectId/executions', authenticate, getAutomationExecutions);
router.post('/automation/:automationProjectId/executions', authenticate, writers, triggerExecution);

// One run with logs and per-test results
router.get('/automation/executions/:executionId', authenticate, getAutomationExecution);

// Generated Playwright scripts (stored in the DB; only APPROVED ones are executed)
router.get('/automation/:automationProjectId/scripts', authenticate, getScripts);
router.post('/automation/:automationProjectId/scripts/generate', authenticate, writers, generateScript);
router.patch('/automation/scripts/:scriptId', authenticate, writers, updateScript);
router.delete('/automation/scripts/:scriptId', authenticate, writers, deleteScript);
router.get('/automation/scripts/:scriptId/download', authenticate, downloadScript);

export default router;
