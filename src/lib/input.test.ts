import { describe, it, expect } from "bun:test";
import { createInputHelpers } from "./input.ts";

// All interactive-mode tests must supply either persistedVars or cliVars for every
// input, since `default` no longer bypasses the prompt. Tests that exercise the
// default-fallback path run under `interactive: false`.

describe("createInputHelpers priority (interactive mode)", () => {
  it("text: persistedVars wins over cliVars", async () => {
    {
      const { input, resolvedInputs } = createInputHelpers({
        persistedVars: { name: "persisted" },
        cliVars: { name: "cli" },
      });
      expect(await input.text("name", { default: "fallback" })).toBe("persisted");
      expect(resolvedInputs.name).toBe("persisted");
    }
    {
      const { input } = createInputHelpers({ cliVars: { name: "cli" } });
      expect(await input.text("name", { default: "fallback" })).toBe("cli");
    }
  });

  it("number: coerces cliVars strings and prefers persistedVars", async () => {
    {
      const { input } = createInputHelpers({ persistedVars: { port: 5173 } });
      expect(await input.number("port", { default: 3000 })).toBe(5173);
    }
    {
      const { input } = createInputHelpers({ cliVars: { port: "8080" } });
      expect(await input.number("port", { default: 3000 })).toBe(8080);
    }
  });

  it("confirm: accepts true/false/1/0/yes/no from cliVars and prefers persistedVars", async () => {
    {
      const { input } = createInputHelpers({ persistedVars: { open: false } });
      expect(await input.confirm("open", { default: true })).toBe(false);
    }
    {
      const { input } = createInputHelpers({ cliVars: { open: "true" } });
      expect(await input.confirm("open", { default: false })).toBe(true);
    }
    {
      const { input } = createInputHelpers({ cliVars: { open: "no" } });
      expect(await input.confirm("open", { default: true })).toBe(false);
    }
  });

  it("select: persistedVars > cliVars", async () => {
    const options = ["alpha", "beta", "gamma"];
    {
      const { input } = createInputHelpers({ persistedVars: { pick: "gamma" } });
      expect(await input.select("pick", { options, default: "alpha" })).toBe("gamma");
    }
    {
      const { input } = createInputHelpers({ cliVars: { pick: "beta" } });
      expect(await input.select("pick", { options, default: "alpha" })).toBe("beta");
    }
  });

  it("multiselect: persistedVars array, cliVars comma-split", async () => {
    const options = ["a", "b", "c"];
    {
      const { input } = createInputHelpers({ persistedVars: { picks: ["a", "c"] } });
      expect(await input.multiselect("picks", { options, default: [] })).toEqual(["a", "c"]);
    }
    {
      const { input } = createInputHelpers({ cliVars: { picks: "a, c" } });
      expect(await input.multiselect("picks", { options, default: [] })).toEqual(["a", "c"]);
    }
  });

  it("resolvedInputs records every resolved input by name", async () => {
    const { input, resolvedInputs } = createInputHelpers({
      persistedVars: { branch: "main" },
      cliVars: { port: "5173", browser: "true", picks: "a,b" },
    });
    await input.text("branch", { default: "develop" });
    await input.number("port", { default: 3000 });
    await input.confirm("browser", { default: false });
    await input.multiselect("picks", { options: ["a", "b", "c"], default: [] });
    expect(resolvedInputs).toEqual({
      branch: "main",
      port: 5173,
      browser: true,
      picks: ["a", "b"],
    });
  });

  it("number throws on non-numeric cliVars value", async () => {
    const { input } = createInputHelpers({ cliVars: { port: "notanumber" } });
    await expect(input.number("port", { default: 0 })).rejects.toThrow(/expected number/);
  });

  it("confirm throws on unparseable cliVars value", async () => {
    const { input } = createInputHelpers({ cliVars: { open: "maybe" } });
    await expect(input.confirm("open", { default: false })).rejects.toThrow(/expected boolean/);
  });
});

describe("createInputHelpers non-interactive mode (restore)", () => {
  it("text falls back to default without prompting", async () => {
    const { input } = createInputHelpers({ interactive: false });
    expect(await input.text("branch", { default: "main" })).toBe("main");
  });

  it("number falls back to default without prompting", async () => {
    const { input } = createInputHelpers({ interactive: false });
    expect(await input.number("port", { default: 3000 })).toBe(3000);
  });

  it("confirm falls back to default without prompting", async () => {
    const { input } = createInputHelpers({ interactive: false });
    expect(await input.confirm("open", { default: true })).toBe(true);
  });

  it("select falls back to default without prompting", async () => {
    const { input } = createInputHelpers({ interactive: false });
    expect(await input.select("pick", { options: ["a", "b"], default: "b" })).toBe("b");
  });

  it("multiselect falls back to default without prompting", async () => {
    const { input } = createInputHelpers({ interactive: false });
    expect(
      await input.multiselect("picks", { options: ["a", "b", "c"], default: ["a", "c"] }),
    ).toEqual(["a", "c"]);
  });

  it("text throws when no persisted/cli/default is available", async () => {
    const { input } = createInputHelpers({ interactive: false });
    await expect(input.text("branch")).rejects.toThrow(/non-interactive/);
  });

  it("number throws when no value is available", async () => {
    const { input } = createInputHelpers({ interactive: false });
    await expect(input.number("port")).rejects.toThrow(/non-interactive/);
  });

  it("confirm throws when no value is available", async () => {
    const { input } = createInputHelpers({ interactive: false });
    await expect(input.confirm("browser")).rejects.toThrow(/non-interactive/);
  });

  it("select throws when no value is available", async () => {
    const { input } = createInputHelpers({ interactive: false });
    await expect(input.select("pick", { options: ["a", "b"] })).rejects.toThrow(/non-interactive/);
  });

  it("multiselect throws when no value is available", async () => {
    const { input } = createInputHelpers({ interactive: false });
    await expect(input.multiselect("picks", { options: ["a", "b"] })).rejects.toThrow(/non-interactive/);
  });

  it("persistedVars / cliVars still take precedence", async () => {
    {
      const { input } = createInputHelpers({ interactive: false, persistedVars: { branch: "main" } });
      expect(await input.text("branch")).toBe("main");
    }
    {
      const { input } = createInputHelpers({ interactive: false, cliVars: { port: "8080" } });
      expect(await input.number("port")).toBe(8080);
    }
  });
});
