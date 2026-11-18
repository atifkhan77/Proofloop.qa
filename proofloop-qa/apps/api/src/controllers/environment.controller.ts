import { Response } from 'express';
import { ZodError } from 'zod';
import { prisma } from '../db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { createEnvironmentSchema, createVariableSchema } from '../validations/environment.validation';
import { handleError, isUniqueViolation } from '../utils/http-error';

export const createEnvironment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;
    const data = createEnvironmentSchema.parse(req.body);

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const environment = await prisma.projectEnvironment.create({
      data: {
        name: data.name,
        baseUrl: data.baseUrl || null,
        projectId: project.id,
      },
      omit: { dbConnectionString: true }, // database credentials; see database-sentinel GET
    });

    res.status(201).json(environment);
  } catch (error: any) {
    if (error instanceof ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.flatten().fieldErrors });
    } else if (isUniqueViolation(error)) {
      res.status(409).json({ error: 'An environment with this name already exists in this project' });
    } else {
      handleError(error, res);
    }
  }
};

export const getEnvironments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const environments = await prisma.projectEnvironment.findMany({
      where: { projectId: project.id },
      orderBy: { name: 'asc' },
      // Contains database credentials: never returned (every role can list environments).
      omit: { dbConnectionString: true },
    });

    res.json(environments);
  } catch (error) {
    handleError(error, res);
  }
};

// ---------- Environment variables (API-23) ----------

const MASK = '********';

/** Secret values never leave the server (not even for editors); the engine reads them directly. */
const maskSecret = <T extends { isSecret: boolean; value: string }>(v: T): T => (v.isSecret ? { ...v, value: MASK } : v);

/** Environment in the caller's organization, or null. */
const findOwnEnvironment = (environmentId: string, organizationId: string) =>
  prisma.projectEnvironment.findFirst({ where: { id: environmentId, project: { organizationId } } });

export const addEnvironmentVariable = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createVariableSchema.parse(req.body);
    const env = await findOwnEnvironment(req.params.environmentId, req.user!.organizationId);

    if (!env) {
      res.status(404).json({ error: 'Environment not found' });
      return;
    }

    const variable = await prisma.environmentVariable.create({
      data: { key: data.key, value: data.value, isSecret: data.isSecret, environmentId: env.id },
    });

    res.status(201).json(maskSecret(variable));
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: 'A variable with this key already exists in this environment' });
      return;
    }
    handleError(error, res);
  }
};

export const getEnvironmentVariables = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const env = await findOwnEnvironment(req.params.environmentId, req.user!.organizationId);

    if (!env) {
      res.status(404).json({ error: 'Environment not found' });
      return;
    }

    const variables = await prisma.environmentVariable.findMany({
      where: { environmentId: env.id },
      orderBy: { key: 'asc' },
    });

    res.json(variables.map(maskSecret));
  } catch (error) {
    handleError(error, res);
  }
};
