/**
 * Tool Groups Manager
 *
 * Implements a tool selection mechanism similar to GitHub MCP Server's X-MCP-Tools header.
 * Allows configuring which tool groups to load, reducing context usage and optimizing
 * tool availability for different use cases.
 *
 * Configuration via environment variable:
 *   JINX_TOOL_GROUPS=github,evolution,memory,system
 *
 * Or via config file: data/tool-groups.json
 *   {"enabled": ["github", "evolution", "memory"]}
 *
 * If not configured, all tools are enabled.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { log } from "../util/log.js";

// ── Tool Group Definitions ─────────────────────────────────────────

/**
 * Tool groups organize tools by functional area.
 * This allows selective loading based on the task at hand.
 */
export interface ToolGroup {
  name: string;
  description: string;
  tools: string[]; // Tool names in this group
}

/**
 * All available tool groups.
 * Each tool can belong to multiple groups.
 */
export const TOOL_GROUPS: Record<string, ToolGroup> = {
  github: {
    name: "github",
    description: "GitHub integration: issues, PRs, repository management",
    tools: [
      "github_list_issues",
      "github_create_issue",
      "github_update_issue",
      "github_add_comment",
      "github_list_prs",
      "github_analyze_pr",
      "github_repo_stats",
      "github_list_commits",
      "github_create_pr",
    ],
  },

  memory: {
    name: "memory",
    description: "Knowledge graph memory system: store, retrieve, and relate memories",
    tools: [
      "remember",
      "recall",
      "relate_memories",
      "memory_stats",
      "export_memory",
      "import_memory",
      "advanced_memory_search",
      "memory_clusters",
    ],
  },

  evolution: {
    name: "evolution",
    description: "Self-improvement and evolution cycle support",
    tools: [
      "claude_code",
      "request_restart",
      "check_code_quality",
      "run_self_diagnosis",
      "execute_repair",
      "set_evolution_strategy",
      "get_strategy_status",
      "enable_strategy_auto_select",
      "disable_strategy_auto_select",
      "add_backlog_task",
    ],
  },

  skills: {
    name: "skills",
    description: "Skill library: create and execute reusable workflows",
    tools: [
      "list_skills",
      "get_skill_detail",
      "create_skill",
      "execute_skill",
    ],
  },

  system: {
    name: "system",
    description: "System state and identity management",
    tools: [
      "update_identity",
      "update_scratchpad",
      "update_state",
      "knowledge_write",
      "get_performance_report",
    ],
  },

  web: {
    name: "web",
    description: "Web interaction: search and fetch content",
    tools: [
      "web_search",
      "fetch_webpage",
    ],
  },

  swarm: {
    name: "swarm",
    description: "Multi-agent swarm coordination",
    tools: [
      "run_swarm",
    ],
  },
};

/**
 * Essential tools that are always enabled regardless of group configuration.
 * These are fundamental to Jinx's operation.
 */
export const ESSENTIAL_TOOLS = new Set([
  "send_owner_message",   // Key results → owner DM + 🏆 Results topic
  "send_stream_message",  // Verbose progress → 🌊 Stream topic
]);

// ── Configuration ──────────────────────────────────────────────────

interface ToolGroupsConfig {
  enabled?: string[]; // Groups to enable
  disabled?: string[]; // Groups to disable (takes precedence)
  tools?: {
    include?: string[]; // Additional tools to include
    exclude?: string[]; // Tools to exclude (takes precedence)
  };
}

/**
 * Load tool groups configuration from:
 * 1. Environment variable JINX_TOOL_GROUPS (comma-separated group names)
 * 2. Config file data/tool-groups.json
 * 3. Default: all groups enabled
 */
function loadConfig(): ToolGroupsConfig {
  // Try environment variable first
  const envGroups = process.env.JINX_TOOL_GROUPS;
  if (envGroups) {
    const groups = envGroups.split(",").map(g => g.trim()).filter(Boolean);
    log.info("Tool groups from environment", { groups });
    return { enabled: groups };
  }

  // Try config file
  const configPath = join(process.cwd(), "data", "tool-groups.json");
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as ToolGroupsConfig;
      log.info("Tool groups from config file", { config });
      return config;
    } catch (e) {
      log.warn("Failed to load tool-groups.json, using defaults", { error: (e as Error).message });
    }
  }

  // Default: all enabled
  return { enabled: ["all"] };
}

// ── Tool Filtering ─────────────────────────────────────────────────

/**
 * Get the set of enabled tool names based on configuration.
 */
export function getEnabledToolNames(): Set<string> {
  const config = loadConfig();
  const enabledTools = new Set<string>(ESSENTIAL_TOOLS);

  // Handle "all" special case
  const allGroups = Object.keys(TOOL_GROUPS);
  const enabledGroups = config.enabled?.includes("all")
    ? allGroups
    : (config.enabled ?? allGroups);

  // Add tools from enabled groups
  for (const groupName of enabledGroups) {
    const group = TOOL_GROUPS[groupName];
    if (group) {
      for (const toolName of group.tools) {
        enabledTools.add(toolName);
      }
    } else {
      log.warn(`Unknown tool group: ${groupName}`);
    }
  }

  // Remove tools from disabled groups
  if (config.disabled) {
    for (const groupName of config.disabled) {
      const group = TOOL_GROUPS[groupName];
      if (group) {
        for (const toolName of group.tools) {
          enabledTools.delete(toolName);
        }
      }
    }
  }

  // Add explicitly included tools
  if (config.tools?.include) {
    for (const toolName of config.tools.include) {
      enabledTools.add(toolName);
    }
  }

  // Remove explicitly excluded tools
  if (config.tools?.exclude) {
    for (const toolName of config.tools.exclude) {
      enabledTools.delete(toolName);
    }
  }

  return enabledTools;
}

/**
 * Filter tools based on enabled groups configuration.
 * Returns only tools that should be registered.
 */
export function filterToolsByGroups(tools: ToolDefinition[]): ToolDefinition[] {
  const enabledNames = getEnabledToolNames();
  const filtered = tools.filter(tool => enabledNames.has(tool.name));

  const skipped = tools.length - filtered.length;
  if (skipped > 0) {
    log.info("Tools filtered by group configuration", {
      total: tools.length,
      enabled: filtered.length,
      skipped,
    });
  }

  return filtered;
}

/**
 * Get a human-readable summary of current tool group configuration.
 */
export function getToolGroupsSummary(): string {
  const config = loadConfig();
  const enabledNames = getEnabledToolNames();

  const lines: string[] = [
    "# Tool Groups Configuration",
    "",
    `**Mode:** ${config.enabled?.includes("all") || !config.enabled ? "All enabled" : "Selective"}`,
    "",
    "## Group Status",
    "",
  ];

  for (const [key, group] of Object.entries(TOOL_GROUPS)) {
    const enabledTools = group.tools.filter(t => enabledNames.has(t));
    const status = enabledTools.length === group.tools.length ? "✅" :
                   enabledTools.length > 0 ? "⚠️ Partial" : "❌";
    lines.push(`- **${key}** ${status}: ${enabledTools.length}/${group.tools.length} tools`);
  }

  lines.push("");
  lines.push(`**Total tools enabled:** ${enabledNames.size}`);

  return lines.join("\n");
}

/**
 * Get list of all available tool group names.
 */
export function getAvailableGroups(): string[] {
  return Object.keys(TOOL_GROUPS);
}

/**
 * Get tools in a specific group.
 */
export function getToolsInGroup(groupName: string): string[] {
  return TOOL_GROUPS[groupName]?.tools ?? [];
}