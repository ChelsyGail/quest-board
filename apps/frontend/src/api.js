// Shared API client for the QuestBoard FastAPI backend.
// The backend URL comes from VITE_API_BASE_URL (see .env.example).
import {
  demoCreateQuest,
  demoGetItem,
  demoJoinItem,
  demoListMyItems,
  demoListMyParticipations,
  demoListPublishedItems,
  demoPublishItem,
  resetDemoQuests,
} from "./demoQuests.js";

export { resetDemoQuests };

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

// Form limits, matching the backend models in apps/backend/src/models/.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_MAX_LENGTH = 255;
// Any valid address works: the backend has no domain rule.
export const EMAIL_HINT = "Use your school or personal email.";
export const EMAIL_PLACEHOLDER = "you@example.com";
export const NAME_MAX_LENGTH = 120;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const REASON_MAX_LENGTH = 500;

export const ITEM_TITLE_MAX_LENGTH = 200;
export const ITEM_DESCRIPTION_MAX_LENGTH = 5000;
export const ITEM_LOCATION_MAX_LENGTH = 255;
export const ITEM_CATEGORY_MAX_LENGTH = 64;
export const PROOF_INSTRUCTIONS_MAX_LENGTH = 5000;
export const POINT_VALUE_MIN = 1;
export const POINT_VALUE_MAX = 10000;

export const REQUESTABLE_ROLES = ["organizer", "moderator"];
export const ROLE_REQUEST_STATUSES = ["pending", "approved", "rejected"];

// Read on every call so tests can change it.
export function roleRequestsEnabled() {
  return import.meta.env.VITE_ROLE_REQUESTS_ENABLED === "true";
}

// Catalogue pages (quests and events). Either flag turns them on; the team's pages used
// VITE_CATALOGUE_ENABLED and the quest pages VITE_QUESTS_ENABLED. Read on every call so
// tests can change it.
export function catalogueEnabled() {
  return (
    import.meta.env.VITE_CATALOGUE_ENABLED === "true" ||
    import.meta.env.VITE_QUESTS_ENABLED === "true"
  );
}

export const questsEnabled = catalogueEnabled;

// Sample-data mode for local demos. Only available in the Vite dev server, never in
// production builds. When on, quest calls never hit the network. It is never turned on
// because a request failed.
export function questsDemoEnabled() {
  return import.meta.env.DEV === true && import.meta.env.VITE_QUESTS_DEMO === "true";
}

// Quest form limits, matching QuestCreate in apps/backend/src/models/catalogue.py.
export const QUEST_TITLE_MAX_LENGTH = ITEM_TITLE_MAX_LENGTH;
export const QUEST_DESCRIPTION_MAX_LENGTH = ITEM_DESCRIPTION_MAX_LENGTH;
export const QUEST_LOCATION_MAX_LENGTH = ITEM_LOCATION_MAX_LENGTH;
export const QUEST_CATEGORY_MAX_LENGTH = ITEM_CATEGORY_MAX_LENGTH;
export const QUEST_PROOF_MAX_LENGTH = PROOF_INSTRUCTIONS_MAX_LENGTH;
export const QUEST_POINTS_MIN = POINT_VALUE_MIN;
export const QUEST_POINTS_MAX = POINT_VALUE_MAX;
export const QUEST_TIME_ZONE_MAX_LENGTH = 64;
export const DEFAULT_QUEST_TIME_ZONE = "Europe/Paris";

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

// Returns the response's `data`, or the whole JSON:API document with `document: true`
// (for `meta` such as page totals).
async function request(path, { method = "GET", body, token, document = false } = {}) {
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
  return document ? data : data.data;
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

// Reads a JSON:API "catalogue-items" resource (an event or a quest). Times are UTC
// ISO strings; `timeZone` is the IANA zone the item takes place in.
function readItem(resource) {
  const attributes = resource.attributes || {};
  if (
    typeof resource.id !== "string" ||
    !attributes.kind ||
    typeof attributes.title !== "string" ||
    Number.isNaN(Date.parse(attributes.starts_at)) ||
    Number.isNaN(Date.parse(attributes.ends_at)) ||
    !attributes.time_zone
  ) {
    throw new ApiError("The server returned an incomplete item.", 200);
  }
  return {
    id: resource.id,
    kind: attributes.kind,
    ownerId: attributes.owner_id,
    title: attributes.title,
    description: attributes.description || "",
    location: attributes.location || "",
    startsAt: attributes.starts_at,
    endsAt: attributes.ends_at,
    timeZone: attributes.time_zone,
    category: attributes.category || "",
    proofInstructions: attributes.proof_instructions || "",
    pointValue: attributes.point_value ?? null,
    status: attributes.status,
    publishedAt: attributes.published_at || "",
    createdAt: attributes.created_at || "",
    updatedAt: attributes.updated_at || "",
  };
}

// POST /events (organizers only) -> the new event, saved as a draft.
// `event` uses the backend's field names: title, description, location, starts_at,
// ends_at, time_zone and category.
export async function createEvent(event, token) {
  return readItem(await request("/events", { method: "POST", body: event, token }));
}

// GET /items/me (organizers only) -> the signed-in organizer's events and quests,
// drafts included, earliest first.
export async function listMyItems(token) {
  const data = await request("/items/me", { token });
  if (!Array.isArray(data)) {
    throw new ApiError("The server returned an unexpected item list.", 200);
  }
  return data.map(readItem);
}

// PATCH /items/{id} with only the changed fields -> the updated item. Only the item's
// owner may change it, and archived items can't be changed.
export async function updateItem(itemId, changes, token) {
  const resource = await request(`/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: changes,
    token,
  });
  return readItem(resource);
}

// Reads a JSON:API "participants" resource: someone who joined an item.
function readParticipant(resource) {
  const attributes = resource.attributes || {};
  if (typeof resource.id !== "string" || typeof attributes.name !== "string") {
    throw new ApiError("The server returned an incomplete participant.", 200);
  }
  return {
    id: resource.id,
    userId: attributes.user_id,
    name: attributes.name,
    status: attributes.status,
    joinedAt: attributes.joined_at || "",
  };
}

// GET /items/{id}/participants (the item's owner only) -> everyone who joined it.
export async function listParticipants(itemId, token) {
  const data = await request(`/items/${encodeURIComponent(itemId)}/participants`, { token });
  if (!Array.isArray(data)) {
    throw new ApiError("The server returned an unexpected participant list.", 200);
  }
  return data.map(readParticipant);
}

// Error codes the catalogue and participation routes use for a missing or hidden item.
// A 404 without one of them means this backend has no such route.
const ITEM_NOT_FOUND_CODES = ["item_not_found", "not_joined"];

export function isItemNotFound(error) {
  return error?.status === 404 && ITEM_NOT_FOUND_CODES.includes(error.code);
}

export function isMissingRoute(error) {
  return error?.status === 405 || (error?.status === 404 && !isItemNotFound(error));
}

// A readable message, explaining a backend without the needed route instead of showing
// "Not Found".
export function questApiUnavailableMessage(error, action = "load quests") {
  if (isMissingRoute(error)) {
    return (
      `This backend doesn't have the API needed to ${action}. ` +
      "Check that it includes the catalogue and participation routes."
    );
  }
  return error?.message || "Something went wrong.";
}

// POST /quests (organizers only) -> the new quest, saved as a draft.
// `fields` match QuestCreate: point_value, time_zone and time-zone-aware ISO times.
export async function createQuest(fields, token) {
  return readItem(await request("/quests", { method: "POST", body: fields, token }));
}

// GET /items -> one page of published items that haven't ended yet, soonest first.
// `query`: page, pageSize, q (title and description), category (exact, any case), and
// windowStart/windowEnd (ISO instants; an item is kept when it overlaps the window).
// Returns { items, page: { number, size, totalItems, totalPages } }.
export async function listPublishedItems(query, token) {
  const params = new URLSearchParams();
  params.set("page", String(query.page || 1));
  if (query.pageSize) params.set("page_size", String(query.pageSize));
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.windowStart) params.set("window_start", query.windowStart);
  if (query.windowEnd) params.set("window_end", query.windowEnd);

  const document = await request(`/items?${params}`, { token, document: true });
  const page = document.meta && document.meta.page;
  if (!Array.isArray(document.data) || !page || !Number.isInteger(page.total_items)) {
    throw new ApiError("The server returned an unexpected item list.", 200);
  }
  return {
    items: document.data.map(readItem),
    page: {
      number: page.number,
      size: page.size,
      totalItems: page.total_items,
      totalPages: page.total_pages,
    },
  };
}

// GET /items/{id} -> the item's current details. Students only see published items;
// anything else is a 404 with code "item_not_found".
export async function getItem(itemId, token) {
  return readItem(await request(`/items/${encodeURIComponent(itemId)}`, { token }));
}

// POST /items/{id}/publish (the item's owner only) -> the published item.
// 409 "item_already_published" or "item_archived"; 403 "item_not_owned".
export async function publishItem(itemId, token) {
  const path = `/items/${encodeURIComponent(itemId)}/publish`;
  return readItem(await request(path, { method: "POST", token }));
}

// Reads a JSON:API "participations" resource.
function readParticipation(resource) {
  const attributes = resource.attributes || {};
  if (typeof resource.id !== "string" || attributes.item_id == null || !attributes.status) {
    throw new ApiError("The server returned an incomplete participation.", 200);
  }
  return {
    id: resource.id,
    itemId: String(attributes.item_id),
    userId: attributes.user_id,
    status: attributes.status,
    joinedAt: attributes.joined_at || "",
  };
}

// POST /items/{id}/join -> the new participation: joining a quest or RSVPing to an event.
// 409 "already_joined" for a second join; 404 "item_not_found" for a draft or missing item.
export async function joinItem(itemId, token) {
  const path = `/items/${encodeURIComponent(itemId)}/join`;
  return readParticipation(await request(path, { method: "POST", token }));
}

// GET /me/participations -> everything the signed-in user joined or saved, as
// [{ item, participation, saved }]. `participation` is null for an item only saved.
export async function listMyParticipations(token) {
  const data = await request("/me/participations", { token });
  if (!Array.isArray(data)) {
    throw new ApiError("The server returned an unexpected participation list.", 200);
  }
  return data.map((resource) => {
    const participation = resource.attributes && resource.attributes.participation;
    return {
      item: readItem(resource),
      participation: participation
        ? {
            id: String(participation.participation_id),
            itemId: resource.id,
            status: participation.status,
            joinedAt: participation.joined_at || "",
          }
        : null,
      saved: Boolean(resource.attributes && resource.attributes.saved),
    };
  });
}

// Quest client: in-browser sample data when demo mode is explicitly on (dev server only),
// otherwise the live API. Both return the same shapes.
export function getQuestClient(session) {
  if (questsDemoEnabled()) {
    return {
      isDemo: true,
      listPublishedItems: (query) => demoListPublishedItems(query),
      getItem: (itemId) => demoGetItem(itemId),
      listMyItems: () => demoListMyItems(),
      createQuest: (fields) => demoCreateQuest(fields),
      publishItem: (itemId) => demoPublishItem(itemId),
      joinItem: (itemId) => demoJoinItem(itemId, session.userId),
      listMyParticipations: () => demoListMyParticipations(session.userId),
    };
  }

  return {
    isDemo: false,
    listPublishedItems: (query) => listPublishedItems(query, session.token),
    getItem: (itemId) => getItem(itemId, session.token),
    listMyItems: () => listMyItems(session.token),
    createQuest: (fields) => createQuest(fields, session.token),
    publishItem: (itemId) => publishItem(itemId, session.token),
    joinItem: (itemId) => joinItem(itemId, session.token),
    listMyParticipations: () => listMyParticipations(session.token),
  };
}
