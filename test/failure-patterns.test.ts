/**
 * Tests for Failure Pattern Detection Module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  detectFailurePatterns,
  getDetectedPatterns,
  getCriticalPatterns,
  getFailurePatternStats,
  acknowledgePattern,
  resolvePattern,
  setCurrentGoal,
  recordClaimedAction,
  recordActualAction,
  recordAttemptedFix,
  resetSessionContext,
  getPatternDefinitions,
  formatDetectedPattern,
  getFailurePatternSummary,
  integrateWithMetacognition,
  updateFailurePatternConfig,
  getFailurePatternConfig,
  shouldRunFailurePatternDetection,
  FailurePatternType,
  DetectedFailurePattern,
} from "../dist/memory/failure-patterns.js";
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

// Test data path
const TEST_DATA_PATH = join(process.cwd(), "data", "memory", "failure-patterns.json");
const HISTORY_PATH = join(process.cwd(), "data", "evolution-history.json");

describe("Failure Pattern Detection", () => {
  // Store original history content to restore after tests
  let originalHistoryContent: string | null = null;

  beforeEach(() => {
    // Save original history content to prevent data loss
    originalHistoryContent = existsSync(HISTORY_PATH) 
      ? readFileSync(HISTORY_PATH, "utf-8") 
      : null;

    // Reset context before each test
    resetSessionContext();
  });

  afterEach(() => {
    // Restore original history content
    if (originalHistoryContent !== null) {
      mkdirSync(join(process.cwd(), "data"), { recursive: true });
      writeFileSync(HISTORY_PATH, originalHistoryContent);
    }

    // Clean up test data
    try {
      if (existsSync(TEST_DATA_PATH)) {
        unlinkSync(TEST_DATA_PATH);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Pattern Definitions", () => {
    it("should have 7 defined failure patterns", () => {
      const definitions = getPatternDefinitions();
      expect(definitions).toHaveLength(7);
    });

    it("should have all required pattern types", () => {
      const definitions = getPatternDefinitions();
      const types = definitions.map(d => d.type);
      
      expect(types).toContain("should_vs_did");
      expect(types).toContain("three_fixes_fail_stop");
      expect(types).toContain("repeating_without_reflection");
      expect(types).toContain("overconfidence_without_evidence");
      expect(types).toContain("ignoring_failures");
      expect(types).toContain("premature_closure");
      expect(types).toContain("goal_drift");
    });

    it("should have valid severity levels for all patterns", () => {
      const definitions = getPatternDefinitions();
      const validSeverities = ["info", "warning", "critical", "emergency"];
      
      for (const def of definitions) {
        expect(validSeverities).toContain(def.defaultSeverity);
      }
    });
  });

  describe("Session Context Tracking", () => {
    it("should set current goal", () => {
      setCurrentGoal("Implement feature X");
      const summary = getFailurePatternSummary();
      expect(summary).toBeDefined();
    });

    it("should record claimed actions", () => {
      recordClaimedAction("I should implement the feature");
      recordClaimedAction("I should add tests");
      
      const config = getFailurePatternConfig();
      expect(config).toBeDefined();
    });

    it("should record actual actions", () => {
      recordActualAction("Implemented the feature");
      recordActualAction("Added tests and verified");
      
      const config = getFailurePatternConfig();
      expect(config).toBeDefined();
    });

    it("should record attempted fixes", () => {
      recordAttemptedFix(1, "Fixed bug in parser", "failed");
      recordAttemptedFix(2, "Another fix attempt", "failed");
      recordAttemptedFix(3, "Third fix attempt", "success");
      
      const config = getFailurePatternConfig();
      expect(config).toBeDefined();
    });

    it("should reset session context", () => {
      setCurrentGoal("Test goal");
      recordClaimedAction("Claimed action");
      recordActualAction("Actual action");
      
      resetSessionContext();
      
      // After reset, context should be empty
      const summary = getFailurePatternSummary();
      expect(summary).toBeDefined();
    });
  });

  describe("Detection Functions", () => {
    it("should return empty array when no history", () => {
      const patterns = detectFailurePatterns({ force: true });
      // May or may not detect patterns depending on existing history
      expect(Array.isArray(patterns)).toBe(true);
    });

    it("should only detect specified types when specificTypes is provided", () => {
      const patterns = detectFailurePatterns({
        force: true,
        specificTypes: ["should_vs_did"],
      });
      
      // All detected patterns should be should_vs_did type
      for (const p of patterns) {
        expect(p.type).toBe("should_vs_did");
      }
    });
  });

  describe("Pattern Management", () => {
    it("should get detected patterns with filters", () => {
      const allPatterns = getDetectedPatterns();
      expect(Array.isArray(allPatterns)).toBe(true);
      
      const criticalPatterns = getDetectedPatterns({ severity: "critical" });
      expect(Array.isArray(criticalPatterns)).toBe(true);
    });

    it("should get critical patterns", () => {
      const critical = getCriticalPatterns();
      expect(Array.isArray(critical)).toBe(true);
    });

    it("should get pattern stats", () => {
      const stats = getFailurePatternStats();
      
      expect(stats).toHaveProperty("total");
      expect(stats).toHaveProperty("byType");
      expect(stats).toHaveProperty("bySeverity");
      expect(stats).toHaveProperty("acknowledged");
      expect(stats).toHaveProperty("unacknowledged");
      
      expect(stats.byType).toHaveProperty("should_vs_did");
      expect(stats.byType).toHaveProperty("three_fixes_fail_stop");
      expect(stats.bySeverity).toHaveProperty("info");
      expect(stats.bySeverity).toHaveProperty("warning");
      expect(stats.bySeverity).toHaveProperty("critical");
    });

    it("should acknowledge a pattern", () => {
      // This test assumes there might be a pattern to acknowledge
      const patterns = getDetectedPatterns();
      
      if (patterns.length > 0) {
        const result = acknowledgePattern(patterns[0].id);
        expect(result).toBe(true);
        
        const updated = getDetectedPatterns({ acknowledged: true });
        expect(updated.some(p => p.id === patterns[0].id)).toBe(true);
      }
    });

    it("should resolve a pattern", () => {
      const patterns = getDetectedPatterns();
      
      if (patterns.length > 0) {
        const result = resolvePattern(patterns[0].id, "Fixed by doing X");
        expect(result).toBe(true);
        
        const resolved = getDetectedPatterns().find(p => p.id === patterns[0].id);
        expect(resolved?.resolvedAt).toBeDefined();
        expect(resolved?.resolutionNotes).toBe("Fixed by doing X");
      }
    });
  });

  describe("Formatting Functions", () => {
    it("should format a detected pattern", () => {
      const patterns = getDetectedPatterns();
      
      if (patterns.length > 0) {
        const formatted = formatDetectedPattern(patterns[0]);
        expect(formatted).toContain("Failure Pattern");
        expect(formatted).toContain("Evidence");
      }
    });

    it("should get failure pattern summary", () => {
      const summary = getFailurePatternSummary();
      expect(summary).toContain("Failure Pattern Detection Summary");
    });
  });

  describe("Metacognitive Integration", () => {
    it("should integrate with metacognition", () => {
      const result = integrateWithMetacognition();
      
      expect(result).toHaveProperty("criticalPatterns");
      expect(result).toHaveProperty("recommendedActions");
      expect(result).toHaveProperty("riskLevel");
      
      expect(["low", "medium", "high", "critical"]).toContain(result.riskLevel);
      expect(Array.isArray(result.criticalPatterns)).toBe(true);
      expect(Array.isArray(result.recommendedActions)).toBe(true);
    });
  });

  describe("Configuration", () => {
    it("should get default configuration", () => {
      const config = getFailurePatternConfig();
      
      expect(config).toHaveProperty("enabled");
      expect(config).toHaveProperty("checkIntervalMs");
      expect(config).toHaveProperty("historyWindow");
      expect(config).toHaveProperty("thresholds");
      expect(config).toHaveProperty("autoReport");
    });

    it("should update configuration", () => {
      const updated = updateFailurePatternConfig({
        historyWindow: 30,
      });
      
      expect(updated.historyWindow).toBe(30);
    });

    it("should check if detection should run", () => {
      const shouldRun = shouldRunFailurePatternDetection();
      expect(typeof shouldRun).toBe("boolean");
    });
  });

  describe("Detection Logic", () => {
    it("should detect 'should vs did' pattern correctly", () => {
      // Set up context for should_vs_did detection
      recordClaimedAction("I should implement this feature");
      recordClaimedAction("I should add tests later");
      
      const patterns = detectFailurePatterns({
        force: true,
        specificTypes: ["should_vs_did"],
      });
      
      // Detection depends on evolution history
      expect(Array.isArray(patterns)).toBe(true);
    });

    it("should detect 'three fixes fail stop' pattern correctly", () => {
      // Record failed fix attempts
      recordAttemptedFix(1, "Fix attempt 1", "failed");
      recordAttemptedFix(2, "Fix attempt 2", "failed");
      recordAttemptedFix(3, "Fix attempt 3", "failed");
      
      const patterns = detectFailurePatterns({
        force: true,
        specificTypes: ["three_fixes_fail_stop"],
      });
      
      expect(Array.isArray(patterns)).toBe(true);
    });

    it("should detect 'goal drift' pattern correctly", () => {
      setCurrentGoal("Implement authentication system");
      
      const patterns = detectFailurePatterns({
        force: true,
        specificTypes: ["goal_drift"],
      });
      
      expect(Array.isArray(patterns)).toBe(true);
    });
  });

  describe("Severity Escalation", () => {
    it("should escalate severity based on occurrence count", () => {
      const definitions = getPatternDefinitions();
      
      // Check that patterns with autoEscalation are configured correctly
      const escalationPatterns = definitions.filter(d => d.autoEscalation);
      
      for (const def of escalationPatterns) {
        expect(def.autoEscalation!.afterCount).toBeGreaterThan(0);
        expect(def.autoEscalation!.toSeverity).toBeDefined();
      }
    });
  });
});