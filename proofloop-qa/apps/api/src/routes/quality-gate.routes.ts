import { Router } from 'express';
import {
  evaluateQualityGate,
  getQualityGateConfig,
  upsertQualityGateConfig,
} from '../controllers/quality-gate.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();

const leadsAndAdmins = requireRole(['ADMIN', 'QA_LEAD']);

router.get('/projects/:projectId/quality-gate/evaluate', authenticate, evaluateQualityGate);
router.get('/projects/:projectId/quality-gate/config', authenticate, getQualityGateConfig);
router.put('/projects/:projectId/quality-gate/config', authenticate, leadsAndAdmins, upsertQualityGateConfig);

export default router;
