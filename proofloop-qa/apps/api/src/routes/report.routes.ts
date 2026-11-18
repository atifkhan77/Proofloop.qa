import { Router } from 'express';
import { getProjectReports } from '../controllers/report.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

router.get('/projects/:projectId/reports', authenticate, getProjectReports);

export default router;
