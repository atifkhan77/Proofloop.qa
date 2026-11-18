import { api } from '../api-client';

// Mirrors apps/api/src/validations/api-intelligence.validation.ts and the controller JSON.

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const ASSERTION_TYPES = ['status', 'header', 'body', 'responseTime'] as const;
export type AssertionType = (typeof ASSERTION_TYPES)[number];

export const ASSERTION_OPERATORS = ['equals', 'not_equals', 'contains', 'exists', 'greater_than', 'less_than'] as const;
export type AssertionOperator = (typeof ASSERTION_OPERATORS)[number];

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type AuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apiKey'; key: string; value: string; in: 'header' | 'query' };

export const ASSERTION_DATA_TYPES = ['string', 'number', 'boolean', 'null'] as const;
export type AssertionDataType = (typeof ASSERTION_DATA_TYPES)[number];

export interface Assertion {
  type: AssertionType;
  path?: string;
  operator: AssertionOperator;
  value?: string | number | boolean | null;
  /** Set by the server on save (except for `exists`); missing on rules saved before API-22. */
  dataType?: AssertionDataType;
}

export interface ApiCollection {
  id: string;
  name: string;
  description: string | null;
  projectId: string;
  _count?: { requests: number }; // list / detail only
  createdAt: string;
}

/** GET /api-collections/:id */
export interface ApiCollectionDetail extends ApiCollection {
  project: { id: string; name: string };
}

export interface ApiRequest {
  id: string;
  name: string;
  method: HttpMethod;
  endpoint: string;
  headers: Record<string, string> | null;
  queryParams: Record<string, string> | null;
  body: JsonValue; // null = no body
  auth: AuthConfig | null; // secrets are '********' for VIEWERs (server-side redaction)
  assertions: Assertion[] | null;
  sequenceNumber: number;
  collectionId: string;
  createdAt: string;
}

export interface CreateApiRequestData {
  name: string;
  method: HttpMethod;
  endpoint: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: JsonValue;
  auth?: AuthConfig;
  assertions?: Assertion[];
}

/** PENDING is reserved for queued execution; the engine is synchronous today (PASSED/FAILED only). */
export type ApiExecutionStatus = 'PENDING' | 'PASSED' | 'FAILED';

export interface ApiExecution {
  id: string;
  status: ApiExecutionStatus;
  responseTime: number;
  statusCode: number; // 0 = no response (network error, timeout, oversized)
  responseBody: JsonValue;
  errorMessage: string | null;
  requestId: string;
  environmentId: string | null;
  environment?: { name: string } | null;
  createdAt: string;
}

const enc = encodeURIComponent;

export const getApiCollections = async (projectId: string): Promise<ApiCollection[]> => {
  const response = await api.get<ApiCollection[]>(`/projects/${enc(projectId)}/api-collections`);
  return response.data;
};

export const createApiCollection = async (
  projectId: string,
  data: { name: string; description?: string },
): Promise<ApiCollection> => {
  const response = await api.post<ApiCollection>(`/projects/${enc(projectId)}/api-collections`, data);
  return response.data;
};

export const getApiCollection = async (collectionId: string): Promise<ApiCollectionDetail> => {
  const response = await api.get<ApiCollectionDetail>(`/api-collections/${enc(collectionId)}`);
  return response.data;
};

export const getApiRequests = async (collectionId: string): Promise<ApiRequest[]> => {
  const response = await api.get<ApiRequest[]>(`/api-collections/${enc(collectionId)}/requests`);
  return response.data;
};

export const createApiRequest = async (collectionId: string, data: CreateApiRequestData): Promise<ApiRequest> => {
  const response = await api.post<ApiRequest>(`/api-collections/${enc(collectionId)}/requests`, data);
  return response.data;
};

/** Runs the stored request server-side. {{baseUrl}} is resolved from the environment. */
export const executeApiRequest = async (requestId: string, data: { environmentId?: string }): Promise<ApiExecution> => {
  const response = await api.post<ApiExecution>(`/api-requests/${enc(requestId)}/execute`, data);
  return response.data;
};

export const getApiExecution = async (executionId: string): Promise<ApiExecution> => {
  const response = await api.get<ApiExecution>(`/api-executions/${enc(executionId)}`);
  return response.data;
};
