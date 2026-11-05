import { describe, expect, it } from "vitest";
import { isValidTimeZone, wallTimeToIso } from "./questTime.js";

describe("questTime", () => {
  it("accepts known IANA zones", () => {
    expect(isValidTimeZone("Europe/Paris")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Australia/Lord_Howe")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });

  it("converts Paris summer wall time to UTC (CEST, UTC+2)", () => {
    expect(wallTimeToIso("2026-07-15T14:00", "Europe/Paris")).toEqual({
      iso: "2026-07-15T12:00:00.000Z",
    });
  });

  it("converts Paris winter wall time to UTC (CET, UTC+1)", () => {
    expect(wallTimeToIso("2026-01-15T14:00", "Europe/Paris")).toEqual({
      iso: "2026-01-15T13:00:00.000Z",
    });
  });

  it("rejects a non-existent spring-forward time in Europe/Paris", () => {
    // 2026-03-29: clocks jump 02:00 -> 03:00 in Paris.
    expect(wallTimeToIso("2026-03-29T02:30", "Europe/Paris")).toEqual({ error: "impossible" });
  });

  it("rejects an ambiguous fall-back time in Europe/Paris", () => {
    // 2026-10-25: clocks fall back 03:00 -> 02:00 in Paris.
    expect(wallTimeToIso("2026-10-25T02:30", "Europe/Paris")).toEqual({ error: "ambiguous" });
  });

  it("rejects spring-forward and fall-back gaps in America/New_York", () => {
    // 2026-03-08: clocks jump 02:00 -> 03:00.
    expect(wallTimeToIso("2026-03-08T02:30", "America/New_York")).toEqual({ error: "impossible" });
    // 2026-11-01: clocks fall back 02:00 -> 01:00.
    expect(wallTimeToIso("2026-11-01T01:30", "America/New_York")).toEqual({ error: "ambiguous" });
    // A unique winter instant still converts.
    expect(wallTimeToIso("2026-01-15T14:00", "America/New_York")).toEqual({
      iso: "2026-01-15T19:00:00.000Z",
    });
  });

  it("handles Australia/Lord_Howe 30-minute DST transitions", () => {
    // 2026-10-04: clocks jump 02:00 -> 02:30 (+30 minutes).
    expect(wallTimeToIso("2026-10-04T02:15", "Australia/Lord_Howe")).toEqual({
      error: "impossible",
    });
    // 2026-04-05: clocks fall back 02:00 -> 01:30 (−30 minutes).
    expect(wallTimeToIso("2026-04-05T01:45", "Australia/Lord_Howe")).toEqual({
      error: "ambiguous",
    });
    // Unique summer (+11) and winter (+10:30) conversions.
    expect(wallTimeToIso("2026-01-15T14:00", "Australia/Lord_Howe")).toEqual({
      iso: "2026-01-15T03:00:00.000Z",
    });
    expect(wallTimeToIso("2026-06-15T14:00", "Australia/Lord_Howe")).toEqual({
      iso: "2026-06-15T03:30:00.000Z",
    });
  });

  it("rejects unknown zones and bad wall clocks", () => {
    expect(wallTimeToIso("2026-07-15T14:00", "Mars/Colony")).toEqual({ error: "unknown_zone" });
    expect(wallTimeToIso("not-a-time", "Europe/Paris")).toEqual({ error: "invalid" });
  });
});
