import { z } from 'zod';

/**
 * Mirrors apps/api/src/validations/common.validation.ts `safeUrlSchema`.
 * Optional http(s) URL; '' means "none". Rejects javascript:, file:, etc.
 * (z.string().url() accepts those – see docs/ISSUE-LOG.md DATA-10).
 */
export const safeUrlSchema = z
  .string()
  .trim()
  .refine(
    (val) => {
      if (!val) return true;
      try {
        return ['http:', 'https:'].includes(new URL(val).protocol);
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid HTTP or HTTPS URL' },
  );
