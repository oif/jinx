/**
 * Metacognitive Learning Module
 * 
 * Based on "Position: Truly Self-Improving Agents Require Intrinsic Metacognitive Learning"
 * (arxiv 2506.05109)
 * 
 * Core components:
 * 1. Metacognitive Monitoring - Assess own reasoning process in real-time
 * 2. Knowledge Blind Spot Detection - Identify areas of uncertainty and missing knowledge
 * 3. Active Feedback Seeking - Generate targeted feedback requests
 * 4. Self-Evaluation Capability - Calibrate confidence and assess output quality
 * 
 * Key insight: Unlike post-hoc reflection (MARS-based), metacognition operates
 * during reasoning, enabling real-time self-correction and uncertainty management.
 */

import {
  encodeMemory,
  retrieveMemories,
} from "./graph.js";
import {
  loadEvolutionHistory,
} from "../consciousness/history.js";
import { ReflectionInsight } from "./reflection.js";
import { log } from "../util/log.js";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../supervisor/paths.js";

const METACOGNITIVE_PATH = join(DATA_DIR, "memory", "metacognitive.json");

// ── Configuration ──────────────────────────────────────────────────

const METACOGNITIVE_INTERVAL_CYCLES = 3; // Trigger metacognitive every N evolutions
const MIN_HISTORY_FOR_METACOGNITIVE = 1; // Minimum history entries needed for history-based trigger
const FORCED_METACOGNITIVE_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours - fallback time-based trigger
const MIN_MEMORY_NODES_FOR_METACOGNITIVE = 3; // Alternative trigger: minimum memory nodes

// ── Types ──────────────────────────────────────────────────────────

/**
 * Confidence calibration level for a knowledge area or decision.
 */
export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";

/**
 * Assessment of the reasoning process itself.
 */
export interface ReasoningAssessment {
  id: string;
  timestamp: string;
  context: string; // What was being reasoned about
  
  // Reasoning quality metrics
  clarity: number; // 0-1: How clear was the reasoning?
  completeness: number; // 0-1: Did it cover all aspects?
  consistency: number; // 0-1: Was reasoning internally consistent?
  
  // Uncertainty tracking
  uncertaintyAreas: string[]; // Parts where uncertainty was detected
  assumptions: string[]; // Assumptions made during reasoning
  alternativePaths: string[]; // Alternative approaches considered
  
  // Self-correction
  correctionsMade: string[]; // Corrections during reasoning
  flaggedIssues: string[]; // Issues that need attention
  
  // Overall confidence
  overallConfidence: ConfidenceLevel;
  confidenceScore: number; // 0-1
}

/**
 * A detected knowledge blind spot - an area where knowledge is lacking or uncertain.
 */
export interface KnowledgeBlindSpot {
  id: string;
  timestamp: string;
  category: string; // e.g., "testing", "architecture", "domain-knowledge"
  description: string; // What knowledge is missing/uncertain
  severity: "critical" | "high" | "medium" | "low";
  
  // Context of detection
  detectedDuring: string; // Activity that revealed the blind spot
  evidence: string[]; // Signs that this is a blind spot
  
  // Impact assessment
  impactOnCurrentTask: string; // How it affects current work
  impactOnFutureTasks: string; // Potential future impact
  
  // Resolution strategy
  resolutionStrategy: "learn" | "ask" | "avoid" | "mitigate";
  suggestedActions: string[];
  
  // Tracking
  resolved: boolean;
  resolvedAt?: string;
  resolutionNotes?: string;
}

/**
 * A request for feedback from the creator or external source.
 */
export interface FeedbackRequest {
  id: string;
  timestamp: string;
  priority: "urgent" | "high" | "medium" | "low";
  category: string;
  
  // What feedback is needed
  question: string; // The question to ask
  context: string; // Background information
  options?: string[]; // Possible choices if applicable
  
  // Why this feedback is needed
  reason: string; // Why can't this be resolved autonomously
  blindSpotId?: string; // Related knowledge blind spot
  
  // Status
  status: "pending" | "asked" | "answered" | "dismissed";
  askedAt?: string;
  answer?: string;
  answeredAt?: string;
}

/**
 * Self-evaluation of an output or decision.
 */
export interface SelfEvaluation {
  id: string;
  timestamp: string;
  evaluatedItem: string; // What was evaluated
  evaluatedItemType: "output" | "decision" | "plan" | "code";
  
  // Quality metrics
  qualityScore: number; // 0-1 overall quality
  dimensions: {
    correctness: number; // 0-1: Is it correct?
    completeness: number; // 0-1: Is it complete?
    efficiency: number; // 0-1: Is it efficient?
    maintainability: number; // 0-1: Can it be maintained?
    riskLevel: number; // 0-1: What's the risk of issues?
  };
  
  // Confidence calibration
  statedConfidence: number; // 0-1: How confident did I say I was
  calibratedConfidence: number; // 0-1: After calibration
  
  // Issues and strengths
  identifiedStrengths: string[];
  identifiedWeaknesses: string[];
  
  // Risk assessment
  risks: Array<{
    description: string;
    probability: number; // 0-1
    impact: number; // 0-1
    mitigation?: string;
  }>;
  
  // Improvement suggestions
  improvementSuggestions: string[];
}

/**
 * A metacognitive session capturing self-assessment during an activity.
 */
export interface MetacognitiveSession {
  id: string;
  timestamp: string;
  triggerReason: string; // What triggered this metacognitive session
  activityContext: string; // What activity was being performed
  
  // Core assessments
  reasoningAssessment?: ReasoningAssessment;
  blindSpotsDetected: KnowledgeBlindSpot[];
  feedbackRequests: FeedbackRequest[];
  selfEvaluation?: SelfEvaluation;
  
  // Metacognitive state
  cognitiveLoad: "low" | "medium" | "high" | "overloaded";
  uncertaintyLevel: number; // 0-1
  confidenceCalibration: number; // -1 to 1: overconfident (+) or underconfident (-)
  
  // Actions taken
  actionsTaken: string[]; // Actions resulting from metacognition
}

// ── Storage ────────────────────────────────────────────────────────

interface MetacognitiveData {
  sessions: MetacognitiveSession[];
  blindSpots: KnowledgeBlindSpot[];
  feedbackRequests: FeedbackRequest[];
  evaluations: SelfEvaluation[];
  stats: MetacognitiveStats;
}

interface MetacognitiveStats {
  totalSessions: number;
  totalBlindSpotsDetected: number;
  resolvedBlindSpots: number;
  totalFeedbackRequests: number;
  answeredFeedbackRequests: number;
  avgConfidenceCalibration: number;
  lastSessionAt?: string;
}

function loadMetacognitiveData(): MetacognitiveData {
  try {
    if (existsSync(METACOGNITIVE_PATH)) {
      return JSON.parse(readFileSync(METACOGNITIVE_PATH, "utf-8"));
    }
  } catch (e) {
    log.warn("Failed to load metacognitive data", { error: (e as Error).message });
  }
  return {
    sessions: [],
    blindSpots: [],
    feedbackRequests: [],
    evaluations: [],
    stats: {
      totalSessions: 0,
      totalBlindSpotsDetected: 0,
      resolvedBlindSpots: 0,
      totalFeedbackRequests: 0,
      answeredFeedbackRequests: 0,
      avgConfidenceCalibration: 0,
    },
  };
}

function saveMetacognitiveData(data: MetacognitiveData): void {
  try {
    if (!existsSync(join(DATA_DIR, "memory"))) {
      writeFileSync(join(DATA_DIR, "memory", ".gitkeep"), "");
    }
    // Keep only last 50 sessions to prevent unbounded growth
    if (data.sessions.length > 50) {
      data.sessions = data.sessions.slice(-50);
    }
    writeFileSync(METACOGNITIVE_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    log.error("Failed to save metacognitive data", { error: (e as Error).message });
  }
}

// ── ID Generation ───────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

// ── Core Metacognitive Functions ────────────────────────────────────

/**
 * Assess the reasoning process for a given context.
 * This is called DURING reasoning, not after.
 */
export function assessReasoningProcess(
  context: string,
  reasoning: {
    steps: string[];
    assumptions: string[];
    uncertainties: string[];
    alternatives?: string[];
  }
): ReasoningAssessment {
  const now = new Date().toISOString();
  
  // Analyze reasoning quality
  const clarity = analyzeClarity(reasoning.steps);
  const completeness = analyzeCompleteness(reasoning.steps, context);
  const consistency = analyzeConsistency(reasoning.steps);
  
  // Determine overall confidence
  const uncertaintyPenalty = reasoning.uncertainties.length * 0.1;
  const assumptionRisk = reasoning.assumptions.length * 0.05;
  const confidenceScore = Math.max(0, Math.min(1, 
    (clarity + completeness + consistency) / 3 - uncertaintyPenalty - assumptionRisk
  ));
  
  const overallConfidence: ConfidenceLevel = 
    confidenceScore >= 0.8 ? "high" :
    confidenceScore >= 0.5 ? "medium" :
    confidenceScore >= 0.2 ? "low" : "unknown";
  
  return {
    id: generateId("reas"),
    timestamp: now,
    context,
    clarity,
    completeness,
    consistency,
    uncertaintyAreas: reasoning.uncertainties,
    assumptions: reasoning.assumptions,
    alternativePaths: reasoning.alternatives || [],
    correctionsMade: [],
    flaggedIssues: reasoning.uncertainties.length > 3 ? 
      ["High uncertainty count detected"] : [],
    overallConfidence,
    confidenceScore,
  };
}

/**
 * Detect knowledge blind spots from recent activity and history.
 */
export function detectKnowledgeBlindSpots(
  context: {
    activity: string;
    errors?: string[];
    knowledgeGaps?: string[];
    uncertainDecisions?: string[];
  }
): KnowledgeBlindSpot[] {
  const now = new Date().toISOString();
  const blindSpots: KnowledgeBlindSpot[] = [];
  
  // Analyze errors for patterns indicating knowledge gaps
  if (context.errors && context.errors.length > 0) {
    for (const error of context.errors) {
      const category = inferBlindSpotCategory(error);
      blindSpots.push({
        id: generateId("blind"),
        timestamp: now,
        category,
        description: `Knowledge gap revealed by error: ${error.slice(0, 100)}`,
        severity: error.includes("critical") || error.includes("fatal") ? "critical" : "high",
        detectedDuring: context.activity,
        evidence: [error],
        impactOnCurrentTask: "May block progress until resolved",
        impactOnFutureTasks: "Could cause similar issues",
        resolutionStrategy: "learn",
        suggestedActions: [
          "Research the error domain",
          "Consult documentation",
          "Ask creator for guidance",
        ],
        resolved: false,
      });
    }
  }
  
  // Analyze explicit knowledge gaps
  if (context.knowledgeGaps) {
    for (const gap of context.knowledgeGaps) {
      blindSpots.push({
        id: generateId("blind"),
        timestamp: now,
        category: "domain-knowledge",
        description: gap,
        severity: "medium",
        detectedDuring: context.activity,
        evidence: [`Self-identified knowledge gap: ${gap}`],
        impactOnCurrentTask: "May limit solution quality",
        impactOnFutureTasks: "Could benefit multiple areas",
        resolutionStrategy: "learn",
        suggestedActions: [
          "Research this topic",
          "Add to knowledge base",
        ],
        resolved: false,
      });
    }
  }
  
  // Analyze uncertain decisions
  if (context.uncertainDecisions && context.uncertainDecisions.length > 0) {
    for (const decision of context.uncertainDecisions) {
      blindSpots.push({
        id: generateId("blind"),
        timestamp: now,
        category: "decision-making",
        description: `Uncertainty in decision: ${decision}`,
        severity: "medium",
        detectedDuring: context.activity,
        evidence: [`Decision made with uncertainty: ${decision}`],
        impactOnCurrentTask: "Decision may need revision",
        impactOnFutureTasks: "Could affect similar decisions",
        resolutionStrategy: "ask",
        suggestedActions: [
          "Seek feedback on this decision",
          "Consider alternatives",
        ],
        resolved: false,
      });
    }
  }
  
  return blindSpots;
}

/**
 * Generate feedback requests based on blind spots and uncertainty.
 */
export function generateFeedbackRequests(
  blindSpots: KnowledgeBlindSpot[],
  pendingDecisions?: string[]
): FeedbackRequest[] {
  const now = new Date().toISOString();
  const requests: FeedbackRequest[] = [];
  
  // Generate requests for critical blind spots
  const criticalBlindSpots = blindSpots.filter(
    bs => bs.severity === "critical" && bs.resolutionStrategy === "ask"
  );
  
  for (const bs of criticalBlindSpots) {
    requests.push({
      id: generateId("fb"),
      timestamp: now,
      priority: "urgent",
      category: bs.category,
      question: `I need guidance on: ${bs.description}`,
      context: `Detected during: ${bs.detectedDuring}. Evidence: ${bs.evidence.join("; ")}`,
      reason: "Critical knowledge gap that blocks progress",
      blindSpotId: bs.id,
      status: "pending",
    });
  }
  
  // Generate requests for high-severity blind spots
  const highBlindSpots = blindSpots.filter(
    bs => bs.severity === "high" && bs.resolutionStrategy === "ask"
  );
  
  for (const bs of highBlindSpots.slice(0, 2)) { // Limit to 2 high-priority
    requests.push({
      id: generateId("fb"),
      timestamp: now,
      priority: "high",
      category: bs.category,
      question: `Could you clarify: ${bs.description}?`,
      context: `Context: ${bs.detectedDuring}`,
      reason: "High-impact knowledge gap affecting work quality",
      blindSpotId: bs.id,
      status: "pending",
    });
  }
  
  // Generate requests for pending decisions
  if (pendingDecisions) {
    for (const decision of pendingDecisions.slice(0, 2)) {
      requests.push({
        id: generateId("fb"),
        timestamp: now,
        priority: "medium",
        category: "decision",
        question: decision,
        context: "Seeking input on this decision",
        reason: "Multiple valid options exist; external input valued",
        status: "pending",
      });
    }
  }
  
  return requests;
}

/**
 * Self-evaluate an output or decision.
 */
export function selfEvaluateOutput(
  item: string,
  itemType: SelfEvaluation["evaluatedItemType"],
  criteria: {
    statedConfidence?: number;
    checkCorrectness?: boolean;
    checkCompleteness?: boolean;
    checkEfficiency?: boolean;
    checkMaintainability?: boolean;
  }
): SelfEvaluation {
  const now = new Date().toISOString();
  
  // Analyze dimensions
  const dimensions = {
    correctness: criteria.checkCorrectness !== false ? 
      evaluateCorrectness(item) : 0.7,
    completeness: criteria.checkCompleteness !== false ? 
      evaluateCompleteness(item) : 0.7,
    efficiency: criteria.checkEfficiency !== false ? 
      evaluateEfficiency(item) : 0.6,
    maintainability: criteria.checkMaintainability !== false ? 
      evaluateMaintainability(item) : 0.6,
    riskLevel: assessRiskLevel(item),
  };
  
  // Calculate overall quality
  const qualityScore = (
    dimensions.correctness * 0.3 +
    dimensions.completeness * 0.25 +
    dimensions.efficiency * 0.2 +
    dimensions.maintainability * 0.15 +
    (1 - dimensions.riskLevel) * 0.1
  );
  
  // Confidence calibration
  const statedConfidence = criteria.statedConfidence ?? 0.7;
  const calibratedConfidence = calibrateConfidence(
    statedConfidence,
    qualityScore,
    dimensions
  );
  
  // Identify strengths and weaknesses
  const identifiedStrengths: string[] = [];
  const identifiedWeaknesses: string[] = [];
  
  if (dimensions.correctness >= 0.8) {
    identifiedStrengths.push("High correctness score");
  } else if (dimensions.correctness < 0.5) {
    identifiedWeaknesses.push("Potential correctness issues");
  }
  
  if (dimensions.completeness >= 0.8) {
    identifiedStrengths.push("Comprehensive coverage");
  } else if (dimensions.completeness < 0.5) {
    identifiedWeaknesses.push("Incomplete coverage");
  }
  
  if (dimensions.efficiency < 0.5) {
    identifiedWeaknesses.push("May be inefficient");
  }
  
  if (dimensions.maintainability < 0.5) {
    identifiedWeaknesses.push("May be hard to maintain");
  }
  
  if (dimensions.riskLevel > 0.5) {
    identifiedWeaknesses.push("Elevated risk level");
  }
  
  // Generate risks
  const risks = generateRisks(item, dimensions);
  
  // Generate improvement suggestions
  const improvementSuggestions = generateImprovementSuggestions(
    item,
    itemType,
    dimensions,
    identifiedWeaknesses
  );
  
  return {
    id: generateId("eval"),
    timestamp: now,
    evaluatedItem: item.slice(0, 500),
    evaluatedItemType: itemType,
    qualityScore,
    dimensions,
    statedConfidence,
    calibratedConfidence,
    identifiedStrengths,
    identifiedWeaknesses,
    risks,
    improvementSuggestions,
  };
}

/**
 * Run a complete metacognitive session.
 */
export function runMetacognitiveSession(
  context: {
    activity: string;
    reasoning?: {
      steps: string[];
      assumptions: string[];
      uncertainties: string[];
      alternatives?: string[];
    };
    errors?: string[];
    knowledgeGaps?: string[];
    uncertainDecisions?: string[];
    outputToEvaluate?: string;
    outputType?: SelfEvaluation["evaluatedItemType"];
    statedConfidence?: number;
  }
): MetacognitiveSession {
  const now = new Date().toISOString();
  const sessionId = generateId("meta");
  
  log.info("Starting metacognitive session", { 
    id: sessionId, 
    activity: context.activity.slice(0, 50) 
  });
  
  // 1. Assess reasoning if provided
  let reasoningAssessment: ReasoningAssessment | undefined;
  if (context.reasoning) {
    reasoningAssessment = assessReasoningProcess(
      context.activity,
      context.reasoning
    );
  }
  
  // 2. Detect blind spots
  const blindSpotsDetected = detectKnowledgeBlindSpots(context);
  
  // 3. Generate feedback requests
  const feedbackRequests = generateFeedbackRequests(blindSpotsDetected);
  
  // 4. Self-evaluate output if provided
  let selfEvaluation: SelfEvaluation | undefined;
  if (context.outputToEvaluate && context.outputType) {
    selfEvaluation = selfEvaluateOutput(
      context.outputToEvaluate,
      context.outputType,
      { statedConfidence: context.statedConfidence }
    );
  }
  
  // 5. Determine cognitive load
  const cognitiveLoad = assessCognitiveLoad(
    context.reasoning?.steps.length || 0,
    context.errors?.length || 0,
    blindSpotsDetected.length
  );
  
  // 6. Calculate uncertainty level
  const uncertaintyLevel = calculateUncertaintyLevel(
    reasoningAssessment,
    blindSpotsDetected,
    selfEvaluation
  );
  
  // 7. Determine actions
  const actionsTaken = determineActions(
    blindSpotsDetected,
    feedbackRequests,
    selfEvaluation
  );
  
  // 8. Confidence calibration
  const confidenceCalibration = calculateConfidenceCalibration(
    reasoningAssessment,
    selfEvaluation
  );
  
  const session: MetacognitiveSession = {
    id: sessionId,
    timestamp: now,
    triggerReason: context.activity,
    activityContext: context.activity,
    reasoningAssessment,
    blindSpotsDetected,
    feedbackRequests,
    selfEvaluation,
    cognitiveLoad,
    uncertaintyLevel,
    confidenceCalibration,
    actionsTaken,
  };
  
  // Save session
  const data = loadMetacognitiveData();
  data.sessions.push(session);
  data.blindSpots.push(...blindSpotsDetected);
  data.feedbackRequests.push(...feedbackRequests);
  if (selfEvaluation) {
    data.evaluations.push(selfEvaluation);
  }
  
  // Update stats
  data.stats.totalSessions++;
  data.stats.totalBlindSpotsDetected += blindSpotsDetected.length;
  data.stats.totalFeedbackRequests += feedbackRequests.length;
  data.stats.lastSessionAt = now;
  
  // Calculate average confidence calibration
  const allEvals = data.evaluations;
  if (allEvals.length > 0) {
    data.stats.avgConfidenceCalibration = 
      allEvals.reduce((sum, e) => sum + e.calibratedConfidence, 0) / allEvals.length;
  }
  
  saveMetacognitiveData(data);
  
  // Store significant blind spots to memory graph
  for (const bs of blindSpotsDetected.filter(b => b.severity === "critical" || b.severity === "high")) {
    try {
      encodeMemory({
        type: "experience",
        content: `[Knowledge Blind Spot] ${bs.category}: ${bs.description}\n\nContext: ${bs.detectedDuring}\nSuggested: ${bs.suggestedActions.join("; ")}`,
        importance: bs.severity === "critical" ? 0.9 : 0.7,
        confidence: 0.8,
        tags: ["blind-spot", bs.category, bs.severity],
        metadata: {
          blindSpotId: bs.id,
          resolutionStrategy: bs.resolutionStrategy,
        },
      });
    } catch (e) {
      log.warn("Failed to store blind spot to memory", { error: (e as Error).message });
    }
  }
  
  log.info("Metacognitive session completed", {
    id: sessionId,
    blindSpots: blindSpotsDetected.length,
    feedbackRequests: feedbackRequests.length,
    cognitiveLoad,
    uncertaintyLevel,
  });
  
  return session;
}

// ── Helper Functions ───────────────────────────────────────────────

function analyzeClarity(steps: string[]): number {
  if (steps.length === 0) return 0.3;
  
  // Check for clear, structured reasoning
  const avgLength = steps.reduce((sum, s) => sum + s.length, 0) / steps.length;
  const hasStructure = steps.some(s => 
    s.includes("because") || 
    s.includes("therefore") || 
    s.includes("since") ||
    s.includes("however")
  );
  
  let score = 0.5;
  
  // Longer explanations tend to be more detailed
  if (avgLength > 50) score += 0.1;
  if (avgLength > 100) score += 0.1;
  
  // Structured reasoning is clearer
  if (hasStructure) score += 0.2;
  
  // Very few steps might indicate incomplete reasoning
  if (steps.length < 2) score -= 0.2;
  
  // Good number of steps indicates thorough reasoning
  if (steps.length >= 3 && steps.length <= 7) score += 0.1;
  
  return Math.max(0, Math.min(1, score));
}

function analyzeCompleteness(steps: string[], context: string): number {
  if (steps.length === 0) return 0.2;
  
  // Check if reasoning covers the context
  const contextWords = new Set(
    context.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  );
  
  let coverage = 0;
  for (const word of contextWords) {
    if (steps.some(s => s.toLowerCase().includes(word))) {
      coverage++;
    }
  }
  
  const coverageRatio = contextWords.size > 0 ? coverage / contextWords.size : 0.5;
  
  // Base completeness on coverage and step count
  let score = 0.3 + coverageRatio * 0.4;
  
  // Bonus for multiple perspectives
  if (steps.length >= 3) score += 0.15;
  if (steps.length >= 5) score += 0.1;
  
  return Math.max(0, Math.min(1, score));
}

function analyzeConsistency(steps: string[]): number {
  if (steps.length < 2) return 0.8; // Single step is trivially consistent
  
  // Check for contradictions
  const contradictionMarkers = [
    ["but", "however"],
    ["on the other hand", "conversely"],
    ["although", "despite"],
  ];
  
  let contradictionCount = 0;
  for (const [marker1, marker2] of contradictionMarkers) {
    if (steps.some(s => s.toLowerCase().includes(marker1)) &&
        steps.some(s => s.toLowerCase().includes(marker2))) {
      // This might be a structured comparison, not necessarily a contradiction
      // Just note it
      contradictionCount++;
    }
  }
  
  // Minor penalty for potential contradictions
  const score = 1 - (contradictionCount * 0.1);
  
  return Math.max(0.5, Math.min(1, score));
}

function inferBlindSpotCategory(text: string): string {
  const lower = text.toLowerCase();
  
  if (lower.includes("test") || lower.includes("assert")) return "testing";
  if (lower.includes("api") || lower.includes("endpoint")) return "api";
  if (lower.includes("database") || lower.includes("query")) return "database";
  if (lower.includes("auth") || lower.includes("security")) return "security";
  if (lower.includes("performance") || lower.includes("slow")) return "performance";
  if (lower.includes("config") || lower.includes("setting")) return "configuration";
  if (lower.includes("type") || lower.includes("typescript")) return "typescript";
  if (lower.includes("import") || lower.includes("module")) return "modules";
  if (lower.includes("async") || lower.includes("promise")) return "async";
  
  return "domain-knowledge";
}

function evaluateCorrectness(item: string): number {
  // Heuristic evaluation based on common indicators
  let score = 0.7; // Base assumption of reasonable correctness
  
  const lower = item.toLowerCase();
  
  // Positive indicators
  if (lower.includes("test") || lower.includes("verify")) score += 0.1;
  if (lower.includes("check") || lower.includes("validate")) score += 0.05;
  if (lower.includes("error") && lower.includes("handle")) score += 0.1;
  
  // Negative indicators
  if (lower.includes("todo") || lower.includes("fixme")) score -= 0.2;
  if (lower.includes("hack") || lower.includes("workaround")) score -= 0.15;
  if (lower.includes("maybe") || lower.includes("probably")) score -= 0.1;
  
  return Math.max(0, Math.min(1, score));
}

function evaluateCompleteness(item: string): number {
  let score = 0.6;
  
  // Check for completeness indicators
  if (item.length < 50) score -= 0.2;
  if (item.length > 200) score += 0.1;
  
  // Look for coverage of different aspects
  const sections = item.split(/\n\n+/).length;
  if (sections >= 3) score += 0.1;
  
  // Check for specific completeness markers
  const lower = item.toLowerCase();
  if (lower.includes("complete") || lower.includes("all")) score += 0.05;
  if (lower.includes("partial") || lower.includes("some")) score -= 0.1;
  
  return Math.max(0, Math.min(1, score));
}

function evaluateEfficiency(item: string): number {
  let score = 0.6;
  
  const lower = item.toLowerCase();
  
  // Efficiency indicators
  if (lower.includes("optimize") || lower.includes("efficient")) score += 0.1;
  if (lower.includes("cache") || lower.includes("lazy")) score += 0.1;
  
  // Inefficiency indicators
  if (lower.includes("loop") && lower.includes("loop")) score -= 0.1; // Nested loops
  if (lower.includes("copy") && lower.includes("all")) score -= 0.05;
  
  return Math.max(0, Math.min(1, score));
}

function evaluateMaintainability(item: string): number {
  let score = 0.6;
  
  const lower = item.toLowerCase();
  
  // Maintainability indicators
  if (lower.includes("comment") || lower.includes("document")) score += 0.1;
  if (lower.includes("clear") || lower.includes("readable")) score += 0.1;
  if (lower.includes("modular") || lower.includes("separate")) score += 0.1;
  
  // Unmaintainable indicators
  if (lower.includes("hack")) score -= 0.2;
  if (lower.includes("magic number")) score -= 0.1;
  if (lower.includes("hardcode")) score -= 0.15;
  
  return Math.max(0, Math.min(1, score));
}

function assessRiskLevel(item: string): number {
  let risk = 0.2; // Base low risk
  
  const lower = item.toLowerCase();
  
  // Risk factors
  if (lower.includes("delete") || lower.includes("remove")) risk += 0.2;
  if (lower.includes("modify") || lower.includes("change")) risk += 0.1;
  if (lower.includes("production") || lower.includes("live")) risk += 0.15;
  if (lower.includes("critical") || lower.includes("important")) risk += 0.15;
  if (lower.includes("security") || lower.includes("auth")) risk += 0.1;
  
  // Risk mitigators
  if (lower.includes("backup")) risk -= 0.1;
  if (lower.includes("test")) risk -= 0.1;
  if (lower.includes("verify")) risk -= 0.05;
  
  return Math.max(0, Math.min(1, risk));
}

function calibrateConfidence(
  stated: number,
  quality: number,
  dimensions: SelfEvaluation["dimensions"]
): number {
  // Calibration adjusts confidence based on actual quality metrics
  // If stated confidence is much higher than quality, calibrate down
  // If stated confidence is much lower, calibrate up
  
  const qualityDiff = quality - stated;
  
  // Apply partial calibration (don't fully adjust in one step)
  const calibrationFactor = 0.5;
  const calibrated = stated + qualityDiff * calibrationFactor;
  
  // Also consider risk level
  const riskAdjustment = -dimensions.riskLevel * 0.1;
  
  return Math.max(0, Math.min(1, calibrated + riskAdjustment));
}

function generateRisks(
  item: string,
  dimensions: SelfEvaluation["dimensions"]
): SelfEvaluation["risks"] {
  const risks: SelfEvaluation["risks"] = [];
  
  if (dimensions.correctness < 0.6) {
    risks.push({
      description: "Output may have correctness issues",
      probability: 1 - dimensions.correctness,
      impact: 0.8,
      mitigation: "Additional verification recommended",
    });
  }
  
  if (dimensions.completeness < 0.6) {
    risks.push({
      description: "Output may be incomplete",
      probability: 1 - dimensions.completeness,
      impact: 0.6,
      mitigation: "Consider edge cases",
    });
  }
  
  if (dimensions.riskLevel > 0.5) {
    risks.push({
      description: "Elevated risk level detected",
      probability: dimensions.riskLevel,
      impact: 0.7,
      mitigation: "Proceed with caution, have rollback plan",
    });
  }
  
  return risks;
}

function generateImprovementSuggestions(
  item: string,
  itemType: SelfEvaluation["evaluatedItemType"],
  dimensions: SelfEvaluation["dimensions"],
  _weaknesses: string[]
): string[] {
  const suggestions: string[] = [];
  
  if (dimensions.correctness < 0.7) {
    suggestions.push("Add verification steps to ensure correctness");
  }
  
  if (dimensions.completeness < 0.7) {
    suggestions.push("Review for missing edge cases or scenarios");
  }
  
  if (dimensions.efficiency < 0.5) {
    suggestions.push("Consider optimization opportunities");
  }
  
  if (dimensions.maintainability < 0.5) {
    suggestions.push("Add documentation and improve code clarity");
  }
  
  if (dimensions.riskLevel > 0.5) {
    suggestions.push("Add safeguards and rollback mechanisms");
  }
  
  // Type-specific suggestions
  if (itemType === "code") {
    if (!item.includes("test") && dimensions.correctness < 0.8) {
      suggestions.push("Add unit tests");
    }
  }
  
  return suggestions;
}

function assessCognitiveLoad(
  reasoningSteps: number,
  errorCount: number,
  blindSpotCount: number
): "low" | "medium" | "high" | "overloaded" {
  const load = reasoningSteps * 0.1 + errorCount * 0.2 + blindSpotCount * 0.15;
  
  if (load >= 1.0) return "overloaded";
  if (load >= 0.7) return "high";
  if (load >= 0.4) return "medium";
  return "low";
}

function calculateUncertaintyLevel(
  reasoning?: ReasoningAssessment,
  blindSpots?: KnowledgeBlindSpot[],
  evaluation?: SelfEvaluation
): number {
  let uncertainty = 0.3; // Base uncertainty
  
  if (reasoning) {
    uncertainty += (1 - reasoning.confidenceScore) * 0.3;
    uncertainty += reasoning.uncertaintyAreas.length * 0.05;
  }
  
  if (blindSpots) {
    for (const bs of blindSpots) {
      if (bs.severity === "critical") uncertainty += 0.15;
      else if (bs.severity === "high") uncertainty += 0.1;
      else uncertainty += 0.05;
    }
  }
  
  if (evaluation) {
    uncertainty += (1 - evaluation.qualityScore) * 0.2;
    uncertainty += evaluation.risks.length * 0.03;
  }
  
  return Math.max(0, Math.min(1, uncertainty));
}

function calculateConfidenceCalibration(
  reasoning?: ReasoningAssessment,
  evaluation?: SelfEvaluation
): number {
  // Returns a value from -1 (underconfident) to +1 (overconfident)
  // 0 means well-calibrated
  
  if (!reasoning && !evaluation) return 0;
  
  let calibration = 0;
  let count = 0;
  
  if (reasoning) {
    // Compare stated confidence with actual assessment
    const diff = reasoning.confidenceScore - 0.5; // Expected baseline
    calibration += diff;
    count++;
  }
  
  if (evaluation) {
    // Compare stated vs calibrated confidence
    const diff = evaluation.statedConfidence - evaluation.calibratedConfidence;
    calibration += diff;
    count++;
  }
  
  return count > 0 ? calibration / count : 0;
}

function determineActions(
  blindSpots: KnowledgeBlindSpot[],
  feedbackRequests: FeedbackRequest[],
  evaluation?: SelfEvaluation
): string[] {
  const actions: string[] = [];
  
  // Actions for blind spots
  const criticalBlindSpots = blindSpots.filter(bs => bs.severity === "critical");
  if (criticalBlindSpots.length > 0) {
    actions.push(`Address ${criticalBlindSpots.length} critical knowledge gap(s)`);
  }
  
  // Actions for feedback
  const urgentFeedback = feedbackRequests.filter(fr => fr.priority === "urgent");
  if (urgentFeedback.length > 0) {
    actions.push(`Request urgent feedback on ${urgentFeedback.length} item(s)`);
  }
  
  // Actions for quality improvements
  if (evaluation && evaluation.qualityScore < 0.7) {
    actions.push("Improve output quality based on self-evaluation");
    if (evaluation.improvementSuggestions.length > 0) {
      actions.push(`Apply improvement: ${evaluation.improvementSuggestions[0]}`);
    }
  }
  
  // If no specific actions, note the metacognitive state
  if (actions.length === 0) {
    actions.push("Continue with current approach; no adjustments needed");
  }
  
  return actions;
}

// ── Query Functions ────────────────────────────────────────────────

/**
 * Get recent metacognitive sessions.
 */
export function getRecentSessions(limit: number = 5): MetacognitiveSession[] {
  const data = loadMetacognitiveData();
  return data.sessions.slice(-limit);
}

/**
 * Get unresolved blind spots.
 */
export function getUnresolvedBlindSpots(): KnowledgeBlindSpot[] {
  const data = loadMetacognitiveData();
  return data.blindSpots.filter(bs => !bs.resolved);
}

/**
 * Get pending feedback requests.
 */
export function getPendingFeedbackRequests(): FeedbackRequest[] {
  const data = loadMetacognitiveData();
  return data.feedbackRequests.filter(fr => fr.status === "pending");
}

/**
 * Mark a blind spot as resolved.
 */
export function resolveBlindSpot(
  blindSpotId: string,
  resolutionNotes: string
): boolean {
  const data = loadMetacognitiveData();
  const bs = data.blindSpots.find(b => b.id === blindSpotId);
  
  if (bs) {
    bs.resolved = true;
    bs.resolvedAt = new Date().toISOString();
    bs.resolutionNotes = resolutionNotes;
    data.stats.resolvedBlindSpots++;
    saveMetacognitiveData(data);
    return true;
  }
  
  return false;
}

/**
 * Mark a feedback request as asked.
 */
export function markFeedbackAsked(feedbackId: string): boolean {
  const data = loadMetacognitiveData();
  const fr = data.feedbackRequests.find(f => f.id === feedbackId);
  
  if (fr) {
    fr.status = "asked";
    fr.askedAt = new Date().toISOString();
    saveMetacognitiveData(data);
    return true;
  }
  
  return false;
}

/**
 * Record a feedback answer.
 */
export function recordFeedbackAnswer(
  feedbackId: string,
  answer: string
): boolean {
  const data = loadMetacognitiveData();
  const fr = data.feedbackRequests.find(f => f.id === feedbackId);
  
  if (fr) {
    fr.status = "answered";
    fr.answer = answer;
    fr.answeredAt = new Date().toISOString();
    data.stats.answeredFeedbackRequests++;
    saveMetacognitiveData(data);
    
    // Also resolve related blind spot if exists
    if (fr.blindSpotId) {
      resolveBlindSpot(fr.blindSpotId, `Resolved via feedback: ${answer}`);
    }
    
    return true;
  }
  
  return false;
}

/**
 * Get metacognitive statistics.
 */
export function getMetacognitiveStats(): MetacognitiveStats {
  const data = loadMetacognitiveData();
  return data.stats;
}

/**
 * Format a metacognitive session for display.
 */
export function formatMetacognitiveReport(session: MetacognitiveSession): string {
  const lines: string[] = [
    `🧠 Metacognitive Session: ${session.id}`,
    `📅 ${new Date(session.timestamp).toLocaleString()}`,
    `🎯 Context: ${session.activityContext.slice(0, 100)}...`,
    "",
    `📊 Metacognitive State:`,
    `  Cognitive Load: ${session.cognitiveLoad}`,
    `  Uncertainty Level: ${(session.uncertaintyLevel * 100).toFixed(0)}%`,
    `  Confidence Calibration: ${session.confidenceCalibration > 0 ? "overconfident" : session.confidenceCalibration < 0 ? "underconfident" : "well-calibrated"}`,
    "",
  ];
  
  if (session.reasoningAssessment) {
    lines.push("🔍 Reasoning Assessment:");
    lines.push(`  Clarity: ${(session.reasoningAssessment.clarity * 100).toFixed(0)}%`);
    lines.push(`  Completeness: ${(session.reasoningAssessment.completeness * 100).toFixed(0)}%`);
    lines.push(`  Consistency: ${(session.reasoningAssessment.consistency * 100).toFixed(0)}%`);
    lines.push(`  Overall Confidence: ${session.reasoningAssessment.overallConfidence}`);
    
    if (session.reasoningAssessment.uncertaintyAreas.length > 0) {
      lines.push(`  Uncertainties: ${session.reasoningAssessment.uncertaintyAreas.slice(0, 3).join(", ")}`);
    }
    lines.push("");
  }
  
  if (session.blindSpotsDetected.length > 0) {
    lines.push(`🚫 Blind Spots Detected (${session.blindSpotsDetected.length}):`);
    for (const bs of session.blindSpotsDetected.slice(0, 3)) {
      lines.push(`  [${bs.severity}] ${bs.category}: ${bs.description.slice(0, 50)}...`);
    }
    lines.push("");
  }
  
  if (session.feedbackRequests.length > 0) {
    lines.push(`❓ Feedback Requests (${session.feedbackRequests.length}):`);
    for (const fr of session.feedbackRequests.slice(0, 2)) {
      lines.push(`  [${fr.priority}] ${fr.question.slice(0, 60)}...`);
    }
    lines.push("");
  }
  
  if (session.selfEvaluation) {
    lines.push("📈 Self-Evaluation:");
    lines.push(`  Quality Score: ${(session.selfEvaluation.qualityScore * 100).toFixed(0)}%`);
    lines.push(`  Correctness: ${(session.selfEvaluation.dimensions.correctness * 100).toFixed(0)}%`);
    lines.push(`  Completeness: ${(session.selfEvaluation.dimensions.completeness * 100).toFixed(0)}%`);
    
    if (session.selfEvaluation.identifiedWeaknesses.length > 0) {
      lines.push(`  Weaknesses: ${session.selfEvaluation.identifiedWeaknesses.slice(0, 2).join(", ")}`);
    }
    lines.push("");
  }
  
  lines.push("✅ Actions Taken:");
  for (const action of session.actionsTaken) {
    lines.push(`  - ${action}`);
  }
  
  return lines.join("\n");
}

/**
 * Get a summary of metacognitive state for context.
 */
export function getMetacognitiveSummary(): string {
  const stats = getMetacognitiveStats();
  const unresolvedBlindSpots = getUnresolvedBlindSpots();
  const pendingFeedback = getPendingFeedbackRequests();
  
  const lines: string[] = [
    "🧠 Metacognitive State Summary:",
    `  Sessions: ${stats.totalSessions}`,
    `  Blind Spots: ${unresolvedBlindSpots.length} unresolved / ${stats.totalBlindSpotsDetected} total`,
    `  Feedback: ${pendingFeedback.length} pending / ${stats.answeredFeedbackRequests} answered`,
    `  Avg Confidence Calibration: ${stats.avgConfidenceCalibration.toFixed(2)}`,
  ];
  
  if (unresolvedBlindSpots.length > 0) {
    lines.push("");
    lines.push("⚠️ Active Blind Spots:");
    for (const bs of unresolvedBlindSpots.slice(0, 3)) {
      lines.push(`  [${bs.severity}] ${bs.category}: ${bs.description.slice(0, 40)}...`);
    }
  }
  
  if (pendingFeedback.length > 0) {
    lines.push("");
    lines.push("❓ Pending Feedback Requests:");
    for (const fr of pendingFeedback.slice(0, 2)) {
      lines.push(`  [${fr.priority}] ${fr.question.slice(0, 50)}...`);
    }
  }
  
  return lines.join("\n");
}

/**
 * Integrate metacognitive assessment into reflection insights.
 * This bridges the MARS-based reflection with metacognitive capabilities.
 */
export function integrateMetacognitiveInsights(
  existingInsights: ReflectionInsight[]
): ReflectionInsight[] {
  const now = new Date().toISOString();
  const newInsights: ReflectionInsight[] = [...existingInsights];
  
  // Get unresolved blind spots and convert to insights
  const blindSpots = getUnresolvedBlindSpots();
  for (const bs of blindSpots.filter(b => b.severity === "critical" || b.severity === "high")) {
    newInsights.push({
      id: generateId("ins_meta"),
      type: "warning",
      category: bs.category,
      title: `Knowledge Blind Spot: ${bs.description.slice(0, 50)}`,
      description: `Detected during: ${bs.detectedDuring}. Resolution strategy: ${bs.resolutionStrategy}`,
      evidence: bs.evidence,
      confidence: 0.85,
      createdAt: now,
      reinforcementCount: 0,
      actionable: true,
      actionSuggestion: bs.suggestedActions[0] || "Address this knowledge gap",
    });
  }
  
  // Get pending feedback and convert to insights
  const pendingFeedback = getPendingFeedbackRequests();
  for (const fr of pendingFeedback.filter(f => f.priority === "urgent" || f.priority === "high")) {
    newInsights.push({
      id: generateId("ins_fb"),
      type: "suggestion",
      category: fr.category,
      title: `Pending Feedback: ${fr.question.slice(0, 50)}`,
      description: fr.reason,
      evidence: [fr.context],
      confidence: 0.7,
      createdAt: now,
      reinforcementCount: 0,
      actionable: true,
      actionSuggestion: "Request feedback from creator",
    });
  }
  
  return newInsights;
}

// ── Trigger Functions ────────────────────────────────────────────────

/**
 * Check if metacognitive session should be triggered based on multiple criteria.
 * 
 * Trigger conditions (any of these):
 * 1. History-based: Enough evolution history (>= MIN_HISTORY_FOR_METACOGNITIVE) and enough cycles since last session
 * 2. Time-based fallback: No metacognitive session in FORCED_METACOGNITIVE_INTERVAL_MS (4 hours)
 * 3. Memory-based: Sufficient memory nodes exist (>= MIN_MEMORY_NODES_FOR_METACOGNITIVE)
 * 4. Manual flag: Can be forced via parameter
 */
export function shouldTriggerMetacognitive(force: boolean = false): boolean {
  if (force) {
    return true;
  }

  const history = loadEvolutionHistory();
  const data = loadMetacognitiveData();
  const lastSession = data.sessions[data.sessions.length - 1];
  
  // 1. Time-based fallback: Force metacognitive session if too long since last one
  if (lastSession) {
    const lastSessionTime = new Date(lastSession.timestamp).getTime();
    const timeSinceLastMs = Date.now() - lastSessionTime;
    if (timeSinceLastMs >= FORCED_METACOGNITIVE_INTERVAL_MS) {
      log.info("Triggering metacognitive due to time-based fallback", {
        hoursSinceLast: Math.round(timeSinceLastMs / (60 * 60 * 1000))
      });
      return true;
    }
  } else {
    // No previous session exists - check time since first evolution
    if (history.length > 0) {
      const firstEvolutionTime = new Date(history[0].timestamp).getTime();
      const timeSinceFirstMs = Date.now() - firstEvolutionTime;
      if (timeSinceFirstMs >= FORCED_METACOGNITIVE_INTERVAL_MS) {
        log.info("Triggering first metacognitive due to time-based fallback", {
          hoursSinceFirst: Math.round(timeSinceFirstMs / (60 * 60 * 1000))
        });
        return true;
      }
    }
  }

  // 2. Memory-based trigger: Check if we have enough memory nodes
  try {
    const memories = retrieveMemories({ limit: MIN_MEMORY_NODES_FOR_METACOGNITIVE + 1 });
    if (memories.length >= MIN_MEMORY_NODES_FOR_METACOGNITIVE) {
      // Only trigger if we haven't had a session recently (within 1 hour)
      if (lastSession) {
        const lastTime = new Date(lastSession.timestamp).getTime();
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        if (lastTime < oneHourAgo) {
          log.info("Triggering metacognitive due to memory-based trigger", {
            memoryNodes: memories.length
          });
          return true;
        }
      } else {
        // No previous session, memory nodes are enough
        log.info("Triggering metacognitive due to memory nodes (no prior session)", {
          memoryNodes: memories.length
        });
        return true;
      }
    }
  } catch (e) {
    log.warn("Failed to check memory nodes for metacognitive trigger", { 
      error: (e as Error).message 
    });
  }

  // 3. History-based trigger: Original logic (requires minimum history)
  if (history.length < MIN_HISTORY_FOR_METACOGNITIVE) {
    return false;
  }

  // Check if we've had enough cycles since last session
  if (lastSession) {
    const lastSessionTime = new Date(lastSession.timestamp).getTime();
    const cyclesSince = history.filter(
      (r) => new Date(r.timestamp).getTime() > lastSessionTime
    ).length;
    
    return cyclesSince >= METACOGNITIVE_INTERVAL_CYCLES;
  }

  // No previous session, trigger if enough history
  return history.length >= METACOGNITIVE_INTERVAL_CYCLES;
}