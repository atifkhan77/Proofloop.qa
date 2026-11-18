import axios from 'axios';

export const AUTH_TOKEN_KEY = 'proofloop-auth-token';
export const UNAUTHORIZED_EVENT = 'auth:unauthorized';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

// Endpoints where a 401 means "bad credentials", not "session expired".
const AUTH_ENTRY_PATHS = ['/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password'];

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  let token: string | null = null;
  try {
    token = localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    /* storage blocked */
  }
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url: string = error.config?.url ?? '';
    if (error.response?.status === 401 && !AUTH_ENTRY_PATHS.some((p) => url.endsWith(p))) {
      try {
        localStorage.removeItem(AUTH_TOKEN_KEY);
      } catch {
        /* storage blocked */
      }
      // Notify AuthProvider so it clears in-memory state.
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    return Promise.reject(error);
  },
);
