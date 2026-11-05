import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  catalogueQuery,
  categoryOptions,
  dateWindow,
  matchesCatalogueQuery,
} from "./questFilters.js";

const filters = (overrides) => ({ ...EMPTY_FILTERS, ...overrides });
const NOW = new Date(2026, 10, 4, 15, 30); // 4 Nov 2026, 15:30 local

function item(overrides) {
  return {
    title: "Campus cleanup",
    description: "Pick up litter",
    category: "Volunteering",
    status: "published",
    startsAt: new Date(2026, 10, 10, 12).toISOString(),
    endsAt: new Date(2026, 10, 10, 14).toISOString(),
    ...overrides,
  };
}

describe("catalogue filters", () => {
  it("sends only the filters that are set, trimmed", () => {
    expect(catalogueQuery(filters({}), 1, NOW)).toEqual({ page: 1, pageSize: 12 });
    expect(catalogueQuery(filters({ query: "  chess ", category: "Culture" }), 3, NOW)).toEqual({
      page: 3,
      pageSize: 12,
      q: "chess",
      category: "Culture",
    });
  });

  it("bounds today and the next 7 days by local midnights", () => {
    expect(dateWindow(filters({ dateFilter: "today" }), NOW)).toEqual({
      windowStart: new Date(2026, 10, 4),
      windowEnd: new Date(2026, 10, 4, 23, 59, 59, 999),
    });
    expect(dateWindow(filters({ dateFilter: "week" }), NOW)).toEqual({
      windowStart: new Date(2026, 10, 4),
      windowEnd: new Date(2026, 10, 10, 23, 59, 59, 999),
    });
  });

  it("allows an open-ended range and rejects one that ends first", () => {
    expect(dateWindow(filters({ dateFilter: "range", from: "2026-11-10" }), NOW)).toEqual({
      windowStart: new Date(2026, 10, 10),
      windowEnd: null,
    });
    expect(
      catalogueQuery(filters({ dateFilter: "range", from: "2026-11-10", to: "2026-11-09" }), 1, NOW)
    ).toEqual({ error: "The end date must be on or after the start date." });
  });

  it("keeps a day 23 hours long when the clocks go forward", () => {
    // Uses the test machine's zone rules, like the browser does. In Europe/Paris
    // 29 March 2026 lasts 23 hours; in UTC it lasts 24.
    const { windowStart, windowEnd } = dateWindow(
      filters({ dateFilter: "range", from: "2026-03-29", to: "2026-03-29" }),
      NOW
    );
    expect(windowStart.getHours()).toBe(0);
    expect(windowEnd.getHours()).toBe(23);
    const hours = (windowEnd - windowStart + 1) / 3600000;
    const offsetChange = (windowStart.getTimezoneOffset() - windowEnd.getTimezoneOffset()) / 60;
    expect(hours).toBe(24 - offsetChange);
  });

  it("matches the backend: overlap, keyword in title or description, any-case category", () => {
    const window = {
      windowStart: new Date(2026, 10, 10, 13).toISOString(),
      windowEnd: new Date(2026, 10, 10, 13, 30).toISOString(),
    };
    expect(matchesCatalogueQuery(item(), window, NOW)).toBe(true);
    expect(matchesCatalogueQuery(item(), { q: "LITTER" }, NOW)).toBe(true);
    expect(matchesCatalogueQuery(item(), { category: "volunteering" }, NOW)).toBe(true);
    expect(matchesCatalogueQuery(item(), { category: "Sports" }, NOW)).toBe(false);
    expect(matchesCatalogueQuery(item({ status: "draft" }), {}, NOW)).toBe(false);
    expect(
      matchesCatalogueQuery(item({ endsAt: new Date(2026, 10, 4, 15).toISOString() }), {}, NOW)
    ).toBe(false);
  });

  it("offers suggested and seen categories without case duplicates", () => {
    expect(categoryOptions([item({ category: "sports" }), item({ category: "Chess club" })], "Robotics")).toEqual([
      "Academic",
      "Arts",
      "Chess club",
      "Culture",
      "Robotics",
      "Social",
      "Sports",
      "Volunteering",
    ]);
  });
});
