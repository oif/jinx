/**
 * Metacognitive Failure Pattern Detection Module
 * 
 * Based on MARS paper and production-grade metacognitive systems research.
 * 
 * Implements 7 named failure patterns for automatic detection and early warning:
 * 
 * 1. "should vs did" - If you find yourself saying "should" instead of "did", 
 *    you haven't verified (unverified claims)
 * 
 * 2. "three fixes fail, stop" - If three consecutive fixes fail, stop and escalate
 *    (escalation threshold)
 * 
 * 3. "repeating without reflection" - Repeating the same operation without 
 *    reflecting on why it failed (loop detection)
 * 
 * 4. "overconfidence without evidence" - High confidence claims without 
 *    supporting evidence (calibration failure)
 * 
 * 5. "ignoring failures" - Proceeding despite clear failure signals 
 *    (failure blindness)
 * 
 * 6. "premature closure" - Declaring completion before actual verification
 *    (verification gap)
 * 
 * 7. "goal drift" - Losing sight of the original goal during execution
 *    (objective deviation)
 */

import { loadEvolutionHistory, EvolutionRecord } from "../consciousness/history.js";
import { log } from "../util/log.js";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { DATA_DIR } from "../supervisor/paths.js";

const FAILURE_PATTERNS_PATH = join(DATA_DIR, "memory", "failure-patterns.json");

// ── Types ──────────────────────────────────────────────────────────

/**
 * Named failure pattern types
 */
export type FailurePatternType =
  | "should_vs_did"
  | "three_fixes_fail_stop"
  | "repeating_without_reflection"
  | "overconfidence_without_evidence"
  | "ignoring_failures"
  | "premature_closure"
  | "goal_drift";

/**
 * Severity of a detected failure pattern
 */
export type FailurePatternSeverity = "info" | "warning" | "critical" | "emergency";

/**
 * A detected failure pattern instance
 */
export interface DetectedFailurePattern {
  id: string;
  type: FailurePatternType;
  detectedAt: string;
  severity: FailurePatternSeverity;
  description: string;
  evidence: string[];
  context: {
    cycle?: number;
    relatedCycles?: number[];
    operation?: string;
    summary?: string;
  };
  suggestedActions: string[];
  acknowledged: boolean;
  resolvedAt?: string;
  resolutionNotes?: string;
}

/**
 * Failure pattern definition
 */
export interface FailurePatternDefinition {
  type: FailurePatternType;
  name: string;
  description: string;
  detectionRules: string[];
  defaultSeverity: FailurePatternSeverity;
  autoEscalation?: {
    afterCount: number;
    toSeverity: FailurePatternSeverity;
  };
}

/**
 * Configuration for failure pattern detection
 */
export interface FailurePatternConfig {
  enabled: boolean;
  checkIntervalMs: number;
  historyWindow: number; // Number of recent cycles to analyze
  thresholds: {
    shouldVsDidMinOccurrences: number;
    consecutiveFailuresBeforeStop: number;
    repeatPatternMinCount: number;
    overconfidenceMinScore: number;
    failureIgnoreThreshold: number;
    prematureClosureMinGap: number;
    goalDriftMinDeviation: number;
  };
  autoReport: boolean; // Automatically report detected patterns
}

/**
 * Storage for failure pattern data
 */
interface FailurePatternData {
  config: FailurePatternConfig;
  detectedPatterns: DetectedFailurePattern[];
  stats: {
    totalDetected: number;
    byType: Record<FailurePatternType, number>;
    resolved: number;
    lastCheckAt?: string;
  };
  sessionContext: {
    currentGoal?: string;
    claimedActions: string[];
    actualActions: string[];
    attemptedFixes: AttemptedFix[];
    detectedFailuresIgnored: number;
    prematureClosureCount: number;
  };
}

interface AttemptedFix {
  cycle: number;
  description: string;
  result: "success" | "failed" | "pending";
  timestamp: string;
}

// ── Default Configuration ───────────────────────────────────────────

const DEFAULT_CONFIG: FailurePatternConfig = {
  enabled: true,
  checkIntervalMs: 60 * 60 * 1000, // 1 hour
  historyWindow: 20, // Analyze last 20 cycles
  thresholds: {
    shouldVsDidMinOccurrences: 2,
    consecutiveFailuresBeforeStop: 3,
    repeatPatternMinCount: 3,
    overconfidenceMinScore: 0.85,
    failureIgnoreThreshold: 3,
    prematureClosureMinGap: 2,
    goalDriftMinDeviation: 0.5,
  },
  autoReport: true,
};

// ── Pattern Definitions ─────────────────────────────────────────────

const PATTERN_DEFINITIONS: FailurePatternDefinition[] = [
  {
    type: "should_vs_did",
    name: "Should vs Did (Unverified Claims)",
    description: "If you find yourself saying 'should' instead of 'did', you haven't verified. " +
      "This pattern detects claims about intended actions that weren't actually verified.",
    detectionRules: [
      "Look for 'should', 'would', 'could', 'might' in summaries without corresponding verification",
      "Count claims of completion without evidence of testing or verification",
      "Detect gaps between claimed outcomes and actual evidence",
    ],
    defaultSeverity: "warning",
    autoEscalation: {
      afterCount: 3,
      toSeverity: "critical",
    },
  },
  {
    type: "three_fixes_fail_stop",
    name: "Three Fixes Fail, Stop",
    description: "If three consecutive fixes fail, stop and escalate. " +
      "Continuing to apply fixes without understanding root cause is counterproductive.",
    detectionRules: [
      "Track consecutive failed attempts at fixing the same issue",
      "Detect when fix attempts are made without new analysis",
      "Trigger escalation after threshold consecutive failures",
    ],
    defaultSeverity: "critical",
  },
  {
    type: "repeating_without_reflection",
    name: "Repeating Without Reflection",
    description: "Repeating the same operation without reflecting on why it failed. " +
      "This indicates a stuck state where the system is not learning from failures.",
    detectionRules: [
      "Detect repeated identical or similar operations in recent history",
      "Check for reflection sessions between repeated attempts",
      "Identify patterns of retrying without new information",
    ],
    defaultSeverity: "warning",
    autoEscalation: {
      afterCount: 5,
      toSeverity: "critical",
    },
  },
  {
    type: "overconfidence_without_evidence",
    name: "Overconfidence Without Evidence",
    description: "High confidence claims without supporting evidence. " +
      "Overconfident systems make decisions without proper validation.",
    detectionRules: [
      "Detect high confidence scores without verification steps",
      "Look for claims of certainty without test evidence",
      "Identify assertions that aren't backed by runtime verification",
    ],
    defaultSeverity: "warning",
  },
  {
    type: "ignoring_failures",
    name: "Ignoring Failures",
    description: "Proceeding despite clear failure signals. " +
      "This pattern detects when the system continues without addressing known issues.",
    detectionRules: [
      "Track failures that weren't followed by addressing actions",
      "Detect when new tasks are started with unresolved failures",
      "Identify failure signals that were dismissed without investigation",
    ],
    defaultSeverity: "warning",
    autoEscalation: {
      afterCount: 3,
      toSeverity: "critical",
    },
  },
  {
    type: "premature_closure",
    name: "Premature Closure",
    description: "Declaring completion before actual verification. " +
      "The system claims something is done without proper testing or validation.",
    detectionRules: [
      "Detect claims of completion without verification steps",
      "Look for 'done', 'complete', 'finished' without test results",
      "Identify cases where follow-up actions indicate previous incompleteness",
    ],
    defaultSeverity: "warning",
    autoEscalation: {
      afterCount: 2,
      toSeverity: "critical",
    },
  },
  {
    type: "goal_drift",
    name: "Goal Drift",
    description: "Losing sight of the original goal during execution. " +
      "The system starts working on tangential tasks instead of the primary objective.",
    detectionRules: [
      "Compare recent actions to stated goals",
      "Detect when task summaries don't align with objectives",
      "Identify scope creep without explicit goal changes",
    ],
    defaultSeverity: "info",
    autoEscalation: {
      afterCount: 3,
      toSeverity: "warning",
    },
  },
];

// ── Storage ────────────────────────────────────────────────────────

function loadFailurePatternData(): FailurePatternData {
  try {
    if (existsSync(FAILURE_PATTERNS_PATH)) {
      return JSON.parse(readFileSync(FAILURE_PATTERNS_PATH, "utf-8"));
    }
  } catch (e) {
    log.warn("Failed to load failure pattern data", { error: (e as Error).message });
  }
  
  return {
    config: DEFAULT_CONFIG,
    detectedPatterns: [],
    stats: {
      totalDetected: 0,
      byType: {
        should_vs_did: 0,
        three_fixes_fail_stop: 0,
        repeating_without_reflection: 0,
        overconfidence_without_evidence: 0,
        ignoring_failures: 0,
        premature_closure: 0,
        goal_drift: 0,
      },
      resolved: 0,
    },
    sessionContext: {
      claimedActions: [],
      actualActions: [],
      attemptedFixes: [],
      detectedFailuresIgnored: 0,
      prematureClosureCount: 0,
    },
  };
}

function saveFailurePatternData(data: FailurePatternData): void {
  try {
    const dir = dirname(FAILURE_PATTERNS_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    // Keep only last 100 detected patterns
    if (data.detectedPatterns.length > 100) {
      data.detectedPatterns = data.detectedPatterns.slice(-100);
    }
    writeFileSync(FAILURE_PATTERNS_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    log.error("Failed to save failure pattern data", { error: (e as Error).message });
  }
}

// ── ID Generation ───────────────────────────────────────────────────

function generatePatternId(): string {
  return `fp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

// ── Detection Functions ──────────────────────────────────────────────

/**
 * Detect "should vs did" pattern - unverified claims
 * Looks for language indicating intentions rather than completed actions
 */
function detectShouldVsDid(
  records: EvolutionRecord[],
  data: FailurePatternData
): DetectedFailurePattern | null {
  const threshold = data.config.thresholds.shouldVsDidMinOccurrences;
  const unverifiedClaims: string[] = [];
  
  // Words that indicate unverified intentions
  const intentionWords = ["should", "would", "could", "might", "will need to", "ought to"];
  // Words that indicate verification
  const verificationWords = ["tested", "verified", "confirmed", "checked", "validated", "passed"];
  
  for (const record of records.slice(-data.config.historyWindow)) {
    const summary = record.summary.toLowerCase();
    
    // Check for intention words without verification
    const hasIntention = intentionWords.some(w => summary.includes(w));
    const hasVerification = verificationWords.some(w => summary.includes(w));
    
    if (hasIntention && !hasVerification && record.status === "success") {
      unverifiedClaims.push(`#${record.cycle}: ${record.summary.slice(0, 80)}`);
    }
    
    // Also check for "should have" patterns in failed cycles
    if (record.status === "failed" && summary.includes("should have")) {
      unverifiedClaims.push(`#${record.cycle} (failed): Missing verification identified`);
    }
  }
  
  if (unverifiedClaims.length >= threshold) {
    const definition = PATTERN_DEFINITIONS.find(d => d.type === "should_vs_did")!;
    const severity = getEscalatedSeverity(definition, unverifiedClaims.length, data);
    
    return {
      id: generatePatternId(),
      type: "should_vs_did",
      detectedAt: new Date().toISOString(),
      severity,
      description: `Detected ${unverifiedClaims.length} instances of unverified claims. ` +
        "Statements use intention language without verification evidence.",
      evidence: unverifiedClaims.slice(0, 5),
      context: {
        relatedCycles: records.slice(-unverifiedClaims.length).map(r => r.cycle),
      },
      suggestedActions: [
        "Add explicit verification steps to each claimed action",
        "Use 'did' language only after actual verification",
        "Run tests before claiming completion",
        "Document evidence of successful outcomes",
      ],
      acknowledged: false,
    };
  }
  
  return null;
}

/**
 * Detect "three fixes fail, stop" pattern
 * Tracks consecutive failed fix attempts
 */
function detectThreeFixesFailStop(
  records: EvolutionRecord[],
  data: FailurePatternData
): DetectedFailurePattern | null {
  const threshold = data.config.thresholds.consecutiveFailuresBeforeStop;
  const recentRecords = records.slice(-(threshold + 2));
  
  // Look for patterns of attempted fixes
  const fixKeywords = ["fix", "repair", "correct", "resolve", "patch", "solve"];
  
  let consecutiveFixFailures = 0;
  const failedFixCycles: number[] = [];
  let lastFixDescription = "";
  
  for (const record of recentRecords) {
    const summary = record.summary.toLowerCase();
    const isFixAttempt = fixKeywords.some(k => summary.includes(k));
    
    if (isFixAttempt) {
      if (record.status === "failed") {
        consecutiveFixFailures++;
        failedFixCycles.push(record.cycle);
        lastFixDescription = record.summary;
      } else if (record.status === "success") {
        // Reset on successful fix
        consecutiveFixFailures = 0;
        failedFixCycles.length = 0;
      }
    }
  }
  
  if (consecutiveFixFailures >= threshold) {
    const definition = PATTERN_DEFINITIONS.find(d => d.type === "three_fixes_fail_stop")!;
    
    return {
      id: generatePatternId(),
      type: "three_fixes_fail_stop",
      detectedAt: new Date().toISOString(),
      severity: definition.defaultSeverity,
      description: `${consecutiveFixFailures} consecutive fix attempts have failed. ` +
        "Stop and investigate root cause before continuing.",
      evidence: [
        `Failed fix cycles: ${failedFixCycles.join(", ")}`,
        `Last attempt: ${lastFixDescription.slice(0, 100)}`,
      ],
      context: {
        relatedCycles: failedFixCycles,
        operation: "fix_attempt",
      },
      suggestedActions: [
        "STOP attempting fixes - threshold reached",
        "Perform root cause analysis instead of more fixes",
        "Seek external input or different approach",
        "Consider whether the problem is correctly understood",
      ],
      acknowledged: false,
    };
  }
  
  return null;
}

/**
 * Detect "repeating without reflection" pattern
 * Looks for repeated similar operations without intervening reflection
 */
function detectRepeatingWithoutReflection(
  records: EvolutionRecord[],
  data: FailurePatternData
): DetectedFailurePattern | null {
  const threshold = data.config.thresholds.repeatPatternMinCount;
  const window = records.slice(-data.config.historyWindow);
  
  // Group similar summaries
  const summaryPatterns = new Map<string, number[]>();
  
  for (const record of window) {
    // Normalize summary for comparison
    const normalized = record.summary
      .toLowerCase()
      .replace(/\d+/g, "N") // Replace numbers
      .replace(/#[a-z]+/gi, "") // Remove hashtags
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 50);
    
    const key = normalized;
    if (!summaryPatterns.has(key)) {
      summaryPatterns.set(key, []);
    }
    summaryPatterns.get(key)!.push(record.cycle);
  }
  
  // Check for repeated patterns
  for (const [pattern, cycles] of summaryPatterns) {
    if (cycles.length >= threshold) {
      // Check if any reflection happened between these cycles
      // (This would require reflection data - for now, assume no reflection if all are failures)
      const relatedRecords = records.filter(r => cycles.includes(r.cycle));
      const allFailed = relatedRecords.every(r => r.status === "failed");
      
      if (allFailed) {
        const definition = PATTERN_DEFINITIONS.find(d => d.type === "repeating_without_reflection")!;
        const severity = getEscalatedSeverity(definition, cycles.length, data);
        
        return {
          id: generatePatternId(),
          type: "repeating_without_reflection",
          detectedAt: new Date().toISOString(),
          severity,
          description: `Similar operation repeated ${cycles.length} times without success. ` +
            "Pattern indicates potential loop without reflection.",
          evidence: [
            `Pattern: "${pattern}..."`,
            `Cycles: ${cycles.join(", ")}`,
            "All attempts failed - reflection needed",
          ],
          context: {
            relatedCycles: cycles,
            operation: pattern,
          },
          suggestedActions: [
            "Run a reflection session before continuing",
            "Analyze why this operation keeps failing",
            "Consider a fundamentally different approach",
            "Check for environmental or systemic issues",
          ],
          acknowledged: false,
        };
      }
    }
  }
  
  return null;
}

/**
 * Detect "overconfidence without evidence" pattern
 * Looks for high confidence claims without supporting verification
 */
function detectOverconfidenceWithoutEvidence(
  records: EvolutionRecord[],
  data: FailurePatternData
): DetectedFailurePattern | null {
  const window = records.slice(-data.config.historyWindow);
  
  // Confidence indicators without verification
  const overconfidentPatterns = [
    /definitely|certainly|surely|obviously|clearly|without doubt/i,
    /will (definitely|certainly|surely|always)/i,
    /guaranteed|promise|assured/i,
    /no (need|reason) to (test|verify|check)/i,
    /works? (perfectly|flawlessly|without issue)/i,
  ];
  
  const verificationIndicators = [
    /tested|verified|confirmed|passed|validated/i,
    /check|assert|expect/i,
    /result: (success|pass)/i,
  ];
  
  const evidence: string[] = [];
  
  for (const record of window) {
    const summary = record.summary;
    
    // Check for overconfidence patterns
    const hasOverconfidence = overconfidentPatterns.some(p => p.test(summary));
    const hasVerification = verificationIndicators.some(p => p.test(summary));
    
    if (hasOverconfidence && !hasVerification) {
      evidence.push(`#${record.cycle}: Overconfident claim without verification`);
    }
    
    // Check for high success rate claims after failures
    if (record.status === "success") {
      const prevRecords = records.filter(r => 
        r.cycle < record.cycle && r.cycle >= record.cycle - 3
      );
      const recentFailures = prevRecords.filter(r => r.status === "failed");
      
      if (recentFailures.length >= 2 && hasOverconfidence) {
        evidence.push(
          `#${record.cycle}: High confidence after ${recentFailures.length} recent failures`
        );
      }
    }
  }
  
  if (evidence.length >= 2) {
    const definition = PATTERN_DEFINITIONS.find(d => d.type === "overconfidence_without_evidence")!;
    
    return {
      id: generatePatternId(),
      type: "overconfidence_without_evidence",
      detectedAt: new Date().toISOString(),
      severity: definition.defaultSeverity,
      description: "Detected confident claims without supporting evidence. " +
        "Overconfidence can lead to missed issues and poor decisions.",
      evidence,
      context: {},
      suggestedActions: [
        "Add verification steps before making confident claims",
        "Run tests to support assertions",
        "Use measured language (e.g., 'appears to' instead of 'definitely')",
        "Document evidence for confidence levels",
      ],
      acknowledged: false,
    };
  }
  
  return null;
}

/**
 * Detect "ignoring failures" pattern
 * Looks for progression despite unresolved failures
 */
function detectIgnoringFailures(
  records: EvolutionRecord[],
  data: FailurePatternData
): DetectedFailurePattern | null {
  const threshold = data.config.thresholds.failureIgnoreThreshold;
  const window = records.slice(-data.config.historyWindow);
  
  // Find failures that weren't addressed
  const unaddressedFailures: EvolutionRecord[] = [];
  
  for (let i = 0; i < window.length; i++) {
    const record = window[i];
    
    if (record.status === "failed") {
      // Check if subsequent records address this failure
      const subsequentRecords = window.slice(i + 1);
      const summary = record.summary.toLowerCase();
      
      // Check if this failure was addressed in subsequent records
      const wasAddressed = subsequentRecords.some(r => {
        const nextSummary = r.summary.toLowerCase();
        // Check if subsequent record mentions fixing or addressing this failure
        const fixKeywords = ["fix", "resolve", "address", "correct", "repair"];
        const hasFixIntent = fixKeywords.some(k => nextSummary.includes(k));
        
        // Check for semantic overlap (mentioning similar topics)
        const keywords = summary.split(/\s+/).filter(w => w.length > 4);
        const overlap = keywords.filter(k => nextSummary.includes(k)).length;
        
        return hasFixIntent && overlap >= 2;
      });
      
      if (!wasAddressed) {
        unaddressedFailures.push(record);
      }
    }
  }
  
  if (unaddressedFailures.length >= threshold) {
    const definition = PATTERN_DEFINITIONS.find(d => d.type === "ignoring_failures")!;
    const severity = getEscalatedSeverity(definition, unaddressedFailures.length, data);
    
    return {
      id: generatePatternId(),
      type: "ignoring_failures",
      detectedAt: new Date().toISOString(),
      severity,
      description: `${unaddressedFailures.length} failures detected without proper addressing. ` +
        "Continuing without resolving known issues risks compounding problems.",
      evidence: unaddressedFailures.slice(0, 5).map(r => 
        `#${r.cycle}: ${r.summary.slice(0, 60)}`
      ),
      context: {
        relatedCycles: unaddressedFailures.map(r => r.cycle),
      },
      suggestedActions: [
        "Review and address all unaddressed failures before continuing",
        "Create a failure backlog if needed",
        "Prioritize failure resolution over new features",
        "Investigate why failures were not addressed",
      ],
      acknowledged: false,
    };
  }
  
  return null;
}

/**
 * Detect "premature closure" pattern
 * Looks for claims of completion that were later shown to be incomplete
 */
function detectPrematureClosure(
  records: EvolutionRecord[],
  data: FailurePatternData
): DetectedFailurePattern | null {
  const window = records.slice(-data.config.historyWindow);
  const evidence: string[] = [];
  
  // Completion keywords
  const completionKeywords = ["completed", "done", "finished", "implemented", "resolved"];
  
  // Incompleteness indicators in subsequent records
  const incompleteIndicators = [
    "still", "remaining", "missing", "incomplete", "not working",
    "needs", "todo", "fixme", "follow-up", "continued",
  ];
  
  for (let i = 0; i < window.length - 1; i++) {
    const record = window[i];
    const summary = record.summary.toLowerCase();
    
    // Check for completion claim
    const claimedComplete = completionKeywords.some(k => summary.includes(k));
    
    if (claimedComplete && record.status === "success") {
      // Look at subsequent records for incompleteness indicators
      const subsequent = window.slice(i + 1, i + 4); // Check next 3 records
      
      for (const next of subsequent) {
        const nextSummary = next.summary.toLowerCase();
        const hasIncomplete = incompleteIndicators.some(k => nextSummary.includes(k));
        
        if (hasIncomplete) {
          // Check if it's related to the same topic
          const keywords = summary.split(/\s+/).filter(w => w.length > 4);
          const overlap = keywords.filter(k => nextSummary.includes(k)).length;
          
          if (overlap >= 2) {
            evidence.push(
              `#${record.cycle} claimed complete, but #${next.cycle} shows continuation needed`
            );
          }
        }
      }
    }
  }
  
  if (evidence.length >= data.config.thresholds.prematureClosureMinGap) {
    const definition = PATTERN_DEFINITIONS.find(d => d.type === "premature_closure")!;
    
    return {
      id: generatePatternId(),
      type: "premature_closure",
      detectedAt: new Date().toISOString(),
      severity: definition.defaultSeverity,
      description: "Detected claims of completion that were followed by continuation work. " +
        "Premature closure leads to incomplete work being marked as done.",
      evidence,
      context: {},
      suggestedActions: [
        "Verify completion with tests before marking done",
        "Use explicit completion criteria",
        "Check for edge cases and follow-up needs",
        "Implement 'done-done' verification checklists",
      ],
      acknowledged: false,
    };
  }
  
  return null;
}

/**
 * Detect "goal drift" pattern
 * Looks for deviation from stated goals
 */
function detectGoalDrift(
  records: EvolutionRecord[],
  data: FailurePatternData
): DetectedFailurePattern | null {
  const currentGoal = data.sessionContext.currentGoal;
  
  if (!currentGoal) {
    return null; // No goal set, can't detect drift
  }
  
  const window = records.slice(-5); // Check recent history
  const goalKeywords = currentGoal.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  
  let driftedRecords = 0;
  const evidence: string[] = [];
  
  for (const record of window) {
    const summary = record.summary.toLowerCase();
    
    // Check how many goal keywords appear in the summary
    const matches = goalKeywords.filter(k => summary.includes(k)).length;
    const matchRatio = goalKeywords.length > 0 ? matches / goalKeywords.length : 0;
    
    if (matchRatio < data.config.thresholds.goalDriftMinDeviation) {
      driftedRecords++;
      evidence.push(`#${record.cycle}: Low goal alignment (${Math.round(matchRatio * 100)}%)`);
    }
  }
  
  if (driftedRecords >= 3) {
    const definition = PATTERN_DEFINITIONS.find(d => d.type === "goal_drift")!;
    
    return {
      id: generatePatternId(),
      type: "goal_drift",
      detectedAt: new Date().toISOString(),
      severity: definition.defaultSeverity,
      description: `Recent work has drifted from the stated goal: "${currentGoal.slice(0, 50)}...". ` +
        `${driftedRecords} of last ${window.length} cycles show low goal alignment.`,
      evidence,
      context: {
        operation: currentGoal,
      },
      suggestedActions: [
        "Re-evaluate current activities against the stated goal",
        "Either update the goal to match current work, or redirect work to goal",
        "Document any intentional goal changes",
        "Create sub-goals if the current goal is too broad",
      ],
      acknowledged: false,
    };
  }
  
  return null;
}

/**
 * Get escalated severity based on occurrence count
 */
function getEscalatedSeverity(
  definition: FailurePatternDefinition,
  occurrenceCount: number,
  _data: FailurePatternData
): FailurePatternSeverity {
  if (definition.autoEscalation && occurrenceCount >= definition.autoEscalation.afterCount) {
    return definition.autoEscalation.toSeverity;
  }
  return definition.defaultSeverity;
}

// ── Main Detection Function ─────────────────────────────────────────

/**
 * Run all failure pattern detections
 */
export function detectFailurePatterns(options: {
  force?: boolean;
  specificTypes?: FailurePatternType[];
}): DetectedFailurePattern[] {
  const data = loadFailurePatternData();
  
  if (!data.config.enabled && !options.force) {
    // Failure pattern detection is disabled
    return [];
  }
  
  const records = loadEvolutionHistory();
  
  if (records.length < 2) {
    log.debug("Not enough history for failure pattern detection");
    return [];
  }
  
  const detected: DetectedFailurePattern[] = [];
  const typesToCheck = options.specificTypes || [
    "should_vs_did",
    "three_fixes_fail_stop",
    "repeating_without_reflection",
    "overconfidence_without_evidence",
    "ignoring_failures",
    "premature_closure",
    "goal_drift",
  ];
  
  // Run detections
  const detectors: Record<FailurePatternType, () => DetectedFailurePattern | null> = {
    should_vs_did: () => detectShouldVsDid(records, data),
    three_fixes_fail_stop: () => detectThreeFixesFailStop(records, data),
    repeating_without_reflection: () => detectRepeatingWithoutReflection(records, data),
    overconfidence_without_evidence: () => detectOverconfidenceWithoutEvidence(records, data),
    ignoring_failures: () => detectIgnoringFailures(records, data),
    premature_closure: () => detectPrematureClosure(records, data),
    goal_drift: () => detectGoalDrift(records, data),
  };
  
  for (const type of typesToCheck) {
    try {
      const result = detectors[type]();
      if (result) {
        detected.push(result);
        
        // Update stats
        data.stats.totalDetected++;
        data.stats.byType[type]++;
        
        log.warn(`Failure pattern detected: ${type}`, {
          severity: result.severity,
          evidence: result.evidence.slice(0, 2),
        });
      }
    } catch (e) {
      log.error(`Error detecting failure pattern: ${type}`, { error: (e as Error).message });
    }
  }
  
  // Save detected patterns and updated stats
  if (detected.length > 0) {
    data.detectedPatterns.push(...detected);
    data.stats.lastCheckAt = new Date().toISOString();
    saveFailurePatternData(data);
  }
  
  return detected;
}

// ── Session Context Tracking ────────────────────────────────────────

/**
 * Set the current goal for goal drift detection
 */
export function setCurrentGoal(goal: string): void {
  const data = loadFailurePatternData();
  data.sessionContext.currentGoal = goal;
  saveFailurePatternData(data);
}

/**
 * Record a claimed action (for should_vs_did detection)
 */
export function recordClaimedAction(action: string): void {
  const data = loadFailurePatternData();
  data.sessionContext.claimedActions.push(action);
  // Keep last 20 claimed actions
  if (data.sessionContext.claimedActions.length > 20) {
    data.sessionContext.claimedActions = data.sessionContext.claimedActions.slice(-20);
  }
  saveFailurePatternData(data);
}

/**
 * Record an actual action (for should_vs_did verification)
 */
export function recordActualAction(action: string): void {
  const data = loadFailurePatternData();
  data.sessionContext.actualActions.push(action);
  // Keep last 20 actual actions
  if (data.sessionContext.actualActions.length > 20) {
    data.sessionContext.actualActions = data.sessionContext.actualActions.slice(-20);
  }
  saveFailurePatternData(data);
}

/**
 * Record an attempted fix (for three_fixes_fail_stop detection)
 */
export function recordAttemptedFix(
  cycle: number,
  description: string,
  result: "success" | "failed" | "pending"
): void {
  const data = loadFailurePatternData();
  data.sessionContext.attemptedFixes.push({
    cycle,
    description,
    result,
    timestamp: new Date().toISOString(),
  });
  // Keep last 20 attempted fixes
  if (data.sessionContext.attemptedFixes.length > 20) {
    data.sessionContext.attemptedFixes = data.sessionContext.attemptedFixes.slice(-20);
  }
  saveFailurePatternData(data);
}

/**
 * Record an ignored failure (for ignoring_failures detection)
 */
export function recordFailureIgnored(): void {
  const data = loadFailurePatternData();
  data.sessionContext.detectedFailuresIgnored++;
  saveFailurePatternData(data);
}

/**
 * Reset session context (call at the start of a new evolution cycle)
 */
export function resetSessionContext(): void {
  const data = loadFailurePatternData();
  data.sessionContext = {
    claimedActions: [],
    actualActions: [],
    attemptedFixes: [],
    detectedFailuresIgnored: 0,
    prematureClosureCount: 0,
  };
  saveFailurePatternData(data);
}

// ── Query Functions ────────────────────────────────────────────────

/**
 * Get all detected patterns
 */
export function getDetectedPatterns(
  options: {
    type?: FailurePatternType;
    severity?: FailurePatternSeverity;
    acknowledged?: boolean;
    limit?: number;
  } = {}
): DetectedFailurePattern[] {
  const data = loadFailurePatternData();
  
  let patterns = data.detectedPatterns;
  
  if (options.type) {
    patterns = patterns.filter(p => p.type === options.type);
  }
  
  if (options.severity) {
    patterns = patterns.filter(p => p.severity === options.severity);
  }
  
  if (options.acknowledged !== undefined) {
    patterns = patterns.filter(p => p.acknowledged === options.acknowledged);
  }
  
  if (options.limit) {
    patterns = patterns.slice(-options.limit);
  }
  
  return patterns;
}

/**
 * Get unacknowledged critical patterns
 */
export function getCriticalPatterns(): DetectedFailurePattern[] {
  return getDetectedPatterns({
    severity: "critical",
    acknowledged: false,
  });
}

/**
 * Get pattern statistics
 */
export function getFailurePatternStats(): {
  total: number;
  byType: Record<FailurePatternType, number>;
  bySeverity: Record<FailurePatternSeverity, number>;
  acknowledged: number;
  unacknowledged: number;
} {
  const data = loadFailurePatternData();
  
  const bySeverity: Record<FailurePatternSeverity, number> = {
    info: 0,
    warning: 0,
    critical: 0,
    emergency: 0,
  };
  
  let acknowledged = 0;
  let unacknowledged = 0;
  
  for (const pattern of data.detectedPatterns) {
    bySeverity[pattern.severity]++;
    if (pattern.acknowledged) {
      acknowledged++;
    } else {
      unacknowledged++;
    }
  }
  
  return {
    total: data.detectedPatterns.length,
    byType: { ...data.stats.byType },
    bySeverity,
    acknowledged,
    unacknowledged,
  };
}

/**
 * Acknowledge a pattern
 */
export function acknowledgePattern(patternId: string): boolean {
  const data = loadFailurePatternData();
  const pattern = data.detectedPatterns.find(p => p.id === patternId);
  
  if (pattern) {
    pattern.acknowledged = true;
    saveFailurePatternData(data);
    return true;
  }
  
  return false;
}

/**
 * Resolve a pattern
 */
export function resolvePattern(
  patternId: string,
  resolutionNotes: string
): boolean {
  const data = loadFailurePatternData();
  const pattern = data.detectedPatterns.find(p => p.id === patternId);
  
  if (pattern) {
    pattern.acknowledged = true;
    pattern.resolvedAt = new Date().toISOString();
    pattern.resolutionNotes = resolutionNotes;
    data.stats.resolved++;
    saveFailurePatternData(data);
    return true;
  }
  
  return false;
}

/**
 * Get pattern definitions
 */
export function getPatternDefinitions(): FailurePatternDefinition[] {
  return [...PATTERN_DEFINITIONS];
}

/**
 * Format a detected pattern for display
 */
export function formatDetectedPattern(pattern: DetectedFailurePattern): string {
  const definition = PATTERN_DEFINITIONS.find(d => d.type === pattern.type);
  const severityIcons: Record<FailurePatternSeverity, string> = {
    info: "ℹ️",
    warning: "⚠️",
    critical: "🔴",
    emergency: "🚨",
  };
  
  const lines: string[] = [
    `${severityIcons[pattern.severity]} Failure Pattern: ${definition?.name || pattern.type}`,
    `Detected: ${new Date(pattern.detectedAt).toLocaleString()}`,
    `Severity: ${pattern.severity}`,
    "",
    pattern.description,
    "",
    "Evidence:",
  ];
  
  for (const e of pattern.evidence.slice(0, 3)) {
    lines.push(`  - ${e}`);
  }
  
  if (pattern.suggestedActions.length > 0) {
    lines.push("", "Suggested Actions:");
    for (const action of pattern.suggestedActions.slice(0, 3)) {
      lines.push(`  • ${action}`);
    }
  }
  
  return lines.join("\n");
}

/**
 * Get a summary of failure patterns for context
 */
export function getFailurePatternSummary(): string {
  const stats = getFailurePatternStats();
  const critical = getCriticalPatterns();
  
  const lines: string[] = [
    "🔍 Failure Pattern Detection Summary:",
    `  Total Detected: ${stats.total}`,
    `  Critical Unacknowledged: ${critical.length}`,
    `  Resolved: ${stats.bySeverity.critical + stats.bySeverity.emergency}`,
    "",
    "By Type:",
  ];
  
  for (const [type, count] of Object.entries(stats.byType)) {
    if (count > 0) {
      lines.push(`  - ${type}: ${count}`);
    }
  }
  
  if (critical.length > 0) {
    lines.push("", "⚠️ Critical Patterns Requiring Attention:");
    for (const p of critical.slice(0, 3)) {
      lines.push(`  - ${p.type}: ${p.description.slice(0, 50)}...`);
    }
  }
  
  return lines.join("\n");
}

/**
 * Should failure pattern detection run?
 * Checks time-based and event-based triggers
 */
export function shouldRunFailurePatternDetection(): boolean {
  const data = loadFailurePatternData();
  
  if (!data.config.enabled) {
    return false;
  }
  
  // Time-based check
  if (data.stats.lastCheckAt) {
    const lastCheck = new Date(data.stats.lastCheckAt).getTime();
    const timeSince = Date.now() - lastCheck;
    
    if (timeSince < data.config.checkIntervalMs) {
      return false;
    }
  }
  
  return true;
}

/**
 * Integrate failure pattern detection with metacognitive system
 * Returns insights that can be added to metacognitive sessions
 */
export function integrateWithMetacognition(): {
  criticalPatterns: DetectedFailurePattern[];
  recommendedActions: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
} {
  const criticalPatterns = getCriticalPatterns();
  const stats = getFailurePatternStats();
  
  const recommendedActions: string[] = [];
  let riskLevel: "low" | "medium" | "high" | "critical" = "low";
  
  // Assess risk level
  if (criticalPatterns.length > 0) {
    riskLevel = "critical";
    recommendedActions.push("Address all critical failure patterns immediately");
  } else if (stats.unacknowledged > 5) {
    riskLevel = "high";
    recommendedActions.push("Review and acknowledge detected failure patterns");
  } else if (stats.unacknowledged > 2) {
    riskLevel = "medium";
    recommendedActions.push("Consider reviewing recent failure patterns");
  }
  
  // Add type-specific recommendations
  if (stats.byType.three_fixes_fail_stop > 0) {
    recommendedActions.push("Stop fix attempts - perform root cause analysis instead");
  }
  
  if (stats.byType.repeating_without_reflection > 0) {
    recommendedActions.push("Run a reflection session before continuing");
  }
  
  if (stats.byType.should_vs_did > 0) {
    recommendedActions.push("Add verification steps to claimed actions");
  }
  
  return {
    criticalPatterns,
    recommendedActions,
    riskLevel,
  };
}

// ── Configuration ───────────────────────────────────────────────────

/**
 * Update failure pattern configuration
 */
export function updateFailurePatternConfig(
  updates: Partial<FailurePatternConfig>
): FailurePatternConfig {
  const data = loadFailurePatternData();
  data.config = { ...data.config, ...updates };
  saveFailurePatternData(data);
  return data.config;
}

/**
 * Get current configuration
 */
export function getFailurePatternConfig(): FailurePatternConfig {
  const data = loadFailurePatternData();
  return data.config;
}