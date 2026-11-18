import { Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { ZodError } from 'zod';
import { Prisma } from '@proofloop/prisma';
import { prisma } from '../db';
import { config } from '../config';
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from '../validations/auth.validation';
import { AuthRequest, AuthUser } from '../middlewares/auth.middleware';
import { hashPassword, verifyPassword } from '../utils/password';

const BCRYPT_ROUNDS = 12;
// Compared against when the email is unknown, so login timing does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('proofloop-dummy-password', BCRYPT_ROUNDS);

const publicUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  organizationId: true,
} as const;

function signToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, role: user.role, organizationId: user.organizationId },
    config.jwtSecret,
    { algorithm: 'HS256', expiresIn: config.sessionExpiration as SignOptions['expiresIn'] },
  );
}

/** Reset tokens are stored as SHA-256 hex (64 chars); the raw token only goes into the link. */
const hashResetToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

function handleError(error: unknown, res: Response): void {
  if (error instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', details: error.flatten().fieldErrors });
    return;
  }
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
}

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = registerSchema.parse(req.body);
    const passwordHash = await hashPassword(data.password, BCRYPT_ROUNDS);

    // Create the organization and its first user (ADMIN) atomically.
    const user = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: data.organizationName } });
      return tx.user.create({
        data: {
          email: data.email,
          passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          organizationId: org.id,
          role: 'ADMIN',
        },
        select: publicUserSelect,
      });
    });

    res.status(201).json({ user, token: signToken(user) });
  } catch (error) {
    // Unique constraint on email; also covers concurrent registrations racing past any pre-check.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({ error: 'Email already in use' });
      return;
    }
    handleError(error, res);
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: data.email } });

    const isValidPassword = await verifyPassword(data.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !isValidPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Checked AFTER the password: otherwise anyone could learn that an email belongs to a
    // deactivated account without knowing its password (cf. AUTH-03).
    if (user.deletedAt !== null) {
      res.status(403).json({ error: 'Account has been deactivated. Contact your administrator.' });
      return;
    }

    // Same public fields as register / me: never passwordHash, resetToken or resetTokenExpiry.
    const publicUser = Object.fromEntries(
      Object.keys(publicUserSelect).map((key) => [key, user[key as keyof typeof publicUserSelect]]),
    );
    res.json({ user: publicUser, token: signToken(user) });
  } catch (error) {
    handleError(error, res);
  }
};

export const me = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: publicUserSelect,
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user });
  } catch (error) {
    handleError(error, res);
  }
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || user.deletedAt !== null) {
      // Security: Always return 200 OK even if the email doesn't exist to prevent email enumeration attacks
      res.status(200).json({ message: 'If an account exists, a reset link has been sent.' });
      return;
    }

    // Generate a secure 64-character hex token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now

    // Only the SHA-256 of the token is stored: a database read alone cannot reset a password.
    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken: hashResetToken(resetToken), resetTokenExpiry },
    });

    // In Production: Send this link via Email (e.g., Nodemailer/SendGrid)
    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;
    // No mail service yet: the link is logged only outside production (logs must not hold live tokens).
    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n🔒 [DEV ONLY] Password Reset Link for ${email}: \n${resetLink}\n`);
    }

    res.status(200).json({ message: 'If an account exists, a reset link has been sent.' });
  } catch (error) {
    handleError(error, res);
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { resetToken: hashResetToken(token) },
    });

    // Verify token exists, matches, and hasn't expired
    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      res.status(400).json({ error: 'Invalid or expired password reset token' });
      return;
    }

    const hashedPassword = await hashPassword(newPassword, BCRYPT_ROUNDS);

    // Update password and invalidate the token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashedPassword,
        passwordChangedAt: new Date(), // revokes every token issued before the reset (SEC-14)
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    res.status(200).json({ message: 'Password has been successfully reset' });
  } catch (error) {
    handleError(error, res);
  }
};
