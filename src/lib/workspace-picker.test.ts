import { describe, it, expect } from "bun:test";
import { fuzzyMatch } from "./workspace-picker.ts";

describe("fuzzyMatch", () => {
  it("matches exact string", () => {
    expect(fuzzyMatch("hello", "hello")).toBe(true);
  });

  it("matches subsequence", () => {
    expect(fuzzyMatch("hlo", "hello")).toBe(true);
  });

  it("is case insensitive", () => {
    expect(fuzzyMatch("HLO", "hello")).toBe(true);
  });

  it("rejects non-subsequence", () => {
    expect(fuzzyMatch("xyz", "hello")).toBe(false);
  });

  it("handles empty query", () => {
    expect(fuzzyMatch("", "anything")).toBe(true);
  });
});
