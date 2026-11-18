import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { generateTestCasesForRequirement, analyzeRootCause } from '../services/llm.service';
import { handleError } from '../utils/http-error';

export const generateTestCases = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requirementId = req.params.requirementId || req.body?.requirementId;
    const { autoSave } = req.body || {};

    if (!requirementId) {
      res.status(400).json({ error: 'requirementId is required' });
      return;
    }

    const requirement = await prisma.requirement.findFirst({
      where: {
        id: requirementId,
        project: { organizationId: req.user!.organizationId },
      },
      include: { project: true },
    });

    if (!requirement) {
      res.status(404).json({ error: 'Requirement not found' });
      return;
    }

    const drafts = await generateTestCasesForRequirement({
      title: requirement.title,
      description: requirement.description,
      reqId: requirement.reqId,
    });

    // If autoSave requested, persist the test cases into the database
    const createdCases = [];
    if (autoSave) {
      // Find highest tcId in project to assign sequential TC-NNN
      const count = await prisma.testCase.count({ where: { projectId: requirement.projectId } });
      let nextNum = count + 1;

      for (const draft of drafts) {
        const tcId = `TC-${String(nextNum++).padStart(3, '0')}`;
        const created = await prisma.testCase.create({
          data: {
            tcId,
            title: draft.title,
            description: draft.description,
            preconditions: draft.preconditions,
            priority: 'MEDIUM',
            testType: 'MANUAL',
            automationStatus: 'NOT_AUTOMATED',
            projectId: requirement.projectId,
            requirementId: requirement.id,
            steps: {
              create: draft.steps.map((s) => ({
                stepNumber: s.stepNumber,
                action: s.action,
                expectedResult: s.expectedResult,
              })),
            },
          },
          include: { steps: true },
        });
        createdCases.push(created);
      }
    }

    res.json({
      requirementId: requirement.id,
      reqId: requirement.reqId,
      title: requirement.title,
      drafts,
      savedTestCases: createdCases,
    });
  } catch (error) {
    handleError(error, res);
  }
};

/** Same roles as the generate-test-cases routes. */
const canGenerate = (req: AuthRequest) => ['ADMIN', 'QA_LEAD', 'QA_ENGINEER'].includes(req.user!.role);

export const getRootCauseForDefect = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { defectId } = req.params;

    const defect = await prisma.defect.findFirst({
      where: {
        id: defectId,
        project: { organizationId: req.user!.organizationId },
      },
    });

    if (!defect) {
      res.status(404).json({ error: 'Defect not found' });
      return;
    }

    // If already generated and not forced, return cached
    if (defect.rootCauseHypothesis && req.query.refresh !== 'true') {
      res.json({
        defectId: defect.id,
        bugId: defect.bugId,
        hypothesis: defect.rootCauseHypothesis,
        cached: true,
      });
      return;
    }

    // Generating calls the LLM (cost) and overwrites the stored hypothesis: not for VIEWERs.
    if (!canGenerate(req)) {
      res.status(403).json({ error: 'Forbidden: Insufficient permissions to generate an analysis' });
      return;
    }

    const analysis = await analyzeRootCause({
      title: defect.title,
      errorMessage: `${defect.title}\n${defect.description}`,
      stackTrace: defect.stepsToReproduce || '',
    });

    const updated = await prisma.defect.update({
      where: { id: defect.id },
      data: { rootCauseHypothesis: analysis.hypothesis },
    });

    res.json({
      defectId: defect.id,
      bugId: defect.bugId,
      analysis,
      hypothesis: updated.rootCauseHypothesis,
    });
  } catch (error) {
    handleError(error, res);
  }
};

export const getRootCauseForExecution = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { executionId } = req.params;

    const execution = await prisma.automationExecution.findFirst({
      where: {
        id: executionId,
        automationProject: { project: { organizationId: req.user!.organizationId } },
      },
      include: { automationProject: { include: { project: true } } },
    });

    if (!execution) {
      res.status(404).json({ error: 'Execution not found' });
      return;
    }

    if (!canGenerate(req)) {
      if (execution.rootCauseHypothesis) {
        res.json({ executionId: execution.id, runId: execution.runId, hypothesis: execution.rootCauseHypothesis, cached: true });
        return;
      }
      res.status(403).json({ error: 'Forbidden: Insufficient permissions to generate an analysis' });
      return;
    }

    const analysis = await analyzeRootCause({
      title: `Automation Execution ${execution.runId} (${execution.status})`,
      errorMessage: `Execution failed with ${execution.failedCount} failed assertion(s).`,
      stackTrace: execution.logUrl || '',
    });

    const updated = await prisma.automationExecution.update({
      where: { id: execution.id },
      data: { rootCauseHypothesis: analysis.hypothesis },
    });

    res.json({
      executionId: execution.id,
      runId: execution.runId,
      analysis,
      hypothesis: updated.rootCauseHypothesis,
    });
  } catch (error) {
    handleError(error, res);
  }
};
