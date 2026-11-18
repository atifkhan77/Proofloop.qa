import { TestTube } from 'lucide-react';
import ProjectPicker from '@/components/projects/ProjectPicker';

/** Sidebar "Test Case Studio" entry: pick a project to open its test cases. */
export default function GlobalTestCasesPage() {
  return (
    <ProjectPicker
      title="Test Case Studio"
      description="Select a project to design and manage its test cases."
      emptyHint="Create a project first to design test cases."
      emptyIcon={TestTube}
      to={(id) => `/projects/${id}/test-cases`}
      linkLabel="Open Studio"
    />
  );
}
