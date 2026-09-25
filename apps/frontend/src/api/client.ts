import {Platform} from 'react-native';

import {
  ApiResponse,
  JsonApiError,
  LoginRequest,
  TokenResponse,
  UserCreate,
  UserResponse,
  UserUpdate,
} from './types';

const API_BASE_URL =
  Platform.OS === 'android'
    ? 'http://10.0.2.2:8000/api/v1'
    : 'http://localhost:8000/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly errors: JsonApiError[];

  constructor(status: number, errors: JsonApiError[], message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  return (
    isRecord(value) &&
    ('data' in value || 'errors' in value || 'meta' in value)
  );
}

function getErrorMessage(status: number, errors: JsonApiError[]): string {
  const detail = errors.find(error => error.detail)?.detail;
  return detail ?? `Request failed with status ${status}`;
}

export class ApiClient {
  private accessToken: string | null = null;

  setAccessToken(accessToken: string | null): void {
    this.accessToken = accessToken;
  }

  async login(request: LoginRequest): Promise<TokenResponse> {
    const response = await this.request<TokenResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(request),
    });

    const token = this.getSingleResource(response, 'login');
    this.setAccessToken(token.attributes.access_token);
    return response;
  }

  createUser(request: UserCreate): Promise<UserResponse> {
    return this.request<UserResponse>('/users', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  updateUser(userId: number, request: UserUpdate): Promise<UserResponse> {
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error('userId must be a positive integer');
    }

    return this.request<UserResponse>(`/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(request),
    });
  }

  private async request<T extends ApiResponse<unknown>>(
    path: string,
    init: RequestInit,
  ): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(this.accessToken
            ? {Authorization: `Bearer ${this.accessToken}`}
            : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new ApiError(0, [], 'Unable to reach the API');
    }

    const body: unknown = await response.json().catch(() => null);
    const errors = isApiResponse(body) && Array.isArray(body.errors)
      ? body.errors.filter(isJsonApiError)
      : [];

    if (!response.ok) {
      throw new ApiError(
        response.status,
        errors,
        getErrorMessage(response.status, errors),
      );
    }

    if (!isApiResponse(body)) {
      throw new ApiError(response.status, [], 'The API returned an invalid response');
    }

    return body as T;
  }

  private getSingleResource<T extends {attributes: unknown}>(
    response: ApiResponse<T>,
    operation: string,
  ): T {
    if (!response.data || Array.isArray(response.data)) {
      throw new ApiError(200, response.errors ?? [], `The API returned no ${operation} data`);
    }

    return response.data;
  }
}

function isJsonApiError(value: unknown): value is JsonApiError {
  return isRecord(value);
}

export const apiClient = new ApiClient();
