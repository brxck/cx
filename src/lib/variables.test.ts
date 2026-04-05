import { describe, it, expect } from "bun:test";
import { extractVariables, parseVarsArg, resolveVariables } from "./variables.ts";
import type { TemplateConfig } from "./templates.ts";

function makeTemplate(overrides: Partial<TemplateConfig> = {}): TemplateConfig {
  return {
    name: "test",
    coder: { template: "test-template" },
    type: "ephemeral",
    layout: { pane: { surfaces: [{ type: "terminal" }] } },
    ...overrides,
  };
}

describe("extractVariables", () => {
  it("returns variable names from command fields", () => {
    const t = makeTemplate({
      layout: {
        pane: {
          surfaces: [
            { type: "terminal", command: "cd {{project_dir}} && git checkout {{branch}}" },
          ],
        },
      },
    });
    expect(extractVariables(t).sort()).toEqual(["branch", "project_dir"]);
  });

  it("returns variable names from url fields", () => {
    const t = makeTemplate({
      layout: {
        pane: {
          surfaces: [
            { type: "browser", url: "http://localhost:{{port}}/{{path}}" },
          ],
        },
      },
    });
    expect(extractVariables(t).sort()).toEqual(["path", "port"]);
  });

  it("returns variable names from ports entries", () => {
    const t = makeTemplate({
      ports: ["{{local_port}}:{{remote_port}}"],
    });
    expect(extractVariables(t).sort()).toEqual(["local_port", "remote_port"]);
  });

  it("returns empty array when no variables present", () => {
    const t = makeTemplate({
      layout: {
        pane: {
          surfaces: [{ type: "terminal", command: "echo hello" }],
        },
      },
    });
    expect(extractVariables(t)).toEqual([]);
  });

  it("deduplicates repeated variable names", () => {
    const t = makeTemplate({
      layout: {
        pane: {
          surfaces: [
            { type: "terminal", command: "{{branch}} {{branch}} {{branch}}" },
          ],
        },
      },
    });
    expect(extractVariables(t)).toEqual(["branch"]);
  });

  it("extracts from nested split layouts", () => {
    const t = makeTemplate({
      layout: {
        direction: "horizontal" as const,
        children: [
          { pane: { surfaces: [{ type: "terminal" as const, command: "{{left_cmd}}" }] } },
          { pane: { surfaces: [{ type: "terminal" as const, command: "{{right_cmd}}" }] } },
        ],
      },
    });
    expect(extractVariables(t).sort()).toEqual(["left_cmd", "right_cmd"]);
  });
});

describe("parseVarsArg", () => {
  it("parses a single key=value pair", () => {
    expect(parseVarsArg("branch=main")).toEqual({ branch: "main" });
  });

  it("parses multiple comma-separated pairs", () => {
    expect(parseVarsArg("a=1,b=2")).toEqual({ a: "1", b: "2" });
  });

  it("handles values containing =", () => {
    expect(parseVarsArg("cmd=foo=bar")).toEqual({ cmd: "foo=bar" });
  });

  it("returns empty record for empty string", () => {
    expect(parseVarsArg("")).toEqual({});
  });

  it("returns empty record for whitespace-only string", () => {
    expect(parseVarsArg("   ")).toEqual({});
  });

  it("skips entries without =", () => {
    expect(parseVarsArg("good=val,badentry,ok=yes")).toEqual({ good: "val", ok: "yes" });
  });
});

describe("resolveVariables", () => {
  it("substitutes CLI-provided values into command fields", async () => {
    const t = makeTemplate({
      layout: {
        pane: {
          surfaces: [
            { type: "terminal", command: "git checkout {{branch}}" },
          ],
        },
      },
    });
    await resolveVariables(t, { branch: "develop" });
    expect(t.layout).toEqual({
      pane: {
        surfaces: [
          { type: "terminal", command: "git checkout develop" },
        ],
      },
    });
  });

  it("substitutes CLI-provided values into url fields", async () => {
    const t = makeTemplate({
      layout: {
        pane: {
          surfaces: [
            { type: "browser", url: "http://localhost:{{port}}" },
          ],
        },
      },
    });
    await resolveVariables(t, { port: "8080" });
    expect((t.layout as any).pane.surfaces[0].url).toBe("http://localhost:8080");
  });

  it("substitutes CLI-provided values into ports entries", async () => {
    const t = makeTemplate({
      ports: ["{{lp}}:{{rp}}"],
      layout: {
        pane: {
          surfaces: [{ type: "terminal", command: "{{lp}}" }],
        },
      },
    });
    await resolveVariables(t, { lp: "3000", rp: "3000" });
    expect(t.ports).toEqual(["3000:3000"]);
  });

  it("uses template defaults when CLI value not provided", async () => {
    const t = makeTemplate({
      variables: { branch: { default: "main" } },
      layout: {
        pane: {
          surfaces: [
            { type: "terminal", command: "git checkout {{branch}}" },
          ],
        },
      },
    });
    await resolveVariables(t, {});
    expect((t.layout as any).pane.surfaces[0].command).toBe("git checkout main");
  });

  it("CLI values take precedence over template defaults", async () => {
    const t = makeTemplate({
      variables: { branch: { default: "main" } },
      layout: {
        pane: {
          surfaces: [
            { type: "terminal", command: "git checkout {{branch}}" },
          ],
        },
      },
    });
    await resolveVariables(t, { branch: "feature" });
    expect((t.layout as any).pane.surfaces[0].command).toBe("git checkout feature");
  });

  it("handles multiple variables in a single command string", async () => {
    const t = makeTemplate({
      layout: {
        pane: {
          surfaces: [
            { type: "terminal", command: "cd {{dir}} && git checkout {{branch}} && npm run {{script}}" },
          ],
        },
      },
    });
    await resolveVariables(t, { dir: "~/app", branch: "main", script: "dev" });
    expect((t.layout as any).pane.surfaces[0].command).toBe(
      "cd ~/app && git checkout main && npm run dev",
    );
  });

  it("handles same variable across multiple surfaces in nested splits", async () => {
    const t = makeTemplate({
      layout: {
        direction: "horizontal" as const,
        children: [
          { pane: { surfaces: [{ type: "terminal" as const, command: "cd {{dir}}" }] } },
          { pane: { surfaces: [{ type: "terminal" as const, command: "ls {{dir}}" }] } },
        ],
      },
    });
    await resolveVariables(t, { dir: "/home" });
    const left = (t.layout as any).children[0].pane.surfaces[0];
    const right = (t.layout as any).children[1].pane.surfaces[0];
    expect(left.command).toBe("cd /home");
    expect(right.command).toBe("ls /home");
  });

  it("mutates template in place", async () => {
    const t = makeTemplate({
      layout: {
        pane: {
          surfaces: [
            { type: "terminal", command: "{{cmd}}" },
          ],
        },
      },
    });
    const ref = t;
    await resolveVariables(t, { cmd: "echo hi" });
    expect(ref).toBe(t);
    expect((ref.layout as any).pane.surfaces[0].command).toBe("echo hi");
  });

  it("is a no-op when template has no variables", async () => {
    const t = makeTemplate({
      layout: {
        pane: {
          surfaces: [
            { type: "terminal", command: "echo hello" },
          ],
        },
      },
    });
    await resolveVariables(t, { unused: "value" });
    expect((t.layout as any).pane.surfaces[0].command).toBe("echo hello");
  });

  it("handles empty default as a valid value", async () => {
    const t = makeTemplate({
      variables: { flags: { default: "" } },
      layout: {
        pane: {
          surfaces: [
            { type: "terminal", command: "npm run dev {{flags}}" },
          ],
        },
      },
    });
    await resolveVariables(t, {});
    expect((t.layout as any).pane.surfaces[0].command).toBe("npm run dev ");
  });
});
