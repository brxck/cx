import * as p from "@clack/prompts";

/** JS/TS templates declare typed inputs through this helper surface. */
export interface InputHelpers {
  text(name: string, opts?: TextOpts): Promise<string>;
  number(name: string, opts?: NumberOpts): Promise<number>;
  confirm(name: string, opts?: ConfirmOpts): Promise<boolean>;
  select(name: string, opts: SelectOpts): Promise<string>;
  multiselect(name: string, opts: MultiSelectOpts): Promise<string[]>;
}

export interface CommonOpts {
  description?: string;
}
export interface TextOpts extends CommonOpts {
  default?: string;
}
export interface NumberOpts extends CommonOpts {
  default?: number;
}
export interface ConfirmOpts extends CommonOpts {
  default?: boolean;
}
export interface SelectOpts extends CommonOpts {
  options: Array<string | { value: string; label?: string }>;
  default?: string;
}
export interface MultiSelectOpts extends CommonOpts {
  options: Array<string | { value: string; label?: string }>;
  default?: string[];
}

/** Shape of the `vars` blob persisted in the store for restore. */
export type ResolvedInputs = Record<string, unknown>;

export interface InputContext {
  /** Values persisted from a previous run (restore path). Highest priority. */
  persistedVars?: ResolvedInputs;
  /** Values from `--vars` on the CLI. Second-highest priority. */
  cliVars?: Record<string, string>;
  /**
   * When false, helpers never prompt — they resolve via persisted → cli → default
   * and throw if none applies. Used by `cx restore` to replay without reprompting.
   * Defaults to true.
   */
  interactive?: boolean;
}

/**
 * Create input helpers for a template function.
 *
 * Priority per input name:
 *   - interactive: persistedVars → cliVars → prompt (with `opts.default` as initial value).
 *   - non-interactive (restore): persistedVars → cliVars → opts.default → throw.
 *
 * Returns the helpers plus a `resolvedInputs` record (keyed by input name)
 * that should be persisted to the store for later restore.
 */
export function createInputHelpers(ctx: InputContext = {}): {
  input: InputHelpers;
  resolvedInputs: ResolvedInputs;
} {
  const persisted = ctx.persistedVars ?? {};
  const cli = ctx.cliVars ?? {};
  const interactive = ctx.interactive !== false;
  const resolved: ResolvedInputs = {};

  function cancel(): never {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  function nonInteractive(name: string): never {
    throw new Error(
      `Input "${name}" has no persisted, CLI, or default value — cannot prompt in non-interactive mode`,
    );
  }

  function message(name: string, opts: CommonOpts | undefined): string {
    return opts?.description ?? `Value for ${name}`;
  }

  function normalizeOptions(
    options: Array<string | { value: string; label?: string }>,
  ): Array<{ value: string; label: string }> {
    return options.map((o) =>
      typeof o === "string" ? { value: o, label: o } : { value: o.value, label: o.label ?? o.value },
    );
  }

  const input: InputHelpers = {
    async text(name, opts) {
      const record = (value: string): string => {
        resolved[name] = value;
        return value;
      };
      if (name in persisted) {
        const val = persisted[name];
        if (typeof val !== "string") {
          throw new Error(`Persisted input "${name}" expected string, got ${typeof val}`);
        }
        return record(val);
      }
      if (name in cli) return record(cli[name]!);
      if (!interactive) {
        if (opts?.default !== undefined) return record(opts.default);
        nonInteractive(name);
      }
      const value = await p.text({
        message: message(name, opts),
        placeholder: name,
        initialValue: opts?.default,
      });
      if (p.isCancel(value)) cancel();
      return record(value as string);
    },

    async number(name, opts) {
      const record = (value: number): number => {
        resolved[name] = value;
        return value;
      };
      if (name in persisted) {
        const val = persisted[name];
        if (typeof val !== "number") {
          throw new Error(`Persisted input "${name}" expected number, got ${typeof val}`);
        }
        return record(val);
      }
      if (name in cli) {
        const n = Number(cli[name]);
        if (!Number.isFinite(n)) {
          throw new Error(`Input "${name}" expected number, got ${JSON.stringify(cli[name])}`);
        }
        return record(n);
      }
      if (!interactive) {
        if (opts?.default !== undefined) return record(opts.default);
        nonInteractive(name);
      }
      const value = await p.text({
        message: message(name, opts),
        placeholder: name,
        initialValue: opts?.default !== undefined ? String(opts.default) : undefined,
        validate: (v) => {
          if (!v?.trim()) return `${name} is required`;
          if (!Number.isFinite(Number(v))) return `${name} must be a number`;
        },
      });
      if (p.isCancel(value)) cancel();
      return record(Number(value as string));
    },

    async confirm(name, opts) {
      const record = (value: boolean): boolean => {
        resolved[name] = value;
        return value;
      };
      if (name in persisted) {
        const val = persisted[name];
        if (typeof val !== "boolean") {
          throw new Error(`Persisted input "${name}" expected boolean, got ${typeof val}`);
        }
        return record(val);
      }
      if (name in cli) {
        const raw = cli[name]!.toLowerCase();
        if (raw === "true" || raw === "1" || raw === "yes") return record(true);
        if (raw === "false" || raw === "0" || raw === "no") return record(false);
        throw new Error(`Input "${name}" expected boolean, got ${JSON.stringify(cli[name])}`);
      }
      if (!interactive) {
        if (opts?.default !== undefined) return record(opts.default);
        nonInteractive(name);
      }
      const value = await p.confirm({
        message: message(name, opts),
        initialValue: opts?.default ?? false,
      });
      if (p.isCancel(value)) cancel();
      return record(value as boolean);
    },

    async select(name, opts) {
      const record = (value: string): string => {
        resolved[name] = value;
        return value;
      };
      if (name in persisted) {
        const val = persisted[name];
        if (typeof val !== "string") {
          throw new Error(`Persisted input "${name}" expected string, got ${typeof val}`);
        }
        return record(val);
      }
      if (name in cli) return record(cli[name]!);
      if (!interactive) {
        if (opts.default !== undefined) return record(opts.default);
        nonInteractive(name);
      }
      const value = await p.autocomplete({
        message: message(name, opts),
        options: normalizeOptions(opts.options),
        initialValue: opts.default,
        placeholder: "Type to filter",
      });
      if (p.isCancel(value)) cancel();
      return record(value as string);
    },

    async multiselect(name, opts) {
      const record = (value: string[]): string[] => {
        resolved[name] = value;
        return value;
      };
      if (name in persisted) {
        const val = persisted[name];
        if (!Array.isArray(val) || val.some((v) => typeof v !== "string")) {
          throw new Error(`Persisted input "${name}" expected string[], got ${typeof val}`);
        }
        return record(val as string[]);
      }
      if (name in cli) {
        const parts = cli[name]!
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        return record(parts);
      }
      if (!interactive) {
        if (opts.default !== undefined) return record(opts.default);
        nonInteractive(name);
      }
      const value = await p.multiselect({
        message: message(name, opts),
        options: normalizeOptions(opts.options),
        initialValues: opts.default,
        required: false,
      });
      if (p.isCancel(value)) cancel();
      return record(value as string[]);
    },
  };

  return { input, resolvedInputs: resolved };
}
