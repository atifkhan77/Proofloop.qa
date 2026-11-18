import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { createAutomationProjectSchema, triggerExecutionSchema } from '../validations/automation.validation';
import { handleError, isUniqueViolation } from '../utils/http-error';
import { executionQueue } from '../lib/queue';

/** Attempts to allocate a free RUN-NNN when concurrent triggers collide on the unique index. */
const RUN_ID_ATTEMPTS = 5;

export const createAutomationProject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;
    const data = createAutomationProjectSchema.parse(req.body);

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const automationProject = await prisma.automationProject.create({
      data: {
        name: data.name,
        description: data.description || null,
        repository: data.repository || null,
        branch: data.branch || null,
        projectId: project.id,
      },
    });

    res.status(201).json(automationProject);
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: 'An automation project with this name already exists' });
      return;
    }
    handleError(error, res);
  }
};

export const getAutomationProjects = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const automationProjects = await prisma.automationProject.findMany({
      where: { projectId: project.id },
      include: { _count: { select: { executions: true, scripts: true } } },
      orderBy: { createdAt: 'desc' },
    });

    res.json(automationProjects);
  } catch (error) {
    handleError(error, res);
  }
};

export const triggerExecution = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { automationProjectId } = req.params;
    const data = triggerExecutionSchema.parse(req.body);

    const automationProject = await prisma.automationProject.findFirst({
      where: {
        id: automationProjectId,
        project: { organizationId: req.user!.organizationId },
      },
    });

    if (!automationProject) {
      res.status(404).json({ error: 'Automation project not found' });
      return;
    }

    // Environment must belong to the SAME project. Without this check a caller could
    // attach another organization's environment, and an unknown id would 500 (FK P2003).
    if (data.environmentId) {
      const environment = await prisma.projectEnvironment.findFirst({
        where: { id: data.environmentId, projectId: automationProject.projectId },
      });
      if (!environment) {
        res.status(400).json({
          error: 'Validation failed',
          details: { environmentId: ['Invalid environment for this project'] },
        });
        return;
      }
    }

    // The worker runs the repository's tests and/or the APPROVED generated scripts.
    if (!automationProject.repository) {
      const approved = await prisma.generatedScript.count({
        where: { automationProjectId: automationProject.id, status: 'APPROVED' },
      });
      if (approved === 0) {
        res.status(400).json({ error: 'Nothing to run: add a repository or approve at least one generated script' });
        return;
      }
    }

    // Sequential RUN-NNN. count+1 races under concurrent triggers; the
    // @@unique([automationProjectId, runId]) index rejects the loser, so retry.
    for (let attempt = 0; attempt < RUN_ID_ATTEMPTS; attempt++) {
      const runCount = await prisma.automationExecution.count({
        where: { automationProjectId: automationProject.id },
      });
      // Count is re-read each attempt, so count+1 is the next free number (no gaps).
      const runId = `RUN-${String(runCount + 1).padStart(3, '0')}`;

      let execution;
      try {
        execution = await prisma.automationExecution.create({
          data: {
            runId,
            status: 'PENDING',
            trigger: data.trigger,
            environmentId: data.environmentId || null,
            automationProjectId: automationProject.id,
          },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        continue;
      }

      // Hand the run to apps/worker. jobId = execution id, so a run is never queued twice.
      try {
        await executionQueue.add(
          'execute-run',
          {
            executionId: execution.id,
            automationProjectId: automationProject.id,
            repository: automationProject.repository,
            branch: automationProject.branch,
            framework: automationProject.framework,
          },
          { jobId: execution.id },
        );
      } catch (error) {
        // Redis unavailable: don't leave a run that is PENDING forever. Keep the row (deleting
        // it would break the count-based RUN-NNN numbering) and mark it CANCELLED.
        console.error(`[queue] Failed to enqueue ${execution.runId} (${execution.id}):`, (error as Error).message);
        await prisma.automationExecution.update({ where: { id: execution.id }, data: { status: 'CANCELLED' } });
        res.status(503).json({ error: 'Execution queue is unavailable, please retry' });
        return;
      }

      res.status(201).json(execution);
      return;
    }

    res.status(503).json({ error: 'Could not allocate a run ID, please retry' });
  } catch (error) {
    handleError(error, res);
  }
};

export const getAutomationExecutions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { automationProjectId } = req.params;

    const automationProject = await prisma.automationProject.findFirst({
      where: {
        id: automationProjectId,
        project: { organizationId: req.user!.organizationId },
      },
    });

    if (!automationProject) {
      res.status(404).json({ error: 'Automation project not found' });
      return;
    }

    const executions = await prisma.automationExecution.findMany({
      where: { automationProjectId: automationProject.id },
      include: {
        projectEnvironment: { select: { name: true } },
      },
      omit: { logs: true, results: true }, // up to ~64 KB each: fetched per run via getAutomationExecution
      orderBy: { createdAt: 'desc' },
      take: 50, // Limit to recent runs for performance
    });

    res.json(executions);
  } catch (error) {
    handleError(error, res);
  }
};

/** One run with its console log tail and per-test results. */
export const getAutomationExecution = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const execution = await prisma.automationExecution.findFirst({
      where: {
        id: req.params.executionId,
        automationProject: { project: { organizationId: req.user!.organizationId } },
      },
      include: { projectEnvironment: { select: { name: true } } },
    });

    if (!execution) {
      res.status(404).json({ error: 'Execution not found' });
      return;
    }

    res.json(execution);
  } catch (error) {
    handleError(error, res);
  }
};
