import { Router } from 'express';
import { addEnvironmentVariable, getEnvironmentVariables } from '../controllers/environment.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

/**
 * Mounted at /api -> /api/environments/:environmentId/variables.
 * (Not in environment.routes.ts: that router is mounted at /api/projects, which would give
 * /api/projects/:environmentId/variables – an environment id in a project URL, cf. ROUTE-02.)
 * `authenticate` per route so this router never intercepts other /api requests (P1).
 */
const router = Router();

// Read: all authenticated roles; secret values are always masked.
router.get('/environments/:environmentId/variables', authenticate, getEnvironmentVariables);

// Write: QA_ENGINEER and above.
router.post(
  '/environments/:environmentId/variables',
  authenticate,
  requireRole(['ADMIN', 'QA_LEAD', 'QA_ENGINEER']),
  addEnvironmentVariable,
);

export default router;
