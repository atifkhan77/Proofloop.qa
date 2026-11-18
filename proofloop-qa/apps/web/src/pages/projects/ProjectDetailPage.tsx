import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import { Plus, Boxes, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { getModules, getProject, type Module, type Project } from '@/lib/api/projects';
import { getApiStatus } from '@/lib/api-error';
import { canCreateModule } from '@/lib/permissions';
import { useAuth } from '@/contexts/auth-context';
import CreateModuleModal from '@/components/modules/CreateModuleModal';

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const allowCreate = canCreateModule(user?.role);

  useEffect(() => {
    const fetchProjectData = async () => {
      if (!projectId) return;
      try {
        const [projectData, modulesData] = await Promise.all([
          getProject(projectId),
          getModules(projectId),
        ]);
        setProject(projectData);
        setModules(modulesData);
      } catch (err) {
        setError(getApiStatus(err) === 404 ? 'Project not found' : 'Failed to load project details');
      } finally {
        setIsLoading(false);
      }
    };

    fetchProjectData();
  }, [projectId]);

  const handleModuleCreated = (newModule: Module) => {
    setModules((prev) => [newModule, ...prev]);
  };

  const backLink = (
    <Link to="/" className="inline-flex items-center text-sm font-medium text-sidebar-foreground hover:text-foreground">
      <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
    </Link>
  );

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center" role="status" aria-label="Loading modules">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        {backLink}
        <div className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-4 text-red-500" role="alert">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {backLink}

      <div className="flex items-center justify-between border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {project?.name}
          </h1>
          <p className="mt-1 text-sm text-sidebar-foreground">Manage modules and requirements.</p>
          <div className="mt-2 flex gap-4">
            <Link to={`/projects/${projectId}/risks`} className="inline-flex items-center text-sm font-medium text-primary hover:text-primary/80">
              Risk Register &rarr;
            </Link>
            <Link to={`/projects/${projectId}/test-cases`} className="inline-flex items-center text-sm font-medium text-primary hover:text-primary/80">
              Test Case Studio &rarr;
            </Link>
            <Link to={`/projects/${projectId}/automation`} className="inline-flex items-center text-sm font-medium text-primary hover:text-primary/80">
              Automation Lab &rarr;
            </Link>
            <Link to={`/projects/${projectId}/api-collections`} className="inline-flex items-center text-sm font-medium text-primary hover:text-primary/80">
              API Intelligence &rarr;
            </Link>
            <Link to={`/projects/${projectId}/defects`} className="inline-flex items-center text-sm font-medium text-primary hover:text-primary/80">
              Defect Intelligence &rarr;
            </Link>
            <Link to={`/projects/${projectId}/test-cycles`} className="inline-flex items-center text-sm font-medium text-primary hover:text-primary/80">
              Test Cycles &rarr;
            </Link>
            <Link to={`/projects/${projectId}/reports`} className="inline-flex items-center text-sm font-medium text-primary hover:text-primary/80">
              Reports &rarr;
            </Link>
            <Link to={`/projects/${projectId}/integrations`} className="inline-flex items-center text-sm font-medium text-primary hover:text-primary/80">
              Integrations &rarr;
            </Link>
          </div>
        </div>
        <div className="flex space-x-3">
          <Link
            to={`/projects/${projectId}/traceability`}
            className="flex items-center rounded-md border border-border bg-sidebar px-4 py-2 text-sm font-semibold text-foreground hover:bg-sidebar-accent transition-colors"
          >
            Traceability Matrix
          </Link>
          {allowCreate && (
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="mr-2 h-4 w-4" />
              New Module
            </button>
          )}
        </div>
      </div>

      {modules.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-sidebar/50">
          <Boxes className="mb-4 h-10 w-10 text-sidebar-foreground opacity-50" />
          <h3 className="text-lg font-medium text-foreground">No modules yet</h3>
          <p className="mt-1 text-sm text-sidebar-foreground">Break your project down into functional areas.</p>
          {allowCreate && (
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="mt-4 flex items-center rounded-md bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Module
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((module) => (
            <Link
              key={module.id}
              to={`/modules/${module.id}/requirements`}
              state={{ projectId, projectName: project?.name, moduleName: module.name }}
              className="group flex flex-col justify-between rounded-xl border border-border bg-sidebar p-5 shadow-sm transition-all hover:border-primary/50 hover:shadow-md"
            >
              <div>
                <h3 className="truncate font-semibold text-foreground">{module.name}</h3>
                {module.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-sidebar-foreground">{module.description}</p>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-xs text-sidebar-foreground">
                <span>Created {new Date(module.createdAt).toLocaleDateString()}</span>
                <span className="font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">Requirements &rarr;</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {projectId && allowCreate && (
        <CreateModuleModal
          projectId={projectId}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSuccess={handleModuleCreated}
        />
      )}
    </div>
  );
}
