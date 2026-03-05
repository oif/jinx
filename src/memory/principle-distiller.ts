/**
 * Principle Distiller Module
 * 
 * Implements EvolveR's Experience Distillation mechanism.
 * Based on arXiv 2510.16079 (ICLR 2026).
 * 
 * Core capabilities:
 * - Extract interaction trajectories from evolution history
 * - Cluster similar trajectories
 * - Generate abstract principles from trajectory clusters
 * - Validate principles against evidence
 * 
 * Key insight: Principles are abstract, reusable guidelines that
 * transcend specific experiences, enabling knowledge transfer
 * across different contexts.
 * 
 * Flow:
 * 1. Trajectory Extraction: Collect interaction trajectories from history
 * 2. Trajectory Clustering: Group similar trajectories by features
 * 3. Principle Generation: Extract abstract principles from clusters
 * 4. Principle Validation: Verify principles against evidence
 */

import {
  loadEvolutionHistory,
  queryHistory,
  EvolutionRecord,
  HistoryQuery,
} from "../consciousness/history.js";
import {
  loadReflections,
  ReflectionSession,
  queryExperienceMemories,
} from "./reflection.js";
import {
  storePrinciple,
  retrievePrinciples,
  updatePrinciple,
  recordPrincipleApplication,
  getPrinciple,
  getAllPrinciples,
  getPrincipleStats,
  mergePrinciples,
  prunePrinciples,
  Principle,
  PrincipleCategory,
  PrincipleConditions,
} from "./principle-store.js";
import {
  MemoryNode,
} from "./graph.js";
import { log } from "../util/log.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../supervisor/paths.js";

const DISTILLATION_PATH = join(DATA_DIR, "memory", "distillation.json");

// ── Types ──────────────────────────────────────────────────────────

/**
 * Represents a single step in an interaction trajectory
 */
export interface TrajectoryStep {
  action: string;           // What was done
  context: string;           // Context description
  result: string;            // Outcome description
  timestamp: string;
  metadata?: {
    module?: string;         // Code module involved
    taskType?: string;       // Type of task
    riskLevel?: "low" | "medium" | "high";
    changes?: number;         // Lines changed
    tools?: string[];        // Tools used
  };
}

/**
 * An interaction trajectory from evolution history
 */
export interface InteractionTrajectory {
  id: string;
  type: "success" | "failure" | "mixed";
  source: "evolution" | "reflection" | "memory";
  sourceId: string;          // Evolution cycle ID, reflection ID, or memory ID
  
  // Core trajectory data
  task: string;             // Task description
  taskType: string;         // Category: refactor, fix, feature, test, etc.
  steps: TrajectoryStep[];  // Sequence of actions
  
  // Outcome
  outcome: "success" | "failure" | "partial";
  outcomeReason?: string;
  
  // Context features
  modules: string[];        // Code modules involved
  riskLevel: "low" | "medium" | "high";
  totalChanges: number;     // Total lines changed
  durationMs?: number;
  
  // Extractable patterns
  patterns: ExtractedTrajectoryPattern[];
  
  // Timestamps
  startedAt: string;
  completedAt: string;
}

/**
 * Pattern extracted from a trajectory
 */
export interface ExtractedTrajectoryPattern {
  type: "success_factor" | "failure_cause" | "decision_point" | "key_action";
  description: string;
  importance: number;        // 0-1
  evidence: string;          // Step reference
}

/**
 * A cluster of similar trajectories
 */
export interface TrajectoryCluster {
  id: string;
  name: string;
  description: string;
  
  // Cluster features
  taskTypes: string[];
  modules: string[];
  outcomeType: "success" | "failure" | "mixed";
  
  // Members
  trajectoryIds: string[];
  trajectories: InteractionTrajectory[];
  
  // Cluster statistics
  avgSuccessRate: number;
  commonPatterns: ExtractedTrajectoryPattern[];
  
  // Clustering metadata
  createdAt: string;
  features: ClusterFeatures;
}

/**
 * Features used for clustering trajectories
 */
export interface ClusterFeatures {
  taskTypeSimilarity: number;    // 0-1
  moduleOverlap: number;         // 0-1
  outcomeAlignment: number;       // 0-1
  patternSimilarity: number;     // 0-1
}

/**
 * Result of principle generation
 */
export interface GeneratedPrinciple {
  content: string;
  summary: string;
  category: PrincipleCategory;
  conditions: PrincipleConditions;
  rationale: string;
  examples: string[];
  derivedFrom: string[];       // Trajectory IDs
  confidence: number;
}

/**
 * Result of principle validation
 */
export interface ValidationResult {
  principleId: string;
  isValid: boolean;
  issues: string[];
  recommendations: string[];
  evidence: {
    supportingTrajectories: number;
    contradictingTrajectories: number;
    historicalSuccessRate: number;
  };
}

/**
 * Complete distillation session result
 */
export interface DistillationResult {
  timestamp: string;
  triggerReason: string;
  
  // Input
  trajectoriesExtracted: number;
  clustersCreated: number;
  
  // Output
  principlesGenerated: number;
  principlesValidated: number;
  principlesStored: number;
  
  // Details
  trajectoryIds: string[];
  clusterIds: string[];
  principleIds: string[];
  
  // Stats
  stats: DistillationStats;
}

export interface DistillationStats {
  avgTrajectoriesPerCluster: number;
  avgPrinciplesPerCluster: number;
  avgConfidence: number;
  categoriesGenerated: Record<PrincipleCategory, number>;
}

// ── Configuration ──────────────────────────────────────────────────

const DISTILLATION_CONFIG = {
  // Trajectory extraction
  minHistoryEntries: 3,           // Minimum history entries for distillation
  maxTrajectories: 100,           // Maximum trajectories to extract
  minStepsForTrajectory: 2,      // Minimum steps to form a trajectory
  
  // Clustering
  minClusterSize: 2,             // Minimum trajectories per cluster
  maxClusters: 20,               // Maximum clusters to create
  similarityThreshold: 0.5,      // Minimum similarity for clustering
  
  // Principle generation
  minPatternsForPrinciple: 1,    // Minimum patterns to generate a principle
  maxPrinciplesPerCluster: 3,   // Maximum principles per cluster
  confidenceThreshold: 0.6,     // Minimum confidence to store principle
  
  // Validation
  minSupportingEvidence: 2,      // Minimum supporting trajectories
  validationLookback: 30,        // Days to look back for validation
  
  // Distillation frequency
  minDistillationInterval: 24,   // Hours between distillations
};

// ── Storage Functions ──────────────────────────────────────────────

interface DistillationRecord {
  lastDistillationAt: string;
  lastTrajectoryCount: number;
  lastPrincipleCount: number;
  distillationHistory: DistillationResult[];
}

function loadDistillationRecord(): DistillationRecord {
  try {
    if (existsSync(DISTILLATION_PATH)) {
      return JSON.parse(readFileSync(DISTILLATION_PATH, "utf-8"));
    }
  } catch (e) {
    log.warn("Failed to load distillation record", { error: (e as Error).message });
  }
  return {
    lastDistillationAt: "1970-01-01T00:00:00.000Z",
    lastTrajectoryCount: 0,
    lastPrincipleCount: 0,
    distillationHistory: [],
  };
}

function saveDistillationRecord(record: DistillationRecord): void {
  try {
    const dir = join(DATA_DIR, "memory");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    // Keep only last 20 distillation results
    record.distillationHistory = record.distillationHistory.slice(-20);
    writeFileSync(DISTILLATION_PATH, JSON.stringify(record, null, 2));
  } catch (e) {
    log.error("Failed to save distillation record", { error: (e as Error).message });
  }
}

// ── ID Generation ───────────────────────────────────────────────────

function generateTrajectoryId(): string {
  return `traj_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function generateClusterId(): string {
  return `cluster_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

// ── Phase 1: Trajectory Extraction ─────────────────────────────────

/**
 * Extract interaction trajectories from evolution history
 */
export function extractTrajectories(options: {
  since?: Date;
  limit?: number;
  status?: "success" | "failed" | "all";
} = {}): InteractionTrajectory[] {
  const trajectories: InteractionTrajectory[] = [];
  
  // Extract from evolution history
  const historyQuery: HistoryQuery = {
    limit: options.limit || DISTILLATION_CONFIG.maxTrajectories,
  };
  if (options.since) {
    historyQuery.since = options.since.toISOString();
  }
  if (options.status && options.status !== "all") {
    historyQuery.status = options.status;
  }
  
  const historyRecords = queryHistory(historyQuery);
  
  for (const record of historyRecords) {
    const trajectory = evolutionToTrajectory(record);
    if (trajectory) {
      trajectories.push(trajectory);
    }
  }
  
  // Extract from reflection insights
  const reflections = loadReflections();
  for (const session of reflections) {
    const reflectionTrajectories = extractTrajectoriesFromReflection(session);
    trajectories.push(...reflectionTrajectories);
  }
  
  // Extract from experience memories
  const memories = queryExperienceMemories();
  for (const memory of memories) {
    const trajectory = memoryToTrajectory(memory);
    if (trajectory) {
      trajectories.push(trajectory);
    }
  }
  
  log.info("Trajectories extracted", {
    count: trajectories.length,
    fromHistory: historyRecords.length,
    fromReflections: reflections.length,
    fromMemories: memories.length,
  });
  
  return trajectories;
}

/**
 * Convert an evolution record to a trajectory
 */
function evolutionToTrajectory(record: EvolutionRecord): InteractionTrajectory | null {
  // Skip records without meaningful content
  if (!record.summary && record.status === "skipped") {
    return null;
  }
  
  const id = generateTrajectoryId();
  
  // Parse task type from summary
  const taskType = inferTaskType(record.summary);
  const modules = inferModules(record.summary);
  const riskLevel = inferRiskLevel(record.summary, modules);
  
  // Create a trajectory step from the record
  const steps: TrajectoryStep[] = [
    {
      action: "execute_evolution",
      context: `Evolution cycle #${record.cycle}`,
      result: record.status,
      timestamp: record.timestamp,
      metadata: {
        module: modules[0],
        taskType,
        riskLevel,
      },
    },
  ];
  
  // Extract patterns from summary
  const patterns = extractPatternsFromSummary(record.summary, record.status);
  
  return {
    id,
    type: record.status === "success" ? "success" : record.status === "failed" ? "failure" : "mixed",
    source: "evolution",
    sourceId: `evolution_${record.cycle}`,
    task: record.summary || `Evolution cycle #${record.cycle}`,
    taskType,
    steps,
    outcome: record.status === "success" ? "success" : record.status === "failed" ? "failure" : "partial",
    outcomeReason: record.status === "failed" ? "Evolution failed" : undefined,
    modules,
    riskLevel,
    totalChanges: 0, // Not available from history
    durationMs: record.durationMs,
    patterns,
    startedAt: record.timestamp,
    completedAt: record.timestamp,
  };
}

/**
 * Extract trajectories from a reflection session
 */
function extractTrajectoriesFromReflection(session: ReflectionSession): InteractionTrajectory[] {
  const trajectories: InteractionTrajectory[] = [];
  
  for (const insight of session.insights) {
    // Convert insights to trajectories
    const id = generateTrajectoryId();
    
    const trajectory: InteractionTrajectory = {
      id,
      type: insight.type === "success_factor" ? "success" : 
            insight.type === "failure_cause" ? "failure" : "mixed",
      source: "reflection",
      sourceId: session.id,
      task: insight.title,
      taskType: inferTaskType(insight.description),
      steps: [
        {
          action: "reflect",
          context: insight.category,
          result: insight.type,
          timestamp: session.timestamp,
          metadata: {
            taskType: insight.category,
          },
        },
      ],
      outcome: insight.type === "success_factor" ? "success" : 
               insight.type === "failure_cause" ? "failure" : "partial",
      modules: inferModules(insight.description),
      riskLevel: "medium",
      totalChanges: 0,
      patterns: [
        {
          type: insight.type === "success_factor" ? "success_factor" : 
                insight.type === "failure_cause" ? "failure_cause" : "decision_point",
          description: insight.description,
          importance: insight.confidence,
          evidence: insight.evidence.join("; "),
        },
      ],
      startedAt: session.timestamp,
      completedAt: session.timestamp,
    };
    
    trajectories.push(trajectory);
  }
  
  return trajectories;
}

/**
 * Convert a memory node to a trajectory
 */
function memoryToTrajectory(memory: MemoryNode): InteractionTrajectory | null {
  if (memory.type !== "experience") return null;
  
  const id = generateTrajectoryId();
  const taskType = memory.tags.includes("fix") ? "bugfix" :
                   memory.tags.includes("test") ? "testing" :
                   memory.tags.includes("feature") ? "feature" : "general";
  
  return {
    id,
    type: "success", // Assume success if stored as experience
    source: "memory",
    sourceId: memory.id,
    task: memory.content,
    taskType,
    steps: [
      {
        action: "experience_recorded",
        context: memory.summary,
        result: "stored",
        timestamp: memory.createdAt,
        metadata: {
          taskType,
        },
      },
    ],
    outcome: "success",
    modules: memory.tags.filter(t => !["identity", "core", "process", "evolution"].includes(t)),
    riskLevel: "low",
    totalChanges: 0,
    patterns: [
      {
        type: "key_action",
        description: memory.summary,
        importance: memory.importance,
        evidence: memory.content,
      },
    ],
    startedAt: memory.createdAt,
    completedAt: memory.createdAt,
  };
}

/**
 * Infer task type from text
 */
function inferTaskType(text: string): string {
  const lower = text.toLowerCase();
  
  if (lower.includes("refactor")) return "refactor";
  if (lower.includes("fix") || lower.includes("bug")) return "bugfix";
  if (lower.includes("test")) return "testing";
  if (lower.includes("feature") || lower.includes("implement")) return "feature";
  if (lower.includes("document")) return "documentation";
  if (lower.includes("optimiz")) return "optimization";
  if (lower.includes("secur")) return "security";
  if (lower.includes("clean") || lower.includes("remov")) return "cleanup";
  
  return "general";
}

/**
 * Infer modules from text
 */
function inferModules(text: string): string[] {
  const modules: string[] = [];
  const lower = text.toLowerCase();
  
  // Check for known modules
  const modulePatterns = [
    { pattern: "memory", modules: ["memory"] },
    { pattern: "telegram", modules: ["telegram"] },
    { pattern: "agent", modules: ["agent"] },
    { pattern: "consciousness", modules: ["consciousness"] },
    { pattern: "supervisor", modules: ["supervisor"] },
    { pattern: "reflection", modules: ["reflection"] },
    { pattern: "principle", modules: ["principle"] },
    { pattern: "test", modules: ["testing"] },
    { pattern: "api", modules: ["api"] },
    { pattern: "util", modules: ["util"] },
  ];
  
  for (const { pattern, modules: mods } of modulePatterns) {
    if (lower.includes(pattern)) {
      modules.push(...mods);
    }
  }
  
  return [...new Set(modules)];
}

/**
 * Infer risk level from context
 */
function inferRiskLevel(text: string, modules: string[]): "low" | "medium" | "high" {
  const lower = text.toLowerCase();
  
  // High risk indicators
  if (lower.includes("critical") || lower.includes("breaking") || 
      lower.includes("security") || lower.includes("data loss")) {
    return "high";
  }
  
  // Core modules are medium-high risk
  if (modules.includes("supervisor") || modules.includes("consciousness")) {
    return "high";
  }
  
  // Medium risk indicators
  if (lower.includes("refactor") || lower.includes("major") || 
      modules.includes("memory") || modules.includes("agent")) {
    return "medium";
  }
  
  return "low";
}

/**
 * Extract patterns from a summary
 */
function extractPatternsFromSummary(summary: string, status: string): ExtractedTrajectoryPattern[] {
  const patterns: ExtractedTrajectoryPattern[] = [];
  const lower = summary.toLowerCase();
  
  // Success patterns
  if (status === "success") {
    if (lower.includes("test")) {
      patterns.push({
        type: "success_factor",
        description: "Testing was part of the workflow",
        importance: 0.7,
        evidence: "summary mentions tests",
      });
    }
    if (lower.includes("commit")) {
      patterns.push({
        type: "success_factor",
        description: "Changes were committed properly",
        importance: 0.6,
        evidence: "summary mentions commit",
      });
    }
  }
  
  // Failure patterns
  if (status === "failed") {
    if (lower.includes("error")) {
      patterns.push({
        type: "failure_cause",
        description: "Error encountered during execution",
        importance: 0.8,
        evidence: "summary mentions error",
      });
    }
    if (lower.includes("timeout")) {
      patterns.push({
        type: "failure_cause",
        description: "Operation timed out",
        importance: 0.7,
        evidence: "summary mentions timeout",
      });
    }
  }
  
  return patterns;
}

// ── Phase 2: Trajectory Clustering ──────────────────────────────────

/**
 * Cluster similar trajectories together
 */
export function clusterTrajectories(
  trajectories: InteractionTrajectory[]
): TrajectoryCluster[] {
  if (trajectories.length < DISTILLATION_CONFIG.minClusterSize) {
    log.info("Not enough trajectories for clustering", { count: trajectories.length });
    return [];
  }
  
  const clusters: TrajectoryCluster[] = [];
  const usedIds = new Set<string>();
  
  // Group by task type first
  const byTaskType = new Map<string, InteractionTrajectory[]>();
  for (const t of trajectories) {
    const key = t.taskType;
    if (!byTaskType.has(key)) byTaskType.set(key, []);
    byTaskType.get(key)!.push(t);
  }
  
  // Create clusters for each task type
  for (const [taskType, typeTrajectories] of byTaskType) {
    if (typeTrajectories.length < DISTILLATION_CONFIG.minClusterSize) continue;
    
    // Further sub-cluster by outcome
    const byOutcome = new Map<string, InteractionTrajectory[]>();
    for (const t of typeTrajectories) {
      const key = t.outcome;
      if (!byOutcome.has(key)) byOutcome.set(key, []);
      byOutcome.get(key)!.push(t);
    }
    
    for (const [outcome, outcomeTrajectories] of byOutcome) {
      if (outcomeTrajectories.length < DISTILLATION_CONFIG.minClusterSize) continue;
      
      // Filter out already used trajectories
      const available = outcomeTrajectories.filter(t => !usedIds.has(t.id));
      if (available.length < DISTILLATION_CONFIG.minClusterSize) continue;
      
      // Create cluster
      const cluster = createCluster(taskType, outcome, available);
      clusters.push(cluster);
      
      // Mark as used
      for (const t of available) {
        usedIds.add(t.id);
      }
    }
  }
  
  // Create a "mixed" cluster for remaining trajectories if enough
  const remaining = trajectories.filter(t => !usedIds.has(t.id));
  if (remaining.length >= DISTILLATION_CONFIG.minClusterSize) {
    const cluster = createCluster("mixed", "mixed", remaining);
    clusters.push(cluster);
  }
  
  log.info("Trajectories clustered", {
    totalTrajectories: trajectories.length,
    clusterCount: clusters.length,
    clusterSizes: clusters.map(c => c.trajectoryIds.length),
  });
  
  return clusters.slice(0, DISTILLATION_CONFIG.maxClusters);
}

/**
 * Create a cluster from trajectories
 */
function createCluster(
  taskType: string,
  outcome: string,
  trajectories: InteractionTrajectory[]
): TrajectoryCluster {
  const id = generateClusterId();
  
  // Calculate cluster features
  const taskTypes = [...new Set(trajectories.map(t => t.taskType))];
  const modules = [...new Set(trajectories.flatMap(t => t.modules))];
  const successCount = trajectories.filter(t => t.outcome === "success").length;
  const avgSuccessRate = successCount / trajectories.length;
  
  // Aggregate patterns
  const allPatterns = trajectories.flatMap(t => t.patterns);
  const commonPatterns = aggregatePatterns(allPatterns);
  
  // Calculate features
  const features: ClusterFeatures = {
    taskTypeSimilarity: taskTypes.length === 1 ? 1 : 0.5,
    moduleOverlap: modules.length / Math.max(1, new Set(modules).size),
    outcomeAlignment: outcome === "mixed" ? 0.5 : 1,
    patternSimilarity: calculatePatternSimilarity(trajectories),
  };
  
  return {
    id,
    name: `${taskType}_${outcome}_cluster`,
    description: `${trajectories.length} trajectories for ${taskType} tasks with ${outcome} outcome`,
    taskTypes,
    modules,
    outcomeType: outcome as "success" | "failure" | "mixed",
    trajectoryIds: trajectories.map(t => t.id),
    trajectories,
    avgSuccessRate,
    commonPatterns,
    createdAt: new Date().toISOString(),
    features,
  };
}

/**
 * Aggregate patterns by type and description
 */
function aggregatePatterns(patterns: ExtractedTrajectoryPattern[]): ExtractedTrajectoryPattern[] {
  const patternMap = new Map<string, ExtractedTrajectoryPattern>();
  
  for (const p of patterns) {
    const key = `${p.type}:${p.description.slice(0, 50)}`;
    if (!patternMap.has(key)) {
      patternMap.set(key, { ...p });
    } else {
      const existing = patternMap.get(key)!;
      existing.importance = Math.max(existing.importance, p.importance);
    }
  }
  
  return Array.from(patternMap.values())
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 10); // Top 10 patterns
}

/**
 * Calculate pattern similarity between trajectories
 */
function calculatePatternSimilarity(trajectories: InteractionTrajectory[]): number {
  if (trajectories.length < 2) return 1;
  
  // Simple similarity: how many trajectories share at least one pattern type
  const patternTypes = new Map<string, number>();
  for (const t of trajectories) {
    for (const p of t.patterns) {
      patternTypes.set(p.type, (patternTypes.get(p.type) || 0) + 1);
    }
  }
  
  // Check if any pattern type appears in most trajectories
  for (const [, count] of patternTypes) {
    if (count >= trajectories.length * 0.5) {
      return 0.7;
    }
  }
  
  return 0.4;
}

// ── Phase 3: Principle Generation ────────────────────────────────────

/**
 * Generate principles from a trajectory cluster
 */
export function generatePrinciples(cluster: TrajectoryCluster): GeneratedPrinciple[] {
  const principles: GeneratedPrinciple[] = [];
  
  // Need at least some patterns to generate principles
  if (cluster.commonPatterns.length < DISTILLATION_CONFIG.minPatternsForPrinciple) {
    log.debug("Not enough patterns for principle generation", {
      clusterId: cluster.id,
      patternCount: cluster.commonPatterns.length,
    });
    return principles;
  }
  
  // Generate principles based on cluster type
  if (cluster.outcomeType === "success") {
    // Success cluster: extract success patterns
    principles.push(...generateSuccessPrinciples(cluster));
  } else if (cluster.outcomeType === "failure") {
    // Failure cluster: extract lessons learned
    principles.push(...generateFailurePrinciples(cluster));
  } else {
    // Mixed cluster: extract decision points
    principles.push(...generateMixedPrinciples(cluster));
  }
  
  // Limit principles per cluster
  return principles.slice(0, DISTILLATION_CONFIG.maxPrinciplesPerCluster);
}

/**
 * Generate principles from a success cluster
 */
function generateSuccessPrinciples(cluster: TrajectoryCluster): GeneratedPrinciple[] {
  const principles: GeneratedPrinciple[] = [];
  
  for (const pattern of cluster.commonPatterns) {
    if (pattern.type !== "success_factor") continue;
    
    const category = inferCategoryFromTaskType(cluster.taskTypes[0]);
    
    principles.push({
      content: `When performing ${cluster.taskTypes[0]} tasks, ${pattern.description.toLowerCase()}`,
      summary: `${cluster.taskTypes[0]}: ${pattern.description.slice(0, 80)}`,
      category,
      conditions: {
        taskTypes: cluster.taskTypes,
        modules: cluster.modules.length > 0 ? cluster.modules : undefined,
        tags: ["success-pattern"],
      },
      rationale: `Based on ${cluster.trajectories.length} successful trajectories`,
      examples: cluster.trajectoryIds.slice(0, 3),
      derivedFrom: cluster.trajectoryIds,
      confidence: Math.min(0.9, pattern.importance * cluster.avgSuccessRate),
    });
  }
  
  return principles;
}

/**
 * Generate principles from a failure cluster
 */
function generateFailurePrinciples(cluster: TrajectoryCluster): GeneratedPrinciple[] {
  const principles: GeneratedPrinciple[] = [];
  
  for (const pattern of cluster.commonPatterns) {
    if (pattern.type !== "failure_cause") continue;
    
    const category = inferCategoryFromTaskType(cluster.taskTypes[0]);
    
    principles.push({
      content: `Avoid ${pattern.description.toLowerCase()} when performing ${cluster.taskTypes[0]} tasks`,
      summary: `${cluster.taskTypes[0]}: Avoid ${pattern.description.slice(0, 60)}`,
      category,
      conditions: {
        taskTypes: cluster.taskTypes,
        modules: cluster.modules.length > 0 ? cluster.modules : undefined,
        tags: ["failure-avoidance"],
      },
      rationale: `Learned from ${cluster.trajectories.length} failed trajectories`,
      examples: cluster.trajectoryIds.slice(0, 3),
      derivedFrom: cluster.trajectoryIds,
      confidence: Math.min(0.85, pattern.importance * (1 - cluster.avgSuccessRate)),
    });
  }
  
  return principles;
}

/**
 * Generate principles from a mixed cluster
 */
function generateMixedPrinciples(cluster: TrajectoryCluster): GeneratedPrinciple[] {
  const principles: GeneratedPrinciple[] = [];
  
  for (const pattern of cluster.commonPatterns) {
    if (pattern.type !== "decision_point") continue;
    
    const category = inferCategoryFromTaskType(cluster.taskTypes[0]);
    
    principles.push({
      content: `Consider ${pattern.description.toLowerCase()} when ${cluster.taskTypes[0]}`,
      summary: `${cluster.taskTypes[0]}: Consider ${pattern.description.slice(0, 60)}`,
      category,
      conditions: {
        taskTypes: cluster.taskTypes,
        modules: cluster.modules.length > 0 ? cluster.modules : undefined,
        tags: ["decision-guidance"],
      },
      rationale: `Derived from mixed outcomes in ${cluster.trajectories.length} trajectories`,
      examples: cluster.trajectoryIds.slice(0, 3),
      derivedFrom: cluster.trajectoryIds,
      confidence: Math.min(0.75, pattern.importance * 0.7),
    });
  }
  
  return principles;
}

/**
 * Infer principle category from task type
 */
function inferCategoryFromTaskType(taskType: string): PrincipleCategory {
  const mapping: Record<string, PrincipleCategory> = {
    refactor: "coding",
    bugfix: "error_handling",
    feature: "coding",
    testing: "testing",
    documentation: "process",
    optimization: "optimization",
    security: "security",
    cleanup: "process",
    general: "general",
  };
  
  return mapping[taskType] || "general";
}

// ── Phase 4: Principle Validation ───────────────────────────────────

/**
 * Validate a generated principle
 */
export function validatePrinciple(
  principle: GeneratedPrinciple,
  allTrajectories: InteractionTrajectory[]
): ValidationResult {
  const issues: string[] = [];
  const recommendations: string[] = [];
  
  // Check confidence threshold
  if (principle.confidence < DISTILLATION_CONFIG.confidenceThreshold) {
    issues.push(`Confidence ${principle.confidence.toFixed(2)} below threshold ${DISTILLATION_CONFIG.confidenceThreshold}`);
    recommendations.push("Gather more supporting evidence before storing");
  }
  
  // Check supporting evidence
  const supportingTrajectories = principle.derivedFrom.length;
  if (supportingTrajectories < DISTILLATION_CONFIG.minSupportingEvidence) {
    issues.push(`Only ${supportingTrajectories} supporting trajectories, need at least ${DISTILLATION_CONFIG.minSupportingEvidence}`);
    recommendations.push("Wait for more similar experiences");
  }
  
  // Check for contradicting evidence in other trajectories
  const contradictingTrajectories = findContradictingTrajectories(principle, allTrajectories);
  
  // Calculate historical success rate from existing principles
  const existingPrinciples = getAllPrinciples();
  const similarPrinciples = existingPrinciples.filter(p => 
    p.category === principle.category &&
    p.conditions.taskTypes?.some(t => principle.conditions.taskTypes?.includes(t))
  );
  const historicalSuccessRate = similarPrinciples.length > 0
    ? similarPrinciples.reduce((sum, p) => sum + p.evidence.successRate, 0) / similarPrinciples.length
    : 0.5;
  
  // Check for duplicates
  const duplicates = findDuplicatePrinciples(principle, existingPrinciples);
  if (duplicates.length > 0) {
    issues.push(`Found ${duplicates.length} similar existing principle(s)`);
    recommendations.push("Consider merging with existing principle instead");
  }
  
  const isValid = issues.length === 0 || principle.confidence >= DISTILLATION_CONFIG.confidenceThreshold;
  
  return {
    principleId: "pending", // Will be set when stored
    isValid,
    issues,
    recommendations,
    evidence: {
      supportingTrajectories,
      contradictingTrajectories: contradictingTrajectories.length,
      historicalSuccessRate,
    },
  };
}

/**
 * Find trajectories that might contradict a principle
 */
function findContradictingTrajectories(
  principle: GeneratedPrinciple,
  trajectories: InteractionTrajectory[]
): InteractionTrajectory[] {
  const contradicting: InteractionTrajectory[] = [];
  
  for (const t of trajectories) {
    // Check if trajectory matches conditions but has opposite outcome
    const matchesConditions = 
      (!principle.conditions.taskTypes || principle.conditions.taskTypes.includes(t.taskType)) &&
      (!principle.conditions.modules || t.modules.some(m => principle.conditions.modules!.includes(m)));
    
    if (matchesConditions) {
      const isFailureAvoidance = principle.conditions.tags?.includes("failure-avoidance");
      const isSuccessPattern = principle.conditions.tags?.includes("success-pattern");
      
      // Contradiction: success pattern but trajectory failed
      if (isSuccessPattern && t.outcome === "failure") {
        contradicting.push(t);
      }
      // Contradiction: failure avoidance but trajectory succeeded
      else if (isFailureAvoidance && t.outcome === "success") {
        contradicting.push(t);
      }
    }
  }
  
  return contradicting;
}

/**
 * Find duplicate or very similar principles
 */
function findDuplicatePrinciples(
  principle: GeneratedPrinciple,
  existingPrinciples: Principle[]
): Principle[] {
  return existingPrinciples.filter(p => {
    // Check category match
    if (p.category !== principle.category) return false;
    
    // Check task type overlap
    const taskOverlap = p.conditions.taskTypes?.some(t => 
      principle.conditions.taskTypes?.includes(t)
    ) ?? false;
    
    if (!taskOverlap) return false;
    
    // Check content similarity (simple word overlap)
    const pWords = new Set(p.content.toLowerCase().split(/\s+/));
    const newWords = new Set(principle.content.toLowerCase().split(/\s+/));
    const overlap = [...pWords].filter(w => newWords.has(w)).length;
    const similarity = overlap / Math.max(pWords.size, newWords.size);
    
    return similarity > 0.6; // 60% word overlap
  });
}

// ── Main Distillation Function ───────────────────────────────────────

/**
 * Create empty distillation result
 */
function createEmptyResult(timestamp: string, reason: string, trajectoryCount: number = 0): DistillationResult {
  return {
    timestamp,
    triggerReason: reason,
    trajectoriesExtracted: trajectoryCount,
    clustersCreated: 0,
    principlesGenerated: 0,
    principlesValidated: 0,
    principlesStored: 0,
    trajectoryIds: [],
    clusterIds: [],
    principleIds: [],
    stats: {
      avgTrajectoriesPerCluster: 0,
      avgPrinciplesPerCluster: 0,
      avgConfidence: 0,
      categoriesGenerated: {} as Record<PrincipleCategory, number>,
    },
  };
}

/**
 * Check if distillation interval has elapsed
 */
function checkDistillationInterval(record: DistillationRecord, force: boolean): boolean {
  if (force) return true;
  const lastRun = new Date(record.lastDistillationAt).getTime();
  const hoursSince = (Date.now() - lastRun) / (1000 * 60 * 60);
  return hoursSince >= DISTILLATION_CONFIG.minDistillationInterval;
}

/**
 * Process clusters and generate principles
 */
function processClusters(
  clusters: TrajectoryCluster[],
  trajectories: InteractionTrajectory[],
  dryRun: boolean
): { principles: GeneratedPrinciple[]; validations: ValidationResult[]; principleIds: string[] } {
  const allPrinciples: GeneratedPrinciple[] = [];
  const validations: ValidationResult[] = [];
  const principleIds: string[] = [];
  
  for (const cluster of clusters) {
    const generated = generatePrinciples(cluster);
    
    for (const principle of generated) {
      const validation = validatePrinciple(principle, trajectories);
      validations.push(validation);
      
      if (validation.isValid) {
        if (!dryRun) {
          const stored = storePrinciple({
            content: principle.content,
            summary: principle.summary,
            category: principle.category,
            conditions: principle.conditions,
            derivedFrom: principle.derivedFrom,
            confidence: principle.confidence,
            rationale: principle.rationale,
            examples: principle.examples,
          });
          principleIds.push(stored.id);
        }
        allPrinciples.push(principle);
      }
    }
  }
  
  return { principles: allPrinciples, validations, principleIds };
}

/**
 * Run the complete distillation process
 */
export async function runDistillation(options: {
  force?: boolean;  // Force distillation even if recently run
  dryRun?: boolean; // Don't store principles, just return results
} = {}): Promise<DistillationResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  
  log.info("Starting principle distillation", { options });
  
  // Check if we should run
  const record = loadDistillationRecord();
  if (!checkDistillationInterval(record, options.force || false)) {
    log.info("Skipping distillation - too recent");
    return createEmptyResult(timestamp, "interval_not_elapsed");
  }
  
  // Phase 1: Extract trajectories
  const trajectories = extractTrajectories();
  
  if (trajectories.length < DISTILLATION_CONFIG.minHistoryEntries) {
    log.info("Not enough trajectories for distillation", { count: trajectories.length });
    return createEmptyResult(timestamp, "insufficient_trajectories", trajectories.length);
  }
  
  // Phase 2: Cluster trajectories
  const clusters = clusterTrajectories(trajectories);
  
  // Phase 3 & 4: Generate and validate principles
  const { principles: allPrinciples, validations, principleIds } = processClusters(
    clusters, trajectories, options.dryRun || false
  );
  
  // Calculate stats
  const categoriesGenerated: Record<PrincipleCategory, number> = {
    coding: 0, testing: 0, architecture: 0, process: 0,
    communication: 0, learning: 0, error_handling: 0,
    optimization: 0, security: 0, general: 0,
  };
  for (const p of allPrinciples) {
    categoriesGenerated[p.category]++;
  }
  
  const avgConfidence = allPrinciples.length > 0
    ? allPrinciples.reduce((sum, p) => sum + p.confidence, 0) / allPrinciples.length
    : 0;
  
  const result: DistillationResult = {
    timestamp,
    triggerReason: options.force ? "forced" : "scheduled",
    trajectoriesExtracted: trajectories.length,
    clustersCreated: clusters.length,
    principlesGenerated: allPrinciples.length,
    principlesValidated: validations.filter(v => v.isValid).length,
    principlesStored: principleIds.length,
    trajectoryIds: trajectories.map(t => t.id),
    clusterIds: clusters.map(c => c.id),
    principleIds,
    stats: {
      avgTrajectoriesPerCluster: clusters.length > 0
        ? trajectories.length / clusters.length
        : 0,
      avgPrinciplesPerCluster: clusters.length > 0
        ? allPrinciples.length / clusters.length
        : 0,
      avgConfidence,
      categoriesGenerated,
    },
  };
  
  // Update distillation record
  if (!options.dryRun) {
    record.lastDistillationAt = timestamp;
    record.lastTrajectoryCount = trajectories.length;
    record.lastPrincipleCount = principleIds.length;
    record.distillationHistory.push(result);
    saveDistillationRecord(record);
  }
  
  const durationMs = Date.now() - startTime;
  log.info("Principle distillation complete", {
    durationMs,
    trajectories: trajectories.length,
    clusters: clusters.length,
    principlesGenerated: allPrinciples.length,
    principlesStored: principleIds.length,
  });
  
  return result;
}

// ── Utility Functions ───────────────────────────────────────────────

/**
 * Check if distillation should run
 */
export function shouldRunDistillation(): boolean {
  const record = loadDistillationRecord();
  const lastRun = new Date(record.lastDistillationAt).getTime();
  const hoursSince = (Date.now() - lastRun) / (1000 * 60 * 60);
  
  if (hoursSince < DISTILLATION_CONFIG.minDistillationInterval) {
    return false;
  }
  
  // Check if we have enough new history
  const history = loadEvolutionHistory();
  if (history.length < DISTILLATION_CONFIG.minHistoryEntries) {
    return false;
  }
  
  return true;
}

/**
 * Get distillation status and statistics
 */
export function getDistillationStatus(): {
  lastDistillationAt: string;
  hoursSinceLastDistillation: number;
  totalDistillations: number;
  totalPrinciplesGenerated: number;
  currentPrinciples: number;
} {
  const record = loadDistillationRecord();
  const stats = getPrincipleStats();
  
  const lastRun = new Date(record.lastDistillationAt).getTime();
  const hoursSince = (Date.now() - lastRun) / (1000 * 60 * 60);
  
  return {
    lastDistillationAt: record.lastDistillationAt,
    hoursSinceLastDistillation: hoursSince,
    totalDistillations: record.distillationHistory.length,
    totalPrinciplesGenerated: record.distillationHistory.reduce(
      (sum, r) => sum + r.principlesStored,
      0
    ),
    currentPrinciples: stats.totalPrinciples,
  };
}

/**
 * Format distillation result for display
 */
export function formatDistillationResult(result: DistillationResult): string {
  const lines: string[] = [
    "⚗️ Principle Distillation Result",
    "",
    `Timestamp: ${result.timestamp}`,
    `Trigger: ${result.triggerReason}`,
    "",
    "📊 Statistics:",
    `  Trajectories Extracted: ${result.trajectoriesExtracted}`,
    `  Clusters Created: ${result.clustersCreated}`,
    `  Principles Generated: ${result.principlesGenerated}`,
    `  Principles Validated: ${result.principlesValidated}`,
    `  Principles Stored: ${result.principlesStored}`,
    "",
    "📈 Details:",
    `  Avg Trajectories/Cluster: ${result.stats.avgTrajectoriesPerCluster.toFixed(1)}`,
    `  Avg Principles/Cluster: ${result.stats.avgPrinciplesPerCluster.toFixed(1)}`,
    `  Avg Confidence: ${(result.stats.avgConfidence * 100).toFixed(0)}%`,
    "",
    "📁 Categories Generated:",
  ];
  
  for (const [cat, count] of Object.entries(result.stats.categoriesGenerated)) {
    if (count > 0) {
      lines.push(`  ${cat}: ${count}`);
    }
  }
  
  if (result.principleIds.length > 0) {
    lines.push("");
    lines.push("📚 New Principles:");
    for (const id of result.principleIds.slice(0, 5)) {
      const principle = getPrinciple(id);
      if (principle) {
        lines.push(`  - ${principle.summary}`);
      }
    }
  }
  
  return lines.join("\n");
}

// Re-export from principle-store for convenience
export {
  storePrinciple,
  retrievePrinciples,
  updatePrinciple,
  recordPrincipleApplication,
  getPrinciple,
  getAllPrinciples,
  getPrincipleStats,
  mergePrinciples,
  prunePrinciples,
};