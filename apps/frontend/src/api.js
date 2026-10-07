// Shared API client for the QuestBoard FastAPI backend.
// The backend URL comes from VITE_API_BASE_URL (see .env.example).
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

// Form limits, matching the backend models in apps/backend/src/models/.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_MAX_LENGTH = 255;
export const NAME_MAX_LENGTH = 120;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const REASON_MAX_LENGTH = 500;

export const REQUESTABLE_ROLES = ["organizer", "moderator"];
export const ROLE_REQUEST_STATUSES = ["pending", "approved", "rejected"];

// Read on every call so tests can change it.
export function roleRequestsEnabled() {
  return import.meta.env.VITE_ROLE_REQUESTS_ENABLED === "true";
}

// Error thrown for every failed request.
// `status` is 0 when the server could not be reached, so callers can tell a network
// failure apart from the server rejecting the request (for example 401).
// `code` is the backend's error code, such as "role_request_pending".
// `fieldErrors` maps a request field (such as "email") to the backend's message for it.
export class ApiError extends Error {
  constructor(message, status, fieldErrors = {}, code = "") {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.code = code;
  }

  get isNetworkError() {
    return this.status === 0;
  }

  // True when the request may have been carried out even though no usable answer came
  // back: the connection failed after sending, a gateway timed out, or a success
  // response was unreadable. Callers must not report such an action as failed.
  get resultUnknown() {
    if (this.code === "api_not_configured") return false;
    return (
      this.status === 0 ||
      this.status === 502 ||
      this.status === 504 ||
      (this.status >= 200 && this.status < 300)
    );
  }

  // True when the backend has no such route, e.g. an older backend without /users/me.
  get isUnsupported() {
    return this.status === 404 || this.status === 405;
  }
}

// Turns a JSON:API error pointer such as "/email" into a field name such as "email".
function pointerToField(pointer) {
  return (pointer || "").replace(/^\//, "").split("/")[0];
}

function fieldToLabel(field) {
  const words = field.replace(/_/g, " ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

// Reads a JSON:API `errors` array into one readable message plus per-field messages.
function readErrors(body, status) {
  if (!body || !Array.isArray(body.errors) || body.errors.length === 0) {
    return {
      message: `The server returned an unexpected error (status ${status}).`,
      fieldErrors: {},
      code: "",
    };
  }

  const messages = [];
  const fieldErrors = {};
  for (const error of body.errors) {
    const detail = error.detail || error.title || "Something went wrong.";
    const field = pointerToField(error.source && error.source.pointer);
    if (field && !fieldErrors[field]) {
      fieldErrors[field] = detail;
    }
    messages.push(field ? `${fieldToLabel(field)}: ${detail}` : detail);
  }
  return { message: messages.join(" "), fieldErrors, code: body.errors[0].code || "" };
}

// Splits an ApiError into messages for the given form fields and one form-level message.
// Errors for fields the form doesn't show stay in the form-level message.
export function formErrorsFrom(error, fieldNames) {
  const fieldErrors = {};
  for (const name of fieldNames) {
    if (error.fieldErrors && error.fieldErrors[name]) {
      fieldErrors[name] = error.fieldErrors[name];
    }
  }
  const otherFields = Object.keys(error.fieldErrors || {}).filter(
    (name) => !fieldNames.includes(name)
  );
  const formError =
    Object.keys(fieldErrors).length > 0 && otherFields.length === 0
      ? "Please fix the highlighted fields."
      : error.message;
  return { fieldErrors, formError };
}

async function request(path, { method = "GET", body, token } = {}) {
  if (!API_BASE_URL) {
    throw new ApiError(
      "The API URL is not configured. Copy .env.example to .env and restart the dev server.",
      0,
      {},
      "api_not_configured"
    );
  }

  const headers = {};
  if (body) {
    headers["Content-Type"] = "application/json";
  }
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
    // The request may still have reached the server, so this doesn't say it didn't.
    throw new ApiError(
      `Couldn't get a response from the server at ${API_BASE_URL}. ` +
        "Check that the backend is running.",
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
    const { message, fieldErrors, code } = readErrors(data, response.status);
    throw new ApiError(message, response.status, fieldErrors, code);
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

// Reads { id, name, email, roles } from a JSON:API "users" resource.
// Roles are only displayed; access is always decided by the backend.
function readUser(resource) {
  const attributes = resource.attributes || {};
  if (
    typeof resource.id !== "string" ||
    typeof attributes.name !== "string" ||
    typeof attributes.email !== "string"
  ) {
    throw new ApiError("The server returned an incomplete user response.", 200);
  }
  return {
    id: resource.id,
    name: attributes.name,
    email: attributes.email,
    roles: Array.isArray(attributes.roles) ? attributes.roles : [],
  };
}

// POST /users -> { id, name, email, roles }. Roles are never sent: on the current backend
// they would be granted immediately, and newer backends reject the field.
export async function registerUser(name, email, password) {
  const resource = await request("/users", {
    method: "POST",
    body: { name, email, password },
  });
  return readUser(resource);
}

// GET /users/me -> { id, name, email, roles } for the signed-in user.
export async function getCurrentUser(token) {
  const resource = await request("/users/me", { token });
  return readUser(resource);
}

// PATCH /users/{userId} with only the changed fields -> { id, name, email, roles }
export async function updateUser(userId, changes, token) {
  const resource = await request(`/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: changes,
    token,
  });
  return readUser(resource);
}

// Reads a JSON:API "role-requests" resource. The backend leaves out fields that are
// empty, such as `reason` or `reviewed_at`.
function readRoleRequest(resource) {
  const attributes = resource.attributes || {};
  if (typeof resource.id !== "string" || !attributes.role || !attributes.status) {
    throw new ApiError("The server returned an incomplete role request.", 200);
  }
  return {
    id: resource.id,
    userId: attributes.user_id,
    role: attributes.role,
    reason: attributes.reason || "",
    status: attributes.status,
    createdAt: attributes.created_at || "",
    reviewedAt: attributes.reviewed_at || "",
  };
}

function readRoleRequestList(data) {
  if (!Array.isArray(data)) {
    throw new ApiError("The server returned an unexpected role request list.", 200);
  }
  return data.map(readRoleRequest);
}

// POST /role-requests. Creates a request that an admin must approve; it does not give
// the user the role. An empty reason is left out, because the backend rejects it.
export async function createRoleRequest(role, reason, token) {
  const body = { role };
  if (reason) {
    body.reason = reason;
  }
  const resource = await request("/role-requests", { method: "POST", body, token });
  return readRoleRequest(resource);
}

// GET /role-requests/me -> the signed-in user's requests, oldest first.
export async function listMyRoleRequests(token) {
  return readRoleRequestList(await request("/role-requests/me", { token }));
}

// GET /role-requests?status=... (admins only) -> requests with that status, oldest first.
export async function listRoleRequests(status, token) {
  const query = `?status=${encodeURIComponent(status)}`;
  return readRoleRequestList(await request(`/role-requests${query}`, { token }));
}

// POST /role-requests/{id}/approve or /reject (admins only) -> the reviewed request.
export async function reviewRoleRequest(requestId, decision, token) {
  if (decision !== "approve" && decision !== "reject") {
    throw new Error(`Unknown decision: ${decision}`);
  }
  const path = `/role-requests/${encodeURIComponent(requestId)}/${decision}`;
  return readRoleRequest(await request(path, { method: "POST", token }));
}
