import { Response } from 'express';
import { Prisma } from '@proofloop/prisma';
import { prisma } from '../db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { updateUserRoleSchema } from '../validations/organization.validation';
import { handleError } from '../utils/http-error';

const userSelect = { id: true, email: true, firstName: true, lastName: true, role: true, createdAt: true } as const;

/** Thrown inside a transaction to roll it back and answer with this status/message. */
class Reject extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Postgres serialization failure (Prisma P2034): a concurrent transaction won. */
const isSerializationFailure = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';

/**
 * Runs `fn` in a SERIALIZABLE transaction. The last-admin rule is "count admins, then change
 * one": two admins demoting/deactivating each other at the same time would both see 2 admins
 * and leave the organization with none. Serializable isolation makes one of them fail (P2034),
 * which is answered with 409 so the client can retry.
 */
async function serializable<T>(res: Response, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T | undefined> {
  try {
    return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Reject) {
      res.status(error.status).json({ error: error.message });
      return undefined;
    }
    if (isSerializationFailure(error)) {
      res.status(409).json({ error: 'The organization was changed concurrently, please retry' });
      return undefined;
    }
    throw error;
  }
}

const activeAdminCount = (tx: Prisma.TransactionClient, organizationId: string) =>
  tx.user.count({ where: { organizationId, role: 'ADMIN', deletedAt: null } });

export const getOrganizationUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId, deletedAt: null }, // active users only
      select: userSelect,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    res.json(users);
  } catch (error) {
    handleError(error, res);
  }
};

export const updateUserRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const data = updateUserRoleSchema.parse(req.body);
    const organizationId = req.user!.organizationId;

    const updated = await serializable(res, async (tx) => {
      const target = await tx.user.findFirst({ where: { id: userId, organizationId, deletedAt: null } });
      if (!target) throw new Reject(404, 'User not found or deactivated');

      // Safeguard: the organization must keep at least one active administrator.
      if (target.role === 'ADMIN' && data.role !== 'ADMIN' && (await activeAdminCount(tx, organizationId)) <= 1) {
        throw new Reject(400, 'Cannot demote the last administrator of the organization');
      }

      return tx.user.update({ where: { id: target.id }, data: { role: data.role }, select: userSelect });
    });

    if (updated) res.json(updated);
  } catch (error) {
    handleError(error, res);
  }
};

export const softDeleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const organizationId = req.user!.organizationId;

    // Safeguard: no self-deactivation (would lock the caller out mid-session).
    if (userId === req.user!.id) {
      res.status(400).json({ error: 'You cannot deactivate your own account' });
      return;
    }

    const done = await serializable(res, async (tx) => {
      const target = await tx.user.findFirst({ where: { id: userId, organizationId, deletedAt: null } });
      if (!target) throw new Reject(404, 'User not found or already deactivated');

      if (target.role === 'ADMIN' && (await activeAdminCount(tx, organizationId)) <= 1) {
        throw new Reject(400, 'Cannot deactivate the last administrator of the organization');
      }

      await tx.user.update({ where: { id: target.id }, data: { deletedAt: new Date() } });
      return true;
    });

    if (done) res.status(204).send();
  } catch (error) {
    handleError(error, res);
  }
};
