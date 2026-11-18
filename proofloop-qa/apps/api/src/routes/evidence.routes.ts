import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import {
  getProjectEvidence,
  getExecutionEvidence,
} from '../controllers/evidence.controller';

const router = Router();

// Evidence Explorer
router.get(
  '/projects/:projectId/evidence',
  authenticate,
  getProjectEvidence
);

router.get(
  '/automation/executions/:executionId/evidence',
  authenticate,
  getExecutionEvidence
);

export default router;
