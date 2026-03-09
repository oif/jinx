/**
 * Tests for Metacognitive Module - Confidence Tracking and Calibration
 * 
 * Tests the core metacognitive capabilities:
 * - Decision tracking with confidence scores
 * - Outcome recording for calibration
 * - Calibration statistics calculation
 * - Overconfidence/underconfidence warnings
 * - Metacognitive report generation
 */

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import {
  trackDecision,
  recordDecisionOutcome,
  calculateCalibrationStats,
  checkCalibrationWarnings,
  generateMetacognitiveReport,
  getActiveWarnings,
  getRecentDecisions,
  acknowledgeWarning,
  formatMetacognitiveReportSummary,
  // Types
  type ConfidenceTrack,
  type DecisionOutcome,
  type ConfidenceCalibrationStats,
  type ConfidenceWarning,
  type MetacognitiveReport,
} from "../src/memory/metacognitive.js";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Test data directory
const TEST_DATA_DIR = join(process.cwd(), "data", "memory");
const TEST_METACOGNITIVE_PATH = join(TEST_DATA_DIR, "metacognitive.json");

// Helper to clean up test data
function cleanupTestData() {
  if (existsSync(TEST_METACOGNITIVE_PATH)) {
    rmSync(TEST_METACOGNITIVE_PATH, { force: true });
  }
}

describe("Metacognitive Confidence Tracking", () => {
  beforeEach(() => {
    // Clean up before each test
    cleanupTestData();
  });

  afterEach(() => {
    // Clean up after each test
    cleanupTestData();
  });

  describe("trackDecision()", () => {
    it("should track a decision with confidence score", () => {
      const track = trackDecision({
        decisionContext: "Choosing between REST and GraphQL for API design",
        decisionCategory: "architecture",
        statedConfidence: 0.75,
        evolutionId: "test-evo-001",
        notes: "Based on previous experience with similar projects",
      });

      expect(track.id).toBeTruthy();
      expect(track.timestamp).toBeTruthy();
      expect(track.decisionContext).toBe("Choosing between REST and GraphQL for API design");
      expect(track.decisionCategory).toBe("architecture");
      expect(track.statedConfidence).toBe(0.75);
      expect(track.confidenceLevel).toBe("medium");
      expect(track.evolutionId).toBe("test-evo-001");
      expect(track.outcome).toBeUndefined();
    });

    it("should assign correct confidence levels", () => {
      // High confidence (>= 0.8)
      const highTrack = trackDecision({
        decisionContext: "Test high",
        decisionCategory: "test",
        statedConfidence: 0.85,
      });
      expect(highTrack.confidenceLevel).toBe("high");

      // Medium confidence (>= 0.5, < 0.8)
      const mediumTrack = trackDecision({
        decisionContext: "Test medium",
        decisionCategory: "test",
        statedConfidence: 0.6,
      });
      expect(mediumTrack.confidenceLevel).toBe("medium");

      // Low confidence (>= 0.2, < 0.5)
      const lowTrack = trackDecision({
        decisionContext: "Test low",
        decisionCategory: "test",
        statedConfidence: 0.3,
      });
      expect(lowTrack.confidenceLevel).toBe("low");

      // Unknown confidence (< 0.2)
      const unknownTrack = trackDecision({
        decisionContext: "Test unknown",
        decisionCategory: "test",
        statedConfidence: 0.1,
      });
      expect(unknownTrack.confidenceLevel).toBe("unknown");
    });

    it("should persist tracked decisions", () => {
      trackDecision({
        decisionContext: "First decision",
        decisionCategory: "code-change",
        statedConfidence: 0.7,
      });

      trackDecision({
        decisionContext: "Second decision",
        decisionCategory: "testing",
        statedConfidence: 0.8,
      });

      const recentDecisions = getRecentDecisions(10);
      expect(recentDecisions.length).toBe(2);
      expect(recentDecisions[0].decisionContext).toBe("First decision");
      expect(recentDecisions[1].decisionContext).toBe("Second decision");
    });
  });

  describe("recordDecisionOutcome()", () => {
    it("should record outcome and calculate calibration for success", () => {
      const track = trackDecision({
        decisionContext: "Implementing caching layer",
        decisionCategory: "architecture",
        statedConfidence: 0.8,
      });

      const result = recordDecisionOutcome(track.id, "success");
      expect(result).toBe(true);

      const recentDecisions = getRecentDecisions(1);
      const updated = recentDecisions[0];
      
      expect(updated.outcome).toBe("success");
      expect(updated.actualConfidence).toBe(1.0);
      expect(updated.calibrationError).toBeDefined();
      // Use approximate comparison for floating-point precision
      expect(Math.abs(updated.calibrationError! - (-0.2))).toBeLessThan(0.0001);
      expect(updated.calibrationCategory).toBe("well-calibrated");
    });

    it("should record outcome and calculate calibration for failure", () => {
      const track = trackDecision({
        decisionContext: "Optimistic database query",
        decisionCategory: "code-change",
        statedConfidence: 0.9,
      });

      recordDecisionOutcome(track.id, "failure");

      const recentDecisions = getRecentDecisions(1);
      const updated = recentDecisions[0];
      
      expect(updated.outcome).toBe("failure");
      expect(updated.actualConfidence).toBe(0.0);
      expect(updated.calibrationError).toBe(0.9);
      expect(updated.calibrationCategory).toBe("overconfident");
    });

    it("should handle partial outcomes", () => {
      const track = trackDecision({
        decisionContext: "Partial solution attempt",
        decisionCategory: "code-change",
        statedConfidence: 0.5,
      });

      recordDecisionOutcome(track.id, "partial");

      const recentDecisions = getRecentDecisions(1);
      const updated = recentDecisions[0];
      
      expect(updated.outcome).toBe("partial");
      expect(updated.actualConfidence).toBe(0.5);
      expect(updated.calibrationError).toBe(0);
      expect(updated.calibrationCategory).toBe("well-calibrated");
    });

    it("should return false for non-existent decision", () => {
      const result = recordDecisionOutcome("non-existent-id", "success");
      expect(result).toBe(false);
    });
  });

  describe("calculateCalibrationStats()", () => {
    it("should return empty stats when no decisions", () => {
      const stats = calculateCalibrationStats();
      
      expect(stats.totalDecisions).toBe(0);
      expect(stats.decisionsWithOutcome).toBe(0);
      expect(stats.calibrationAccuracy).toBe(0);
    });

    it("should calculate calibration statistics correctly", () => {
      // Create a series of decisions with various outcomes
      const decisions = [
        { confidence: 0.9, outcome: "success" as DecisionOutcome },
        { confidence: 0.8, outcome: "success" as DecisionOutcome },
        { confidence: 0.7, outcome: "failure" as DecisionOutcome },
        { confidence: 0.4, outcome: "success" as DecisionOutcome },
        { confidence: 0.6, outcome: "partial" as DecisionOutcome },
      ];

      for (const d of decisions) {
        const track = trackDecision({
          decisionContext: `Decision with confidence ${d.confidence}`,
          decisionCategory: "test",
          statedConfidence: d.confidence,
        });
        recordDecisionOutcome(track.id, d.outcome);
      }

      const stats = calculateCalibrationStats();
      
      expect(stats.totalDecisions).toBe(5);
      expect(stats.decisionsWithOutcome).toBe(5);
      expect(stats.avgCalibrationError).toBeDefined();
      expect(stats.brierScore).toBeGreaterThanOrEqual(0);
      expect(stats.calibrationAccuracy).toBeGreaterThanOrEqual(0);
      expect(stats.calibrationAccuracy).toBeLessThanOrEqual(1);
    });

    it("should track calibration by category", () => {
      const track1 = trackDecision({
        decisionContext: "Architecture decision",
        decisionCategory: "architecture",
        statedConfidence: 0.8,
      });
      recordDecisionOutcome(track1.id, "success");

      const track2 = trackDecision({
        decisionContext: "Testing decision",
        decisionCategory: "testing",
        statedConfidence: 0.7,
      });
      recordDecisionOutcome(track2.id, "failure");

      const stats = calculateCalibrationStats();
      
      expect(stats.calibrationByCategory["architecture"]).toBeDefined();
      expect(stats.calibrationByCategory["testing"]).toBeDefined();
      expect(stats.calibrationByCategory["architecture"].count).toBe(1);
      expect(stats.calibrationByCategory["testing"].count).toBe(1);
    });
  });

  describe("checkCalibrationWarnings()", () => {
    it("should not generate warnings without enough decisions", () => {
      // Create only 3 decisions (below MIN_DECISIONS_FOR_CALIBRATION = 5)
      for (let i = 0; i < 3; i++) {
        const track = trackDecision({
          decisionContext: `Decision ${i}`,
          decisionCategory: "test",
          statedConfidence: 0.9,
        });
        recordDecisionOutcome(track.id, "failure");
      }

      const warnings = checkCalibrationWarnings();
      expect(warnings.length).toBe(0);
    });

    it("should detect overconfidence", () => {
      // Create 6 overconfident decisions
      for (let i = 0; i < 6; i++) {
        const track = trackDecision({
          decisionContext: `Overconfident decision ${i}`,
          decisionCategory: "test",
          statedConfidence: 0.9,
        });
        recordDecisionOutcome(track.id, "failure");
      }

      const warnings = checkCalibrationWarnings();
      
      const overconfidenceWarning = warnings.find(w => w.type === "overconfidence");
      expect(overconfidenceWarning).toBeDefined();
      expect(overconfidenceWarning!.severity).toBeDefined();
      expect(overconfidenceWarning!.recommendations.length).toBeGreaterThan(0);
    });

    it("should detect underconfidence", () => {
      // Create 6 underconfident decisions
      for (let i = 0; i < 6; i++) {
        const track = trackDecision({
          decisionContext: `Underconfident decision ${i}`,
          decisionCategory: "test",
          statedConfidence: 0.2,
        });
        recordDecisionOutcome(track.id, "success");
      }

      const warnings = checkCalibrationWarnings();
      
      const underconfidenceWarning = warnings.find(w => w.type === "underconfidence");
      expect(underconfidenceWarning).toBeDefined();
    });
  });

  describe("getActiveWarnings()", () => {
    it("should return only unacknowledged warnings", () => {
      // Create decisions that trigger warnings
      for (let i = 0; i < 6; i++) {
        const track = trackDecision({
          decisionContext: `Decision ${i}`,
          decisionCategory: "test",
          statedConfidence: 0.95,
        });
        recordDecisionOutcome(track.id, "failure");
      }

      checkCalibrationWarnings();
      const allWarnings = getActiveWarnings();
      
      expect(allWarnings.length).toBeGreaterThan(0);
      
      // Acknowledge first warning
      if (allWarnings.length > 0) {
        const acknowledged = acknowledgeWarning(allWarnings[0].id);
        expect(acknowledged).toBe(true);
        
        const remainingWarnings = getActiveWarnings();
        expect(remainingWarnings.length).toBe(allWarnings.length - 1);
      }
    });
  });

  describe("generateMetacognitiveReport()", () => {
    it("should generate a comprehensive report", () => {
      // Create some decisions
      for (let i = 0; i < 5; i++) {
        const track = trackDecision({
          decisionContext: `Decision ${i}`,
          decisionCategory: i % 2 === 0 ? "architecture" : "testing",
          statedConfidence: 0.6 + i * 0.05,
          evolutionId: `evo-${i}`,
        });
        recordDecisionOutcome(track.id, i % 3 === 0 ? "success" : "partial");
      }

      const report = generateMetacognitiveReport("test-evolution-001");
      
      expect(report.id).toBeTruthy();
      expect(report.timestamp).toBeTruthy();
      expect(report.evolutionId).toBe("test-evolution-001");
      
      // Check confidence tracking section
      expect(report.confidenceTracking.recentDecisions).toBeTruthy();
      expect(report.confidenceTracking.calibrationStats).toBeTruthy();
      expect(Array.isArray(report.confidenceTracking.activeWarnings)).toBe(true);
      
      // Check self-assessment section
      expect(typeof report.selfAssessment.avgStatedConfidence).toBe("number");
      expect(typeof report.selfAssessment.avgCalibratedConfidence).toBe("number");
      expect(report.selfAssessment.confidenceDistribution).toBeTruthy();
      
      // Check knowledge state section
      expect(typeof report.knowledgeState.unresolvedBlindSpots).toBe("number");
      expect(typeof report.knowledgeState.pendingFeedback).toBe("number");
      
      // Check recommendations
      expect(Array.isArray(report.recommendations)).toBe(true);
      
      // Check health assessment
      expect(["excellent", "good", "fair", "poor"]).toContain(report.metacognitiveHealth);
      expect(report.healthScore).toBeGreaterThanOrEqual(0);
      expect(report.healthScore).toBeLessThanOrEqual(1);
    });

    it("should calculate metacognitive health correctly", () => {
      // Create well-calibrated decisions
      for (let i = 0; i < 5; i++) {
        const track = trackDecision({
          decisionContext: `Well-calibrated decision ${i}`,
          decisionCategory: "test",
          statedConfidence: 0.5,
        });
        recordDecisionOutcome(track.id, "partial");
      }

      const report = generateMetacognitiveReport();
      
      expect(report.healthScore).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe("formatMetacognitiveReportSummary()", () => {
    it("should format report for display", () => {
      // Create some decisions
      for (let i = 0; i < 3; i++) {
        const track = trackDecision({
          decisionContext: `Decision ${i}`,
          decisionCategory: "test",
          statedConfidence: 0.7,
        });
        recordDecisionOutcome(track.id, "success");
      }

      const report = generateMetacognitiveReport("test-evo");
      const summary = formatMetacognitiveReportSummary(report);
      
      expect(summary).toContain("🧠 Metacognitive Report");
      expect(summary).toContain("Metacognitive Health");
      expect(summary).toContain("Confidence Tracking");
      expect(summary).toContain("Calibration Breakdown");
      expect(summary).toContain("Recommendations");
    });
  });

  describe("Integration tests", () => {
    it("should support full confidence tracking lifecycle", () => {
      // 1. Track a decision before making it
      const track = trackDecision({
        decisionContext: "Implementing rate limiting with exponential backoff",
        decisionCategory: "architecture",
        statedConfidence: 0.85,
        notes: "Based on research and previous experience",
      });
      
      expect(track.id).toBeTruthy();
      expect(track.confidenceLevel).toBe("high");

      // 2. Simulate the decision outcome (e.g., after evolution completes)
      const outcomeRecorded = recordDecisionOutcome(track.id, "success", "Implementation worked well");
      expect(outcomeRecorded).toBe(true);

      // 3. Check calibration statistics
      const stats = calculateCalibrationStats();
      expect(stats.totalDecisions).toBe(1);
      expect(stats.decisionsWithOutcome).toBe(1);

      // 4. Check for warnings (should be none with good calibration)
      const warnings = checkCalibrationWarnings();
      // With only 1 decision and MIN_DECISIONS_FOR_CALIBRATION = 5, no warnings should be generated
      expect(warnings.length).toBe(0);

      // 5. Generate a report
      const report = generateMetacognitiveReport("integration-test-evo");
      expect(report.id).toBeTruthy();
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it("should track multiple decisions across categories", () => {
      const categories = ["architecture", "testing", "code-change", "deployment"];
      
      for (let i = 0; i < 10; i++) {
        const category = categories[i % categories.length];
        const track = trackDecision({
          decisionContext: `Decision in ${category}`,
          decisionCategory: category,
          statedConfidence: 0.5 + Math.random() * 0.4,
        });
        
        // Random outcome
        const outcomes: DecisionOutcome[] = ["success", "failure", "partial"];
        recordDecisionOutcome(track.id, outcomes[i % 3]);
      }

      const stats = calculateCalibrationStats();
      
      expect(stats.totalDecisions).toBe(10);
      expect(stats.decisionsWithOutcome).toBe(10);
      
      // Check all categories are tracked
      for (const category of categories) {
        expect(stats.calibrationByCategory[category]).toBeDefined();
      }
    });
  });
});