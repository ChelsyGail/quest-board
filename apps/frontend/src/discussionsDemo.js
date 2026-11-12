// Development-only sample discussions for the discussion prototype. Never used in
// production builds and never talks to the API. Everything lives in sessionStorage for
// this browser tab only: nothing posted here is seen by anyone else.
// v2: separate quest:{id}:active and quest:{id}:submitted scopes.
const STORAGE_KEY = "questboard.demo.discussions.v2";
const TITLE_MAX = 120;
const BODY_MAX = 4000;
const REPLY_MAX = 2000;

const SAMPLE_AUTHORS = [
  { id: "sample-1", name: "Léa M." },
  { id: "sample-2", name: "Omar K." },
  { id: "sample-3", name: "Priya S." },
  { id: "sample-4", name: "Jonas B." },
  { id: "sample-5", name: "Camille R." },
  { id: "sample-6", name: "Ines T." },
];

// [topic, title, message, sample replies]
const GROVE_SEEDS = [
  ["campus-life", "Best quiet spots to study near the Quai?", "The library fills up by 10. Where do you go when you need two hours of real focus?", ["The third floor of the Combes building is usually empty before lunch.", "Café on rue Cler has outlets and doesn't mind laptops."]],
  ["campus-life", "Laundry rooms that actually work", "Sharing a list of laundromats near campus with card payment. Add yours.", ["The one on avenue Bosquet takes cards and is open late."]],
  ["campus-life", "Weekend market recommendations", "Looking for a good Sunday market within 20 minutes of campus.", []],
  ["campus-life", "Club fair: what did you join?", "Curious which clubs people signed up for this term and why.", ["Debate society — the weekly sessions are short and fun."]],
  ["campus-life", "Bike routes to campus", "Is the river path safe to ride in the morning rush?", ["Yes, just watch out near the bridges."]],
  ["campus-life", "Cheap lunch ideas", "What's your go-to lunch under eight euros near campus?", []],
  ["campus-life", "Gym buddies for early mornings", "Anyone going around 7am on weekdays? Easier to show up with someone.", []],
  ["campus-life", "Noise in the student lounge", "Could we agree on quiet hours in the lounge during midterms?", ["+1, maybe 9 to 12 on weekdays?"]],
  ["quest-help", "How do I submit proof for a quest?", "I finished the campus cleanup. Where do I send the photo?", ["Check the proof instructions on the quest page. Organizers review it from there."]],
  ["quest-help", "Joined the wrong quest", "Can I leave a quest I joined by mistake?", []],
  ["quest-help", "Pending status for days", "My participation has been pending since Monday. Is that normal?", ["Organizers approve in batches, give it a few days."]],
  ["quest-help", "Points not showing up", "Approved quest but my points haven't changed yet.", []],
  ["quest-help", "Time zone on quest pages", "Times on some quests show Europe/Paris. Is that my local time?", ["The details page shows the quest's own zone next to the time when it differs from yours."]],
  ["team-finder", "Two more for the photo walk", "We're three and want five. Beginners welcome, phones are fine.", ["I'm in if it's after 2pm."]],
  ["team-finder", "Study sprint partner for stats", "Looking for someone doing STATS 201 to work through problem sets.", []],
  ["team-finder", "Football Thursday — need a keeper", "We have ten players and nobody in goal.", ["I can do the first half."]],
  ["team-finder", "Food walk group", "Starting a group for the neighborhood food walk. Vegetarian-friendly.", []],
  ["team-finder", "Chess night teams", "Anyone up for a team blitz format at chess night?", []],
  ["team-finder", "Hiking trip carpool", "Driving to the weekend hike, two seats free.", []],
  ["team-finder", "Volunteer cleanup crew", "Forming a crew for every cleanup this term.", []],
  ["team-finder", "Open mic duet", "Guitarist looking for a singer for the open mic.", []],
  ["ideas", "A quest for visiting every museum pass venue", "Could someone organize a quest around the student museum pass?", ["Love it. Could be split across a month."]],
  ["ideas", "Language exchange evenings", "Weekly pairs: one hour in French, one hour in English.", []],
  ["ideas", "Map of quests on campus", "It would help to see where quests happen on a map.", []],
  ["ideas", "Seasonal quest series", "A quest per season with a small badge for finishing all four.", []],
  ["general", "Welcome thread", "Say hi and tell us what you're studying.", ["Hi! Second-year comparative literature.", "Hello from the exchange students!"]],
  ["general", "Feedback on QuestBoard", "What would make the board more useful for you?", []],
  ["general", "Lost and found", "Found a blue umbrella after the gallery opening.", []],
];

const QUEST_SEEDS = [
  ["teammates", "Anyone want to go together?", "First time joining one of these. Happy to meet up beforehand.", ["Same here, let's meet at the entrance 10 minutes early."]],
  ["help", "What should I bring?", "The description doesn't say. Is there anything we need on the day?", []],
  ["tips", "Tip from last time", "Arrive a bit early: the first half hour is the best part.", []],
];

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60000).toISOString();
}

function sampleThread(store, scope, [category, title, body, replies], index) {
  const id = `demo-t-${store.nextId++}`;
  const author = SAMPLE_AUTHORS[index % SAMPLE_AUTHORS.length];
  // Spread over the last few weeks, a fixed distance apart, so the order is stable.
  const createdAt = minutesAgo(60 * 9 * (index + 1));
  store.threads.push({ id, scope, title, category, body, author, createdAt, sample: true });
  store.replies[id] = replies.map((reply, replyIndex) => ({
    id: `demo-r-${store.nextId++}`,
    threadId: id,
    body: reply,
    author: SAMPLE_AUTHORS[(index + replyIndex + 1) % SAMPLE_AUTHORS.length],
    createdAt: minutesAgo(60 * 9 * (index + 1) - 30 * (replyIndex + 1)),
    sample: true,
  }));
}

function emptyStore() {
  return { nextId: 1, threads: [], replies: {}, seededScopes: [] };
}

function readStore() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Unreadable data is replaced below.
  }
  return emptyStore();
}

function writeStore(store) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function shouldSeedQuestSamples(scope) {
  // Active space gets sample teammate/help threads. Submitted starts empty (spoilers).
  // Legacy `quest:{id}` is not freshly seeded; existing rows only appear in submitted lists.
  return scope === "grove" || /:active$/.test(scope);
}

// Sample threads are added the first time a scope is opened in this tab.
function seededStore(scope) {
  const store = readStore();
  if (!store.seededScopes.includes(scope)) {
    if (shouldSeedQuestSamples(scope)) {
      const seeds = scope === "grove" ? GROVE_SEEDS : QUEST_SEEDS;
      seeds.forEach((seed, index) => sampleThread(store, scope, seed, index));
    }
    store.seededScopes.push(scope);
    writeStore(store);
  }
  return store;
}

function listScopesFor(scope) {
  const submitted = /^quest:([^:]+):submitted$/.exec(scope);
  if (submitted) {
    // Conservative migration: legacy quest:{id} threads are spoilers → submitted only.
    return [scope, `quest:${submitted[1]}`];
  }
  return [scope];
}

function delay(result) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(result), 150);
  });
}

function demoError(message, status, code) {
  return Promise.reject(Object.assign(new Error(message), { status, code }));
}

function withReplyCount(store, thread) {
  return { ...thread, replyCount: (store.replies[thread.id] || []).length };
}

export function resetDemoDiscussions() {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function demoListThreads(scope) {
  const store = seededStore(scope);
  const allowed = new Set(listScopesFor(scope));
  return delay(
    store.threads
      .filter((thread) => allowed.has(thread.scope))
      .map((thread) => withReplyCount(store, thread))
  );
}

export function demoGetThread(threadId) {
  const store = readStore();
  const thread = store.threads.find((entry) => entry.id === threadId);
  if (!thread) return demoError("This discussion no longer exists.", 404, "thread_not_found");
  return delay({
    thread: withReplyCount(store, thread),
    replies: (store.replies[threadId] || []).map((reply) => ({ ...reply })),
  });
}

export function demoCreateThread(scope, { title, category, body }, author) {
  if (!title.trim() || title.trim().length > TITLE_MAX || !body.trim() || body.length > BODY_MAX) {
    return demoError("The title or message is empty or too long.", 422, "validation_error");
  }
  const store = seededStore(scope);
  const thread = {
    id: `demo-t-${store.nextId++}`,
    scope,
    title: title.trim(),
    category,
    body,
    author: { id: author.id, name: author.name },
    createdAt: new Date().toISOString(),
    sample: false,
  };
  store.threads.push(thread);
  store.replies[thread.id] = [];
  writeStore(store);
  return delay(withReplyCount(store, thread));
}

export function demoCreateReply(threadId, { body }, author) {
  if (!body.trim() || body.length > REPLY_MAX) {
    return demoError("The reply is empty or too long.", 422, "validation_error");
  }
  const store = readStore();
  if (!store.threads.some((thread) => thread.id === threadId)) {
    return demoError("This discussion no longer exists.", 404, "thread_not_found");
  }
  const reply = {
    id: `demo-r-${store.nextId++}`,
    threadId,
    body,
    author: { id: author.id, name: author.name },
    createdAt: new Date().toISOString(),
    sample: false,
  };
  store.replies[threadId] = [...(store.replies[threadId] || []), reply];
  writeStore(store);
  return delay({ ...reply });
}
