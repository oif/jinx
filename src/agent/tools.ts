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
import { log } from "../util/log.js";
import { recordClaudeUsage } from "../costs/tracker.js";
import { runQualityCheck, formatQualityReport } from "../quality/code-quality.js";
import { runSelfDiagnosis, formatDiagnosisReport, executeRepairAction } from "../diagnosis/engine.js";
import { forceStrategy, getCurrentStrategy, formatStrategyStatus, enableAutoSelect, disableAutoSelect } from "../evolution/strategy.js";
import {
  listAllSkills,
  searchSkills,
  loadSkill,
  createSkill,
  createSkillFromTemplate,
  formatSkillList,
  formatSkillDetail,
  validateSkillParams,
  recordSkillUsage,
  SKILL_TEMPLATES,
  executeSkillSteps,
  formatExecutionResult,
  registerTool,
} from "../skills/library.js";
import {
  encodeMemory,
  retrieveMemories,
  createRelationship,
  formatMemoryStats,
  exportGraph,
  exportForVisualization,
  importGraph,
  advancedSemanticSearch,
  findMemoryClusters,
  GraphExport,
} from "../memory/graph.js";
import {
  listIssues,
  createIssue,
  updateIssue,
  addIssueComment,
  listPullRequests,
  analyzePullRequest,
  getRepoStats,
  listCommits,
  formatIssueList,
  formatPRList,
  formatPRAnalysis,
  formatRepoStats,
} from "../github/enhanced.js";
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

const webSearchParams = Type.Object({
  query: Type.String({ description: "Search query" }),
  count: Type.Optional(Type.Number({ description: "Number of results (1-20, default 10)" })),
});

const selfDiagnosisParams = Type.Object({}); // No parameters needed

const repairActionParams = Type.Object({
  command: Type.String({ description: "Repair command to execute (e.g., 'disk_cleanup', 'memory_optimization')" }),
});

const setStrategyParams = Type.Object({
  strategy: Type.String({ description: "Strategy to set: 'innovate', 'harden', 'repair-only', or 'balanced'" }),
  reason: Type.Optional(Type.String({ description: "Optional reason for the strategy change" })),
});

const strategyStatusParams = Type.Object({}); // No parameters needed

const listSkillsParams = Type.Object({
  tag: Type.Optional(Type.String({ description: "Filter by tag" })),
  search: Type.Optional(Type.String({ description: "Search in name/description" })),
});

const createSkillParams = Type.Object({
  name: Type.String({ description: "Skill name" }),
  description: Type.String({ description: "What this skill does" }),
  template: Type.Optional(Type.String({ description: "Template to use: 'code-review', 'pre-commit', or 'system-health-check'" })),
});

const skillDetailParams = Type.Object({
  skillId: Type.String({ description: "Skill ID" }),
});

const executeSkillParams = Type.Object({
  skillId: Type.String({ description: "Skill ID to execute" }),
  params: Type.Optional(Type.String({ description: "JSON string of parameters (e.g., '{\"target\": \"all\"}')" })),
});

const rememberParams = Type.Object({
  content: Type.String({ description: "Content to remember" }),
  type: Type.String({ description: "Memory type: concept, fact, experience, entity, skill, goal" }),
  tags: Type.Optional(Type.String({ description: "Comma-separated tags" })),
  importance: Type.Optional(Type.Number({ description: "Importance 0-1 (default 0.5)" })),
  relatedTo: Type.Optional(Type.String({ description: "Comma-separated related memory IDs" })),
});

const recallParams = Type.Object({
  query: Type.String({ description: "Search query" }),
  type: Type.Optional(Type.String({ description: "Filter by type" })),
  limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
});

const relateParams = Type.Object({
  fromId: Type.String({ description: "Source memory ID" }),
  toId: Type.String({ description: "Target memory ID" }),
  relationship: Type.String({ description: "Relationship type: relates_to, part_of, leads_to, contradicts, supports, similar_to, prerequisite_for" }),
});

const memoryStatsParams = Type.Object({}); // No parameters needed

const memoryExportParams = Type.Object({
  format: Type.Optional(Type.String({ description: "Export format: 'full' or 'visualization' (default: 'full')" })),
});

const memoryImportParams = Type.Object({
  jsonData: Type.String({ description: "JSON string of exported graph data" }),
});

const advancedSearchParams = Type.Object({
  query: Type.String({ description: "Search query" }),
  limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
  boostRecent: Type.Optional(Type.Boolean({ description: "Boost recent memories" })),
  boostAccessed: Type.Optional(Type.Boolean({ description: "Boost frequently accessed memories" })),
});

const memoryClustersParams = Type.Object({}); // No parameters needed

const githubListIssuesParams = Type.Object({
  state: Type.Optional(Type.String({ description: "Filter by state: 'open', 'closed', or 'all' (default: 'open')" })),
  labels: Type.Optional(Type.String({ description: "Comma-separated list of labels to filter by" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of issues to return (default: 30)" })),
});

const githubCreateIssueParams = Type.Object({
  title: Type.String({ description: "Issue title" }),
  body: Type.String({ description: "Issue body/description" }),
  labels: Type.Optional(Type.String({ description: "Comma-separated list of labels" })),
  assignees: Type.Optional(Type.String({ description: "Comma-separated list of assignees" })),
});

const githubUpdateIssueParams = Type.Object({
  issueNumber: Type.Number({ description: "Issue number" }),
  title: Type.Optional(Type.String({ description: "New title" })),
  body: Type.Optional(Type.String({ description: "New body" })),
  state: Type.Optional(Type.String({ description: "New state: 'open' or 'closed'" })),
  labels: Type.Optional(Type.String({ description: "Comma-separated list of labels" })),
});

const githubAddCommentParams = Type.Object({
  issueNumber: Type.Number({ description: "Issue or PR number" }),
  body: Type.String({ description: "Comment body" }),
});

const githubListPRsParams = Type.Object({
  state: Type.Optional(Type.String({ description: "Filter by state: 'open', 'closed', or 'all' (default: 'open')" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of PRs to return (default: 30)" })),
});

const githubAnalyzePRParams = Type.Object({
  prNumber: Type.Number({ description: "Pull request number" }),
});

const githubRepoStatsParams = Type.Object({}); // No parameters needed

const githubListCommitsParams = Type.Object({
  branch: Type.Optional(Type.String({ description: "Branch name (default: 'main')" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of commits to return (default: 20)" })),
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

    // Retry delays for rate-limit errors: 30s, 60s, 120s
    const RETRY_DELAYS_MS = [30_000, 60_000, 120_000];

    /** Detect whether an error looks like a rate-limit / overload response. */
    function isRateLimitError(err: Error & { status?: number; stderr?: string }): boolean {
      const msg = (err.stderr || err.message || "").toLowerCase();
      return (
        err.status === 429 ||
        msg.includes("rate limit") ||
        msg.includes("overloaded") ||
        msg.includes("too many requests") ||
        msg.includes("529") ||
        msg.includes("quota")
      );
    }

    const env = { ...process.env };
    // Unset CLAUDECODE so nested claude invocations are allowed.
    // Claude Code blocks nested sessions by detecting this env var.
    delete env.CLAUDECODE;

    const cmd = `claude --print --dangerously-skip-permissions "${task.replace(/"/g, '\\"')}"`; 

    let lastErr: (Error & { status?: number; stderr?: string }) | null = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const result = shell(cmd, { cwd, timeout: 600_000, env });

        // Estimate and record cost based on task length and result length
        const inputTokens = Math.ceil(task.length / 4);  // ~4 chars per token
        const outputTokens = Math.ceil((result || "").length / 4);
        recordClaudeUsage(inputTokens, outputTokens, { task: task.slice(0, 100) });

        return textResult(result || "(Claude Code completed with no output)");
      } catch (e) {
        lastErr = e as Error & { status?: number; stderr?: string };

        const willRetry = attempt < RETRY_DELAYS_MS.length && isRateLimitError(lastErr);
        if (willRetry) {
          const delayMs = RETRY_DELAYS_MS[attempt];
          log.warn(`Claude Code rate-limited, retrying in ${delayMs / 1000}s`, {
            attempt: attempt + 1,
            maxAttempts: RETRY_DELAYS_MS.length + 1,
            error: lastErr.stderr || lastErr.message,
          });
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        // Non-rate-limit error or retries exhausted — record and return
        break;
      }
    }

    // All attempts failed
    const err = lastErr!;
    const inputTokens = Math.ceil(task.length / 4);
    recordClaudeUsage(inputTokens, 500, { task: task.slice(0, 100), error: true });

    return textResult(
      `Claude Code error (exit ${err.status ?? "?"}): ${err.stderr || err.message}`
    );
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
      const match = remotes.match(/github\.com[:/](.+?\/.+?)\.git/);
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

// ── Quality Check Tool ─────────────────────────────────────────────

/**
 * Run code quality checks (ESLint, security audit, complexity analysis)
 */
export const checkCodeQualityTool: ToolDefinition = {
  name: "check_code_quality",
  label: "Check Code Quality",
  description:
    "Run comprehensive code quality checks including ESLint linting, npm security audit, " +
    "and cyclomatic complexity analysis. Returns a detailed report of issues found. " +
    "Use this before committing important changes or as part of regular maintenance.",
  parameters: Type.Object({}),
  execute: async (
    _toolCallId: string,
    _params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const result = await runQualityCheck();
      const report = formatQualityReport(result);
      return textResult(report);
    } catch (e) {
      const err = e as Error;
      return textResult(`Error running code quality check: ${err.message}`);
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

// ── Web Search Tool ────────────────────────────────────────────────

import { webSearch, formatSearchResults } from "../search/web-search.js";

/**
 * Search the web using Brave Search or Serper API
 */
export const webSearchTool: ToolDefinition = {
  name: "web_search",
  label: "Web Search",
  description:
    "Search the web for information. Uses Brave Search API (primary) or Serper API (fallback). " +
    "Returns a list of search results with titles, URLs, and descriptions. " +
    "Requires BRAVE_API_KEY or SERPER_API_KEY environment variable.",
  parameters: webSearchParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const result = await webSearch({
        query: params.query as string,
        count: (params.count as number) || 10,
      });
      const formatted = formatSearchResults(result);
      return textResult(formatted);
    } catch (e) {
      const err = e as Error;
      return textResult(`Search error: ${err.message}`);
    }
  },
};

// ── Self-Diagnosis Tool ───────────────────────────────────────────

/**
 * Run self-diagnosis to identify failure patterns and generate repair recommendations.
 */
export const selfDiagnosisTool: ToolDefinition = {
  name: "run_self_diagnosis",
  label: "Run Self-Diagnosis",
  description:
    "Analyze health history and performance metrics to identify failure patterns " +
    "and generate actionable repair recommendations. This tool helps Jinx understand " +
    "its own operational issues and suggests fixes for health, performance, evolution, " +
    "and tool-related problems. Use this when investigating system issues or " +
    "as part of regular maintenance.",
  parameters: selfDiagnosisParams,
  execute: async (
    _toolCallId: string,
    _params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const report = runSelfDiagnosis();
      const formatted = formatDiagnosisReport(report);
      return textResult(formatted);
    } catch (e) {
      const err = e as Error;
      return textResult(`Error running self-diagnosis: ${err.message}`);
    }
  },
};

/**
 * Execute an automated repair action.
 */
export const executeRepairTool: ToolDefinition = {
  name: "execute_repair",
  label: "Execute Repair",
  description:
    "Execute an automated repair action based on self-diagnosis recommendations. " +
    "Currently supports: 'disk_cleanup' and 'memory_optimization'. " +
    "Use this after running self-diagnosis to automatically fix detected issues.",
  parameters: repairActionParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const command = params.command as string;
      const success = await executeRepairAction(command);
      if (success) {
        return textResult(`✅ Repair action '${command}' executed successfully.`);
      } else {
        return textResult(`❌ Repair action '${command}' failed. Check logs for details.`);
      }
    } catch (e) {
      const err = e as Error;
      return textResult(`Error executing repair: ${err.message}`);
    }
  },
};

// ── Strategy Tools ─────────────────────────────────────────────────

/**
 * Set the evolution strategy manually.
 */
export const setStrategyTool: ToolDefinition = {
  name: "set_evolution_strategy",
  label: "Set Evolution Strategy",
  description:
    "Set the evolution strategy to guide how Jinx approaches improvements. " +
    "Strategies: 'innovate' (explore new features), 'harden' (focus on stability), " +
    "'repair-only' (emergency fixes only), 'balanced' (normal mode). " +
    "Use this to manually control the evolution direction, or use enable_strategy_auto_select " +
    "to let the system choose based on health metrics.",
  parameters: setStrategyParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const strategy = params.strategy as string;
      const reason = (params.reason as string) || "Manual strategy change";
      
      if (!["innovate", "harden", "repair-only", "balanced"].includes(strategy)) {
        return textResult(`❌ Invalid strategy: ${strategy}. Valid options: innovate, harden, repair-only, balanced`);
      }
      
      forceStrategy(strategy as "innovate" | "harden" | "repair-only" | "balanced", reason);
      return textResult(`✅ Evolution strategy set to: ${strategy}\nReason: ${reason}`);
    } catch (e) {
      const err = e as Error;
      return textResult(`Error setting strategy: ${err.message}`);
    }
  },
};

/**
 * Get the current evolution strategy status.
 */
export const getStrategyStatusTool: ToolDefinition = {
  name: "get_strategy_status",
  label: "Get Strategy Status",
  description:
    "Get detailed information about the current evolution strategy, system state, " +
    "and strategy recommendation. Shows strategy history, auto-select status, " +
    "and reasons for the current strategy choice.",
  parameters: strategyStatusParams,
  execute: async (
    _toolCallId: string,
    _params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const status = formatStrategyStatus();
      return textResult(status);
    } catch (e) {
      const err = e as Error;
      return textResult(`Error getting strategy status: ${err.message}`);
    }
  },
};

/**
 * Enable automatic strategy selection.
 */
export const enableAutoStrategyTool: ToolDefinition = {
  name: "enable_strategy_auto_select",
  label: "Enable Auto Strategy",
  description:
    "Enable automatic strategy selection based on system health and performance metrics. " +
    "When enabled, the system will automatically switch between innovate/harden/repair-only " +
    "based on failure rates, health status, and consecutive successes.",
  parameters: Type.Object({}),
  execute: async (
    _toolCallId: string,
    _params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      enableAutoSelect();
      const current = getCurrentStrategy();
      return textResult(`✅ Auto strategy selection enabled.\nCurrent strategy: ${current}`);
    } catch (e) {
      const err = e as Error;
      return textResult(`Error enabling auto strategy: ${err.message}`);
    }
  },
};

/**
 * Disable automatic strategy selection.
 */
export const disableAutoStrategyTool: ToolDefinition = {
  name: "disable_strategy_auto_select",
  label: "Disable Auto Strategy",
  description:
    "Disable automatic strategy selection. The current strategy will remain fixed " +
    "until manually changed via set_evolution_strategy.",
  parameters: Type.Object({}),
  execute: async (
    _toolCallId: string,
    _params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      disableAutoSelect();
      const current = getCurrentStrategy();
      return textResult(`✅ Auto strategy selection disabled.\nCurrent strategy: ${current} (fixed)`);
    } catch (e) {
      const err = e as Error;
      return textResult(`Error disabling auto strategy: ${err.message}`);
    }
  },
};

// ── Skill Library Tools ────────────────────────────────────────────

/**
 * List all skills in the library.
 */
export const listSkillsTool: ToolDefinition = {
  name: "list_skills",
  label: "List Skills",
  description:
    "List all skills in the skill library. Optionally filter by tag or search term. " +
    "Skills are reusable workflows composed of multiple tool calls.",
  parameters: listSkillsParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const tag = params.tag as string | undefined;
      const search = params.search as string | undefined;
      
      let skills;
      if (tag || search) {
        skills = searchSkills({ tags: tag ? [tag] : undefined, nameContains: search });
      } else {
        skills = listAllSkills();
      }
      
      return textResult(formatSkillList(skills));
    } catch (e) {
      const err = e as Error;
      return textResult(`Error listing skills: ${err.message}`);
    }
  },
};

/**
 * Get detailed information about a skill.
 */
export const getSkillDetailTool: ToolDefinition = {
  name: "get_skill_detail",
  label: "Get Skill Detail",
  description:
    "Get detailed information about a specific skill including its parameters, " +
    "steps, usage count, and other metadata.",
  parameters: skillDetailParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const skillId = params.skillId as string;
      const skill = loadSkill(skillId);
      
      if (!skill) {
        return textResult(`❌ Skill not found: ${skillId}`);
      }
      
      return textResult(formatSkillDetail(skill));
    } catch (e) {
      const err = e as Error;
      return textResult(`Error getting skill detail: ${err.message}`);
    }
  },
};

/**
 * Create a new skill.
 */
export const createSkillTool: ToolDefinition = {
  name: "create_skill",
  label: "Create Skill",
  description:
    "Create a new skill in the skill library. Skills are reusable workflows " +
    "that combine multiple tool calls. You can create from a template or define custom skills. " +
    "Available templates: 'code-review' (comprehensive code review), " +
    "'pre-commit' (pre-commit checks), 'system-health-check' (system diagnostics).",
  parameters: createSkillParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const name = params.name as string;
      const description = params.description as string;
      const template = params.template as string | undefined;
      
      let skill;
      if (template) {
        if (!(template in SKILL_TEMPLATES)) {
          return textResult(
            `❌ Unknown template: ${template}. Available: ${Object.keys(SKILL_TEMPLATES).join(", ")}`
          );
        }
        skill = createSkillFromTemplate(template as keyof typeof SKILL_TEMPLATES, {
          description,
        });
        // Update name if provided
        if (name !== skill.name) {
          skill = { ...skill, name };
        }
      } else {
        skill = createSkill({
          name,
          description,
          version: "1.0.0",
          tags: [],
          parameters: [],
          steps: [],
        });
      }
      
      return textResult(
        `✅ Skill created: ${skill.name}\nID: ${skill.id}\n\nUse get_skill_detail to view and customize it.`
      );
    } catch (e) {
      const err = e as Error;
      return textResult(`Error creating skill: ${err.message}`);
    }
  },
};

/**
 * Execute a skill with real tool invocation.
 */
export const executeSkillTool: ToolDefinition = {
  name: "execute_skill",
  label: "Execute Skill",
  description:
    "Execute a skill from the skill library. Skills are reusable workflows " +
    "that run a sequence of tools sequentially with real execution. " +
    "Use list_skills to see available skills and get_skill_detail to see required parameters.",
  parameters: executeSkillParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const skillId = params.skillId as string;
      const paramJson = (params.params as string) || "{}";

      const skill = loadSkill(skillId);
      if (!skill) {
        return textResult(`❌ Skill not found: ${skillId}`);
      }

      let parsedParams: Record<string, unknown>;
      try {
        parsedParams = JSON.parse(paramJson);
      } catch {
        return textResult(`❌ Invalid parameters JSON: ${paramJson}`);
      }

      // Validate parameters
      const validation = validateSkillParams(skill, parsedParams);
      if (!validation.valid) {
        return textResult(
          `❌ Parameter validation failed:\n${validation.errors.join("\n")}`
        );
      }

      // Record usage
      recordSkillUsage(skillId);

      // Execute the skill with real tool invocation
      const result = await executeSkillSteps(skill, parsedParams, {
        signal,
        onStepStart: (stepIndex, toolName) => {
          log.info(`Skill step starting`, { skillId, stepIndex, toolName });
        },
        onStepComplete: (stepIndex, stepResult) => {
          log.info(`Skill step completed`, {
            skillId,
            stepIndex,
            success: stepResult.success,
            durationMs: stepResult.durationMs,
          });
        },
      });

      const formatted = formatExecutionResult(result);
      return textResult(formatted);
    } catch (e) {
      const err = e as Error;
      return textResult(`❌ Error executing skill: ${err.message}`);
    }
  },
};

// ── Memory System Tools ────────────────────────────────────────────

/**
 * Store a memory in the knowledge graph.
 */
export const rememberTool: ToolDefinition = {
  name: "remember",
  label: "Remember",
  description:
    "Store a memory in the knowledge graph memory system. Memories are nodes " +
    "that can be connected to other memories via relationships. Supports semantic " +
    "search and automatic consolidation. Types: concept, fact, experience, entity, skill, goal.",
  parameters: rememberParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const content = params.content as string;
      const type = params.type as string;
      const tagsStr = (params.tags as string) || "";
      const importance = (params.importance as number) ?? 0.5;
      const relatedToStr = (params.relatedTo as string) || "";

      const validTypes = ["concept", "fact", "experience", "entity", "skill", "goal"];
      if (!validTypes.includes(type)) {
        return textResult(
          `❌ Invalid type: ${type}. Valid types: ${validTypes.join(", ")}`
        );
      }

      const tags = tagsStr.split(",").map(t => t.trim()).filter(Boolean);
      const relatedTo = relatedToStr.split(",").map(t => t.trim()).filter(Boolean);

      const relationships = relatedTo.map(id => ({
        toId: id,
        type: "relates_to" as const,
        strength: 0.7,
      }));

      const node = encodeMemory({
        content,
        type: type as any,
        tags,
        importance,
        relationships: relationships.length > 0 ? relationships : undefined,
      });

      return textResult(
        `✅ Memory stored\nID: ${node.id}\nType: ${type}\nSummary: ${node.summary.slice(0, 100)}...`
      );
    } catch (e) {
      const err = e as Error;
      return textResult(`Error storing memory: ${err.message}`);
    }
  },
};

/**
 * Recall memories from the knowledge graph.
 */
export const recallTool: ToolDefinition = {
  name: "recall",
  label: "Recall",
  description:
    "Search and retrieve memories from the knowledge graph using semantic search. " +
    "Returns memories ranked by relevance to the query. Supports filtering by type.",
  parameters: recallParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const query = params.query as string;
      const type = params.type as string | undefined;
      const limit = (params.limit as number) || 10;

      const results = retrieveMemories({
        text: query,
        type: type as any,
        limit,
      });

      if (results.length === 0) {
        return textResult("No memories found matching your query.");
      }

      const lines: string[] = [
        `🧠 Retrieved ${results.length} memories:`,
        "",
      ];

      for (const result of results) {
        const relevance = Math.round(result.relevance * 100);
        lines.push(`[${relevance}%] ${result.node.type}: ${result.node.summary.slice(0, 80)}...`);
        lines.push(`    ID: ${result.node.id} | Tags: ${result.node.tags.join(", ") || "none"}`);
        lines.push("");
      }

      return textResult(lines.join("\n"));
    } catch (e) {
      const err = e as Error;
      return textResult(`Error recalling memories: ${err.message}`);
    }
  },
};

/**
 * Create a relationship between memories.
 */
export const relateTool: ToolDefinition = {
  name: "relate_memories",
  label: "Relate Memories",
  description:
    "Create a relationship between two memories in the knowledge graph. " +
    "Relationships enable graph traversal and associative recall.",
  parameters: relateParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const fromId = params.fromId as string;
      const toId = params.toId as string;
      const relationship = params.relationship as string;

      const validRelations = ["relates_to", "part_of", "leads_to", "contradicts", "supports", "similar_to", "prerequisite_for"];
      if (!validRelations.includes(relationship)) {
        return textResult(
          `❌ Invalid relationship: ${relationship}. Valid: ${validRelations.join(", ")}`
        );
      }

      const edge = createRelationship(fromId, toId, relationship as any);

      if (edge) {
        return textResult(
          `✅ Relationship created\n${fromId} ${relationship} ${toId}`
        );
      } else {
        return textResult("❌ Failed to create relationship. Check that both memory IDs exist.");
      }
    } catch (e) {
      const err = e as Error;
      return textResult(`Error creating relationship: ${err.message}`);
    }
  },
};

/**
 * Get memory system statistics.
 */
export const memoryStatsTool: ToolDefinition = {
  name: "memory_stats",
  label: "Memory Statistics",
  description:
    "Get statistics about the knowledge graph memory system including " +
    "node counts, edge counts, memory types distribution, and average importance.",
  parameters: memoryStatsParams,
  execute: async (
    _toolCallId: string,
    _params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      return textResult(formatMemoryStats());
    } catch (e) {
      const err = e as Error;
      return textResult(`Error getting memory stats: ${err.message}`);
    }
  },
};

/**
 * Export memory graph for backup or visualization.
 */
export const memoryExportTool: ToolDefinition = {
  name: "export_memory",
  label: "Export Memory Graph",
  description:
    "Export the memory graph for backup, analysis, or visualization. " +
    "Can export in 'full' format (complete data) or 'visualization' format (simplified for graph viz tools).",
  parameters: memoryExportParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const format = (params.format as string) || "full";

      if (format === "visualization") {
        const viz = exportForVisualization();
        return textResult(`\`\`\`json\n${JSON.stringify(viz, null, 2)}\n\`\`\``);
      }

      const graph = exportGraph();
      return textResult(
        `Memory graph exported (${graph.stats.totalNodes} nodes, ${graph.stats.totalEdges} edges)\n\n` +
        `\`\`\`json\n${JSON.stringify(graph, null, 2).slice(0, 50000)}\n\`\`\``
      );
    } catch (e) {
      const err = e as Error;
      return textResult(`Error exporting memory: ${err.message}`);
    }
  },
};

/**
 * Import memory graph from backup.
 */
export const memoryImportTool: ToolDefinition = {
  name: "import_memory",
  label: "Import Memory Graph",
  description:
    "Import a memory graph from JSON data. Used for restoring from backup or migrating memory data. " +
    "WARNING: This will overwrite existing memory data.",
  parameters: memoryImportParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const jsonData = params.jsonData as string;
      const data = JSON.parse(jsonData) as GraphExport;

      const result = importGraph(data);

      return textResult(
        `✅ Memory graph imported\nNodes: ${result.nodes}\nEdges: ${result.edges}`
      );
    } catch (e) {
      const err = e as Error;
      return textResult(`Error importing memory: ${err.message}`);
    }
  },
};

/**
 * Advanced semantic search with boosting options.
 */
export const advancedMemorySearchTool: ToolDefinition = {
  name: "advanced_memory_search",
  label: "Advanced Memory Search",
  description:
    "Search memories using enhanced semantic search with TF-IDF weighting. " +
    "Supports boosting recent memories and frequently accessed memories for better relevance.",
  parameters: advancedSearchParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const query = params.query as string;
      const limit = (params.limit as number) || 10;
      const boostRecent = (params.boostRecent as boolean) || false;
      const boostAccessed = (params.boostAccessed as boolean) || false;

      const results = advancedSemanticSearch(query, {
        limit,
        boostRecent,
        boostAccessed,
      });

      if (results.length === 0) {
        return textResult("No memories found matching your query.");
      }

      const lines: string[] = [
        `🧠 Advanced Search Results (${results.length} found):`,
        "",
      ];

      for (const result of results) {
        const relevance = Math.round(result.relevance * 100);
        lines.push(`[${relevance}%] ${result.node.type}: ${result.node.summary.slice(0, 60)}...`);
        lines.push(`    ID: ${result.node.id}`);
        lines.push(`    Matched: ${result.matchedKeywords.join(", ") || "N/A"}`);
        lines.push("");
      }

      return textResult(lines.join("\n"));
    } catch (e) {
      const err = e as Error;
      return textResult(`Error searching memories: ${err.message}`);
    }
  },
};

/**
 * Find memory clusters (connected components).
 */
export const memoryClustersTool: ToolDefinition = {
  name: "memory_clusters",
  label: "Memory Clusters",
  description:
    "Find clusters of related memories in the knowledge graph. " +
    "Clusters represent topics or themes that connect multiple memories.",
  parameters: memoryClustersParams,
  execute: async (
    _toolCallId: string,
    _params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const clusters = findMemoryClusters();

      if (clusters.length === 0) {
        return textResult("No memory clusters found. Try creating relationships between memories.");
      }

      const lines: string[] = [
        `📊 Memory Clusters (${clusters.length} found):`,
        "",
      ];

      for (let i = 0; i < clusters.length; i++) {
        const cluster = clusters[i];
        lines.push(`${i + 1}. Topic: ${cluster.topic}`);
        lines.push(`   Size: ${cluster.size} memories`);
        lines.push(`   Memories:`);
        for (const mem of cluster.memories.slice(0, 5)) {
          lines.push(`     • ${mem.summary.slice(0, 50)}...`);
        }
        if (cluster.memories.length > 5) {
          lines.push(`     ... and ${cluster.memories.length - 5} more`);
        }
        lines.push("");
      }

      return textResult(lines.join("\n"));
    } catch (e) {
      const err = e as Error;
      return textResult(`Error finding clusters: ${err.message}`);
    }
  },
};

// ── GitHub Enhanced Tools ──────────────────────────────────────────

/**
 * List GitHub issues
 */
export const githubListIssuesTool: ToolDefinition = {
  name: "github_list_issues",
  label: "List GitHub Issues",
  description:
    "List issues from the GitHub repository. " +
    "Supports filtering by state and labels. " +
    "Requires GITHUB_TOKEN environment variable.",
  parameters: githubListIssuesParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const state = (params.state as "open" | "closed" | "all") || "open";
      const labelsStr = (params.labels as string) || "";
      const labels = labelsStr ? labelsStr.split(",").map(l => l.trim()) : undefined;
      const limit = (params.limit as number) || 30;

      const issues = await listIssues(state, labels, limit);
      return textResult(formatIssueList(issues));
    } catch (e) {
      const err = e as Error;
      return textResult(`Error listing issues: ${err.message}`);
    }
  },
};

/**
 * Create a GitHub issue
 */
export const githubCreateIssueTool: ToolDefinition = {
  name: "github_create_issue",
  label: "Create GitHub Issue",
  description:
    "Create a new issue in the GitHub repository. " +
    "Requires GITHUB_TOKEN environment variable.",
  parameters: githubCreateIssueParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const title = params.title as string;
      const body = params.body as string;
      const labelsStr = (params.labels as string) || "";
      const labels = labelsStr ? labelsStr.split(",").map(l => l.trim()) : undefined;
      const assigneesStr = (params.assignees as string) || "";
      const assignees = assigneesStr ? assigneesStr.split(",").map(a => a.trim()) : undefined;

      const issue = await createIssue(title, body, labels, assignees);
      return textResult(`✅ Issue created: #${issue.number}\n${issue.html_url}`);
    } catch (e) {
      const err = e as Error;
      return textResult(`Error creating issue: ${err.message}`);
    }
  },
};

/**
 * Update a GitHub issue
 */
export const githubUpdateIssueTool: ToolDefinition = {
  name: "github_update_issue",
  label: "Update GitHub Issue",
  description:
    "Update an existing issue in the GitHub repository. " +
    "Can update title, body, state, and labels. " +
    "Requires GITHUB_TOKEN environment variable.",
  parameters: githubUpdateIssueParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const issueNumber = params.issueNumber as number;
      const updates: { title?: string; body?: string; state?: "open" | "closed"; labels?: string[] } = {};

      if (params.title) updates.title = params.title as string;
      if (params.body) updates.body = params.body as string;
      if (params.state) updates.state = params.state as "open" | "closed";
      if (params.labels) updates.labels = (params.labels as string).split(",").map(l => l.trim());

      const issue = await updateIssue(issueNumber, updates);
      return textResult(`✅ Issue #${issue.number} updated\nState: ${issue.state}\n${issue.html_url}`);
    } catch (e) {
      const err = e as Error;
      return textResult(`Error updating issue: ${err.message}`);
    }
  },
};

/**
 * Add a comment to a GitHub issue or PR
 */
export const githubAddCommentTool: ToolDefinition = {
  name: "github_add_comment",
  label: "Add GitHub Comment",
  description:
    "Add a comment to an issue or pull request. " +
    "Requires GITHUB_TOKEN environment variable.",
  parameters: githubAddCommentParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const issueNumber = params.issueNumber as number;
      const body = params.body as string;

      const comment = await addIssueComment(issueNumber, body);
      return textResult(`✅ Comment added\n${comment.html_url}`);
    } catch (e) {
      const err = e as Error;
      return textResult(`Error adding comment: ${err.message}`);
    }
  },
};

/**
 * List GitHub pull requests
 */
export const githubListPRsTool: ToolDefinition = {
  name: "github_list_prs",
  label: "List GitHub PRs",
  description:
    "List pull requests from the GitHub repository. " +
    "Supports filtering by state. " +
    "Requires GITHUB_TOKEN environment variable.",
  parameters: githubListPRsParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const state = (params.state as "open" | "closed" | "all") || "open";
      const limit = (params.limit as number) || 30;

      const prs = await listPullRequests(state, limit);
      return textResult(formatPRList(prs));
    } catch (e) {
      const err = e as Error;
      return textResult(`Error listing PRs: ${err.message}`);
    }
  },
};

/**
 * Analyze a GitHub pull request
 */
export const githubAnalyzePRTool: ToolDefinition = {
  name: "github_analyze_pr",
  label: "Analyze GitHub PR",
  description:
    "Analyze a pull request for code review. " +
    "Provides risk assessment, suggestions, and change statistics. " +
    "Requires GITHUB_TOKEN environment variable.",
  parameters: githubAnalyzePRParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const prNumber = params.prNumber as number;

      const analysis = await analyzePullRequest(prNumber);
      return textResult(formatPRAnalysis(analysis));
    } catch (e) {
      const err = e as Error;
      return textResult(`Error analyzing PR: ${err.message}`);
    }
  },
};

/**
 * Get GitHub repository statistics
 */
export const githubRepoStatsTool: ToolDefinition = {
  name: "github_repo_stats",
  label: "GitHub Repo Stats",
  description:
    "Get statistics about the GitHub repository. " +
    "Includes stars, forks, open issues, language, and size. " +
    "Requires GITHUB_TOKEN environment variable.",
  parameters: githubRepoStatsParams,
  execute: async (
    _toolCallId: string,
    _params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const stats = await getRepoStats();
      return textResult(formatRepoStats(stats));
    } catch (e) {
      const err = e as Error;
      return textResult(`Error getting repo stats: ${err.message}`);
    }
  },
};

/**
 * List GitHub commits
 */
export const githubListCommitsTool: ToolDefinition = {
  name: "github_list_commits",
  label: "List GitHub Commits",
  description:
    "List recent commits from the GitHub repository. " +
    "Requires GITHUB_TOKEN environment variable.",
  parameters: githubListCommitsParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const branch = (params.branch as string) || "main";
      const limit = (params.limit as number) || 20;

      const commits = await listCommits(branch, limit);

      const lines: string[] = [
        `📝 Recent Commits (${commits.length})`,
        "",
      ];

      for (const commit of commits) {
        const shortSha = commit.sha.slice(0, 7);
        const message = commit.commit.message.split("\n")[0].slice(0, 60);
        lines.push(`${shortSha}: ${message}`);
      }

      return textResult(lines.join("\n"));
    } catch (e) {
      const err = e as Error;
      return textResult(`Error listing commits: ${err.message}`);
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
  checkCodeQualityTool,
  webSearchTool,
  selfDiagnosisTool,
  executeRepairTool,
  setStrategyTool,
  getStrategyStatusTool,
  enableAutoStrategyTool,
  disableAutoStrategyTool,
  listSkillsTool,
  getSkillDetailTool,
  createSkillTool,
  executeSkillTool,
  rememberTool,
  recallTool,
  relateTool,
  memoryStatsTool,
  memoryExportTool,
  memoryImportTool,
  advancedMemorySearchTool,
  memoryClustersTool,
  githubListIssuesTool,
  githubCreateIssueTool,
  githubUpdateIssueTool,
  githubAddCommentTool,
  githubListPRsTool,
  githubAnalyzePRTool,
  githubRepoStatsTool,
  githubListCommitsTool,
];

// ── Tool Registration ──────────────────────────────────────────────

// Register all tools for skill execution engine
const allTools = [
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
  checkCodeQualityTool,
  webSearchTool,
  selfDiagnosisTool,
  executeRepairTool,
  setStrategyTool,
  getStrategyStatusTool,
  enableAutoStrategyTool,
  disableAutoStrategyTool,
  listSkillsTool,
  getSkillDetailTool,
  createSkillTool,
  rememberTool,
  recallTool,
  relateTool,
  memoryStatsTool,
  memoryExportTool,
  memoryImportTool,
  advancedMemorySearchTool,
  memoryClustersTool,
  githubListIssuesTool,
  githubCreateIssueTool,
  githubUpdateIssueTool,
  githubAddCommentTool,
  githubListPRsTool,
  githubAnalyzePRTool,
  githubRepoStatsTool,
  githubListCommitsTool,
  // Note: executeSkillTool is intentionally excluded to prevent recursive execution
];

// Register tools when this module loads
for (const tool of allTools) {
  registerTool(tool);
}

log.info("Tool registration complete", { count: allTools.length });
