import { BarChart3 } from 'lucide-react';
import ProjectPicker from '@/components/projects/ProjectPicker';

export default function GlobalReportsPage() {
  return (
    <ProjectPicker
      title="Reports & Analytics"
      description="Select a project to view test execution pass rates, defect density, and requirement coverage analytics."
      emptyHint="Create a project first to view QA reports and analytics."
      emptyIcon={BarChart3}
      to={(id) => `/projects/${id}/reports`}
      linkLabel="View Analytics"
    />
  );
}
