// Catalogue items are stored as UTC instants plus the IANA time zone they take place
// in. Organizers enter and read times as wall-clock times in that zone, wherever their
// browser happens to be.

// The browser's own zone, used as the default for new items.
export function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

// Every zone the browser knows, plus UTC (which browsers leave out of the list) and
// `include` if it is missing.
export function timeZoneOptions(include) {
  const zones = new Set(
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []
  );
  zones.add("UTC");
  if (include) zones.add(include);
  return [...zones].sort();
}

// How far `timeZone` is ahead of UTC at the instant `time` (milliseconds since the epoch).
function zoneOffset(time, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(time));
  const value = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  const wallTime = Date.UTC(
    value.year,
    value.month - 1,
    value.day,
    value.hour,
    value.minute,
    value.second
  );
  return wallTime - Math.floor(time / 1000) * 1000;
}

const LOCAL_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

// A datetime-local value such as "2026-11-01T18:30", read as a wall-clock time in
// `timeZone`, as a UTC ISO string. Returns "" for an empty or malformed value.
// A time skipped by a daylight saving change moves forward by the size of the jump.
export function zonedInputToIso(value, timeZone) {
  const match = LOCAL_INPUT_PATTERN.exec(value || "");
  if (!match) return "";
  const [, year, month, day, hour, minute] = match.map(Number);
  const wallTime = Date.UTC(year, month - 1, day, hour, minute);
  // The offset depends on the instant, so check it again at the first guess.
  const guess = wallTime - zoneOffset(wallTime, timeZone);
  return new Date(wallTime - zoneOffset(guess, timeZone)).toISOString();
}

// The opposite of zonedInputToIso: a UTC ISO string as a datetime-local value in `timeZone`.
export function isoToZonedInput(iso, timeZone) {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  return new Date(time + zoneOffset(time, timeZone)).toISOString().slice(0, 16);
}

// A readable date and time in the item's own zone, e.g. "1 Nov 2026, 18:30".
export function formatItemTime(iso, timeZone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
