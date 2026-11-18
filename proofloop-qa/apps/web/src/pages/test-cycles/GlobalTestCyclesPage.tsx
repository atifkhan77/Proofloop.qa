import { History } from 'lucide-react';
import ProjectPicker from '@/components/projects/ProjectPicker';

export default function GlobalTestCyclesPage() {
  return (
    <ProjectPicker
      title="Test Execution Cycles"
      description="Select a project to manage manual test cycles, step through test executions, and track regression runs."
      emptyHint="Create a project first to author test cycles."
      emptyIcon={History}
      to={(id) => `/projects/${id}/test-cycles`}
      linkLabel="Open Cycles"
    />
  );
}
