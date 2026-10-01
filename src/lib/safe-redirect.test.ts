import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-redirect";

describe("safeNextPath", () => {
  it("keeps same-site paths, queries and hashes", () => {
    expect(safeNextPath("/inventory")).toBe("/inventory");
    expect(safeNextPath("/reports?range=7d")).toBe("/reports?range=7d");
    expect(safeNextPath("/medicines#top")).toBe("/medicines#top");
  });

  it("falls back for missing values", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
    expect(safeNextPath("evil.example")).toBe("/");
  });

  it("rejects control characters, backslashes and embedded schemes", () => {
    expect(safeNextPath("/ok\nSet-Cookie: x=1")).toBe("/");
    expect(safeNextPath("/a\\b")).toBe("/");
    expect(safeNextPath("/redirect/http://evil.example")).toBe("/");
  });

  it("does not loop back to the login page", () => {
    expect(safeNextPath("/login")).toBe("/");
    expect(safeNextPath("/login?next=/x")).toBe("/");
  });

  it("uses a custom fallback", () => {
    expect(safeNextPath("https://x.example", "/pos")).toBe("/pos");
  });
});
