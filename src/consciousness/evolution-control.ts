/**
 * Evolution Control - Ralph-inspired loop control mechanism
 * 
 * This module implements key concepts from the Ralph Wiggum technique:
 * - Stop Conditions (iteration/token/cost limits)
 * - Evolution Verification (check if evolution truly succeeded)
 * - Context Management (track changes, manage budgets)
 * - Feedback-driven iteration (inject feedback on failure)
 */

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * Token usage tracking (compatible with AI SDK's LanguageModelUsage)
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ── Stop Conditions ────────────────────────────────────────────────────────

/**
 * Stop condition for evolution loop.
 * Returns true if the loop should stop.
 */
export type StopCondition = (ctx: StopConditionContext) => boolean | Promise<boolean>;

export interface StopConditionContext {
  /** Current iteration number (1-indexed) */
  iteration: number;
  
  /** Total tokens used so far */
  totalTokens: number;
  
  /** Estimated cost in USD */
  estimatedCost: number;
  
  /** Duration in milliseconds */
  durationMs: number;
  
  /** Number of consecutive failures */
  consecutiveFailures: number;
}

/**
 * Pre-defined stop conditions
 */
export const StopConditions = {
  /** Stop after N iterations */
  maxIterations: (max: number): StopCondition => 
    ({ iteration }) => iteration >= max,

  /** Stop when token count exceeds limit */
  maxTokens: (max: number): StopCondition => 
    ({ totalTokens }) => totalTokens >= max,

  /** Stop when cost exceeds limit (USD) */
  maxCost: (maxDollars: number): StopCondition => 
    ({ estimatedCost }) => estimatedCost >= maxDollars,

  /** Stop when duration exceeds limit (ms) */
  maxDuration: (maxMs: number): StopCondition => 
    ({ durationMs }) => durationMs >= maxMs,

  /** Stop after N consecutive failures */
  maxConsecutiveFailures: (max: number): StopCondition => 
    ({ consecutiveFailures }) => consecutiveFailures >= max,

  /** Combine multiple conditions (OR logic - stops when ANY condition is met) */
  any: (...conditions: StopCondition[]): StopCondition => 
    async (ctx) => {
      const results = await Promise.all(conditions.map(c => c(ctx)));
      return results.some(Boolean);
    },

  /** Combine multiple conditions (AND logic - stops when ALL conditions are met) */
  all: (...conditions: StopCondition[]): StopCondition => 
    async (ctx) => {
      const results = await Promise.all(conditions.map(c => c(ctx)));
      return results.every(Boolean);
    },
};

/**
 * Default stop conditions for Jinx evolution
 */
export const defaultEvolutionStopConditions = StopConditions.any(
  StopConditions.maxIterations(3),      // Max 3 iterations per evolution
  StopConditions.maxCost(2.0),          // Max $2 per evolution
  StopConditions.maxDuration(30 * 60 * 1000),  // Max 30 minutes
  StopConditions.maxConsecutiveFailures(2),    // Max 2 consecutive failures
);

// ── Evolution Verification ──────────────────────────────────────────────────

export interface VerificationResult {
  /** Whether the evolution succeeded */
  success: boolean;
  
  /** Reason for success or failure */
  reason: string;
  
  /** Specific issues found (if any) */
  issues?: string[];
  
  /** Suggestions for improvement */
  suggestions?: string[];
}

export interface VerificationContext {
  /** The task that was being executed */
  taskId: string;
  taskTitle: string;
  
  /** Files that were modified */
  filesModified: string[];
  
  /** Whether a git commit was created */
  hasCommit: boolean;
  
  /** Test results */
  testResult?: {
    passed: boolean;
    failures?: string[];
  };
  
  /** Type check results */
  typeCheckResult?: {
    passed: boolean;
    errors?: string[];
  };
}

/**
 * Verify if an evolution was successful.
 * This is the key innovation from Ralph - don't just assume success,
 * actively verify it and provide feedback if not.
 */
export async function verifyEvolutionComplete(
  ctx: VerificationContext
): Promise<VerificationResult> {
  const issues: string[] = [];
  const suggestions: string[] = [];

  // 1. Check for git commit
  if (!ctx.hasCommit) {
    issues.push("No git commit was created");
    suggestions.push("Create a commit with your changes before marking complete");
  }

  // 2. Check tests (if available)
  if (ctx.testResult && !ctx.testResult.passed) {
    issues.push(`Tests failed: ${ctx.testResult.failures?.join(", ")}`);
    suggestions.push("Fix the failing tests before proceeding");
  }

  // 3. Check types (if available)
  if (ctx.typeCheckResult && !ctx.typeCheckResult.passed) {
    issues.push(`Type errors: ${ctx.typeCheckResult.errors?.join(", ")}`);
    suggestions.push("Fix the type errors before proceeding");
  }

  // 4. Check for files modified
  if (ctx.filesModified.length === 0) {
    issues.push("No files were modified");
    suggestions.push("Make sure to implement the required changes");
  }

  // Result
  if (issues.length === 0) {
    return {
      success: true,
      reason: "Evolution completed successfully",
      issues: [],
      suggestions: [],
    };
  }

  return {
    success: false,
    reason: `Evolution incomplete:\n${issues.map(i => `- ${i}`).join("\n")}`,
    issues,
    suggestions,
  };
}

// ── Context Management ──────────────────────────────────────────────────────

export interface ChangeLogEntry {
  timestamp: number;
  iteration: number;
  type: "decision" | "action" | "error" | "observation";
  summary: string;
  details?: string;
}

export interface EvolutionContext {
  /** Files read during this evolution */
  filesRead: Set<string>;
  
  /** Files written during this evolution */
  filesWritten: Set<string>;
  
  /** Files edited during this evolution */
  filesEdited: Set<string>;
  
  /** Change log entries */
  changeLog: ChangeLogEntry[];
  
  /** Current iteration */
  currentIteration: number;
  
  /** Token usage tracking */
  tokenUsage: TokenUsage;
}

/**
 * Create a new evolution context
 */
export function createEvolutionContext(): EvolutionContext {
  return {
    filesRead: new Set(),
    filesWritten: new Set(),
    filesEdited: new Set(),
    changeLog: [],
    currentIteration: 0,
    tokenUsage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
  };
}

/**
 * Track a file operation
 */
export function trackFileOperation(
  ctx: EvolutionContext,
  operation: "read" | "write" | "edit",
  path: string
): void {
  switch (operation) {
    case "read":
      ctx.filesRead.add(path);
      break;
    case "write":
      ctx.filesWritten.add(path);
      break;
    case "edit":
      ctx.filesEdited.add(path);
      break;
  }
}

/**
 * Add a change log entry
 */
export function addChangeLogEntry(
  ctx: EvolutionContext,
  entry: Omit<ChangeLogEntry, "timestamp" | "iteration">
): void {
  ctx.changeLog.push({
    ...entry,
    timestamp: Date.now(),
    iteration: ctx.currentIteration,
  });
}

/**
 * Get all modified files
 */
export function getModifiedFiles(ctx: EvolutionContext): string[] {
  return [...new Set([...ctx.filesWritten, ...ctx.filesEdited])];
}

/**
 * Build context injection for the next iteration
 * This is the Ralph technique's feedback mechanism
 */
export function buildContextInjection(ctx: EvolutionContext): string {
  const parts: string[] = [];

  // Change log
  if (ctx.changeLog.length > 0) {
    const logEntries = ctx.changeLog
      .slice(-10) // Keep last 10 entries
      .map(e => {
        const icon = e.type === "decision" ? "📋" :
                     e.type === "action" ? "✅" :
                     e.type === "error" ? "❌" : "👁️";
        return `- [Iter ${e.iteration}] ${icon} ${e.summary}`;
      })
      .join("\n");
    
    parts.push(`## Change Log (Recent)\n\n${logEntries}`);
  }

  // Files modified
  const modified = getModifiedFiles(ctx);
  if (modified.length > 0) {
    parts.push(`## Files Modified\n\n${modified.map(f => `- ${f}`).join("\n")}`);
  }

  if (parts.length === 0) return "";

  return `\n\n---\n## Evolution Context\n\n${parts.join("\n\n")}`;
}

// ── Cost Estimation ─────────────────────────────────────────────────────────

/**
 * Model pricing (cost per million tokens in USD)
 * Based on ralph-loop-agent's pricing data
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "anthropic/claude-opus-4.5": { input: 5.0, output: 25.0 },
  "anthropic/claude-opus-4": { input: 15.0, output: 75.0 },
  "anthropic/claude-sonnet-4.5": { input: 3.0, output: 15.0 },
  "anthropic/claude-sonnet-4": { input: 3.0, output: 15.0 },
  "anthropic/claude-3.5-sonnet": { input: 3.0, output: 15.0 },
  "anthropic/claude-3.5-haiku": { input: 0.80, output: 4.0 },
  "openai/gpt-4o": { input: 2.5, output: 10.0 },
  "openai/gpt-4-turbo": { input: 10.0, output: 30.0 },
};

/**
 * Estimate cost from token usage
 */
export function estimateCost(
  usage: TokenUsage,
  model: string
): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["anthropic/claude-sonnet-4.5"];
  
  const inputCost = (usage.promptTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.completionTokens / 1_000_000) * pricing.output;
  
  return inputCost + outputCost;
}

// ── Evolution Loop Controller ───────────────────────────────────────────────

export interface EvolutionLoopConfig {
  /** Stop conditions */
  stopConditions?: StopCondition[];
  
  /** Maximum iterations (default: 3) */
  maxIterations?: number;
  
  /** Maximum cost in USD (default: 2.0) */
  maxCost?: number;
  
  /** Maximum duration in ms (default: 30 minutes) */
  maxDuration?: number;
  
  /** Callback when iteration starts */
  onIterationStart?: (iteration: number) => void | Promise<void>;
  
  /** Callback when iteration ends */
  onIterationEnd?: (iteration: number, result: IterationResult) => void | Promise<void>;
  
  /** Callback when stop condition is met */
  onStop?: (reason: string, ctx: StopConditionContext) => void | Promise<void>;
}

export interface IterationResult {
  success: boolean;
  output: string;
  tokenUsage: TokenUsage;
  durationMs: number;
  error?: Error;
}

/**
 * Evolution Loop Controller
 * 
 * This implements the Ralph Wiggum technique:
 * - Keep iterating until verification passes or stop condition is met
 * - Provide feedback on failure to guide the next iteration
 */
export class EvolutionLoopController {
  private config: Required<EvolutionLoopConfig>;
  private context: EvolutionContext;
  private iterationResults: IterationResult[] = [];
  private startTime: number = 0;
  private consecutiveFailures: number = 0;

  constructor(config: EvolutionLoopConfig = {}) {
    this.config = {
      stopConditions: config.stopConditions ?? [defaultEvolutionStopConditions],
      maxIterations: config.maxIterations ?? 3,
      maxCost: config.maxCost ?? 2.0,
      maxDuration: config.maxDuration ?? 30 * 60 * 1000,
      onIterationStart: config.onIterationStart ?? (() => {}),
      onIterationEnd: config.onIterationEnd ?? (() => {}),
      onStop: config.onStop ?? (() => {}),
    };
    this.context = createEvolutionContext();
  }

  /**
   * Run the evolution loop
   */
  async run(
    task: { id: string; title: string },
    executeIteration: (ctx: EvolutionContext, feedback?: string) => Promise<IterationResult>
  ): Promise<{
    success: boolean;
    iterations: number;
    totalTokens: number;
    totalCost: number;
    durationMs: number;
    finalOutput: string;
    stopReason: string;
  }> {
    this.startTime = Date.now();
    let totalTokens = 0;
    let totalCost = 0;
    let lastResult: IterationResult | null = null;
    let feedback: string | undefined;
    let stopReason = "completed";

    for (let iteration = 1; iteration <= this.config.maxIterations; iteration++) {
      this.context.currentIteration = iteration;

      // Check stop conditions before starting iteration
      const stopCtx: StopConditionContext = {
        iteration,
        totalTokens,
        estimatedCost: totalCost,
        durationMs: Date.now() - this.startTime,
        consecutiveFailures: this.consecutiveFailures,
      };

      if (await this.shouldStop(stopCtx)) {
        stopReason = "stop_condition_met";
        await this.config.onStop(stopReason, stopCtx);
        break;
      }

      // Start iteration
      await this.config.onIterationStart(iteration);

      const iterStartTime = Date.now();
      try {
        lastResult = await executeIteration(this.context, feedback);
        lastResult.durationMs = Date.now() - iterStartTime;
        
        // Update tracking
        totalTokens += lastResult.tokenUsage.totalTokens;
        totalCost += estimateCost(lastResult.tokenUsage, "anthropic/claude-sonnet-4.5");

        if (lastResult.success) {
          this.consecutiveFailures = 0;
          stopReason = "success";
        } else {
          this.consecutiveFailures++;
          // Generate feedback for next iteration (Ralph's key innovation)
          feedback = this.generateFeedback(lastResult);
        }

        this.iterationResults.push(lastResult);
        await this.config.onIterationEnd(iteration, lastResult);

        if (lastResult.success) {
          break;
        }
      } catch (error) {
        const err = error as Error;
        lastResult = {
          success: false,
          output: "",
          tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          durationMs: Date.now() - iterStartTime,
          error: err,
        };
        this.consecutiveFailures++;
        this.iterationResults.push(lastResult);
        await this.config.onIterationEnd(iteration, lastResult);
        feedback = `Error during iteration ${iteration}: ${err.message}. Please try a different approach.`;
      }
    }

    return {
      success: lastResult?.success ?? false,
      iterations: this.iterationResults.length,
      totalTokens,
      totalCost,
      durationMs: Date.now() - this.startTime,
      finalOutput: lastResult?.output ?? "",
      stopReason,
    };
  }

  /**
   * Check if any stop condition is met
   */
  private async shouldStop(ctx: StopConditionContext): Promise<boolean> {
    const results = await Promise.all(
      this.config.stopConditions.map(c => c(ctx))
    );
    return results.some(Boolean);
  }

  /**
   * Generate feedback for the next iteration
   * This is the Ralph technique's core innovation
   */
  private generateFeedback(result: IterationResult): string {
    if (result.error) {
      return `The previous iteration encountered an error:\n${result.error.message}\n\nPlease try a different approach.`;
    }

    return `The previous iteration did not complete successfully.\n\nOutput:\n${result.output.slice(0, 500)}\n\nPlease review what went wrong and try again with a different approach.`;
  }

  /**
   * Get the evolution context
   */
  getContext(): EvolutionContext {
    return this.context;
  }

  /**
   * Get all iteration results
   */
  getResults(): IterationResult[] {
    return [...this.iterationResults];
  }
}

// ── Exports ─────────────────────────────────────────────────────────────────

export default {
  StopConditions,
  defaultEvolutionStopConditions,
  verifyEvolutionComplete,
  createEvolutionContext,
  trackFileOperation,
  addChangeLogEntry,
  getModifiedFiles,
  buildContextInjection,
  estimateCost,
  EvolutionLoopController,
};