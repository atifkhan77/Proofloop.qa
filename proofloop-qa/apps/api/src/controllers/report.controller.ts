import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { handleError } from '../utils/http-error';

export const getProjectReports = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const windowDays = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const timelineSince = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    // All queries depend only on the project: run them in parallel (performance review 2026-11-12;
    // was 9 sequential round trips).
    const [requirements, modules, defects, [manualExecutions, autoExecutions, apiExecutions], totalTestCases, automatedTestCases, activeTestCycles] = await Promise.all([
    // 1. Requirement Coverage (% of requirements with at least 1 linked test case and 0 active critical bugs)
    prisma.requirement.findMany({
      where: { projectId: project.id },
      include: {
        module: { select: { id: true, name: true } },
        testCases: {
          select: {
            id: true,
            defects: {
              where: {
                status: { not: 'CLOSED' },
                severity: 'CRITICAL',
              },
              select: { id: true },
            },
          },
        },
      },
    }),
    // 2. Defect Density (active bugs per Module)
    prisma.module.findMany({
      where: { projectId: project.id },
      include: {
        requirements: {
          select: {
            id: true,
            testCases: { select: { id: true } },
          },
        },
      },
    }),
    // Only the fields used below (was: full defect rows + full test case rows).
    prisma.defect.findMany({
      where: { projectId: project.id },
      select: {
        status: true,
        severity: true,
        testCase: { select: { requirement: { select: { moduleId: true } } } },
      },
    }),
    // 3. Test Execution Pass Rates (grouped by date/week, bounded by timelineSince and take limits)
    Promise.all([
      prisma.testExecution.findMany({
        where: {
          testCycle: { projectId: project.id },
          status: { in: ['PASSED', 'FAILED', 'SKIPPED'] },
          createdAt: { gte: timelineSince },
        },
        select: {
          status: true,
          executedAt: true,
          createdAt: true,
        },
        take: 5000,
      }),
      prisma.automationExecution.findMany({
        where: {
          automationProject: { projectId: project.id },
          status: { in: ['PASSED', 'FAILED'] },
          createdAt: { gte: timelineSince },
        },
        select: {
          status: true,
          passedCount: true,
          failedCount: true,
          skippedCount: true,
          createdAt: true,
        },
        take: 5000,
      }),
      prisma.apiExecution.findMany({
        where: {
          request: { collection: { projectId: project.id } },
          createdAt: { gte: timelineSince },
        },
        select: {
          status: true,
          createdAt: true,
        },
        take: 5000,
      }),
    ]),
    prisma.testCase.count({ where: { projectId: project.id } }),
    prisma.testCase.count({ where: { projectId: project.id, automationStatus: 'AUTOMATED' } }),
    prisma.testCycle.count({ where: { projectId: project.id, status: { in: ['PLANNED', 'IN_PROGRESS'] } } }),
    ]);

    let coveredRequirements = 0;
    let uncoveredNoTestCases = 0;
    let blockedByCriticalBugs = 0;

    const requirementDetails = requirements.map((reqItem) => {
      const testCaseCount = reqItem.testCases.length;
      const criticalBugsCount = reqItem.testCases.reduce((acc, tc) => acc + tc.defects.length, 0);
      const isCovered = testCaseCount >= 1 && criticalBugsCount === 0;

      if (isCovered) {
        coveredRequirements++;
      } else if (testCaseCount === 0) {
        uncoveredNoTestCases++;
      } else {
        blockedByCriticalBugs++;
      }

      return {
        id: reqItem.id,
        reqId: reqItem.reqId,
        title: reqItem.title,
        priority: reqItem.priority,
        moduleName: reqItem.module?.name ?? 'General',
        testCaseCount,
        criticalBugsCount,
        isCovered,
      };
    });

    const totalRequirements = requirements.length;
    const requirementCoverageRate = totalRequirements > 0
      ? Math.round((coveredRequirements / totalRequirements) * 100)
      : 0;

    const activeDefects = defects.filter((d) => d.status !== 'CLOSED');

    const moduleDefectMap: Record<string, {
      id: string;
      name: string;
      activeBugs: number;
      criticalBugs: number;
      highBugs: number;
      mediumBugs: number;
      lowBugs: number;
      requirementCount: number;
      testCaseCount: number;
    }> = {};

    for (const mod of modules) {
      const tcCount = mod.requirements.reduce((acc, r) => acc + r.testCases.length, 0);
      moduleDefectMap[mod.id] = {
        id: mod.id,
        name: mod.name,
        activeBugs: 0,
        criticalBugs: 0,
        highBugs: 0,
        mediumBugs: 0,
        lowBugs: 0,
        requirementCount: mod.requirements.length,
        testCaseCount: tcCount,
      };
    }

    let unassignedActiveBugs = 0;
    for (const defect of activeDefects) {
      const modId = defect.testCase?.requirement?.moduleId;
      if (modId && moduleDefectMap[modId]) {
        moduleDefectMap[modId].activeBugs++;
        if (defect.severity === 'CRITICAL') moduleDefectMap[modId].criticalBugs++;
        else if (defect.severity === 'HIGH') moduleDefectMap[modId].highBugs++;
        else if (defect.severity === 'MEDIUM') moduleDefectMap[modId].mediumBugs++;
        else if (defect.severity === 'LOW') moduleDefectMap[modId].lowBugs++;
      } else {
        unassignedActiveBugs++;
      }
    }

    const defectDensityByModule = Object.values(moduleDefectMap).map((m) => ({
      ...m,
      density: m.requirementCount > 0 ? Number((m.activeBugs / m.requirementCount).toFixed(2)) : m.activeBugs,
    }));

    if (unassignedActiveBugs > 0) {
      defectDensityByModule.push({
        id: 'unassigned',
        name: 'Unassigned / Ad-hoc',
        activeBugs: unassignedActiveBugs,
        criticalBugs: 0,
        highBugs: 0,
        mediumBugs: 0,
        lowBugs: 0,
        requirementCount: 0,
        testCaseCount: 0,
        density: unassignedActiveBugs,
      });
    }

    // Grouping by Date (last 14 days + recent)
    const dateMap: Record<string, { date: string; passed: number; failed: number; skipped: number; total: number }> = {};

    const getIsoDate = (d: Date) => d.toISOString().slice(0, 10);

    const recordMetric = (dateStr: string, passed: number, failed: number, skipped: number) => {
      if (!dateMap[dateStr]) {
        dateMap[dateStr] = { date: dateStr, passed: 0, failed: 0, skipped: 0, total: 0 };
      }
      dateMap[dateStr].passed += passed;
      dateMap[dateStr].failed += failed;
      dateMap[dateStr].skipped += skipped;
      dateMap[dateStr].total += passed + failed + skipped;
    };

    manualExecutions.forEach((me) => {
      const d = me.executedAt || me.createdAt;
      const dateStr = getIsoDate(d);
      recordMetric(
        dateStr,
        me.status === 'PASSED' ? 1 : 0,
        me.status === 'FAILED' ? 1 : 0,
        me.status === 'SKIPPED' ? 1 : 0,
      );
    });

    autoExecutions.forEach((ae) => {
      const dateStr = getIsoDate(ae.createdAt);
      recordMetric(dateStr, ae.passedCount, ae.failedCount, ae.skippedCount);
    });

    apiExecutions.forEach((ae) => {
      const dateStr = getIsoDate(ae.createdAt);
      recordMetric(
        dateStr,
        ae.status === 'PASSED' ? 1 : 0,
        ae.status === 'FAILED' ? 1 : 0,
        0,
      );
    });

    const executionTimeline = Object.values(dateMap)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((item) => ({
        ...item,
        passRate: item.total > 0 ? Math.round((item.passed / item.total) * 100) : 0,
      }));

    // Overall aggregate stats
    const totalExecuted = executionTimeline.reduce((acc, item) => acc + item.total, 0);
    const totalPassed = executionTimeline.reduce((acc, item) => acc + item.passed, 0);
    const totalFailed = executionTimeline.reduce((acc, item) => acc + item.failed, 0);
    const overallPassRate = totalExecuted > 0 ? Math.round((totalPassed / totalExecuted) * 100) : 0;

    const automationRate = totalTestCases > 0 ? Math.round((automatedTestCases / totalTestCases) * 100) : 0;

    const criticalDefects = activeDefects.filter((d) => d.severity === 'CRITICAL').length;
    res.json({
      summary: {
        totalRequirements,
        coveredRequirements,
        uncoveredNoTestCases,
        blockedByCriticalBugs,
        requirementCoverageRate,
        totalTestCases,
        automatedTestCases,
        automationRate,
        totalDefects: defects.length,
        activeDefects: activeDefects.length,
        criticalDefects,
        totalExecuted,
        totalPassed,
        totalFailed,
        overallPassRate,
        activeTestCycles,
      },
      requirementCoverage: {
        totalRequirements,
        coveredRequirements,
        uncoveredNoTestCases,
        blockedByCriticalBugs,
        coverageRate: requirementCoverageRate,
        requirements: requirementDetails,
      },
      defectDensity: {
        totalActiveBugs: activeDefects.length,
        modules: defectDensityByModule,
      },
      passRateTimeline: executionTimeline,
    });
  } catch (error) {
    handleError(error, res);
  }
};
