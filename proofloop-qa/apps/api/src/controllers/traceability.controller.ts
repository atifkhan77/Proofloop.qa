import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { handleError } from '../utils/http-error';

/**
 * Requirement Traceability Matrix: every requirement in the project with its
 * module, risks and linked test cases, plus precomputed coverage flags.
 * Standalone test cases (no requirement) are not part of the matrix.
 *
 * activeDefects: non-CLOSED defects reached through the requirement's test cases
 * (requirement -> test case -> defect). Defects without a test case, or on a standalone
 * test case, cannot be attributed to a requirement and are not counted here.
 */
export const getTraceabilityMatrix = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const requirements = await prisma.requirement.findMany({
      where: { projectId: project.id },
      include: {
        module: { select: { id: true, name: true } },
        risks: {
          select: { id: true, title: true, level: true, riskScore: true },
          orderBy: { riskScore: 'desc' },
        },
        testCases: {
          select: {
            id: true,
            tcId: true,
            title: true,
            testType: true,
            automationStatus: true,
            // Only active defects are needed; filter in the query, not after fetching.
            defects: {
              where: { status: { not: 'CLOSED' } },
              select: { id: true, bugId: true, title: true, status: true, severity: true },
              orderBy: { bugId: 'asc' },
            },
          },
          orderBy: { tcId: 'asc' },
        },
      },
      // Group by module name, then reqId. Note: string ordering, so 'REQ-10' sorts before 'REQ-2'.
      orderBy: [{ module: { name: 'asc' } }, { reqId: 'asc' }],
    });

    const matrix = requirements.map((r) => {
      // A defect has at most one test case, and a test case one requirement: no duplicates.
      const activeDefects = r.testCases.flatMap((tc) => tc.defects);
      // Keep the testCases payload as before (without the nested defects).
      const testCases = r.testCases.map(({ defects: _defects, ...tc }) => tc);
      return {
        ...r,
        testCases,
        activeDefects,
        hasTestCoverage: testCases.length > 0,
        hasRisksIdentified: r.risks.length > 0,
        hasActiveDefects: activeDefects.length > 0,
      };
    });

    res.json(matrix);
  } catch (error) {
    handleError(error, res);
  }
};
