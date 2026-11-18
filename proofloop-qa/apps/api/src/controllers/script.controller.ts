import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { generateScriptSchema, updateScriptSchema } from '../validations/automation.validation';
import { handleError, isUniqueViolation } from '../utils/http-error';
import { generatePlaywrightScript, scriptFileName } from '../services/llm.service';

const scriptSelect = {
  id: true,
  fileName: true,
  code: true,
  status: true,
  source: true,
  model: true,
  testCaseId: true,
  automationProjectId: true,
  createdAt: true,
  updatedAt: true,
  testCase: { select: { tcId: true, title: true } },
} as const;

/** Automation project scoped to the caller's organization, or null. */
const findAutomationProject = (id: string, organizationId: string) =>
  prisma.automationProject.findFirst({ where: { id, project: { organizationId } } });

/** Script scoped to the caller's organization, or null. */
const findScript = (id: string, organizationId: string) =>
  prisma.generatedScript.findFirst({
    where: { id, automationProject: { project: { organizationId } } },
    select: scriptSelect,
  });

export const getScripts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const automationProject = await findAutomationProject(req.params.automationProjectId, req.user!.organizationId);
    if (!automationProject) {
      res.status(404).json({ error: 'Automation project not found' });
      return;
    }
    const scripts = await prisma.generatedScript.findMany({
      where: { automationProjectId: automationProject.id },
      select: scriptSelect,
      orderBy: { fileName: 'asc' },
    });
    res.json(scripts);
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Generates (or regenerates) the Playwright spec for one test case. Regenerating replaces the
 * code and resets the script to DRAFT, so new LLM output never runs without review.
 */
export const generateScript = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { testCaseId } = generateScriptSchema.parse(req.body);
    const automationProject = await findAutomationProject(req.params.automationProjectId, req.user!.organizationId);
    if (!automationProject) {
      res.status(404).json({ error: 'Automation project not found' });
      return;
    }

    // Test case must belong to the SAME project as the automation project.
    const testCase = await prisma.testCase.findFirst({
      where: { id: testCaseId, projectId: automationProject.projectId },
      include: { steps: { orderBy: { stepNumber: 'asc' } } },
    });
    if (!testCase) {
      res.status(400).json({ error: 'Validation failed', details: { testCaseId: ['Invalid test case for this project'] } });
      return;
    }

    const generated = await generatePlaywrightScript({
      tcId: testCase.tcId,
      title: testCase.title,
      description: testCase.description,
      preconditions: testCase.preconditions,
      testData: testCase.testData,
      testType: testCase.testType,
      steps: testCase.steps,
    });

    const data = { code: generated.code, source: generated.source, model: generated.model, status: 'DRAFT' };
    const existing = await prisma.generatedScript.findUnique({
      where: { automationProjectId_testCaseId: { automationProjectId: automationProject.id, testCaseId: testCase.id } },
      select: { id: true },
    });

    let script;
    if (existing) {
      // Keep the (possibly user-renamed) file name on regeneration.
      script = await prisma.generatedScript.update({ where: { id: existing.id }, data, select: scriptSelect });
    } else {
      const fileName = scriptFileName(testCase);
      const create = (name: string) =>
        prisma.generatedScript.create({
          data: { ...data, fileName: name, testCaseId: testCase.id, automationProjectId: automationProject.id },
          select: scriptSelect,
        });
      try {
        script = await create(fileName);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Same slug as another test case's script: disambiguate with a test case id suffix.
        script = await create(fileName.replace(/\.spec\.ts$/, `-${testCase.id.slice(0, 8)}.spec.ts`));
      }
    }

    res.status(existing ? 200 : 201).json({ ...script, warning: generated.warning ?? null });
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: 'A script for this test case is already being generated, please retry' });
      return;
    }
    handleError(error, res);
  }
};

export const updateScript = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updateScriptSchema.parse(req.body);
    const script = await findScript(req.params.scriptId, req.user!.organizationId);
    if (!script) {
      res.status(404).json({ error: 'Script not found' });
      return;
    }

    // Changed code needs a fresh review unless the same request approves it.
    const codeChanged = data.code !== undefined && data.code !== script.code;
    const status = data.status ?? (codeChanged ? 'DRAFT' : undefined);

    const updated = await prisma.generatedScript.update({
      where: { id: script.id },
      data: { code: data.code, fileName: data.fileName, status },
      select: scriptSelect,
    });
    res.json(updated);
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: 'Another script in this automation project already uses that file name' });
      return;
    }
    handleError(error, res);
  }
};

export const deleteScript = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const script = await findScript(req.params.scriptId, req.user!.organizationId);
    if (!script) {
      res.status(404).json({ error: 'Script not found' });
      return;
    }
    await prisma.generatedScript.delete({ where: { id: script.id } });
    res.status(204).end();
  } catch (error) {
    handleError(error, res);
  }
};

export const downloadScript = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const script = await findScript(req.params.scriptId, req.user!.organizationId);
    if (!script) {
      res.status(404).json({ error: 'Script not found' });
      return;
    }
    // fileName is validated (no quotes or separators), safe in the header.
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${script.fileName}"`);
    res.send(script.code);
  } catch (error) {
    handleError(error, res);
  }
};
