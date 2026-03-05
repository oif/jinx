/**
 * Tests for Principle Voting Module
 * 
 * ACE Pattern (Aegis Memory 2026) Memory Voting implementation tests.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  voteOnPrinciple,
  calculateEffectiveness,
  getPrinciplesByEffectiveness,
  getVotingStats,
  getVotingReviewRecommendations,
  analyzeVotingPatterns,
  getTopEffectivePrinciples,
  getPrinciplesNeedingAttention,
  voteOnPrincipleQuick,
  formatVotingStats,
  type VoteType,
  type VotingContext,
} from "../src/memory/principle-voting.js";
import {
  storePrinciple,
  getPrinciple,
  getPrincipleStats,
  type PrincipleCategory,
} from "../src/memory/principle-store.js";

// In-memory store for mocking file system persistence
// Using vi.hoisted to ensure the variable is available when mock is set up
const mockFiles = vi.hoisted(() => new Map<string, string>());

// Mock the file system with persistent state
vi.mock("node:fs", () => ({
  readFileSync: vi.fn((path: string) => mockFiles.get(path) ?? "[]"),
  writeFileSync: vi.fn((path: string, data: string) => { mockFiles.set(path, data); }),
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
}));

// Mock the paths
vi.mock("../src/supervisor/paths.js", () => ({
  DATA_DIR: "/tmp/test-data",
}));

describe("Principle Voting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFiles.clear(); // Clear the in-memory store between tests
  });

  describe("calculateEffectiveness", () => {
    it("should calculate effectiveness correctly for all helpful votes", () => {
      const effectiveness = calculateEffectiveness(10, 0, 0);
      // (10 - 0) / (10 + 0 + 0 + 1) = 10/11 ≈ 0.91
      expect(effectiveness).toBeCloseTo(0.91, 1);
    });

    it("should calculate effectiveness correctly for all harmful votes", () => {
      const effectiveness = calculateEffectiveness(0, 10, 0);
      // (0 - 10) / (0 + 10 + 0 + 1) = -10/11 ≈ -0.91
      expect(effectiveness).toBeCloseTo(-0.91, 1);
    });

    it("should calculate effectiveness correctly for mixed votes", () => {
      const effectiveness = calculateEffectiveness(5, 3, 2);
      // (5 - 3) / (5 + 3 + 2 + 1) = 2/11 ≈ 0.18
      expect(effectiveness).toBeCloseTo(0.18, 1);
    });

    it("should handle zero votes with smoothing", () => {
      const effectiveness = calculateEffectiveness(0, 0, 0);
      // (0 - 0) / (0 + 0 + 0 + 1) = 0/1 = 0
      expect(effectiveness).toBe(0);
    });

    it("should calculate effectiveness correctly for equal helpful/harmful", () => {
      const effectiveness = calculateEffectiveness(5, 5, 0);
      // (5 - 5) / (5 + 5 + 0 + 1) = 0/11 = 0
      expect(effectiveness).toBe(0);
    });

    it("should give slight negative for more harmful than helpful", () => {
      const effectiveness = calculateEffectiveness(3, 7, 0);
      // (3 - 7) / (3 + 7 + 0 + 1) = -4/11 ≈ -0.36
      expect(effectiveness).toBeCloseTo(-0.36, 1);
    });
  });

  describe("voteOnPrinciple", () => {
    it("should return null for non-existent principle", () => {
      const context: VotingContext = {
        evolutionId: "#001",
        reason: "Test vote",
      };
      const result = voteOnPrinciple("non_existent", "helpful", context);
      expect(result).toBeNull();
    });

    it("should record a helpful vote and update effectiveness", () => {
      // Store a principle first
      const principle = storePrinciple({
        content: "Test principle for voting",
        category: "coding" as PrincipleCategory,
        derivedFrom: ["test-001"],
      });

      const context: VotingContext = {
        evolutionId: "#001",
        reason: "Principle helped solve the problem",
      };

      const result = voteOnPrinciple(principle.id, "helpful", context);

      expect(result).not.toBeNull();
      expect(result!.vote).toBe("helpful");
      expect(result!.helpful).toBe(1);
      expect(result!.harmful).toBe(0);
      expect(result!.totalVotes).toBe(1);
      // effectiveness = (1 - 0) / (1 + 1) = 0.5
      expect(result!.newEffectiveness).toBeCloseTo(0.5, 2);
    });

    it("should record a harmful vote and update effectiveness", () => {
      const principle = storePrinciple({
        content: "Test principle for harmful voting",
        category: "testing" as PrincipleCategory,
        derivedFrom: ["test-002"],
      });

      const context: VotingContext = {
        evolutionId: "#002",
        reason: "Principle led to wrong decision",
      };

      const result = voteOnPrinciple(principle.id, "harmful", context);

      expect(result).not.toBeNull();
      expect(result!.vote).toBe("harmful");
      expect(result!.helpful).toBe(0);
      expect(result!.harmful).toBe(1);
      // effectiveness = (0 - 1) / (1 + 1) = -0.5
      expect(result!.newEffectiveness).toBeCloseTo(-0.5, 2);
    });

    it("should record a neutral vote without changing helpful/harmful counts", () => {
      const principle = storePrinciple({
        content: "Test principle for neutral voting",
        category: "general" as PrincipleCategory,
        derivedFrom: ["test-003"],
      });

      const context: VotingContext = {
        evolutionId: "#003",
        reason: "Principle was neither helpful nor harmful",
      };

      const result = voteOnPrinciple(principle.id, "neutral", context);

      expect(result).not.toBeNull();
      expect(result!.vote).toBe("neutral");
      expect(result!.helpful).toBe(0);
      expect(result!.harmful).toBe(0);
      expect(result!.totalVotes).toBe(1);
      // effectiveness = (0 - 0) / (1 + 1) = 0
      expect(result!.newEffectiveness).toBe(0);
    });

    it("should accumulate votes correctly", () => {
      const principle = storePrinciple({
        content: "Test principle for multiple votes",
        category: "coding" as PrincipleCategory,
        derivedFrom: ["test-004"],
      });

      // Cast multiple votes
      voteOnPrinciple(principle.id, "helpful", { evolutionId: "#004" });
      voteOnPrinciple(principle.id, "helpful", { evolutionId: "#005" });
      voteOnPrinciple(principle.id, "harmful", { evolutionId: "#006" });

      const updated = getPrinciple(principle.id);
      expect(updated).not.toBeNull();
      expect(updated!.voting.totalVotes).toBe(3);
      expect(updated!.voting.helpful).toBe(2);
      expect(updated!.voting.harmful).toBe(1);
      // effectiveness = (2 - 1) / (3 + 1) = 0.25
      expect(updated!.voting.effectiveness).toBeCloseTo(0.25, 2);
    });
  });

  describe("getVotingStats", () => {
    it("should return null for non-existent principle", () => {
      const stats = getVotingStats("non_existent");
      expect(stats).toBeNull();
    });

    it("should return voting stats for a principle with votes", () => {
      const principle = storePrinciple({
        content: "Test principle for stats",
        category: "coding" as PrincipleCategory,
        derivedFrom: ["test-005"],
      });

      voteOnPrinciple(principle.id, "helpful", { evolutionId: "#007" });
      voteOnPrinciple(principle.id, "helpful", { evolutionId: "#008" });
      voteOnPrinciple(principle.id, "neutral", { evolutionId: "#009" });

      const stats = getVotingStats(principle.id);

      expect(stats).not.toBeNull();
      expect(stats!.totalVotes).toBe(3);
      expect(stats!.helpful).toBe(2);
      expect(stats!.harmful).toBe(0);
      expect(stats!.neutral).toBe(1);
    });
  });

  describe("getPrinciplesByEffectiveness", () => {
    it("should return principles sorted by effectiveness", () => {
      // Create principles with different voting patterns
      const p1 = storePrinciple({
        content: "Low effectiveness principle",
        category: "coding" as PrincipleCategory,
        derivedFrom: ["test-006"],
      });

      const p2 = storePrinciple({
        content: "High effectiveness principle",
        category: "coding" as PrincipleCategory,
        derivedFrom: ["test-007"],
      });

      // Vote on them
      voteOnPrinciple(p1.id, "harmful", { evolutionId: "#010" });
      voteOnPrinciple(p1.id, "harmful", { evolutionId: "#011" });
      voteOnPrinciple(p1.id, "harmful", { evolutionId: "#012" });

      voteOnPrinciple(p2.id, "helpful", { evolutionId: "#013" });
      voteOnPrinciple(p2.id, "helpful", { evolutionId: "#014" });
      voteOnPrinciple(p2.id, "helpful", { evolutionId: "#015" });

      const results = getPrinciplesByEffectiveness({ minVotes: 3 });

      // High effectiveness should come first
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].effectiveness).toBeGreaterThan(results[results.length - 1].effectiveness);
    });

    it("should filter by minimum votes", () => {
      const p1 = storePrinciple({
        content: "Principle with few votes",
        category: "coding" as PrincipleCategory,
        derivedFrom: ["test-008"],
      });

      voteOnPrinciple(p1.id, "helpful", { evolutionId: "#016" });

      const results = getPrinciplesByEffectiveness({ minVotes: 5 });
      
      // Should not include principle with only 1 vote
      expect(results.find(r => r.principleId === p1.id)).toBeUndefined();
    });
  });

  describe("getVotingReviewRecommendations", () => {
    it("should recommend keeping highly effective principles", () => {
      const principle = storePrinciple({
        content: "Very effective principle",
        category: "coding" as PrincipleCategory,
        derivedFrom: ["test-009"],
      });

      // Add many helpful votes
      for (let i = 0; i < 5; i++) {
        voteOnPrinciple(principle.id, "helpful", { evolutionId: `#${i}` });
      }

      const recommendations = getVotingReviewRecommendations();
      const found = recommendations.find(r => r.principleId === principle.id);

      expect(found).toBeDefined();
      expect(found!.recommendation).toBe("keep");
    });

    it("should recommend deprecating ineffective principles", () => {
      const principle = storePrinciple({
        content: "Ineffective principle",
        category: "coding" as PrincipleCategory,
        derivedFrom: ["test-010"],
      });

      // Add many harmful votes
      for (let i = 0; i < 6; i++) {
        voteOnPrinciple(principle.id, "harmful", { evolutionId: `#${i}` });
      }

      const recommendations = getVotingReviewRecommendations();
      const found = recommendations.find(r => r.principleId === principle.id);

      expect(found).toBeDefined();
      expect(found!.recommendation).toBe("deprecate");
    });
  });

  describe("analyzeVotingPatterns", () => {
    it("should return analysis of voting patterns", () => {
      // Create some principles with votes
      const p1 = storePrinciple({
        content: "Effective principle",
        category: "coding" as PrincipleCategory,
        derivedFrom: ["test-011"],
      });

      const p2 = storePrinciple({
        content: "Ineffective principle",
        category: "coding" as PrincipleCategory,
        derivedFrom: ["test-012"],
      });

      voteOnPrinciple(p1.id, "helpful", { evolutionId: "#017" });
      voteOnPrinciple(p1.id, "helpful", { evolutionId: "#018" });
      voteOnPrinciple(p2.id, "harmful", { evolutionId: "#019" });

      const analysis = analyzeVotingPatterns();

      expect(analysis.totalPrinciplesWithVotes).toBeGreaterThanOrEqual(2);
      expect(analysis.votingDistribution.helpful).toBeGreaterThanOrEqual(2);
      expect(analysis.votingDistribution.harmful).toBeGreaterThanOrEqual(1);
    });
  });

  describe("voteOnPrincipleQuick", () => {
    it("should provide convenient voting interface", () => {
      const principle = storePrinciple({
        content: "Quick vote test",
        category: "coding" as PrincipleCategory,
        derivedFrom: ["test-013"],
      });

      const result = voteOnPrincipleQuick(
        principle.id,
        "helpful",
        "#020",
        "Quick helpful vote"
      );

      expect(result).not.toBeNull();
      expect(result!.vote).toBe("helpful");
    });
  });

  describe("formatVotingStats", () => {
    it("should format voting stats for display", () => {
      const principle = storePrinciple({
        content: "Format test principle",
        category: "coding" as PrincipleCategory,
        derivedFrom: ["test-014"],
      });

      voteOnPrinciple(principle.id, "helpful", { evolutionId: "#021" });
      voteOnPrinciple(principle.id, "harmful", { evolutionId: "#022" });

      const stats = getVotingStats(principle.id);
      const formatted = formatVotingStats(stats!);

      expect(formatted).toContain("Effectiveness");
      expect(formatted).toContain("Votes");
      expect(formatted).toContain("Trend");
    });
  });

  describe("getTopEffectivePrinciples", () => {
    it("should return top effective principles", () => {
      const results = getTopEffectivePrinciples(5);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe("getPrinciplesNeedingAttention", () => {
    it("should return principles with low effectiveness", () => {
      const results = getPrinciplesNeedingAttention(10);
      expect(Array.isArray(results)).toBe(true);
      // All results should have negative effectiveness
      for (const r of results) {
        expect(r.effectiveness).toBeLessThan(0);
      }
    });
  });
});

describe("Principle Store Voting Integration", () => {
  it("should include voting field in stored principles", () => {
    const principle = storePrinciple({
      content: "Integration test principle",
      category: "coding" as PrincipleCategory,
      derivedFrom: ["test-integration"],
    });

    expect(principle.voting).toBeDefined();
    expect(principle.voting.helpful).toBe(0);
    expect(principle.voting.harmful).toBe(0);
    expect(principle.voting.totalVotes).toBe(0);
    expect(principle.voting.effectiveness).toBe(0);
    expect(principle.voting.voteHistory).toEqual([]);
  });

  it("should include voting statistics in principle stats", () => {
    const stats = getPrincipleStats();

    expect(stats.avgEffectiveness).toBeDefined();
    expect(stats.totalVotes).toBeDefined();
    expect(stats.highlyEffective).toBeDefined();
    expect(stats.ineffective).toBeDefined();
  });
});