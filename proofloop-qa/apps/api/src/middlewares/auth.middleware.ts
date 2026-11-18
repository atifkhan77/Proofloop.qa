import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@proofloop/prisma';
import { config } from '../config';
import { prisma } from '../db';

export interface AuthUser {
  id: string;
  role: Role;
  organizationId: string;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  // Already authenticated in this request (AUTH-16: project.routes' router-level guard plus the
  // per-route guard of routers sharing the /api/projects prefix): skip the second DB lookup.
  if (req.user) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: No token provided' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();

  // 1. Token check. Only a bad/expired token is a 401.
  let userId: string;
  let issuedAt: number | undefined;
  try {
    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload & { id?: unknown };
    if (typeof decoded.id !== 'string') throw new Error('Token payload missing id');
    userId = decoded.id;
    issuedAt = decoded.iat;
  } catch {
    res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    return;
  }

  // 2. Live user lookup: catches deleted users, role changes and org moves.
  //    A DB failure is a server problem, NOT an auth failure: returning 401 here
  //    would make the web client drop the token and log every user out.
  try {
    const liveUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, organizationId: true, deletedAt: true, passwordChangedAt: true },
    });

    if (!liveUser) {
      res.status(401).json({ error: 'Unauthorized: User no longer exists' });
      return;
    }

    // Soft-deleted (deactivated) users lose access immediately, even with a valid token.
    if (liveUser.deletedAt !== null) {
      res.status(401).json({ error: 'Unauthorized: Account deactivated' });
      return;
    }

    // SEC-14: tokens issued before the last password change are revoked. JWT iat is in whole
    // seconds, so a token issued in the same second as the change is still accepted.
    if (liveUser.passwordChangedAt && (issuedAt === undefined || issuedAt < Math.floor(liveUser.passwordChangedAt.getTime() / 1000))) {
      res.status(401).json({ error: 'Unauthorized: Session expired after a password change' });
      return;
    }

    // Fresh data overrides the (possibly stale) JWT payload.
    req.user = { id: userId, role: liveUser.role, organizationId: liveUser.organizationId };
  } catch (error) {
    console.error(error);
    res.status(503).json({ error: 'Service temporarily unavailable' });
    return;
  }

  next();
};

// Synchronous: relies on the fresh req.user.role set by authenticate.
export const requireRole = (allowedRoles: Role[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
      return;
    }

    next();
  };
};
