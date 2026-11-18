import { Bot } from 'lucide-react';
import ProjectPicker from '@/components/projects/ProjectPicker';

/** Sidebar "Automation Lab" entry: pick a project to open its Automation Lab. */
export default function GlobalAutomationPage() {
  return (
    <ProjectPicker
      title="Automation Lab"
      description="Select a project to manage its automation suites, environments and runs."
      emptyHint="Create a project first to set up automation."
      emptyIcon={Bot}
      to={(id) => `/projects/${id}/automation`}
      linkLabel="Open Lab"
    />
  );
}
