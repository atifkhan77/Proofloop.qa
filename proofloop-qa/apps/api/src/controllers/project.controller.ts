import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { createProjectSchema, createModuleSchema } from '../validations/project.validation';
import { handleError, isUniqueViolation } from '../utils/http-error';

export const createProject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createProjectSchema.parse(req.body);

    const project = await prisma.project.create({
      data: {
        name: data.name,
        description: data.description,
        organizationId: req.user!.organizationId,
      },
    });

    res.status(201).json(project);
  } catch (error) {
    handleError(error, res);
  }
};

export const getProjects = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projects = await prisma.project.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' },
    });

    res.json(projects);
  } catch (error) {
    handleError(error, res);
  }
};

export const getProjectById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json(project);
  } catch (error) {
    handleError(error, res);
  }
};

export const createModule = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;
    const data = createModuleSchema.parse(req.body);

    // Verify the project exists AND belongs to the user's organization
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const module = await prisma.module.create({
      data: {
        name: data.name,
        description: data.description,
        projectId: project.id,
      },
    });

    res.status(201).json(module);
  } catch (error) {
    // Module has @@unique([projectId, name]) in schema.prisma.
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: 'A module with this name already exists in this project' });
      return;
    }
    handleError(error, res);
  }
};

export const getModules = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;

    // Verify access to the parent project first
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const modules = await prisma.module.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
    });

    res.json(modules);
  } catch (error) {
    handleError(error, res);
  }
};

export const getProjectMembers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const members = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId, deletedAt: null },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    res.json(members);
  } catch (error) {
    handleError(error, res);
  }
};
