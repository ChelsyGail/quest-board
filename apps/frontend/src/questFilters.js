// Discovery filters for GET /items. Filtering and paging happen on the server, so the
// page shown is always part of the complete filtered catalogue, never a filtered page.

export const PAGE_SIZE = 12;

// Offered even before any item with that category has loaded. The backend matches a
// category exactly, ignoring case.
export const CATEGORY_SUGGESTIONS = [
  "Academic",
  "Arts",
  "Culture",
  "Social",
  "Sports",
  "Volunteering",
];

export const EMPTY_FILTERS = {
  query: "",
  category: "",
  dateFilter: "all",
  from: "",
  to: "",
};

const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function parseDateInput(value) {
  const match = DATE_INPUT_PATTERN.exec(value || "");
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  return new Date(year, month - 1, day);
}

export function filtersActive(filters) {
  return (
    Boolean(filters.query.trim()) || Boolean(filters.category) || filters.dateFilter !== "all"
  );
}

// The instants bounding the chosen days in the viewer's own time zone. Local midnights
// come from the browser's zone rules, so a day with a daylight saving change is 23 or 25
// hours long. An item is kept when it overlaps the window.
export function dateWindow({ dateFilter, from, to }, now = new Date()) {
  if (dateFilter === "today") {
    return { windowStart: startOfLocalDay(now), windowEnd: endOfLocalDay(now) };
  }
  if (dateFilter === "week") {
    return { windowStart: startOfLocalDay(now), windowEnd: endOfLocalDay(addDays(now, 6)) };
  }
  if (dateFilter === "range") {
    const fromDay = parseDateInput(from);
    const toDay = parseDateInput(to);
    if (fromDay && toDay && toDay < fromDay) {
      return { error: "The end date must be on or after the start date." };
    }
    return {
      windowStart: fromDay ? startOfLocalDay(fromDay) : null,
      windowEnd: toDay ? endOfLocalDay(toDay) : null,
    };
  }
  return { windowStart: null, windowEnd: null };
}

// The GET /items query for these filters and page, or { error } when the filters can't
// be sent as they are.
export function catalogueQuery(filters, page, now = new Date()) {
  const window = dateWindow(filters, now);
  if (window.error) return { error: window.error };
  const query = { page, pageSize: PAGE_SIZE };
  const keyword = filters.query.trim();
  if (keyword) query.q = keyword;
  if (filters.category) query.category = filters.category;
  if (window.windowStart) query.windowStart = window.windowStart.toISOString();
  if (window.windowEnd) query.windowEnd = window.windowEnd.toISOString();
  return query;
}

// The same rules as the backend's catalogue query, for the in-browser demo store.
export function matchesCatalogueQuery(item, query, now = new Date()) {
  if (item.status !== "published") return false;
  if (Date.parse(item.endsAt) <= now.getTime()) return false;
  if (query.q) {
    const needle = query.q.toLowerCase();
    const haystack = `${item.title} ${item.description}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  if (query.category && item.category.toLowerCase() !== query.category.toLowerCase()) {
    return false;
  }
  if (query.windowStart && Date.parse(item.endsAt) < Date.parse(query.windowStart)) {
    return false;
  }
  if (query.windowEnd && Date.parse(item.startsAt) > Date.parse(query.windowEnd)) {
    return false;
  }
  return true;
}

// Suggested categories plus any seen on the loaded page, without case-only duplicates.
export function categoryOptions(items, selected = "") {
  const byKey = new Map();
  for (const category of [...CATEGORY_SUGGESTIONS, ...items.map((item) => item.category), selected]) {
    const trimmed = (category || "").trim();
    if (trimmed && !byKey.has(trimmed.toLowerCase())) byKey.set(trimmed.toLowerCase(), trimmed);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}
