/**
 * Tests for Principle Distillation Quality — Real File Validation
 *
 * Verifies that:
 * 1. principles.json contains ≥10 principles
 * 2. Each principle has specific, actionable technical content
 * 3. Old garbage patterns ("this pattern appeared N times") are gone
 * 4. Principles cover multiple categories
 *
 * NOTE: This test file has NO mocks — it reads the real principles.json file.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REAL_PRINCIPLES_PATH = join(process.cwd(), "data", "memory", "principles.json");

type Principle = {
  id: string;
  content: string;
  summary: string;
  category: string;
  conditions?: { taskTypes?: string[]; tags?: string[] };
  metadata?: { confidence?: number };
};

let principles: Principle[] = [];

describe("principles.json — Quality Validation", () => {
  beforeAll(() => {
    expect(
      existsSync(REAL_PRINCIPLES_PATH),
      `principles.json not found at ${REAL_PRINCIPLES_PATH} — run: npx tsx scripts/run-distillation.ts`
    ).toBe(true);
    const raw = readFileSync(REAL_PRINCIPLES_PATH, "utf-8");
    principles = JSON.parse(raw) as Principle[];
  });

  it("should contain ≥10 principles", () => {
    expect(principles.length).toBeGreaterThanOrEqual(10);
  });

  it("should not contain old garbage patterns (pattern-count boilerplate)", () => {
    for (const p of principles) {
      expect(p.content, `Garbage pattern in: "${p.id}"`).not.toMatch(
        /this pattern (?:has )?appeared \d+ times/i
      );
      expect(p.content).not.toMatch(/^(When performing|Avoid) \w+, this pattern/i);
    }
  });

  it("should have specific, actionable content — each principle ≥40 chars", () => {
    for (const p of principles) {
      expect(
        p.content.length,
        `Principle too short: "${p.id}" content: "${p.content.slice(0, 60)}"`
      ).toBeGreaterThanOrEqual(40);
    }
  });

  it("should have a non-empty summary for each principle", () => {
    for (const p of principles) {
      expect(p.summary, `Missing summary in principle "${p.id}"`).toBeTruthy();
      expect(p.summary.length).toBeGreaterThan(5);
    }
  });

  it("should distribute principles across ≥2 categories", () => {
    const categories = new Set(principles.map((p) => p.category));
    expect(
      categories.size,
      `Expected ≥2 categories, got: ${[...categories].join(", ")}`
    ).toBeGreaterThanOrEqual(2);
  });

  it("should have knowledge-distilled tag on principles from distillFromKnowledgeFiles()", () => {
    const knowledgePrinciples = principles.filter((p) =>
      p.conditions?.tags?.includes("knowledge-distilled")
    );
    // At least half should have the knowledge-distilled tag
    expect(knowledgePrinciples.length).toBeGreaterThanOrEqual(
      Math.floor(principles.length / 2)
    );
  });
});
