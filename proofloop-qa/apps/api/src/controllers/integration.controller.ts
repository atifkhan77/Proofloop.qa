import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middlewares/auth.middleware';
import {
  upsertSlackIntegrationSchema,
  upsertJiraIntegrationSchema,
  testSlackSchema,
  testJiraSchema,
} from '../validations/integration.validation';
import {
  sendSlackWebhook,
  testJiraConnection,
  createJiraIssueForDefect,
} from '../services/integration.service';
import { handleError } from '../utils/http-error';
import { assertSafeUrl, isSsrfError } from '../utils/ssrf-guard';

/**
 * Mask secrets. The Jira token is masked for everyone; the Slack webhook URL is itself a
 * credential (anyone holding it can post to the channel), so only roles that may edit
 * integrations (ADMIN, QA_LEAD) see it.
 */
const redactIntegration = <T extends { jiraApiToken: string | null; webhookUrl: string | null }>(
  integration: T,
  canManage: boolean,
) => {
  const result: T & { hasJiraApiToken: boolean; hasWebhookUrl: boolean } = {
    ...integration,
    hasJiraApiToken: !!integration.jiraApiToken,
    hasWebhookUrl: !!integration.webhookUrl,
  };
  if (result.jiraApiToken) result.jiraApiToken = '********';
  if (result.webhookUrl && !canManage) result.webhookUrl = '********';
  return result;
};

export const getProjectIntegrations = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const integrations = await prisma.integration.findMany({
      where: { projectId: project.id },
    });

    const canManage = req.user?.role === 'ADMIN' || req.user?.role === 'QA_LEAD';
    const redacted = integrations.map((it) => redactIntegration(it, canManage));

    res.json(redacted);
  } catch (error) {
    handleError(error, res);
  }
};

export const upsertSlackIntegration = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;
    const data = upsertSlackIntegrationSchema.parse(req.body);

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Checked at save time too: the worker posts failure alerts to this URL.
    try {
      await assertSafeUrl(data.webhookUrl);
    } catch (error) {
      res.status(400).json({
        error: isSsrfError(error) ? (error as Error).message : 'Webhook host could not be resolved',
      });
      return;
    }

    const integration = await prisma.integration.upsert({
      where: {
        projectId_type: {
          projectId: project.id,
          type: 'SLACK',
        },
      },
      update: {
        enabled: data.enabled,
        webhookUrl: data.webhookUrl,
        channel: data.channel ?? null,
      },
      create: {
        projectId: project.id,
        type: 'SLACK',
        name: 'Slack Alerts',
        enabled: data.enabled,
        webhookUrl: data.webhookUrl,
        channel: data.channel ?? null,
      },
    });

    res.json(integration);
  } catch (error) {
    handleError(error, res);
  }
};

export const upsertJiraIntegration = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;
    const data = upsertJiraIntegrationSchema.parse(req.body);

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const integration = await prisma.integration.upsert({
      where: {
        projectId_type: {
          projectId: project.id,
          type: 'JIRA',
        },
      },
      update: {
        enabled: data.enabled,
        jiraHost: data.jiraHost,
        jiraEmail: data.jiraEmail,
        jiraApiToken: data.jiraApiToken,
        jiraProjectKey: data.jiraProjectKey,
        jiraIssueType: data.jiraIssueType,
      },
      create: {
        projectId: project.id,
        type: 'JIRA',
        name: 'Jira 2-Way Sync',
        enabled: data.enabled,
        jiraHost: data.jiraHost,
        jiraEmail: data.jiraEmail,
        jiraApiToken: data.jiraApiToken,
        jiraProjectKey: data.jiraProjectKey,
        jiraIssueType: data.jiraIssueType,
      },
    });

    res.json(redactIntegration(integration, false));
  } catch (error) {
    handleError(error, res);
  }
};

export const testSlackIntegration = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = testSlackSchema.parse(req.body);
    const result = await sendSlackWebhook(data.webhookUrl, {
      text: '👋 Test notification from ProofLoop QA Platform! Slack webhook integration is working properly.',
    });

    if (!result.success) {
      res.status(400).json({ error: result.error || 'Failed to send test message to Slack' });
      return;
    }

    res.json({ message: 'Slack test notification sent successfully' });
  } catch (error) {
    handleError(error, res);
  }
};

export const testJira = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = testJiraSchema.parse(req.body);
    const result = await testJiraConnection(data);

    if (!result.success) {
      res.status(400).json({ error: result.error || 'Failed to connect to Jira' });
      return;
    }

    res.json({ message: 'Jira connection verified successfully' });
  } catch (error) {
    handleError(error, res);
  }
};

export const syncDefectToJira = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId, defectId } = req.params;

    const defect = await prisma.defect.findFirst({
      where: { id: defectId, projectId, project: { organizationId: req.user!.organizationId } },
    });

    if (!defect) {
      res.status(404).json({ error: 'Defect not found' });
      return;
    }

    const jiraKey = await createJiraIssueForDefect(projectId, defect);
    if (!jiraKey) {
      res.status(400).json({ error: 'Jira sync failed. Check that Jira integration is enabled and configured.' });
      return;
    }

    res.json({ success: true, jiraTicketId: jiraKey });
  } catch (error) {
    handleError(error, res);
  }
};
