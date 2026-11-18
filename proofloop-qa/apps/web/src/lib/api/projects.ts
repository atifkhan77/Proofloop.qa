import { api } from '../api-client';

// Subsets of the API's Project / Module JSON (apps/api/src/controllers/project.controller.ts).
export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface Module {
  id: string;
  name: string;
  description: string | null;
  projectId: string;
  createdAt: string;
}

/** GET /modules/:id — module plus the parent project fields the API selects. */
export interface ModuleWithProject extends Module {
  project: Pick<Project, 'id' | 'name'>;
}

export const getProjects = async (): Promise<Project[]> => {
  const response = await api.get<Project[]>('/projects');
  return response.data;
};

export const getProject = async (projectId: string): Promise<Project> => {
  const response = await api.get<Project>(`/projects/${encodeURIComponent(projectId)}`);
  return response.data;
};

export const createProject = async (data: { name: string; description?: string }): Promise<Project> => {
  const response = await api.post<Project>('/projects', data);
  return response.data;
};

export const getModules = async (projectId: string): Promise<Module[]> => {
  const response = await api.get<Module[]>(`/projects/${encodeURIComponent(projectId)}/modules`);
  return response.data;
};

export const getModule = async (moduleId: string): Promise<ModuleWithProject> => {
  const response = await api.get<ModuleWithProject>(`/modules/${encodeURIComponent(moduleId)}`);
  return response.data;
};

export const createModule = async (
  projectId: string,
  data: { name: string; description?: string },
): Promise<Module> => {
  const response = await api.post<Module>(`/projects/${encodeURIComponent(projectId)}/modules`, data);
  return response.data;
};

export interface ProjectMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

export const getProjectMembers = async (projectId: string): Promise<ProjectMember[]> => {
  const response = await api.get<ProjectMember[]>(`/projects/${encodeURIComponent(projectId)}/members`);
  return response.data;
};
