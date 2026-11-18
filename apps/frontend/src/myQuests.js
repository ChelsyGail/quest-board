// The signed-in student's joined quests and RSVP'd events, from GET /me/participations.
// Calendar days are the viewer's own local days: every function that places an item on a
// day takes the zone explicitly, so placement never depends on the item's own zone.
import { browserTimeZone } from "./dates.js";

const PARTICIPATION_STATUS_LABELS = {
  joined: "Joined",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

// The backend's participation status as shown to students. Past items keep their status:
// an item having ended doesn't mean the student completed it.
export function participationStatusLabel(status) {
  return PARTICIPATION_STATUS_LABELS[status] || status;
}

export function participationBadgeClass(status) {
  return status === "joined" ? "badge badge-joined" : `badge status-${status}`;
}

// Entries the student joined or RSVP'd to. Items that are only saved have no participation
// and aren't joined, so they are left out.
export function joinedEntries(entries) {
  return entries.filter((entry) => entry.participation);
}

// Upcoming until the item ends, whatever the participation status.
export function isUpcoming(item, now = Date.now()) {
  return Date.parse(item.endsAt) > now;
}

// "upcoming": soonest first. "past": most recent first. "all": in time order.
export function filterByTime(entries, filter, now = Date.now()) {
  const byStart = (a, b) =>
    Date.parse(a.item.startsAt) - Date.parse(b.item.startsAt) || a.item.id.localeCompare(b.item.id);
  if (filter === "upcoming") {
    return entries.filter((entry) => isUpcoming(entry.item, now)).sort(byStart);
  }
  if (filter === "past") {
    return entries
      .filter((entry) => !isUpcoming(entry.item, now))
      .sort((a, b) => byStart(b, a));
  }
  return [...entries].sort(byStart);
}

const dayKeyFormats = new Map();

// The calendar day ("2026-03-29") of an instant in `timeZone`.
export function dayKey(instant, timeZone = browserTimeZone()) {
  let format = dayKeyFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayKeyFormats.set(timeZone, format);
  }
  return format.format(new Date(instant));
}

// Calendar arithmetic on day keys. Days are counted on the calendar, not in hours, so a
// 23- or 25-hour day across a daylight-saving change is still one day.
function keyToUtc(key) {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function utcToKey(time) {
  return new Date(time).toISOString().slice(0, 10);
}

export function addDays(key, days) {
  const date = new Date(keyToUtc(key));
  date.setUTCDate(date.getUTCDate() + days);
  return utcToKey(date.getTime());
}

export function addMonths(key, months) {
  const [year, month] = key.split("-").map(Number);
  return utcToKey(Date.UTC(year, month - 1 + months, 1));
}

// The same day of another month, or that month's last day when it's shorter.
export function shiftMonth(key, months) {
  const first = addMonths(key, months);
  const lastDay = addDays(addMonths(first, 1), -1);
  const day = Math.min(Number(key.slice(8)), Number(lastDay.slice(8)));
  return `${first.slice(0, 8)}${String(day).padStart(2, "0")}`;
}

export function monthStart(key) {
  return `${key.slice(0, 7)}-01`;
}

// Monday-first weekday, 0-6.
export function weekdayIndex(key) {
  return (new Date(keyToUtc(key)).getUTCDay() + 6) % 7;
}

// The local days an item covers, start to end. An item ending exactly at midnight doesn't
// spill onto the next day.
export function itemDays(item, timeZone = browserTimeZone()) {
  const start = Date.parse(item.startsAt);
  const end = Math.max(start, Date.parse(item.endsAt) - 1);
  const first = dayKey(start, timeZone);
  const last = dayKey(end, timeZone);
  const days = [];
  for (let key = first; key <= last && days.length < 366; key = addDays(key, 1)) {
    days.push(key);
  }
  return days;
}

// The six-week grid (42 day keys) showing the month of `key`, starting on a Monday.
export function monthGrid(key) {
  const first = monthStart(key);
  const gridStart = addDays(first, -weekdayIndex(first));
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

// day key -> entries on that day, soonest first, for the given days only.
export function entriesByDay(entries, days, timeZone = browserTimeZone()) {
  const wanted = new Set(days);
  const map = new Map();
  for (const entry of filterByTime(entries, "all")) {
    for (const key of itemDays(entry.item, timeZone)) {
      if (!wanted.has(key)) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(entry);
    }
  }
  return map;
}

// Consecutive entries sharing the local day they start on: [{ key, entries }].
export function groupByStartDay(entries, timeZone = browserTimeZone()) {
  const groups = [];
  for (const entry of entries) {
    const key = dayKey(Date.parse(entry.item.startsAt), timeZone);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else groups.push({ key, entries: [entry] });
  }
  return groups;
}

// "Wednesday 12 November 2026" for a day key, independent of any zone.
export function formatDayKey(key, options = { weekday: "long", day: "numeric", month: "long", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(
    new Date(keyToUtc(key))
  );
}

// "18:30" in the viewer's zone.
export function formatLocalTime(instant, timeZone = browserTimeZone()) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(
    new Date(instant)
  );
}
