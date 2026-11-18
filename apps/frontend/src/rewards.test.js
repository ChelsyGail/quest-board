import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRewardsClientCache,
  eligibilityLabel,
  getRewardsClient,
  rewardsMode,
} from "./rewards.js";
import { demoAwardPoints, resetDemoRewards } from "./rewardsDemo.js";

describe("rewards helpers", () => {
  it("labels eligibility states", () => {
    expect(eligibilityLabel("eligible")).toBe("Eligible");
    expect(eligibilityLabel("claimed")).toBe("Claimed");
    expect(eligibilityLabel("insufficient_points")).toMatch(/points/i);
  });
});

describe("rewards demo adapter", () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetDemoRewards();
    clearRewardsClientCache();
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_REWARDS_DEMO", "true");
    vi.stubEnv("VITE_REWARDS_API", "false");
  });

  it("stays unavailable without the demo flag", () => {
    vi.stubEnv("VITE_REWARDS_DEMO", "false");
    clearRewardsClientCache();
    expect(rewardsMode()).toBe("unavailable");
    expect(getRewardsClient({ userId: "1", token: "t" })).toBeNull();
  });

  it("keeps client identity stable for the same session", () => {
    const session = { userId: "42", token: "tok" };
    expect(getRewardsClient(session)).toBe(getRewardsClient(session));
  });

  it("claims only when the server-side demo ledger says eligible", async () => {
    const session = { userId: "42", token: "tok" };
    const client = getRewardsClient(session);
    let rewards = (await client.listRewards()).items;
    const sticker = rewards.find((reward) => reward.id === "r2");
    expect(sticker.eligibility).toBe("insufficient_points");

    demoAwardPoints("42", 20, { badgeName: "Starter" });
    rewards = (await client.listRewards()).items;
    expect(rewards.find((reward) => reward.id === "r2").eligibility).toBe("eligible");

    const claimed = await client.claimReward("r2");
    expect(claimed.reward.claimed).toBe(true);
    expect(claimed.achievements.spendablePoints).toBe(5);

    await expect(client.claimReward("r2")).rejects.toMatchObject({ code: "already_claimed" });
  });

  it("lets an organizer create a reward and list claims", async () => {
    const session = { userId: "org-1", token: "tok" };
    const client = getRewardsClient(session);
    const created = await client.createReward({
      title: "Extra muffin",
      description: "One muffin from the café.",
      costPoints: 10,
      requirements: "10 points",
      requiresApprovedQuest: false,
    });
    expect(created.title).toBe("Extra muffin");
    const mine = await client.listMyRewards();
    expect(mine.some((reward) => reward.id === created.id)).toBe(true);

    demoAwardPoints("org-1", 10);
    await client.claimReward(created.id);
    const claims = await client.listClaims(created.id);
    expect(claims).toHaveLength(1);
  });
});
