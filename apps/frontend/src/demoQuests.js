// Development-only sample items. Never used in production builds and never talks
// to the real API. Data lives in sessionStorage under a dedicated key so it cannot
// mix with real accounts or live requests. Shapes match the live API client.
import { matchesCatalogueQuery } from "./questFilters.js";

const STORAGE_KEY = "questboard.demo.quests.v3";

function atLocalDay(offsetDays, startHour, startMinute, endHour, endMinute) {
  const start = new Date();
  start.setDate(start.getDate() + offsetDays);
  start.setHours(startHour, startMinute, 0, 0);
  const end = new Date(start);
  end.setHours(endHour, endMinute, 0, 0);
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

function demoItem(fields) {
  return {
    kind: "quest",
    ownerId: "demo-organizer",
    timeZone: "Europe/Paris",
    proofInstructions: "",
    pointValue: null,
    status: "published",
    publishedAt: "",
    createdAt: "",
    updatedAt: "",
    ...fields,
  };
}

function seedData() {
  // Late enough that it is still on the board for most of the day.
  const today = atLocalDay(0, 21, 0, 23, 30);
  const tomorrow = atLocalDay(1, 12, 30, 14, 0);
  const midWeek = atLocalDay(3, 14, 0, 16, 30);
  const weekend = atLocalDay(5, 10, 0, 12, 0);
  const nextWeek = atLocalDay(8, 17, 0, 19, 0);
  const later = atLocalDay(12, 15, 0, 17, 0);

  return {
    nextItemId: 10,
    nextParticipationId: 1,
    items: [
      demoItem({
        id: "demo-1",
        title: "Campus cleanup",
        description: "Pick up litter around the library and the Quai. Bags and gloves provided.",
        location: "Quai d'Orsay",
        ...midWeek,
        category: "Volunteering",
        proofInstructions: "A photo of your full bag.",
        pointValue: 50,
      }),
      demoItem({
        id: "demo-2",
        title: "Chess night",
        description: "Casual games in the student lounge. All levels welcome — bring a friend or come solo.",
        location: "Student lounge",
        ...tomorrow,
        category: "Culture",
        proofInstructions: "Ask the host to stamp your board.",
        pointValue: 25,
      }),
      demoItem({
        id: "demo-3",
        title: "Photo walk draft",
        description: "An afternoon walk to photograph campus landmarks.",
        location: "Main courtyard",
        ...midWeek,
        category: "Arts",
        proofInstructions: "Share three photos in the club chat.",
        pointValue: 40,
        status: "draft",
      }),
      demoItem({
        id: "demo-4",
        title: "Pickup football",
        description: "Friendly match on the grass behind Combes. Cleats optional; shin guards recommended.",
        location: "Combes field",
        ...today,
        category: "Sports",
        proofInstructions: "Check in with the captain at kickoff.",
        pointValue: 30,
      }),
      demoItem({
        id: "demo-5",
        title: "Study sprint: midterms",
        description: "Quiet focus block with pomodoro timers and shared whiteboards.",
        location: "Library room B",
        ...weekend,
        category: "Academic",
        proofInstructions: "Sign the attendance sheet before you leave.",
        pointValue: 20,
      }),
      demoItem({
        id: "demo-6",
        kind: "event",
        title: "Gallery opening night",
        description: "Student exhibition opening with short artist talks and light refreshments.",
        location: "AMEX gallery",
        ...nextWeek,
        category: "Arts",
      }),
      demoItem({
        id: "demo-7",
        title: "Neighborhood food walk",
        description: "Sample a few neighborhood spots and compare notes afterward on campus.",
        location: "Meet at main gate",
        ...later,
        category: "Social",
        proofInstructions: "Share one recommendation in the group chat.",
        pointValue: 40,
      }),
      demoItem({
        id: "demo-8",
        kind: "event",
        title: "Open mic",
        description: "Music, poetry and comedy from students. Sign up at the door to perform.",
        location: "Student lounge",
        ...weekend,
        category: "Social",
      }),
    ],
    // Map of userId -> [{ id, itemId, status, joinedAt }]
    participationsByUser: {},
  };
}

function readStore() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Unreadable data is replaced by a fresh seed below.
  }
  const seeded = seedData();
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
  return seeded;
}

function writeStore(store) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function delay(result) {
  // Small delay so loading states are visible during demos.
  return new Promise((resolve) => {
    setTimeout(() => resolve(result), 180);
  });
}

function demoError(message, status, code) {
  return Promise.reject(Object.assign(new Error(message), { status, code }));
}

function byStartTime(a, b) {
  return Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id);
}

export function resetDemoQuests() {
  sessionStorage.removeItem(STORAGE_KEY);
  return delay(seedData());
}

export function demoListPublishedItems(query = {}) {
  const pageSize = query.pageSize || 12;
  const pageNumber = query.page || 1;
  const matching = readStore()
    .items.filter((item) => matchesCatalogueQuery(item, query))
    .sort(byStartTime);
  const start = (pageNumber - 1) * pageSize;
  return delay({
    items: matching.slice(start, start + pageSize),
    page: {
      number: pageNumber,
      size: pageSize,
      totalItems: matching.length,
      totalPages: Math.ceil(matching.length / pageSize),
    },
  });
}

export function demoGetItem(itemId) {
  const item = readStore().items.find((entry) => entry.id === itemId);
  if (!item || item.status !== "published") {
    return demoError("The item does not exist or is not available.", 404, "item_not_found");
  }
  return delay({ ...item });
}

export function demoListMyItems() {
  // Demo mode shows every sample item as the signed-in organizer's own.
  return delay([...readStore().items].sort(byStartTime));
}

export function demoCreateQuest(fields) {
  const store = readStore();
  const item = demoItem({
    id: `demo-${store.nextItemId++}`,
    title: fields.title,
    description: fields.description,
    location: fields.location,
    startsAt: fields.starts_at,
    endsAt: fields.ends_at,
    timeZone: fields.time_zone,
    category: fields.category,
    proofInstructions: fields.proof_instructions,
    pointValue: fields.point_value,
    status: "draft",
  });
  store.items.push(item);
  writeStore(store);
  return delay({ ...item });
}

export function demoPublishItem(itemId) {
  const store = readStore();
  const item = store.items.find((entry) => entry.id === itemId);
  if (!item) {
    return demoError("The item does not exist or is not available.", 404, "item_not_found");
  }
  if (item.status === "published") {
    return demoError("This item is already visible to students.", 409, "item_already_published");
  }
  item.status = "published";
  writeStore(store);
  return delay({ ...item });
}

export function demoListMyParticipations(userId) {
  const store = readStore();
  const participations = store.participationsByUser[userId] || [];
  return delay(
    participations
      .map((participation) => ({
        item: store.items.find((item) => item.id === participation.itemId),
        participation,
        saved: false,
      }))
      .filter((entry) => entry.item)
  );
}

export function demoJoinItem(itemId, userId) {
  const store = readStore();
  const item = store.items.find((entry) => entry.id === itemId && entry.status === "published");
  if (!item) {
    return demoError("The item does not exist or is not available.", 404, "item_not_found");
  }
  const participations = store.participationsByUser[userId] || [];
  if (participations.some((participation) => participation.itemId === itemId)) {
    return demoError("You have already joined this item.", 409, "already_joined");
  }
  const participation = {
    id: `demo-p-${store.nextParticipationId++}`,
    itemId,
    userId,
    status: "joined",
    joinedAt: new Date().toISOString(),
  };
  store.participationsByUser[userId] = [...participations, participation];
  writeStore(store);
  return delay({ ...participation });
}
