import { Network } from 'lucide-react';
import ProjectPicker from '@/components/projects/ProjectPicker';

/** Sidebar "API Intelligence" entry: pick a project to open its API collections. */
export default function GlobalApiCollectionsPage() {
  return (
    <ProjectPicker
      title="API Intelligence"
      description="Select a project to design its API test collections."
      emptyHint="Create a project first to design API tests."
      emptyIcon={Network}
      to={(id) => `/projects/${id}/api-collections`}
      linkLabel="Open Collections"
    />
  );
}
