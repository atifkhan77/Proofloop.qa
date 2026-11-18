import { Router } from 'express';
import { authenticate, requireRole } from '../middlewares/auth.middleware';
import {
  getDatabaseConnection,
  updateDatabaseConnection,
  executeDatabaseSentinelQuery,
} from '../controllers/database-sentinel.controller';

const router = Router();

// Database Sentinel Connection Configuration
router.get(
  '/environments/:environmentId/database/connection',
  authenticate,
  getDatabaseConnection
);

// Connection strings carry database credentials: leads and admins only.
router.put(
  '/environments/:environmentId/database/connection',
  authenticate,
  requireRole(['ADMIN', 'QA_LEAD']),
  updateDatabaseConnection
);

// Database Sentinel Read-Only Query Execution
router.post(
  '/environments/:environmentId/database/query',
  authenticate,
  requireRole(['ADMIN', 'QA_LEAD', 'QA_ENGINEER']),
  executeDatabaseSentinelQuery
);

router.post(
  '/database/query',
  authenticate,
  requireRole(['ADMIN', 'QA_LEAD', 'QA_ENGINEER']),
  executeDatabaseSentinelQuery
);

export default router;
