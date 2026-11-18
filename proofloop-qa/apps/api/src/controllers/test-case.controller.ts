import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { createTestCaseSchema } from '../validations/test-case.validation';
import { handleError, isUniqueViolation } from '../utils/http-error';

export const createTestCase = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;
    const data = createTestCaseSchema.parse(req.body);

    // Project must belong to the caller's organization.
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // An optional requirement must belong to THIS project.
    if (data.requirementId) {
      const requirement = await prisma.requirement.findFirst({
        where: { id: data.requirementId, projectId: project.id },
      });
      if (!requirement) {
        res.status(400).json({
          error: 'Validation failed',
          details: { requirementId: ['Invalid requirement ID for this project'] },
        });
        return;
      }
    }

    // Nested write: TestCase + TestSteps are created atomically.
    const testCase = await prisma.testCase.create({
      data: {
        tcId: data.tcId,
        title: data.title,
        description: data.description,
        preconditions: data.preconditions,
        testData: data.testData,
        priority: data.priority,
        testType: data.testType,
        automationStatus: data.automationStatus,
        projectId: project.id,
        requirementId: data.requirementId || null,
        steps: data.steps?.length
          ? {
              // Sequential 1..n from array order: no gaps, no duplicates.
              create: data.steps.map((step, index) => ({
                stepNumber: index + 1,
                action: step.action,
                expectedResult: step.expectedResult,
              })),
            }
          : undefined,
      },
      include: { steps: { orderBy: { stepNumber: 'asc' } } },
    });

    res.status(201).json(testCase);
  } catch (error) {
    // Step numbers are server-assigned and unique, so P2002 here is the
    // @@unique([projectId, tcId]) constraint.
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: 'A Test Case with this ID already exists in this project' });
      return;
    }
    handleError(error, res);
  }
};

export const getProjectTestCases = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const testCases = await prisma.testCase.findMany({
      where: { projectId: project.id },
      include: {
        requirement: { select: { reqId: true, title: true } },
        _count: { select: { steps: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    res.json(testCases);
  } catch (error) {
    handleError(error, res);
  }
};

export const getTestCaseById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { testCaseId } = req.params;

    const testCase = await prisma.testCase.findFirst({
      where: {
        id: testCaseId,
        project: { organizationId: req.user!.organizationId },
      },
      include: {
        steps: { orderBy: { stepNumber: 'asc' } },
        requirement: { select: { reqId: true, title: true } },
      },
    });

    if (!testCase) {
      res.status(404).json({ error: 'Test case not found' });
      return;
    }

    res.json(testCase);
  } catch (error) {
    handleError(error, res);
  }
};
