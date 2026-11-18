// Fixed geometry for the Quest Grove tree, in a 1000 x 700 coordinate space. Each topic is
// a curved branch with a fixed number of leaf slots, so the same discussions always land in
// the same places and leaves never overlap, however many discussions there are.
export const GROVE_WIDTH = 1000;
export const GROVE_HEIGHT = 700;
export const LEAVES_PER_BRANCH = 6;

const TRUNK = { x: 500, base: 700, top: 400 };

// Quadratic curves from the trunk outward. `labelSide` is where the topic label sits
// relative to the branch tip.
const BRANCHES = {
  "campus-life": { from: [490, 560], control: [370, 525], to: [200, 480], labelSide: "left" },
  "quest-help": { from: [492, 470], control: [380, 330], to: [230, 175], labelSide: "left" },
  "team-finder": { from: [500, 420], control: [510, 270], to: [500, 95], labelSide: "top" },
  ideas: { from: [508, 470], control: [620, 330], to: [770, 175], labelSide: "right" },
  general: { from: [510, 560], control: [630, 525], to: [800, 480], labelSide: "right" },
};

// Where along each branch the slots are, and how far they sit to either side of it.
const SLOT_POSITIONS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const SLOT_OFFSET = 34;

function pointAt([x0, y0], [cx, cy], [x1, y1], t) {
  const u = 1 - t;
  return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1];
}

function normalAt([x0, y0], [cx, cy], [x1, y1], t) {
  const dx = 2 * (1 - t) * (cx - x0) + 2 * t * (x1 - cx);
  const dy = 2 * (1 - t) * (cy - y0) + 2 * t * (y1 - cy);
  const length = Math.hypot(dx, dy) || 1;
  return [-dy / length, dx / length];
}

function round(value) {
  return Math.round(value * 10) / 10;
}

// Slot centres for a branch, nearest the trunk first, alternating sides.
export function branchSlots(topicId) {
  const { from, control, to } = BRANCHES[topicId];
  return SLOT_POSITIONS.map((t, index) => {
    const [x, y] = pointAt(from, control, to, t);
    const [nx, ny] = normalAt(from, control, to, t);
    const side = index % 2 === 0 ? 1 : -1;
    return { x: round(x + nx * SLOT_OFFSET * side), y: round(y + ny * SLOT_OFFSET * side) };
  });
}

export function trunkPath() {
  const { x, base, top } = TRUNK;
  return `M ${x - 26} ${base} C ${x - 12} ${base - 120}, ${x - 10} ${top + 80}, ${x - 4} ${top} L ${x + 4} ${top} C ${x + 10} ${top + 80}, ${x + 12} ${base - 120}, ${x + 26} ${base} Z`;
}

// `threads` must already be filtered and sorted newest first (filterThreads). Each topic
// shows its newest LEAVES_PER_BRANCH discussions; the oldest of those sits nearest the
// trunk. The rest are counted in `hidden`.
export function groveLayout(threads, topics) {
  return topics.map((topic) => {
    const { from, control, to, labelSide } = BRANCHES[topic.id];
    const inTopic = threads.filter((thread) => thread.category === topic.id);
    const shown = inTopic
      .slice(0, LEAVES_PER_BRANCH)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
    const slots = branchSlots(topic.id);
    return {
      topic,
      path: `M ${from[0]} ${from[1]} Q ${control[0]} ${control[1]} ${to[0]} ${to[1]}`,
      tip: { x: to[0], y: to[1] },
      labelSide,
      leaves: shown.map((thread, index) => ({ thread, ...slots[index] })),
      hidden: inTopic.length - shown.length,
      total: inTopic.length,
    };
  });
}
