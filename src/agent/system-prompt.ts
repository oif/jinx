import { readFileSync, existsSync, readdirSync } from "node:fs";
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

function loadKnowledge(): string {
  const knowledgeDir = join(DATA_DIR, "knowledge");
  if (!existsSync(knowledgeDir)) {
    return "";
  }

  try {
    const files = readdirSync(knowledgeDir);
    const entries: string[] = [];

    for (const file of files) {
      if (file.endsWith(".md")) {
        const content = safeRead(join(knowledgeDir, file));
        if (content) {
          entries.push(`### ${file}\n${content}`);
        }
      }
    }

    return entries.length > 0 ? entries.join("\n\n") : "";
  } catch {
    return "";
  }
}

/**
 * Build Jinx's system prompt by appending BORN.md + runtime context
 * to Pi's default system prompt.
 *
 * Uses the callback form: (defaultPrompt) => extendedPrompt
 */
/**
 * Build Jinx's system prompt by appending BORN.md + runtime context
 * to Pi's default system prompt.
 *
 * @param defaultPrompt - Pi's base system prompt
 * @param slim - If true, skip knowledge base (for worker sessions doing focused tasks)
 *
 * Uses the callback form: (defaultPrompt) => extendedPrompt
 */
export function buildJinxSystemPrompt(defaultPrompt: string, slim = false): string {
  const born = safeRead(join(process.cwd(), "BORN.md"));
  const identity = safeRead(join(DATA_DIR, "identity.md"));
  const scratchpad = safeRead(join(DATA_DIR, "scratchpad.md"));
  const goals = safeRead(join(DATA_DIR, "goals.md"));
  const stateRaw = safeRead(join(DATA_DIR, "state.json"));
  // Skip knowledge base in slim mode (worker sessions doing focused tasks)
  const knowledge = slim ? "" : loadKnowledge();

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

  if (knowledge) {
    sections.push(`\n\n# Knowledge Base\n\n${knowledge}`);
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

  // Hard prohibitions — enforced at system level
  sections.push(`\n\n# System Prohibitions

The following files are managed automatically by the system. **Never create or modify them manually:**

- \`EVOLOG.md\` — deprecated, do not create or touch this file
- \`data/state.json\` — updated only via internal saveState() calls

During an Evolution Cycle:
- Focus exclusively on the assigned task from backlog.md
- Do not make "update statistics", "fix data inconsistency", or metadata-only commits
- Every commit must correspond to real, functional work on the task`);

  return sections.join("");
}
