/**
 * Evolution Strategy System
 *
 * Implements intelligent strategy selection for evolution cycles based on system state.
 * Strategies: innovate | harden | repair-only | balanced
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../supervisor/paths.js";
import { log } from "../util/log.js";
import { loadHealthHistory } from "../health/history.js";
const STRATEGY_PATH = join(DATA_DIR, "evolution-strategy.json");
const METRICS_PATH = join(DATA_DIR, "performance-metrics.json");

// Local copy of loadMetrics to avoid private export dependency
function loadMetricsLocal(): { agentPrompts: { durationMs: number; success: boolean }[]; evolutionCycles: { status: "success" | "failed" }[] } {
  try {
    if (existsSync(METRICS_PATH)) {
      const data = JSON.parse(readFileSync(METRICS_PATH, "utf-8"));
      return {
        agentPrompts: data.agentPrompts || [],
        evolutionCycles: data.evolutionCycles || [],
      };
    }
  } catch (e: unknown) {
    log.warn("Failed to load metrics for strategy", { error: (e as Error).message });
  }
  return { agentPrompts: [], evolutionCycles: [] };
}

// ── Types ──────────────────────────────────────────────────────────

export type EvolutionStrategy = "innovate" | "harden" | "repair-only" | "balanced";

export interface StrategyConfig {
  currentStrategy: EvolutionStrategy;
  lastStrategyChange: string;
  strategyHistory: StrategyChange[];
  autoSelect: boolean; // Whether to auto-select based on state
  thresholds: StrategyThresholds;
  // Hysteresis mechanism to prevent strategy oscillation
  pendingSwitch: EvolutionStrategy | null; // Strategy waiting for confirmation
  confirmationCount: number; // How many times the pending switch has been recommended
  requiredConfirmations: number; // How many confirmations needed to switch (default 2)
}

export interface StrategyChange {
  timestamp: string;
  from: EvolutionStrategy;
  to: EvolutionStrategy;
  reason: string;
}

export interface StrategyThresholds {
  failureRateCritical: number; // Switch to repair-only above this
  failureRateWarning: number;  // Switch to harden above this
  healthWarningCount: number;  // Number of warnings to trigger harden
  consecutiveSuccesses: number; // Number of successes to allow innovate
}

export interface SystemState {
  healthStatus: "healthy" | "degraded" | "critical";
  recentFailureRate: number;
  consecutiveSuccesses: number;
  recentHealthWarnings: number;
  avgResponseTimeMs: number;
}

export interface StrategyRecommendation {
  recommended: EvolutionStrategy;
  confidence: number; // 0-1
  reasons: string[];
  currentState: SystemState;
}

// ── Default Configuration ─────────────────────────────────────────

const DEFAULT_THRESHOLDS: StrategyThresholds = {
  failureRateCritical: 0.5,    // >50% failures = critical
  failureRateWarning: 0.2,     // >20% failures = warning
  healthWarningCount: 3,       // 3+ health warnings = degraded
  consecutiveSuccesses: 3,     // 3+ successes = ready to innovate
};

const DEFAULT_CONFIG: StrategyConfig = {
  currentStrategy: "balanced",
  lastStrategyChange: new Date().toISOString(),
  strategyHistory: [],
  autoSelect: true,
  thresholds: DEFAULT_THRESHOLDS,
  pendingSwitch: null,
  confirmationCount: 0,
  requiredConfirmations: 2, // Require 2 consecutive recommendations to switch
};

// ── Strategy Descriptions ─────────────────────────────────────────

export const STRATEGY_DESCRIPTIONS: Record<EvolutionStrategy, { 
  label: string; 
  description: string;
  promptModifier: string;
}> = {
  "innovate": {
    label: "🚀 Innovate",
    description: "Focus on exploring new capabilities and features. Take calculated risks.",
    promptModifier: `
【进化策略: INNOVATE】
当前系统稳定，适合探索新功能。
- 优先考虑创新性和扩展性
- 可以接受中等复杂度的重构
- 关注长期价值和技术探索
- 适当冒险，追求突破性改进`,
  },
  "harden": {
    label: "🛡️ Harden",
    description: "Focus on stability, reliability, and defensive improvements.",
    promptModifier: `
【进化策略: HARDEN】
系统存在警告信号，需要加强稳定性。
- 优先考虑可靠性和鲁棒性
- 避免大规模重构，专注增量改进
- 加强错误处理和边界情况
- 完善测试覆盖和监控`,
  },
  "repair-only": {
    label: "🔧 Repair Only",
    description: "Emergency mode. Fix critical issues only. Minimal changes.",
    promptModifier: `
【进化策略: REPAIR-ONLY】⚠️ 紧急修复模式
系统处于危险状态，只进行必要的修复。
- 只做最小改动修复关键问题
- 禁止重构或添加新功能
- 优先恢复系统稳定
- 每个改动必须直接解决现有问题`,
  },
  "balanced": {
    label: "⚖️ Balanced",
    description: "Balanced approach between innovation and stability.",
    promptModifier: `
【进化策略: BALANCED】
平衡创新与稳定的标准进化模式。
- 正常执行改进任务
- 保持合理的质量标准
- 在创新和稳定间取得平衡`,
  },
};

// ── Persistence ───────────────────────────────────────────────────

export function loadStrategyConfig(): StrategyConfig {
  try {
    if (existsSync(STRATEGY_PATH)) {
      const saved = JSON.parse(readFileSync(STRATEGY_PATH, "utf-8"));
      return {
        ...DEFAULT_CONFIG,
        ...saved,
        thresholds: { ...DEFAULT_THRESHOLDS, ...saved.thresholds },
        // Ensure new hysteresis fields have defaults for backward compatibility
        pendingSwitch: saved.pendingSwitch ?? null,
        confirmationCount: saved.confirmationCount ?? 0,
        requiredConfirmations: saved.requiredConfirmations ?? 2,
      };
    }
  } catch (e) {
    log.warn("Failed to load strategy config", { error: (e as Error).message });
  }
  return { ...DEFAULT_CONFIG };
}

export function saveStrategyConfig(config: StrategyConfig): void {
  try {
    writeFileSync(STRATEGY_PATH, JSON.stringify(config, null, 2));
  } catch (e: unknown) {
    log.error("Failed to save strategy config", { error: (e as Error).message });
  }
}

// ── System State Analysis ─────────────────────────────────────────

export function analyzeSystemState(): SystemState {
  const history = loadHealthHistory();
  const metrics = loadMetricsLocal();

  // Analyze health status
  const recentHealth = history.slice(-24); // Last 24 entries
  const criticalCount = recentHealth.filter(h => h.status === "critical").length;
  const warningCount = recentHealth.filter(h => h.status === "warning").length;
  
  let healthStatus: "healthy" | "degraded" | "critical" = "healthy";
  if (criticalCount > 0) {
    healthStatus = "critical";
  } else if (warningCount >= 3) {
    healthStatus = "degraded";
  }

  // Analyze evolution cycles
  const recentEvolutions = metrics.evolutionCycles.slice(-10);
  const failedCount = recentEvolutions.filter((e: { status: string }) => e.status === "failed").length;
  const recentFailureRate = recentEvolutions.length > 0 
    ? failedCount / recentEvolutions.length 
    : 0;

  // Count consecutive successes
  let consecutiveSuccesses = 0;
  for (let i = metrics.evolutionCycles.length - 1; i >= 0; i--) {
    if (metrics.evolutionCycles[i].status === "success") {
      consecutiveSuccesses++;
    } else {
      break;
    }
  }

  // Calculate average response time
  const recentPrompts = metrics.agentPrompts.slice(-20);
  const avgResponseTimeMs = recentPrompts.length > 0
    ? recentPrompts.reduce((sum: number, p: { durationMs: number }) => sum + p.durationMs, 0) / recentPrompts.length
    : 0;

  return {
    healthStatus,
    recentFailureRate,
    consecutiveSuccesses,
    recentHealthWarnings: warningCount,
    avgResponseTimeMs,
  };
}

// ── Strategy Selection ────────────────────────────────────────────

export function recommendStrategy(
  state: SystemState,
  thresholds: StrategyThresholds = DEFAULT_THRESHOLDS
): StrategyRecommendation {
  const reasons: string[] = [];
  let recommended: EvolutionStrategy;
  let confidence: number;

  // Critical conditions → repair-only
  if (state.healthStatus === "critical" || state.recentFailureRate > thresholds.failureRateCritical) {
    recommended = "repair-only";
    confidence = 0.9;
    if (state.healthStatus === "critical") {
      reasons.push(`Health status is CRITICAL`);
    }
    if (state.recentFailureRate > thresholds.failureRateCritical) {
      reasons.push(`Failure rate is ${(state.recentFailureRate * 100).toFixed(0)}% (>50%)`);
    }
  }
  // Warning conditions → harden
  else if (state.healthStatus === "degraded" || state.recentFailureRate > thresholds.failureRateWarning) {
    recommended = "harden";
    confidence = 0.8;
    if (state.healthStatus === "degraded") {
      reasons.push(`Health status is DEGRADED (${state.recentHealthWarnings} warnings)`);
    }
    if (state.recentFailureRate > thresholds.failureRateWarning) {
      reasons.push(`Failure rate is ${(state.recentFailureRate * 100).toFixed(0)}% (>20%)`);
    }
  }
  // Stable with consecutive successes → innovate
  else if (state.consecutiveSuccesses >= thresholds.consecutiveSuccesses && state.healthStatus === "healthy") {
    recommended = "innovate";
    confidence = 0.75;
    reasons.push(`${state.consecutiveSuccesses} consecutive successful evolutions`);
    reasons.push(`System is healthy and stable`);
  }
  // Default → balanced
  else {
    recommended = "balanced";
    confidence = 0.6;
    reasons.push("No strong signals, using balanced approach");
    if (state.consecutiveSuccesses > 0) {
      reasons.push(`${state.consecutiveSuccesses} consecutive successes`);
    }
  }

  return {
    recommended,
    confidence,
    reasons,
    currentState: state,
  };
}

// ── Strategy Management ───────────────────────────────────────────

export function setStrategy(
  newStrategy: EvolutionStrategy,
  reason: string,
  autoSelect: boolean = false
): void {
  const config = loadStrategyConfig();
  const oldStrategy = config.currentStrategy;

  if (oldStrategy === newStrategy && config.autoSelect === autoSelect) {
    return; // No change needed
  }

  config.currentStrategy = newStrategy;
  config.autoSelect = autoSelect;
  config.lastStrategyChange = new Date().toISOString();
  config.strategyHistory.push({
    timestamp: new Date().toISOString(),
    from: oldStrategy,
    to: newStrategy,
    reason,
  });

  // Keep only last 50 changes
  if (config.strategyHistory.length > 50) {
    config.strategyHistory = config.strategyHistory.slice(-50);
  }

  saveStrategyConfig(config);
  log.info(`Evolution strategy changed: ${oldStrategy} → ${newStrategy}`, { reason, autoSelect });
}

export function getCurrentStrategy(): EvolutionStrategy {
  const config = loadStrategyConfig();
  
  if (config.autoSelect) {
    const state = analyzeSystemState();
    const recommendation = recommendStrategy(state, config.thresholds);
    
    // Same strategy as current - clear any pending switch
    if (recommendation.recommended === config.currentStrategy) {
      if (config.pendingSwitch !== null || config.confirmationCount > 0) {
        config.pendingSwitch = null;
        config.confirmationCount = 0;
        saveStrategyConfig(config);
      }
      return config.currentStrategy;
    }
    
    // Different strategy recommended - apply hysteresis
    // Only update if confidence exceeds threshold
    if (recommendation.confidence <= 0.5) {
      return config.currentStrategy;
    }
    
    // Check if this matches the pending switch
    if (recommendation.recommended === config.pendingSwitch) {
      // Increment confirmation count
      config.confirmationCount++;
      
      // Check if we have enough confirmations
      if (config.confirmationCount >= config.requiredConfirmations) {
        // Execute the switch
        const newStrategy = recommendation.recommended;
        const oldStrategy = config.currentStrategy;
        
        config.currentStrategy = newStrategy;
        config.pendingSwitch = null;
        config.confirmationCount = 0;
        config.lastStrategyChange = new Date().toISOString();
        config.strategyHistory.push({
          timestamp: new Date().toISOString(),
          from: oldStrategy,
          to: newStrategy,
          reason: `Auto-selected after ${config.requiredConfirmations} confirmations: ${recommendation.reasons.join("; ")}`,
        });
        
        // Keep only last 50 changes
        if (config.strategyHistory.length > 50) {
          config.strategyHistory = config.strategyHistory.slice(-50);
        }
        
        saveStrategyConfig(config);
        log.info(`Evolution strategy switched (hysteresis): ${oldStrategy} → ${newStrategy}`, {
          confirmations: config.requiredConfirmations,
          reasons: recommendation.reasons,
        });
        
        return newStrategy;
      } else {
        // Still need more confirmations
        saveStrategyConfig(config);
        log.debug(`Strategy switch pending confirmation`, {
          pendingSwitch: config.pendingSwitch,
          confirmationCount: config.confirmationCount,
          required: config.requiredConfirmations,
        });
        return config.currentStrategy;
      }
    } else {
      // New recommendation different from pending - start fresh
      config.pendingSwitch = recommendation.recommended;
      config.confirmationCount = 1;
      saveStrategyConfig(config);
      log.debug(`New strategy recommendation pending`, {
        pendingSwitch: config.pendingSwitch,
        confidence: recommendation.confidence,
        reasons: recommendation.reasons,
      });
      return config.currentStrategy;
    }
  }
  
  return config.currentStrategy;
}

export function getStrategyPromptModifier(): string {
  const strategy = getCurrentStrategy();
  return STRATEGY_DESCRIPTIONS[strategy].promptModifier;
}

// ── Status Reporting ──────────────────────────────────────────────

export function formatStrategyStatus(): string {
  const config = loadStrategyConfig();
  const state = analyzeSystemState();
  const recommendation = recommendStrategy(state, config.thresholds);
  
  const currentStrategy = config.autoSelect 
    ? getCurrentStrategy() // This may trigger auto-update
    : config.currentStrategy;

  const lines: string[] = [
    "🎯 Evolution Strategy Status",
    "",
    `Current Strategy: ${STRATEGY_DESCRIPTIONS[currentStrategy].label}`,
    `Auto-select: ${config.autoSelect ? "ON" : "OFF"}`,
    `Last Change: ${new Date(config.lastStrategyChange).toLocaleString()}`,
    "",
    "📊 System State:",
    `  Health: ${state.healthStatus.toUpperCase()}`,
    `  Recent Failure Rate: ${(state.recentFailureRate * 100).toFixed(1)}%`,
    `  Consecutive Successes: ${state.consecutiveSuccesses}`,
    `  Health Warnings: ${state.recentHealthWarnings}`,
    `  Avg Response Time: ${(state.avgResponseTimeMs / 1000).toFixed(1)}s`,
    "",
  ];

  if (config.autoSelect) {
    lines.push(`🤖 Auto-select Recommendation: ${STRATEGY_DESCRIPTIONS[recommendation.recommended].label}`);
    lines.push(`   Confidence: ${(recommendation.confidence * 100).toFixed(0)}%`);
    lines.push(`   Reasons:`);
    recommendation.reasons.forEach(r => lines.push(`     • ${r}`));
    
    // Show hysteresis state
    if (config.pendingSwitch) {
      lines.push("");
      lines.push(`⏳ Pending Switch: ${STRATEGY_DESCRIPTIONS[config.pendingSwitch].label}`);
      lines.push(`   Confirmations: ${config.confirmationCount}/${config.requiredConfirmations}`);
    } else if (recommendation.recommended !== currentStrategy) {
      lines.push("");
      lines.push(`⏳ New recommendation pending confirmation`);
    }
    lines.push("");
  }

  if (config.strategyHistory.length > 0) {
    lines.push("📜 Recent Strategy Changes:");
    const recent = config.strategyHistory.slice(-5).reverse();
    recent.forEach(change => {
      const time = new Date(change.timestamp).toLocaleTimeString();
      lines.push(`  ${time}: ${change.from} → ${change.to}`);
      lines.push(`    ${change.reason}`);
    });
    lines.push("");
  }

  lines.push(STRATEGY_DESCRIPTIONS[currentStrategy].description);

  return lines.join("\n");
}

// ── Strategy Control ─────────────────────────────────────────────

export function forceStrategy(strategy: EvolutionStrategy, reason: string): void {
  const config = loadStrategyConfig();
  
  // Reset hysteresis state on manual override
  config.pendingSwitch = null;
  config.confirmationCount = 0;
  
  // Record the change
  const oldStrategy = config.currentStrategy;
  config.currentStrategy = strategy;
  config.autoSelect = false;
  config.lastStrategyChange = new Date().toISOString();
  config.strategyHistory.push({
    timestamp: new Date().toISOString(),
    from: oldStrategy,
    to: strategy,
    reason: `Manual override: ${reason}`,
  });
  
  // Keep only last 50 changes
  if (config.strategyHistory.length > 50) {
    config.strategyHistory = config.strategyHistory.slice(-50);
  }
  
  saveStrategyConfig(config);
  log.info(`Strategy manually set to ${strategy}`, { reason });
}

export function enableAutoSelect(): void {
  const config = loadStrategyConfig();
  config.autoSelect = true;
  // Reset hysteresis state when re-enabling auto-select
  config.pendingSwitch = null;
  config.confirmationCount = 0;
  saveStrategyConfig(config);
  log.info("Strategy auto-selection enabled");
}

export function disableAutoSelect(): void {
  const config = loadStrategyConfig();
  config.autoSelect = false;
  saveStrategyConfig(config);
  log.info("Strategy auto-selection disabled");
}
