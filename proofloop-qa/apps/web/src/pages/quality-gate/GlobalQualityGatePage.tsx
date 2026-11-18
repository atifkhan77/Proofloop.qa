import { CheckCircle2 } from 'lucide-react';
import ProjectPicker from '@/components/projects/ProjectPicker';

export default function GlobalQualityGatePage() {
  return (
    <ProjectPicker
      title="Release Quality Gate"
      description="Select a project to evaluate automated Go / No-Go criteria and release readiness."
      emptyHint="Create a project first to evaluate release quality gates."
      emptyIcon={CheckCircle2}
      to={(id) => `/projects/${id}/releases`}
      linkLabel="Evaluate Quality Gate"
    />
  );
}
