// Quest discussions and Quest Grove: demo tab-local prototype (DEV + VITE_DISCUSSIONS_DEMO)
// or live API (VITE_DISCUSSIONS_API). Live mode never falls back to demo on failure.
// See docs/discussion-api-proposal.md for scopes and route shapes.
import { ApiError } from "./api.js";
import {
  demoCreateReply,
  demoCreateThread,
  demoGetThread,
  demoListThreads,
} from "./discussionsDemo.js";

export const QUEST_CATEGORIES = [
  { id: "teammates", label: "Looking for teammates" },
  { id: "help", label: "Help" },
  { id: "tips", label: "Tips" },
  { id: "general", label: "General" },
];

export const GROVE_TOPICS = [
  { id: "campus-life", label: "Campus Life" },
  { id: "quest-help", label: "Quest Help" },
  { id: "team-finder", label: "Team Finder" },
  { id: "ideas", label: "Ideas" },
  { id: "general", label: "General" },
];

export const GROVE_SCOPE = "grove";

/** @deprecated Prefer questActiveScope / questSubmittedScope. Legacy `quest:{id}` maps to submitted. */
export function questScope(itemId) {
  return `quest:${itemId}`;
}

export function questActiveScope(itemId) {
  return `quest:${itemId}:active`;
}

export function questSubmittedScope(itemId) {
  return `quest:${itemId}:submitted`;
}

export const LIMITS = {
  titleMin: 3,
  titleMax: 120,
  bodyMax: 4000,
  replyMax: 2000,
};

export function discussionsPrototypeEnabled() {
  return import.meta.env.DEV === true && import.meta.env.VITE_DISCUSSIONS_DEMO === "true";
}

export function discussionsApiEnabled() {
  return import.meta.env.VITE_DISCUSSIONS_API === "true";
}

export function discussionsMode() {
  if (discussionsPrototypeEnabled()) return "demo";
  if (discussionsApiEnabled()) return "live";
  return "unavailable";
}

const discussionClientCache = new Map();

export function clearDiscussionClientCache() {
  discussionClientCache.clear();
}

function apiBase() {
  return (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
}

/** Maps logical scopes (`grove`, `quest:{id}:active`, `quest:{id}:submitted`) to REST paths. */
export function scopeToThreadsPath(scope) {
  if (scope === "grove") return "/discussions/grove/threads";
  const quest = /^quest:([^:]+):(active|submitted)$/.exec(scope);
  if (quest) return `/discussions/quests/${quest[1]}/spaces/${quest[2]}/threads`;
  const legacy = /^quest:([^:]+)$/.exec(scope);
  if (legacy) return `/discussions/quests/${legacy[1]}/spaces/submitted/threads`;
  throw new ApiError(`Unknown discussion scope: ${scope}`, 422, {}, "validation_error");
}

async function liveDocument(path, { method = "GET", body, token } = {}) {
  const base = apiBase();
  if (!base) {
    throw new ApiError("The API URL is not configured.", 0, {}, "api_not_configured");
  }
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(base + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      `Couldn't get a response from the server at ${base}. Check that the backend is running.`,
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
    const errors = data?.errors || [];
    throw new ApiError(
      errors.map((error) => error.detail || error.title).filter(Boolean).join(" ") ||
        `Unexpected error (${response.status}).`,
      response.status,
      {},
      errors[0]?.code || ""
    );
  }
  if (!data || !("data" in data)) {
    throw new ApiError("The server returned an unexpected response.", response.status);
  }
  return { data: data.data, meta: data.meta || null };
}

function mapThread(resource) {
  const attributes = resource.attributes || resource;
  return {
    id: String(resource.id),
    scope: attributes.scope,
    title: attributes.title,
    category: attributes.category,
    body: attributes.body,
    author: attributes.author,
    createdAt: attributes.created_at,
    replyCount: attributes.reply_count ?? 0,
  };
}

function mapReply(resource) {
  const attributes = resource.attributes || resource;
  return {
    id: String(resource.id),
    threadId: String(attributes.thread_id),
    body: attributes.body,
    author: attributes.author,
    createdAt: attributes.created_at,
  };
}

function liveDiscussionClient(author) {
  const token = author.token;
  return {
    isPrototype: false,
    async listThreads(scope) {
      const path = scopeToThreadsPath(scope);
      const { data } = await liveDocument(path, { token });
      return (Array.isArray(data) ? data : []).map(mapThread);
    },
    async getThread(threadId) {
      const { data, meta } = await liveDocument(
        `/discussions/threads/${encodeURIComponent(threadId)}`,
        { token }
      );
      const replies = (meta?.replies || []).map(mapReply);
      return { thread: mapThread(data), replies };
    },
    async createThread(scope, fields) {
      const path = scopeToThreadsPath(scope);
      const { data } = await liveDocument(path, {
        method: "POST",
        token,
        body: {
          title: fields.title,
          category: fields.category,
          body: fields.body,
        },
      });
      return mapThread(data);
    },
    async createReply(threadId, fields) {
      const { data } = await liveDocument(
        `/discussions/threads/${encodeURIComponent(threadId)}/replies`,
        {
          method: "POST",
          token,
          body: { body: fields.body },
        }
      );
      return mapReply(data);
    },
  };
}

// `author` is { id, name, token? }. Demo uses id/name only; live requires token.
export function getDiscussionClient(author) {
  if (discussionsPrototypeEnabled()) {
    if (!author?.id) return null;
    const key = `demo|${author.id}`;
    const cached = discussionClientCache.get(key);
    if (cached) return cached;
    const client = {
      isPrototype: true,
      listThreads: (scope) => demoListThreads(scope),
      getThread: (threadId) => demoGetThread(threadId),
      createThread: (scope, fields) => demoCreateThread(scope, fields, author),
      createReply: (threadId, fields) => demoCreateReply(threadId, fields, author),
    };
    discussionClientCache.set(key, client);
    return client;
  }
  if (!discussionsApiEnabled()) return null;
  if (!author?.id || !author?.token) return null;
  const key = `live|${author.id}|${author.token}`;
  const cached = discussionClientCache.get(key);
  if (cached) return cached;
  const client = liveDiscussionClient(author);
  discussionClientCache.set(key, client);
  if (discussionClientCache.size > 24) {
    const oldest = discussionClientCache.keys().next().value;
    discussionClientCache.delete(oldest);
  }
  return client;
}

export function categoryLabel(categories, id) {
  return categories.find((category) => category.id === id)?.label || id;
}

// Problems with a new discussion, by field. Empty when it can be posted.
export function validateThread({ title, category, body }, categories) {
  const errors = {};
  const trimmedTitle = title.trim();
  if (trimmedTitle.length < LIMITS.titleMin) {
    errors.title = `Give it a title of at least ${LIMITS.titleMin} characters.`;
  } else if (trimmedTitle.length > LIMITS.titleMax) {
    errors.title = `Keep the title under ${LIMITS.titleMax + 1} characters.`;
  }
  if (!categories.some((option) => option.id === category)) {
    errors.category = "Choose a category.";
  }
  if (!body.trim()) {
    errors.body = "Write a message.";
  } else if (body.length > LIMITS.bodyMax) {
    errors.body = `Keep the message under ${LIMITS.bodyMax + 1} characters.`;
  }
  return errors;
}

export function validateReply(body) {
  if (!body.trim()) return "Write a reply.";
  if (body.length > LIMITS.replyMax) return `Keep replies under ${LIMITS.replyMax + 1} characters.`;
  return "";
}

// Threads matching a search (title or message, any case) and a category, newest first.
// The tree and the list both use this, so they always show the same discussions.
export function filterThreads(threads, { query = "", category = "" } = {}) {
  const needle = query.trim().toLowerCase();
  return threads
    .filter((thread) => !category || thread.category === category)
    .filter(
      (thread) =>
        !needle ||
        thread.title.toLowerCase().includes(needle) ||
        thread.body.toLowerCase().includes(needle)
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
}

export function excerpt(text, length = 110) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1).trimEnd()}…` : flat;
}

const PROOF_STATUSES = new Set(["pending", "approved", "rejected"]);

/**
 * Resolve membership vs confirmed proof for discussion gating.
 * `proofSubmission` is authoritative when loaded from the proof client.
 * Otherwise participation.status of pending/approved/rejected is treated as proof phase
 * (demo + current My Quests model). Join-gate-only pending without a proof record is rare.
 */
export function resolveQuestDiscussionPhase(participation, participationStatus, proofSubmission) {
  if (proofSubmission && PROOF_STATUSES.has(proofSubmission.status)) {
    return {
      member: true,
      proofStatus: proofSubmission.status,
      phase: "submitted",
    };
  }
  if (participation && PROOF_STATUSES.has(participation.status)) {
    return {
      member: true,
      proofStatus: participation.status,
      phase: "submitted",
    };
  }
  if (participation?.status === "joined") {
    return { member: true, proofStatus: null, phase: "active" };
  }
  if (participationStatus === "loading") {
    return { member: false, proofStatus: null, phase: "checking" };
  }
  if (participationStatus === "error") {
    return { member: false, proofStatus: null, phase: "unknown" };
  }
  return { member: false, proofStatus: null, phase: "not-joined" };
}

/** Active-participant space: joined, no confirmed proof submission. */
export function questActiveDiscussionAccess(
  participation,
  participationStatus,
  proofSubmission = null
) {
  const resolved = resolveQuestDiscussionPhase(
    participation,
    participationStatus,
    proofSubmission
  );
  if (resolved.phase === "active") return { allowed: true };
  if (resolved.phase === "submitted") {
    return {
      allowed: false,
      reason: "submitted",
      message:
        "You've submitted proof for this quest, so the active discussion is closed. " +
        "Use the after-submission space — spoilers may appear there.",
    };
  }
  if (resolved.phase === "checking") {
    return { allowed: false, reason: "checking", message: "Checking whether you've joined…" };
  }
  if (resolved.phase === "unknown") {
    return {
      allowed: false,
      reason: "unknown",
      message:
        "We couldn't confirm that you've joined this quest, so the discussion is hidden for " +
        "now. Reload to try again.",
    };
  }
  return {
    allowed: false,
    reason: "not-joined",
    message:
      "Only students who joined this quest can read and post here. Join the quest to take part.",
  };
}

/** After-submission space (spoilers allowed), including while Pending review. */
export function questSubmittedDiscussionAccess(
  participation,
  participationStatus,
  proofSubmission = null
) {
  const resolved = resolveQuestDiscussionPhase(
    participation,
    participationStatus,
    proofSubmission
  );
  if (resolved.phase === "submitted") return { allowed: true };
  if (resolved.phase === "active") {
    return {
      allowed: false,
      reason: "not-submitted",
      message:
        "This space unlocks after you submit proof. It may contain spoilers about completing the quest.",
    };
  }
  if (resolved.phase === "checking") {
    return { allowed: false, reason: "checking", message: "Checking whether you've joined…" };
  }
  if (resolved.phase === "unknown") {
    return {
      allowed: false,
      reason: "unknown",
      message:
        "We couldn't confirm your participation, so this discussion is hidden for now. Reload to try again.",
    };
  }
  return {
    allowed: false,
    reason: "not-joined",
    message: "Join this quest and submit proof to open the after-submission discussion.",
  };
}

/** @deprecated Use questActiveDiscussionAccess / questSubmittedDiscussionAccess. */
export function questDiscussionAccess(participation, participationStatus) {
  return questActiveDiscussionAccess(participation, participationStatus, null);
}

export function formatPostTime(iso) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso)
  );
}
