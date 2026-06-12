import { defineCommand } from "citty";
import { consola } from "consola";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import {
  requireCoderLogin,
  createTask,
  listTasks,
  taskUrl,
  getCoderUrl,
  type CoderTask,
} from "../lib/coder.ts";
import {
  templateSystemPrompt,
  DEFAULT_TASK_SYSTEM_PROMPT,
  staticTaskConfig,
  isTaskTemplate,
} from "../lib/templates.ts";
import { resolveSourceOrDefault } from "../lib/template-picker.ts";

const PROMPTS_DIR = join(homedir(), ".cx", "prompts");

const EDITOR_TEMPLATE = `\
# Enter your task prompt below.
# Lines starting with # are stripped out before being sent to Coder.
# Save and close the editor to submit.

`;

export const taskCommand = defineCommand({
  meta: {
    name: "task",
    description: "Create a Coder Task from a template's system prompt",
  },
  args: {
    prompt: {
      type: "positional",
      description: "Task prompt (quote it); or pipe stdin, pass --file, or use --editor",
      required: false,
    },
    template: {
      type: "string",
      alias: "t",
      description: "cx template whose coder template + system prompt back the task",
    },
    file: {
      type: "string",
      alias: "f",
      description: "Read prompt text from a file (comma-separate multiple; contents become task context)",
    },
    "system-prompt": {
      type: "string",
      description: "Override the template's system prompt",
    },
    editor: {
      type: "boolean",
      alias: "e",
      description: "Open $EDITOR to compose the prompt",
      default: false,
    },
  },
  async run({ args }) {
    await requireCoderLogin();

    const userPrompt = await resolveTaskPrompt({
      positional: args.prompt as string | undefined,
      files: parseFiles(args.file),
      forceEditor: args.editor as boolean,
    });

    const { source } = await resolveSourceOrDefault(args.template as string | undefined, {
      filter: isTaskTemplate,
      noun: "task templates",
    });

    const coder = staticTaskConfig(source);
    if (!coder.template) {
      consola.error(
        `Template ${pc.bold(source.name)} has no static coder template — add a \`coder.template\` (JSON) or \`meta.coder.template\` (JS) so \`cx task\` can target it.`,
      );
      process.exit(1);
    }
    if (coder.type !== "task") {
      consola.error(
        coder.type === "persistent"
          ? `Template ${pc.bold(source.name)} is persistent — \`cx task\` only supports task templates.`
          : `Template ${pc.bold(source.name)} has no static \`type: "task"\` — \`cx task\` only supports task templates declared statically (set \`type\` in the JSON config or the JS \`meta\` export).`,
      );
      process.exit(1);
    }

    const systemPrompt =
      (args["system-prompt"] as string | undefined) ??
      templateSystemPrompt(source) ??
      DEFAULT_TASK_SYSTEM_PROMPT;
    const fullPrompt = `${systemPrompt.trim()}\n\n---\n\n${userPrompt}`;

    p.intro(pc.bold("cx task"));

    const spinner = p.spinner();
    spinner.start("Creating task");
    let id: string;
    try {
      id = await createTask(fullPrompt, { template: coder.template, preset: coder.preset });
    } catch (err) {
      spinner.error("Failed to create task");
      consola.error((err as Error).message);
      process.exit(1);
    }
    spinner.stop(`Created task ${pc.cyan(id)}`);

    let promptPath: string | undefined;
    try {
      promptPath = savePrompt(id, userPrompt);
    } catch (err) {
      p.log.warn(`Could not save prompt to disk: ${(err as Error).message}`);
    }

    const lines: string[] = [];
    lines.push(`${pc.dim("Task")}       ${id}`);
    const url = await dashboardUrl(id);
    if (url) lines.push(`${pc.dim("Dashboard")}  ${url}`);
    lines.push(`${pc.dim("Logs")}       coder task logs ${id}`);
    if (promptPath) lines.push(`${pc.dim("Prompt")}     ${promptPath}`);
    p.log.message(lines.join("\n"));

    p.outro(`${pc.green("✓")} Task created`);
  },
});

async function dashboardUrl(taskId: string): Promise<string | undefined> {
  try {
    const [tasks, base] = await Promise.all([listTasks().catch((): CoderTask[] => []), getCoderUrl()]);
    const owner = tasks.find((t) => t.id === taskId)?.owner_name;
    return owner ? taskUrl(base, owner, taskId) : undefined;
  } catch {
    return undefined;
  }
}

// ── Prompt input ──

/**
 * Resolve the user prompt from files, piped stdin, a positional arg, or $EDITOR.
 * Files and stdin act as context; a positional is the instruction. With both,
 * context is wrapped in <context>…</context> ahead of the instruction. With only
 * context (no positional), the context itself is the prompt.
 */
async function resolveTaskPrompt(opts: {
  positional?: string;
  files: string[];
  forceEditor: boolean;
}): Promise<string> {
  const contextParts: string[] = [];

  for (const file of opts.files) {
    let content: string;
    try {
      content = (await Bun.file(file).text()).trim();
    } catch {
      consola.error(`Could not read prompt file: ${file}`);
      process.exit(1);
    }
    if (content) contextParts.push(content);
  }

  if (process.stdin.isTTY !== true) {
    const stdin = await readStdin();
    if (stdin) contextParts.push(stdin);
  }

  const context = contextParts.join("\n\n");

  if (opts.positional && context) {
    return `<context>\n${context}\n</context>\n\n${opts.positional}`;
  }
  if (opts.positional) return opts.positional;
  if (context) return context;

  if (opts.forceEditor || process.stdin.isTTY) {
    const content = openEditor();
    if (!content) {
      consola.error("No prompt provided. Aborting.");
      process.exit(1);
    }
    return content;
  }

  consola.error("No prompt provided. Pass a prompt argument, --file, pipe stdin, or use --editor.");
  process.exit(1);
}

/** Normalize the --file arg into a list of paths, splitting comma-separated values. */
function parseFiles(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : [];
  return raw
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

async function readStdin(): Promise<string> {
  return (await Bun.stdin.text()).trim();
}

/** Open $EDITOR / $VISUAL (fallback vim) on a temp file, strip `#` comment lines. */
function openEditor(): string {
  const editor = process.env.EDITOR || process.env.VISUAL || "vim";
  const tmpFile = join(tmpdir(), `cx-task-${Date.now()}.md`);
  writeFileSync(tmpFile, EDITOR_TEMPLATE, "utf8");
  try {
    const [bin, ...editorArgs] = editor.trim().split(/\s+/);
    const proc = Bun.spawnSync([bin!, ...editorArgs, tmpFile], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if (!proc.success) {
      consola.error(`Editor "${editor}" exited with an error.`);
      process.exit(1);
    }
    return readFileSync(tmpFile, "utf8")
      .split("\n")
      .filter((line) => !line.startsWith("#"))
      .join("\n")
      .trim();
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {}
  }
}

function savePrompt(taskId: string, prompt: string): string {
  mkdirSync(PROMPTS_DIR, { recursive: true });
  const filePath = join(PROMPTS_DIR, `${taskId}.md`);
  writeFileSync(filePath, prompt, "utf8");
  return filePath;
}
