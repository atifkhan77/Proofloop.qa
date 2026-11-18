import { Response } from 'express';
import { Prisma } from '@proofloop/prisma';
import { prisma } from '../db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { createApiCollectionSchema, createApiRequestSchema } from '../validations/api-intelligence.validation';
import { handleError, isUniqueViolation } from '../utils/http-error';
import { redactApiRequest } from '../utils/redact';

/** Attempts to allocate a free sequenceNumber when concurrent creates collide on the unique index. */
const SEQUENCE_ATTEMPTS = 5;

export const createApiCollection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;
    const data = createApiCollectionSchema.parse(req.body);

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const collection = await prisma.apiCollection.create({
      data: {
        name: data.name,
        description: data.description || null,
        projectId: project.id,
      },
    });

    res.status(201).json(collection);
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: 'An API Collection with this name already exists in this project' });
      return;
    }
    handleError(error, res);
  }
};

export const getApiCollections = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const collections = await prisma.apiCollection.findMany({
      where: { projectId: project.id },
      include: { _count: { select: { requests: true } } },
      orderBy: { name: 'asc' },
    });

    res.json(collections);
  } catch (error) {
    handleError(error, res);
  }
};

/** GET /api-collections/:collectionId — collection with parent project name (for the builder page). */
export const getApiCollection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const collection = await prisma.apiCollection.findFirst({
      where: { id: req.params.collectionId, project: { organizationId: req.user!.organizationId } },
      include: {
        project: { select: { id: true, name: true } },
        _count: { select: { requests: true } },
      },
    });

    if (!collection) {
      res.status(404).json({ error: 'API Collection not found' });
      return;
    }

    res.json(collection);
  } catch (error) {
    handleError(error, res);
  }
};

export const createApiRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { collectionId } = req.params;
    const data = createApiRequestSchema.parse(req.body);

    // Collection must exist and belong to the caller's organization.
    const collection = await prisma.apiCollection.findFirst({
      where: { id: collectionId, project: { organizationId: req.user!.organizationId } },
    });

    if (!collection) {
      res.status(404).json({ error: 'API Collection not found' });
      return;
    }

    // `data.body || {}` would turn "no body" and valid bodies 0, false and "" into {}. Keep the
    // value as sent; omitted or JSON null -> SQL NULL (explicit Prisma.DbNull).
    const body = data.body === undefined || data.body === null ? Prisma.DbNull : (data.body as Prisma.InputJsonValue);

    // Append to the end of the collection. max+1 (not count+1) stays correct if requests are
    // ever deleted; the @@unique([collectionId, sequenceNumber]) index rejects a concurrent
    // duplicate, so re-read and retry.
    for (let attempt = 0; attempt < SEQUENCE_ATTEMPTS; attempt++) {
      const { _max } = await prisma.apiRequest.aggregate({
        where: { collectionId: collection.id },
        _max: { sequenceNumber: true },
      });

      try {
        const request = await prisma.apiRequest.create({
          data: {
            name: data.name,
            method: data.method,
            endpoint: data.endpoint,
            headers: data.headers ?? {},
            queryParams: data.queryParams ?? {},
            body,
            // Default is a valid auth config, so stored data always matches authSchema.
            auth: data.auth ?? { type: 'none' },
            assertions: (data.assertions ?? []) as Prisma.InputJsonValue,
            sequenceNumber: (_max.sequenceNumber ?? 0) + 1,
            collectionId: collection.id,
          },
        });

        res.status(201).json(request);
        return;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }

    res.status(503).json({ error: 'Could not allocate a sequence number, please retry' });
  } catch (error) {
    handleError(error, res);
  }
};

export const getApiRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { collectionId } = req.params;

    const collection = await prisma.apiCollection.findFirst({
      where: { id: collectionId, project: { organizationId: req.user!.organizationId } },
    });

    if (!collection) {
      res.status(404).json({ error: 'API Collection not found' });
      return;
    }

    const requests = await prisma.apiRequest.findMany({
      where: { collectionId: collection.id },
      orderBy: { sequenceNumber: 'asc' },
    });

    // Defense in depth (API-05): VIEWERs never receive credential values.
    res.json(req.user!.role === 'VIEWER' ? requests.map(redactApiRequest) : requests);
  } catch (error) {
    handleError(error, res);
  }
};
