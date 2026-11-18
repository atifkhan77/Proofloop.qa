import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { requirementSchema } from '../validations/requirement.validation';
import { handleError, isUniqueViolation } from '../utils/http-error';

export const createRequirement = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { moduleId } = req.params;
    const data = requirementSchema.parse(req.body);

    // Verify module exists and belongs to the user's organization
    const module = await prisma.module.findFirst({
      where: {
        id: moduleId,
        project: { organizationId: req.user!.organizationId },
      },
    });

    if (!module) {
      res.status(404).json({ error: 'Module not found' });
      return;
    }

    const requirement = await prisma.requirement.create({
      data: {
        ...data,
        moduleId: module.id,
        projectId: module.projectId,
      },
    });

    res.status(201).json(requirement);
  } catch (error) {
    // Requirement has @@unique([projectId, reqId]) in schema.prisma.
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: 'A requirement with this ID already exists in this project' });
      return;
    }
    handleError(error, res);
  }
};

/** Flat, lightweight list of a project's requirements (e.g. for pickers). */
export const getProjectRequirements = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const requirements = await prisma.requirement.findMany({
      where: { projectId: project.id },
      select: { id: true, reqId: true, title: true },
      orderBy: { reqId: 'asc' },
    });

    res.json(requirements);
  } catch (error) {
    handleError(error, res);
  }
};

export const getRequirements = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { moduleId } = req.params;

    // Verify module access
    const module = await prisma.module.findFirst({
      where: {
        id: moduleId,
        project: { organizationId: req.user!.organizationId },
      },
    });

    if (!module) {
      res.status(404).json({ error: 'Module not found' });
      return;
    }

    const requirements = await prisma.requirement.findMany({
      where: { moduleId: module.id },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { testCases: true, risks: true },
        },
      },
    });

    res.json(requirements);
  } catch (error) {
    handleError(error, res);
  }
};
