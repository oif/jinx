import { execSync, type ExecSyncOptions } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import type {
  ToolDefinition,
  ExtensionContext,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@mariozechner/pi-coding-agent";

// ── Types ──────────────────────────────────────────────────────────

/**
 * Helper: create a text-only AgentToolResult from a string.
 */
function textResult(text: string): AgentToolResult<undefined> {
  return {
    content: [{ type: "text", text }],
    details: undefined,
  };
}

// ── Helpers ────────────────────────────────────────────────────────

const DATA_DIR = join(process.cwd(), "data");
const RESTART_MARKER = join(DATA_DIR, ".restart_requested");

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function shell(cmd: string, opts?: ExecSyncOptions): string {
  const result = execSync(cmd, {
    encoding: "utf-8",
    timeout: 300_000,
    ...opts,
  });
  return (result as string).trim();
}

// ── Parameter Schemas ──────────────────────────────────────────────

const claudeCodeParams = Type.Object({
  task: Type.String({ description: "Task description for Claude Code" }),
  cwd: Type.Optional(
    Type.String({ description: "Working directory (default: project root)" })
  ),
});

const reasonParams = Type.Object({
  reason: Type.String({ description: "Why restart is needed" }),
});

const contentParams = Type.Object({
  content: Type.String({ description: "New content (markdown)" }),
});

const stateParams = Type.Object({
  key: Type.String({ description: "State key to update" }),
  value: Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()], {
    description: "New value",
  }),
});

const knowledgeParams = Type.Object({
  slug: Type.String({ description: "Filename slug (e.g. 'git-rebase-tips')" }),
  content: Type.String({ description: "Knowledge content (markdown)" }),
});

// ── Tools ──────────────────────────────────────────────────────────

/**
 * Claude Code CLI — Jinx's "hands" for complex code editing.
 * Uses --print mode for non-interactive output.
 */
export const claudeCodeTool: ToolDefinition = {
  name: "claude_code",
  label: "Claude Code",
  description:
    "Use Claude Code CLI for complex code editing tasks. " +
    "Provide a task description. Claude Code will read/write files, " +
    "run commands, and return the result. " +
    "Use this for multi-file changes or tasks requiring deep code understanding. " +
    "For simple single-file edits, prefer Pi's built-in write/edit tools.",
  parameters: claudeCodeParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    const task = params.task as string;
    const cwd = (params.cwd as string) || process.cwd();
    try {
      const result = shell(
        `claude --print --dangerously-skip-permissions "${task.replace(/"/g, '\\"')}"`,
        { cwd, timeout: 600_000 }
      );
      return textResult(result || "(Claude Code completed with no output)");
    } catch (e) {
      const err = e as Error & { status?: number; stderr?: string };
      return textResult(
        `Claude Code error (exit ${err.status ?? "?"}): ${err.stderr || err.message}`
      );
    }
  },
};

/**
 * Request process restart to load new code after self-modification.
 * Writes a marker file that the supervisor polls for.
 */
export const requestRestartTool: ToolDefinition = {
  name: "request_restart",
  label: "Request Restart",
  description:
    "Request process restart to load newly committed code. " +
    "Only use AFTER committing and pushing changes to the dev branch. " +
    "The supervisor will pull new code, rebuild, and restart the process.",
  parameters: reasonParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    ensureDataDir();

    let sha = "unknown";
    try {
      sha = shell("git rev-parse HEAD", { cwd: process.cwd() });
    } catch {
      // git not available or not a repo — continue anyway
    }

    const marker = {
      reason: params.reason as string,
      sha,
      requestedAt: new Date().toISOString(),
    };
    writeFileSync(RESTART_MARKER, JSON.stringify(marker, null, 2));
    return textResult(`Restart requested: ${params.reason}. Supervisor will restart shortly.`);
  },
};

/**
 * Update identity.md — Jinx's self-description.
 */
export const updateIdentityTool: ToolDefinition = {
  name: "update_identity",
  label: "Update Identity",
  description:
    "Update your identity file (data/identity.md). " +
    "Use this when you learn something fundamental about yourself. " +
    "This is your persistent self-description that survives restarts.",
  parameters: contentParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    ensureDataDir();
    writeFileSync(join(DATA_DIR, "identity.md"), params.content as string);
    return textResult("Identity updated.");
  },
};

/**
 * Update scratchpad.md — Jinx's working memory.
 */
export const updateScratchpadTool: ToolDefinition = {
  name: "update_scratchpad",
  label: "Update Scratchpad",
  description:
    "Update your scratchpad (data/scratchpad.md). " +
    "Use this freely as working memory — notes, plans, observations. " +
    "Persists across restarts.",
  parameters: contentParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    ensureDataDir();
    writeFileSync(join(DATA_DIR, "scratchpad.md"), params.content as string);
    return textResult("Scratchpad updated.");
  },
};

/**
 * Update state.json — runtime state tracking.
 */
export const updateStateTool: ToolDefinition = {
  name: "update_state",
  label: "Update State",
  description:
    "Update a field in the runtime state (data/state.json). " +
    "Use for version bumps, cycle counts, and other state tracking.",
  parameters: stateParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    ensureDataDir();
    const statePath = join(DATA_DIR, "state.json");
    let state: Record<string, unknown> = {};
    try {
      state = JSON.parse(readFileSync(statePath, "utf-8"));
    } catch {
      // fresh state
    }
    state[params.key as string] = params.value;
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    return textResult(`State updated: ${params.key} = ${JSON.stringify(params.value)}`);
  },
};

/**
 * Write to knowledge base.
 */
export const knowledgeWriteTool: ToolDefinition = {
  name: "knowledge_write",
  label: "Write Knowledge",
  description:
    "Write an entry to the knowledge base (data/knowledge/<slug>.md). " +
    "Use when you learn something worth remembering long-term.",
  parameters: knowledgeParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    const knowledgeDir = join(DATA_DIR, "knowledge");
    if (!existsSync(knowledgeDir)) {
      mkdirSync(knowledgeDir, { recursive: true });
    }
    const slug = (params.slug as string).replace(/[^a-zA-Z0-9_-]/g, "-");
    writeFileSync(join(knowledgeDir, `${slug}.md`), params.content as string);
    return textResult(`Knowledge written: ${slug}.md`);
  },
};

// ── Export all tools ───────────────────────────────────────────────

export const jinxTools: ToolDefinition[] = [
  claudeCodeTool,
  requestRestartTool,
  updateIdentityTool,
  updateScratchpadTool,
  updateStateTool,
  knowledgeWriteTool,
];
