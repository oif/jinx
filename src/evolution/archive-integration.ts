/**
 * Archive Integration
 *
 * Integrates Agent Archive into the evolution loop.
 * This module provides:
 * 1. Archive initialization from current state
 * 2. Branch selection before evolution
 * 3. Evolution result recording
 * 4. Automatic branch spawning for diversity
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";
import { execSync } from "node:child_process";
import {
  loadArchive,
  saveArchive,
  getCurrentBranch,
  setCurrentBranch,
  selectBranch,
  spawnBranch,
  recordEvolution,
  getArchiveStats,
  getArchiveRecommendations,
  formatArchiveReport,
  calculateArchiveDiversity,
  type AgentArchive,
  type ArchiveEntry,
  type BranchState,
  type SelectionStrategy,
} from "./agent-archive.js";
import { getCurrentStrategy } from "./strategy.js";

// ── Types ──────────────────────────────────────────────────────────

export interface ArchiveContext {
  archive: AgentArchive;
  currentBranch: ArchiveEntry | null;
  selectedBranch: ArchiveEntry | null;
  shouldSpawnBranch: boolean;
  recommendations: string[];
}

// ── State Capture ─────────────────────────────────────────────────

/**
 * Capture current agent state for a branch snapshot.
 */
export function captureCurrentState(): BranchState {
  // Get current git commit
  let gitCommit = "unknown";
  try {
    gitCommit = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim().slice(0, 7);
  } catch {
    // Not in git repo or git not available
  }
  
  // Get current version from state
  let version = "0.0.0";
  try {
    const statePath = "./data/state.json";
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    version = state.version || "0.0.0";
  } catch {
    // State file not available
  }
  
  // Get current strategy
  const strategy = getCurrentStrategy();
  
  // Capabilities would come from a capability registry
  // For now, use a simple detection
  const capabilities = detectCapabilities();
  
  return {
    gitCommit,
    version,
    capabilities,
    strategy,
    activeTaskId: null,
    metrics: {
      testCoverage: null,
      codeQuality: null,
      healthScore: null,
    },
  };
}

/**
 * Detect current capabilities based on file system.
 */
function detectCapabilities(): string[] {
  const capabilities: string[] = [];
  const cwd = process.cwd();
  
  try {
    // Check for telegram integration
    if (existsSync(join(cwd, "src/telegram"))) {
      capabilities.push("telegram");
    }
    
    // Check for health monitoring
    if (existsSync(join(cwd, "src/health"))) {
      capabilities.push("health-monitoring");
    }
    
    // Check for evolution
    if (existsSync(join(cwd, "src/evolution"))) {
      capabilities.push("self-evolution");
    }
    
    // Check for memory
    if (existsSync(join(cwd, "src/memory"))) {
      capabilities.push("memory");
    }
    
    // Check for agent archive (this module!)
    if (existsSync(join(cwd, "src/evolution/agent-archive.ts"))) {
      capabilities.push("agent-archive");
    }
    
    // Check for skills
    if (existsSync(join(cwd, "skills"))) {
      capabilities.push("skills");
    }
    
    // Check for extensions
    if (existsSync(join(cwd, "extensions"))) {
      capabilities.push("extensions");
    }
    
  } catch (e) {
    log.warn("Failed to detect capabilities", { error: (e as Error).message });
  }
  
  return capabilities;
}

// ── Archive Lifecycle ─────────────────────────────────────────────

/**
 * Initialize or load the archive.
 * Called at startup.
 */
export function initializeArchive(): AgentArchive {
  const archive = loadArchive();
  
  if (archive.branches.length === 0) {
    log.info("Initializing new Agent Archive");
    
    // Create initial branch from current state
    const state = captureCurrentState();
    const initialBranch: ArchiveEntry = {
      id: "branch-root",
      parentId: null,
      name: "Root Branch",
      state,
      evolutionHistory: [],
      fitness: 0.5,
      diversityScore: 1.0,
      explorationTags: ["initialization"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true,
      cyclesSpent: 0,
      status: "exploring",
      notes: "Initial branch created at system startup",
    };
    
    archive.branches.push(initialBranch);
    archive.currentBranchId = initialBranch.id;
    
    saveArchive(archive);
    log.info("Created initial branch", { id: initialBranch.id });
  }
  
  return archive;
}

/**
 * Prepare archive context before an evolution cycle.
 * This selects the branch to work on and determines if we need diversity.
 */
export function prepareArchiveContext(
  archive: AgentArchive,
  taskTitle: string
): ArchiveContext {
  const currentBranch = getCurrentBranch(archive);
  const recommendations = getArchiveRecommendations(archive);
  const diversity = calculateArchiveDiversity(archive);
  
  // Determine selection strategy based on current state
  let selectionStrategy: SelectionStrategy = "balanced";
  
  if (diversity.averageDiversity < 0.2) {
    // Low diversity: prefer diverse branches
    selectionStrategy = "diverse";
  } else if (currentBranch && currentBranch.fitness > 0.8) {
    // High fitness: stick with what works
    selectionStrategy = "best";
  }
  
  // Select branch to work on
  const selectedBranch = selectBranch(archive, selectionStrategy);
  
  // Determine if we should spawn a new branch
  const shouldSpawn = shouldSpawnNewBranch(archive, diversity, taskTitle);
  
  // Update current branch if different
  if (selectedBranch && selectedBranch.id !== archive.currentBranchId) {
    setCurrentBranch(archive, selectedBranch.id);
    saveArchive(archive);
    log.info("Switched to selected branch", {
      from: currentBranch?.name,
      to: selectedBranch.name,
      reason: `Strategy: ${selectionStrategy}`,
    });
  }
  
  return {
    archive,
    currentBranch: getCurrentBranch(archive),
    selectedBranch,
    shouldSpawnBranch: shouldSpawn,
    recommendations,
  };
}

/**
 * Determine if a new branch should be spawned.
 */
function shouldSpawnNewBranch(
  archive: AgentArchive,
  diversity: ReturnType<typeof calculateArchiveDiversity>,
  taskTitle: string
): boolean {
  const stats = getArchiveStats(archive);
  
  // Don't spawn if at max capacity
  if (stats.activeBranches >= archive.config.maxActiveBranches) {
    return false;
  }
  
  // Spawn if very low diversity
  if (diversity.averageDiversity < 0.15) {
    return true;
  }
  
  // Spawn if all branches are stagnant
  const allStagnant = archive.branches
    .filter(b => b.isActive)
    .every(b => b.status === "stagnant");
  if (allStagnant && stats.activeBranches > 0) {
    return true;
  }
  
  // Spawn for tasks that indicate new exploration direction
  const explorationKeywords = [
    "new feature", "explore", "experiment", "research", "investigate",
    "技术探索", "创新", "尝试", "研究",
  ];
  const titleLower = taskTitle.toLowerCase();
  if (explorationKeywords.some(k => titleLower.includes(k))) {
    return true;
  }
  
  return false;
}

/**
 * Generate exploration tags from task title.
 */
function generateExplorationTags(taskTitle: string): string[] {
  const tags: string[] = [];
  const titleLower = taskTitle.toLowerCase();
  
  // Tag patterns
  const patterns: Record<string, string[]> = {
    "bugfix": ["bug", "fix", "repair", "修复"],
    "feature": ["feature", "add", "new", "新增", "新功能"],
    "refactor": ["refactor", "restructure", "重构"],
    "performance": ["performance", "optimize", "性能", "优化"],
    "testing": ["test", "coverage", "测试"],
    "research": ["research", "investigate", "explore", "研究", "探索"],
    "integration": ["integrate", "connect", "集成"],
    "architecture": ["architecture", "design", "架构", "设计"],
  };
  
  for (const [tag, keywords] of Object.entries(patterns)) {
    if (keywords.some(k => titleLower.includes(k))) {
      tags.push(tag);
    }
  }
  
  // Default tag if no patterns match
  if (tags.length === 0) {
    tags.push("general");
  }
  
  return tags;
}

/**
 * Create a new exploration branch.
 */
export function createExplorationBranch(
  archive: AgentArchive,
  taskTitle: string,
  taskDescription?: string
): ArchiveEntry {
  const state = captureCurrentState();
  const tags = generateExplorationTags(taskTitle);
  
  // Generate branch name from task
  const name = taskTitle.slice(0, 50).replace(/[^a-zA-Z0-9\u4e00-\u9fff\s-]/g, "");
  
  const branch = spawnBranch(
    archive,
    name,
    state,
    tags,
    taskDescription || `Branch for: ${taskTitle}`
  );
  
  setCurrentBranch(archive, branch.id);
  saveArchive(archive);
  
  log.info("Created exploration branch", {
    id: branch.id,
    name: branch.name,
    tags: branch.explorationTags,
  });
  
  return branch;
}

/**
 * Record evolution result to archive.
 */
export function recordEvolutionToArchive(
  archive: AgentArchive,
  cycle: number,
  taskId: string,
  status: "success" | "failed",
  learnings: string[] = [],
  fitnessDelta: number = 0
): void {
  recordEvolution(archive, cycle, taskId, status, learnings, fitnessDelta);
  saveArchive(archive);
}

// ── Archive Insights ──────────────────────────────────────────────

/**
 * Get insights about which directions are working.
 */
export function getArchiveInsights(archive: AgentArchive): string {
  const stats = getArchiveStats(archive);
  const recommendations = getArchiveRecommendations(archive);
  
  const lines: string[] = [
    "📊 Archive Insights",
    "",
    `Active Branches: ${stats.activeBranches} | Total: ${stats.totalBranches}`,
    `Fitness Range: ${stats.worstFitness.toFixed(2)} - ${stats.bestFitness.toFixed(2)}`,
    "",
  ];
  
  // Find best performing tags
  const tagPerformance: Record<string, { total: number; fitness: number }> = {};
  for (const branch of archive.branches.filter(b => b.isActive)) {
    for (const tag of branch.explorationTags) {
      if (!tagPerformance[tag]) {
        tagPerformance[tag] = { total: 0, fitness: 0 };
      }
      tagPerformance[tag].total++;
      tagPerformance[tag].fitness += branch.fitness;
    }
  }
  
  const sortedTags = Object.entries(tagPerformance)
    .map(([tag, data]) => ({
      tag,
      avgFitness: data.fitness / data.total,
      count: data.total,
    }))
    .sort((a, b) => b.avgFitness - a.avgFitness);
  
  if (sortedTags.length > 0) {
    lines.push("🏷️ Top Exploration Directions:");
    for (const { tag, avgFitness, count } of sortedTags.slice(0, 5)) {
      lines.push(`  ${tag}: ${(avgFitness * 100).toFixed(0)}% avg fitness (${count} branches)`);
    }
    lines.push("");
  }
  
  if (recommendations.length > 0) {
    lines.push("💡 Recommendations:");
    for (const rec of recommendations) {
      lines.push(`  • ${rec}`);
    }
    lines.push("");
  }
  
  return lines.join("\n");
}

/**
 * Generate context about archive for evolution prompt.
 */
export function generateArchiveContextForPrompt(archive: AgentArchive): string {
  const current = getCurrentBranch(archive);
  const stats = getArchiveStats(archive);
  const diversity = calculateArchiveDiversity(archive);
  
  if (!current) {
    return "";
  }
  
  const lines: string[] = [
    "【Agent Archive Context】",
    `当前分支: ${current.name}`,
    `分支状态: ${current.status} | Fitness: ${(current.fitness * 100).toFixed(0)}%`,
    `探索方向: ${current.explorationTags.join(", ") || "未标记"}`,
    `已投入: ${current.cyclesSpent} 次进化`,
    "",
    `整体状态: ${stats.activeBranches} 个活跃分支 | 平均多样性: ${(diversity.averageDiversity * 100).toFixed(0)}%`,
  ];
  
  // Add recent learnings
  const recentLearnings = current.evolutionHistory
    .slice(-3)
    .flatMap(e => e.learnings);
  
  if (recentLearnings.length > 0) {
    lines.push("");
    lines.push("近期学习:");
    for (const learning of recentLearnings.slice(0, 3)) {
      lines.push(`  • ${learning.slice(0, 100)}`);
    }
  }
  
  return lines.join("\n");
}

// Re-export types and functions for convenience
export { 
  loadArchive, 
  saveArchive, 
  formatArchiveReport,
  type AgentArchive,
  type ArchiveEntry,
};