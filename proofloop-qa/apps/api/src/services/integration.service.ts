import axios from 'axios';
import { prisma } from '../db';
import {
  assertSafeUrl,
  checkRedirect,
  safeAgents,
  isSsrfError,
  InvalidEndpointError,
  SsrfBlockedError,
} from '../utils/ssrf-guard';
import { describeError } from '../utils/redact';

const TIMEOUT_MS = 10_000;

export async function sendSlackWebhook(webhookUrl: string, payload: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
  try {
    const url = await assertSafeUrl(webhookUrl);
    await axios.post(url.toString(), payload, {
      timeout: TIMEOUT_MS,
      beforeRedirect: checkRedirect,
      ...safeAgents,
      proxy: false,
    });
    return { success: true };
  } catch (error) {
    if (isSsrfError(error)) {
      return { success: false, error: 'SSRF Blocked: Webhook target resolves to an unauthorized address' };
    }
    if (error instanceof InvalidEndpointError || error instanceof SsrfBlockedError) {
      return { success: false, error: error.message };
    }
    return { success: false, error: (error as Error).message };
  }
}

export async function sendSlackExecutionFailureAlert(
  projectId: string,
  runInfo: { runId: string; projectName: string; trigger: string; passedCount: number; failedCount: number },
): Promise<void> {
  try {
    const integration = await prisma.integration.findFirst({
      where: { projectId, type: 'SLACK', enabled: true },
    });
    if (!integration?.webhookUrl) return;

    const payload = {
      text: `🚨 [ProofLoop] Automation Execution ${runInfo.runId} FAILED in project ${runInfo.projectName}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*🚨 Playwright Automation Execution Failed*\n*Project:* ${runInfo.projectName}\n*Run ID:* ${runInfo.runId}\n*Trigger:* ${runInfo.trigger}\n*Results:* :x: ${runInfo.failedCount} Failed | :white_check_mark: ${runInfo.passedCount} Passed`,
          },
        },
      ],
    };

    await sendSlackWebhook(integration.webhookUrl, payload);
  } catch (err) {
    console.error('[integration.service] Failed to send Slack execution failure alert:', describeError(err));
  }
}

export async function sendSlackCriticalDefectAlert(
  projectId: string,
  defectInfo: { bugId: string; title: string; reporterName: string; projectName: string },
): Promise<void> {
  try {
    const integration = await prisma.integration.findFirst({
      where: { projectId, type: 'SLACK', enabled: true },
    });
    if (!integration?.webhookUrl) return;

    const payload = {
      text: `🔥 [ProofLoop] CRITICAL Defect Logged: ${defectInfo.bugId} - ${defectInfo.title}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*🔥 CRITICAL Defect Logged*\n*Project:* ${defectInfo.projectName}\n*Bug ID:* ${defectInfo.bugId}\n*Title:* ${defectInfo.title}\n*Reporter:* ${defectInfo.reporterName}\n*Severity:* \`CRITICAL\``,
          },
        },
      ],
    };

    await sendSlackWebhook(integration.webhookUrl, payload);
  } catch (err) {
    console.error('[integration.service] Failed to send Slack critical defect alert:', describeError(err));
  }
}

export async function createJiraIssueForDefect(
  projectId: string,
  defect: { id: string; bugId: string; title: string; description: string; stepsToReproduce?: string | null; severity: string },
): Promise<string | null> {
  try {
    const integration = await prisma.integration.findFirst({
      where: { projectId, type: 'JIRA', enabled: true },
    });

    if (
      !integration ||
      !integration.jiraHost ||
      !integration.jiraEmail ||
      !integration.jiraApiToken ||
      !integration.jiraProjectKey
    ) {
      return null;
    }

    const host = integration.jiraHost.replace(/\/+$/, '');
    const issueEndpoint = `${host}/rest/api/2/issue`;
    const url = await assertSafeUrl(issueEndpoint);

    const authHeader = `Basic ${Buffer.from(`${integration.jiraEmail}:${integration.jiraApiToken}`).toString('base64')}`;

    const jiraPayload = {
      fields: {
        project: { key: integration.jiraProjectKey },
        summary: `[ProofLoop ${defect.bugId}] ${defect.title}`,
        description: `${defect.description}\n\n*Steps to Reproduce:*\n${defect.stepsToReproduce || 'None provided'}\n\n*ProofLoop Bug ID:* ${defect.bugId}\n*Severity:* ${defect.severity}`,
        issuetype: { name: integration.jiraIssueType || 'Bug' },
      },
    };

    const response = await axios.post(url.toString(), jiraPayload, {
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: TIMEOUT_MS,
      beforeRedirect: checkRedirect,
      ...safeAgents,
      proxy: false,
    });

    const jiraKey = response.data?.key as string | undefined;
    if (jiraKey) {
      await prisma.defect.update({
        where: { id: defect.id },
        data: { jiraTicketId: jiraKey },
      });
      return jiraKey;
    }
    return null;
  } catch (err) {
    console.error('[integration.service] Failed to push defect to Jira:', describeError(err));
    return null;
  }
}

export async function testJiraConnection(data: {
  jiraHost: string;
  jiraEmail: string;
  jiraApiToken: string;
  jiraProjectKey: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const host = data.jiraHost.replace(/\/+$/, '');
    const endpoint = `${host}/rest/api/2/project/${encodeURIComponent(data.jiraProjectKey)}`;
    const url = await assertSafeUrl(endpoint);

    const authHeader = `Basic ${Buffer.from(`${data.jiraEmail}:${data.jiraApiToken}`).toString('base64')}`;

    const res = await axios.get(url.toString(), {
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
      timeout: TIMEOUT_MS,
      beforeRedirect: checkRedirect,
      ...safeAgents,
      proxy: false,
    });

    if (res.status >= 200 && res.status < 300) {
      return { success: true };
    }
    return { success: false, error: `Jira returned status code ${res.status}` };
  } catch (error) {
    if (isSsrfError(error)) {
      return { success: false, error: 'SSRF Blocked: Jira Host resolves to an unauthorized address' };
    }
    if (error instanceof InvalidEndpointError || error instanceof SsrfBlockedError) {
      return { success: false, error: error.message };
    }
    return { success: false, error: (error as Error).message };
  }
}
