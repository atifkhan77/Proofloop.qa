import { Router } from 'express';
import {
  getProjectIntegrations,
  upsertSlackIntegration,
  upsertJiraIntegration,
  testSlackIntegration,
  testJira,
  syncDefectToJira,
} from '../controllers/integration.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();
const adminsOrLeads = requireRole(['ADMIN', 'QA_LEAD']);

router.get('/projects/:projectId/integrations', authenticate, getProjectIntegrations);
router.put('/projects/:projectId/integrations/slack', authenticate, adminsOrLeads, upsertSlackIntegration);
router.put('/projects/:projectId/integrations/jira', authenticate, adminsOrLeads, upsertJiraIntegration);
router.post('/projects/:projectId/integrations/slack/test', authenticate, adminsOrLeads, testSlackIntegration);
router.post('/projects/:projectId/integrations/jira/test', authenticate, adminsOrLeads, testJira);
router.post('/projects/:projectId/defects/:defectId/jira-sync', authenticate, requireRole(['ADMIN', 'QA_LEAD', 'QA_ENGINEER']), syncDefectToJira);

export default router;
