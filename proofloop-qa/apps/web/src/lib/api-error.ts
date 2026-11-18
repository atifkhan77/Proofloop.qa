import axios from 'axios';

/** Response body shape of API errors (apps/api/src/controllers/auth.controller.ts). */
interface ApiErrorBody {
  error?: string;
  details?: Record<string, string[] | undefined>;
}

export function getApiStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

/** Best human-readable message from an API error, or `fallback`. */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError<ApiErrorBody>(error)) return fallback;
  const body = error.response?.data;
  // 400 validation responses carry per-field messages in `details`; surface the first one.
  const firstDetail = body?.details ? Object.values(body.details).flat().find(Boolean) : undefined;
  return firstDetail || body?.error || fallback;
}
