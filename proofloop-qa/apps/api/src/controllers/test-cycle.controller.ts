import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middlewares/auth.middleware';
import {
  createTestCycleSchema,
  updateTestCycleSchema,
  recordExecutionSchema,
  addTestCasesToCycleSchema,
} from '../validations/test-cycle.validation';
import { handleError, isUniqueViolation } from '../utils/http-error';

const userSelect = { select: { id: true, firstName: true, lastName: true } } as const;

export const getProjectTestCycles = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const cycles = await prisma.testCycle.findMany({
      where: { projectId: project.id },
      include: {
        environment: { select: { id: true, name: true } },
        executions: {
          select: {
            id: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = cycles.map((cycle) => {
      const executions = cycle.executions;
      const totalCount = executions.length;
      const passedCount = executions.filter((e) => e.status === 'PASSED').length;
      const failedCount = executions.filter((e) => e.status === 'FAILED').length;
      const skippedCount = executions.filter((e) => e.status === 'SKIPPED').length;
      const pendingCount = executions.filter((e) => e.status === 'PENDING').length;
      const blockedCount = executions.filter((e) => e.status === 'BLOCKED').length;
      const passRate = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;

      return {
        id: cycle.id,
        cycleId: cycle.cycleId,
        name: cycle.name,
        description: cycle.description,
        status: cycle.status,
        environment: cycle.environment,
        createdAt: cycle.createdAt,
        updatedAt: cycle.updatedAt,
        stats: {
          totalCount,
          passedCount,
          failedCount,
          skippedCount,
          pendingCount,
          blockedCount,
          passRate,
        },
      };
    });

    res.json(formatted);
  } catch (error) {
    handleError(error, res);
  }
};

export const createTestCycle = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;
    const data = createTestCycleSchema.parse(req.body);

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (data.environmentId) {
      const env = await prisma.projectEnvironment.findFirst({
        where: { id: data.environmentId, projectId: project.id },
      });
      if (!env) {
        res.status(400).json({ error: 'Validation failed', details: { environmentId: ['Invalid environment'] } });
        return;
      }
    }

    // Verify all test cases belong to this project
    const validTestCases = await prisma.testCase.findMany({
      where: {
        id: { in: data.testCaseIds },
        projectId: project.id,
      },
      select: { id: true },
    });

    if (validTestCases.length !== data.testCaseIds.length) {
      res.status(400).json({
        error: 'Validation failed',
        details: { testCaseIds: ['One or more test cases do not belong to this project'] },
      });
      return;
    }

    // Retry loop for sequential cycleId (CYC-001, CYC-002, ...)
    let attempts = 0;
    const maxAttempts = 5;
    while (attempts < maxAttempts) {
      attempts++;
      try {
        const count = await prisma.testCycle.count({ where: { projectId: project.id } });
        const cycleId = `CYC-${String(count + attempts).padStart(3, '0')}`;

        const created = await prisma.$transaction(async (tx) => {
          const cycle = await tx.testCycle.create({
            data: {
              cycleId,
              name: data.name,
              description: data.description || null,
              environmentId: data.environmentId || null,
              projectId: project.id,
              status: 'PLANNED',
            },
            include: {
              environment: { select: { id: true, name: true } },
            },
          });

          await tx.testExecution.createMany({
            data: data.testCaseIds.map((tcId) => ({
              testCycleId: cycle.id,
              testCaseId: tcId,
              status: 'PENDING',
            })),
          });

          return {
            ...cycle,
            stats: {
              totalCount: data.testCaseIds.length,
              passedCount: 0,
              failedCount: 0,
              skippedCount: 0,
              pendingCount: data.testCaseIds.length,
              blockedCount: 0,
              passRate: 0,
            },
          };
        });

        res.status(201).json(created);
        return;
      } catch (err) {
        if (isUniqueViolation(err) && attempts < maxAttempts) {
          continue;
        }
        throw err;
      }
    }

    res.status(500).json({ error: 'Failed to allocate unique cycle ID' });
  } catch (error) {
    handleError(error, res);
  }
};

export const getTestCycleById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const cycle = await prisma.testCycle.findFirst({
      where: {
        id,
        project: { organizationId: req.user!.organizationId },
      },
      include: {
        project: { select: { id: true, name: true } },
        environment: { select: { id: true, name: true, baseUrl: true } },
        executions: {
          include: {
            executedBy: userSelect,
            testCase: {
              select: {
                id: true,
                tcId: true,
                title: true,
                description: true,
                priority: true,
                testType: true,
                preconditions: true,
                testData: true,
                steps: {
                  orderBy: { stepNumber: 'asc' },
                  select: { id: true, stepNumber: true, action: true, expectedResult: true },
                },
              },
            },
            defects: {
              select: {
                id: true,
                bugId: true,
                title: true,
                severity: true,
                status: true,
                jiraTicketId: true,
              },
            },
          },
          orderBy: { testCase: { tcId: 'asc' } },
        },
      },
    });

    if (!cycle) {
      res.status(404).json({ error: 'Test cycle not found' });
      return;
    }

    const totalCount = cycle.executions.length;
    const passedCount = cycle.executions.filter((e) => e.status === 'PASSED').length;
    const failedCount = cycle.executions.filter((e) => e.status === 'FAILED').length;
    const skippedCount = cycle.executions.filter((e) => e.status === 'SKIPPED').length;
    const pendingCount = cycle.executions.filter((e) => e.status === 'PENDING').length;
    const blockedCount = cycle.executions.filter((e) => e.status === 'BLOCKED').length;
    const passRate = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;

    res.json({
      ...cycle,
      stats: {
        totalCount,
        passedCount,
        failedCount,
        skippedCount,
        pendingCount,
        blockedCount,
        passRate,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
};

export const updateTestCycle = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = updateTestCycleSchema.parse(req.body);

    const cycle = await prisma.testCycle.findFirst({
      where: { id, project: { organizationId: req.user!.organizationId } },
    });

    if (!cycle) {
      res.status(404).json({ error: 'Test cycle not found' });
      return;
    }

    if (data.environmentId && data.environmentId !== '') {
      const env = await prisma.projectEnvironment.findFirst({
        where: { id: data.environmentId, projectId: cycle.projectId },
      });
      if (!env) {
        res.status(400).json({ error: 'Validation failed', details: { environmentId: ['Invalid environment'] } });
        return;
      }
    }

    const updated = await prisma.testCycle.update({
      where: { id: cycle.id },
      data: {
        name: data.name,
        description: data.description === '' ? null : data.description,
        status: data.status,
        environmentId: data.environmentId === '' ? null : data.environmentId,
      },
      include: {
        environment: { select: { id: true, name: true } },
      },
    });

    res.json(updated);
  } catch (error) {
    handleError(error, res);
  }
};

export const deleteTestCycle = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const cycle = await prisma.testCycle.findFirst({
      where: { id, project: { organizationId: req.user!.organizationId } },
    });

    if (!cycle) {
      res.status(404).json({ error: 'Test cycle not found' });
      return;
    }

    await prisma.testCycle.delete({ where: { id: cycle.id } });
    res.status(204).send();
  } catch (error) {
    handleError(error, res);
  }
};

export const addTestCasesToCycle = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = addTestCasesToCycleSchema.parse(req.body);

    const cycle = await prisma.testCycle.findFirst({
      where: { id, project: { organizationId: req.user!.organizationId } },
    });

    if (!cycle) {
      res.status(404).json({ error: 'Test cycle not found' });
      return;
    }

    const validTestCases = await prisma.testCase.findMany({
      where: {
        id: { in: data.testCaseIds },
        projectId: cycle.projectId,
      },
      select: { id: true },
    });

    // Check existing executions
    const existingExecutions = await prisma.testExecution.findMany({
      where: { testCycleId: cycle.id },
      select: { testCaseId: true },
    });
    const existingTcSet = new Set(existingExecutions.map((e) => e.testCaseId));

    const newTestCases = validTestCases.filter((tc) => !existingTcSet.has(tc.id));

    if (newTestCases.length > 0) {
      await prisma.testExecution.createMany({
        data: newTestCases.map((tc) => ({
          testCycleId: cycle.id,
          testCaseId: tc.id,
          status: 'PENDING',
        })),
      });
    }

    res.status(200).json({ addedCount: newTestCases.length });
  } catch (error) {
    handleError(error, res);
  }
};

export const recordExecution = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { executionId } = req.params;
    const data = recordExecutionSchema.parse(req.body);

    const execution = await prisma.testExecution.findFirst({
      where: {
        id: executionId,
        testCycle: { project: { organizationId: req.user!.organizationId } },
      },
      include: {
        testCycle: true,
        testCase: { select: { id: true, tcId: true, title: true } },
      },
    });

    if (!execution) {
      res.status(404).json({ error: 'Test execution not found' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedExec = await tx.testExecution.update({
        where: { id: execution.id },
        data: {
          status: data.status,
          notes: data.notes === '' ? null : data.notes,
          executedById: req.user!.id,
          executedAt: new Date(),
        },
        include: {
          executedBy: userSelect,
          testCase: {
            select: {
              id: true,
              tcId: true,
              title: true,
              priority: true,
              testType: true,
            },
          },
          defects: {
            select: { id: true, bugId: true, title: true, status: true, severity: true },
          },
        },
      });

      // Advance cycle status to IN_PROGRESS if currently PLANNED
      if (execution.testCycle.status === 'PLANNED') {
        await tx.testCycle.update({
          where: { id: execution.testCycleId },
          data: { status: 'IN_PROGRESS' },
        });
      }

      return updatedExec;
    });

    res.json({
      ...updated,
      suggestDefect: data.status === 'FAILED',
    });
  } catch (error) {
    handleError(error, res);
  }
};
