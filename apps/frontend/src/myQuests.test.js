import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  dayKey,
  entriesByDay,
  filterByTime,
  groupByStartDay,
  isUpcoming,
  itemDays,
  joinedEntries,
  monthGrid,
  participationStatusLabel,
  shiftMonth,
} from "./myQuests.js";

const PARIS = "Europe/Paris";
const NOW = Date.parse("2026-11-05T12:00:00Z");

function item(fields = {}) {
  return {
    id: "1",
    kind: "quest",
    title: "Campus cleanup",
    startsAt: "2026-11-10T09:00:00Z",
    endsAt: "2026-11-10T11:00:00Z",
    timeZone: PARIS,
    ...fields,
  };
}

function entry(fields = {}, status = "joined") {
  return {
    item: item(fields),
    participation: status ? { id: `p${fields.id || 1}`, itemId: fields.id || "1", status } : null,
    saved: !status,
  };
}

describe("joined entries", () => {
  it("keeps joined quests and RSVP'd events and leaves out items only saved", () => {
    const entries = [
      entry({ id: "1" }),
      entry({ id: "2", kind: "event" }, "approved"),
      { ...entry({ id: "3" }, null), saved: true },
    ];
    expect(joinedEntries(entries).map((e) => e.item.id)).toEqual(["1", "2"]);
  });

  it("names every backend status and never calls anything completed", () => {
    expect(["joined", "pending", "approved", "rejected"].map(participationStatusLabel)).toEqual([
      "Joined",
      "Pending",
      "Approved",
      "Rejected",
    ]);
  });
});

describe("upcoming and past", () => {
  it("decides by the item's end time, not by the participation status", () => {
    const running = item({ startsAt: "2026-11-05T10:00:00Z", endsAt: "2026-11-05T13:00:00Z" });
    const ended = item({ startsAt: "2026-11-05T09:00:00Z", endsAt: "2026-11-05T11:00:00Z" });
    expect(isUpcoming(running, NOW)).toBe(true);
    expect(isUpcoming(ended, NOW)).toBe(false);

    const entries = [
      entry({ id: "a", startsAt: "2026-11-01T09:00:00Z", endsAt: "2026-11-01T10:00:00Z" }, "approved"),
      entry({ id: "b", startsAt: "2026-11-20T09:00:00Z", endsAt: "2026-11-20T10:00:00Z" }, "rejected"),
      entry({ id: "c", startsAt: "2026-11-12T09:00:00Z", endsAt: "2026-11-12T10:00:00Z" }, "pending"),
      entry({ id: "d", startsAt: "2026-10-01T09:00:00Z", endsAt: "2026-10-01T10:00:00Z" }, "joined"),
    ];
    expect(filterByTime(entries, "upcoming", NOW).map((e) => e.item.id)).toEqual(["c", "b"]);
    expect(filterByTime(entries, "past", NOW).map((e) => e.item.id)).toEqual(["a", "d"]);
    expect(filterByTime(entries, "all", NOW).map((e) => e.item.id)).toEqual(["d", "a", "c", "b"]);
  });
});

describe("calendar days", () => {
  it("places an item on the viewer's local day, not the UTC one", () => {
    // 23:30 UTC on the 9th is already the 10th in Paris and still the 9th in New York.
    const late = item({ startsAt: "2026-11-09T23:30:00Z", endsAt: "2026-11-10T00:30:00Z" });
    expect(itemDays(late, PARIS)).toEqual(["2026-11-10"]);
    expect(itemDays(late, "America/New_York")).toEqual(["2026-11-09"]);
  });

  it("puts a multi-day item on every day it covers, and an end at midnight on no extra day", () => {
    const trip = item({ startsAt: "2026-11-13T08:00:00Z", endsAt: "2026-11-15T17:00:00Z" });
    expect(itemDays(trip, PARIS)).toEqual(["2026-11-13", "2026-11-14", "2026-11-15"]);
    const toMidnight = item({ startsAt: "2026-11-13T19:00:00Z", endsAt: "2026-11-13T23:00:00Z" });
    expect(itemDays(toMidnight, PARIS)).toEqual(["2026-11-13"]);
  });

  it("counts days on the calendar across daylight-saving changes", () => {
    // Paris springs forward on 29 March 2026 (a 23-hour day) and falls back on 25 October
    // (a 25-hour day).
    const spring = item({ startsAt: "2026-03-28T20:00:00Z", endsAt: "2026-03-30T08:00:00Z" });
    expect(itemDays(spring, PARIS)).toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]);
    const autumn = item({ startsAt: "2026-10-24T22:30:00Z", endsAt: "2026-10-25T22:30:00Z" });
    expect(itemDays(autumn, PARIS)).toEqual(["2026-10-25"]);
    // 23:30 local on the night of the change still belongs to the 25th.
    expect(dayKey(Date.parse("2026-10-25T22:30:00Z"), PARIS)).toBe("2026-10-25");
    expect(dayKey(Date.parse("2026-03-29T21:59:00Z"), PARIS)).toBe("2026-03-29");
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
  });

  it("builds a six-week grid starting on Monday", () => {
    const grid = monthGrid("2026-11-18");
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2026-10-26"); // a Monday
    expect(grid).toContain("2026-11-30");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-01");
    expect(shiftMonth("2026-11-09", 1)).toBe("2026-12-09");
    expect(shiftMonth("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftMonth("2026-03-31", -13)).toBe("2025-02-28");
  });

  it("lists each day's items in time order, only for the days asked for", () => {
    const entries = [
      entry({ id: "late", startsAt: "2026-11-14T17:00:00Z", endsAt: "2026-11-14T18:00:00Z" }),
      entry({ id: "trip", startsAt: "2026-11-13T08:00:00Z", endsAt: "2026-11-15T17:00:00Z" }),
      entry({ id: "far", startsAt: "2026-12-20T08:00:00Z", endsAt: "2026-12-20T09:00:00Z" }),
    ];
    const byDay = entriesByDay(entries, ["2026-11-13", "2026-11-14"], PARIS);
    expect(byDay.get("2026-11-13").map((e) => e.item.id)).toEqual(["trip"]);
    expect(byDay.get("2026-11-14").map((e) => e.item.id)).toEqual(["trip", "late"]);
    expect(byDay.has("2026-12-20")).toBe(false);
  });

  it("groups a list by the local day each item starts", () => {
    const entries = [
      entry({ id: "1", startsAt: "2026-11-10T08:00:00Z" }),
      entry({ id: "2", startsAt: "2026-11-10T20:00:00Z" }),
      entry({ id: "3", startsAt: "2026-11-10T23:30:00Z" }),
    ];
    expect(groupByStartDay(entries, PARIS).map((group) => [group.key, group.entries.length])).toEqual([
      ["2026-11-10", 2],
      ["2026-11-11", 1],
    ]);
  });
});
