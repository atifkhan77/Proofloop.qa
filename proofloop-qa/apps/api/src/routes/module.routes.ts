import { Router } from 'express';
import { getModuleById } from '../controllers/module.controller';
import { createRequirement, getRequirements } from '../controllers/requirement.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

// Mounted at /api/modules
router.get('/:moduleId', getModuleById);

router.get('/:moduleId/requirements', getRequirements);
router.post('/:moduleId/requirements', requireRole(['ADMIN', 'QA_LEAD', 'QA_ENGINEER']), createRequirement);

export default router;
