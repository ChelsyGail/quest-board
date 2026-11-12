// Achievements and rewards client. See docs/rewards-api-proposal.md.
// Usable UI requires VITE_REWARDS_DEMO=true on DEV, or VITE_REWARDS_API=true once the
// backend exists. Never falls back to demo after a live failure.
import { ApiError } from "./api.js";
import {
  demoClaimReward,
  demoCreateReward,
  demoGetAchievements,
  demoListMyRewards,
  demoListRewardClaims,
  demoListRewards,
  resetDemoRewards,
} from "./rewardsDemo.js";

export { resetDemoRewards };

export function rewardsDemoEnabled() {
  return import.meta.env.DEV === true && import.meta.env.VITE_REWARDS_DEMO === "true";
}

export function rewardsApiEnabled() {
  return import.meta.env.VITE_REWARDS_API === "true";
}

export function rewardsMode() {
  if (rewardsDemoEnabled()) return "demo";
  if (rewardsApiEnabled()) return "live";
  return "unavailable";
}

function apiBase() {
  return (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
}

async function liveJson(path, { method = "GET", body, token } = {}) {
  const base = apiBase();
  if (!base) throw new ApiError("The API URL is not configured.", 0, {}, "api_not_configured");
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
  if (!data?.data) throw new ApiError("Unexpected response.", response.status);
  return data.data;
}

function mapAchievements(resource) {
  const a = resource.attributes || resource;
  return {
    earnedPoints: a.earned_points ?? a.earnedPoints ?? 0,
    spendablePoints: a.spendable_points ?? a.spendablePoints ?? 0,
    badges: (a.badges || []).map((badge) => ({
      id: String(badge.id),
      name: badge.name,
      description: badge.description || "",
      earnedAt: badge.earned_at || badge.earnedAt || null,
    })),
  };
}

function mapReward(resource) {
  const a = resource.attributes || resource;
  return {
    id: String(resource.id ?? a.id),
    title: a.title,
    description: a.description || "",
    costPoints: a.cost_points ?? a.costPoints ?? 0,
    requirements: a.requirements || "",
    eligibility: a.eligibility || "unavailable",
    claimed: Boolean(a.claimed),
    ownerId: a.owner_id != null ? String(a.owner_id) : a.ownerId,
  };
}

export function eligibilityLabel(eligibility) {
  switch (eligibility) {
    case "eligible":
      return "Eligible";
    case "insufficient_points":
      return "Not enough points";
    case "requirements_unmet":
      return "Requirements not met";
    case "claimed":
      return "Claimed";
    default:
      return "Unavailable";
  }
}

function liveClient(token) {
  return {
    isDemo: false,
    async getAchievements() {
      return mapAchievements(await liveJson("/me/achievements", { token }));
    },
    async listRewards() {
      const data = await liveJson("/rewards", { token });
      return (Array.isArray(data) ? data : [data]).map(mapReward);
    },
    async claimReward(id) {
      const data = await liveJson(`/rewards/${id}/claim`, { method: "POST", token });
      return {
        reward: mapReward(data.reward ? { id: data.reward.id, attributes: data.reward } : data),
        achievements: mapAchievements(data.achievements || data),
      };
    },
    async createReward(fields) {
      return mapReward(
        await liveJson("/rewards", {
          method: "POST",
          token,
          body: {
            title: fields.title,
            description: fields.description,
            cost_points: fields.costPoints,
            requirements: fields.requirements,
          },
        })
      );
    },
    async listMyRewards() {
      const data = await liveJson("/rewards/me", { token });
      return (Array.isArray(data) ? data : [data]).map(mapReward);
    },
    async listClaims(rewardId) {
      const data = await liveJson(`/rewards/${rewardId}/claims`, { token });
      const list = Array.isArray(data) ? data : [data];
      return list.map((entry) => {
        const a = entry.attributes || entry;
        return {
          userId: String(a.user_id ?? a.userId),
          name: a.name,
          claimedAt: a.claimed_at || a.claimedAt,
        };
      });
    },
  };
}

function demoClient(session) {
  return {
    isDemo: true,
    getAchievements: () => demoGetAchievements(session.userId),
    listRewards: () => demoListRewards(session.userId),
    claimReward: (id) => demoClaimReward(id, session.userId),
    createReward: (fields) => demoCreateReward(fields, session.userId),
    listMyRewards: () => demoListMyRewards(session.userId),
    listClaims: (rewardId) => demoListRewardClaims(rewardId, session.userId),
  };
}

// Same session + mode must yield the same object so effect deps keyed on `client`
// do not re-fire on every render (that caused the Rewards loading flicker).
const rewardsClientCache = new Map();

export function clearRewardsClientCache() {
  rewardsClientCache.clear();
}

export function getRewardsClient(session) {
  if (!session?.userId || !session?.token) return null;
  const mode = rewardsMode();
  if (mode === "unavailable") return null;
  const key = `${mode}|${session.userId}|${session.token}`;
  const cached = rewardsClientCache.get(key);
  if (cached) return cached;
  const client = mode === "demo" ? demoClient(session) : liveClient(session.token);
  rewardsClientCache.set(key, client);
  if (rewardsClientCache.size > 24) {
    const oldest = rewardsClientCache.keys().next().value;
    rewardsClientCache.delete(oldest);
  }
  return client;
}

export function rewardsUnavailableMessage() {
  return "Achievements and rewards aren't available on this server yet.";
}
