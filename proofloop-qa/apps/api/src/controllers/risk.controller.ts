import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { createRiskSchema } from '../validations/risk.validation';
import { handleError } from '../utils/http-error';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** 5x5 matrix banding of score = probability * impact (1..25). */
export const calculateRiskLevel = (score: number): RiskLevel => {
  if (score >= 20) return 'CRITICAL';
  if (score >= 12) return 'HIGH';
  if (score >= 6) return 'MEDIUM';
  return 'LOW';
};

export const createRisk = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { requirementId } = req.params;
    const data = createRiskSchema.parse(req.body);

    // Requirement must belong to the caller's organization.
    const requirement = await prisma.requirement.findFirst({
      where: {
        id: requirementId,
        project: { organizationId: req.user!.organizationId },
      },
    });

    if (!requirement) {
      res.status(404).json({ error: 'Requirement not found' });
      return;
    }

    const riskScore = data.probability * data.impact;

    const risk = await prisma.risk.create({
      data: {
        title: data.title,
        description: data.description,
        probability: data.probability,
        impact: data.impact,
        riskScore,
        level: calculateRiskLevel(riskScore),
        mitigation: data.mitigation,
        requirementId: requirement.id,
      },
    });

    res.status(201).json(risk);
  } catch (error) {
    handleError(error, res);
  }
};

/** Project-wide risk register, highest score first. */
export const getProjectRisks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Risk.requirementId is required with onDelete: Cascade, so every risk has a requirement.
    const risks = await prisma.risk.findMany({
      where: { requirement: { projectId: project.id } },
      include: {
        requirement: { select: { reqId: true, title: true } },
      },
      orderBy: [{ riskScore: 'desc' }, { createdAt: 'desc' }],
    });

    res.json(risks);
  } catch (error) {
    handleError(error, res);
  }
};
