import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const PLACEHOLDER_SECRET = 'generate-a-secure-random-string-here';

function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === PLACEHOLDER_SECRET || secret.length < 32) {
    throw new Error('JWT_SECRET must be set to a random string of at least 32 characters');
  }
  return secret;
}

export const config = {
  port: Number(process.env.PORT) || 4000,
  jwtSecret: requireJwtSecret(),
  sessionExpiration: process.env.SESSION_EXPIRATION || '7d',
  // Browser origins allowed by CORS (comma-separated). Default: FRONTEND_URL or the Vite dev server.
  corsOrigins: (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean),
};
