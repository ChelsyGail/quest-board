// Discussions are a frontend prototype: there is no discussion API yet (see
// docs/discussion-api-proposal.md). The sample adapter only runs on the dev server with
// VITE_DISCUSSIONS_DEMO=true. Otherwise there is no discussion client at all and the pages
// say so; they never fall back to sample data.
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

export function questScope(itemId) {
  return `quest:${itemId}`;
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

// The sample adapter in prototype mode, otherwise null: nothing to read or post to yet.
// `author` is { id, name } of the signed-in user, used for posts made in this tab.
export function getDiscussionClient(author) {
  if (!discussionsPrototypeEnabled()) return null;
  return {
    isPrototype: true,
    listThreads: (scope) => demoListThreads(scope),
    getThread: (threadId) => demoGetThread(threadId),
    createThread: (scope, fields) => demoCreateThread(scope, fields, author),
    createReply: (threadId, fields) => demoCreateReply(threadId, fields, author),
  };
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

// Whether the student may read and post in a quest's discussion, from their participation.
// The real check has to happen on the server: this only decides what the page offers.
// `participationStatus` is the load status of GET /me/participations.
export function questDiscussionAccess(participation, participationStatus) {
  if (participation && ["joined", "approved"].includes(participation.status)) {
    return { allowed: true };
  }
  if (participation?.status === "pending") {
    return {
      allowed: false,
      reason: "pending",
      message:
        "Your place on this quest is waiting for the organizer's approval. The discussion " +
        "opens once you're approved.",
    };
  }
  if (participation?.status === "rejected") {
    return {
      allowed: false,
      reason: "rejected",
      message: "The organizer didn't approve your participation, so the discussion is closed to you.",
    };
  }
  if (participationStatus === "loading") {
    return { allowed: false, reason: "checking", message: "Checking whether you've joined…" };
  }
  if (participationStatus === "error") {
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
    message: "Only students who joined this quest can read and post in its discussion. Join the quest to take part.",
  };
}

export function formatPostTime(iso) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso)
  );
}
