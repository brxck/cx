import { describe, it, expect } from "bun:test";
import { isSplitNode, isPaneNode, type LayoutNode } from "./templates.ts";

describe("isSplitNode", () => {
  it("returns true for split nodes", () => {
    const node: LayoutNode = {
      direction: "horizontal",
      children: [
        { pane: { surfaces: [] } },
        { pane: { surfaces: [] } },
      ],
    };
    expect(isSplitNode(node)).toBe(true);
  });

  it("returns false for pane nodes", () => {
    const node: LayoutNode = { pane: { surfaces: [] } };
    expect(isSplitNode(node)).toBe(false);
  });
});

describe("isPaneNode", () => {
  it("returns true for pane nodes", () => {
    const node: LayoutNode = { pane: { surfaces: [] } };
    expect(isPaneNode(node)).toBe(true);
  });

  it("returns false for split nodes", () => {
    const node: LayoutNode = {
      direction: "horizontal",
      children: [
        { pane: { surfaces: [] } },
        { pane: { surfaces: [] } },
      ],
    };
    expect(isPaneNode(node)).toBe(false);
  });
});
