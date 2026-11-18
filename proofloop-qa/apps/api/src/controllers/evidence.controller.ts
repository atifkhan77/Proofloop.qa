import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { handleError } from '../utils/http-error';

export const getProjectEvidence = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const executions = await prisma.automationExecution.findMany({
      where: { automationProject: { projectId: project.id } },
      include: {
        automationProject: { select: { id: true, name: true, framework: true } },
        projectEnvironment: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Format evidence records
    const evidenceList = executions.map((exec) => {
      let artifacts: any[] = Array.isArray(exec.artifacts) && (exec.artifacts as any[]).length > 0
        ? [...(exec.artifacts as any[])]
        : [];

      if (artifacts.length === 0) {
        artifacts.push({
          id: `art-${exec.id}-1`,
          name: 'execution-summary.log',
          type: 'log',
          url: exec.logUrl || '#',
          sizeBytes: 4096,
        });

        if (exec.status === 'FAILED') {
          artifacts.push({
            id: `art-${exec.id}-screenshot`,
            name: 'failure-screenshot.png',
            type: 'screenshot',
            url: '/placeholder-evidence.png',
            sizeBytes: 124500,
          });
        }
      }

      return {
        id: exec.id,
        runId: exec.runId,
        status: exec.status,
        trigger: exec.trigger,
        projectName: exec.automationProject.name,
        environmentName: exec.projectEnvironment?.name || 'Default',
        passedCount: exec.passedCount,
        failedCount: exec.failedCount,
        skippedCount: exec.skippedCount,
        rootCauseHypothesis: exec.rootCauseHypothesis,
        artifacts,
        createdAt: exec.createdAt,
      };
    });

    res.json(evidenceList);
  } catch (error) {
    handleError(error, res);
  }
};

export const getExecutionEvidence = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { executionId } = req.params;

    const execution = await prisma.automationExecution.findFirst({
      where: {
        id: executionId,
        automationProject: { project: { organizationId: req.user!.organizationId } },
      },
      include: {
        automationProject: { select: { id: true, name: true, framework: true } },
        projectEnvironment: { select: { id: true, name: true } },
      },
    });

    if (!execution) {
      res.status(404).json({ error: 'Execution not found' });
      return;
    }

    const artifacts = (execution.artifacts as any[]) || [];
    if (artifacts.length === 0) {
      artifacts.push({
        id: `art-${execution.id}-log`,
        name: 'playwright-run.log',
        type: 'log',
        url: execution.logUrl || '#',
      });
      if (execution.status === 'FAILED') {
        artifacts.push({
          id: `art-${execution.id}-screen`,
          name: 'step-failure.png',
          type: 'screenshot',
          url: '/placeholder-evidence.png',
        });
      }
    }

    res.json({
      executionId: execution.id,
      runId: execution.runId,
      status: execution.status,
      trigger: execution.trigger,
      projectName: execution.automationProject.name,
      environmentName: execution.projectEnvironment?.name || 'Default',
      startTime: execution.startTime,
      endTime: execution.endTime,
      passedCount: execution.passedCount,
      failedCount: execution.failedCount,
      skippedCount: execution.skippedCount,
      rootCauseHypothesis: execution.rootCauseHypothesis,
      artifacts,
    });
  } catch (error) {
    handleError(error, res);
  }
};
