// Dev-only achievements/rewards sample store (this tab only). See docs/rewards-api-proposal.md.
const STORAGE_KEY = "questboard.demo.rewards.v1";

function delay(result, ms = 180) {
  return new Promise((resolve) => setTimeout(() => resolve(result), ms));
}

function fail(message, status, code) {
  return Promise.reject(Object.assign(new Error(message), { status, code }));
}

function emptyUser(userId) {
  return {
    userId: String(userId),
    earnedPoints: 0,
    spendablePoints: 0,
    badges: [],
    claimedRewardIds: [],
  };
}

function seedRewards() {
  return [
    {
      id: "r1",
      title: "Campus coffee voucher",
      description: "One free drink at the student café.",
      costPoints: 30,
      requirements: "Have at least one approved quest.",
      ownerId: "demo-organizer",
      requiresApprovedQuest: true,
    },
    {
      id: "r2",
      title: "QuestBoard sticker pack",
      description: "A small pack of campus stickers.",
      costPoints: 15,
      requirements: "Spendable balance of 15 points.",
      ownerId: "demo-organizer",
      requiresApprovedQuest: false,
    },
    {
      id: "r3",
      title: "Library late-night pass",
      description: "Priority seat booking for one evening.",
      costPoints: 50,
      requirements: "50 spendable points.",
      ownerId: "demo-organizer",
      requiresApprovedQuest: true,
    },
  ];
}

function readStore() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Fresh store.
  }
  const store = {
    nextRewardId: 4,
    rewards: seedRewards(),
    users: {},
    claims: [],
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  return store;
}

function writeStore(store) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function userRecord(store, userId) {
  const id = String(userId);
  if (!store.users[id]) store.users[id] = emptyUser(id);
  return store.users[id];
}

export function resetDemoRewards() {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function demoAwardPoints(userId, amount, { reason, badgeName } = {}) {
  const points = Number(amount) || 0;
  if (points <= 0) return;
  const store = readStore();
  const user = userRecord(store, userId);
  user.earnedPoints += points;
  user.spendablePoints += points;
  if (badgeName && !user.badges.some((badge) => badge.name === badgeName)) {
    user.badges.push({
      id: `badge-${user.badges.length + 1}`,
      name: badgeName,
      description: reason || badgeName,
      earnedAt: new Date().toISOString(),
    });
  }
  writeStore(store);
}

function eligibilityFor(user, reward) {
  if (user.claimedRewardIds.includes(reward.id)) return "claimed";
  if (user.spendablePoints < reward.costPoints) return "insufficient_points";
  if (reward.requiresApprovedQuest && user.earnedPoints <= 0) return "requirements_unmet";
  return "eligible";
}

export async function demoGetAchievements(userId) {
  const store = readStore();
  const user = userRecord(store, userId);
  writeStore(store);
  return delay({
    earnedPoints: user.earnedPoints,
    spendablePoints: user.spendablePoints,
    badges: user.badges.map((badge) => ({ ...badge })),
  });
}

export async function demoListRewards(userId) {
  const store = readStore();
  const user = userRecord(store, userId);
  writeStore(store);
  return delay(
    store.rewards.map((reward) => ({
      ...reward,
      eligibility: eligibilityFor(user, reward),
      claimed: user.claimedRewardIds.includes(reward.id),
    }))
  );
}

export async function demoClaimReward(rewardId, userId) {
  const store = readStore();
  const reward = store.rewards.find((entry) => entry.id === String(rewardId));
  if (!reward) return fail("Reward not found.", 404, "reward_not_found");
  const user = userRecord(store, userId);
  const eligibility = eligibilityFor(user, reward);
  if (eligibility === "claimed") return fail("You already claimed this reward.", 409, "already_claimed");
  if (eligibility !== "eligible") return fail("You are not eligible for this reward.", 422, "not_eligible");
  user.spendablePoints -= reward.costPoints;
  user.claimedRewardIds.push(reward.id);
  store.claims.push({
    rewardId: reward.id,
    userId: String(userId),
    name: "You",
    claimedAt: new Date().toISOString(),
  });
  writeStore(store);
  return delay({
    reward: { ...reward, eligibility: "claimed", claimed: true },
    achievements: {
      earnedPoints: user.earnedPoints,
      spendablePoints: user.spendablePoints,
      badges: user.badges.map((badge) => ({ ...badge })),
    },
  });
}

export async function demoCreateReward(fields, ownerId) {
  const title = (fields.title || "").trim();
  const description = (fields.description || "").trim();
  const requirements = (fields.requirements || "").trim();
  const cost = Number(fields.costPoints);
  if (title.length < 3) return fail("Give the reward a title.", 422, "validation_error");
  if (!description) return fail("Add a description.", 422, "validation_error");
  if (!Number.isInteger(cost) || cost < 1) return fail("Cost must be a whole number of points.", 422, "validation_error");
  const store = readStore();
  const reward = {
    id: `r${store.nextRewardId++}`,
    title,
    description,
    costPoints: cost,
    requirements: requirements || "No extra requirements.",
    ownerId: String(ownerId),
    requiresApprovedQuest: Boolean(fields.requiresApprovedQuest),
  };
  store.rewards.push(reward);
  writeStore(store);
  return delay({ ...reward, eligibility: "unavailable", claimed: false });
}

export async function demoListMyRewards(ownerId) {
  const store = readStore();
  return delay(store.rewards.filter((reward) => reward.ownerId === String(ownerId)).map((r) => ({ ...r })));
}

export async function demoListRewardClaims(rewardId, ownerId) {
  const store = readStore();
  const reward = store.rewards.find((entry) => entry.id === String(rewardId));
  if (!reward) return fail("Reward not found.", 404, "reward_not_found");
  if (reward.ownerId !== String(ownerId) && reward.ownerId !== "demo-organizer") {
    // In demo, organizers can inspect seeded rewards they did not create.
    if (reward.ownerId !== "demo-organizer") {
      return fail("Only the organizer who created this reward can see claims.", 403, "reward_not_owned");
    }
  }
  return delay(
    store.claims
      .filter((claim) => claim.rewardId === String(rewardId))
      .map((claim) => ({ ...claim }))
  );
}
