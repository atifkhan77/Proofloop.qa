import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { handleError } from '../utils/http-error';

export const getModuleById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { moduleId } = req.params;

    const module = await prisma.module.findFirst({
      where: {
        id: moduleId,
        project: { organizationId: req.user!.organizationId },
      },
      // Only what the breadcrumb needs from the parent project.
      include: { project: { select: { id: true, name: true } } },
    });

    if (!module) {
      res.status(404).json({ error: 'Module not found' });
      return;
    }

    res.json(module);
  } catch (error) {
    handleError(error, res);
  }
};
