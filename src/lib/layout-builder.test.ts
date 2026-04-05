import { describe, it, expect } from "bun:test";
import { collectTerminalSurfaces, assignSessionNames } from "./layout-builder.ts";
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

describe("assignSessionNames", () => {
  it("assigns names to surfaces without a session", () => {
    const node: LayoutNode = {
      direction: "horizontal",
      children: [
        { pane: { surfaces: [{ type: "terminal" }] } },
        { pane: { surfaces: [{ type: "terminal" }] } },
      ],
    };
    assignSessionNames(node, []);
    const terminals = collectTerminalSurfaces(node);
    expect(terminals[0]!.session).toBeDefined();
    expect(terminals[1]!.session).toBeDefined();
    expect(terminals[0]!.session).not.toBe(terminals[1]!.session);
  });

  it("does not overwrite existing session names", () => {
    const node: LayoutNode = {
      pane: { surfaces: [{ type: "terminal", session: "custom" }] },
    };
    assignSessionNames(node, []);
    const terminals = collectTerminalSurfaces(node);
    expect(terminals[0]!.session).toBe("custom");
  });

  it("avoids existing session names", () => {
    const node: LayoutNode = {
      pane: { surfaces: [{ type: "terminal" }] },
    };
    assignSessionNames(node, ["anacortes"]);
    const terminals = collectTerminalSurfaces(node);
    expect(terminals[0]!.session).not.toBe("anacortes");
  });
});
