/**
 * Span-based Tracing for Jinx
 * 
 * Based on Arize Self-Improving Agent Harness concept:
 * Every decision, tool call, and output should have complete tracing.
 * These traces form a feedback loop: Execute → Trace → Analyze → Evaluate → Feedback → Improve
 * 
 * Key concepts:
 * - Span: A single operation with start/end time, status, and attributes
 * - Trace: A collection of spans forming a complete execution chain
 * - Events: Discrete events within a span
 * 
 * This enables:
 * 1. End-to-end visibility into evolution cycles
 * 2. Root cause analysis when failures occur
 * 3. Performance optimization based on timing data
 * 4. Knowledge extraction from successful/failed traces
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";
import { DATA_DIR } from "../supervisor/paths.js";

const TRACES_DIR = join(DATA_DIR, "traces");
const TRACES_INDEX_PATH = join(TRACES_DIR, "index.json");
const MAX_TRACES = 100; // Keep last 100 traces
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _MAX_SPANS_PER_TRACE = 50;

// ── Types ──────────────────────────────────────────────────────────

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}

export interface Span {
  id: string;
  traceId: string;
  parentId?: string;
  name: string;
  kind: "internal" | "server" | "client" | "producer" | "consumer";
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: "running" | "success" | "error" | "cancelled" | "timeout" | "timeout-warning";
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  error?: {
    type: string;
    message: string;
    stack?: string;
  };
}

export interface Trace {
  id: string;
  rootSpanId: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: "running" | "success" | "error" | "cancelled" | "timeout" | "timeout-warning";
  metadata: {
    evolutionCycle?: number;
    taskId?: string;
    taskTitle?: string;
    triggerSource?: string;
    version?: string;
  };
  summary?: {
    totalSpans: number;
    errorCount: number;
    successRate: number;
    slowestSpan?: string;
    criticalPath?: string[];
  };
}

export interface TraceIndex {
  traces: Trace[];
  stats: TraceStats;
}

export interface TraceStats {
  totalTraces: number;
  successfulTraces: number;
  failedTraces: number;
  avgDurationMs: number;
  commonErrors: Array<{ error: string; count: number }>;
}

// In-memory span storage for active traces
const activeSpans = new Map<string, Span>();
const activeTraces = new Map<string, Map<string, Span>>();

// ── ID Generation ──────────────────────────────────────────────────

function generateSpanId(): string {
  return `span_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateTraceId(): string {
  return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ── Storage ────────────────────────────────────────────────────────

function ensureTracesDir(): void {
  if (!existsSync(TRACES_DIR)) {
    mkdirSync(TRACES_DIR, { recursive: true });
  }
}

function loadTraceIndex(): TraceIndex {
  try {
    if (existsSync(TRACES_INDEX_PATH)) {
      return JSON.parse(readFileSync(TRACES_INDEX_PATH, "utf-8"));
    }
  } catch (e) {
    log.warn("Failed to load trace index", { error: (e as Error).message });
  }
  return {
    traces: [],
    stats: {
      totalTraces: 0,
      successfulTraces: 0,
      failedTraces: 0,
      avgDurationMs: 0,
      commonErrors: [],
    },
  };
}

function saveTraceIndex(index: TraceIndex): void {
  try {
    ensureTracesDir();
    // Keep only last MAX_TRACES
    if (index.traces.length > MAX_TRACES) {
      // Remove old trace files
      const toRemove = index.traces.slice(0, index.traces.length - MAX_TRACES);
      for (const trace of toRemove) {
        const tracePath = join(TRACES_DIR, `${trace.id}.json`);
        try {
          if (existsSync(tracePath)) {
            // Note: We don't actually delete, just stop tracking
            // In production, might want to archive or compress
          }
        } catch {
          // Ignore cleanup errors
        }
      }
      index.traces = index.traces.slice(-MAX_TRACES);
    }
    writeFileSync(TRACES_INDEX_PATH, JSON.stringify(index, null, 2));
  } catch (e) {
    log.error("Failed to save trace index", { error: (e as Error).message });
  }
}

function saveTraceSpans(traceId: string, spans: Span[]): void {
  try {
    ensureTracesDir();
    const tracePath = join(TRACES_DIR, `${traceId}.json`);
    writeFileSync(tracePath, JSON.stringify(spans, null, 2));
  } catch (e) {
    log.error("Failed to save trace spans", { error: (e as Error).message });
  }
}

function loadTraceSpans(traceId: string): Span[] {
  try {
    const tracePath = join(TRACES_DIR, `${traceId}.json`);
    if (existsSync(tracePath)) {
      return JSON.parse(readFileSync(tracePath, "utf-8"));
    }
  } catch (e) {
    log.warn("Failed to load trace spans", { error: (e as Error).message });
  }
  return [];
}

// ── Trace Management ───────────────────────────────────────────────

/**
 * Start a new trace for an evolution cycle or other operation.
 */
export function startTrace(metadata: Trace["metadata"]): Trace {
  // Ensure traces directory exists upfront (Arize best practice: traces are ground truth)
  ensureTracesDir();

  const traceId = generateTraceId();
  const rootSpan = startSpan("root", {
    traceId,
    attributes: { ...metadata },
  });

  const trace: Trace = {
    id: traceId,
    rootSpanId: rootSpan.id,
    startTime: rootSpan.startTime,
    status: "running",
    metadata,
  };

  // Store in active traces
  activeTraces.set(traceId, new Map([[rootSpan.id, rootSpan]]));

  log.info("Trace started", { traceId, metadata });
  return trace;
}

/**
 * End a trace and persist it.
 */
export function endTrace(traceId: string, status: Trace["status"] = "success"): Trace | null {
  const spans = activeTraces.get(traceId);
  if (!spans) {
    log.warn("Cannot end trace: not found", { traceId });
    return null;
  }

  // End all running spans
  for (const span of spans.values()) {
    if (span.status === "running") {
      span.endTime = Date.now();
      span.durationMs = span.endTime - span.startTime;
      span.status = status === "cancelled" ? "cancelled" : "success";
    }
  }

  const rootSpanKey = spans.keys().next().value;
  if (!rootSpanKey) {
    log.warn("Cannot end trace: no root span key", { traceId });
    return null;
  }
  const rootSpan = spans.get(rootSpanKey);
  if (!rootSpan) {
    log.warn("Cannot end trace: no root span", { traceId });
    return null;
  }

  const endTime = Date.now();
  const durationMs = endTime - rootSpan.startTime;

  // Calculate summary
  const spansArray = Array.from(spans.values());
  const errorCount = spansArray.filter(s => s.status === "error").length;
  const successRate = spansArray.length > 0 
    ? (spansArray.filter(s => s.status === "success").length / spansArray.length) 
    : 0;
  
  const sortedByDuration = [...spansArray]
    .filter(s => s.durationMs !== undefined)
    .sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0));
  const slowestSpan = sortedByDuration[0]?.name;

  const trace: Trace = {
    id: traceId,
    rootSpanId: rootSpan.id,
    startTime: rootSpan.startTime,
    endTime,
    durationMs,
    status,
    metadata: rootSpan.attributes as Trace["metadata"],
    summary: {
      totalSpans: spansArray.length,
      errorCount,
      successRate: Math.round(successRate * 100) / 100,
      slowestSpan,
    },
  };

  // Save to disk
  saveTraceSpans(traceId, spansArray);

  // Update index
  const index = loadTraceIndex();
  index.traces.push(trace);
  index.stats.totalTraces++;
  if (status === "success") index.stats.successfulTraces++;
  if (status === "error") index.stats.failedTraces++;

  // Update average duration
  const durations = index.traces.map(t => t.durationMs || 0).filter(d => d > 0);
  index.stats.avgDurationMs = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  saveTraceIndex(index);

  // Clean up from active
  activeTraces.delete(traceId);

  log.info("Trace ended", { 
    traceId, 
    status, 
    durationMs, 
    totalSpans: spansArray.length,
    successRate: Math.round(successRate * 100)
  });

  return trace;
}

// ── Span Management ────────────────────────────────────────────────

/**
 * Start a new span within a trace.
 */
export function startSpan(
  name: string,
  options?: {
    traceId?: string;
    parentId?: string;
    kind?: Span["kind"];
    attributes?: Record<string, unknown>;
  }
): Span {
  const spanId = generateSpanId();
  const traceId = options?.traceId || getCurrentTraceId() || generateTraceId();
  
  const span: Span = {
    id: spanId,
    traceId,
    parentId: options?.parentId,
    name,
    kind: options?.kind || "internal",
    startTime: Date.now(),
    status: "running",
    attributes: options?.attributes || {},
    events: [],
  };

  // Store in active spans
  activeSpans.set(spanId, span);

  // Store in active trace if exists
  const traceSpans = activeTraces.get(traceId);
  if (traceSpans) {
    traceSpans.set(spanId, span);
  }

  return span;
}

/**
 * End a span.
 */
export function endSpan(
  spanId: string,
  status: Span["status"] = "success",
  error?: { type: string; message: string; stack?: string }
): Span | null {
  const span = activeSpans.get(spanId);
  if (!span) {
    log.warn("Cannot end span: not found", { spanId });
    return null;
  }

  span.endTime = Date.now();
  span.durationMs = span.endTime - span.startTime;
  span.status = status;

  if (error) {
    span.error = error;
  }

  // Remove from active spans
  activeSpans.delete(spanId);

  // Update in active trace if exists
  const traceSpans = activeTraces.get(span.traceId);
  if (traceSpans) {
    traceSpans.set(spanId, span);
  }

  return span;
}

/**
 * Add an event to a span.
 */
export function addSpanEvent(
  spanId: string,
  name: string,
  attributes?: Record<string, unknown>
): boolean {
  const span = activeSpans.get(spanId);
  if (!span) {
    // Try to find in active traces
    for (const traceSpans of activeTraces.values()) {
      const found = traceSpans.get(spanId);
      if (found) {
        found.events.push({
          name,
          timestamp: Date.now(),
          attributes,
        });
        return true;
      }
    }
    log.warn("Cannot add event to span: not found", { spanId });
    return false;
  }

  span.events.push({
    name,
    timestamp: Date.now(),
    attributes,
  });

  return true;
}

/**
 * Alias for addSpanEvent - matches the required API.
 */
export const addEvent = addSpanEvent;

/**
 * Set an attribute on a span.
 */
export function setSpanAttribute(spanId: string, key: string, value: unknown): boolean {
  const span = activeSpans.get(spanId);
  if (!span) {
    for (const traceSpans of activeTraces.values()) {
      const found = traceSpans.get(spanId);
      if (found) {
        found.attributes[key] = value;
        return true;
      }
    }
    log.warn("Cannot set attribute on span: not found", { spanId });
    return false;
  }

  span.attributes[key] = value;
  return true;
}

/**
 * Record an error on a span.
 */
export function recordSpanError(spanId: string, error: Error): void {
  endSpan(spanId, "error", {
    type: error.constructor.name,
    message: error.message,
    stack: error.stack,
  });
}

// ── Query Functions ────────────────────────────────────────────────

/**
 * Get the current active trace ID (from the most recent root span).
 */
function getCurrentTraceId(): string | null {
  // Find the most recent trace that's still active
  if (activeTraces.size > 0) {
    const lastKey = Array.from(activeTraces.keys()).pop();
    return lastKey || null;
  }
  return null;
}

/**
 * Get a trace by ID.
 */
export function getTrace(traceId: string): { trace: Trace; spans: Span[] } | null {
  const index = loadTraceIndex();
  const trace = index.traces.find(t => t.id === traceId);
  if (!trace) return null;

  const spans = loadTraceSpans(traceId);
  return { trace, spans };
}

/**
 * Get recent traces.
 */
export function getRecentTraces(limit: number = 10): Trace[] {
  const index = loadTraceIndex();
  return index.traces.slice(-limit);
}

/**
 * Get trace statistics.
 */
export function getTraceStats(): TraceStats {
  const index = loadTraceIndex();
  return index.stats;
}

/**
 * Find traces matching criteria.
 */
export function findTraces(criteria: {
  taskId?: string;
  status?: Trace["status"];
  since?: Date;
  limit?: number;
}): Trace[] {
  const index = loadTraceIndex();
  let traces = index.traces;

  if (criteria.taskId) {
    traces = traces.filter(t => t.metadata.taskId === criteria.taskId);
  }

  if (criteria.status) {
    traces = traces.filter(t => t.status === criteria.status);
  }

  if (criteria.since) {
    const sinceTime = criteria.since.getTime();
    traces = traces.filter(t => t.startTime >= sinceTime);
  }

  if (criteria.limit) {
    traces = traces.slice(-criteria.limit);
  }

  return traces;
}

// ── Pattern Detection Types ────────────────────────────────────────

export interface RecursiveLoop {
  spans: string[];
  iterations: number;
  spanIds: string[];
  totalDurationMs: number;
}

export interface RepeatedFailure {
  tool: string;
  count: number;
  errors: Array<{ message: string; timestamp: number }>;
  spanIds: string[];
}

export interface InefficientPath {
  description: string;
  impact: string;
  spanIds: string[];
}

export interface TrajectoryPatterns {
  recursiveLoops: RecursiveLoop[];
  repeatedFailures: RepeatedFailure[];
  wastedTokens: number;
  inefficientPaths: InefficientPath[];
}

/**
 * Generate recommendations based on analysis results.
 */
function generateRecommendations(
  bottlenecks: Array<{ span: string; durationMs: number; percentage: number }>,
  errors: Array<{ span: string; error: Span["error"] }>,
  successRate: number | undefined,
  patterns: TrajectoryPatterns
): string[] {
  const recommendations: string[] = [];

  if (bottlenecks.length > 0) {
    recommendations.push(`Consider optimizing: ${bottlenecks.map(b => b.span).join(", ")}`);
  }

  if (errors.length > 0) {
    recommendations.push(`Investigate errors in: ${errors.map(e => e.span).join(", ")}`);
  }

  if (successRate && successRate < 0.8) {
    recommendations.push(`Low success rate (${Math.round(successRate * 100)}%). Consider review.`);
  }

  if (patterns.recursiveLoops.length > 0) {
    const worstLoop = patterns.recursiveLoops.reduce((a, b) => 
      a.iterations > b.iterations ? a : b
    );
    recommendations.push(
      `Detected ${patterns.recursiveLoops.length} loop pattern(s). Worst: "${worstLoop.spans.join(" → ")}" (${worstLoop.iterations} iterations)`
    );
  }

  if (patterns.repeatedFailures.length > 0) {
    const worstFailure = patterns.repeatedFailures.reduce((a, b) => 
      a.count > b.count ? a : b
    );
    recommendations.push(
      `Detected repeated failures in "${worstFailure.tool}" (${worstFailure.count} times). Consider error handling or alternative approach.`
    );
  }

  if (patterns.wastedTokens > 0) {
    recommendations.push(`Estimated ${patterns.wastedTokens} tokens wasted in redundant operations. Review loop patterns.`);
  }

  if (patterns.inefficientPaths.length > 0) {
    recommendations.push(`Detected ${patterns.inefficientPaths.length} inefficient path(s): ${patterns.inefficientPaths[0].description}`);
  }

  return recommendations;
}

/**
 * Analyze a trace for insights.
 */
export function analyzeTrace(traceId: string): {
  bottlenecks: Array<{ span: string; durationMs: number; percentage: number }>;
  errors: Array<{ span: string; error: Span["error"] }>;
  recommendations: string[];
  patterns: TrajectoryPatterns;
} {
  const data = getTrace(traceId);
  if (!data) {
    return { 
      bottlenecks: [], 
      errors: [], 
      recommendations: [],
      patterns: {
        recursiveLoops: [],
        repeatedFailures: [],
        wastedTokens: 0,
        inefficientPaths: [],
      }
    };
  }

  const { trace, spans } = data;
  const bottlenecks: Array<{ span: string; durationMs: number; percentage: number }> = [];
  const errors: Array<{ span: string; error: Span["error"] }> = [];

  // Find bottlenecks (spans taking > 30% of total time)
  const totalDuration = trace.durationMs || 0;
  if (totalDuration > 0) {
    for (const span of spans) {
      if (span.durationMs && span.durationMs > totalDuration * 0.3) {
        bottlenecks.push({
          span: span.name,
          durationMs: span.durationMs,
          percentage: Math.round((span.durationMs / totalDuration) * 100),
        });
      }
    }
  }

  // Find errors
  for (const span of spans) {
    if (span.status === "error" && span.error) {
      errors.push({ span: span.name, error: span.error });
    }
  }

  // Detect trajectory patterns (Arize best practices)
  const patterns = detectTrajectoryPatterns(spans, totalDuration);

  // Generate recommendations
  const recommendations = generateRecommendations(
    bottlenecks, errors, trace.summary?.successRate, patterns
  );

  return { bottlenecks, errors, recommendations, patterns };
}

/**
 * Detect recursive loops (same operation repeated multiple times).
 */
function detectRecursiveLoops(sortedSpans: Span[]): { loops: RecursiveLoop[]; wastedTokens: number } {
  const loops: RecursiveLoop[] = [];
  let wastedTokens = 0;

  const spanNameGroups = new Map<string, Span[]>();
  for (const span of sortedSpans) {
    const existing = spanNameGroups.get(span.name) || [];
    existing.push(span);
    spanNameGroups.set(span.name, existing);
  }

  for (const [, group] of spanNameGroups) {
    if (group.length >= 2) {
      let iterations = 0;
      for (let i = 1; i < group.length; i++) {
        const prevSpan = group[i - 1];
        const currSpan = group[i];
        const timeDiff = currSpan.startTime - (prevSpan.endTime || 0);
        if (timeDiff < 5000 && currSpan.startTime - group[0].startTime < 60000) {
          iterations++;
        }
      }
      if (iterations >= 1 || group.length >= 3) {
        const totalLoopDuration = group.reduce((sum, s) => sum + (s.durationMs || 0), 0);
        loops.push({
          spans: [group[0].name],
          iterations: group.length,
          spanIds: group.map(s => s.id),
          totalDurationMs: totalLoopDuration,
        });
        wastedTokens += (group.length - 1) * 500;
      }
    }
  }

  return { loops, wastedTokens };
}

/**
 * Detect repeated failures (same operation failing multiple times).
 */
function detectRepeatedFailures(sortedSpans: Span[]): RepeatedFailure[] {
  const failures: RepeatedFailure[] = [];
  const errorSpans = sortedSpans.filter(s => s.status === "error");
  const failureGroups = new Map<string, Span[]>();
  
  for (const span of errorSpans) {
    const existing = failureGroups.get(span.name) || [];
    existing.push(span);
    failureGroups.set(span.name, existing);
  }

  for (const [toolName, toolFailures] of failureGroups) {
    if (toolFailures.length >= 2) {
      failures.push({
        tool: toolName,
        count: toolFailures.length,
        errors: toolFailures.map(f => ({
          message: f.error?.message || "Unknown error",
          timestamp: f.startTime,
        })),
        spanIds: toolFailures.map(f => f.id),
      });
    }
  }

  return failures;
}

/**
 * Detect excessive retries.
 */
function detectExcessiveRetries(sortedSpans: Span[]): InefficientPath[] {
  const paths: InefficientPath[] = [];
  const retrySpans = new Map<string, Span[]>();
  
  for (const span of sortedSpans) {
    if (span.name.includes("retry") || span.name.includes("attempt")) {
      const baseName = span.name.replace(/-\d+$/, "");
      const existing = retrySpans.get(baseName) || [];
      existing.push(span);
      retrySpans.set(baseName, existing);
    }
  }

  for (const [baseName, retries] of retrySpans) {
    if (retries.length >= 3) {
      paths.push({
        description: `Excessive retries for "${baseName}" (${retries.length} attempts)`,
        impact: `Wasted ${retries.reduce((sum, r) => sum + (r.durationMs || 0), 0)}ms`,
        spanIds: retries.map(r => r.id),
      });
    }
  }
  
  return paths;
}

/**
 * Detect failed exploration paths (consecutive failures).
 */
function detectFailedExplorations(sortedSpans: Span[]): InefficientPath[] {
  const paths: InefficientPath[] = [];
  const consecutiveFailures: Span[] = [];
  
  const addFailedPath = (): void => {
    if (consecutiveFailures.length >= 3) {
      paths.push({
        description: `Failed exploration: tried ${consecutiveFailures.map(s => s.name).join(" → ")} without success`,
        impact: `${consecutiveFailures.length} consecutive failures`,
        spanIds: consecutiveFailures.map(s => s.id),
      });
    }
  };
  
  for (const span of sortedSpans) {
    if (span.status === "error") {
      consecutiveFailures.push(span);
    } else {
      addFailedPath();
      consecutiveFailures.length = 0;
    }
  }
  addFailedPath();
  
  return paths;
}

/**
 * Detect long-running operations (> 50% of total time).
 */
function detectLongRunningOps(sortedSpans: Span[], totalDuration: number): InefficientPath[] {
  const paths: InefficientPath[] = [];
  
  for (const span of sortedSpans) {
    if (span.durationMs && totalDuration > 0 && span.name !== "root") {
      const percentage = (span.durationMs / totalDuration) * 100;
      if (percentage > 50) {
        paths.push({
          description: `Single operation "${span.name}" dominated execution time`,
          impact: `${Math.round(percentage)}% of total time (${span.durationMs}ms)`,
          spanIds: [span.id],
        });
      }
    }
  }
  
  return paths;
}

/**
 * Detect inefficient paths (excessive retries, failed exploration, long-running ops).
 */
function detectInefficientPaths(sortedSpans: Span[], totalDuration: number): InefficientPath[] {
  const paths: InefficientPath[] = [
    ...detectExcessiveRetries(sortedSpans),
    ...detectFailedExplorations(sortedSpans),
    ...detectLongRunningOps(sortedSpans, totalDuration),
  ];

  // Deduplicate
  return paths.filter((path, index, self) =>
    index === self.findIndex(p => p.description === path.description)
  );
}

/**
 * Detect trajectory patterns including loops, repeated failures, and inefficiencies.
 * Based on Arize best practices for agent observability.
 */
function detectTrajectoryPatterns(spans: Span[], totalDuration: number): TrajectoryPatterns {
  const sortedSpans = [...spans].sort((a, b) => a.startTime - b.startTime);
  
  const { loops: recursiveLoops, wastedTokens } = detectRecursiveLoops(sortedSpans);
  const repeatedFailures = detectRepeatedFailures(sortedSpans);
  const inefficientPaths = detectInefficientPaths(sortedSpans, totalDuration);

  return { recursiveLoops, repeatedFailures, wastedTokens, inefficientPaths };
}

// ── Convenience Functions ──────────────────────────────────────────

/**
 * Wrap an async function with tracing.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options?: {
    traceId?: string;
    parentId?: string;
    attributes?: Record<string, unknown>;
  }
): Promise<T> {
  const span = startSpan(name, options);
  
  try {
    const result = await fn(span);
    endSpan(span.id, "success");
    return result;
  } catch (e) {
    const error = e as Error;
    recordSpanError(span.id, error);
    throw e;
  }
}

/**
 * Create a child span from a parent.
 */
export function createChildSpan(parentSpanId: string, name: string, attributes?: Record<string, unknown>): Span | null {
  const parent = activeSpans.get(parentSpanId);
  if (!parent) {
    for (const traceSpans of activeTraces.values()) {
      const found = traceSpans.get(parentSpanId);
      if (found) {
        return startSpan(name, {
          traceId: found.traceId,
          parentId: parentSpanId,
          attributes,
        });
      }
    }
    return null;
  }

  return startSpan(name, {
    traceId: parent.traceId,
    parentId: parentSpanId,
    attributes,
  });
}

/**
 * Format trajectory patterns for display.
 */
function formatTrajectoryAnalysis(patterns: TrajectoryPatterns): string[] {
  const lines: string[] = [];
  
  if (patterns.recursiveLoops.length === 0 && 
      patterns.repeatedFailures.length === 0 &&
      patterns.inefficientPaths.length === 0) {
    return lines;
  }
  
  lines.push("", "🔬 Trajectory Analysis:");
  
  if (patterns.recursiveLoops.length > 0) {
    lines.push(`   🔄 Loops Detected: ${patterns.recursiveLoops.length}`);
    for (const loop of patterns.recursiveLoops.slice(0, 3)) {
      lines.push(`      - "${loop.spans.join(" → ")}" (${loop.iterations} iterations, ${loop.totalDurationMs}ms)`);
    }
  }
  
  if (patterns.repeatedFailures.length > 0) {
    lines.push(`   ❌ Repeated Failures: ${patterns.repeatedFailures.length}`);
    for (const failure of patterns.repeatedFailures.slice(0, 3)) {
      lines.push(`      - "${failure.tool}" failed ${failure.count} times`);
    }
  }
  
  if (patterns.wastedTokens > 0) {
    lines.push(`   💸 Est. Wasted Tokens: ${patterns.wastedTokens}`);
  }
  
  if (patterns.inefficientPaths.length > 0) {
    lines.push(`   📉 Inefficient Paths: ${patterns.inefficientPaths.length}`);
    for (const path of patterns.inefficientPaths.slice(0, 3)) {
      lines.push(`      - ${path.description}`);
      lines.push(`        Impact: ${path.impact}`);
    }
  }
  
  return lines;
}

/**
 * Format trace for display.
 */
export function formatTrace(traceId: string): string {
  const data = getTrace(traceId);
  if (!data) return `Trace ${traceId} not found`;

  const { trace, spans } = data;
  const lines: string[] = [
    `📍 Trace: ${trace.id}`,
    `📅 ${new Date(trace.startTime).toLocaleString()}`,
    `⏱️ Duration: ${trace.durationMs || 0}ms`,
    `📊 Status: ${trace.status.toUpperCase()}`,
    "",
  ];

  if (trace.metadata.taskId) {
    lines.push(`📋 Task: ${trace.metadata.taskId} - ${trace.metadata.taskTitle || "N/A"}`);
  }

  if (trace.summary) {
    lines.push("", "📈 Summary:");
    lines.push(`   Total Spans: ${trace.summary.totalSpans}`);
    lines.push(`   Success Rate: ${Math.round((trace.summary.successRate || 0) * 100)}%`);
    lines.push(`   Error Count: ${trace.summary.errorCount}`);
    if (trace.summary.slowestSpan) {
      lines.push(`   Slowest: ${trace.summary.slowestSpan}`);
    }
  }

  if (spans.length > 0) {
    lines.push("", "🔍 Spans:");
    
    const rootSpans = spans.filter(s => !s.parentId);
    const indent = (depth: number) => "  ".repeat(depth);
    
    function printSpan(span: Span, depth: number): void {
      const statusIcon = span.status === "success" ? "✅" : 
                     span.status === "error" ? "❌" : 
                     span.status === "cancelled" ? "⏹️" : "⏳";
      const duration = span.durationMs ? ` [${span.durationMs}ms]` : "";
      lines.push(`${indent(depth)}${statusIcon} ${span.name}${duration}`);
      
      const children = spans.filter(s => s.parentId === span.id);
      for (const child of children) {
        printSpan(child, depth + 1);
      }
    }
    
    for (const root of rootSpans) {
      printSpan(root, 1);
    }
  }

  // Add trajectory analysis
  const analysis = analyzeTrace(traceId);
  lines.push(...formatTrajectoryAnalysis(analysis.patterns));

  return lines.join("\n");
}

/**
 * Get trace summary for context.
 */
export function getTraceSummary(): string {
  const stats = getTraceStats();
  const recent = getRecentTraces(5);

  const lines: string[] = [
    "📍 Trace Summary:",
    `  Total Traces: ${stats.totalTraces}`,
    `  Successful: ${stats.successfulTraces}`,
    `  Failed: ${stats.failedTraces}`,
    `  Avg Duration: ${stats.avgDurationMs}ms`,
  ];

  if (recent.length > 0) {
    lines.push("");
    lines.push("Recent Traces:");
    for (const t of recent) {
      const status = t.status === "success" ? "✅" : t.status === "error" ? "❌" : "⏳";
      lines.push(`  ${status} ${t.id} - ${t.metadata.taskId || "N/A"} (${t.durationMs || 0}ms)`);
    }
  }

  return lines.join("\n");
}