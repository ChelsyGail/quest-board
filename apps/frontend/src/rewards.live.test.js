import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRewardsClientCache,
  getRewardsClient,
  rewardsMode,
} from "./rewards.js";

describe("live rewards adapter", () => {
  beforeEach(() => {
    clearRewardsClientCache();
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_REWARDS_DEMO", "false");
    vi.stubEnv("VITE_REWARDS_API", "true");
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
  });

  afterEach(() => {
    clearRewardsClientCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses /users/me/achievements and live field names", async () => {
    expect(rewardsMode()).toBe("live");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        expect(url).toBe("http://api.test/users/me/achievements");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              type: "achievements",
              id: "7",
              attributes: {
                total_points: 40,
                available_points: 25,
                badges: [
                  {
                    badge_id: "3",
                    name: "First quest",
                    description: "Done",
                    awarded_at: "2026-11-18T12:00:00Z",
                  },
                ],
                completed_quests: [],
              },
            },
          }),
        };
      })
    );
    const client = getRewardsClient({ token: "tok", userId: "7" });
    const achievements = await client.getAchievements();
    expect(achievements.totalPoints).toBe(40);
    expect(achievements.availablePoints).toBe(25);
    expect(achievements.badges[0].badgeId).toBe("3");
  });

  it("claims via POST /rewards/{id}/claims then reloads catalogue", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (String(url).endsWith("/rewards/9/claims") && options.method === "POST") {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            data: {
              type: "reward-claims",
              id: "1",
              attributes: {
                reward_id: "9",
                user_id: "7",
                points_spent: 10,
                claimed_at: "2026-11-18T12:00:00Z",
                available_points: 15,
              },
            },
          }),
        };
      }
      if (String(url).includes("/users/me/achievements")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              type: "achievements",
              id: "7",
              attributes: {
                total_points: 40,
                available_points: 15,
                badges: [],
                completed_quests: [],
              },
            },
          }),
        };
      }
      if (String(url).endsWith("/rewards/9") && (!options.method || options.method === "GET")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              type: "rewards",
              id: "9",
              attributes: {
                owner_id: "2",
                name: "Coffee",
                description: "A cup",
                eligibility: { type: "none" },
                point_cost: 10,
                viewer: { eligible: false, claimed: true, missing: [], progress: null },
                created_at: "2026-11-18T10:00:00Z",
                updated_at: "2026-11-18T10:00:00Z",
              },
            },
          }),
        };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = getRewardsClient({ token: "tok", userId: "7" });
    const result = await client.claimReward("9");
    expect(result.claim.pointsSpent).toBe(10);
    expect(result.reward.claimed).toBe(true);
    expect(result.achievements.availablePoints).toBe(15);
    expect(fetchMock.mock.calls.some(([url, opts]) => String(url).endsWith("/claims") && opts?.method === "POST")).toBe(
      true
    );
    expect(fetchMock.mock.calls.some(([url, opts]) => String(url).endsWith("/rewards/9") && (!opts?.method || opts.method === "GET"))).toBe(
      true
    );
  });

  it("surfaces uncertain claims as network errors so the page can refresh balances", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      })
    );
    const client = getRewardsClient({ token: "tok", userId: "7" });
    await expect(client.claimReward("9")).rejects.toMatchObject({
      status: 0,
      resultUnknown: true,
    });
  });

  it("lists organizer rewards by paging /rewards without calling /rewards/me", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        expect(String(url)).toContain("/rewards?");
        expect(String(url)).not.toContain("/rewards/me");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                type: "rewards",
                id: "1",
                attributes: {
                  owner_id: "7",
                  name: "Mine",
                  eligibility: { type: "none" },
                  point_cost: 5,
                  created_at: "2026-11-18T10:00:00Z",
                  updated_at: "2026-11-18T10:00:00Z",
                },
              },
              {
                type: "rewards",
                id: "2",
                attributes: {
                  owner_id: "99",
                  name: "Theirs",
                  eligibility: { type: "none" },
                  point_cost: 5,
                  created_at: "2026-11-18T10:00:00Z",
                  updated_at: "2026-11-18T10:00:00Z",
                },
              },
            ],
            meta: { page: { number: 1, size: 100, total_items: 2, total_pages: 1 } },
          }),
        };
      })
    );
    const client = getRewardsClient({ token: "tok", userId: "7" });
    const mine = await client.listMyRewards();
    expect(mine.map((reward) => reward.id)).toEqual(["1"]);
  });
});
