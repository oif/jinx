/**
 * Agent Archive System
 *
 * Inspired by Sakana AI's Darwin Gödel Machine (ICLR 2026).
 * 
 * The key innovation of DGM is the Agent Archive: maintaining diversity
 * in evolutionary branches, allowing parallel exploration of multiple paths,
 * and preventing convergence to local optima.
 *
 * Core concepts:
 * 1. Archive Entry: A snapshot of agent state at a branching point
 * 2. Diversity Metrics: Measure how different branches are from each other
 * 3. Selection Strategy: Balance exploitation (best performers) and exploration (diverse paths)
 * 4. Branch Lineage: Track evolutionary relationships between branches
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";
import { DATA_DIR } from "../supervisor/paths.js";

// ── Types ──────────────────────────────────────────────────────────

export interface ArchiveEntry {
  /** Unique branch identifier */
  id: string;
  /** Parent branch ID (null for root branches) */
  parentId: string | null;
  /** Branch name/description */
  name: string;
  /** Current state snapshot */
  state: BranchState;
  /** Evolution history for this branch */
  evolutionHistory: BranchEvolution[];
  /** Fitness score (higher = better) */
  fitness: number;
  /** Diversity contribution score */
  diversityScore: number;
  /** Exploration direction tags */
  explorationTags: string[];
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Whether this branch is active */
  isActive: boolean;
  /** Number of evolution cycles spent on this branch */
  cyclesSpent: number;
  /** Branch status */
  status: "exploring" | "converged" | "stagnant" | "abandoned";
  /** Notes about this branch's direction */
  notes: string;
}

export interface BranchState {
  /** Git commit hash at branch creation */
  gitCommit: string;
  /** Current version string */
  version: string;
  /** Key capabilities snapshot */
  capabilities: string[];
  /** Current evolution strategy */
  strategy: "innovate" | "harden" | "repair-only" | "balanced";
  /** Active task ID if any */
  activeTaskId: string | null;
  /** Quality metrics snapshot */
  metrics: {
    testCoverage: number | null;
    codeQuality: number | null;
    healthScore: number | null;
  };
}

export interface BranchEvolution {
  /** Evolution cycle number */
  cycle: number;
  /** Task ID */
  taskId: string;
  /** Result status */
  status: "success" | "failed";
  /** Fitness delta */
  fitnessDelta: number;
  /** What was learned */
  learnings: string[];
  /** Timestamp */
  timestamp: string;
}

export interface ArchiveConfig {
  /** Maximum number of active branches */
  maxActiveBranches: number;
  /** Maximum total entries in archive */
  maxArchiveSize: number;
  /** Minimum fitness improvement to continue branch */
  minFitnessImprovement: number;
  /** Cycles without improvement before marking stagnant */
  stagnantThreshold: number;
  /** Diversity weight in selection (0-1) */
  diversityWeight: number;
  /** Fitness weight in selection (0-1) */
  fitnessWeight: number;
}

export interface ArchiveStats {
  totalBranches: number;
  activeBranches: number;
  averageFitness: number;
  averageDiversity: number;
  bestFitness: number;
  worstFitness: number;
  explorationCoverage: number; // How many different directions are being explored
}

export type SelectionStrategy = "best" | "diverse" | "balanced" | "random";

// ── Constants ─────────────────────────────────────────────────────

const ARCHIVE_PATH = join(DATA_DIR, "agent-archive.json");

const DEFAULT_CONFIG: ArchiveConfig = {
  maxActiveBranches: 5,
  maxArchiveSize: 50,
  minFitnessImprovement: 0.05,
  stagnantThreshold: 5,
  diversityWeight: 0.4,
  fitnessWeight: 0.6,
};

// ── Archive Management ────────────────────────────────────────────

export interface AgentArchive {
  branches: ArchiveEntry[];
  currentBranchId: string | null;
  config: ArchiveConfig;
  createdAt: string;
  updatedAt: string;
}

export function loadArchive(): AgentArchive {
  try {
    if (existsSync(ARCHIVE_PATH)) {
      const data = JSON.parse(readFileSync(ARCHIVE_PATH, "utf-8"));
      return {
        ...data,
        config: { ...DEFAULT_CONFIG, ...data.config },
      };
    }
  } catch (e) {
    log.warn("Failed to load agent archive, creating new one", { error: (e as Error).message });
  }
  return {
    branches: [],
    currentBranchId: null,
    config: DEFAULT_CONFIG,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function saveArchive(archive: AgentArchive): void {
  try {
    // Ensure data directory exists
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    
    // Trim old branches if needed
    if (archive.branches.length > archive.config.maxArchiveSize) {
      // Keep active branches and most recent inactive ones
      const active = archive.branches.filter(b => b.isActive);
      const inactive = archive.branches
        .filter(b => !b.isActive)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      archive.branches = [
        ...active,
        ...inactive.slice(0, archive.config.maxArchiveSize - active.length),
      ];
    }
    
    archive.updatedAt = new Date().toISOString();
    writeFileSync(ARCHIVE_PATH, JSON.stringify(archive, null, 2));
  } catch (e) {
    log.error("Failed to save agent archive", { error: (e as Error).message });
  }
}

// ── Branch Operations ──────────────────────────────────────────────

/**
 * Generate a unique branch ID.
 */
function generateBranchId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `branch-${timestamp}-${random}`;
}

/**
 * Create a new branch from the current state.
 */
export function createBranch(
  name: string,
  state: BranchState,
  parentId: string | null = null,
  tags: string[] = [],
  notes: string = ""
): ArchiveEntry {
  const now = new Date().toISOString();
  return {
    id: generateBranchId(),
    parentId,
    name,
    state,
    evolutionHistory: [],
    fitness: 0.5, // Start with neutral fitness
    diversityScore: 0, // Will be calculated
    explorationTags: tags,
    createdAt: now,
    updatedAt: now,
    isActive: true,
    cyclesSpent: 0,
    status: "exploring",
    notes,
  };
}

/**
 * Add a new branch to the archive.
 */
export function addBranch(
  archive: AgentArchive,
  branch: ArchiveEntry
): void {
  // Calculate diversity score before adding
  branch.diversityScore = calculateBranchDiversity(archive, branch);
  
  archive.branches.push(branch);
  
  // If this is the first branch, set it as current
  if (archive.currentBranchId === null) {
    archive.currentBranchId = branch.id;
  }
  
  log.info(`Created new branch: ${branch.name}`, {
    id: branch.id,
    parentId: branch.parentId,
    tags: branch.explorationTags,
  });
}

/**
 * Update an existing branch.
 */
export function updateBranch(
  archive: AgentArchive,
  branchId: string,
  updates: Partial<ArchiveEntry>
): void {
  const branch = archive.branches.find(b => b.id === branchId);
  if (!branch) {
    log.warn(`Branch not found: ${branchId}`);
    return;
  }
  
  Object.assign(branch, updates);
  branch.updatedAt = new Date().toISOString();
  
  // Recalculate diversity if state changed
  if (updates.state || updates.explorationTags) {
    branch.diversityScore = calculateBranchDiversity(archive, branch);
  }
}

/**
 * Get the current active branch.
 */
export function getCurrentBranch(archive: AgentArchive): ArchiveEntry | null {
  if (!archive.currentBranchId) return null;
  return archive.branches.find(b => b.id === archive.currentBranchId) || null;
}

/**
 * Set the current branch.
 */
export function setCurrentBranch(archive: AgentArchive, branchId: string): void {
  const branch = archive.branches.find(b => b.id === branchId);
  if (!branch) {
    log.warn(`Cannot set current branch: ${branchId} not found`);
    return;
  }
  archive.currentBranchId = branchId;
  branch.isActive = true;
  branch.updatedAt = new Date().toISOString();
  log.info(`Switched to branch: ${branch.name}`, { id: branchId });
}

// ── Diversity Metrics ─────────────────────────────────────────────

/**
 * Calculate diversity score for a branch compared to others.
 * Higher score = more unique = more valuable for exploration.
 */
export function calculateBranchDiversity(
  archive: AgentArchive,
  branch: ArchiveEntry
): number {
  if (archive.branches.length === 0) return 1.0;
  
  const otherBranches = archive.branches.filter(b => b.id !== branch.id);
  if (otherBranches.length === 0) return 1.0;
  
  // Calculate similarity with each other branch
  const similarities = otherBranches.map(other => 
    calculateBranchSimilarity(branch, other)
  );
  
  // Diversity is 1 - average similarity
  const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;
  return Math.max(0, 1 - avgSimilarity);
}

/**
 * Calculate similarity between two branches (0-1).
 * Considers: capabilities, strategy, exploration tags, fitness.
 */
function calculateBranchSimilarity(a: ArchiveEntry, b: ArchiveEntry): number {
  let similarity = 0;
  let weightSum = 0;
  
  // Capability overlap (weight: 0.3)
  const capA = new Set(a.state.capabilities);
  const capB = new Set(b.state.capabilities);
  const capUnion = new Set([...capA, ...capB]);
  const capIntersect = new Set([...capA].filter(x => capB.has(x)));
  const capSimilarity = capUnion.size > 0 ? capIntersect.size / capUnion.size : 1;
  similarity += capSimilarity * 0.3;
  weightSum += 0.3;
  
  // Strategy match (weight: 0.2)
  const stratSimilarity = a.state.strategy === b.state.strategy ? 1 : 0;
  similarity += stratSimilarity * 0.2;
  weightSum += 0.2;
  
  // Tag overlap (weight: 0.3)
  const tagA = new Set(a.explorationTags);
  const tagB = new Set(b.explorationTags);
  const tagUnion = new Set([...tagA, ...tagB]);
  const tagIntersect = new Set([...tagA].filter(x => tagB.has(x)));
  const tagSimilarity = tagUnion.size > 0 ? tagIntersect.size / tagUnion.size : 0;
  similarity += tagSimilarity * 0.3;
  weightSum += 0.3;
  
  // Fitness proximity (weight: 0.2)
  const fitnessDiff = Math.abs(a.fitness - b.fitness);
  const fitnessSimilarity = 1 - Math.min(1, fitnessDiff);
  similarity += fitnessSimilarity * 0.2;
  weightSum += 0.2;
  
  return similarity / weightSum;
}

/**
 * Get overall archive diversity metrics.
 */
export function calculateArchiveDiversity(archive: AgentArchive): {
  averageDiversity: number;
  minDiversity: number;
  maxDiversity: number;
  coverageRatio: number;
} {
  const activeBranches = archive.branches.filter(b => b.isActive);
  
  if (activeBranches.length === 0) {
    return { averageDiversity: 0, minDiversity: 0, maxDiversity: 0, coverageRatio: 0 };
  }
  
  const diversities = activeBranches.map(b => b.diversityScore);
  
  // Count unique exploration directions (based on primary tag)
  const primaryTags = new Set(
    activeBranches
      .map(b => b.explorationTags[0])
      .filter(t => t)
  );
  const coverageRatio = primaryTags.size / Math.max(1, activeBranches.length);
  
  return {
    averageDiversity: diversities.reduce((a, b) => a + b, 0) / diversities.length,
    minDiversity: Math.min(...diversities),
    maxDiversity: Math.max(...diversities),
    coverageRatio,
  };
}

// ── Selection Strategies ──────────────────────────────────────────

/**
 * Select which branch to focus on next.
 * Uses multi-armed bandit inspired approach.
 */
export function selectBranch(
  archive: AgentArchive,
  strategy: SelectionStrategy = "balanced"
): ArchiveEntry | null {
  const activeBranches = archive.branches.filter(b => b.isActive);
  
  if (activeBranches.length === 0) return null;
  if (activeBranches.length === 1) return activeBranches[0];
  
  switch (strategy) {
    case "best":
      return selectBestBranch(activeBranches);
    case "diverse":
      return selectDiverseBranch(activeBranches);
    case "random":
      return selectRandomBranch(activeBranches);
    case "balanced":
    default:
      return selectBalancedBranch(archive, activeBranches);
  }
}

function selectBestBranch(branches: ArchiveEntry[]): ArchiveEntry {
  // Sort by fitness, descending
  return branches.reduce((best, b) => b.fitness > best.fitness ? b : best, branches[0]);
}

function selectDiverseBranch(branches: ArchiveEntry[]): ArchiveEntry {
  // Sort by diversity score, descending
  return branches.reduce((best, b) => 
    b.diversityScore > best.diversityScore ? b : best, branches[0]
  );
}

function selectRandomBranch(branches: ArchiveEntry[]): ArchiveEntry {
  return branches[Math.floor(Math.random() * branches.length)];
}

function selectBalancedBranch(
  archive: AgentArchive,
  branches: ArchiveEntry[]
): ArchiveEntry {
  const config = archive.config;
  
  // Calculate selection scores combining fitness and diversity
  const scores = branches.map(b => ({
    branch: b,
    score: b.fitness * config.fitnessWeight + b.diversityScore * config.diversityWeight,
  }));
  
  // Add exploration bonus for under-explored branches
  const avgCycles = branches.reduce((sum, b) => sum + b.cyclesSpent, 0) / branches.length;
  scores.forEach(s => {
    const explorationBonus = Math.max(0, (avgCycles - s.branch.cyclesSpent) / avgCycles) * 0.1;
    s.score += explorationBonus;
  });
  
  // Softmax-like probability distribution
  const maxScore = Math.max(...scores.map(s => s.score));
  const expScores = scores.map(s => ({
    ...s,
    probability: Math.exp((s.score - maxScore) * 2), // temperature = 0.5
  }));
  const totalProb = expScores.reduce((sum, s) => sum + s.probability, 0);
  
  // Select with probability
  let random = Math.random() * totalProb;
  for (const s of expScores) {
    random -= s.probability;
    if (random <= 0) return s.branch;
  }
  
  return branches[0];
}

// ── Evolution Recording ────────────────────────────────────────────

/**
 * Record an evolution result on the current branch.
 */
export function recordEvolution(
  archive: AgentArchive,
  cycle: number,
  taskId: string,
  status: "success" | "failed",
  learnings: string[] = [],
  fitnessDelta: number = 0
): void {
  const current = getCurrentBranch(archive);
  if (!current) return;
  
  current.evolutionHistory.push({
    cycle,
    taskId,
    status,
    fitnessDelta,
    learnings,
    timestamp: new Date().toISOString(),
  });
  
  current.cyclesSpent++;
  
  // Update fitness with exponential moving average
  const alpha = 0.3; // Learning rate
  if (status === "success") {
    current.fitness = current.fitness * (1 - alpha) + (current.fitness + Math.max(0, fitnessDelta)) * alpha;
  } else {
    current.fitness = current.fitness * (1 - alpha) + (current.fitness - 0.1) * alpha;
  }
  
  // Clamp fitness
  current.fitness = Math.max(0, Math.min(1, current.fitness));
  
  // Check for stagnation
  checkBranchStatus(archive, current);
  
  // Update diversity score
  current.diversityScore = calculateBranchDiversity(archive, current);
  
  log.info(`Recorded evolution on branch`, {
    branch: current.name,
    cycle,
    status,
    fitness: current.fitness.toFixed(3),
    cyclesSpent: current.cyclesSpent,
  });
}

/**
 * Check if a branch should be marked as stagnant or converged.
 */
function checkBranchStatus(archive: AgentArchive, branch: ArchiveEntry): void {
  const recentHistory = branch.evolutionHistory.slice(-archive.config.stagnantThreshold);
  
  if (recentHistory.length < archive.config.stagnantThreshold) {
    return; // Not enough data
  }
  
  // Check for stagnation (no fitness improvement)
  const totalDelta = recentHistory.reduce((sum, e) => sum + e.fitnessDelta, 0);
  if (totalDelta < archive.config.minFitnessImprovement) {
    branch.status = "stagnant";
    log.info(`Branch marked as stagnant`, { branch: branch.name, totalDelta });
  }
  
  // Check for convergence (high fitness, low variance)
  if (branch.fitness > 0.9) {
    const fitnesses = recentHistory.map(e => e.fitnessDelta);
    const variance = fitnesses.reduce((sum, f) => sum + f * f, 0) / fitnesses.length;
    if (variance < 0.01) {
      branch.status = "converged";
      log.info(`Branch marked as converged`, { branch: branch.name, fitness: branch.fitness });
    }
  }
}

// ── Branch Management ──────────────────────────────────────────────

/**
 * Prune inactive branches to stay within limits.
 */
export function pruneBranches(archive: AgentArchive): void {
  const activeBranches = archive.branches.filter(b => b.isActive);
  
  if (activeBranches.length <= archive.config.maxActiveBranches) {
    return;
  }
  
  // Sort by fitness (ascending) and cycles spent (ascending) for pruning
  const toPrune = activeBranches
    .filter(b => b.status === "stagnant" || b.status === "abandoned")
    .sort((a, b) => {
      // First, prefer keeping branches with higher fitness
      if (Math.abs(a.fitness - b.fitness) > 0.1) {
        return a.fitness - b.fitness;
      }
      // Then, prefer keeping branches with more investment
      return a.cyclesSpent - b.cyclesSpent;
    });
  
  const pruneCount = activeBranches.length - archive.config.maxActiveBranches;
  
  for (let i = 0; i < Math.min(pruneCount, toPrune.length); i++) {
    toPrune[i].isActive = false;
    log.info(`Pruned branch`, { name: toPrune[i].name, id: toPrune[i].id });
  }
}

/**
 * Spawn a new branch from the current one.
 * Used when exploring a new direction.
 */
export function spawnBranch(
  archive: AgentArchive,
  name: string,
  state: BranchState,
  tags: string[] = [],
  notes: string = ""
): ArchiveEntry {
  const current = getCurrentBranch(archive);
  const parentId = current?.id || null;
  
  const branch = createBranch(name, state, parentId, tags, notes);
  addBranch(archive, branch);
  
  // Prune if needed
  pruneBranches(archive);
  
  return branch;
}

/**
 * Merge learnings from one branch into another.
 */
export function mergeLearnings(
  archive: AgentArchive,
  sourceId: string,
  targetId: string
): void {
  const source = archive.branches.find(b => b.id === sourceId);
  const target = archive.branches.find(b => b.id === targetId);
  
  if (!source || !target) {
    log.warn("Cannot merge: branch not found", { sourceId, targetId });
    return;
  }
  
  // Transfer successful learnings
  const successfulLearnings = source.evolutionHistory
    .filter(e => e.status === "success")
    .flatMap(e => e.learnings);
  
  target.notes += `\n[Merged from ${source.name}]: ${successfulLearnings.slice(0, 3).join(", ")}`;
  
  log.info(`Merged learnings from ${source.name} to ${target.name}`, {
    learningsCount: successfulLearnings.length,
  });
}

// ── Statistics ─────────────────────────────────────────────────────

export function getArchiveStats(archive: AgentArchive): ArchiveStats {
  const active = archive.branches.filter(b => b.isActive);
  
  if (archive.branches.length === 0) {
    return {
      totalBranches: 0,
      activeBranches: 0,
      averageFitness: 0,
      averageDiversity: 0,
      bestFitness: 0,
      worstFitness: 0,
      explorationCoverage: 0,
    };
  }
  
  const fitnesses = active.map(b => b.fitness);
  const diversities = active.map(b => b.diversityScore);
  const tags = new Set(active.flatMap(b => b.explorationTags));
  
  return {
    totalBranches: archive.branches.length,
    activeBranches: active.length,
    averageFitness: fitnesses.length > 0 
      ? fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length 
      : 0,
    averageDiversity: diversities.length > 0
      ? diversities.reduce((a, b) => a + b, 0) / diversities.length
      : 0,
    bestFitness: fitnesses.length > 0 ? Math.max(...fitnesses) : 0,
    worstFitness: fitnesses.length > 0 ? Math.min(...fitnesses) : 0,
    explorationCoverage: tags.size,
  };
}

/**
 * Format archive status for display.
 */
export function formatArchiveReport(archive: AgentArchive): string {
  const stats = getArchiveStats(archive);
  const diversity = calculateArchiveDiversity(archive);
  const current = getCurrentBranch(archive);
  
  const lines: string[] = [
    "📚 Agent Archive Status",
    "",
    `Total Branches: ${stats.totalBranches} | Active: ${stats.activeBranches}`,
    `Avg Fitness: ${stats.averageFitness.toFixed(3)} | Avg Diversity: ${stats.averageDiversity.toFixed(3)}`,
    `Best Fitness: ${stats.bestFitness.toFixed(3)} | Exploration Coverage: ${stats.explorationCoverage} directions`,
    "",
    `Current Branch: ${current?.name || "none"}`,
    "",
    "🌳 Active Branches:",
  ];
  
  const active = archive.branches
    .filter(b => b.isActive)
    .sort((a, b) => b.fitness - a.fitness);
  
  for (const branch of active.slice(0, 5)) {
    const currentMarker = branch.id === archive.currentBranchId ? "→ " : "  ";
    const statusEmoji = {
      exploring: "🔍",
      converged: "✅",
      stagnant: "⚠️",
      abandoned: "❌",
    }[branch.status];
    
    lines.push(
      `${currentMarker}${statusEmoji} ${branch.name}`,
      `     Fitness: ${branch.fitness.toFixed(3)} | Diversity: ${branch.diversityScore.toFixed(3)}`,
      `     Cycles: ${branch.cyclesSpent} | Tags: ${branch.explorationTags.slice(0, 3).join(", ") || "none"}`
    );
  }
  
  if (active.length > 5) {
    lines.push(`  ... and ${active.length - 5} more branches`);
  }
  
  lines.push("");
  lines.push(`Diversity Metrics:`);
  lines.push(`  Average: ${(diversity.averageDiversity * 100).toFixed(1)}%`);
  lines.push(`  Range: ${(diversity.minDiversity * 100).toFixed(1)}% - ${(diversity.maxDiversity * 100).toFixed(1)}%`);
  lines.push(`  Coverage: ${(diversity.coverageRatio * 100).toFixed(1)}% unique directions`);
  
  return lines.join("\n");
}

/**
 * Get recommendations for archive management.
 */
export function getArchiveRecommendations(archive: AgentArchive): string[] {
  const recommendations: string[] = [];
  const stats = getArchiveStats(archive);
  const diversity = calculateArchiveDiversity(archive);
  
  if (stats.activeBranches === 0) {
    recommendations.push("No active branches. Create a new branch to start evolution.");
    return recommendations;
  }
  
  if (diversity.averageDiversity < 0.2) {
    recommendations.push("Low diversity detected. Consider spawning branches with different exploration directions.");
  }
  
  if (diversity.coverageRatio < 0.5) {
    recommendations.push("Many branches exploring similar directions. Try different strategies or domains.");
  }
  
  const stagnantCount = archive.branches.filter(b => b.status === "stagnant" && b.isActive).length;
  if (stagnantCount > stats.activeBranches / 2) {
    recommendations.push("Many branches are stagnant. Consider spawning new exploratory branches.");
  }
  
  const bestBranch = archive.branches
    .filter(b => b.isActive)
    .reduce((best, b) => b.fitness > best.fitness ? b : best, archive.branches[0]);
  
  if (bestBranch && bestBranch.fitness > 0.8 && bestBranch.cyclesSpent > 10) {
    recommendations.push(`Best branch "${bestBranch.name}" has high fitness. Consider consolidating learnings.`);
  }
  
  if (stats.activeBranches < 3) {
    recommendations.push("Few active branches. Consider spawning more to explore different paths.");
  }
  
  return recommendations;
}