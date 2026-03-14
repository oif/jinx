/**
 * Tool Evolution System
 *
 * Enables Jinx to automatically create new tools, skills, and extensions
 * to expand its own capabilities based on observed needs and patterns.
 *
 * Core Components:
 * 1. Tool Need Analyzer - Identifies gaps in tool capabilities
 * 2. Tool Generator - Creates new tool/skill/extension definitions
 * 3. Tool Registry - Manages dynamic tool registration
 * 4. Tool Evolution Engine - Orchestrates the evolution process
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../supervisor/paths.js";
import { log } from "../util/log.js";
import {
  createSkill,
  loadSkill,
  type Skill,
  type SkillParameter,
  type ToolCallSpec,
  getRegisteredTools,
} from "../skills/library.js";

// ── Paths ──────────────────────────────────────────────────────────

const TOOL_EVOLUTION_PATH = join(DATA_DIR, "tool-evolution.json");
const GENERATED_TOOLS_DIR = join(DATA_DIR, "generated-tools");

// ── Types ──────────────────────────────────────────────────────────

export type ToolType = "tool" | "skill" | "extension";

export interface ToolNeed {
  id: string;
  type: ToolType;
  name: string;
  description: string;
  rationale: string;
  priority: "critical" | "high" | "normal" | "low";
  category: string;
  suggestedImplementation?: string;
  relatedCapabilities?: string[];
  createdAt: string;
  status: "identified" | "planned" | "implementing" | "completed" | "rejected";
}

export interface GeneratedTool {
  id: string;
  name: string;
  type: ToolType;
  description: string;
  code: string;
  filePath: string;
  createdAt: string;
  usageCount: number;
  lastUsedAt?: string;
  isRegistered: boolean;
  source: "auto-generated" | "manual";
}

export interface ToolEvolutionState {
  lastAnalysis: string;
  identifiedNeeds: ToolNeed[];
  generatedTools: GeneratedTool[];
  analysisCount: number;
  generationCount: number;
  rejectionCount: number;
}

export interface ToolTemplate {
  id: string;
  name: string;
  type: ToolType;
  description: string;
  category: string;
  parameters: SkillParameter[];
  steps?: ToolCallSpec[];
  codeTemplate?: string;
  tags: string[];
}

export interface ToolUsagePattern {
  toolName: string;
  usageCount: number;
  successRate: number;
  avgDurationMs: number;
  lastUsed: string;
  commonPatterns: string[];
}

// ── Tool Templates ────────────────────────────────────────────────

export const TOOL_TEMPLATES: Record<string, ToolTemplate> = {
  "data-transformer": {
    id: "data-transformer",
    name: "Data Transformer",
    type: "skill",
    description: "Transform data from one format to another",
    category: "data",
    parameters: [
      {
        name: "input",
        type: "string",
        description: "Input data or file path",
        required: true,
      },
      {
        name: "format",
        type: "string",
        description: "Target format (json, yaml, csv, markdown)",
        required: true,
        validation: { options: ["json", "yaml", "csv", "markdown"] },
      },
    ],
    tags: ["data", "transform", "format"],
  },
  "file-analyzer": {
    id: "file-analyzer",
    name: "File Analyzer",
    type: "skill",
    description: "Analyze files for patterns, issues, or metrics",
    category: "analysis",
    parameters: [
      {
        name: "target",
        type: "string",
        description: "File or directory to analyze",
        required: true,
      },
      {
        name: "analysisType",
        type: "string",
        description: "Type of analysis (complexity, security, style)",
        required: true,
        validation: { options: ["complexity", "security", "style", "dependencies"] },
      },
    ],
    tags: ["analysis", "file", "code-quality"],
  },
  "api-client": {
    id: "api-client",
    name: "API Client",
    type: "skill",
    description: "Make HTTP requests to external APIs with retry and error handling",
    category: "network",
    parameters: [
      {
        name: "url",
        type: "string",
        description: "API endpoint URL",
        required: true,
      },
      {
        name: "method",
        type: "string",
        description: "HTTP method",
        required: false,
        defaultValue: "GET",
        validation: { options: ["GET", "POST", "PUT", "DELETE", "PATCH"] },
      },
      {
        name: "headers",
        type: "object",
        description: "Request headers as JSON object",
        required: false,
      },
      {
        name: "body",
        type: "object",
        description: "Request body for POST/PUT/PATCH",
        required: false,
      },
    ],
    tags: ["api", "http", "network"],
  },
  "notification-sender": {
    id: "notification-sender",
    name: "Notification Sender",
    type: "skill",
    description: "Send notifications through various channels",
    category: "communication",
    parameters: [
      {
        name: "message",
        type: "string",
        description: "Message to send",
        required: true,
      },
      {
        name: "channel",
        type: "string",
        description: "Notification channel (telegram, log, file)",
        required: true,
        validation: { options: ["telegram", "log", "file"] },
      },
      {
        name: "priority",
        type: "string",
        description: "Message priority",
        required: false,
        defaultValue: "normal",
        validation: { options: ["low", "normal", "high", "critical"] },
      },
    ],
    tags: ["notification", "communication", "alert"],
  },
  "backup-manager": {
    id: "backup-manager",
    name: "Backup Manager",
    type: "skill",
    description: "Create and manage backups of important files",
    category: "maintenance",
    parameters: [
      {
        name: "action",
        type: "string",
        description: "Action to perform",
        required: true,
        validation: { options: ["create", "restore", "list", "cleanup"] },
      },
      {
        name: "target",
        type: "string",
        description: "File or directory to backup/restore",
        required: false,
      },
      {
        name: "maxBackups",
        type: "number",
        description: "Maximum number of backups to keep",
        required: false,
        defaultValue: 5,
      },
    ],
    tags: ["backup", "maintenance", "recovery"],
  },
  "scheduler": {
    id: "scheduler",
    name: "Task Scheduler",
    type: "skill",
    description: "Schedule tasks to run at specific times or intervals",
    category: "automation",
    parameters: [
      {
        name: "action",
        type: "string",
        description: "Action to perform",
        required: true,
        validation: { options: ["schedule", "cancel", "list", "trigger"] },
      },
      {
        name: "taskName",
        type: "string",
        description: "Name of the scheduled task",
        required: false,
      },
      {
        name: "schedule",
        type: "string",
        description: "Schedule expression (cron or relative time like '+1h')",
        required: false,
      },
      {
        name: "command",
        type: "string",
        description: "Command or tool to execute",
        required: false,
      },
    ],
    tags: ["schedule", "automation", "task"],
  },
};

// ── State Management ──────────────────────────────────────────────

function loadState(): ToolEvolutionState {
  try {
    if (existsSync(TOOL_EVOLUTION_PATH)) {
      return JSON.parse(readFileSync(TOOL_EVOLUTION_PATH, "utf-8"));
    }
  } catch (e) {
    log.warn("Failed to load tool evolution state", { error: (e as Error).message });
  }
  return {
    lastAnalysis: new Date().toISOString(),
    identifiedNeeds: [],
    generatedTools: [],
    analysisCount: 0,
    generationCount: 0,
    rejectionCount: 0,
  };
}

function saveState(state: ToolEvolutionState): void {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    writeFileSync(TOOL_EVOLUTION_PATH, JSON.stringify(state, null, 2));
  } catch (e) {
    log.error("Failed to save tool evolution state", { error: (e as Error).message });
  }
}

function ensureGeneratedToolsDir(): void {
  if (!existsSync(GENERATED_TOOLS_DIR)) {
    mkdirSync(GENERATED_TOOLS_DIR, { recursive: true });
  }
}

// ── Tool Need Analyzer ────────────────────────────────────────────

/**
 * Analyze tool usage patterns to identify gaps and needs
 */
export function analyzeToolNeeds(): ToolNeed[] {
  const state = loadState();
  const needs: ToolNeed[] = [];
  const registeredTools = getRegisteredTools();

  // Analyze based on different heuristics
  const now = new Date().toISOString();

  // Check for missing data transformation capabilities
  if (!registeredTools.includes("transform_data") && !hasSkillWithName("Data Transformer")) {
    needs.push({
      id: `need-${Date.now()}-data-transform`,
      type: "skill",
      name: "Data Transformer",
      description: "Transform data between formats (JSON, YAML, CSV, Markdown)",
      rationale: "No dedicated data transformation tool available. Multiple tools deal with different formats but none provides unified transformation.",
      priority: "normal",
      category: "data",
      suggestedImplementation: "data-transformer",
      createdAt: now,
      status: "identified",
    });
  }

  // Check for backup capabilities
  if (!registeredTools.includes("backup") && !hasSkillWithName("Backup Manager")) {
    needs.push({
      id: `need-${Date.now()}-backup`,
      type: "skill",
      name: "Backup Manager",
      description: "Create and manage backups of important files and data",
      rationale: "BORN.md emphasizes data safety and backups. Current backup capabilities are limited.",
      priority: "high",
      category: "maintenance",
      suggestedImplementation: "backup-manager",
      createdAt: now,
      status: "identified",
    });
  }

  // Check for scheduling capabilities
  if (!registeredTools.includes("schedule_task") && !hasSkillWithName("Task Scheduler")) {
    needs.push({
      id: `need-${Date.now()}-scheduler`,
      type: "skill",
      name: "Task Scheduler",
      description: "Schedule tasks to run at specific times or intervals",
      rationale: "Jinx currently uses set_next_wakeup but lacks persistent scheduling for recurring tasks.",
      priority: "normal",
      category: "automation",
      suggestedImplementation: "scheduler",
      createdAt: now,
      status: "identified",
    });
  }

  // Update state
  state.lastAnalysis = now;
  state.analysisCount++;

  // Merge with existing needs (avoid duplicates)
  for (const need of needs) {
    const existing = state.identifiedNeeds.find(
      n => n.name === need.name && n.status !== "completed" && n.status !== "rejected"
    );
    if (!existing) {
      state.identifiedNeeds.push(need);
    }
  }

  saveState(state);
  log.info("Tool need analysis completed", { newNeeds: needs.length, totalNeeds: state.identifiedNeeds.length });

  return needs;
}

function hasSkillWithName(name: string): boolean {
  const skills = Object.values(TOOL_TEMPLATES).filter(t => t.type === "skill");
  return skills.some(s => s.name === name);
}

// ── Tool Generator ────────────────────────────────────────────────

/**
 * Generate a new tool/skill based on a need or template
 */
export function generateTool(
  need: ToolNeed | null,
  templateKey?: string
): GeneratedTool | null {
  const state = loadState();
  ensureGeneratedToolsDir();

  let template: ToolTemplate | undefined;
  let toolName: string;
  let toolDescription: string;
  let toolType: ToolType;
  let category: string;

  // Use template if provided
  if (templateKey) {
    template = TOOL_TEMPLATES[templateKey];
    if (!template) {
      log.warn(`Unknown template: ${templateKey}`);
      return null;
    }
    toolName = template.name;
    toolDescription = template.description;
    toolType = template.type;
    category = template.category;
  } else if (need) {
    // Generate from need
    if (need.suggestedImplementation && TOOL_TEMPLATES[need.suggestedImplementation]) {
      template = TOOL_TEMPLATES[need.suggestedImplementation];
    }
    toolName = need.name;
    toolDescription = need.description;
    toolType = need.type;
    category = need.category;
  } else {
    return null;
  }

  // Generate the tool
  const id = `gen-${Date.now()}`;
  let code = "";
  let filePath = "";

  if (toolType === "skill") {
    // Create a skill
    const skill = createSkillFromTemplate(template, toolName, toolDescription, category);
    if (skill) {
      code = JSON.stringify(skill, null, 2);
      filePath = join(GENERATED_TOOLS_DIR, `skill-${skill.id}.json`);
      writeFileSync(filePath, code);
    }
  } else {
    // Generate a tool code template
    code = generateToolCode(toolName, toolDescription, template);
    filePath = join(GENERATED_TOOLS_DIR, `tool-${id}.ts`);
    writeFileSync(filePath, code);
  }

  const generatedTool: GeneratedTool = {
    id,
    name: toolName,
    type: toolType,
    description: toolDescription,
    code,
    filePath,
    createdAt: new Date().toISOString(),
    usageCount: 0,
    isRegistered: toolType === "skill", // Skills are auto-registered
    source: "auto-generated",
  };

  // Update state
  state.generatedTools.push(generatedTool);
  state.generationCount++;

  // Update need status if provided
  if (need) {
    const needIndex = state.identifiedNeeds.findIndex(n => n.id === need.id);
    if (needIndex !== -1) {
      state.identifiedNeeds[needIndex].status = "completed";
    }
  }

  saveState(state);
  log.info("Tool generated", { name: toolName, type: toolType, id });

  return generatedTool;
}

function createSkillFromTemplate(
  template: ToolTemplate | undefined,
  name: string,
  description: string,
  category: string
): Skill | null {
  try {
    const skill = createSkill({
      name,
      description,
      version: "1.0.0",
      tags: template?.tags || [category],
      parameters: template?.parameters || [],
      steps: template?.steps || [],
    });
    return skill;
  } catch (e) {
    log.error("Failed to create skill from template", { error: (e as Error).message });
    return null;
  }
}

function generateToolCode(
  name: string,
  description: string,
  _template: ToolTemplate | undefined
): string {
  const functionName = name.toLowerCase().replace(/\s+/g, "_");

  return `/**
 * Auto-generated Tool: ${name}
 * ${description}
 * Generated at: ${new Date().toISOString()}
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition, AgentToolResult, ExtensionContext } from "@mariozechner/pi-coding-agent";

const ${functionName}Params = Type.Object({
  // TODO: Define parameters based on tool requirements
  input: Type.String({ description: "Input parameter" }),
});

export const ${functionName}Tool: ToolDefinition = {
  name: "${functionName}",
  label: "${name}",
  description: "${description}",
  parameters: ${functionName}Params,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext
  ): Promise<AgentToolResult<unknown>> => {
    try {
      const input = params.input as string;
      
      // TODO: Implement tool logic
      const result = \`Processed: \${input}\`;
      
      return {
        content: [{ type: "text", text: result }],
        details: undefined,
      };
    } catch (e) {
      const err = e as Error;
      return {
        content: [{ type: "text", text: \`Error: \${err.message}\` }],
        details: undefined,
      };
    }
  },
};
`;
}

// ── Tool Registration ─────────────────────────────────────────────

/**
 * Register a generated tool with the skill execution engine
 */
export function registerGeneratedTool(tool: GeneratedTool): boolean {
  if (tool.isRegistered) {
    log.info("Tool already registered", { name: tool.name });
    return true;
  }

  if (tool.type === "skill") {
    // Skills are already registered through the skill library
    const skill = loadSkill(tool.name.toLowerCase().replace(/\s+/g, "-"));
    if (skill) {
      tool.isRegistered = true;
      return true;
    }
  }

  log.warn("Tool registration not yet supported for type", { type: tool.type, name: tool.name });
  return false;
}

// ── Tool Evolution Engine ─────────────────────────────────────────

export interface ToolEvolutionResult {
  analyzed: boolean;
  needsIdentified: number;
  toolsGenerated: number;
  toolsRegistered: number;
  needs: ToolNeed[];
  generatedTools: GeneratedTool[];
  summary: string;
}

/**
 * Run the full tool evolution cycle
 */
export function runToolEvolution(): ToolEvolutionResult {
  log.info("Starting tool evolution cycle");

  // Step 1: Analyze needs
  const needs = analyzeToolNeeds();
  const unmetNeeds = needs.filter(n => n.status === "identified");

  // Step 2: Generate tools for high-priority needs
  const generatedTools: GeneratedTool[] = [];
  let registeredCount = 0;

  for (const need of unmetNeeds) {
    if (need.priority === "critical" || need.priority === "high") {
      const tool = generateTool(need);
      if (tool) {
        generatedTools.push(tool);
        if (registerGeneratedTool(tool)) {
          registeredCount++;
        }
      }
    }
  }

  // Step 3: Generate summary
  const summary = formatToolEvolutionResult(needs.length, generatedTools.length, registeredCount);

  log.info("Tool evolution cycle completed", {
    needsIdentified: needs.length,
    toolsGenerated: generatedTools.length,
    toolsRegistered: registeredCount,
  });

  return {
    analyzed: true,
    needsIdentified: needs.length,
    toolsGenerated: generatedTools.length,
    toolsRegistered: registeredCount,
    needs,
    generatedTools,
    summary,
  };
}

// ── Status and Reporting ──────────────────────────────────────────

export function formatToolEvolutionStatus(): string {
  const state = loadState();
  const lines: string[] = [
    "🔧 Tool Evolution Status",
    "=".repeat(40),
    "",
    `Last Analysis: ${new Date(state.lastAnalysis).toLocaleString()}`,
    `Analysis Count: ${state.analysisCount}`,
    `Tools Generated: ${state.generationCount}`,
    `Needs Rejected: ${state.rejectionCount}`,
    "",
  ];

  // Pending needs
  const pendingNeeds = state.identifiedNeeds.filter(
    n => n.status === "identified" || n.status === "planned"
  );
  if (pendingNeeds.length > 0) {
    lines.push(`📋 Pending Needs (${pendingNeeds.length}):`);
    for (const need of pendingNeeds.slice(0, 5)) {
      const priority = { critical: "🔴", high: "🟠", normal: "🔵", low: "⚪" }[need.priority];
      lines.push(`  ${priority} ${need.name} (${need.type})`);
      lines.push(`     ${need.description.slice(0, 60)}...`);
    }
    lines.push("");
  }

  // Generated tools
  if (state.generatedTools.length > 0) {
    lines.push(`🛠️ Generated Tools (${state.generatedTools.length}):`);
    for (const tool of state.generatedTools.slice(0, 5)) {
      const status = tool.isRegistered ? "✅" : "⏳";
      lines.push(`  ${status} ${tool.name} (${tool.type}) - used ${tool.usageCount}x`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatToolEvolutionResult(
  needsIdentified: number,
  toolsGenerated: number,
  toolsRegistered: number
): string {
  const lines: string[] = [
    "🔧 Tool Evolution Cycle Complete",
    "",
    `📊 Analysis Results:`,
    `   Needs Identified: ${needsIdentified}`,
    `   Tools Generated: ${toolsGenerated}`,
    `   Tools Registered: ${toolsRegistered}`,
    "",
  ];

  if (toolsGenerated > 0) {
    lines.push("✅ New capabilities added to Jinx's toolset");
  } else if (needsIdentified > 0) {
    lines.push("ℹ️ Needs identified but no tools generated (lower priority)");
  } else {
    lines.push("✅ No unmet tool needs detected");
  }

  return lines.join("\n");
}

export function formatToolTemplates(): string {
  const lines: string[] = [
    "📚 Available Tool Templates",
    "",
  ];

  for (const [key, template] of Object.entries(TOOL_TEMPLATES)) {
    lines.push(`🔧 ${key}`);
    lines.push(`   Name: ${template.name}`);
    lines.push(`   Type: ${template.type}`);
    lines.push(`   Description: ${template.description}`);
    lines.push(`   Category: ${template.category}`);
    lines.push(`   Tags: ${template.tags.join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function formatToolNeeds(needs: ToolNeed[]): string {
  if (needs.length === 0) {
    return "📋 No tool needs identified";
  }

  const lines: string[] = [
    `📋 Tool Needs (${needs.length})`,
    "",
  ];

  // Group by status
  const byStatus: Record<string, ToolNeed[]> = {};
  for (const need of needs) {
    if (!byStatus[need.status]) {
      byStatus[need.status] = [];
    }
    byStatus[need.status].push(need);
  }

  for (const [status, statusNeeds] of Object.entries(byStatus)) {
    lines.push(`### ${status.toUpperCase()} (${statusNeeds.length})`);
    for (const need of statusNeeds) {
      const priority = { critical: "🔴", high: "🟠", normal: "🔵", low: "⚪" }[need.priority];
      lines.push(`  ${priority} ${need.name} (${need.type})`);
      lines.push(`     ${need.description}`);
      if (need.suggestedImplementation) {
        lines.push(`     Suggested: ${need.suggestedImplementation}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Manual Tool Creation ──────────────────────────────────────────

export interface CreateToolRequest {
  name: string;
  description: string;
  type: ToolType;
  template?: string;
  category?: string;
  parameters?: SkillParameter[];
  steps?: ToolCallSpec[];
}

export function createCustomTool(request: CreateToolRequest): GeneratedTool | null {
  const state = loadState();

  // Check for existing tool with same name
  const existing = state.generatedTools.find(t => t.name === request.name);
  if (existing) {
    log.warn("Tool with this name already exists", { name: request.name });
    return null;
  }

  // Create based on type
  if (request.type === "skill") {
    const skill = createSkill({
      name: request.name,
      description: request.description,
      version: "1.0.0",
      tags: request.category ? [request.category] : [],
      parameters: request.parameters || [],
      steps: request.steps || [],
    });

    if (skill) {
      const id = `custom-${Date.now()}`;
      ensureGeneratedToolsDir();
      const filePath = join(GENERATED_TOOLS_DIR, `skill-${skill.id}.json`);

      const generatedTool: GeneratedTool = {
        id,
        name: request.name,
        type: "skill",
        description: request.description,
        code: JSON.stringify(skill, null, 2),
        filePath,
        createdAt: new Date().toISOString(),
        usageCount: 0,
        isRegistered: true,
        source: "manual",
      };

      state.generatedTools.push(generatedTool);
      state.generationCount++;
      saveState(state);

      log.info("Custom tool created", { name: request.name, type: request.type });
      return generatedTool;
    }
  }

  return null;
}

// ── Statistics ────────────────────────────────────────────────────

export function getToolEvolutionStats(): {
  analysisCount: number;
  generationCount: number;
  rejectionCount: number;
  totalNeeds: number;
  pendingNeeds: number;
  generatedTools: number;
  registeredTools: number;
} {
  const state = loadState();
  return {
    analysisCount: state.analysisCount,
    generationCount: state.generationCount,
    rejectionCount: state.rejectionCount,
    totalNeeds: state.identifiedNeeds.length,
    pendingNeeds: state.identifiedNeeds.filter(n => n.status === "identified").length,
    generatedTools: state.generatedTools.length,
    registeredTools: state.generatedTools.filter(t => t.isRegistered).length,
  };
}