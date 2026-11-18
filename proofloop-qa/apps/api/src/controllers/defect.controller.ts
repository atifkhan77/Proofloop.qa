import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { Prisma } from '@proofloop/prisma';
import { createDefectSchema, listDefectsQuerySchema, updateDefectSchema } from '../validations/defect.validation';
import { handleError, isUniqueViolation } from '../utils/http-error';
import {
  sendSlackCriticalDefectAlert,
  createJiraIssueForDefect,
} from '../services/integration.service';

const personSelect = { select: { id: true, firstName: true, lastName: true } } as const;

/** Assignee must be an ACTIVE user of the caller's organization (deactivated users cannot be assigned). */
const findOrgUser = (userId: string, organizationId: string) =>
  prisma.user.findFirst({ where: { id: userId, organizationId, deletedAt: null }, select: { id: true } });

const invalid = (res: Response, field: string, message: string) =>
  res.status(400).json({ error: 'Validation failed', details: { [field]: [message] } });

export const createDefect = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;
    const data = createDefectSchema.parse(req.body);

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Test case must belong to the same PROJECT (cf. DATA-07); assignee to the same organization.
    if (data.testCaseId) {
      const tc = await prisma.testCase.findFirst({ where: { id: data.testCaseId, projectId: project.id } });
      if (!tc) {
        invalid(res, 'testCaseId', 'Invalid Test Case ID');
        return;
      }
    }

    if (data.assigneeId && !(await findOrgUser(data.assigneeId, req.user!.organizationId))) {
      invalid(res, 'assigneeId', 'Invalid Assignee ID');
      return;
    }

    if (data.testExecutionId) {
      const execution = await prisma.testExecution.findFirst({
        where: { id: data.testExecutionId, testCycle: { projectId: project.id } },
      });
      if (!execution) {
        invalid(res, 'testExecutionId', 'Invalid Test Execution ID');
        return;
      }
    }

    const defect = await prisma.defect.create({
      data: {
        bugId: data.bugId,
        title: data.title,
        description: data.description,
        stepsToReproduce: data.stepsToReproduce || null,
        severity: data.severity,
        status: data.status,
        projectId: project.id,
        testCaseId: data.testCaseId || null,
        testExecutionId: data.testExecutionId || null,
        jiraTicketId: data.jiraTicketId || null,
        reporterId: req.user!.id, // always the caller, never taken from the body
        assigneeId: data.assigneeId || null,
      },
      include: { reporter: personSelect, assignee: personSelect },
    });

    if (defect.severity === 'CRITICAL') {
      sendSlackCriticalDefectAlert(project.id, {
        bugId: defect.bugId,
        title: defect.title,
        reporterName: `${defect.reporter.firstName} ${defect.reporter.lastName}`,
        projectName: project.name,
      }).catch((err) => console.error('[defect.controller] Slack critical defect alert error:', err));
    }

    createJiraIssueForDefect(project.id, {
      id: defect.id,
      bugId: defect.bugId,
      title: defect.title,
      description: defect.description,
      stepsToReproduce: defect.stepsToReproduce,
      severity: defect.severity,
    }).catch((err) => console.error('[defect.controller] Jira sync error:', err));

    res.status(201).json(defect);
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: 'A defect with this Bug ID already exists in this project' });
      return;
    }
    handleError(error, res);
  }
};

export const getProjectDefects = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Optional paging + search (PERF-03). Without `limit` the full list is returned (backward
    // compatible); with it, the page is returned and X-Total-Count holds the total match count.
    const page = listDefectsQuerySchema.parse(req.query);
    const where: Prisma.DefectWhereInput = { projectId: project.id };
    if (page.q) {
      where.OR = [
        { bugId: { contains: page.q, mode: 'insensitive' } },
        { title: { contains: page.q, mode: 'insensitive' } },
      ];
    }
    const query = {
      where,
      include: { assignee: personSelect, reporter: personSelect },
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    };

    if (page.limit === undefined) {
      res.json(await prisma.defect.findMany(query));
      return;
    }

    const [total, defects] = await Promise.all([
      prisma.defect.count({ where }),
      prisma.defect.findMany({ ...query, take: page.limit, skip: page.offset }),
    ]);
    res.setHeader('X-Total-Count', String(total));
    res.json(defects);
  } catch (error) {
    handleError(error, res);
  }
};

export const getDefectById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const defect = await prisma.defect.findFirst({
      where: { id: req.params.defectId, project: { organizationId: req.user!.organizationId } },
      include: {
        testCase: { select: { id: true, tcId: true, title: true } },
        assignee: personSelect,
        reporter: personSelect,
      },
    });

    if (!defect) {
      res.status(404).json({ error: 'Defect not found' });
      return;
    }

    res.json(defect);
  } catch (error) {
    handleError(error, res);
  }
};

export const updateDefect = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updateDefectSchema.parse(req.body);

    const defect = await prisma.defect.findFirst({
      where: { id: req.params.defectId, project: { organizationId: req.user!.organizationId } },
    });

    if (!defect) {
      res.status(404).json({ error: 'Defect not found' });
      return;
    }

    if (data.assigneeId && !(await findOrgUser(data.assigneeId, req.user!.organizationId))) {
      invalid(res, 'assigneeId', 'Invalid Assignee ID');
      return;
    }

    const updated = await prisma.defect.update({
      where: { id: defect.id },
      data: {
        title: data.title,
        description: data.description,
        // undefined = unchanged; '' = cleared (null, not an empty string)
        stepsToReproduce: data.stepsToReproduce === undefined ? undefined : data.stepsToReproduce || null,
        severity: data.severity,
        status: data.status,
        assigneeId: data.assigneeId === undefined ? undefined : data.assigneeId || null,
      },
      include: { assignee: personSelect, reporter: personSelect },
    });

    res.json(updated);
  } catch (error) {
    handleError(error, res);
  }
};
