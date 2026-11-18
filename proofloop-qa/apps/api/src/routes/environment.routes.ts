import { Router } from 'express';
import { createEnvironment, getEnvironments } from '../controllers/environment.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();

// Mounted under /api/projects -> /api/projects/:projectId/environments
router.get('/:projectId/environments', authenticate, getEnvironments);
router.post(
  '/:projectId/environments',
  authenticate,
  requireRole(['ADMIN', 'QA_LEAD', 'QA_ENGINEER']),
  createEnvironment,
);

export default router;
