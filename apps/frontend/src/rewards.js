// Achievements and rewards client — live routes under /users/me/achievements and /rewards.
// Never falls back to demo after a live failure.
import { ApiError, normalizePageMeta } from "./api.js";
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

export const REWARD_RULE_TYPES = [
  { value: "none", label: "Anyone eligible" },
  { value: "approved_quests", label: "Approved quests (count)" },
  { value: "total_points", label: "Total points earned" },
  { value: "category_quests", label: "Approved quests in a category" },
  { value: "quest_completed", label: "Specific quest completed" },
];

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

async function liveDocument(path, { method = "GET", body, token } = {}) {
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
  if (!data || !("data" in data)) throw new ApiError("Unexpected response.", response.status);
  return { data: data.data, meta: data.meta || null };
}

async function liveJson(path, options) {
  return (await liveDocument(path, options)).data;
}

function mapAchievements(resource) {
  const a = resource.attributes || resource;
  return {
    // Prefer live field names; keep legacy aliases for demo/UI.
    totalPoints: a.total_points ?? a.earned_points ?? a.earnedPoints ?? 0,
    availablePoints: a.available_points ?? a.spendable_points ?? a.spendablePoints ?? 0,
    earnedPoints: a.total_points ?? a.earned_points ?? a.earnedPoints ?? 0,
    spendablePoints: a.available_points ?? a.spendable_points ?? a.spendablePoints ?? 0,
    badges: (a.badges || []).map((badge) => ({
      id: String(badge.badge_id ?? badge.id ?? ""),
      badgeId: String(badge.badge_id ?? badge.id ?? ""),
      name: badge.name,
      description: badge.description || "",
      earnedAt: badge.awarded_at || badge.earned_at || badge.earnedAt || null,
      awardedAt: badge.awarded_at || badge.earned_at || badge.earnedAt || null,
    })),
    completedQuests: (a.completed_quests || a.completedQuests || []).map((quest) => ({
      itemId: String(quest.item_id ?? quest.itemId ?? ""),
      title: quest.title || "",
      category: quest.category || "",
      points: quest.points ?? 0,
      approvedAt: quest.approved_at || quest.approvedAt || null,
    })),
  };
}

function viewerEligibility(viewer) {
  if (!viewer) return "unavailable";
  if (viewer.claimed) return "claimed";
  if (viewer.eligible) return "eligible";
  return "requirements_unmet";
}

function mapReward(resource) {
  const a = resource.attributes || resource;
  const viewer = a.viewer || null;
  const eligibilityRule = a.eligibility || null;
  return {
    id: String(resource.id ?? a.id),
    title: a.name || a.title || "",
    name: a.name || a.title || "",
    description: a.description || "",
    costPoints: a.point_cost ?? a.cost_points ?? a.costPoints ?? 0,
    pointCost: a.point_cost ?? a.cost_points ?? a.costPoints ?? 0,
    requirements: formatEligibilityRule(eligibilityRule),
    eligibilityRule,
    eligibility: viewerEligibility(viewer),
    claimed: Boolean(viewer?.claimed),
    missing: viewer?.missing || [],
    progress: viewer?.progress || null,
    ownerId: a.owner_id != null ? String(a.owner_id) : a.ownerId != null ? String(a.ownerId) : "",
    createdAt: a.created_at || null,
    updatedAt: a.updated_at || null,
  };
}

function mapClaim(resource) {
  const a = resource.attributes || resource;
  return {
    id: String(resource.id ?? ""),
    rewardId: a.reward_id != null ? String(a.reward_id) : "",
    userId: a.user_id != null ? String(a.user_id) : "",
    name: a.claimant_name || a.name || "",
    claimantName: a.claimant_name || a.name || "",
    pointsSpent: a.points_spent ?? null,
    claimedAt: a.claimed_at || a.claimedAt || null,
    availablePoints: a.available_points ?? null,
  };
}

export function formatEligibilityRule(rule) {
  if (!rule || !rule.type || rule.type === "none") return "Open to eligible students";
  if (rule.type === "approved_quests") return `${rule.threshold} approved quests`;
  if (rule.type === "total_points") return `${rule.threshold} total points`;
  if (rule.type === "category_quests") {
    return `${rule.threshold} approved ${rule.category || "category"} quests`;
  }
  if (rule.type === "quest_completed") return `Complete quest #${rule.quest_id}`;
  return String(rule.type);
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

function buildEligibilityPayload(fields) {
  const type = fields.ruleType || fields.eligibility?.type || "none";
  const rule = { type };
  if (type === "approved_quests" || type === "total_points" || type === "category_quests") {
    rule.threshold = Number(fields.threshold);
  }
  if (type === "category_quests") rule.category = fields.category;
  if (type === "quest_completed") rule.quest_id = Number(fields.questId);
  return rule;
}

async function listAllRewardPages(token, { ownerId = null } = {}) {
  const collected = [];
  let page = 1;
  let totalPages = 1;
  do {
    const document = await liveDocument(`/rewards?page=${page}&page_size=100`, { token });
    const batch = Array.isArray(document.data) ? document.data : document.data ? [document.data] : [];
    for (const resource of batch) {
      const mapped = mapReward(resource);
      if (!ownerId || mapped.ownerId === String(ownerId)) collected.push(mapped);
    }
    totalPages = document.meta?.page?.total_pages ?? document.meta?.page?.totalPages ?? 1;
    page += 1;
  } while (page <= totalPages);
  return collected;
}

function liveClient(session) {
  const token = session.token;
  const userId = String(session.userId);
  return {
    isDemo: false,
    async getAchievements() {
      return mapAchievements(await liveJson("/users/me/achievements", { token }));
    },
    async listRewards({ page = 1, pageSize = 20 } = {}) {
      const document = await liveDocument(
        `/rewards?page=${page}&page_size=${pageSize}`,
        { token }
      );
      const list = Array.isArray(document.data) ? document.data : document.data ? [document.data] : [];
      return {
        items: list.map(mapReward),
        page: normalizePageMeta(document.meta?.page, {
          number: page,
          size: pageSize,
          itemCount: list.length,
        }),
      };
    },
    async getReward(id) {
      return mapReward(await liveJson(`/rewards/${encodeURIComponent(id)}`, { token }));
    },
    async claimReward(id) {
      const claim = mapClaim(
        await liveJson(`/rewards/${encodeURIComponent(id)}/claims`, {
          method: "POST",
          token,
        })
      );
      // Claim responses are reward-claim resources — reload the claimed reward + achievements.
      const [achievements, reward] = await Promise.all([
        this.getAchievements(),
        this.getReward(id),
      ]);
      return { claim, reward, achievements };
    },
    async createReward(fields) {
      return mapReward(
        await liveJson("/rewards", {
          method: "POST",
          token,
          body: {
            name: fields.name || fields.title,
            description: fields.description || null,
            eligibility: buildEligibilityPayload(fields),
            point_cost: Number(fields.pointCost ?? fields.costPoints ?? 0),
          },
        })
      );
    },
    // No /rewards/me — paginate /rewards and keep rows owned by the signed-in organizer.
    async listMyRewards() {
      return listAllRewardPages(token, { ownerId: userId });
    },
    async listClaims(rewardId) {
      const data = await liveJson(`/rewards/${encodeURIComponent(rewardId)}/claims`, { token });
      const list = Array.isArray(data) ? data : data ? [data] : [];
      return list.map(mapClaim);
    },
  };
}

function demoClient(session) {
  return {
    isDemo: true,
    getAchievements: () => demoGetAchievements(session.userId),
    listRewards: async ({ page = 1, pageSize = 20 } = {}) => {
      const items = await demoListRewards(session.userId);
      const totalItems = items.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize) || 1);
      const start = (page - 1) * pageSize;
      return {
        items: items.slice(start, start + pageSize),
        page: { number: page, size: pageSize, totalItems, totalPages },
      };
    },
    getReward: async (id) => {
      const items = await demoListRewards(session.userId);
      const found = items.find((entry) => entry.id === String(id));
      if (!found) throw new ApiError("Reward not found.", 404, {}, "reward_not_found");
      return found;
    },
    claimReward: async (id) => {
      const result = await demoClaimReward(id, session.userId);
      return {
        claim: {
          rewardId: id,
          userId: session.userId,
          pointsSpent: result.reward?.costPoints ?? null,
          claimedAt: new Date().toISOString(),
        },
        reward: result.reward,
        achievements: result.achievements,
      };
    },
    createReward: (fields) =>
      demoCreateReward(
        {
          title: fields.name || fields.title,
          description: fields.description,
          costPoints: fields.pointCost ?? fields.costPoints,
          requirements: fields.requirements || formatEligibilityRule(buildEligibilityPayload(fields)),
          requiresApprovedQuest: fields.ruleType === "approved_quests",
        },
        session.userId
      ),
    listMyRewards: () => demoListMyRewards(session.userId),
    listClaims: (rewardId) => demoListRewardClaims(rewardId, session.userId),
  };
}

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
  const client = mode === "demo" ? demoClient(session) : liveClient(session);
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
