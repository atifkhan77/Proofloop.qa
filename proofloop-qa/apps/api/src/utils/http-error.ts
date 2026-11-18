import { Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@proofloop/prisma';

/**
 * Shared error responder. 400 bodies use `details: { field: string[] }`,
 * the shape the web client's getApiErrorMessage() expects.
 */
export function handleError(error: unknown, res: Response): void {
  if (error instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', details: error.flatten().fieldErrors });
    return;
  }
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
}

/** Prisma unique-constraint violation (P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
