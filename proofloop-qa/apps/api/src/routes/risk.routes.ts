import { Router } from 'express';
import { createRisk, getProjectRisks } from '../controllers/risk.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

/**
 * Mounted at /api. `authenticate` is attached PER ROUTE, not via router.use():
 * a router-level guard on an /api mount would intercept every unmatched /api
 * request (e.g. /api/health, unknown paths) and answer 401.
 */
const router = Router();

// Project-wide risk register (read-only, all authenticated roles)
router.get('/projects/:projectId/risks', authenticate, getProjectRisks);

// Create a risk under a specific requirement
router.post(
  '/requirements/:requirementId/risks',
  authenticate,
  requireRole(['ADMIN', 'QA_LEAD', 'QA_ENGINEER']),
  createRisk,
);

export default router;
