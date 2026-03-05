/**
 * Principle Voting Module
 * 
 * Implements ACE Pattern (Aegis Memory 2026) Memory Voting innovation.
 * 
 * Core concept: Allow agent to vote on principle effectiveness,
 * creating quality signals to distinguish useful from useless principles.
 * 
 * Effectiveness Formula:
 *   effectiveness = (helpful - harmful) / (total + 1)
 * 
 * Range: [-1, 1]
 *   - 1.0: All votes are helpful (maximum effectiveness)
 *   - 0.0: Equal helpful/harmful votes, or no votes
 *   - -1.0: All votes are harmful (minimum effectiveness)
 * 
 * The +1 in denominator prevents division by zero and provides smoothing
 * for new principles with few votes.
 */

import {
  getPrinciple,
  getAllPrinciples,
  updatePrinciple,
  type Principle,
  type PrincipleVoting,
  type VoteRecord,
} from "./principle-store.js";
import { log } from "../util/log.js";

// ── Types (re-exported from principle-store for convenience) ─────────

export type { VoteRecord, PrincipleVoting };

/**
 * Vote type for principle effectiveness
 */
export type VoteType = "helpful" | "harmful" | "neutral";

/**
 * Context for voting
 */
export interface VotingContext {
  evolutionId: string;            // Evolution context for the vote
  reason?: string;                // Why this vote was cast
  agentId?: string;               // Agent identifier (for multi-agent scenarios)
  taskType?: string;              // Type of task being performed
  module?: string;                // Module being worked on
}

/**
 * Result of casting a vote
 */
export interface VoteResult {
  principleId: string;
  vote: VoteType;
  previousEffectiveness: number;
  newEffectiveness: number;
  totalVotes: number;
  helpful: number;
  harmful: number;
  statusChange?: "promoted" | "deprecated";  // If status changed due to voting
}

/**
 * Voting statistics for a principle
 */
export interface PrincipleVotingStats {
  principleId: string;
  summary: string;
  helpful: number;
  harmful: number;
  neutral: number;
  totalVotes: number;
  effectiveness: number;
  trend: "improving" | "declining" | "stable";
  lastVotedAt?: string;
}

/**
 * Voting review recommendation
 */
export interface VotingReviewRecommendation {
  principleId: string;
  summary: string;
  effectiveness: number;
  totalVotes: number;
  recommendation: "keep" | "review" | "deprecate";
  reason: string;
}

// ── Core Voting Functions ─────────────────────────────────────────────

/**
 * Calculate effectiveness from voting counts
 * 
 * Formula: effectiveness = (helpful - harmful) / (total + 1)
 * 
 * The +1 prevents division by zero and provides smoothing.
 */
export function calculateEffectiveness(helpful: number, harmful: number, neutral: number): number {
  const total = helpful + harmful + neutral;
  // +1 in denominator for smoothing (ACE Pattern innovation)
  const denominator = total + 1;
  const numerator = helpful - harmful;
  return numerator / denominator;
}

/**
 * Cast a vote on a principle's effectiveness
 * 
 * This is the main voting function that updates a principle's voting record
 * and recalculates its effectiveness score.
 */
export function voteOnPrinciple(
  principleId: string,
  vote: VoteType,
  context: VotingContext
): VoteResult | null {
  const principle = getPrinciple(principleId);
  
  if (!principle) {
    log.warn("Cannot vote on non-existent principle", { principleId });
    return null;
  }
  
  // Ensure voting object exists (for backwards compatibility)
  if (!principle.voting) {
    principle.voting = {
      helpful: 0,
      harmful: 0,
      totalVotes: 0,
      effectiveness: 0,
      voteHistory: [],
    };
  }
  
  const previousEffectiveness = principle.voting.effectiveness;
  const now = new Date().toISOString();
  
  // Create vote record
  const voteRecord: VoteRecord = {
    timestamp: now,
    evolutionId: context.evolutionId,
    vote,
    context: context.reason,
    agentId: context.agentId,
  };
  
  // Update vote counts
  principle.voting.totalVotes++;
  if (vote === "helpful") {
    principle.voting.helpful++;
  } else if (vote === "harmful") {
    principle.voting.harmful++;
  }
  // neutral doesn't affect helpful/harmful counts
  
  // Add to history
  principle.voting.voteHistory.push(voteRecord);
  principle.voting.lastVotedAt = now;
  
  // Recalculate effectiveness
  principle.voting.effectiveness = calculateEffectiveness(
    principle.voting.helpful,
    principle.voting.harmful,
    principle.voting.totalVotes - principle.voting.helpful - principle.voting.harmful
  );
  
  // Check for status change based on voting
  let statusChange: "promoted" | "deprecated" | undefined;
  
  if (principle.status === "experimental" && shouldPromoteByVoting(principle)) {
    updatePrinciple(principleId, { status: "active", voting: principle.voting });
    principle.status = "active";
    statusChange = "promoted";
    log.info("Principle promoted by voting", { principleId, effectiveness: principle.voting.effectiveness });
  } else if (principle.status === "active" && shouldDeprecateByVoting(principle)) {
    updatePrinciple(principleId, { status: "deprecated", voting: principle.voting });
    principle.status = "deprecated";
    statusChange = "deprecated";
    log.warn("Principle deprecated by voting", { principleId, effectiveness: principle.voting.effectiveness });
  } else {
    // Just update the voting field in storage
    updatePrincipleVoting(principle);
  }
  
  log.info("Vote cast on principle", {
    principleId,
    vote,
    newEffectiveness: principle.voting.effectiveness,
    totalVotes: principle.voting.totalVotes,
  });
  
  return {
    principleId,
    vote,
    previousEffectiveness,
    newEffectiveness: principle.voting.effectiveness,
    totalVotes: principle.voting.totalVotes,
    helpful: principle.voting.helpful,
    harmful: principle.voting.harmful,
    statusChange,
  };
}

/**
 * Vote on multiple principles at once (batch voting)
 */
export function voteOnPrinciples(
  votes: Array<{ principleId: string; vote: VoteType }>,
  context: VotingContext
): VoteResult[] {
  const results: VoteResult[] = [];
  
  for (const { principleId, vote } of votes) {
    const result = voteOnPrinciple(principleId, vote, context);
    if (result) {
      results.push(result);
    }
  }
  
  log.info("Batch voting complete", {
    totalVotes: votes.length,
    successfulVotes: results.length,
  });
  
  return results;
}

// ── Query Functions ───────────────────────────────────────────────────

/**
 * Get principles sorted by effectiveness (most effective first)
 */
export function getPrinciplesByEffectiveness(
  options: {
    minVotes?: number;       // Minimum votes to be considered
    status?: string;         // Filter by status
    limit?: number;          // Maximum results
  } = {}
): PrincipleVotingStats[] {
  const { minVotes = 0, status, limit = 20 } = options;
  
  const principles = getAllPrinciples();
  
  // Filter and transform
  const results: PrincipleVotingStats[] = [];
  
  for (const principle of principles) {
    // Status filter
    if (status && principle.status !== status) continue;
    
    // Ensure voting exists
    if (!principle.voting) continue;
    
    // Minimum votes filter
    if (principle.voting.totalVotes < minVotes) continue;
    
    // Calculate trend from recent votes
    const trend = calculateVotingTrend(principle.voting);
    
    results.push({
      principleId: principle.id,
      summary: principle.summary,
      helpful: principle.voting.helpful,
      harmful: principle.voting.harmful,
      neutral: principle.voting.totalVotes - principle.voting.helpful - principle.voting.harmful,
      totalVotes: principle.voting.totalVotes,
      effectiveness: principle.voting.effectiveness,
      trend,
      lastVotedAt: principle.voting.lastVotedAt,
    });
  }
  
  // Sort by effectiveness (descending)
  results.sort((a, b) => b.effectiveness - a.effectiveness);
  
  // Apply limit
  return results.slice(0, limit);
}

/**
 * Get voting statistics for a specific principle
 */
export function getVotingStats(principleId: string): PrincipleVotingStats | null {
  const principle = getPrinciple(principleId);
  
  if (!principle || !principle.voting) {
    return null;
  }
  
  const trend = calculateVotingTrend(principle.voting);
  
  return {
    principleId: principle.id,
    summary: principle.summary,
    helpful: principle.voting.helpful,
    harmful: principle.voting.harmful,
    neutral: principle.voting.totalVotes - principle.voting.helpful - principle.voting.harmful,
    totalVotes: principle.voting.totalVotes,
    effectiveness: principle.voting.effectiveness,
    trend,
    lastVotedAt: principle.voting.lastVotedAt,
  };
}

/**
 * Get review recommendations based on voting patterns
 */
export function getVotingReviewRecommendations(): VotingReviewRecommendation[] {
  const principles = getAllPrinciples();
  const recommendations: VotingReviewRecommendation[] = [];
  
  for (const principle of principles) {
    // Skip if no voting data
    if (!principle.voting || principle.voting.totalVotes === 0) continue;
    
    const { effectiveness, totalVotes } = principle.voting;
    
    let recommendation: "keep" | "review" | "deprecate";
    let reason: string;
    
    if (effectiveness >= 0.3) {
      recommendation = "keep";
      reason = `Strong positive signal: ${effectiveness.toFixed(2)} effectiveness`;
    } else if (effectiveness <= -0.3) {
      recommendation = "deprecate";
      reason = `Strong negative signal: ${effectiveness.toFixed(2)} effectiveness`;
    } else if (totalVotes >= 5 && effectiveness < 0) {
      recommendation = "review";
      reason = `Mixed signal with enough data: ${effectiveness.toFixed(2)} effectiveness, ${totalVotes} votes`;
    } else if (totalVotes < 3) {
      recommendation = "keep";
      reason = `Not enough data: only ${totalVotes} votes`;
    } else {
      recommendation = "review";
      reason = `Neutral signal: ${effectiveness.toFixed(2)} effectiveness`;
    }
    
    recommendations.push({
      principleId: principle.id,
      summary: principle.summary,
      effectiveness,
      totalVotes,
      recommendation,
      reason,
    });
  }
  
  // Sort by priority: deprecate first, then review, then keep
  const priorityOrder = { deprecate: 0, review: 1, keep: 2 };
  recommendations.sort((a, b) => {
    const priorityDiff = priorityOrder[a.recommendation] - priorityOrder[b.recommendation];
    if (priorityDiff !== 0) return priorityDiff;
    // Within same category, sort by effectiveness (lowest first)
    return a.effectiveness - b.effectiveness;
  });
  
  return recommendations;
}

// ── Analysis Functions ────────────────────────────────────────────────

/**
 * Analyze voting patterns across all principles
 */
export function analyzeVotingPatterns(): {
  totalPrinciplesWithVotes: number;
  avgEffectiveness: number;
  highlyEffective: number;    // effectiveness > 0.5
  needsReview: number;         // -0.3 < effectiveness < 0.3
  ineffective: number;         // effectiveness < -0.3
  votingDistribution: {
    helpful: number;
    harmful: number;
    neutral: number;
  };
} {
  const principles = getAllPrinciples();
  
  let withVotes = 0;
  let totalEffectiveness = 0;
  let highlyEffective = 0;
  let needsReview = 0;
  let ineffective = 0;
  let totalHelpful = 0;
  let totalHarmful = 0;
  let totalNeutral = 0;
  
  for (const principle of principles) {
    if (!principle.voting || principle.voting.totalVotes === 0) continue;
    
    withVotes++;
    totalEffectiveness += principle.voting.effectiveness;
    
    if (principle.voting.effectiveness > 0.5) highlyEffective++;
    else if (principle.voting.effectiveness < -0.3) ineffective++;
    else needsReview++;
    
    totalHelpful += principle.voting.helpful;
    totalHarmful += principle.voting.harmful;
    totalNeutral += principle.voting.totalVotes - principle.voting.helpful - principle.voting.harmful;
  }
  
  return {
    totalPrinciplesWithVotes: withVotes,
    avgEffectiveness: withVotes > 0 ? totalEffectiveness / withVotes : 0,
    highlyEffective,
    needsReview,
    ineffective,
    votingDistribution: {
      helpful: totalHelpful,
      harmful: totalHarmful,
      neutral: totalNeutral,
    },
  };
}

/**
 * Get top effective principles
 */
export function getTopEffectivePrinciples(limit: number = 10): PrincipleVotingStats[] {
  return getPrinciplesByEffectiveness({ minVotes: 3, limit });
}

/**
 * Get principles that need attention (low effectiveness)
 */
export function getPrinciplesNeedingAttention(limit: number = 10): PrincipleVotingStats[] {
  const principles = getAllPrinciples();
  
  const results: PrincipleVotingStats[] = [];
  
  for (const principle of principles) {
    if (!principle.voting || principle.voting.totalVotes === 0) continue;
    
    // Only include negative or very low effectiveness
    if (principle.voting.effectiveness >= 0) continue;
    
    results.push({
      principleId: principle.id,
      summary: principle.summary,
      helpful: principle.voting.helpful,
      harmful: principle.voting.harmful,
      neutral: principle.voting.totalVotes - principle.voting.helpful - principle.voting.harmful,
      totalVotes: principle.voting.totalVotes,
      effectiveness: principle.voting.effectiveness,
      trend: calculateVotingTrend(principle.voting),
      lastVotedAt: principle.voting.lastVotedAt,
    });
  }
  
  // Sort by effectiveness (lowest first)
  results.sort((a, b) => a.effectiveness - b.effectiveness);
  
  return results.slice(0, limit);
}

// ── Helper Functions ───────────────────────────────────────────────────

/**
 * Update voting field in storage
 */
function updatePrincipleVoting(principle: Principle): void {
  // Update the voting field in storage
  updatePrinciple(principle.id, { 
    voting: principle.voting 
  });
}

/**
 * Check if principle should be promoted based on voting
 */
function shouldPromoteByVoting(principle: Principle): boolean {
  if (!principle.voting) return false;
  
  // Need at least 3 votes
  if (principle.voting.totalVotes < 3) return false;
  
  // Effectiveness above 0.5 (strong positive signal)
  if (principle.voting.effectiveness < 0.5) return false;
  
  // More helpful than harmful
  if (principle.voting.helpful <= principle.voting.harmful) return false;
  
  return true;
}

/**
 * Check if principle should be deprecated based on voting
 */
function shouldDeprecateByVoting(principle: Principle): boolean {
  if (!principle.voting) return false;
  
  // Need at least 5 votes to deprecate (more conservative)
  if (principle.voting.totalVotes < 5) return false;
  
  // Effectiveness below -0.3 (clear negative signal)
  if (principle.voting.effectiveness > -0.3) return false;
  
  // More harmful than helpful
  if (principle.voting.harmful <= principle.voting.helpful) return false;
  
  return true;
}

/**
 * Calculate voting trend from vote history
 */
function calculateVotingTrend(voting: PrincipleVoting): "improving" | "declining" | "stable" {
  if (!voting.voteHistory || voting.voteHistory.length < 3) {
    return "stable";
  }
  
  // Look at last 5 votes
  const recentVotes = voting.voteHistory.slice(-5);
  
  let recentHelpful = 0;
  let recentHarmful = 0;
  
  for (const vote of recentVotes) {
    if (vote.vote === "helpful") recentHelpful++;
    else if (vote.vote === "harmful") recentHarmful++;
  }
  
  const recentEffectiveness = recentHelpful > 0 || recentHarmful > 0
    ? (recentHelpful - recentHarmful) / (recentVotes.length + 1)
    : 0;
  
  // Compare recent trend with overall effectiveness
  const overallEffectiveness = voting.effectiveness;
  const threshold = 0.2;
  
  if (recentEffectiveness > overallEffectiveness + threshold) {
    return "improving";
  } else if (recentEffectiveness < overallEffectiveness - threshold) {
    return "declining";
  }
  
  return "stable";
}

// ── Export convenience function for use in evolution ───────────────────

/**
 * Quick vote helper for use during evolution cycles
 * 
 * Usage in evolution context:
 *   voteOnPrincipleQuick("principle_123", "helpful", "#12", "Principle helped avoid bug")
 */
export function voteOnPrincipleQuick(
  principleId: string,
  vote: VoteType,
  evolutionId: string,
  reason?: string
): VoteResult | null {
  return voteOnPrinciple(principleId, vote, {
    evolutionId,
    reason,
  });
}

/**
 * Format voting stats for display
 */
export function formatVotingStats(stats: PrincipleVotingStats): string {
  const lines = [
    `📊 ${stats.summary}`,
    `   Effectiveness: ${(stats.effectiveness * 100).toFixed(0)}%`,
    `   Votes: ${stats.totalVotes} (👍 ${stats.helpful} | 👎 ${stats.harmful} | 😐 ${stats.neutral})`,
    `   Trend: ${stats.trend}`,
  ];
  
  if (stats.lastVotedAt) {
    lines.push(`   Last vote: ${new Date(stats.lastVotedAt).toLocaleDateString()}`);
  }
  
  return lines.join("\n");
}