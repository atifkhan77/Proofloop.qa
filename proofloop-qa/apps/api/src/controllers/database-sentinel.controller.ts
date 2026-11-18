import { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { PrismaClient } from '@proofloop/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { handleError } from '../utils/http-error';
import { assertSafeHost, isSsrfError } from '../utils/ssrf-guard';

const FORBIDDEN_SQL = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|FLUSH)\b/i;
const MAX_ROWS = 100;
const STATEMENT_TIMEOUT_MS = 5000;

/**
 * First line of defence only (fast, readable error). The real guarantee is the READ ONLY
 * transaction in runReadOnly(): a regex cannot catch side-effecting functions such as
 * pg_terminate_backend() or set_config() inside a SELECT.
 */
function isReadOnlyQuery(query: string): boolean {
  const trimmed = query.trim();
  // Strip trailing semicolon if single
  const singleQuery = trimmed.replace(/;\s*$/, '');
  // Multiple statements not allowed
  if (singleQuery.includes(';')) {
    return false;
  }
  if (FORBIDDEN_SQL.test(singleQuery)) {
    return false;
  }
  // Must start with SELECT, EXPLAIN, or WITH
  return /^(SELECT|EXPLAIN|WITH)\b/i.test(singleQuery);
}

/** postgres(ql)://user:pass@host:port/db only. '' / null clears the connection. */
const connectionSchema = z.object({
  connectionString: z
    .union([
      z
        .string()
        .trim()
        .max(2048)
        .refine((v) => v === '' || /^postgres(ql)?:\/\/[^/]+/i.test(v), {
          message: 'Connection string must be a postgres:// or postgresql:// URL',
        }),
      z.null(),
    ])
    .optional(),
});

const querySchema = z.object({
  query: z.string().trim().min(1, 'SQL query string is required').max(20_000),
});

/** Target host must be public (SSRF): blocks the app's own database, localhost and internal networks. */
async function assertSafeConnection(connectionString: string): Promise<void> {
  const url = new URL(connectionString);
  try {
    await assertSafeHost(url.hostname, url.port || '5432');
  } catch (error) {
    if (isSsrfError(error)) throw error;
    throw new UnresolvableHostError(); // DNS failure: the user's input, not a server error
  }
}

class UnresolvableHostError extends Error {
  constructor() {
    super('Database host could not be resolved');
  }
}

/** 400 for connection-target problems; false = not one of ours. */
function sendTargetError(error: unknown, res: Response): boolean {
  if (isSsrfError(error)) {
    res.status(400).json({ error: 'Database host must be a public address' });
    return true;
  }
  if (error instanceof UnresolvableHostError) {
    res.status(400).json({ error: error.message });
    return true;
  }
  return false;
}

/** READ ONLY transaction + statement timeout: the database itself enforces read-only. */
async function runReadOnly(client: PrismaClient, query: string): Promise<unknown> {
  const [, , results] = await client.$transaction([
    client.$executeRawUnsafe('SET TRANSACTION READ ONLY'),
    client.$executeRawUnsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`),
    client.$queryRawUnsafe(query),
  ]);
  return results;
}

const findOwnEnvironment = (environmentId: string, organizationId: string) =>
  prisma.projectEnvironment.findFirst({ where: { id: environmentId, project: { organizationId } } });

export const getDatabaseConnection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const env = await findOwnEnvironment(req.params.environmentId, req.user!.organizationId);
    if (!env) {
      res.status(404).json({ error: 'Environment not found' });
      return;
    }

    res.json({
      environmentId: env.id,
      name: env.name,
      hasConnectionString: !!env.dbConnectionString,
      dbConnectionString: env.dbConnectionString ? '********' : null,
    });
  } catch (error) {
    handleError(error, res);
  }
};

export const updateDatabaseConnection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { connectionString } = connectionSchema.parse(req.body);

    const env = await findOwnEnvironment(req.params.environmentId, req.user!.organizationId);
    if (!env) {
      res.status(404).json({ error: 'Environment not found' });
      return;
    }

    const value = connectionString ? connectionString : null;
    if (value) await assertSafeConnection(value);

    const updated = await prisma.projectEnvironment.update({
      where: { id: env.id },
      data: { dbConnectionString: value },
    });

    res.json({
      environmentId: updated.id,
      name: updated.name,
      hasConnectionString: !!updated.dbConnectionString,
      dbConnectionString: updated.dbConnectionString ? '********' : null,
      message: 'Database connection configuration updated successfully',
    });
  } catch (error) {
    if (sendTargetError(error, res)) return;
    handleError(error, res);
  }
};

export const executeDatabaseSentinelQuery = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const environmentId = req.params.environmentId || req.body?.environmentId;
    if (!environmentId || typeof environmentId !== 'string') {
      res.status(400).json({ error: 'environmentId is required' });
      return;
    }

    const parsed = querySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'SQL query string is required' });
      return;
    }
    const query = parsed.data.query;

    // Security Gate 1: Strict read-only query assertion
    if (!isReadOnlyQuery(query)) {
      res.status(400).json({
        error: 'Security Violation: Database Sentinel permits ONLY read-only SELECT queries. Data mutation commands (INSERT, UPDATE, DELETE, DROP) are strictly forbidden.',
      });
      return;
    }

    const env = await findOwnEnvironment(environmentId, req.user!.organizationId);
    if (!env) {
      res.status(404).json({ error: 'Environment not found' });
      return;
    }

    // Never fall back to the application database: it holds every tenant's data
    // (users, password hashes, reset tokens, integration secrets).
    if (!env.dbConnectionString) {
      res.status(400).json({ error: 'No target database configured for this environment' });
      return;
    }

    // Re-checked on every run: DNS for the host may have changed since it was saved.
    await assertSafeConnection(env.dbConnectionString);

    const targetClient = new PrismaClient({
      datasources: { db: { url: env.dbConnectionString } },
    });

    try {
      const start = Date.now();
      let results: unknown;
      try {
        results = await runReadOnly(targetClient, query);
      } catch (queryError) {
        // Error from the user's own target database (syntax, read-only violation, timeout).
        const message = (queryError as Error).message?.split('\n').filter(Boolean).pop() ?? 'Query failed';
        res.status(400).json({ error: `Query failed: ${message.slice(0, 300)}` });
        return;
      }
      const duration = Date.now() - start;
      const rows = Array.isArray(results) ? results.slice(0, MAX_ROWS) : [];
      const fields = rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null ? Object.keys(rows[0]) : [];

      res.json({
        environmentName: env.name,
        query,
        rowCount: rows.length,
        fields,
        rows,
        durationMs: duration,
        executedAt: new Date().toISOString(),
      });
    } finally {
      await targetClient.$disconnect().catch(() => {});
    }
  } catch (error) {
    if (sendTargetError(error, res)) return;
    handleError(error, res);
  }
};
