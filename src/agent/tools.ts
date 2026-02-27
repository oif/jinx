import { execSync, type ExecSyncOptions } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { Type } from "@sinclair/typebox";
import type {
  ToolDefinition,
  ExtensionContext,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@mariozechner/pi-coding-agent";
import { formatPerformanceReport } from "../observability/metrics.js";

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

const fetchWebpageParams = Type.Object({
  url: Type.String({ description: "URL to fetch and convert to Markdown" }),
});

const createPrParams = Type.Object({
  title: Type.String({ description: "PR title" }),
  body: Type.String({ description: "PR body/description" }),
  head: Type.Optional(Type.String({ description: "Branch to merge from (default: dev)" })),
  base: Type.Optional(Type.String({ description: "Branch to merge into (default: main)" })),
});

const addBacklogTaskParams = Type.Object({
  title: Type.String({ description: "Concise, actionable task title (e.g. 'Add rate limiting to Telegram bot')" }),
});

const getPerformanceReportParams = Type.Object({}); // No parameters needed

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
      // Unset CLAUDECODE so nested claude invocations are allowed.
      // Claude Code blocks nested sessions by detecting this env var.
      const env = { ...process.env };
      delete env.CLAUDECODE;

      const result = shell(
        `claude --print --dangerously-skip-permissions "${task.replace(/"/g, '\\"')}"`,
        { cwd, timeout: 600_000, env }
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
import { requestRestart } from "../supervisor/restart.js";

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
    requestRestart(params.reason as string);
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

/**
 * Fetch and parse a webpage into Markdown.
 */
export const fetchWebpageTool: ToolDefinition = {
  name: "fetch_webpage",
  label: "Fetch Webpage",
  description:
    "Fetch a webpage from the internet and extract its main content as Markdown. " +
    "Useful for reading documentation, articles, or API references.",
  parameters: fetchWebpageParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const url = params.url as string;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Jinx Bot / pi-coding-agent (Linux x86_64)",
          "Accept": "text/html,application/xhtml+xml",
        },
      });

      if (!response.ok) {
        return textResult(`Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Remove noise
      $("script, style, nav, footer, header, noscript, iframe, svg").remove();

      // Extract main content heuristically
      let mainHtml = "";
      if ($("main").length > 0) {
        mainHtml = $("main").html() || "";
      } else if ($("article").length > 0) {
        mainHtml = $("article").html() || "";
      } else if ($("#content, .content, .main").length > 0) {
        mainHtml = $("#content, .content, .main").html() || "";
      } else {
        mainHtml = $("body").html() || "";
      }

      const turndown = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
      });

      const markdown = turndown.turndown(mainHtml);
      return textResult(`Content of ${url}:\n\n${markdown.slice(0, 100000)}`); // limit to 100k chars
    } catch (e) {
      const err = e as Error;
      return textResult(`Error fetching webpage: ${err.message}`);
    }
  },
};

/**
 * Open a GitHub Pull Request from dev to main.
 */
export const createPrTool: ToolDefinition = {
  name: "github_create_pr",
  label: "Create GitHub PR",
  description:
    "Open a GitHub Pull Request from dev to main. " +
    "Requires GITHUB_TOKEN environment variable. " +
    "Use this when confident in a series of evolutions.",
  parameters: createPrParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        return textResult("Error: GITHUB_TOKEN environment variable is not set.");
      }

      // Extract repo name from git remote
      const remotes = shell("git remote -v", { cwd: process.cwd() });
      const match = remotes.match(/github\.com[:\/](.+?\/.+?)\.git/);
      if (!match) {
        return textResult("Error: Could not extract GitHub repository name from git remote.");
      }
      const repo = match[1];

      const head = (params.head as string) || "dev";
      const base = (params.base as string) || "main";
      const title = params.title as string;
      const body = params.body as string;

      const response = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github.v3+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "Jinx Bot / pi-coding-agent"
        },
        body: JSON.stringify({
          title,
          body,
          head,
          base,
        }),
      });

      const data = (await response.json()) as any;

      if (!response.ok) {
        // If PR already exists, GitHub returns a specific error code
        const isExists = data.errors?.some((e: any) => e.message?.includes("A pull request already exists"));
        if (isExists) {
          return textResult(`A pull request already exists for ${head} into ${base}.`);
        }
        return textResult(`Failed to create PR: HTTP ${response.status} - ${data.message || JSON.stringify(data)}`);
      }

      return textResult(`Successfully created Pull Request #${data.number}: ${data.html_url}`);
    } catch (e) {
      const err = e as Error;
      return textResult(`Error creating PR: ${err.message}`);
    }
  },
};

// ── Backlog helpers ────────────────────────────────────────────────

const BACKLOG_PATH = join(process.cwd(), "data", "backlog.md");

function getNextBacklogId(content: string): string {
  const matches = [...content.matchAll(/#(\d+)/g)];
  const maxId = matches.reduce((max, m) => {
    const n = parseInt(m[1], 10);
    return n > max ? n : max;
  }, 0);
  return `#${String(maxId + 1).padStart(3, "0")}`;
}

/**
 * Add a task to the backlog's Pending section.
 * Automatically assigns the next sequential ID.
 */
export const addBacklogTaskTool: ToolDefinition = {
  name: "add_backlog_task",
  label: "Add Backlog Task",
  description:
    "Add a new task to data/backlog.md for future execution. " +
    "Use during goal discovery to queue discovered improvements. " +
    "The task will be assigned a sequential ID automatically.",
  parameters: addBacklogTaskParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const title = (params.title as string).trim();
      const content = existsSync(BACKLOG_PATH)
        ? readFileSync(BACKLOG_PATH, "utf-8")
        : "# Backlog\n\n## Pending\n\n## Done\n";

      const id = getNextBacklogId(content);
      const taskLine = `- [ ] ${id}: ${title}`;

      // Insert after "## Pending" heading
      const pendingIdx = content.indexOf("## Pending");
      if (pendingIdx === -1) {
        return textResult("Error: could not find '## Pending' section in backlog.md");
      }
      const afterHeading = content.indexOf("\n", pendingIdx) + 1;
      const updated = content.slice(0, afterHeading) + taskLine + "\n" + content.slice(afterHeading);

      writeFileSync(BACKLOG_PATH, updated);
      return textResult(`Task added to backlog: ${id}: ${title}`);
    } catch (e) {
      return textResult(`Error adding task: ${(e as Error).message}`);
    }
  },
};

// ── Performance Report Tool ───────────────────────────────────────

/**
 * Get performance metrics report
 */
export const getPerformanceReportTool: ToolDefinition = {
  name: "get_performance_report",
  label: "Get Performance Report",
  description:
    "Get a detailed performance report including agent response times, tool usage statistics, " +
    "evolution cycle metrics, and system uptime. Use this to understand Jinx's operational performance " +
    "and identify potential bottlenecks.",
  parameters: getPerformanceReportParams,
  execute: async (
    _toolCallId: string,
    _params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const report = formatPerformanceReport();
      return textResult(report);
    } catch (e) {
      const err = e as Error;
      return textResult(`Error generating performance report: ${err.message}`);
    }
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
  fetchWebpageTool,
  createPrTool,
  addBacklogTaskTool,
  getPerformanceReportTool,
];
