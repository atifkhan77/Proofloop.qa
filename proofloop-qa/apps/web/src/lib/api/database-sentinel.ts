import { api } from '../api-client';

export interface DatabaseConnectionInfo {
  environmentId: string;
  name: string;
  hasConnectionString: boolean;
  dbConnectionString: string | null;
  message?: string;
}

export interface SentinelQueryResult {
  environmentName: string;
  query: string;
  rowCount: number;
  fields?: string[];
  rows: any[];
  durationMs?: number;
  executedAt: string;
}

export const getDatabaseConnection = async (
  environmentId: string,
): Promise<DatabaseConnectionInfo> => {
  const res = await api.get<DatabaseConnectionInfo>(
    `/environments/${encodeURIComponent(environmentId)}/database/connection`,
  );
  return res.data;
};

export const updateDatabaseConnection = async (
  environmentId: string,
  connectionString: string | null,
): Promise<DatabaseConnectionInfo> => {
  const res = await api.put<DatabaseConnectionInfo>(
    `/environments/${encodeURIComponent(environmentId)}/database/connection`,
    { connectionString },
  );
  return res.data;
};

export const executeSentinelQuery = async (
  environmentId: string,
  query: string,
): Promise<SentinelQueryResult> => {
  const res = await api.post<SentinelQueryResult>(
    `/environments/${encodeURIComponent(environmentId)}/database/query`,
    { query },
  );
  return res.data;
};
