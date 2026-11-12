import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const fetchSpy = vi.fn();

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchSpy);
  sessionStorage.clear();
  await resetDemoQuests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Quest demo store", () => {
  it("seeds published quests and events, plus a draft", async () => {
    const { items, page } = await demoListPublishedItems({ page: 1, pageSize: 12 });
    const mine = await demoListMyItems();

    expect(items.map((item) => item.title)).toContain("Gallery opening night");
    expect(items.some((item) => item.kind === "event")).toBe(true);
    expect(items.every((item) => item.status === "published")).toBe(true);
    expect(page.totalItems).toBe(items.length);
    expect(mine.some((item) => item.status === "draft")).toBe(true);
  });

  it("pages and filters the whole demo catalogue like the backend", async () => {
    const first = await demoListPublishedItems({ page: 1, pageSize: 3 });
    const second = await demoListPublishedItems({ page: 2, pageSize: 3 });
    expect(first.page.totalPages).toBe(Math.ceil(first.page.totalItems / 3));
    expect(first.items.map((item) => item.id)).not.toEqual(
      expect.arrayContaining(second.items.map((item) => item.id))
    );

    const social = await demoListPublishedItems({ page: 1, pageSize: 12, category: "social" });
    expect(social.items.map((item) => item.title).sort()).toEqual([
      "Neighborhood food walk",
      "Open mic",
    ]);
  });

  it("creates, publishes, joins, and restores joined status without touching the network", async () => {
    const created = await demoCreateQuest({
      title: "New demo quest",
      description: "Details",
      location: "Library",
      starts_at: "2099-10-20T12:00:00.000Z",
      ends_at: "2099-10-20T14:00:00.000Z",
      time_zone: "Europe/Paris",
      category: "Culture",
      proof_instructions: "Photo",
      point_value: 10,
    });
    expect(created).toMatchObject({ kind: "quest", status: "draft", pointValue: 10 });
    await expect(demoGetItem(created.id)).rejects.toMatchObject({ code: "item_not_found" });

    expect((await demoPublishItem(created.id)).status).toBe("published");
    await expect(demoPublishItem(created.id)).rejects.toMatchObject({
      status: 409,
      code: "item_already_published",
    });

    await demoJoinItem(created.id, "user-7");
    const participations = await demoListMyParticipations("user-7");
    expect(participations.map((entry) => entry.item.id)).toContain(created.id);
    expect(participations[0].participation.status).toBe("joined");

    await expect(demoJoinItem(created.id, "user-7")).rejects.toMatchObject({
      status: 409,
      code: "already_joined",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resets only demo data", async () => {
    const before = (await demoListPublishedItems({})).page.totalItems;
    await demoJoinItem("demo-1", "user-7");
    await resetDemoQuests();
    expect(await demoListMyParticipations("user-7")).toEqual([]);
    expect((await demoListPublishedItems({})).page.totalItems).toBe(before);
  });
});
