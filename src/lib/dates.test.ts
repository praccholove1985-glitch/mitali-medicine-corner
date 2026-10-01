import { describe, expect, it } from "vitest";
import { formatDate, nextDay, todayInTimezone } from "./dates";

describe("todayInTimezone", () => {
  it("uses the timezone's calendar day, not UTC's", () => {
    // 20:00 UTC on 31 Dec is already 1 Jan in Dhaka (UTC+6).
    const instant = new Date("2026-12-31T20:00:00Z");
    expect(todayInTimezone("UTC", instant)).toBe("2026-12-31");
    expect(todayInTimezone("Asia/Dhaka", instant)).toBe("2027-01-01");
  });
});

describe("nextDay", () => {
  it("rolls over month, year and leap day", () => {
    expect(nextDay("2026-01-31")).toBe("2026-02-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
    expect(nextDay("2027-02-28")).toBe("2027-03-01");
  });
});

describe("formatDate", () => {
  it("formats a calendar date without shifting the day", () => {
    expect(formatDate("2027-03-31")).toBe("31 Mar 2027");
    expect(formatDate("2026-01-01")).toBe("1 Jan 2026");
    expect(formatDate("2026-12-09")).toBe("9 Dec 2026");
  });
  it("returns unrecognised input unchanged", () => {
    expect(formatDate("soon")).toBe("soon");
    expect(formatDate("2026-13-01")).toBe("2026-13-01");
  });
});
