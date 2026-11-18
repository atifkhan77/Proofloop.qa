import { z } from 'zod';

export const INTEGRATION_TYPES = ['JIRA', 'SLACK'] as const;
export const integrationTypeEnum = z.enum(INTEGRATION_TYPES, {
  errorMap: () => ({ message: 'Invalid integration type. Must be JIRA or SLACK' }),
});

const requiredUrlSchema = z
  .string()
  .trim()
  .min(1, 'URL is required')
  .refine(
    (val) => {
      try {
        const url = new URL(val);
        return ['http:', 'https:'].includes(url.protocol);
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid HTTP or HTTPS URL' },
  );

export const upsertSlackIntegrationSchema = z.object({
  enabled: z.boolean().default(true),
  webhookUrl: requiredUrlSchema,
  channel: z.string().trim().optional().nullable(),
});

export const upsertJiraIntegrationSchema = z.object({
  enabled: z.boolean().default(true),
  jiraHost: requiredUrlSchema,
  jiraEmail: z.string().trim().email('Valid email is required'),
  jiraApiToken: z.string().trim().min(1, 'Jira API Token is required'),
  jiraProjectKey: z.string().trim().toUpperCase().min(1, 'Jira Project Key is required'),
  jiraIssueType: z.string().trim().min(1).default('Bug'),
});

export const testSlackSchema = z.object({
  webhookUrl: requiredUrlSchema,
});

export const testJiraSchema = z.object({
  jiraHost: requiredUrlSchema,
  jiraEmail: z.string().trim().email('Valid email is required'),
  jiraApiToken: z.string().trim().min(1, 'Jira API Token is required'),
  jiraProjectKey: z.string().trim().toUpperCase().min(1, 'Jira Project Key is required'),
});

export type UpsertSlackIntegrationInput = z.infer<typeof upsertSlackIntegrationSchema>;
export type UpsertJiraIntegrationInput = z.infer<typeof upsertJiraIntegrationSchema>;
export type TestSlackInput = z.infer<typeof testSlackSchema>;
export type TestJiraInput = z.infer<typeof testJiraSchema>;
