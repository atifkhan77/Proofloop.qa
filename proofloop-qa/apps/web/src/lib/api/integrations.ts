import { api } from '../api-client';

export interface Integration {
  id: string;
  type: 'JIRA' | 'SLACK';
  name?: string | null;
  enabled: boolean;
  webhookUrl?: string | null;
  channel?: string | null;
  jiraHost?: string | null;
  jiraEmail?: string | null;
  jiraApiToken?: string | null;
  hasJiraApiToken?: boolean;
  jiraProjectKey?: string | null;
  jiraIssueType?: string | null;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SlackPayload {
  enabled: boolean;
  webhookUrl: string;
  channel?: string | null;
}

export interface JiraPayload {
  enabled: boolean;
  jiraHost: string;
  jiraEmail: string;
  jiraApiToken: string;
  jiraProjectKey: string;
  jiraIssueType?: string;
}

export const getProjectIntegrations = async (projectId: string): Promise<Integration[]> => {
  const res = await api.get<Integration[]>(`/projects/${encodeURIComponent(projectId)}/integrations`);
  return res.data;
};

export const upsertSlackIntegration = async (projectId: string, data: SlackPayload): Promise<Integration> => {
  const res = await api.put<Integration>(`/projects/${encodeURIComponent(projectId)}/integrations/slack`, data);
  return res.data;
};

export const upsertJiraIntegration = async (projectId: string, data: JiraPayload): Promise<Integration> => {
  const res = await api.put<Integration>(`/projects/${encodeURIComponent(projectId)}/integrations/jira`, data);
  return res.data;
};

export const testSlackIntegration = async (data: { webhookUrl: string }): Promise<{ message: string }> => {
  const res = await api.post<{ message: string }>('/projects/any/integrations/slack/test', data);
  return res.data;
};

export const testJiraIntegration = async (data: {
  jiraHost: string;
  jiraEmail: string;
  jiraApiToken: string;
  jiraProjectKey: string;
}): Promise<{ message: string }> => {
  const res = await api.post<{ message: string }>('/projects/any/integrations/jira/test', data);
  return res.data;
};

export const syncDefectToJira = async (
  projectId: string,
  defectId: string,
): Promise<{ success: boolean; jiraTicketId: string }> => {
  const res = await api.post<{ success: boolean; jiraTicketId: string }>(
    `/projects/${encodeURIComponent(projectId)}/defects/${encodeURIComponent(defectId)}/jira-sync`,
  );
  return res.data;
};
