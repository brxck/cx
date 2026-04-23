import { describe, it, expect } from "bun:test";
import { collectTerminalSurfaces, validateSessionNames } from "./layout-builder.ts";
import type { LayoutNode, SurfaceConfig } from "./templates.ts";

describe("collectTerminalSurfaces", () => {
  it("extracts terminal surfaces from a single pane", () => {
    const node: LayoutNode = {
      pane: {
        surfaces: [
          { type: "terminal" },
          { type: "terminal", session: "existing" },
        ],
      },
    };
    expect(collectTerminalSurfaces(node)).toHaveLength(2);
  });

  it("filters out non-terminal surfaces", () => {
    const node: LayoutNode = {
      pane: {
        surfaces: [
          { type: "browser", url: "http://localhost:3000" },
          { type: "terminal" },
        ],
      },
    };
    const terminals = collectTerminalSurfaces(node);
    expect(terminals).toHaveLength(1);
    expect(terminals[0]!.type).toBe("terminal");
  });

  it("recurses into split nodes", () => {
    const node: LayoutNode = {
      direction: "horizontal",
      children: [
        { pane: { surfaces: [{ type: "terminal" }] } },
        { pane: { surfaces: [{ type: "terminal" }] } },
      ],
    };
    expect(collectTerminalSurfaces(node)).toHaveLength(2);
  });

  it("handles nested splits", () => {
    const node: LayoutNode = {
      direction: "horizontal",
      children: [
        {
          direction: "vertical",
          children: [
            { pane: { surfaces: [{ type: "terminal" }] } },
            { pane: { surfaces: [{ type: "terminal" }] } },
          ],
        },
        { pane: { surfaces: [{ type: "terminal" }] } },
      ],
    };
    expect(collectTerminalSurfaces(node)).toHaveLength(3);
  });
});

describe("validateSessionNames", () => {
  it("passes when every terminal surface has a session", () => {
    const node: LayoutNode = {
      direction: "horizontal",
      children: [
        { pane: { surfaces: [{ type: "terminal", session: "a" }] } },
        { pane: { surfaces: [{ type: "terminal", session: "b" }] } },
      ],
    };
    expect(() => validateSessionNames(node)).not.toThrow();
  });

  it("throws when a terminal surface lacks a session", () => {
    const node: LayoutNode = {
      direction: "horizontal",
      children: [
        { pane: { surfaces: [{ type: "terminal", session: "a" }] } },
        { pane: { surfaces: [{ type: "terminal" }] } },
      ],
    };
    expect(() => validateSessionNames(node)).toThrow(/session/);
  });

  it("ignores browser surfaces", () => {
    const node: LayoutNode = {
      pane: {
        surfaces: [
          { type: "browser", url: "http://localhost:3000" },
          { type: "terminal", session: "a" },
        ],
      },
    };
    expect(() => validateSessionNames(node)).not.toThrow();
  });
});
