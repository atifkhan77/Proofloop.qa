import { z } from 'zod';

export const safeUrlSchema = z
  .string()
  .trim()
  .refine(
    (val) => {
      if (!val) return true; // Allow empty string if the field is optional/nullable
      try {
        const url = new URL(val);
        return ['http:', 'https:'].includes(url.protocol);
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid HTTP or HTTPS URL' },
  );
