import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";

export const KEY_DIR = join(homedir(), ".config", "cx");
export const KEY_PATH = join(KEY_DIR, "serve-key");

export async function loadOrCreateApiKey(): Promise<string> {
  if (existsSync(KEY_PATH)) {
    const file = Bun.file(KEY_PATH);
    const text = (await file.text()).trim();
    if (text.length > 0) return text;
  }
  mkdirSync(KEY_DIR, { recursive: true });
  const key = randomBytes(32).toString("hex");
  await Bun.write(KEY_PATH, key + "\n");
  chmodSync(KEY_PATH, 0o600);
  return key;
}

export function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
