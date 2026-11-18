import type { Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { AuthRequest } from './auth.middleware';
import { RedisFallbackStore } from '../lib/rate-limit-store';

/**
 * API-30: limits synchronous API executions per ORGANIZATION (not per user or IP), so one
 * tenant cannot use the server as an HTTP relay at volume.
 *
 * Must run AFTER `authenticate` (the key needs req.user).
 *
 * Counters live in Redis (shared by all API processes) with an in-memory fallback, see
 * lib/rate-limit-store.ts (API-52).
 *
 * API_EXECUTION_RATE_LIMIT overrides the default (Playwright raises it so the regression
 * suite's own runs are not throttled; the 429 test fires limit+1 requests).
 */
const DEFAULT_LIMIT = 30;
const parsed = Number(process.env.API_EXECUTION_RATE_LIMIT);
export const EXECUTION_RATE_LIMIT = Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;

export const executionRateLimiter = rateLimit({
  store: new RedisFallbackStore('execution'),
  windowMs: 60 * 1000,
  limit: EXECUTION_RATE_LIMIT, // `max` is the deprecated name in express-rate-limit 8
  standardHeaders: 'draft-7', // RateLimit / RateLimit-Policy headers
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const orgId = (req as AuthRequest).user?.organizationId;
    // Fallback only if mounted without authenticate; ipKeyGenerator groups IPv6 by subnet.
    return orgId ? `org:${orgId}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
  },
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many requests: Rate limit exceeded for your organization' });
  },
});

// ---------- Auth endpoints (ISSUE-LOG AUTH-14) ----------

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const envLimit = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const tooMany = (message: string) => (_req: Request, res: import('express').Response) => {
  res.status(429).json({ error: message });
};

/** IP + submitted email: throttles guessing one account without locking out a whole office NAT. */
const ipAndEmailKey = (req: Request) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return `${ipKeyGenerator(req.ip ?? '')}|${email}`;
};

const isLoopback = (ip: string | undefined) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

/** Failed logins only (successful ones are not counted). AUTH_LOGIN_RATE_LIMIT per 15 min. */
export const loginRateLimiter = rateLimit({
  store: new RedisFallbackStore('login'),
  windowMs: FIFTEEN_MINUTES,
  limit: envLimit('AUTH_LOGIN_RATE_LIMIT', 10),
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: ipAndEmailKey,
  handler: tooMany('Too many failed login attempts. Please try again in 15 minutes.'),
});

/** Reset e-mails per address and IP (stops mail-bombing a user). */
export const forgotPasswordRateLimiter = rateLimit({
  store: new RedisFallbackStore('forgot'),
  windowMs: FIFTEEN_MINUTES,
  limit: envLimit('AUTH_FORGOT_RATE_LIMIT', 5),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: ipAndEmailKey,
  handler: tooMany('Too many password reset requests. Please try again later.'),
});

/** Token submissions per IP. */
export const resetPasswordRateLimiter = rateLimit({
  store: new RedisFallbackStore('reset'),
  windowMs: FIFTEEN_MINUTES,
  limit: envLimit('AUTH_RESET_RATE_LIMIT', 20),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ''),
  handler: tooMany('Too many password reset attempts. Please try again later.'),
});

/**
 * New organizations per IP per hour. Loopback is exempt outside production: the e2e suite
 * registers well over 100 organizations per run from localhost.
 */
export const registerRateLimiter = rateLimit({
  store: new RedisFallbackStore('register'),
  windowMs: 60 * 60 * 1000,
  limit: envLimit('AUTH_REGISTER_RATE_LIMIT', 20),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ''),
  skip: (req: Request) => process.env.NODE_ENV !== 'production' && isLoopback(req.ip),
  handler: tooMany('Too many sign-ups from this address. Please try again later.'),
});
