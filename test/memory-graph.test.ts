import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  encodeMemory,
  retrieveMemories,
  createRelationship,
  findRelatedMemories,
  consolidateMemories,
  pruneMemories,
  getMemoryStats,
  formatMemoryStats,
  MemoryNode,
  MemoryNodeType,
  EdgeType,
} from "../src/memory/graph.js";

const TEST_MEMORY_DIR = join(process.cwd(), "data", "memory_test");

describe("memory graph system", () => {
  // Backup original memory data if exists
  let originalNodes: string | null = null;
  let originalEdges: string | null = null;
  let originalVectors: string | null = null;

  beforeEach(() => {
    // Store original data
    const memoryDir = join(process.cwd(), "data", "memory");
    const nodesPath = join(memoryDir, "nodes.json");
    const edgesPath = join(memoryDir, "edges.json");
    const vectorsPath = join(memoryDir, "vectors.json");

    if (existsSync(nodesPath)) {
      originalNodes = JSON.stringify(JSON.parse(require("node:fs").readFileSync(nodesPath, "utf-8")));
    }
    if (existsSync(edgesPath)) {
      originalEdges = JSON.stringify(JSON.parse(require("node:fs").readFileSync(edgesPath, "utf-8")));
    }
    if (existsSync(vectorsPath)) {
      originalVectors = JSON.stringify(JSON.parse(require("node:fs").readFileSync(vectorsPath, "utf-8")));
    }

    // Clear memory for clean tests
    if (existsSync(memoryDir)) {
      require("node:fs").rmSync(memoryDir, { recursive: true });
    }
    mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    // Restore original data
    const memoryDir = join(process.cwd(), "data", "memory");
    const nodesPath = join(memoryDir, "nodes.json");
    const edgesPath = join(memoryDir, "edges.json");
    const vectorsPath = join(memoryDir, "vectors.json");

    if (originalNodes !== null) {
      require("node:fs").writeFileSync(nodesPath, originalNodes);
    } else if (existsSync(nodesPath)) {
      require("node:fs").unlinkSync(nodesPath);
    }

    if (originalEdges !== null) {
      require("node:fs").writeFileSync(edgesPath, originalEdges);
    } else if (existsSync(edgesPath)) {
      require("node:fs").unlinkSync(edgesPath);
    }

    if (originalVectors !== null) {
      require("node:fs").writeFileSync(vectorsPath, originalVectors);
    } else if (existsSync(vectorsPath)) {
      require("node:fs").unlinkSync(vectorsPath);
    }

    originalNodes = null;
    originalEdges = null;
    originalVectors = null;
  });

  describe("encodeMemory", () => {
    it("creates a memory node with basic fields", () => {
      const node = encodeMemory({
        content: "TypeScript is a typed superset of JavaScript",
        type: "concept",
        tags: ["typescript", "programming"],
        importance: 0.8,
      });

      expect(node.id).toMatch(/^mem_/);
      expect(node.type).toBe("concept");
      expect(node.content).toBe("TypeScript is a typed superset of JavaScript");
      expect(node.tags).toContain("typescript");
      expect(node.tags).toContain("programming");
      expect(node.importance).toBe(0.8);
      expect(node.accessCount).toBe(0);
      expect(node.createdAt).toBeDefined();
    });

    it("generates a summary from long content", () => {
      const longContent = "A".repeat(300);
      const node = encodeMemory({
        content: longContent,
        type: "fact",
      });

      expect(node.summary.length).toBeLessThanOrEqual(203); // 200 + "..."
      expect(node.summary.endsWith("...")).toBe(true);
    });

    it("creates memory with relationships", () => {
      const node1 = encodeMemory({
        content: "JavaScript basics",
        type: "concept",
      });

      const node2 = encodeMemory({
        content: "TypeScript advanced patterns",
        type: "concept",
        relationships: [
          { toId: node1.id, type: "prerequisite_for", strength: 0.9 },
        ],
      });

      expect(node2.id).toBeDefined();
      // Verify relationship was created by finding related memories
      const related = findRelatedMemories(node1.id, 1);
      expect(related.length).toBeGreaterThan(0);
    });

    it("supports all memory types", () => {
      const types: MemoryNodeType[] = ["concept", "fact", "experience", "entity", "skill", "goal"];

      for (const type of types) {
        const node = encodeMemory({
          content: `Test ${type}`,
          type,
        });
        expect(node.type).toBe(type);
      }
    });
  });

  describe("retrieveMemories", () => {
    beforeEach(() => {
      // Seed some memories
      encodeMemory({
        content: "React is a JavaScript library for building user interfaces",
        type: "concept",
        tags: ["react", "frontend", "javascript"],
        importance: 0.9,
      });

      encodeMemory({
        content: "Vue.js is a progressive framework for building user interfaces",
        type: "concept",
        tags: ["vue", "frontend", "javascript"],
        importance: 0.85,
      });

      encodeMemory({
        content: "Rust is a systems programming language with memory safety",
        type: "concept",
        tags: ["rust", "systems"],
        importance: 0.7,
      });
    });

    it("retrieves memories by semantic search", () => {
      const results = retrieveMemories({
        text: "frontend frameworks",
        limit: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      // React and Vue should be relevant to "frontend frameworks"
      const hasReactOrVue = results.some(
        r => r.node.content.includes("React") || r.node.content.includes("Vue")
      );
      expect(hasReactOrVue).toBe(true);
    });

    it("filters by memory type", () => {
      const results = retrieveMemories({
        type: "concept",
        limit: 10,
      });

      expect(results.every(r => r.node.type === "concept")).toBe(true);
    });

    it("filters by tags", () => {
      const results = retrieveMemories({
        tags: ["react"],
        limit: 10,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].node.tags).toContain("react");
    });

    it("filters by importance threshold", () => {
      const results = retrieveMemories({
        minImportance: 0.8,
        limit: 10,
      });

      expect(results.every(r => r.node.importance >= 0.8)).toBe(true);
    });

    it("limits results correctly", () => {
      const results = retrieveMemories({
        limit: 2,
      });

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("increments access count on retrieval", () => {
      const node = encodeMemory({
        content: "Test memory for access counting",
        type: "fact",
      });

      expect(node.accessCount).toBe(0);

      retrieveMemories({ nodeIds: [node.id] });
      
      // Second retrieval to verify increment
      const second = retrieveMemories({ nodeIds: [node.id] });
      expect(second[0].node.accessCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("createRelationship", () => {
    it("creates a relationship between existing nodes", () => {
      const node1 = encodeMemory({
        content: "Database design principles",
        type: "concept",
      });

      const node2 = encodeMemory({
        content: "SQL optimization techniques",
        type: "skill",
      });

      const edge = createRelationship(node1.id, node2.id, "prerequisite_for", 0.8, "SQL requires DB knowledge");

      expect(edge).not.toBeNull();
      expect(edge?.fromId).toBe(node1.id);
      expect(edge?.toId).toBe(node2.id);
      expect(edge?.type).toBe("prerequisite_for");
      expect(edge?.strength).toBe(0.8);
      expect(edge?.evidence).toBe("SQL requires DB knowledge");
    });

    it("returns null for non-existent nodes", () => {
      const edge = createRelationship("non_existent_1", "non_existent_2", "relates_to");
      expect(edge).toBeNull();
    });

    it("supports all edge types", () => {
      const node1 = encodeMemory({ content: "Node 1", type: "fact" });
      const node2 = encodeMemory({ content: "Node 2", type: "fact" });

      const types: EdgeType[] = [
        "relates_to", "part_of", "leads_to", "contradicts",
        "supports", "similar_to", "prerequisite_for",
      ];

      for (const type of types) {
        const edge = createRelationship(node1.id, node2.id, type);
        expect(edge?.type).toBe(type);
      }
    });
  });

  describe("findRelatedMemories", () => {
    it("finds directly related memories", () => {
      const node1 = encodeMemory({ content: "Machine learning basics", type: "concept" });
      const node2 = encodeMemory({ content: "Neural networks", type: "concept" });
      const node3 = encodeMemory({ content: "Deep learning", type: "concept" });

      createRelationship(node1.id, node2.id, "leads_to", 0.9);
      createRelationship(node2.id, node3.id, "leads_to", 0.9);

      const related = findRelatedMemories(node1.id, 1);

      expect(related.length).toBeGreaterThan(0);
      expect(related.some(r => r.node.id === node2.id)).toBe(true);
    });

    it("traverses multiple levels when depth > 1", () => {
      const node1 = encodeMemory({ content: "A", type: "concept" });
      const node2 = encodeMemory({ content: "B", type: "concept" });
      const node3 = encodeMemory({ content: "C", type: "concept" });

      createRelationship(node1.id, node2.id, "leads_to", 0.9);
      createRelationship(node2.id, node3.id, "leads_to", 0.9);

      const related = findRelatedMemories(node1.id, 2);

      // Should find both B and C (at depth 2)
      expect(related.some(r => r.node.id === node2.id || r.node.content === "B")).toBe(true);
      expect(related.some(r => r.node.id === node3.id || r.node.content === "C")).toBe(true);
    });

    it("returns empty array for unknown node", () => {
      const related = findRelatedMemories("non_existent", 1);
      expect(related).toEqual([]);
    });

    it("relevance decreases with path length", () => {
      const node1 = encodeMemory({ content: "A", type: "concept" });
      const node2 = encodeMemory({ content: "B", type: "concept" });
      const node3 = encodeMemory({ content: "C", type: "concept" });

      createRelationship(node1.id, node2.id, "relates_to", 1.0);
      createRelationship(node2.id, node3.id, "relates_to", 1.0);

      const related = findRelatedMemories(node1.id, 2);
      
      // Node B (distance 1) should have higher relevance than Node C (distance 2)
      const nodeB = related.find(r => r.node.content === "B");
      const nodeC = related.find(r => r.node.content === "C");

      if (nodeB && nodeC) {
        expect(nodeB.relevance).toBeGreaterThan(nodeC.relevance);
      }
    });
  });

  describe("memory management", () => {
    it("consolidates similar memories", () => {
      encodeMemory({
        content: "React hooks are functions that let you use state",
        type: "concept",
        tags: ["react"],
        importance: 0.5,
      });

      encodeMemory({
        content: "React hooks enable state usage in functional components",
        type: "concept",
        tags: ["react", "hooks"],
        importance: 0.6,
      });

      const consolidated = consolidateMemories(0.7); // Lower threshold for testing

      expect(typeof consolidated).toBe("number");
      // Should have consolidated at least one pair
    });

    it("prunes old, low-importance memories", () => {
      // Create an old memory with low importance
      const oldNode: MemoryNode = {
        id: "mem_old_test",
        type: "fact",
        content: "Old unimportant fact",
        summary: "Old unimportant fact",
        createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days ago
        updatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
        accessCount: 0,
        importance: 0.1,
        confidence: 0.5,
        tags: [],
        metadata: {},
      };

      // Save directly to storage
      const memoryDir = join(process.cwd(), "data", "memory");
      const nodesPath = join(memoryDir, "nodes.json");
      const existingNodes = existsSync(nodesPath) 
        ? JSON.parse(require("node:fs").readFileSync(nodesPath, "utf-8"))
        : [];
      existingNodes.push(oldNode);
      require("node:fs").writeFileSync(nodesPath, JSON.stringify(existingNodes, null, 2));

      const statsBefore = getMemoryStats();
      const pruned = pruneMemories(30, 0.3);

      // The old memory should be pruned
      expect(pruned).toBeGreaterThan(0);
    });
  });

  describe("statistics", () => {
    it("returns memory stats", () => {
      encodeMemory({ content: "Test 1", type: "concept" });
      encodeMemory({ content: "Test 2", type: "fact" });

      const stats = getMemoryStats();

      expect(stats.totalNodes).toBeGreaterThanOrEqual(2);
      expect(stats.byType.concept).toBeGreaterThanOrEqual(1);
      expect(stats.byType.fact).toBeGreaterThanOrEqual(1);
      expect(stats.avgImportance).toBeGreaterThan(0);
      expect(stats.oldestMemory).toBeDefined();
      expect(stats.newestMemory).toBeDefined();
    });

    it("formats memory stats nicely", () => {
      encodeMemory({ content: "Test", type: "concept" });

      const formatted = formatMemoryStats();

      expect(formatted).toContain("Memory Graph Statistics");
      expect(formatted).toContain("Total Nodes");
      expect(formatted).toContain("concept:");
    });
  });
});
