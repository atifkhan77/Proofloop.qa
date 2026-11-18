import { ShieldAlert } from 'lucide-react';
import ProjectPicker from '@/components/projects/ProjectPicker';

/** Sidebar "Risk Analysis" entry: pick a project to open its Risk Register. */
export default function GlobalRisksPage() {
  return (
    <ProjectPicker
      title="Risk Analysis"
      description="Select a project to view its Risk Register."
      emptyHint="Create a project first to manage risks."
      emptyIcon={ShieldAlert}
      to={(id) => `/projects/${id}/risks`}
      linkLabel="View Register"
    />
  );
}
