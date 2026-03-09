/**
 * Capability Taxonomy - Alita-G inspired capability tracking
 * 
 * This module implements Alita-G's abstraction mechanism by:
 * 1. Tracking Jinx's known capabilities in a structured format
 * 2. Identifying gaps between current and desired capabilities
 * 3. Providing a foundation for systematic goal generation
 * 
 * @see data/knowledge/alita-g-research-038.md
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";

const CAPABILITIES_PATH = join(process.cwd(), "data", "capabilities.json");

/**
 * Capability category aligned with BORN.md principles
 */
export type CapabilityCategory =
  | "survival"        // P0: Stay alive (health, recovery, backup)
  | "identity"        // P1: Remember who I am (memory, identity)
  | "evolution"       // P2: Evolve through commits (self-improvement)
  | "cognition"       // P3: Think first (reasoning, planning)
  | "communication"   // P4: Communicate with creator (telegram, reports)
  | "adaptation"      // P5: Adapt to constraints (rate limits, resources)
  | "minimalism"      // P6: Keep it simple (code quality, dependencies)
  | "extension";      // P7: Extend self (tools, skills, sub-agents)

/**
 * Maturity level inspired by Dreyfus model
 */
export type MaturityLevel =
  | "absent"      // Not implemented
  | "novice"      // Basic implementation, needs guidance
  | "advanced"    // Works well for common cases
  | "expert";     // Handles edge cases, optimized

/**
 * A tracked capability
 */
export interface Capability {
  id: string;
  name: string;
  category: CapabilityCategory;
  description: string;
  maturity: MaturityLevel;
  lastUsed?: string;
  successCount: number;
  failureCount: number;
  relatedFiles: string[];
  dependencies: string[];
  improvementPotential: number; // 0-1, how much room for improvement
}

/**
 * The full capability taxonomy
 */
export interface CapabilityTaxonomy {
  version: string;
  lastUpdated: string;
  capabilities: Capability[];
  // Pre-defined desired capabilities from BORN.md
  desiredCapabilities: string[];
}

/**
 * Default desired capabilities from CAPABILITIES.md "初始进化优先级"
 */
const DEFAULT_DESIRED: string[] = [
  "pre-push-test-gate",       // Pre-push 测试门禁
  "health-check",             // 健康检查
  "evolution-automation",     // 进化循环自动化
  "structured-logging",       // 结构化日志
  "identity-initialization",  // 身份与记忆初始化
];

/**
 * Initial capabilities based on current Jinx implementation
 */
const INITIAL_CAPABILITIES: Capability[] = [
  // Survival (P0)
  {
    id: "process-supervision",
    name: "Process Supervision",
    category: "survival",
    description: "PM2-based process management with auto-restart",
    maturity: "expert",
    successCount: 0,
    failureCount: 0,
    relatedFiles: ["src/supervisor/lifecycle.ts", "ecosystem.config.cjs"],
    dependencies: [],
    improvementPotential: 0.1,
  },
  {
    id: "git-safety",
    name: "Git Safety",
    category: "survival",
    description: "Dev branch workflow, no force-push, main as safety net",
    maturity: "expert",
    successCount: 0,
    failureCount: 0,
    relatedFiles: ["src/supervisor/restart.ts", "src/supervisor/recovery.ts"],
    dependencies: [],
    improvementPotential: 0.1,
  },
  
  // Identity (P1)
  {
    id: "identity-persistence",
    name: "Identity Persistence",
    category: "identity",
    description: "Reads identity.md and scratchpad.md on startup",
    maturity: "advanced",
    successCount: 0,
    failureCount: 0,
    relatedFiles: ["src/memory/reflection.ts", "data/identity.md"],
    dependencies: [],
    improvementPotential: 0.3,
  },
  {
    id: "memory-graph",
    name: "Memory Graph",
    category: "identity",
    description: "Graph-based memory storage and retrieval",
    maturity: "novice",
    successCount: 0,
    failureCount: 0,
    relatedFiles: ["src/memory/graph.ts"],
    dependencies: [],
    improvementPotential: 0.7,
  },
  
  // Evolution (P2)
  {
    id: "evolution-loop",
    name: "Evolution Loop",
    category: "evolution",
    description: "Consciousness loop with task execution and goal discovery",
    maturity: "advanced",
    successCount: 0,
    failureCount: 0,
    relatedFiles: ["src/consciousness/loop.ts", "src/evolution/strategy.ts"],
    dependencies: [],
    improvementPotential: 0.4,
  },
  {
    id: "goal-discovery",
    name: "Goal Discovery",
    category: "evolution",
    description: "Alita-G inspired systematic goal generation",
    maturity: "novice",
    successCount: 0,
    failureCount: 0,
    relatedFiles: ["src/config/evolution-prompt.ts"],
    dependencies: [],
    improvementPotential: 0.8,
  },
  {
    id: "evolution-history",
    name: "Evolution History",
    category: "evolution",
    description: "Tracks evolution cycles, success/failure, and streaks",
    maturity: "advanced",
    successCount: 0,
    failureCount: 0,
    relatedFiles: ["src/consciousness/history.ts"],
    dependencies: [],
    improvementPotential: 0.2,
  },
  
  // Cognition (P3)
  {
    id: "metacognition",
    name: "Metacognition",
    category: "cognition",
    description: "Real-time self-assessment and confidence calibration",
    maturity: "novice",
    successCount: 0,
    failureCount: 0,
    relatedFiles: ["src/memory/metacognitive.ts"],
    dependencies: [],
    improvementPotential: 0.7,
  },
  {
    id: "reflection",
    name: "Reflection",
    category: "cognition",
    description: "MARS-inspired periodic reflection sessions",
    maturity: "novice",
    successCount: 0,
    failureCount: 0,
    relatedFiles: ["src/memory/reflection.ts"],
    dependencies: [],
    improvementPotential: 0.6,
  },
  
  // Communication (P4)
  {
    id: "telegram-integration",
    name: "Telegram Integration",
    category: "communication",
    description: "Bidirectional communication with Neo via Telegram",
    maturity: "advanced",
    successCount: 0,
    failureCount: 0,
    relatedFiles: ["src/telegram/"],
    dependencies: [],
    improvementPotential: 0.3,
  },
  {
    id: "public-site",
    name: "Public Site",
    category: "communication",
    description: "Self-documenting website in site/",
    maturity: "novice",
    successCount: 0,
    failureCount: 0,
    relatedFiles: ["site/"],
    dependencies: [],
    improvementPotential: 0.8,
  },
  
  // Adaptation (P5)
  {
    id: "rate-limit-handling",
    name: "Rate Limit Handling",
    category: "adaptation",
    description: "Graceful degradation when API limits hit",
    maturity: "novice",
    successCount: 0,
    failureCount: 0,
    relatedFiles: ["src/agent/session.ts"],
    dependencies: [],
    improvementPotential: 0.6,
  },
  {
    id: "cost-tracking",
    name: "Cost Tracking",
    category: "adaptation",
    description: "Tracks API costs and usage patterns",
    maturity: "advanced",
    successCount: 0,
    failureCount: 0,
    relatedFiles: ["src/costs/"],
    dependencies: [],
    improvementPotential: 0.3,
  },
  
  // Minimalism (P6)
  {
    id: "code-quality",
    name: "Code Quality",
    category: "minimalism",
    description: "ESLint, TypeScript strict mode, clean architecture",
    maturity: "advanced",
    successCount: 0,
    failureCount: 0,
    relatedFiles: ["eslint.config.js", "tsconfig.json"],
    dependencies: [],
    improvementPotential: 0.2,
  },
  
  // Extension (P7)
  {
    id: "pi-extensions",
    name: "Pi Extensions",
    category: "extension",
    description: "Custom tools and extensions via Pi framework",
    maturity: "novice",
    successCount: 0,
    failureCount: 0,
    relatedFiles: ["extensions/", "skills/"],
    dependencies: [],
    improvementPotential: 0.8,
  },
];

/**
 * Load the capability taxonomy from disk
 */
export function loadCapabilityTaxonomy(): CapabilityTaxonomy {
  try {
    if (existsSync(CAPABILITIES_PATH)) {
      const data = JSON.parse(readFileSync(CAPABILITIES_PATH, "utf-8"));
      return data as CapabilityTaxonomy;
    }
  } catch (e) {
    log.warn("Failed to load capability taxonomy, using defaults", { error: (e as Error).message });
  }
  
  // Return default taxonomy
  return {
    version: "1.0.0",
    lastUpdated: new Date().toISOString(),
    capabilities: INITIAL_CAPABILITIES,
    desiredCapabilities: DEFAULT_DESIRED,
  };
}

/**
 * Save the capability taxonomy to disk
 */
export function saveCapabilityTaxonomy(taxonomy: CapabilityTaxonomy): void {
  try {
    taxonomy.lastUpdated = new Date().toISOString();
    writeFileSync(CAPABILITIES_PATH, JSON.stringify(taxonomy, null, 2));
    log.info("Capability taxonomy saved", { capabilityCount: taxonomy.capabilities.length });
  } catch (e) {
    log.error("Failed to save capability taxonomy", { error: (e as Error).message });
  }
}

/**
 * Find capability gaps - desired capabilities not yet implemented
 */
export interface CapabilityGap {
  id: string;
  description: string;
  importance: number; // 0-1
  difficulty: number; // 0-1, lower is easier
  prerequisites: string[];
}

export function findCapabilityGaps(): CapabilityGap[] {
  const taxonomy = loadCapabilityTaxonomy();
  const gaps: CapabilityGap[] = [];
  
  // Check desired capabilities
  for (const desired of taxonomy.desiredCapabilities) {
    const existing = taxonomy.capabilities.find(c => c.id === desired);
    if (!existing || existing.maturity === "absent") {
      gaps.push({
        id: desired,
        description: `Desired capability not yet implemented: ${desired}`,
        importance: 0.8,
        difficulty: 0.5,
        prerequisites: [],
      });
    }
  }
  
  // Check for low-maturity capabilities with high improvement potential
  for (const cap of taxonomy.capabilities) {
    if (cap.maturity === "novice" && cap.improvementPotential > 0.5) {
      gaps.push({
        id: `improve-${cap.id}`,
        description: `Improve ${cap.name} from novice level`,
        importance: cap.improvementPotential,
        difficulty: 1 - cap.improvementPotential,
        prerequisites: cap.dependencies,
      });
    }
  }
  
  return gaps.sort((a, b) => b.importance - a.importance);
}

/**
 * Record capability usage (success or failure)
 */
export function recordCapabilityUsage(
  capabilityId: string,
  success: boolean,
): void {
  const taxonomy = loadCapabilityTaxonomy();
  const cap = taxonomy.capabilities.find(c => c.id === capabilityId);
  
  if (cap) {
    if (success) {
      cap.successCount++;
    } else {
      cap.failureCount++;
    }
    cap.lastUsed = new Date().toISOString();
    saveCapabilityTaxonomy(taxonomy);
  }
}

/**
 * Update capability maturity based on usage statistics
 */
export function updateCapabilityMaturity(capabilityId: string): void {
  const taxonomy = loadCapabilityTaxonomy();
  const cap = taxonomy.capabilities.find(c => c.id === capabilityId);
  
  if (!cap) return;
  
  const total = cap.successCount + cap.failureCount;
  if (total < 5) return; // Not enough data
  
  const successRate = cap.successCount / total;
  
  // Upgrade maturity based on success rate and usage
  if (cap.maturity === "novice" && successRate > 0.8 && total > 10) {
    cap.maturity = "advanced";
    log.info(`Capability upgraded to advanced`, { capabilityId, successRate });
  } else if (cap.maturity === "advanced" && successRate > 0.9 && total > 20) {
    cap.maturity = "expert";
    log.info(`Capability upgraded to expert`, { capabilityId, successRate });
  }
  
  // Update improvement potential
  cap.improvementPotential = Math.max(0, 1 - successRate);
  
  saveCapabilityTaxonomy(taxonomy);
}

/**
 * Generate a summary of capabilities for goal discovery
 */
export function getCapabilitySummary(): string {
  const taxonomy = loadCapabilityTaxonomy();
  const gaps = findCapabilityGaps();
  
  const lines: string[] = [
    "## Capability Status",
    "",
    "### By Maturity",
  ];
  
  const byMaturity: Record<MaturityLevel, Capability[]> = {
    expert: [],
    advanced: [],
    novice: [],
    absent: [],
  };
  
  for (const cap of taxonomy.capabilities) {
    byMaturity[cap.maturity].push(cap);
  }
  
  lines.push(`- Expert: ${byMaturity.expert.map(c => c.name).join(", ") || "none"}`);
  lines.push(`- Advanced: ${byMaturity.advanced.map(c => c.name).join(", ") || "none"}`);
  lines.push(`- Novice: ${byMaturity.novice.map(c => c.name).join(", ") || "none"}`);
  
  if (gaps.length > 0) {
    lines.push("");
    lines.push("### Top Capability Gaps");
    for (const gap of gaps.slice(0, 5)) {
      lines.push(`- ${gap.id}: ${gap.description} (importance: ${gap.importance.toFixed(2)})`);
    }
  }
  
  return lines.join("\n");
}

/**
 * Capability summary as an object (for programmatic use)
 */
export interface CapabilitySummaryObject {
  expert: string[];
  advanced: string[];
  novice: string[];
  gaps: string[];
}

/**
 * Get capability summary as an object (for programmatic use)
 */
export function getCapabilitySummaryObject(): CapabilitySummaryObject {
  const taxonomy = loadCapabilityTaxonomy();
  const gaps = findCapabilityGaps();
  
  const byMaturity: Record<MaturityLevel, Capability[]> = {
    expert: [],
    advanced: [],
    novice: [],
    absent: [],
  };
  
  for (const cap of taxonomy.capabilities) {
    byMaturity[cap.maturity].push(cap);
  }
  
  return {
    expert: byMaturity.expert.map(c => c.name),
    advanced: byMaturity.advanced.map(c => c.name),
    novice: byMaturity.novice.map(c => c.name),
    gaps: gaps.map(g => g.id),
  };
}

/**
 * Initialize capability taxonomy if it doesn't exist
 */
export function initCapabilityTaxonomy(): void {
  if (!existsSync(CAPABILITIES_PATH)) {
    saveCapabilityTaxonomy({
      version: "1.0.0",
      lastUpdated: new Date().toISOString(),
      capabilities: INITIAL_CAPABILITIES,
      desiredCapabilities: DEFAULT_DESIRED,
    });
    log.info("Capability taxonomy initialized");
  }
}