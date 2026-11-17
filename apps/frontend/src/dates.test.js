import { describe, expect, it } from "vitest";
import { formatItemTime, isoToZonedInput, timeZoneOptions, zonedInputToIso } from "./dates.js";

describe("Item times in the item's own time zone (FE-12)", () => {
  it.each([
    // Paris is UTC+1 in winter and UTC+2 in summer.
    ["2026-11-01T18:30", "Europe/Paris", "2026-11-01T17:30:00.000Z"],
    ["2026-07-01T18:30", "Europe/Paris", "2026-07-01T16:30:00.000Z"],
    ["2026-07-01T18:30", "America/New_York", "2026-07-01T22:30:00.000Z"],
    ["2026-07-01T18:30", "UTC", "2026-07-01T18:30:00.000Z"],
  ])("reads %s in %s as %s", (input, zone, iso) => {
    expect(zonedInputToIso(input, zone)).toBe(iso);
    expect(isoToZonedInput(iso, zone)).toBe(input);
  });

  it("handles the hour that repeats when daylight saving ends", () => {
    // 25 October 2026, 02:30 happens twice in Paris; either reading round-trips.
    const iso = zonedInputToIso("2026-10-25T02:30", "Europe/Paris");
    expect(["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"]).toContain(iso);
    expect(isoToZonedInput(iso, "Europe/Paris")).toBe("2026-10-25T02:30");
  });

  it("returns an empty string for an empty or malformed value", () => {
    expect(zonedInputToIso("", "Europe/Paris")).toBe("");
    expect(zonedInputToIso("tomorrow", "Europe/Paris")).toBe("");
    expect(isoToZonedInput("not a date", "Europe/Paris")).toBe("");
  });

  it("formats a time in the item's zone, not the browser's", () => {
    expect(formatItemTime("2026-11-01T17:30:00Z", "Europe/Paris")).toBe("1 Nov 2026, 18:30");
    expect(formatItemTime("2026-11-01T17:30:00Z", "Asia/Tokyo")).toBe("2 Nov 2026, 02:30");
  });

  it("offers every known zone plus UTC, and keeps one that is missing from the list", () => {
    expect(timeZoneOptions()).toContain("Europe/Paris");
    expect(timeZoneOptions()).toContain("UTC");
    expect(timeZoneOptions("Etc/GMT+5")).toContain("Etc/GMT+5");
    expect(timeZoneOptions("Etc/GMT+5")).toEqual([...timeZoneOptions("Etc/GMT+5")].sort());
  });
});
