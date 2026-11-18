import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Plus, FolderGit2, Loader2, AlertCircle } from 'lucide-react';
import { getProjects, type Project } from '@/lib/api/projects';
import { canCreateProject } from '@/lib/permissions';
import { useAuth } from '@/contexts/auth-context';
import CreateProjectModal from '@/components/projects/CreateProjectModal';

export default function DashboardPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const allowCreate = canCreateProject(user?.role);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const data = await getProjects();
        setProjects(data);
      } catch {
        setError('Failed to load projects. Please try again later.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchProjects();
  }, []);

  const handleProjectCreated = (newProject: Project) => {
    // Newest first, matching the API's createdAt desc ordering.
    setProjects((prev) => [newProject, ...prev]);
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center" role="status" aria-label="Loading projects">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="mt-1 text-sm text-sidebar-foreground">Manage your active QA projects and environments.</p>
        </div>
        {allowCreate && (
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </button>
        )}
      </div>

      {error ? (
        <div className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-4 text-red-500" role="alert">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      ) : projects.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-sidebar/50">
          <FolderGit2 className="mb-4 h-10 w-10 text-sidebar-foreground opacity-50" />
          <h3 className="text-lg font-medium text-foreground">No projects yet</h3>
          <p className="mt-1 text-sm text-sidebar-foreground">
            {allowCreate ? 'Get started by creating your first project.' : 'Ask a QA Lead or Admin to create a project.'}
          </p>
          {allowCreate && (
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="mt-4 flex items-center rounded-md bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Project
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/projects/${project.id}`}
              className="group flex flex-col justify-between rounded-xl border border-border bg-sidebar p-5 shadow-sm transition-all hover:border-primary/50 hover:shadow-md"
            >
              <div>
                <div className="flex items-center space-x-3">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <FolderGit2 className="h-5 w-5" />
                  </div>
                  <h3 className="truncate font-semibold text-foreground">{project.name}</h3>
                </div>
                {project.description && (
                  <p className="mt-3 line-clamp-2 text-sm text-sidebar-foreground">{project.description}</p>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-xs text-sidebar-foreground">
                <span>Created {new Date(project.createdAt).toLocaleDateString()}</span>
                <span className="font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">View Details &rarr;</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {allowCreate && (
        <CreateProjectModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={handleProjectCreated} />
      )}
    </div>
  );
}
