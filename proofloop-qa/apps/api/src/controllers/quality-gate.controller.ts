import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { upsertQualityGateConfigSchema } from '../validations/quality-gate.validation';
import { handleError } from '../utils/http-error';
import { sendSlackWebhook } from '../services/integration.service';

const DEFAULT_CONFIG = {
  requireFullCoverage: false,
  requireCriticalRiskCoverage: true,
  maxActiveCriticalDefects: 0,
  maxActiveHighDefects: 2,
};

export const getQualityGateConfig = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const config = await prisma.qualityGateConfig.findUnique({
      where: { projectId: project.id },
    });

    res.json(config || { ...DEFAULT_CONFIG, projectId: project.id });
  } catch (error) {
    handleError(error, res);
  }
};

export const upsertQualityGateConfig = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;
    const data = upsertQualityGateConfigSchema.parse(req.body);

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const config = await prisma.qualityGateConfig.upsert({
      where: { projectId: project.id },
      create: {
        projectId: project.id,
        ...data,
      },
      update: data,
    });

    res.json(config);
  } catch (error) {
    handleError(error, res);
  }
};

export const evaluateQualityGate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;

    // notify=true posts to the team's Slack channel: not for VIEWERs.
    if (req.query.notify === 'true' && !['ADMIN', 'QA_LEAD', 'QA_ENGINEER'].includes(req.user!.role)) {
      res.status(403).json({ error: 'Forbidden: Insufficient permissions to send notifications' });
      return;
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
      include: {
        qualityGateConfig: true,
        integrations: { where: { type: 'SLACK', enabled: true } },
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const config = project.qualityGateConfig || {
      ...DEFAULT_CONFIG,
      id: 'default',
      projectId: project.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Independent queries start together and are awaited where used (PERF-02 follow-up).
    const requirementsQuery = prisma.requirement.findMany({
      where: { projectId: project.id },
      include: {
        testCases: {
          select: {
            id: true,
            defects: {
              where: { status: { not: 'CLOSED' }, severity: 'CRITICAL' },
              select: { id: true },
            },
          },
        },
      },
    });
    const activeDefectsQuery = prisma.defect.findMany({
      where: {
        projectId: project.id,
        status: { not: 'CLOSED' },
      },
      select: { id: true, bugId: true, severity: true, title: true },
    });
    const risksQuery = prisma.risk.findMany({
      where: { requirement: { projectId: project.id } },
      include: {
        requirement: {
          select: {
            id: true,
            testCases: { select: { id: true } },
          },
        },
      },
    });
    const executionCountsQuery = prisma.testExecution.groupBy({
      by: ['status'],
      where: { testCycle: { projectId: project.id } },
      _count: { _all: true },
    });
    // Rejections are handled where each query is awaited; avoid unhandled-rejection noise meanwhile.
    for (const q of [requirementsQuery, activeDefectsQuery, risksQuery, executionCountsQuery]) q.catch(() => undefined);

    // 1. Requirements & Coverage
    const requirements = await requirementsQuery;

    const totalRequirements = requirements.length;
    let coveredRequirements = 0;
    for (const reqItem of requirements) {
      const hasTests = reqItem.testCases.length > 0;
      const hasCriticalBugs = reqItem.testCases.some((tc) => tc.defects.length > 0);
      if (hasTests && !hasCriticalBugs) {
        coveredRequirements++;
      }
    }

    const coverageRate = totalRequirements > 0 ? Math.round((coveredRequirements / totalRequirements) * 100) : 100;

    // 2. Active Defects
    const activeDefects = await activeDefectsQuery;

    const activeCriticalDefects = activeDefects.filter((d) => d.severity === 'CRITICAL').length;
    const activeHighDefects = activeDefects.filter((d) => d.severity === 'HIGH').length;

    // 3. Risks & Critical Risk Mitigation
    const risks = await risksQuery;

    // A critical risk is defined as level CRITICAL/HIGH or score >= 12 or impact >= 4
    const criticalRisks = risks.filter((r) => r.level === 'CRITICAL' || r.level === 'HIGH' || r.impact >= 4 || r.riskScore >= 12);
    let unmitigatedCriticalRisksCount = 0;

    for (const cr of criticalRisks) {
      // Mitigated if linked requirement has at least 1 test case
      const isMitigated = cr.requirement && cr.requirement.testCases.length > 0;
      if (!isMitigated) {
        unmitigatedCriticalRisksCount++;
      }
    }

    const criticalRisksCovered = unmitigatedCriticalRisksCount === 0;

    // 4. Test Executions Pass Rate
    const executionCounts = await executionCountsQuery;
    const countOf = (status: string) => executionCounts.find((c) => c.status === status)?._count._all ?? 0;
    const totalExecuted = executionCounts.reduce((acc, c) => acc + c._count._all, 0) - countOf('PENDING');
    const totalPassed = countOf('PASSED');
    const overallPassRate = totalExecuted > 0 ? Math.round((totalPassed / totalExecuted) * 100) : 100;

    // Evaluate Criteria & Collect Blocking Reasons
    const blockingReasons: string[] = [];

    // Criterion 1: Requirement Coverage
    if (config.requireFullCoverage && coveredRequirements < totalRequirements) {
      blockingReasons.push(
        `Full requirement coverage required: ${coveredRequirements}/${totalRequirements} requirements covered (${coverageRate}%).`,
      );
    }

    // Criterion 2: Critical Risk Coverage
    if (config.requireCriticalRiskCoverage && !criticalRisksCovered) {
      blockingReasons.push(
        `${unmitigatedCriticalRisksCount} critical risk(s) lack test coverage or mitigating requirements.`,
      );
    }

    // Criterion 3: Critical Defects Threshold
    if (activeCriticalDefects > config.maxActiveCriticalDefects) {
      blockingReasons.push(
        `${activeCriticalDefects} active CRITICAL defect(s) exceed allowed threshold of ${config.maxActiveCriticalDefects}.`,
      );
    }

    // Criterion 4: High Defects Threshold
    if (activeHighDefects > config.maxActiveHighDefects) {
      blockingReasons.push(
        `${activeHighDefects} active HIGH defect(s) exceed allowed threshold of ${config.maxActiveHighDefects}.`,
      );
    }

    const isReleaseReady = blockingReasons.length === 0;
    const status: 'GO' | 'NO_GO' = isReleaseReady ? 'GO' : 'NO_GO';

    // If Slack notification requested or when status is GO, notify if integration exists
    if (req.query.notify === 'true' && project.integrations.length > 0) {
      const slackIntegration = project.integrations[0];
      if (slackIntegration.webhookUrl) {
        await sendSlackWebhook(slackIntegration.webhookUrl, {
          text: `[ProofLoop] Quality Gate Evaluated for ${project.name}: ${status}`,
          blocks: [
            {
              type: 'header',
              text: { type: 'plain_text', text: `Quality Gate: ${status} (${project.name})` },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: isReleaseReady
                  ? `✅ All release criteria met! Release status is *GO*.`
                  : `🚫 Release *BLOCKED*. Reasons:\n• ${blockingReasons.join('\n• ')}`,
              },
            },
          ],
        });
      }
    }

    res.json({
      isReleaseReady,
      status,
      blockingReasons,
      criteria: {
        fullCoverage: {
          required: config.requireFullCoverage,
          passed: !config.requireFullCoverage || coveredRequirements >= totalRequirements,
          current: `${coveredRequirements}/${totalRequirements} (${coverageRate}%)`,
        },
        criticalRisks: {
          required: config.requireCriticalRiskCoverage,
          passed: !config.requireCriticalRiskCoverage || criticalRisksCovered,
          current: `${criticalRisks.length - unmitigatedCriticalRisksCount}/${criticalRisks.length} mitigated`,
        },
        criticalDefects: {
          maxAllowed: config.maxActiveCriticalDefects,
          passed: activeCriticalDefects <= config.maxActiveCriticalDefects,
          current: activeCriticalDefects,
        },
        highDefects: {
          maxAllowed: config.maxActiveHighDefects,
          passed: activeHighDefects <= config.maxActiveHighDefects,
          current: activeHighDefects,
        },
      },
      metrics: {
        requirementCoverageRate: coverageRate,
        totalRequirements,
        coveredRequirements,
        activeCriticalDefects,
        activeHighDefects,
        criticalRisksCovered,
        overallPassRate,
      },
      config,
    });
  } catch (error) {
    handleError(error, res);
  }
};
