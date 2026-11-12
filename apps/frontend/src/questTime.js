// Convert datetime-local wall-clock values in a chosen IANA zone to ISO timestamps.
// Do not use the browser's local timezone for the conversion.

const WALL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
// Wide enough for any civil offset, and fine enough for 30-minute transitions
// (Australia/Lord_Howe) as well as one-hour DST shifts.
const OFFSET_SAMPLE_WINDOW_MS = 36 * 60 * 60 * 1000;
const OFFSET_SAMPLE_STEP_MS = 15 * 60 * 1000;

export function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function formatWallInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}

function offsetMsAt(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return asUtc - instant.getTime();
}

function matchingInstants(wall, timeZone) {
  const [, ys, ms, ds, hs, mins] = WALL_PATTERN.exec(wall);
  const asUtc = Date.UTC(Number(ys), Number(ms) - 1, Number(ds), Number(hs), Number(mins), 0);

  // Collect every distinct zone offset that appears around this local day, then
  // try each as an interpretation of the wall clock. That finds alternatives on
  // either side of a transition and works for 30-minute as well as 60-minute shifts.
  const offsets = new Set();
  for (
    let sample = asUtc - OFFSET_SAMPLE_WINDOW_MS;
    sample <= asUtc + OFFSET_SAMPLE_WINDOW_MS;
    sample += OFFSET_SAMPLE_STEP_MS
  ) {
    offsets.add(offsetMsAt(new Date(sample), timeZone));
  }

  const matches = [];
  const seen = new Set();
  for (const offset of offsets) {
    const candidate = asUtc - offset;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (formatWallInZone(new Date(candidate), timeZone) === wall) {
      matches.push(candidate);
    }
  }
  return matches.sort((a, b) => a - b);
}

// Returns { iso } or { error: "invalid" | "unknown_zone" | "impossible" | "ambiguous" }.
export function wallTimeToIso(wall, timeZone) {
  if (!WALL_PATTERN.test(wall || "")) {
    return { error: "invalid" };
  }
  if (!isValidTimeZone(timeZone)) {
    return { error: "unknown_zone" };
  }

  const matches = matchingInstants(wall, timeZone);
  if (matches.length === 0) {
    return { error: "impossible" };
  }
  if (matches.length > 1) {
    return { error: "ambiguous" };
  }
  return { iso: new Date(matches[0]).toISOString() };
}

export function describeWallTimeError(error, label = "time") {
  switch (error) {
    case "unknown_zone":
      return "Enter a valid IANA time zone such as Europe/Paris.";
    case "impossible":
      return `That ${label} does not exist in the selected time zone (often during daylight-saving changes).`;
    case "ambiguous":
      return `That ${label} is ambiguous in the selected time zone (daylight-saving fall-back). Pick a time outside the repeated hour.`;
    default:
      return `Please choose a valid ${label}.`;
  }
}
