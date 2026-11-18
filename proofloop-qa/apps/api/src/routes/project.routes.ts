import { Router } from 'express';
import { createProject, getProjects, getProjectById, createModule, getModules, getProjectMembers } from '../controllers/project.controller';
import { getProjectRequirements } from '../controllers/requirement.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();

// All routes require a valid session
router.use(authenticate);

// Viewers can read; Admins and Leads can create projects
router.get('/', getProjects);
router.post('/', requireRole(['ADMIN', 'QA_LEAD']), createProject);

router.get('/:projectId', getProjectById);
router.get('/:projectId/members', getProjectMembers);

// Flat requirement list for the project (read-only, all roles). Mounted here
// (/api/projects) so the URL is /api/projects/:projectId/requirements.
router.get('/:projectId/requirements', getProjectRequirements);

// Engineers, Leads, and Admins can create modules
router.get('/:projectId/modules', getModules);
router.post('/:projectId/modules', requireRole(['ADMIN', 'QA_LEAD', 'QA_ENGINEER']), createModule);

export default router;
