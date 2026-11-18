import { Router } from 'express';
import { createDefect, getProjectDefects, getDefectById, updateDefect } from '../controllers/defect.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

/**
 * Mounted at /api. `authenticate` is attached PER ROUTE (not router.use) so this router does
 * not intercept unrelated /api requests such as /api/health (ISSUE-LOG P1).
 */
const router = Router();

const writers = requireRole(['ADMIN', 'QA_LEAD', 'QA_ENGINEER']);

// List and create defects within a project
router.get('/projects/:projectId/defects', authenticate, getProjectDefects);
router.post('/projects/:projectId/defects', authenticate, writers, createDefect);

// Detail and update of a single defect
router.get('/defects/:defectId', authenticate, getDefectById);
router.patch('/defects/:defectId', authenticate, writers, updateDefect);

export default router;
