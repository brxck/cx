import { describe, it, expect } from "bun:test";
import {
  isSplitNode,
  isPaneNode,
  materializeTemplate,
  prepareTemplate,
  templateDisplay,
  type LayoutNode,
  type TemplateConfig,
  type TemplateSource,
  type TemplateFn,
  type TemplateMeta,
} from "./templates.ts";
import type { WorkspaceContext, CoderWorkspace } from "./coder.ts";

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

function jsonSource(config: Partial<TemplateConfig> = {}): TemplateSource {
  const full: TemplateConfig = {
    name: "json-test",
    coder: { template: "coder-t" },
    type: "ephemeral",
    layout: { pane: { surfaces: [{ type: "terminal" }] } },
    ...config,
  };
  return { kind: "json", name: full.name, filePath: "<test>", config: full };
}

function jsSource(fn: TemplateFn, meta?: TemplateMeta): TemplateSource {
  return { kind: "js", name: "js-test", filePath: "<test>", fn, meta };
}

function fakeWorkspaceContext(): WorkspaceContext {
  const raw = {
    name: "ws1",
    template_name: "coder-t",
    latest_build: { resources: [] },
  } as unknown as CoderWorkspace;
  return {
    name: "ws1",
    templateName: "coder-t",
    apps: [{ slug: "vscode", displayName: "VS Code", subdomainName: "ws1--vscode" }],
    appUrl: (slug: string) => `https://${slug}.example`,
    raw,
  };
}

describe("templateDisplay", () => {
  it("reports dynamic=true for JS templates without meta", () => {
    const src = jsSource(async () => ({
      coder: { template: "t" },
      type: "ephemeral",
      layout: { pane: { surfaces: [] } },
    }));
    expect(templateDisplay(src).dynamic).toBe(true);
  });

  it("reads meta fields for JS templates when present", () => {
    const src = jsSource(
      async () => ({ coder: { template: "t" }, type: "persistent", layout: { pane: { surfaces: [] } } }),
      { coder: { template: "owner-dev" }, type: "persistent", color: "#fff" },
    );
    const d = templateDisplay(src);
    expect(d.dynamic).toBe(false);
    expect(d.coderTemplate).toBe("owner-dev");
    expect(d.type).toBe("persistent");
    expect(d.color).toBe("#fff");
  });

  it("reads config fields for JSON sources", () => {
    const src = jsonSource({ name: "x", coder: { template: "c" }, type: "persistent", color: "#123" });
    const d = templateDisplay(src);
    expect(d.dynamic).toBe(false);
    expect(d.coderTemplate).toBe("c");
    expect(d.type).toBe("persistent");
    expect(d.color).toBe("#123");
  });
});

describe("materializeTemplate — JSON source (legacy path)", () => {
  it("substitutes {{vars}} from cliVars", async () => {
    const src = jsonSource({
      layout: { pane: { surfaces: [{ type: "terminal", command: "git checkout {{branch}}" }] } },
    });
    const { template, resolvedInputs } = await materializeTemplate(src, { cliVars: { branch: "feat" } });
    expect((template.layout as any).pane.surfaces[0].command).toBe("git checkout feat");
    expect(resolvedInputs).toEqual({});
  });

  it("does not invoke workspaceFactory for static JSON templates", async () => {
    let calls = 0;
    const src = jsonSource();
    await materializeTemplate(src, {
      workspaceFactory: async () => {
        calls++;
        return fakeWorkspaceContext();
      },
    });
    expect(calls).toBe(0);
  });

  it("does not mutate the source config (clones)", async () => {
    const src = jsonSource({
      layout: { pane: { surfaces: [{ type: "terminal", command: "echo {{x}}" }] } },
    });
    await materializeTemplate(src, { cliVars: { x: "hi" } });
    if (src.kind !== "json") throw new Error("expected json source");
    expect((src.config.layout as any).pane.surfaces[0].command).toBe("echo {{x}}");
  });
});

describe("materializeTemplate — JS source, static layout/ports", () => {
  it("runs the fn and returns resolved template without invoking factory", async () => {
    let factoryCalls = 0;
    const fn: TemplateFn = async ({ input }) => {
      const branch = await input.text("branch", { default: "main" });
      return {
        coder: { template: "coder-t", parameters: { branch } },
        type: "ephemeral",
        layout: { pane: { surfaces: [{ type: "terminal", command: `echo ${branch}` }] } },
        ports: [`3000:3000`],
      };
    };
    const src = jsSource(fn);
    const { template, resolvedInputs } = await materializeTemplate(src, {
      cliVars: { branch: "feat" },
      workspaceFactory: async () => {
        factoryCalls++;
        return fakeWorkspaceContext();
      },
    });
    expect(factoryCalls).toBe(0);
    expect(template.coder.parameters).toEqual({ branch: "feat" });
    expect((template.layout as any).pane.surfaces[0].command).toBe("echo feat");
    expect(template.ports).toEqual(["3000:3000"]);
    expect(resolvedInputs).toEqual({ branch: "feat" });
  });
});

describe("materializeTemplate — JS source, dynamic layout fn", () => {
  it("invokes workspaceFactory exactly once when layout is a fn", async () => {
    let factoryCalls = 0;
    const fn: TemplateFn = async () => ({
      coder: { template: "coder-t" },
      type: "ephemeral",
      layout: async ({ workspace }) => ({
        pane: { surfaces: [{ type: "browser", url: workspace.appUrl("vscode") }] },
      }),
      ports: async () => [`5173:5173`],
    });
    const src = jsSource(fn);
    const { template } = await materializeTemplate(src, {
      workspaceFactory: async () => {
        factoryCalls++;
        return fakeWorkspaceContext();
      },
    });
    expect(factoryCalls).toBe(1);
    expect((template.layout as any).pane.surfaces[0].url).toBe("https://vscode.example");
    expect(template.ports).toEqual(["5173:5173"]);
  });

  it("throws when layout is a fn but finalize has no workspace", async () => {
    const fn: TemplateFn = async () => ({
      coder: { template: "coder-t" },
      type: "ephemeral",
      layout: async () => ({ pane: { surfaces: [] } }),
    });
    const src = jsSource(fn);
    const prepared = await prepareTemplate(src, {});
    expect(prepared.needsWorkspace).toBe(true);
    await expect(prepared.finalize({})).rejects.toThrow(/dynamic layout/);
  });
});

describe("prepareTemplate — persistedVars feeds JS inputs", () => {
  it("restores previously persisted inputs without prompting", async () => {
    const fn: TemplateFn = async ({ input }) => {
      const port = await input.number("port", { default: 3000 });
      const branch = await input.text("branch", { default: "main" });
      return {
        coder: { template: "coder-t" },
        type: "ephemeral",
        layout: { pane: { surfaces: [{ type: "terminal", command: `${branch}:${port}` }] } },
      };
    };
    const src = jsSource(fn);
    const prepared = await prepareTemplate(src, {
      persistedVars: { port: 8080, branch: "stable" },
    });
    const template = await prepared.finalize();
    expect((template.layout as any).pane.surfaces[0].command).toBe("stable:8080");
    expect(prepared.resolvedInputs).toEqual({ port: 8080, branch: "stable" });
  });
});

describe("materializeTemplate — non-interactive mode (restore)", () => {
  it("resolves JS inputs from persistedVars + defaults without prompting", async () => {
    const fn: TemplateFn = async ({ input }) => {
      const branch = await input.text("branch", { default: "main" });
      const port = await input.number("port", { default: 3000 });
      return {
        coder: { template: "coder-t" },
        type: "ephemeral",
        layout: { pane: { surfaces: [{ type: "terminal", command: `${branch}:${port}` }] } },
      };
    };
    const { template } = await materializeTemplate(jsSource(fn), {
      interactive: false,
      persistedVars: { branch: "restored" },
    });
    expect((template.layout as any).pane.surfaces[0].command).toBe("restored:3000");
  });

  it("throws on a JS input that lacks persisted/cli/default", async () => {
    const fn: TemplateFn = async ({ input }) => {
      const branch = await input.text("branch");
      return {
        coder: { template: "coder-t" },
        type: "ephemeral",
        layout: { pane: { surfaces: [{ type: "terminal", command: branch }] } },
      };
    };
    await expect(
      materializeTemplate(jsSource(fn), { interactive: false }),
    ).rejects.toThrow(/non-interactive/);
  });

  it("throws on a JSON template {{var}} without a default in non-interactive mode", async () => {
    const src = jsonSource({
      layout: { pane: { surfaces: [{ type: "terminal", command: "echo {{missing}}" }] } },
    });
    await expect(
      materializeTemplate(src, { interactive: false }),
    ).rejects.toThrow(/non-interactive/);
  });

  it("uses JSON template defaults in non-interactive mode", async () => {
    const src = jsonSource({
      variables: { name: { default: "world" } },
      layout: { pane: { surfaces: [{ type: "terminal", command: "echo {{name}}" }] } },
    });
    const { template } = await materializeTemplate(src, { interactive: false });
    expect((template.layout as any).pane.surfaces[0].command).toBe("echo world");
  });
});
