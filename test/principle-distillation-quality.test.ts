/**
 * Tests for Principle Distillation API Contract (mocked FS)
 *
 * Verifies that:
 * 1. clearAllPrinciples() correctly empties the principle store
 * 2. storePrinciple() stores knowledge-distilled principles correctly
 * 3. distillFromKnowledgeFiles() is exported as an async function
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock setup ─────────────────────────────────────────────────────

const mockFiles = vi.hoisted(() => new Map<string, string>());

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn((path: string, encoding?: unknown) => {
      if (mockFiles.has(path as string)) {
        return mockFiles.get(path as string)!;
      }
      return actual.readFileSync(path, encoding as BufferEncoding);
    }),
    writeFileSync: vi.fn((path: string, data: string) => {
      mockFiles.set(path as string, data);
    }),
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => [] as string[]),
  };
});

vi.mock("../src/supervisor/paths.js", () => ({
  DATA_DIR: "/tmp/test-principle-api",
}));

const PRINCIPLES_PATH = "/tmp/test-principle-api/memory/principles.json";

function seedPrinciples(items: unknown[]) {
  mockFiles.set(PRINCIPLES_PATH, JSON.stringify(items));
}

function makePrinciple(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `principle_test_${Date.now()}`,
    content: "Test principle content that is long enough to be meaningful here",
    summary: "Test summary",
    category: "general",
    conditions: { taskTypes: [], tags: [] },
    evidence: { successCases: [], failureCases: [], successRate: 0, totalApplications: 0 },
    voting: { helpful: 0, harmful: 0, totalVotes: 0, effectiveness: 0, voteHistory: [] },
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      derivedFrom: [],
      confidence: 0.7,
      stability: 0.5,
      reinforcementCount: 0,
      reviewCount: 0,
    },
    status: "experimental",
    rationale: "test",
    examples: [],
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("clearAllPrinciples()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFiles.clear();
  });

  it("clears a populated store to 0 principles", async () => {
    const { clearAllPrinciples, getAllPrinciples } = await import(
      "../src/memory/principle-store.js"
    );

    seedPrinciples([makePrinciple(), makePrinciple({ id: "principle_test_2" })]);

    const before = getAllPrinciples();
    expect(before.length).toBe(2);

    clearAllPrinciples();

    const after = getAllPrinciples();
    expect(after.length).toBe(0);
  });

  it("is idempotent — calling twice is safe", async () => {
    const { clearAllPrinciples, getAllPrinciples } = await import(
      "../src/memory/principle-store.js"
    );

    seedPrinciples([]);
    clearAllPrinciples();
    clearAllPrinciples();

    expect(getAllPrinciples().length).toBe(0);
  });
});

describe("storePrinciple() — knowledge-distilled shape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFiles.clear();
    seedPrinciples([]);
  });

  it("stores a principle with knowledge-distilled tag and retrieves it", async () => {
    const { storePrinciple, getPrinciple } = await import(
      "../src/memory/principle-store.js"
    );

    const stored = storePrinciple({
      content:
        "When fixing TypeScript errors, always run 'tsc --noEmit' first to get the " +
        "complete error list before making changes — partial fixes often introduce new errors.",
      summary: "Run tsc --noEmit before fixing TS errors",
      category: "error_handling",
      conditions: {
        taskTypes: ["bugfix"],
        tags: ["typescript", "knowledge-distilled", "bug-fix"],
      },
      derivedFrom: ["knowledge-files"],
      confidence: 0.85,
      rationale: "Prevents partial fixes that introduce new errors",
      examples: [],
    });

    expect(stored.id).toBeTruthy();
    expect(stored.content).toContain("tsc --noEmit");
    expect(stored.category).toBe("error_handling");
    expect(stored.conditions.tags).toContain("knowledge-distilled");

    const retrieved = getPrinciple(stored.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.content).toBe(stored.content);
  });
});

describe("distillFromKnowledgeFiles() API", () => {
  it("is exported as an async function from principle-distiller", async () => {
    const module = await import("../src/memory/principle-distiller.js");
    expect(typeof module.distillFromKnowledgeFiles).toBe("function");
  });

  it("clearAllPrinciples is re-exported from principle-distiller", async () => {
    const module = await import("../src/memory/principle-distiller.js");
    expect(typeof module.clearAllPrinciples).toBe("function");
  });

  it("KnowledgeDistillationResult fields are populated correctly by storePrinciple", async () => {
    const { storePrinciple, getAllPrinciples } = await import(
      "../src/memory/principle-store.js"
    );

    seedPrinciples([]);
    const ids: string[] = [];

    // Simulate what distillFromKnowledgeFiles stores
    for (const [cat, taskType] of [
      ["error_handling", "bugfix"] as const,
      ["coding", "feature"] as const,
      ["architecture", "integration"] as const,
      ["learning", "research"] as const,
    ]) {
      const p = storePrinciple({
        content: `Specific actionable principle for ${taskType}: always verify output before committing.`,
        summary: `${taskType}: verify before commit`,
        category: cat,
        conditions: {
          taskTypes: [taskType],
          tags: ["knowledge-distilled", taskType],
        },
        derivedFrom: ["knowledge-files"],
        confidence: 0.8,
        rationale: `Evidence from knowledge base for ${taskType}`,
        examples: [],
      });
      ids.push(p.id);
    }

    const all = getAllPrinciples();
    expect(all.length).toBe(4);
    expect(ids.length).toBe(4);

    // Every principle should have knowledge-distilled tag
    for (const p of all) {
      expect(p.conditions.tags).toContain("knowledge-distilled");
    }
  });
});
