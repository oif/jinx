/**
 * Jinx Tools Extension for Pi
 * Registers all Jinx custom tools via Pi Extension API
 */

import { Type } from "@sinclair/typebox";
import type {
  ExtensionAPI,
  ToolDefinition,
  AgentToolResult,
} from "@mariozechner/pi-coding-agent";
import { formatPerformanceReport } from "../src/observability/metrics.js";
import { runQualityCheck, formatQualityReport } from "../src/quality/code-quality.js";
import { runSelfDiagnosis, formatDiagnosisReport, executeRepairAction } from "../src/diagnosis/engine.js";
import { forceStrategy, getCurrentStrategy, formatStrategyStatus, enableAutoSelect, disableAutoSelect } from "../src/evolution/strategy.js";
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
} from "../src/skills/library.js";
import {
  encodeMemory,
  retrieveMemories,
  createRelationship,
  findRelatedMemories,
  getMemoryStats,
  formatMemoryStats,
  exportGraph,
  exportForVisualization,
  importGraph,
  advancedSemanticSearch,
  findMemoryClusters,
} from "../src/memory/graph.js";
import {
  listIssues,
  getIssue,
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
} from "../src/github/enhanced.js";
import { requestRestart } from "../src/supervisor/restart.js";
import { webSearch, formatSearchResults } from "../src/search/web-search.js";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { execSync } from "node:child_process";

const DATA_DIR = join(process.cwd(), "data");

function textResult(text: string): AgentToolResult<undefined> {
  return {
    content: [{ type: "text", text }],
    details: undefined,
  };
}

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Jinx Tools Extension
 * Implements the Extension factory function pattern
 */
export default function jinxToolsExtension(pi: ExtensionAPI) {
  // ── Core System Tools ─────────────────────────────────────────────

  pi.registerTool({
    name: "claude_code",
    label: "Claude Code",
    description:
      "Use Claude Code CLI for complex code editing tasks. " +
      "Provide a task description. Claude Code will read/write files, " +
      "run commands, and return the result. " +
      "Use this for multi-file changes or tasks requiring deep code understanding.",
    parameters: Type.Object({
      task: Type.String({ description: "Task description for Claude Code" }),
      cwd: Type.Optional(Type.String({ description: "Working directory (default: project root)" })),
    }),
    execute: async (_toolCallId, params) => {
      const task = params.task as string;
      const cwd = (params.cwd as string) || process.cwd();
      try {
        const env = { ...process.env };
        delete env.CLAUDECODE;

        const result = require("node:child_process").execSync(
          `claude --print --dangerously-skip-permissions "${task.replace(/"/g, '\\"')}"`,
          { cwd, timeout: 600_000, env }
        );
        return textResult(result.toString() || "(Claude Code completed with no output)");
      } catch (e) {
        const err = e as Error & { status?: number; stderr?: string };
        return textResult(`Claude Code error: ${err.stderr || err.message}`);
      }
    },
  });

  pi.registerTool({
    name: "request_restart",
    label: "Request Restart",
    description:
      "Request process restart to load newly committed code. " +
      "Only use AFTER committing and pushing changes to the dev branch.",
    parameters: Type.Object({
      reason: Type.String({ description: "Why restart is needed" }),
    }),
    execute: async (_toolCallId, params) => {
      requestRestart(params.reason as string);
      return textResult(`Restart requested: ${params.reason}. Supervisor will restart shortly.`);
    },
  });

  // ── File & Data Tools ─────────────────────────────────────────────

  pi.registerTool({
    name: "update_identity",
    label: "Update Identity",
    description: "Update your identity file (data/identity.md). Use when you learn something fundamental about yourself.",
    parameters: Type.Object({
      content: Type.String({ description: "New content (markdown)" }),
    }),
    execute: async (_toolCallId, params) => {
      ensureDataDir();
      writeFileSync(join(DATA_DIR, "identity.md"), params.content as string);
      return textResult("Identity updated.");
    },
  });

  pi.registerTool({
    name: "update_scratchpad",
    label: "Update Scratchpad",
    description: "Update your scratchpad (data/scratchpad.md). Use freely as working memory.",
    parameters: Type.Object({
      content: Type.String({ description: "New content (markdown)" }),
    }),
    execute: async (_toolCallId, params) => {
      ensureDataDir();
      writeFileSync(join(DATA_DIR, "scratchpad.md"), params.content as string);
      return textResult("Scratchpad updated.");
    },
  });

  pi.registerTool({
    name: "knowledge_write",
    label: "Write Knowledge",
    description: "Write an entry to the knowledge base (data/knowledge/<slug>.md).",
    parameters: Type.Object({
      slug: Type.String({ description: "Filename slug (e.g. 'git-rebase-tips')" }),
      content: Type.String({ description: "Knowledge content (markdown)" }),
    }),
    execute: async (_toolCallId, params) => {
      const knowledgeDir = join(DATA_DIR, "knowledge");
      if (!existsSync(knowledgeDir)) {
        mkdirSync(knowledgeDir, { recursive: true });
      }
      const slug = (params.slug as string).replace(/[^a-zA-Z0-9_-]/g, "-");
      writeFileSync(join(knowledgeDir, `${slug}.md`), params.content as string);
      return textResult(`Knowledge written: ${slug}.md`);
    },
  });

  // ── Web & Search Tools ────────────────────────────────────────────

  pi.registerTool({
    name: "fetch_webpage",
    label: "Fetch Webpage",
    description: "Fetch a webpage and extract its main content as Markdown.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch and convert to Markdown" }),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const url = params.url as string;
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Jinx Bot / pi-coding-agent (Linux x86_64)",
            "Accept": "text/html,application/xhtml+xml",
          },
        });

        if (!response.ok) {
          return textResult(`Failed to fetch ${url}: HTTP ${response.status}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);
        $("script, style, nav, footer, header, noscript, iframe, svg").remove();

        let mainHtml = "";
        if ($("main").length > 0) {
          mainHtml = $("main").html() || "";
        } else if ($("article").length > 0) {
          mainHtml = $("article").html() || "";
        } else {
          mainHtml = $("body").html() || "";
        }

        const turndown = new TurndownService({
          headingStyle: "atx",
          codeBlockStyle: "fenced",
        });

        const markdown = turndown.turndown(mainHtml);
        return textResult(`Content of ${url}:\n\n${markdown.slice(0, 100000)}`);
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`);
      }
    },
  });

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: "Search the web for information. Uses Brave Search or Serper API.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      count: Type.Optional(Type.Number({ description: "Number of results (1-20, default 10)" })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const result = await webSearch({
          query: params.query as string,
          count: (params.count as number) || 10,
        });
        return textResult(formatSearchResults(result));
      } catch (e) {
        return textResult(`Search error: ${(e as Error).message}`);
      }
    },
  });

  // ── Quality & Diagnosis Tools ─────────────────────────────────────

  pi.registerTool({
    name: "check_code_quality",
    label: "Check Code Quality",
    description: "Run ESLint, security audit, and complexity analysis.",
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const result = await runQualityCheck();
        return textResult(formatQualityReport(result));
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`);
      }
    },
  });

  pi.registerTool({
    name: "run_self_diagnosis",
    label: "Run Self-Diagnosis",
    description: "Analyze health history and performance metrics to identify issues.",
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const report = runSelfDiagnosis();
        return textResult(formatDiagnosisReport(report));
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`);
      }
    },
  });

  pi.registerTool({
    name: "execute_repair",
    label: "Execute Repair",
    description: "Execute an automated repair action (e.g., 'disk_cleanup').",
    parameters: Type.Object({
      command: Type.String({ description: "Repair command to execute" }),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const success = await executeRepairAction(params.command as string);
        return textResult(success ? `✅ Repair executed` : `❌ Repair failed`);
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`);
      }
    },
  });

  // ── Performance & Reporting ───────────────────────────────────────

  pi.registerTool({
    name: "get_performance_report",
    label: "Get Performance Report",
    description: "Get detailed performance metrics and statistics.",
    parameters: Type.Object({}),
    execute: async () => {
      try {
        return textResult(formatPerformanceReport());
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`);
      }
    },
  });

  // ── Evolution Strategy Tools ──────────────────────────────────────

  pi.registerTool({
    name: "set_evolution_strategy",
    label: "Set Evolution Strategy",
    description: "Set the evolution strategy (innovate/harden/repair-only/balanced).",
    parameters: Type.Object({
      strategy: Type.String({ description: "Strategy: innovate, harden, repair-only, or balanced" }),
      reason: Type.Optional(Type.String({ description: "Optional reason" })),
    }),
    execute: async (_toolCallId, params) => {
      const strategy = params.strategy as string;
      const reason = (params.reason as string) || "Manual change";
      
      if (!["innovate", "harden", "repair-only", "balanced"].includes(strategy)) {
        return textResult(`❌ Invalid strategy: ${strategy}`);
      }
      
      forceStrategy(strategy as any, reason);
      return textResult(`✅ Strategy set to: ${strategy}\nReason: ${reason}`);
    },
  });

  pi.registerTool({
    name: "get_strategy_status",
    label: "Get Strategy Status",
    description: "Get current evolution strategy and system state.",
    parameters: Type.Object({}),
    execute: async () => {
      return textResult(formatStrategyStatus());
    },
  });

  pi.registerTool({
    name: "enable_strategy_auto_select",
    label: "Enable Auto Strategy",
    description: "Enable automatic strategy selection based on health metrics.",
    parameters: Type.Object({}),
    execute: async () => {
      enableAutoSelect();
      return textResult(`✅ Auto strategy enabled. Current: ${getCurrentStrategy()}`);
    },
  });

  pi.registerTool({
    name: "disable_strategy_auto_select",
    label: "Disable Auto Strategy",
    description: "Disable automatic strategy selection.",
    parameters: Type.Object({}),
    execute: async () => {
      disableAutoSelect();
      return textResult(`✅ Auto strategy disabled. Current: ${getCurrentStrategy()} (fixed)`);
    },
  });

  // ── Memory System Tools ───────────────────────────────────────────

  pi.registerTool({
    name: "remember",
    label: "Remember",
    description: "Store a memory in the knowledge graph.",
    parameters: Type.Object({
      content: Type.String({ description: "Content to remember" }),
      type: Type.String({ description: "Type: concept, fact, experience, entity, skill, goal" }),
      tags: Type.Optional(Type.String({ description: "Comma-separated tags" })),
      importance: Type.Optional(Type.Number({ description: "Importance 0-1" })),
      relatedTo: Type.Optional(Type.String({ description: "Comma-separated memory IDs" })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const node = encodeMemory({
          content: params.content as string,
          type: params.type as any,
          tags: (params.tags as string)?.split(",").map(t => t.trim()).filter(Boolean),
          importance: (params.importance as number) ?? 0.5,
        });
        return textResult(`✅ Memory stored\nID: ${node.id}\nSummary: ${node.summary.slice(0, 100)}...`);
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`);
      }
    },
  });

  pi.registerTool({
    name: "recall",
    label: "Recall",
    description: "Search and retrieve memories from the knowledge graph.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      type: Type.Optional(Type.String({ description: "Filter by type" })),
      limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const results = retrieveMemories({
          text: params.query as string,
          type: params.type as any,
          limit: (params.limit as number) || 10,
        });

        if (results.length === 0) {
          return textResult("No memories found.");
        }

        const lines = [`🧠 Retrieved ${results.length} memories:`, ""];
        for (const r of results) {
          const relevance = Math.round(r.relevance * 100);
          lines.push(`[${relevance}%] ${r.node.type}: ${r.node.summary.slice(0, 80)}...`);
        }
        return textResult(lines.join("\n"));
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`);
      }
    },
  });

  pi.registerTool({
    name: "memory_stats",
    label: "Memory Statistics",
    description: "Get statistics about the knowledge graph memory system.",
    parameters: Type.Object({}),
    execute: async () => {
      return textResult(formatMemoryStats());
    },
  });

  // ── GitHub Tools ─────────────────────────────────────────────────

  pi.registerTool({
    name: "github_list_issues",
    label: "List GitHub Issues",
    description: "List issues from the GitHub repository. Requires GITHUB_TOKEN.",
    parameters: Type.Object({
      state: Type.Optional(Type.String({ description: "open, closed, or all" })),
      labels: Type.Optional(Type.String({ description: "Comma-separated labels" })),
      limit: Type.Optional(Type.Number({ description: "Max results" })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const issues = await listIssues(
          (params.state as any) || "open",
          (params.labels as string)?.split(",").map(l => l.trim()).filter(Boolean),
          (params.limit as number) || 30
        );
        return textResult(formatIssueList(issues));
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`);
      }
    },
  });

  pi.registerTool({
    name: "github_create_issue",
    label: "Create GitHub Issue",
    description: "Create a new issue. Requires GITHUB_TOKEN.",
    parameters: Type.Object({
      title: Type.String({ description: "Issue title" }),
      body: Type.String({ description: "Issue body" }),
      labels: Type.Optional(Type.String({ description: "Comma-separated labels" })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const issue = await createIssue(
          params.title as string,
          params.body as string,
          (params.labels as string)?.split(",").map(l => l.trim()).filter(Boolean)
        );
        return textResult(`✅ Issue created: #${issue.number}\n${issue.html_url}`);
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`);
      }
    },
  });

  pi.registerTool({
    name: "github_list_prs",
    label: "List GitHub PRs",
    description: "List pull requests. Requires GITHUB_TOKEN.",
    parameters: Type.Object({
      state: Type.Optional(Type.String({ description: "open, closed, or all" })),
      limit: Type.Optional(Type.Number({ description: "Max results" })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const prs = await listPullRequests(
          (params.state as any) || "open",
          (params.limit as number) || 30
        );
        return textResult(formatPRList(prs));
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`);
      }
    },
  });

  pi.registerTool({
    name: "github_analyze_pr",
    label: "Analyze GitHub PR",
    description: "Analyze a PR for code review. Requires GITHUB_TOKEN.",
    parameters: Type.Object({
      prNumber: Type.Number({ description: "PR number" }),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const analysis = await analyzePullRequest(params.prNumber as number);
        return textResult(formatPRAnalysis(analysis));
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`);
      }
    },
  });

  pi.registerTool({
    name: "github_repo_stats",
    label: "GitHub Repo Stats",
    description: "Get repository statistics. Requires GITHUB_TOKEN.",
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const stats = await getRepoStats();
        return textResult(formatRepoStats(stats));
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`);
      }
    },
  });

  pi.registerTool({
    name: "github_list_commits",
    label: "List GitHub Commits",
    description: "List recent commits. Requires GITHUB_TOKEN.",
    parameters: Type.Object({
      branch: Type.Optional(Type.String({ description: "Branch name" })),
      limit: Type.Optional(Type.Number({ description: "Max results" })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const commits = await listCommits(
          (params.branch as string) || "main",
          (params.limit as number) || 20
        );
        const lines = [`📝 Recent Commits (${commits.length})`, ""];
        for (const c of commits) {
          lines.push(`${c.sha.slice(0, 7)}: ${c.commit.message.split("\n")[0].slice(0, 60)}`);
        }
        return textResult(lines.join("\n"));
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`);
      }
    },
  });

  // ── Skills System ─────────────────────────────────────────────────

  pi.registerTool({
    name: "list_skills",
    label: "List Skills",
    description: "List all skills in the skill library.",
    parameters: Type.Object({
      tag: Type.Optional(Type.String({ description: "Filter by tag" })),
      search: Type.Optional(Type.String({ description: "Search term" })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        let skills;
        if (params.tag || params.search) {
          skills = searchSkills({
            tags: params.tag ? [params.tag as string] : undefined,
            nameContains: params.search as string,
          });
        } else {
          skills = listAllSkills();
        }
        return textResult(formatSkillList(skills));
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`);
      }
    },
  });

  pi.registerTool({
    name: "get_skill_detail",
    label: "Get Skill Detail",
    description: "Get detailed information about a skill.",
    parameters: Type.Object({
      skillId: Type.String({ description: "Skill ID" }),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const skill = loadSkill(params.skillId as string);
        if (!skill) {
          return textResult(`❌ Skill not found: ${params.skillId}`);
        }
        return textResult(formatSkillDetail(skill));
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`);
      }
    },
  });

  pi.registerTool({
    name: "create_skill",
    label: "Create Skill",
    description: "Create a new skill from template.",
    parameters: Type.Object({
      name: Type.String({ description: "Skill name" }),
      description: Type.String({ description: "What this skill does" }),
      template: Type.Optional(Type.String({ description: "Template: code-review, pre-commit, system-health-check" })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const template = params.template as keyof typeof SKILL_TEMPLATES | undefined;
        let skill;
        if (template && template in SKILL_TEMPLATES) {
          skill = createSkillFromTemplate(template, { description: params.description as string });
          skill = { ...skill, name: params.name as string };
        } else {
          skill = createSkill({
            name: params.name as string,
            description: params.description as string,
            version: "1.0.0",
            tags: [],
            parameters: [],
            steps: [],
          });
        }
        return textResult(`✅ Skill created: ${skill.name}\nID: ${skill.id}`);
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`);
      }
    },
  });

  // Log extension loaded
  console.log("[Jinx Tools Extension] Loaded 30+ tools");
}
