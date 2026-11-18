import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { FolderGit2, Loader2, AlertCircle, type LucideIcon } from 'lucide-react';
import { getProjects, type Project } from '@/lib/api/projects';
import { getApiErrorMessage } from '@/lib/api-error';

interface ProjectPickerProps {
  title: string;
  description: string;
  emptyHint: string;
  emptyIcon: LucideIcon;
  /** Builds the per-project destination, e.g. (id) => `/projects/${id}/risks`. */
  to: (projectId: string) => string;
  linkLabel: string;
}

/** Shared "select a project" page for top-level sidebar entries (Risk Analysis, Test Case Studio, ...). */
export default function ProjectPicker({ title, description, emptyHint, emptyIcon: EmptyIcon, to, linkLabel }: ProjectPickerProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        setProjects(await getProjects());
      } catch (err) {
        setError(getApiErrorMessage(err, 'Failed to load projects'));
      } finally {
        setIsLoading(false);
      }
    };
    fetchProjects();
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center" role="status" aria-label="Loading projects">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-border pb-5">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-sidebar-foreground">{description}</p>
      </div>

      {error ? (
        <div className="flex items-center space-x-2 rounded-md border border-red-500/20 bg-red-500/10 p-4 text-red-500" role="alert">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      ) : projects.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-sidebar/50">
          <EmptyIcon className="mb-4 h-10 w-10 text-sidebar-foreground opacity-50" />
          <h3 className="text-lg font-medium text-foreground">No projects found</h3>
          <p className="mt-1 text-sm text-sidebar-foreground">{emptyHint}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={to(project.id)}
              className="group flex items-center justify-between rounded-xl border border-border bg-sidebar p-5 shadow-sm transition-all hover:border-primary/50 hover:shadow-md"
            >
              <div className="flex min-w-0 items-center space-x-3">
                <div className="rounded-lg bg-primary/10 p-2 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <FolderGit2 className="h-5 w-5" />
                </div>
                <h3 className="truncate font-semibold text-foreground">{project.name}</h3>
              </div>
              <span className="shrink-0 text-sm font-medium text-sidebar-foreground transition-colors group-hover:text-primary">
                {linkLabel} &rarr;
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
