import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GROVE_TOPICS,
  QUEST_CATEGORIES,
  discussionsPrototypeEnabled,
  filterThreads,
  getDiscussionClient,
  questDiscussionAccess,
  validateReply,
  validateThread,
} from "./discussions.js";
import {
  demoCreateReply,
  demoCreateThread,
  demoGetThread,
  demoListThreads,
} from "./discussionsDemo.js";
import { GROVE_HEIGHT, GROVE_WIDTH, LEAVES_PER_BRANCH, branchSlots, groveLayout } from "./groveLayout.js";

const AUTHOR = { id: "7", name: "Sam" };

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("discussion prototype switch", () => {
  it("is off unless the dev server runs with VITE_DISCUSSIONS_DEMO=true", () => {
    expect(discussionsPrototypeEnabled()).toBe(false);
    expect(getDiscussionClient(AUTHOR)).toBeNull();

    vi.stubEnv("VITE_DISCUSSIONS_DEMO", "true");
    expect(discussionsPrototypeEnabled()).toBe(true);
    expect(getDiscussionClient(AUTHOR)).toMatchObject({ isPrototype: true });

    // A production build has DEV=false: no sample discussions, whatever the flag says.
    vi.stubEnv("DEV", false);
    expect(discussionsPrototypeEnabled()).toBe(false);
    expect(getDiscussionClient(AUTHOR)).toBeNull();
  });
});

describe("quest discussion access", () => {
  const participation = (status) => ({ id: "p1", itemId: "1", status });

  it("lets in joined and approved students only", () => {
    expect(questDiscussionAccess(participation("joined"), "loaded").allowed).toBe(true);
    expect(questDiscussionAccess(participation("approved"), "loaded").allowed).toBe(true);
    expect(questDiscussionAccess(participation("pending"), "loaded")).toMatchObject({
      allowed: false,
      reason: "pending",
    });
    expect(questDiscussionAccess(participation("rejected"), "loaded")).toMatchObject({
      allowed: false,
      reason: "rejected",
    });
    expect(questDiscussionAccess(undefined, "loaded")).toMatchObject({
      allowed: false,
      reason: "not-joined",
    });
  });

  it("stays closed while membership is unknown", () => {
    expect(questDiscussionAccess(undefined, "loading").allowed).toBe(false);
    expect(questDiscussionAccess(undefined, "error")).toMatchObject({
      allowed: false,
      reason: "unknown",
    });
  });
});

describe("validation and filtering", () => {
  it("checks title, category and message lengths", () => {
    expect(validateThread({ title: "Hi", category: "", body: " " }, QUEST_CATEGORIES)).toEqual({
      title: expect.stringContaining("at least 3"),
      category: "Choose a category.",
      body: "Write a message.",
    });
    expect(
      validateThread({ title: "x".repeat(121), category: "help", body: "y".repeat(4001) }, QUEST_CATEGORIES)
    ).toEqual({ title: expect.any(String), body: expect.any(String) });
    expect(validateThread({ title: "Bring water?", category: "help", body: "Yes" }, QUEST_CATEGORIES)).toEqual({});
    expect(validateReply("   ")).toBe("Write a reply.");
    expect(validateReply("z".repeat(2001))).toMatch(/under 2001/);
    expect(validateReply("Thanks!")).toBe("");
  });

  it("filters by search and category, newest first", () => {
    const threads = [
      { id: "1", title: "Study spots", body: "Quiet rooms", category: "campus-life", createdAt: "2026-11-01T10:00:00Z" },
      { id: "2", title: "Team for hike", body: "Two seats", category: "team-finder", createdAt: "2026-11-03T10:00:00Z" },
      { id: "3", title: "Quiet cafés", body: "With outlets", category: "campus-life", createdAt: "2026-11-02T10:00:00Z" },
    ];
    expect(filterThreads(threads).map((t) => t.id)).toEqual(["2", "3", "1"]);
    expect(filterThreads(threads, { query: "QUIET" }).map((t) => t.id)).toEqual(["3", "1"]);
    expect(filterThreads(threads, { query: "quiet", category: "team-finder" })).toEqual([]);
    expect(filterThreads(threads, { category: "campus-life" }).map((t) => t.id)).toEqual(["3", "1"]);
  });
});

describe("sample discussion adapter", () => {
  it("keeps scopes apart, marks samples, and stores posts and replies in this tab", async () => {
    const grove = await demoListThreads("grove");
    const quest = await demoListThreads("quest:1");
    expect(grove.length).toBeGreaterThan(20);
    expect(grove.every((thread) => thread.sample && thread.scope === "grove")).toBe(true);
    expect(quest.every((thread) => thread.scope === "quest:1")).toBe(true);

    const created = await demoCreateThread(
      "quest:1",
      { title: "Meet at 9?", category: "teammates", body: "<b>bold</b>" },
      AUTHOR
    );
    expect(created).toMatchObject({ sample: false, author: AUTHOR, replyCount: 0, body: "<b>bold</b>" });
    await demoCreateReply(created.id, { body: "Sure" }, AUTHOR);
    const { thread, replies } = await demoGetThread(created.id);
    expect(thread.replyCount).toBe(1);
    expect(replies.map((reply) => reply.body)).toEqual(["Sure"]);
    expect((await demoListThreads("quest:2")).some((t) => t.id === created.id)).toBe(false);

    await expect(demoCreateReply(created.id, { body: " " }, AUTHOR)).rejects.toMatchObject({ status: 422 });
    await expect(demoGetThread("nope")).rejects.toMatchObject({ status: 404 });
  });
});

describe("grove layout", () => {
  const thread = (id, category, day) => ({
    id,
    category,
    title: id,
    body: "",
    createdAt: `2026-10-${String(day).padStart(2, "0")}T10:00:00Z`,
  });

  it("never overlaps leaves and keeps them inside the tree", () => {
    const slots = GROVE_TOPICS.flatMap((topic) => branchSlots(topic.id));
    expect(slots).toHaveLength(GROVE_TOPICS.length * LEAVES_PER_BRANCH);
    for (const [index, a] of slots.entries()) {
      expect(a.x).toBeGreaterThan(40);
      expect(a.x).toBeLessThan(GROVE_WIDTH - 40);
      expect(a.y).toBeGreaterThan(40);
      expect(a.y).toBeLessThan(GROVE_HEIGHT - 40);
      for (const b of slots.slice(index + 1)) {
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(60);
      }
    }
  });

  it("shows a bounded, stable set of the newest discussions per branch", () => {
    const threads = filterThreads(
      Array.from({ length: 9 }, (_, i) => thread(`c${i}`, "campus-life", i + 1)).concat(
        thread("g1", "general", 3)
      )
    );
    const layout = groveLayout(threads, GROVE_TOPICS);
    const campus = layout.find((branch) => branch.topic.id === "campus-life");
    expect(campus.leaves.map((leaf) => leaf.thread.id)).toEqual(["c3", "c4", "c5", "c6", "c7", "c8"]);
    expect(campus.hidden).toBe(3);
    expect(layout.find((branch) => branch.topic.id === "general").leaves).toHaveLength(1);
    expect(groveLayout(threads, GROVE_TOPICS)).toEqual(layout);
  });
});
