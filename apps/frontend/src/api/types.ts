export type UserRole = 'student' | 'organizer' | 'moderator';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface UserCreate {
  email: string;
  name: string;
  password: string;
  roles?: UserRole[];
}

export interface UserUpdate {
  email?: string | null;
  name?: string | null;
  password?: string | null;
  roles?: UserRole[] | null;
}

export interface UserAttributes {
  email: string;
  name: string;
  roles: UserRole[];
  created_at: string;
  updated_at: string;
}

export interface UserResourceData {
  type?: 'users';
  id: string;
  attributes: UserAttributes;
}

export interface TokenAttributes {
  access_token: string;
  token_type?: 'bearer';
  expires_at: string;
}

export interface TokenResourceData {
  type?: 'tokens';
  id: string;
  attributes: TokenAttributes;
}

export interface JsonApiErrorSource {
  pointer?: string | null;
  parameter?: string | null;
  header?: string | null;
}

export interface JsonApiError {
  id?: string | null;
  status?: string | null;
  code?: string | null;
  title?: string | null;
  detail?: string | null;
  source?: JsonApiErrorSource | null;
  meta?: Record<string, unknown> | null;
}

export interface ApiResponse<T> {
  data?: T | T[] | null;
  errors?: JsonApiError[] | null;
  meta?: Record<string, unknown> | null;
}

export type UserResponse = ApiResponse<UserResourceData>;
export type TokenResponse = ApiResponse<TokenResourceData>;
