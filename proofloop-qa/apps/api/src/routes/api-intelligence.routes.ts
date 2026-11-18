import { Router } from 'express';
import {
  createApiCollection,
  getApiCollections,
  getApiCollection,
  createApiRequest,
  getApiRequests,
} from '../controllers/api-intelligence.controller';
import { executeApiRequest, getApiExecution } from '../controllers/api-execution.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';
import { executionRateLimiter } from '../middlewares/rate-limiter';

/**
 * Mounted at /api. `authenticate` is attached PER ROUTE (not router.use) so this
 * router does not intercept unrelated /api requests such as /api/health (ISSUE-LOG P1).
 */
const router = Router();

const writers = requireRole(['ADMIN', 'QA_LEAD', 'QA_ENGINEER']);

// API collections (per project)
router.get('/projects/:projectId/api-collections', authenticate, getApiCollections);
router.post('/projects/:projectId/api-collections', authenticate, writers, createApiCollection);

router.get('/api-collections/:collectionId', authenticate, getApiCollection);

// API requests (per collection)
router.get('/api-collections/:collectionId/requests', authenticate, getApiRequests);
router.post('/api-collections/:collectionId/requests', authenticate, writers, createApiRequest);

// Execute a stored request (server-side HTTP call, SSRF-guarded)
// Limiter AFTER authenticate: it is keyed by organization (API-30).
router.post('/api-requests/:requestId/execute', authenticate, writers, executionRateLimiter, executeApiRequest);

// Read one execution (polling / reload). Environments come from the existing
// GET /projects/:projectId/environments (the builder already knows the project id).
router.get('/api-executions/:executionId', authenticate, getApiExecution);

export default router;
