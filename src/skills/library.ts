/**
 * Skill Library System
 *
 * Enables Jinx to create, store, and reuse parameterized skills (tool combinations).
 * Skills are reusable workflows composed of multiple tool calls with parameter templates.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../supervisor/paths.js";
import { log } from "../util/log.js";

const SKILLS_DIR = join(DATA_DIR, "skills");
const SKILL_INDEX_PATH = join(SKILLS_DIR, "index.json");

// ── Types ──────────────────────────────────────────────────────────

export type ToolCallSpec = {
  toolName: string;
  params: Record<string, unknown>;
  description?: string;
};

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
  lastUsedAt?: string;
  tags: string[];
  
  // Parameter schema for the skill
  parameters: SkillParameter[];
  
  // Sequence of tool calls
  steps: ToolCallSpec[];
  
  // Success criteria
  successIndicators?: string[];
  
  // Error handling
  errorRecovery?: {
    retryCount: number;
    fallbackSkill?: string;
  };
}

export interface SkillParameter {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required: boolean;
  defaultValue?: unknown;
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    options?: unknown[];
  };
}

export interface SkillExecutionContext {
  skillId: string;
  params: Record<string, unknown>;
  startTime: string;
  stepResults: SkillStepResult[];
  status: "running" | "completed" | "failed" | "partial";
  error?: string;
}

export interface SkillStepResult {
  stepIndex: number;
  toolName: string;
  params: Record<string, unknown>;
  success: boolean;
  result?: string;
  error?: string;
  durationMs: number;
}

export interface SkillSearchFilters {
  tags?: string[];
  minUsageCount?: number;
  nameContains?: string;
}

// ── Initialization ─────────────────────────────────────────────────

function ensureSkillsDir(): void {
  if (!existsSync(SKILLS_DIR)) {
    mkdirSync(SKILLS_DIR, { recursive: true });
  }
}

function loadSkillIndex(): string[] {
  try {
    if (existsSync(SKILL_INDEX_PATH)) {
      return JSON.parse(readFileSync(SKILL_INDEX_PATH, "utf-8"));
    }
  } catch (e) {
    log.warn("Failed to load skill index", { error: (e as Error).message });
  }
  return [];
}

function saveSkillIndex(index: string[]): void {
  try {
    ensureSkillsDir();
    writeFileSync(SKILL_INDEX_PATH, JSON.stringify(index, null, 2));
  } catch (e) {
    log.error("Failed to save skill index", { error: (e as Error).message });
  }
}

function getSkillPath(skillId: string): string {
  return join(SKILLS_DIR, `${skillId}.json`);
}

// ── Skill CRUD ─────────────────────────────────────────────────────

export function createSkill(skill: Omit<Skill, "id" | "createdAt" | "updatedAt" | "usageCount">): Skill {
  ensureSkillsDir();
  
  const id = generateSkillId(skill.name);
  const now = new Date().toISOString();
  
  const newSkill: Skill = {
    ...skill,
    id,
    createdAt: now,
    updatedAt: now,
    usageCount: 0,
  };
  
  try {
    writeFileSync(getSkillPath(id), JSON.stringify(newSkill, null, 2));
    
    // Update index
    const index = loadSkillIndex();
    if (!index.includes(id)) {
      index.push(id);
      saveSkillIndex(index);
    }
    
    log.info("Skill created", { id, name: skill.name });
    return newSkill;
  } catch (e) {
    log.error("Failed to create skill", { error: (e as Error).message });
    throw e;
  }
}

export function loadSkill(skillId: string): Skill | null {
  try {
    const path = getSkillPath(skillId);
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8"));
    }
  } catch (e) {
    log.warn("Failed to load skill", { skillId, error: (e as Error).message });
  }
  return null;
}

export function updateSkill(skillId: string, updates: Partial<Omit<Skill, "id" | "createdAt">>): Skill | null {
  const skill = loadSkill(skillId);
  if (!skill) return null;
  
  const updated: Skill = {
    ...skill,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  try {
    writeFileSync(getSkillPath(skillId), JSON.stringify(updated, null, 2));
    log.info("Skill updated", { skillId });
    return updated;
  } catch (e) {
    log.error("Failed to update skill", { skillId, error: (e as Error).message });
    return null;
  }
}

export function deleteSkill(skillId: string): boolean {
  try {
    const path = getSkillPath(skillId);
    if (existsSync(path)) {
      // Remove file
      const content = readFileSync(path, "utf-8");
      writeFileSync(path + ".deleted", content); // Archive instead of delete
      
      // Update index
      const index = loadSkillIndex();
      const newIndex = index.filter(id => id !== skillId);
      saveSkillIndex(newIndex);
      
      log.info("Skill deleted", { skillId });
      return true;
    }
  } catch (e) {
    log.error("Failed to delete skill", { skillId, error: (e as Error).message });
  }
  return false;
}

export function listAllSkills(): Skill[] {
  const index = loadSkillIndex();
  const skills: Skill[] = [];
  
  for (const id of index) {
    const skill = loadSkill(id);
    if (skill) skills.push(skill);
  }
  
  return skills.sort((a, b) => b.usageCount - a.usageCount);
}

export function searchSkills(filters: SkillSearchFilters): Skill[] {
  let skills = listAllSkills();
  
  if (filters.tags && filters.tags.length > 0) {
    skills = skills.filter(s => 
      filters.tags!.some(tag => s.tags.includes(tag))
    );
  }
  
  if (filters.minUsageCount !== undefined) {
    skills = skills.filter(s => s.usageCount >= filters.minUsageCount!);
  }
  
  if (filters.nameContains) {
    const search = filters.nameContains.toLowerCase();
    skills = skills.filter(s => 
      s.name.toLowerCase().includes(search) ||
      s.description.toLowerCase().includes(search)
    );
  }
  
  return skills;
}

export function findSkillByName(name: string): Skill | null {
  const skills = listAllSkills();
  const normalizedName = name.toLowerCase().replace(/\s+/g, "-");
  
  return skills.find(s => 
    s.id === normalizedName ||
    s.name.toLowerCase() === name.toLowerCase()
  ) || null;
}

// ── Skill Execution ────────────────────────────────────────────────

export function validateSkillParams(
  skill: Skill, 
  params: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  for (const param of skill.parameters) {
    const value = params[param.name];
    
    if (param.required && (value === undefined || value === null)) {
      errors.push(`Missing required parameter: ${param.name}`);
      continue;
    }
    
    if (value !== undefined && value !== null) {
      // Type validation
      const actualType = Array.isArray(value) ? "array" : typeof value;
      if (actualType !== param.type && !(param.type === "number" && actualType === "number")) {
        errors.push(`Parameter ${param.name} should be ${param.type}, got ${actualType}`);
      }
      
      // Pattern validation
      if (param.validation?.pattern && typeof value === "string") {
        const regex = new RegExp(param.validation.pattern);
        if (!regex.test(value)) {
          errors.push(`Parameter ${param.name} does not match required pattern`);
        }
      }
      
      // Range validation for numbers
      if (param.type === "number" && typeof value === "number") {
        if (param.validation?.min !== undefined && value < param.validation.min) {
          errors.push(`Parameter ${param.name} must be >= ${param.validation.min}`);
        }
        if (param.validation?.max !== undefined && value > param.validation.max) {
          errors.push(`Parameter ${param.name} must be <= ${param.validation.max}`);
        }
      }
      
      // Options validation
      if (param.validation?.options && !param.validation.options.includes(value)) {
        errors.push(`Parameter ${param.name} must be one of: ${param.validation.options.join(", ")}`);
      }
    }
  }
  
  return { valid: errors.length === 0, errors };
}

export function interpolateParams(
  template: Record<string, unknown>,
  params: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(template)) {
    if (typeof value === "string") {
      // Replace ${paramName} with actual value
      result[key] = value.replace(/\$\{(\w+)\}/g, (match, paramName) => {
        const paramValue = params[paramName];
        return paramValue !== undefined ? String(paramValue) : match;
      });
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

export function recordSkillUsage(skillId: string): void {
  const skill = loadSkill(skillId);
  if (skill) {
    updateSkill(skillId, {
      usageCount: skill.usageCount + 1,
      lastUsedAt: new Date().toISOString(),
    });
  }
}

// ── Skill Templates ────────────────────────────────────────────────

export const SKILL_TEMPLATES = {
  "code-review": {
    name: "Code Review Workflow",
    description: "Run comprehensive code review including quality checks and diagnostics",
    tags: ["code", "review", "quality"],
    parameters: [
      {
        name: "target",
        type: "string" as const,
        description: "Target to review (file, directory, or 'all')",
        required: true,
        defaultValue: "all",
      },
    ],
    steps: [
      { toolName: "check_code_quality", params: {}, description: "Run code quality checks" },
      { toolName: "run_self_diagnosis", params: {}, description: "Check system health" },
    ],
  },
  
  "pre-commit": {
    name: "Pre-Commit Checks",
    description: "Run all checks before committing code",
    tags: ["git", "pre-commit", "quality"],
    parameters: [],
    steps: [
      { toolName: "check_code_quality", params: {} },
      { toolName: "run_self_diagnosis", params: {} },
    ],
  },
  
  "system-health-check": {
    name: "System Health Check",
    description: "Comprehensive system health analysis",
    tags: ["health", "diagnostics", "monitoring"],
    parameters: [
      {
        name: "detailed",
        type: "boolean" as const,
        description: "Include detailed metrics",
        required: false,
        defaultValue: false,
      },
    ],
    steps: [
      { toolName: "run_self_diagnosis", params: {} },
      { toolName: "get_performance_report", params: {} },
      { toolName: "get_strategy_status", params: {} },
    ],
  },
};

export function createSkillFromTemplate(
  templateKey: keyof typeof SKILL_TEMPLATES,
  customizations?: Partial<Omit<Skill, "id" | "createdAt" | "updatedAt" | "usageCount">>
): Skill {
  const template = SKILL_TEMPLATES[templateKey];
  if (!template) {
    throw new Error(`Unknown skill template: ${templateKey}`);
  }
  
  return createSkill({
    ...template,
    ...customizations,
    version: "1.0.0",
  });
}

// ── Report Generation ─────────────────────────────────────────────

export function formatSkillList(skills: Skill[]): string {
  if (skills.length === 0) {
    return "📚 No skills in library yet.";
  }
  
  const lines: string[] = [
    `📚 Skill Library (${skills.length} skills)`,
    "",
  ];
  
  for (const skill of skills) {
    const tags = skill.tags.length > 0 ? ` [${skill.tags.join(", ")}]` : "";
    const usage = skill.usageCount > 0 ? ` (used ${skill.usageCount}x)` : "";
    lines.push(`• ${skill.name}${tags}${usage}`);
    lines.push(`  ${skill.description}`);
    lines.push(`  ID: ${skill.id}`);
    lines.push("");
  }
  
  return lines.join("\n");
}

export function formatSkillDetail(skill: Skill): string {
  const lines: string[] = [
    `🔧 Skill: ${skill.name}`,
    `ID: ${skill.id}`,
    `Version: ${skill.version}`,
    `Description: ${skill.description}`,
    `Tags: ${skill.tags.join(", ") || "none"}`,
    `Usage: ${skill.usageCount} times`,
    `Created: ${new Date(skill.createdAt).toLocaleDateString()}`,
  ];
  
  if (skill.lastUsedAt) {
    lines.push(`Last used: ${new Date(skill.lastUsedAt).toLocaleDateString()}`);
  }
  
  lines.push("");
  lines.push("Parameters:");
  if (skill.parameters.length === 0) {
    lines.push("  (none)");
  } else {
    for (const param of skill.parameters) {
      const req = param.required ? "required" : "optional";
      const def = param.defaultValue !== undefined ? ` (default: ${param.defaultValue})` : "";
      lines.push(`  • ${param.name} (${param.type}, ${req})${def}`);
      lines.push(`    ${param.description}`);
    }
  }
  
  lines.push("");
  lines.push("Steps:");
  skill.steps.forEach((step, i) => {
    lines.push(`  ${i + 1}. ${step.toolName}`);
    if (step.description) {
      lines.push(`     ${step.description}`);
    }
  });
  
  return lines.join("\n");
}

// ── Helpers ───────────────────────────────────────────────────────

function generateSkillId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  
  // Check for uniqueness
  const index = loadSkillIndex();
  let id = base;
  let counter = 1;
  
  while (index.includes(id)) {
    id = `${base}-${counter}`;
    counter++;
  }
  
  return id;
}
