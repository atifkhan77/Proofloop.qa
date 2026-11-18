import { api } from '../api-client';

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface AuthMessageResponse {
  message: string;
}

export const requestPasswordReset = async (email: string): Promise<AuthMessageResponse> => {
  const res = await api.post<AuthMessageResponse>('/auth/forgot-password', { email });
  return res.data;
};

export const submitPasswordReset = async (data: ResetPasswordRequest): Promise<AuthMessageResponse> => {
  const res = await api.post<AuthMessageResponse>('/auth/reset-password', data);
  return res.data;
};
