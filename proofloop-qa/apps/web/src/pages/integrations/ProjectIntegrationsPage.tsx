import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Send,
  Link2,
  Eye,
  EyeOff,
  BellRing,
  Check,
} from 'lucide-react';
import {
  getProjectIntegrations,
  upsertSlackIntegration,
  upsertJiraIntegration,
  testSlackIntegration,
  testJiraIntegration,
} from '@/lib/api/integrations';
import { getProject, type Project } from '@/lib/api/projects';
import { getApiErrorMessage } from '@/lib/api-error';
import { useAuth } from '@/contexts/auth-context';
import { canManageIntegrations } from '@/lib/permissions';

export default function ProjectIntegrationsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const canManage = canManageIntegrations(user?.role);

  // Slack state
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackWebhookUrl, setSlackWebhookUrl] = useState('');
  const [slackChannel, setSlackChannel] = useState('');
  const [isSavingSlack, setIsSavingSlack] = useState(false);
  const [isTestingSlack, setIsTestingSlack] = useState(false);
  const [slackTestResult, setSlackTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Jira state
  const [jiraEnabled, setJiraEnabled] = useState(false);
  const [jiraHost, setJiraHost] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraApiToken, setJiraApiToken] = useState('');
  const [hasExistingJiraToken, setHasExistingJiraToken] = useState(false);
  const [showJiraToken, setShowJiraToken] = useState(false);
  const [jiraProjectKey, setJiraProjectKey] = useState('');
  const [jiraIssueType, setJiraIssueType] = useState('Bug');
  const [isSavingJira, setIsSavingJira] = useState(false);
  const [isTestingJira, setIsTestingJira] = useState(false);
  const [jiraTestResult, setJiraTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!projectId) return;
      try {
        const [proj, integrations] = await Promise.all([
          getProject(projectId),
          getProjectIntegrations(projectId),
        ]);
        setProject(proj);

        const slack = integrations.find((i) => i.type === 'SLACK');
        if (slack) {
          setSlackEnabled(slack.enabled);
          setSlackWebhookUrl(slack.webhookUrl || '');
          setSlackChannel(slack.channel || '');
        }

        const jira = integrations.find((i) => i.type === 'JIRA');
        if (jira) {
          setJiraEnabled(jira.enabled);
          setJiraHost(jira.jiraHost || '');
          setJiraEmail(jira.jiraEmail || '');
          setHasExistingJiraToken(!!jira.hasJiraApiToken);
          setJiraProjectKey(jira.jiraProjectKey || '');
          setJiraIssueType(jira.jiraIssueType || 'Bug');
        }
      } catch (err) {
        setError(getApiErrorMessage(err, 'Failed to load integrations'));
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [projectId]);

  const handleSaveSlack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !canManage) return;
    try {
      setIsSavingSlack(true);
      setError(null);
      setSuccessMessage(null);
      setSlackTestResult(null);

      await upsertSlackIntegration(projectId, {
        enabled: slackEnabled,
        webhookUrl: slackWebhookUrl.trim(),
        channel: slackChannel.trim() || null,
      });

      setSuccessMessage('Slack integration saved successfully');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to save Slack integration'));
    } finally {
      setIsSavingSlack(false);
    }
  };

  const handleTestSlack = async () => {
    if (!slackWebhookUrl.trim()) {
      setError('Please provide a Slack Webhook URL to test');
      return;
    }
    try {
      setIsTestingSlack(true);
      setError(null);
      setSlackTestResult(null);

      const res = await testSlackIntegration({ webhookUrl: slackWebhookUrl.trim() });
      setSlackTestResult({ success: true, message: res.message || 'Slack test message delivered successfully!' });
    } catch (err) {
      setSlackTestResult({ success: false, message: getApiErrorMessage(err, 'Slack test delivery failed') });
    } finally {
      setIsTestingSlack(false);
    }
  };

  const handleSaveJira = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !canManage) return;
    try {
      setIsSavingJira(true);
      setError(null);
      setSuccessMessage(null);
      setJiraTestResult(null);

      await upsertJiraIntegration(projectId, {
        enabled: jiraEnabled,
        jiraHost: jiraHost.trim(),
        jiraEmail: jiraEmail.trim(),
        jiraApiToken: jiraApiToken.trim(),
        jiraProjectKey: jiraProjectKey.trim().toUpperCase(),
        jiraIssueType: jiraIssueType.trim() || 'Bug',
      });

      setHasExistingJiraToken(true);
      setSuccessMessage('Jira integration saved successfully');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to save Jira integration'));
    } finally {
      setIsSavingJira(false);
    }
  };

  const handleTestJira = async () => {
    if (!jiraHost.trim() || !jiraEmail.trim() || !jiraApiToken.trim() || !jiraProjectKey.trim()) {
      setError('Please provide Jira Host, Email, API Token, and Project Key to test');
      return;
    }
    try {
      setIsTestingJira(true);
      setError(null);
      setJiraTestResult(null);

      const res = await testJiraIntegration({
        jiraHost: jiraHost.trim(),
        jiraEmail: jiraEmail.trim(),
        jiraApiToken: jiraApiToken.trim(),
        jiraProjectKey: jiraProjectKey.trim().toUpperCase(),
      });
      setJiraTestResult({ success: true, message: res.message || 'Jira connection verified successfully!' });
    } catch (err) {
      setJiraTestResult({ success: false, message: getApiErrorMessage(err, 'Jira connection failed') });
    } finally {
      setIsTestingJira(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center" role="status" aria-label="Loading integrations">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to={`/projects/${projectId}`} className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground mb-3">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to {project?.name || 'Project'}
        </Link>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Integrations Engine</h1>
            <p className="mt-1 text-sm text-sidebar-foreground">
              Connect external services to synchronize defects and trigger real-time quality alerts.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-4 text-red-500" role="alert">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="flex items-center space-x-2 rounded-md border border-green-500/20 bg-green-500/10 p-4 text-green-500">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{successMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Slack Alerts Card */}
        <div className="rounded-xl border border-border bg-sidebar p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between border-b border-border pb-4 mb-5">
              <div className="flex items-center space-x-3">
                <div className="rounded-lg bg-emerald-500/10 p-2.5 text-emerald-500">
                  <BellRing className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">Slack Incoming Webhooks</h2>
                  <p className="text-xs text-sidebar-foreground">Automated team notifications for critical QA events</p>
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                slackEnabled && slackWebhookUrl ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-sidebar-accent text-sidebar-foreground border-border'
              }`}>
                {slackEnabled && slackWebhookUrl ? 'Connected' : 'Not Connected'}
              </span>
            </div>

            <p className="text-xs text-sidebar-foreground mb-4 leading-relaxed">
              ProofLoop will automatically dispatch formatted messages to your Slack channel whenever:
              <br />• A <strong>Playwright Automation Execution</strong> finishes with FAILED status.
              <br />• A <strong>CRITICAL</strong> severity defect is logged by a team member.
            </p>

            <form id="slack-form" onSubmit={handleSaveSlack} className="space-y-4">
              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="slack-enabled"
                  checked={slackEnabled}
                  disabled={!canManage}
                  onChange={(e) => setSlackEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <label htmlFor="slack-enabled" className="text-sm font-medium text-foreground cursor-pointer">
                  Enable Slack webhook notifications for this project
                </label>
              </div>

              <div>
                <label htmlFor="slack-webhook-url" className="block text-xs font-medium text-foreground mb-1">
                  Webhook URL <span className="text-red-500">*</span>
                </label>
                <input
                  type="url"
                  id="slack-webhook-url"
                  required
                  disabled={!canManage}
                  placeholder="https://hooks.slack.com/services/..."
                  value={slackWebhookUrl}
                  onChange={(e) => setSlackWebhookUrl(e.target.value)}
                  className="w-full rounded-md border border-border bg-sidebar px-3 py-2 text-sm text-foreground placeholder:text-sidebar-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label htmlFor="slack-channel" className="block text-xs font-medium text-foreground mb-1">
                  Channel Name (Optional)
                </label>
                <input
                  type="text"
                  id="slack-channel"
                  disabled={!canManage}
                  placeholder="#qa-alerts"
                  value={slackChannel}
                  onChange={(e) => setSlackChannel(e.target.value)}
                  className="w-full rounded-md border border-border bg-sidebar px-3 py-2 text-sm text-foreground placeholder:text-sidebar-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {slackTestResult && (
                <div className={`flex items-center space-x-2 rounded-md p-3 text-xs font-medium ${
                  slackTestResult.success ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'
                }`}>
                  {slackTestResult.success ? <Check className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                  <span>{slackTestResult.message}</span>
                </div>
              )}
            </form>
          </div>

          <div className="mt-6 pt-4 border-t border-border flex items-center justify-between">
            <button
              type="button"
              disabled={isTestingSlack || !slackWebhookUrl || !canManage}
              onClick={handleTestSlack}
              className="inline-flex items-center rounded-md border border-border bg-sidebar px-3 py-1.5 text-xs font-medium text-foreground hover:bg-sidebar-accent transition-colors disabled:opacity-50"
            >
              {isTestingSlack ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
              Test Webhook
            </button>

            {canManage && (
              <button
                type="submit"
                form="slack-form"
                disabled={isSavingSlack}
                className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isSavingSlack && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Slack Settings
              </button>
            )}
          </div>
        </div>

        {/* Jira 2-Way Sync Card */}
        <div className="rounded-xl border border-border bg-sidebar p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between border-b border-border pb-4 mb-5">
              <div className="flex items-center space-x-3">
                <div className="rounded-lg bg-blue-500/10 p-2.5 text-blue-500">
                  <Link2 className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">Jira 2-Way Sync</h2>
                  <p className="text-xs text-sidebar-foreground">Synchronize defects directly to Atlassian Jira</p>
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                jiraEnabled && jiraHost ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' : 'bg-sidebar-accent text-sidebar-foreground border-border'
              }`}>
                {jiraEnabled && jiraHost ? 'Connected' : 'Not Connected'}
              </span>
            </div>

            <p className="text-xs text-sidebar-foreground mb-4 leading-relaxed">
              When enabled, any defect created in ProofLoop is pushed to your Jira board via their REST API. The Jira Issue Key (e.g. <code>PROJ-101</code>) is automatically stored in ProofLoop for traceability.
            </p>

            <form id="jira-form" onSubmit={handleSaveJira} className="space-y-4">
              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="jira-enabled"
                  checked={jiraEnabled}
                  disabled={!canManage}
                  onChange={(e) => setJiraEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <label htmlFor="jira-enabled" className="text-sm font-medium text-foreground cursor-pointer">
                  Enable automatic Jira defect synchronization
                </label>
              </div>

              <div>
                <label htmlFor="jira-host" className="block text-xs font-medium text-foreground mb-1">
                  Jira Host URL <span className="text-red-500">*</span>
                </label>
                <input
                  type="url"
                  id="jira-host"
                  required
                  disabled={!canManage}
                  placeholder="https://your-domain.atlassian.net"
                  value={jiraHost}
                  onChange={(e) => setJiraHost(e.target.value)}
                  className="w-full rounded-md border border-border bg-sidebar px-3 py-2 text-sm text-foreground placeholder:text-sidebar-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="jira-email" className="block text-xs font-medium text-foreground mb-1">
                    Jira User Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    id="jira-email"
                    required
                    disabled={!canManage}
                    placeholder="bot@company.com"
                    value={jiraEmail}
                    onChange={(e) => setJiraEmail(e.target.value)}
                    className="w-full rounded-md border border-border bg-sidebar px-3 py-2 text-sm text-foreground placeholder:text-sidebar-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label htmlFor="jira-token" className="block text-xs font-medium text-foreground mb-1">
                    API Token <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showJiraToken ? 'text' : 'password'}
                      id="jira-token"
                      required={!hasExistingJiraToken}
                      disabled={!canManage}
                      placeholder={hasExistingJiraToken ? '•••••••• (unchanged)' : 'Enter API token'}
                      value={jiraApiToken}
                      onChange={(e) => setJiraApiToken(e.target.value)}
                      className="w-full rounded-md border border-border bg-sidebar pl-3 pr-9 py-2 text-sm text-foreground placeholder:text-sidebar-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      type="button"
                      onClick={() => setShowJiraToken(!showJiraToken)}
                      className="absolute right-2.5 top-2.5 text-sidebar-foreground hover:text-foreground"
                    >
                      {showJiraToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="jira-project-key" className="block text-xs font-medium text-foreground mb-1">
                    Jira Project Key <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    id="jira-project-key"
                    required
                    disabled={!canManage}
                    placeholder="PROJ"
                    value={jiraProjectKey}
                    onChange={(e) => setJiraProjectKey(e.target.value.toUpperCase())}
                    className="w-full rounded-md border border-border bg-sidebar px-3 py-2 text-sm text-foreground uppercase placeholder:text-sidebar-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label htmlFor="jira-issue-type" className="block text-xs font-medium text-foreground mb-1">
                    Issue Type
                  </label>
                  <input
                    type="text"
                    id="jira-issue-type"
                    disabled={!canManage}
                    placeholder="Bug"
                    value={jiraIssueType}
                    onChange={(e) => setJiraIssueType(e.target.value)}
                    className="w-full rounded-md border border-border bg-sidebar px-3 py-2 text-sm text-foreground placeholder:text-sidebar-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              {jiraTestResult && (
                <div className={`flex items-center space-x-2 rounded-md p-3 text-xs font-medium ${
                  jiraTestResult.success ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'
                }`}>
                  {jiraTestResult.success ? <Check className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                  <span>{jiraTestResult.message}</span>
                </div>
              )}
            </form>
          </div>

          <div className="mt-6 pt-4 border-t border-border flex items-center justify-between">
            <button
              type="button"
              disabled={isTestingJira || !jiraHost || !jiraEmail || !jiraApiToken || !jiraProjectKey || !canManage}
              onClick={handleTestJira}
              className="inline-flex items-center rounded-md border border-border bg-sidebar px-3 py-1.5 text-xs font-medium text-foreground hover:bg-sidebar-accent transition-colors disabled:opacity-50"
            >
              {isTestingJira ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
              Test Connection
            </button>

            {canManage && (
              <button
                type="submit"
                form="jira-form"
                disabled={isSavingJira}
                className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isSavingJira && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Jira Settings
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
