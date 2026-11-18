import { Router } from 'express';
import { getTraceabilityMatrix } from '../controllers/traceability.controller';
import { authenticate } from '../middlewares/auth.middleware';

/**
 * Reporting / analytics routes. Mounted at /api, so `authenticate` is attached
 * PER ROUTE: a router-level guard would intercept unrelated /api requests
 * (e.g. /api/health) and answer 401. All authenticated roles, incl. VIEWER, may read.
 */
const router = Router();

router.get('/projects/:projectId/traceability', authenticate, getTraceabilityMatrix);

export default router;
