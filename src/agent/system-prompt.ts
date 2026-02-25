import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data");

function safeRead(path: string): string {
  try {
    if (existsSync(path)) {
      return readFileSync(path, "utf-8").trim();
    }
  } catch {
    // File unreadable — not fatal
  }
  return "";
}

/**
 * Build Jinx's system prompt by appending BORN.md + runtime context
 * to Pi's default system prompt.
 *
 * Uses the callback form: (defaultPrompt) => extendedPrompt
 */
export function buildJinxSystemPrompt(defaultPrompt: string): string {
  const born = safeRead(join(process.cwd(), "BORN.md"));
  const identity = safeRead(join(DATA_DIR, "identity.md"));
  const scratchpad = safeRead(join(DATA_DIR, "scratchpad.md"));
  const goals = safeRead(join(DATA_DIR, "goals.md"));
  const stateRaw = safeRead(join(DATA_DIR, "state.json"));

  const sections: string[] = [defaultPrompt];

  if (born) {
    sections.push(`\n\n# BORN.md (宪法)\n\n${born}`);
  }

  if (identity) {
    sections.push(`\n\n# Identity\n\n${identity}`);
  }

  if (scratchpad) {
    sections.push(`\n\n# Scratchpad\n\n${scratchpad}`);
  }

  if (goals) {
    sections.push(`\n\n# Goals\n\n${goals}`);
  }

  if (stateRaw) {
    sections.push(`\n\n# Runtime State\n\n\`\`\`json\n${stateRaw}\n\`\`\``);
  }

  // Runtime context
  const runtimeInfo = [
    `- UTC: ${new Date().toISOString()}`,
    `- CWD: ${process.cwd()}`,
    `- Node: ${process.version}`,
    `- PID: ${process.pid}`,
  ].join("\n");

  sections.push(`\n\n# Runtime\n\n${runtimeInfo}`);

  return sections.join("");
}
