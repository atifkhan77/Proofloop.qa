import { Router } from 'express';
import { getOrganizationUsers, updateUserRole, softDeleteUser } from '../controllers/organization.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

/**
 * Mounted at /api. ADMIN only. `authenticate` + `requireRole` are attached PER ROUTE:
 * as `router.use(...)` on an /api mount they would answer every unmatched /api request
 * (incl. /api/health) with 401, or 403 for logged-in non-admins (ISSUE-LOG P1).
 */
const router = Router();

const admins = requireRole(['ADMIN']);

router.get('/organization/users', authenticate, admins, getOrganizationUsers);
router.patch('/organization/users/:userId/role', authenticate, admins, updateUserRole);
router.delete('/organization/users/:userId', authenticate, admins, softDeleteUser);

export default router;
