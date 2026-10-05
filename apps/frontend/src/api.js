// Shared API client for the QuestBoard FastAPI backend.
// The backend URL comes from VITE_API_BASE_URL (see .env.example).
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

// Form limits, matching the backend models in apps/backend/src/models/users.py.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_MAX_LENGTH = 255;
export const NAME_MAX_LENGTH = 120;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

// Error thrown for every failed request. `status` is 0 when the server could not be reached.
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Turns a JSON:API error pointer such as "/email" into a label such as "Email".
function pointerToLabel(pointer) {
  const name = (pointer || "").replace(/^\//, "").replace(/_/g, " ");
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
}

// Builds one readable message from a JSON:API `errors` array.
function readErrorMessage(body, status) {
  if (body && Array.isArray(body.errors) && body.errors.length > 0) {
    return body.errors
      .map((error) => {
        const detail = error.detail || error.title || "Something went wrong.";
        const label = pointerToLabel(error.source && error.source.pointer);
        return label ? `${label}: ${detail}` : detail;
      })
      .join(" ");
  }
  return `The server returned an unexpected error (status ${status}).`;
}

async function request(path, { method = "GET", body, token } = {}) {
  if (!API_BASE_URL) {
    throw new ApiError(
      "The API URL is not configured. Copy .env.example to .env and restart the dev server.",
      0
    );
  }

  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(API_BASE_URL + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch only throws when no response arrived (server down, wrong URL, CORS, offline).
    throw new ApiError(
      `Could not reach the server at ${API_BASE_URL}. Check that the backend is running.`,
      0
    );
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new ApiError(readErrorMessage(data, response.status), response.status);
  }
  if (!data || !data.data) {
    throw new ApiError("The server returned an unexpected response.", response.status);
  }
  return data.data;
}

// POST /auth/login -> { token, userId, expiresAt }
export async function login(email, password) {
  const resource = await request("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  const attributes = resource.attributes || {};
  const expiresAt = attributes.expires_at;

  if (!attributes.access_token || !resource.id || Number.isNaN(Date.parse(expiresAt))) {
    throw new ApiError("The server returned an incomplete login response.", 200);
  }
  return { token: attributes.access_token, userId: resource.id, expiresAt };
}

// Reads { name, email } from a JSON:API "users" resource.
function readUser(resource) {
  const attributes = resource.attributes || {};
  if (typeof attributes.name !== "string" || typeof attributes.email !== "string") {
    throw new ApiError("The server returned an incomplete user response.", 200);
  }
  return { name: attributes.name, email: attributes.email };
}

// POST /users -> { name, email }. Roles are never sent; the backend default applies.
export async function registerUser(name, email, password) {
  const resource = await request("/users", {
    method: "POST",
    body: { name, email, password },
  });
  return readUser(resource);
}

// PATCH /users/{userId} with only the changed fields -> { name, email }
export async function updateUser(userId, changes, token) {
  const resource = await request(`/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: changes,
    token,
  });
  return readUser(resource);
}
