import { Network } from 'lucide-react';
import ProjectPicker from '@/components/projects/ProjectPicker';

export default function GlobalIntegrationsPage() {
  return (
    <ProjectPicker
      title="Integrations Engine"
      description="Select a project to configure third-party tool integrations like Jira 2-Way Sync and Slack Webhook Alerts."
      emptyHint="Create a project first to configure integrations."
      emptyIcon={Network}
      to={(id) => `/projects/${id}/integrations`}
      linkLabel="Configure"
    />
  );
}
