import { api } from '../api-client';

export type UserRole = 'ADMIN' | 'QA_LEAD' | 'QA_ENGINEER' | 'VIEWER';

export interface OrgUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  createdAt: string;
}

export const getOrganizationUsers = async (): Promise<OrgUser[]> => {
  const res = await api.get<OrgUser[]>('/organization/users');
  return res.data;
};

export const updateUserRole = async (userId: string, role: UserRole): Promise<OrgUser> => {
  const res = await api.patch<OrgUser>(`/organization/users/${encodeURIComponent(userId)}/role`, { role });
  return res.data;
};

export const softDeleteUser = async (userId: string): Promise<void> => {
  await api.delete(`/organization/users/${encodeURIComponent(userId)}`);
};
