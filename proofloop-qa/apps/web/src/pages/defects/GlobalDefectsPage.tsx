import { Bug } from 'lucide-react';
import ProjectPicker from '@/components/projects/ProjectPicker';

/** Sidebar "Defect Intelligence" entry: pick a project to open its defects. */
export default function GlobalDefectsPage() {
  return (
    <ProjectPicker
      title="Defect Intelligence"
      description="Select a project to track and resolve its defects."
      emptyHint="Create a project first to report defects."
      emptyIcon={Bug}
      to={(id) => `/projects/${id}/defects`}
      linkLabel="Open Defects"
    />
  );
}
