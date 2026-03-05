/**
 * Principle Store Module
 * 
 * Implements EvolveR's Principle Library for Experience Distillation.
 * Based on arXiv 2510.16079 (ICLR 2026).
 * 
 * Core capabilities:
 * - Store abstract principles distilled from interaction trajectories
 * - Retrieve relevant principles for decision guidance
 * - Track principle effectiveness and evolution
 * - Support principle lifecycle (creation, update, deprecation)
 * 
 * Key insight: Principles are abstract, reusable guidelines that
 * transcend specific experiences, enabling knowledge transfer
 * across different contexts.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../supervisor/paths.js";
import { log } from "../util/log.js";

const PRINCIPLES_PATH = join(DATA_DIR, "memory", "principles.json");

// ── Types ──────────────────────────────────────────────────────────

/**
 * Principle category for classification
 */
export type PrincipleCategory =
  | "coding"          // Code writing and modification
  | "testing"         // Testing strategies and practices
  | "architecture"    // System design and structure
  | "process"         // Workflow and procedures
  | "communication"   // Interaction with creator
  | "learning"        // Self-improvement and knowledge acquisition
  | "error_handling"  // Error prevention and recovery
  | "optimization"    // Performance and efficiency
  | "security"        // Security considerations
  | "general";        // General-purpose principles

/**
 * Principle status lifecycle
 */
export type PrincipleStatus =
  | "experimental"    // Newly created, not yet validated
  | "active"          // Validated and in use
  | "deprecated"      // No longer recommended
  | "archived";       // Historical record only

/**
 * Conditions under which a principle applies
 */
export interface PrincipleConditions {
  taskTypes?: string[];           // e.g., ["refactor", "feature", "bugfix"]
  modules?: string[];             // e.g., ["memory", "telegram", "agent"]
  riskLevel?: "low" | "medium" | "high";
  minChanges?: number;            // Minimum lines of code changed
  maxChanges?: number;            // Maximum lines of code changed
  tags?: string[];                // Flexible tags for matching
}

/**
 * Evidence supporting a principle
 */
export interface PrincipleEvidence {
  successCases: string[];         // Evolution IDs where principle worked
  failureCases: string[];         // Evolution IDs where principle failed
  successRate: number;            // Calculated success rate
  totalApplications: number;      // Total times principle was applied
  lastAppliedAt?: string;         // When last applied
}

/**
 * Voting record for principle effectiveness
 * Based on ACE Pattern (Aegis Memory 2026) Memory Voting innovation
 */
export interface PrincipleVoting {
  helpful: number;                // Count of helpful votes
  harmful: number;                // Count of harmful votes
  totalVotes: number;             // Total votes cast
  effectiveness: number;          // Quality signal: (helpful - harmful) / (total + 1)
  lastVotedAt?: string;           // When last voted on
  voteHistory: VoteRecord[];      // Individual vote records
}

/**
 * Single vote record
 */
export interface VoteRecord {
  timestamp: string;              // When the vote was cast
  evolutionId: string;            // Evolution context
  vote: "helpful" | "harmful" | "neutral";  // Vote type
  context?: string;               // Optional context/reason
  agentId?: string;               // Optional agent identifier
}

/**
 * An abstract principle distilled from experience
 */
export interface Principle {
  id: string;                     // Unique identifier
  content: string;                // The principle itself (natural language)
  summary: string;                // Short summary for quick reference
  category: PrincipleCategory;
  
  // Applicability
  conditions: PrincipleConditions;
  
  // Validation
  evidence: PrincipleEvidence;
  
  // Voting (ACE Pattern - Memory Voting)
  voting: PrincipleVoting;
  
  // Metadata
  metadata: {
    createdAt: string;
    updatedAt: string;
    derivedFrom: string[];        // Source evolution IDs or trajectory IDs
    sourcePrinciples?: string[];  // If merged from other principles
    confidence: number;           // 0-1: How confident we are
    stability: number;            // 0-1: How stable over time
    reinforcementCount: number;   // Times reinforced
    reviewCount: number;          // Times reviewed
  };
  
  // Status
  status: PrincipleStatus;
  
  // Additional context
  rationale?: string;             // Why this principle exists
  examples?: string[];            // Example applications
  counterexamples?: string[];     // When NOT to apply
  relatedPrinciples?: string[];   // Related principle IDs
}

/**
 * Query for retrieving principles
 */
export interface PrincipleQuery {
  text?: string;                  // Semantic search
  category?: PrincipleCategory;
  categories?: PrincipleCategory[];
  status?: PrincipleStatus;
  conditions?: Partial<PrincipleConditions>;
  minConfidence?: number;
  minSuccessRate?: number;
  limit?: number;
}

/**
 * A principle with relevance score
 */
export interface ScoredPrinciple {
  principle: Principle;
  score: number;                  // 0-1 relevance score
  matchReasons: string[];         // Why it matched
}

/**
 * Application result for feedback
 */
export interface PrincipleApplicationResult {
  principleId: string;
  appliedAt: string;
  evolutionId: string;
  context: string;
  result: "success" | "failure" | "neutral";
  notes?: string;
}

/**
 * Export format for principle library
 */
export interface PrincipleLibraryExport {
  principles: Principle[];
  exportedAt: string;
  stats: PrincipleLibraryStats;
}

/**
 * Statistics about the principle library
 */
export interface PrincipleLibraryStats {
  totalPrinciples: number;
  byCategory: Record<PrincipleCategory, number>;
  byStatus: Record<PrincipleStatus, number>;
  avgConfidence: number;
  avgSuccessRate: number;
  activePrinciples: number;
  experimentalPrinciples: number;
  deprecatedPrinciples: number;
  // Voting statistics (ACE Pattern)
  avgEffectiveness: number;
  totalVotes: number;
  highlyEffective: number;    // principles with effectiveness > 0.5
  ineffective: number;        // principles with effectiveness < -0.3
}

// ── Configuration ──────────────────────────────────────────────────

const PRUNING_CONFIG = {
  minSuccessRate: 0.3,            // Below this, consider deprecation
  minApplications: 3,             // Minimum applications before evaluation
  maxAge: 90,                     // Days before re-evaluation
  deprecationThreshold: 0.2,      // Below this, auto-deprecate
};

// ── Storage Functions ──────────────────────────────────────────────

/**
 * Default voting object for backward compatibility
 */
function getDefaultVoting(): PrincipleVoting {
  return {
    helpful: 0,
    harmful: 0,
    totalVotes: 0,
    effectiveness: 0,
    voteHistory: [],
  };
}

function loadPrinciples(): Map<string, Principle> {
  try {
    if (existsSync(PRINCIPLES_PATH)) {
      const data = JSON.parse(readFileSync(PRINCIPLES_PATH, "utf-8"));
      // Add default voting for backward compatibility
      const principles = data.map((p: Principle) => {
        if (!p.voting) {
          p.voting = getDefaultVoting();
        }
        return p;
      });
      return new Map(principles.map((p: Principle) => [p.id, p]));
    }
  } catch (e) {
    log.warn("Failed to load principles", { error: (e as Error).message });
  }
  return new Map();
}

function savePrinciples(principles: Map<string, Principle>): void {
  try {
    const dir = join(DATA_DIR, "memory");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const data = Array.from(principles.values());
    writeFileSync(PRINCIPLES_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    log.error("Failed to save principles", { error: (e as Error).message });
  }
}

// ── ID Generation ───────────────────────────────────────────────────

function generatePrincipleId(): string {
  return `principle_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

// ── Core Operations ─────────────────────────────────────────────────

/**
 * Store a new principle
 */
export function storePrinciple(input: {
  content: string;
  summary?: string;
  category: PrincipleCategory;
  conditions?: Partial<PrincipleConditions>;
  derivedFrom: string[];
  confidence?: number;
  rationale?: string;
  examples?: string[];
}): Principle {
  const now = new Date().toISOString();
  const id = generatePrincipleId();
  
  const principle: Principle = {
    id,
    content: input.content,
    summary: input.summary || input.content.slice(0, 100),
    category: input.category,
    conditions: input.conditions || {},
    evidence: {
      successCases: [],
      failureCases: [],
      successRate: 0,
      totalApplications: 0,
    },
    voting: {
      helpful: 0,
      harmful: 0,
      totalVotes: 0,
      effectiveness: 0,
      voteHistory: [],
    },
    metadata: {
      createdAt: now,
      updatedAt: now,
      derivedFrom: input.derivedFrom,
      confidence: input.confidence ?? 0.5,
      stability: 0.5,
      reinforcementCount: 0,
      reviewCount: 0,
    },
    status: "experimental",
    rationale: input.rationale,
    examples: input.examples,
  };
  
  const principles = loadPrinciples();
  principles.set(id, principle);
  savePrinciples(principles);
  
  log.info("Principle stored", { id, category: input.category });
  return principle;
}

/**
 * Retrieve principles matching a query
 */
export function retrievePrinciples(query: PrincipleQuery): ScoredPrinciple[] {
  const principles = loadPrinciples();
  const results: ScoredPrinciple[] = [];
  
  for (const [, principle] of principles) {
    // Status filter
    if (query.status && principle.status !== query.status) continue;
    
    // Category filter
    if (query.category && principle.category !== query.category) continue;
    if (query.categories && !query.categories.includes(principle.category)) continue;
    
    // Confidence filter
    if (query.minConfidence && principle.metadata.confidence < query.minConfidence) continue;
    
    // Success rate filter
    if (query.minSuccessRate && principle.evidence.successRate < query.minSuccessRate) continue;
    
    // Condition matching
    if (query.conditions) {
      const conditionMatch = matchConditions(principle.conditions, query.conditions);
      if (!conditionMatch) continue;
    }
    
    // Calculate relevance score
    const score = calculateRelevance(principle, query);
    const matchReasons = getMatchReasons(principle, query);
    
    results.push({ principle, score, matchReasons });
  }
  
  // Sort by score
  results.sort((a, b) => b.score - a.score);
  
  // Limit results
  if (query.limit) {
    return results.slice(0, query.limit);
  }
  
  return results;
}

/**
 * Update a principle
 */
export function updatePrinciple(
  id: string,
  updates: Partial<{
    content: string;
    summary: string;
    category: PrincipleCategory;
    conditions: PrincipleConditions;
    status: PrincipleStatus;
    confidence: number;
    rationale: string;
    examples: string[];
    counterexamples: string[];
    relatedPrinciples: string[];
    voting: PrincipleVoting;
  }>
): Principle | null {
  const principles = loadPrinciples();
  const principle = principles.get(id);
  
  if (!principle) {
    log.warn("Principle not found for update", { id });
    return null;
  }
  
  // Apply updates
  if (updates.content) principle.content = updates.content;
  if (updates.summary) principle.summary = updates.summary;
  if (updates.category) principle.category = updates.category;
  if (updates.conditions) principle.conditions = updates.conditions;
  if (updates.status) principle.status = updates.status;
  if (updates.rationale) principle.rationale = updates.rationale;
  if (updates.examples) principle.examples = updates.examples;
  if (updates.counterexamples) principle.counterexamples = updates.counterexamples;
  if (updates.relatedPrinciples) principle.relatedPrinciples = updates.relatedPrinciples;
  if (updates.voting) principle.voting = updates.voting;
  
  if (updates.confidence !== undefined) {
    principle.metadata.confidence = updates.confidence;
  }
  
  principle.metadata.updatedAt = new Date().toISOString();
  principle.metadata.reviewCount++;
  
  principles.set(id, principle);
  savePrinciples(principles);
  
  log.info("Principle updated", { id, updates: Object.keys(updates) });
  return principle;
}

/**
 * Record principle application result for feedback
 */
export function recordPrincipleApplication(
  principleId: string,
  evolutionId: string,
  context: string,
  result: "success" | "failure" | "neutral"
): void {
  const principles = loadPrinciples();
  const principle = principles.get(principleId);
  
  if (!principle) {
    log.warn("Principle not found for recording application", { principleId });
    return;
  }
  
  const now = new Date().toISOString();
  
  // Update evidence
  principle.evidence.totalApplications++;
  principle.evidence.lastAppliedAt = now;
  
  if (result === "success") {
    principle.evidence.successCases.push(evolutionId);
  } else if (result === "failure") {
    principle.evidence.failureCases.push(evolutionId);
  }
  
  // Recalculate success rate
  const total = principle.evidence.successCases.length + principle.evidence.failureCases.length;
  if (total > 0) {
    principle.evidence.successRate = principle.evidence.successCases.length / total;
  }
  
  // Update confidence based on result
  if (result === "success") {
    principle.metadata.confidence = Math.min(1, principle.metadata.confidence + 0.05);
    principle.metadata.reinforcementCount++;
  } else if (result === "failure") {
    principle.metadata.confidence = Math.max(0, principle.metadata.confidence - 0.1);
  }
  
  // Update stability
  principle.metadata.stability = calculateStability(principle);
  
  // Check for status transition
  principle.status = evaluateStatus(principle);
  
  principle.metadata.updatedAt = now;
  principles.set(principleId, principle);
  savePrinciples(principles);
  
  log.info("Principle application recorded", {
    principleId,
    evolutionId,
    result,
    newSuccessRate: principle.evidence.successRate,
    newConfidence: principle.metadata.confidence,
  });
}

/**
 * Merge similar principles
 */
export function mergePrinciples(
  principleIds: string[],
  newContent: string,
  newSummary: string
): Principle | null {
  const principles = loadPrinciples();
  
  const toMerge: Principle[] = [];
  for (const id of principleIds) {
    const p = principles.get(id);
    if (p) toMerge.push(p);
  }
  
  if (toMerge.length < 2) {
    log.warn("Need at least 2 principles to merge");
    return null;
  }
  
  // Aggregate evidence
  const successCases = [...new Set(toMerge.flatMap(p => p.evidence.successCases))];
  const failureCases = [...new Set(toMerge.flatMap(p => p.evidence.failureCases))];
  const totalApplications = toMerge.reduce((sum, p) => sum + p.evidence.totalApplications, 0);
  const successRate = successCases.length / (successCases.length + failureCases.length) || 0;
  
  // Aggregate derivedFrom
  const derivedFrom = [...new Set(toMerge.flatMap(p => p.metadata.derivedFrom))];
  
  // Calculate combined confidence
  const avgConfidence = toMerge.reduce((sum, p) => sum + p.metadata.confidence, 0) / toMerge.length;
  
  // Determine category (most common)
  const categoryCounts = new Map<PrincipleCategory, number>();
  for (const p of toMerge) {
    categoryCounts.set(p.category, (categoryCounts.get(p.category) || 0) + 1);
  }
  const category = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  
  // Create merged principle
  const merged = storePrinciple({
    content: newContent,
    summary: newSummary,
    category,
    conditions: mergeConditions(toMerge.map(p => p.conditions)),
    derivedFrom,
    confidence: avgConfidence,
    rationale: `Merged from principles: ${principleIds.join(", ")}`,
    examples: [...new Set(toMerge.flatMap(p => p.examples || []))],
  });
  
  // Update merged principle with aggregated evidence
  const principlesMap = loadPrinciples();
  const mergedP = principlesMap.get(merged.id);
  if (mergedP) {
    mergedP.evidence = { successCases, failureCases, successRate, totalApplications };
    mergedP.metadata.sourcePrinciples = principleIds;
    mergedP.status = "active";
    principlesMap.set(merged.id, mergedP);
    
    // Deprecate source principles
    for (const id of principleIds) {
      const p = principlesMap.get(id);
      if (p) {
        p.status = "deprecated";
        p.metadata.updatedAt = new Date().toISOString();
        principlesMap.set(id, p);
      }
    }
    
    savePrinciples(principlesMap);
  }
  
  log.info("Principles merged", {
    sourceIds: principleIds,
    mergedId: merged.id,
    totalEvidence: totalApplications,
  });
  
  return merged;
}

/**
 * Check if principle should be deprecated based on evidence
 */
function shouldDeprecatePrinciple(
  principle: Principle,
  minSuccessRate: number,
  minApplications: number
): boolean {
  return (
    principle.evidence.totalApplications >= minApplications &&
    principle.evidence.successRate < minSuccessRate
  );
}

/**
 * Check if principle should be deleted (old, unused, low confidence)
 */
function shouldDeletePrinciple(principle: Principle): boolean {
  const ageInDays = (Date.now() - new Date(principle.metadata.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  return (
    ageInDays > 60 &&
    principle.evidence.totalApplications === 0 &&
    principle.metadata.confidence < 0.3
  );
}

/**
 * Check if principle status is active (not deprecated/archived)
 */
function isPrincipleActive(principle: Principle): boolean {
  return principle.status !== "deprecated" && principle.status !== "archived";
}

/**
 * Prune ineffective principles
 */
export function prunePrinciples(options: {
  minSuccessRate?: number;
  minApplications?: number;
  dryRun?: boolean;
} = {}): { deprecated: string[]; deleted: string[] } {
  const { minSuccessRate = PRUNING_CONFIG.deprecationThreshold, minApplications = PRUNING_CONFIG.minApplications, dryRun = false } = options;
  
  const principles = loadPrinciples();
  const deprecated: string[] = [];
  const deleted: string[] = [];
  
  for (const [id, principle] of principles) {
    // Skip already deprecated or archived
    if (!isPrincipleActive(principle)) continue;
    
    // Check if should be deprecated
    if (shouldDeprecatePrinciple(principle, minSuccessRate, minApplications)) {
      deprecated.push(id);
      if (!dryRun) {
        principle.status = "deprecated";
        principle.metadata.updatedAt = new Date().toISOString();
        principles.set(id, principle);
      }
      continue; // Skip deletion check if deprecated
    }
    
    // Check if should be deleted (very old, no applications, very low confidence)
    if (shouldDeletePrinciple(principle)) {
      deleted.push(id);
      if (!dryRun) {
        principles.delete(id);
      }
    }
  }
  
  if (!dryRun && (deprecated.length > 0 || deleted.length > 0)) {
    savePrinciples(principles);
  }
  
  log.info("Principle pruning complete", {
    deprecated: deprecated.length,
    deleted: deleted.length,
    dryRun,
  });
  
  return { deprecated, deleted };
}

/**
 * Get principle library statistics
 */
export function getPrincipleStats(): PrincipleLibraryStats {
  const principles = loadPrinciples();
  
  const byCategory: Record<PrincipleCategory, number> = {
    coding: 0, testing: 0, architecture: 0, process: 0,
    communication: 0, learning: 0, error_handling: 0,
    optimization: 0, security: 0, general: 0,
  };
  
  const byStatus: Record<PrincipleStatus, number> = {
    experimental: 0, active: 0, deprecated: 0, archived: 0,
  };
  
  let totalConfidence = 0;
  let totalSuccessRate = 0;
  let activeCount = 0;
  let experimentalCount = 0;
  let deprecatedCount = 0;
  
  // Voting statistics
  let totalEffectiveness = 0;
  let principlesWithVotes = 0;
  let totalVotesCount = 0;
  let highlyEffectiveCount = 0;
  let ineffectiveCount = 0;
  
  for (const [, p] of principles) {
    byCategory[p.category]++;
    byStatus[p.status]++;
    totalConfidence += p.metadata.confidence;
    totalSuccessRate += p.evidence.successRate;
    
    if (p.status === "active") activeCount++;
    else if (p.status === "experimental") experimentalCount++;
    else if (p.status === "deprecated") deprecatedCount++;
    
    // Voting statistics
    if (p.voting) {
      if (p.voting.totalVotes > 0) {
        totalEffectiveness += p.voting.effectiveness;
        principlesWithVotes++;
        totalVotesCount += p.voting.totalVotes;
        
        if (p.voting.effectiveness > 0.5) highlyEffectiveCount++;
        if (p.voting.effectiveness < -0.3) ineffectiveCount++;
      }
    }
  }
  
  const total = principles.size;
  
  return {
    totalPrinciples: total,
    byCategory,
    byStatus,
    avgConfidence: total > 0 ? totalConfidence / total : 0,
    avgSuccessRate: total > 0 ? totalSuccessRate / total : 0,
    activePrinciples: activeCount,
    experimentalPrinciples: experimentalCount,
    deprecatedPrinciples: deprecatedCount,
    // Voting statistics
    avgEffectiveness: principlesWithVotes > 0 ? totalEffectiveness / principlesWithVotes : 0,
    totalVotes: totalVotesCount,
    highlyEffective: highlyEffectiveCount,
    ineffective: ineffectiveCount,
  };
}

/**
 * Export principle library
 */
export function exportPrincipleLibrary(): PrincipleLibraryExport {
  const principles = loadPrinciples();
  return {
    principles: Array.from(principles.values()),
    exportedAt: new Date().toISOString(),
    stats: getPrincipleStats(),
  };
}

/**
 * Get principle by ID
 */
export function getPrinciple(id: string): Principle | null {
  const principles = loadPrinciples();
  return principles.get(id) || null;
}

/**
 * Get all principles
 */
export function getAllPrinciples(): Principle[] {
  const principles = loadPrinciples();
  return Array.from(principles.values());
}

// ── Helper Functions ───────────────────────────────────────────────

function matchConditions(
  principleConditions: PrincipleConditions,
  queryConditions: Partial<PrincipleConditions>
): boolean {
  // If principle has no conditions, it matches anything
  if (Object.keys(principleConditions).length === 0) return true;
  
  // Check task type match
  if (queryConditions.taskTypes && principleConditions.taskTypes) {
    const overlap = queryConditions.taskTypes.some(t => principleConditions.taskTypes!.includes(t));
    if (!overlap) return false;
  }
  
  // Check module match
  if (queryConditions.modules && principleConditions.modules) {
    const overlap = queryConditions.modules.some(m => principleConditions.modules!.includes(m));
    if (!overlap) return false;
  }
  
  // Check risk level match
  if (queryConditions.riskLevel && principleConditions.riskLevel) {
    if (queryConditions.riskLevel !== principleConditions.riskLevel) return false;
  }
  
  // Check tags match
  if (queryConditions.tags && principleConditions.tags) {
    const overlap = queryConditions.tags.some(t => principleConditions.tags!.includes(t));
    if (!overlap) return false;
  }
  
  return true;
}

function calculateRelevance(principle: Principle, query: PrincipleQuery): number {
  let score = 0;
  
  // Base score from confidence
  score += principle.metadata.confidence * 0.2;
  
  // Success rate contribution (reduced weight to make room for effectiveness)
  if (principle.evidence.totalApplications > 0) {
    score += principle.evidence.successRate * 0.2;
  }
  
  // Effectiveness from voting (ACE Pattern - Memory Voting)
  // effectiveness ranges from -1 (all harmful) to 1 (all helpful)
  // We normalize to 0-0.2 range for scoring
  if (principle.voting && principle.voting.totalVotes > 0) {
    // Normalize effectiveness from [-1, 1] to [0, 1] then scale
    const normalizedEffectiveness = (principle.voting.effectiveness + 1) / 2;
    score += normalizedEffectiveness * 0.2;
  }
  
  // Category match bonus
  if (query.category && principle.category === query.category) {
    score += 0.15;
  }
  
  // Condition match bonus
  if (query.conditions && matchConditions(principle.conditions, query.conditions)) {
    score += 0.1;
  }
  
  // Status bonus (active > experimental > deprecated)
  if (principle.status === "active") score += 0.1;
  else if (principle.status === "experimental") score += 0.05;
  
  // Text similarity (simple keyword match)
  if (query.text) {
    const queryWords = query.text.toLowerCase().split(/\s+/);
    const principleWords = principle.content.toLowerCase().split(/\s+/);
    const matchCount = queryWords.filter(w => principleWords.some(pw => pw.includes(w))).length;
    score += (matchCount / queryWords.length) * 0.05;
  }
  
  return Math.min(1, score);
}

function getMatchReasons(principle: Principle, query: PrincipleQuery): string[] {
  const reasons: string[] = [];
  
  if (query.category && principle.category === query.category) {
    reasons.push(`Category match: ${principle.category}`);
  }
  
  if (query.conditions && matchConditions(principle.conditions, query.conditions)) {
    reasons.push("Conditions match");
  }
  
  if (principle.metadata.confidence >= 0.8) {
    reasons.push(`High confidence: ${(principle.metadata.confidence * 100).toFixed(0)}%`);
  }
  
  if (principle.evidence.successRate >= 0.7) {
    reasons.push(`High success rate: ${(principle.evidence.successRate * 100).toFixed(0)}%`);
  }
  
  // Add voting effectiveness information
  if (principle.voting && principle.voting.totalVotes > 0) {
    if (principle.voting.effectiveness >= 0.5) {
      reasons.push(`Highly effective: ${(principle.voting.effectiveness * 100).toFixed(0)}% (${principle.voting.helpful}/${principle.voting.harmful} helpful/harmful)`);
    } else if (principle.voting.effectiveness > 0) {
      reasons.push(`Positive voting: ${(principle.voting.effectiveness * 100).toFixed(0)}% effectiveness`);
    } else if (principle.voting.effectiveness < -0.3) {
      reasons.push(`Low effectiveness: needs review`);
    }
  }
  
  if (principle.status === "active") {
    reasons.push("Active principle");
  }
  
  return reasons;
}

function calculateStability(principle: Principle): number {
  // Stability is based on consistency of results
  const total = principle.evidence.totalApplications;
  if (total < 3) return 0.5;
  
  // More applications = more stable
  const applicationFactor = Math.min(1, total / 10);
  
  // Consistent results = more stable
  const successRate = principle.evidence.successRate;
  const consistencyFactor = successRate > 0.7 || successRate < 0.3 ? 0.9 : 0.6;
  
  return applicationFactor * consistencyFactor;
}

function evaluateStatus(principle: Principle): PrincipleStatus {
  // Experimental -> Active: Enough applications and good success rate
  if (principle.status === "experimental") {
    if (principle.evidence.totalApplications >= 3 && principle.evidence.successRate >= 0.6) {
      return "active";
    }
    return "experimental";
  }
  
  // Active -> Deprecated: Low success rate
  if (principle.status === "active") {
    if (principle.evidence.totalApplications >= 5 && principle.evidence.successRate < 0.3) {
      return "deprecated";
    }
    return "active";
  }
  
  return principle.status;
}

function mergeConditions(conditions: PrincipleConditions[]): PrincipleConditions {
  const merged: PrincipleConditions = {};
  
  // Take union of arrays
  const taskTypes = new Set<string>();
  const modules = new Set<string>();
  const tags = new Set<string>();
  
  for (const c of conditions) {
    if (c.taskTypes) c.taskTypes.forEach(t => taskTypes.add(t));
    if (c.modules) c.modules.forEach(m => modules.add(m));
    if (c.tags) c.tags.forEach(t => tags.add(t));
  }
  
  if (taskTypes.size > 0) merged.taskTypes = [...taskTypes];
  if (modules.size > 0) merged.modules = [...modules];
  if (tags.size > 0) merged.tags = [...tags];
  
  return merged;
}

/**
 * Format principle for display
 */
export function formatPrinciple(principle: Principle): string {
  const lines: string[] = [
    `📚 Principle: ${principle.id}`,
    `📁 Category: ${principle.category} | Status: ${principle.status}`,
    "",
    `💡 ${principle.content}`,
    "",
    `📊 Evidence:`,
    `   Success Rate: ${(principle.evidence.successRate * 100).toFixed(0)}%`,
    `   Applications: ${principle.evidence.totalApplications}`,
    `   Confidence: ${(principle.metadata.confidence * 100).toFixed(0)}%`,
  ];
  
  // Add voting information (ACE Pattern - Memory Voting)
  if (principle.voting) {
    lines.push("");
    lines.push(`🗳️ Voting (ACE Pattern):`);
    lines.push(`   Effectiveness: ${(principle.voting.effectiveness * 100).toFixed(0)}%`);
    lines.push(`   Helpful: ${principle.voting.helpful} | Harmful: ${principle.voting.harmful}`);
    lines.push(`   Total Votes: ${principle.voting.totalVotes}`);
  }
  
  if (principle.conditions.tags && principle.conditions.tags.length > 0) {
    lines.push("");
    lines.push(`🏷️ Tags: ${principle.conditions.tags.join(", ")}`);
  }
  
  if (principle.rationale) {
    lines.push("");
    lines.push(`🤔 Rationale: ${principle.rationale}`);
  }
  
  return lines.join("\n");
}

/**
 * Get principle library summary
 */
export function getPrincipleLibrarySummary(): string {
  const stats = getPrincipleStats();
  
  const lines: string[] = [
    "📚 Principle Library Summary",
    "",
    `Total Principles: ${stats.totalPrinciples}`,
    `  Active: ${stats.activePrinciples}`,
    `  Experimental: ${stats.experimentalPrinciples}`,
    `  Deprecated: ${stats.deprecatedPrinciples}`,
    "",
    `Average Confidence: ${(stats.avgConfidence * 100).toFixed(0)}%`,
    `Average Success Rate: ${(stats.avgSuccessRate * 100).toFixed(0)}%`,
    "",
    "🗳️ Voting Statistics (ACE Pattern):",
    `  Total Votes: ${stats.totalVotes}`,
    `  Average Effectiveness: ${(stats.avgEffectiveness * 100).toFixed(0)}%`,
    `  Highly Effective (>50%): ${stats.highlyEffective}`,
    `  Ineffective (<-30%): ${stats.ineffective}`,
    "",
    "By Category:",
  ];
  
  for (const [cat, count] of Object.entries(stats.byCategory)) {
    if (count > 0) {
      lines.push(`  ${cat}: ${count}`);
    }
  }
  
  return lines.join("\n");
}