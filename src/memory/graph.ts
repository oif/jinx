/**
 * Knowledge Graph Memory System
 * 
 * Implements a graph-based memory architecture with:
 * - Nodes: Concepts, facts, experiences, entities
 * - Edges: Relationships between nodes
 * - Vector indexing for semantic search
 * - Temporal tracking for memory lifecycle
 * 
 * Based on MemEvolve: Encode → Store → Retrieve → Manage
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../supervisor/paths.js";
import { log } from "../util/log.js";

const MEMORY_DIR = join(DATA_DIR, "memory");
const NODES_PATH = join(MEMORY_DIR, "nodes.json");
const EDGES_PATH = join(MEMORY_DIR, "edges.json");
const VECTORS_PATH = join(MEMORY_DIR, "vectors.json");
const INDICES_PATH = join(MEMORY_DIR, "indices.json");

// ── Types ──────────────────────────────────────────────────────────

export type MemoryNodeType = "concept" | "fact" | "experience" | "entity" | "skill" | "goal";

export interface MemoryNode {
  id: string;
  type: MemoryNodeType;
  content: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  accessCount: number;
  lastAccessedAt?: string;
  importance: number; // 0-1, used for retention
  confidence: number; // 0-1, how sure we are about this memory
  source?: string; // Where this came from
  tags: string[];
  metadata: Record<string, unknown>;
}

export type EdgeType = "relates_to" | "part_of" | "leads_to" | "contradicts" | "supports" | "similar_to" | "prerequisite_for";

export interface MemoryEdge {
  id: string;
  fromId: string;
  toId: string;
  type: EdgeType;
  strength: number; // 0-1, relationship strength
  createdAt: string;
  evidence?: string; // Why this relationship exists
}

export interface MemoryVector {
  nodeId: string;
  embedding: number[]; // Simple bag-of-words or TF-IDF vector
  keywords: string[];
  lastUpdated: string;
}

export interface MemoryQuery {
  text?: string;
  tags?: string[];
  type?: MemoryNodeType;
  nodeIds?: string[];
  limit?: number;
  minImportance?: number;
}

export interface RetrievedMemory {
  node: MemoryNode;
  relevance: number;
  path?: MemoryEdge[]; // Relationship path if found via graph traversal
}

export interface MemoryGraphStats {
  totalNodes: number;
  totalEdges: number;
  byType: Record<MemoryNodeType, number>;
  avgImportance: number;
  oldestMemory: string;
  newestMemory: string;
}

// ── Initialization ─────────────────────────────────────────────────

function ensureMemoryDir(): void {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

function loadNodes(): Map<string, MemoryNode> {
  try {
    if (existsSync(NODES_PATH)) {
      const data = JSON.parse(readFileSync(NODES_PATH, "utf-8"));
      return new Map(data.map((n: MemoryNode) => [n.id, n]));
    }
  } catch (e) {
    log.warn("Failed to load memory nodes", { error: (e as Error).message });
  }
  return new Map();
}

function saveNodes(nodes: Map<string, MemoryNode>): void {
  try {
    ensureMemoryDir();
    writeFileSync(NODES_PATH, JSON.stringify(Array.from(nodes.values()), null, 2));
  } catch (e) {
    log.error("Failed to save memory nodes", { error: (e as Error).message });
  }
}

function loadEdges(): Map<string, MemoryEdge> {
  try {
    if (existsSync(EDGES_PATH)) {
      const data = JSON.parse(readFileSync(EDGES_PATH, "utf-8"));
      return new Map(data.map((e: MemoryEdge) => [e.id, e]));
    }
  } catch (e) {
    log.warn("Failed to load memory edges", { error: (e as Error).message });
  }
  return new Map();
}

function saveEdges(edges: Map<string, MemoryEdge>): void {
  try {
    ensureMemoryDir();
    writeFileSync(EDGES_PATH, JSON.stringify(Array.from(edges.values()), null, 2));
  } catch (e) {
    log.error("Failed to save memory edges", { error: (e as Error).message });
  }
}

function loadVectors(): Map<string, MemoryVector> {
  try {
    if (existsSync(VECTORS_PATH)) {
      const data = JSON.parse(readFileSync(VECTORS_PATH, "utf-8"));
      return new Map(data.map((v: MemoryVector) => [v.nodeId, v]));
    }
  } catch (e) {
    log.warn("Failed to load memory vectors", { error: (e as Error).message });
  }
  return new Map();
}

function saveVectors(vectors: Map<string, MemoryVector>): void {
  try {
    ensureMemoryDir();
    writeFileSync(VECTORS_PATH, JSON.stringify(Array.from(vectors.values()), null, 2));
  } catch (e) {
    log.error("Failed to save memory vectors", { error: (e as Error).message });
  }
}

// ── ID Generation ──────────────────────────────────────────────────

function generateNodeId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateEdgeId(fromId: string, toId: string): string {
  return `edge_${fromId}_${toId}_${Date.now()}`;
}

// ── Simple Vector Embedding ────────────────────────────────────────

// Simple but effective: keyword-based vector with TF-like weighting
function createEmbedding(text: string): { vector: number[]; keywords: string[] } {
  // Extract keywords (words with length > 3, excluding common stop words)
  const stopWords = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her", "was", "one", "our", "out", "day", "get", "has", "him", "his", "how", "man", "new", "now", "old", "see", "two", "way", "who", "boy", "did", "its", "let", "put", "say", "she", "too", "use", "with", "have", "this", "will", "your", "from", "they", "know", "want", "been", "good", "much", "some", "time", "very", "when", "come", "here", "just", "like", "long", "make", "many", "over", "such", "take", "than", "them", "well", "were"
  ]);
  
  const words = text.toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));
  
  // Count frequencies
  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) || 0) + 1);
  }
  
  // Get top keywords (most frequent)
  const sortedKeywords = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word);
  
  // Create sparse vector representation
  const vector: number[] = [];
  const keywordSet = new Set(sortedKeywords);
  
  // Use first 50 dimensions for keyword presence + frequency
  for (let i = 0; i < 50; i++) {
    if (i < sortedKeywords.length) {
      const keyword = sortedKeywords[i];
      const frequency = freq.get(keyword) || 0;
      // Normalize by text length (TF-like)
      vector.push(frequency / words.length);
    } else {
      vector.push(0);
    }
  }
  
  return { vector, keywords: sortedKeywords };
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Encode Module ──────────────────────────────────────────────────

export interface EncodeInput {
  content: string;
  type: MemoryNodeType;
  source?: string;
  importance?: number;
  confidence?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  relatedTo?: string[]; // IDs of related nodes
  relationships?: Array<{ toId: string; type: EdgeType; strength?: number }>;
}

export function encodeMemory(input: EncodeInput): MemoryNode {
  const now = new Date().toISOString();
  const nodeId = generateNodeId();
  
  const node: MemoryNode = {
    id: nodeId,
    type: input.type,
    content: input.content,
    summary: generateSummary(input.content),
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    importance: input.importance ?? 0.5,
    confidence: input.confidence ?? 0.8,
    source: input.source,
    tags: input.tags || [],
    metadata: input.metadata || {},
  };
  
  // Store node
  const nodes = loadNodes();
  nodes.set(nodeId, node);
  saveNodes(nodes);
  
  // Create and store embedding
  const { vector, keywords } = createEmbedding(input.content);
  const vectors = loadVectors();
  vectors.set(nodeId, {
    nodeId,
    embedding: vector,
    keywords,
    lastUpdated: now,
  });
  saveVectors(vectors);
  
  // Create relationships if specified
  if (input.relationships && input.relationships.length > 0) {
    const edges = loadEdges();
    for (const rel of input.relationships) {
      const edge: MemoryEdge = {
        id: generateEdgeId(nodeId, rel.toId),
        fromId: nodeId,
        toId: rel.toId,
        type: rel.type,
        strength: rel.strength ?? 0.5,
        createdAt: now,
      };
      edges.set(edge.id, edge);
    }
    saveEdges(edges);
  }
  
  log.info("Memory encoded", { nodeId, type: input.type, keywords });
  return node;
}

function generateSummary(content: string, maxLength: number = 200): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength - 3) + "...";
}

// ── Store Module ───────────────────────────────────────────────────

export function storeNode(node: MemoryNode): void {
  const nodes = loadNodes();
  nodes.set(node.id, { ...node, updatedAt: new Date().toISOString() });
  saveNodes(nodes);
  
  // Update vector if content changed
  const vectors = loadVectors();
  const { vector, keywords } = createEmbedding(node.content);
  vectors.set(node.id, {
    nodeId: node.id,
    embedding: vector,
    keywords,
    lastUpdated: new Date().toISOString(),
  });
  saveVectors(vectors);
}

export function createRelationship(
  fromId: string,
  toId: string,
  type: EdgeType,
  strength: number = 0.5,
  evidence?: string
): MemoryEdge | null {
  const nodes = loadNodes();
  if (!nodes.has(fromId) || !nodes.has(toId)) {
    log.warn("Cannot create relationship - node not found", { fromId, toId });
    return null;
  }
  
  const edges = loadEdges();
  const edge: MemoryEdge = {
    id: generateEdgeId(fromId, toId),
    fromId,
    toId,
    type,
    strength,
    createdAt: new Date().toISOString(),
    evidence,
  };
  
  edges.set(edge.id, edge);
  saveEdges(edges);
  
  log.info("Relationship created", { fromId, toId, type });
  return edge;
}

// ── Retrieve Module ────────────────────────────────────────────────

export function retrieveMemories(query: MemoryQuery): RetrievedMemory[] {
  const nodes = loadNodes();
  const vectors = loadVectors();
  const edges = loadEdges();
  
  let candidates: Array<{ node: MemoryNode; relevance: number }> = [];
  
  // If specific node IDs provided, use those
  if (query.nodeIds && query.nodeIds.length > 0) {
    for (const id of query.nodeIds) {
      const node = nodes.get(id);
      if (node) {
        candidates.push({ node, relevance: 1.0 });
      }
    }
  }
  // Otherwise, search by text similarity
  else if (query.text) {
    const { vector: queryVector } = createEmbedding(query.text);
    
    for (const [nodeId, node] of nodes) {
      // Filter by type if specified
      if (query.type && node.type !== query.type) continue;
      
      // Filter by importance
      if (query.minImportance && node.importance < query.minImportance) continue;
      
      // Filter by tags
      if (query.tags && query.tags.length > 0) {
        const hasTag = query.tags.some(tag => node.tags.includes(tag));
        if (!hasTag) continue;
      }
      
      // Calculate semantic similarity
      const nodeVector = vectors.get(nodeId)?.embedding;
      if (nodeVector) {
        const similarity = cosineSimilarity(queryVector, nodeVector);
        if (similarity > 0.1) { // Threshold
          candidates.push({ node, relevance: similarity });
        }
      }
    }
  }
  // Tag or type only search
  else {
    for (const [, node] of nodes) {
      if (query.type && node.type !== query.type) continue;
      if (query.tags && query.tags.length > 0) {
        const hasTag = query.tags.some(tag => node.tags.includes(tag));
        if (!hasTag) continue;
      }
      if (query.minImportance && node.importance < query.minImportance) continue;
      
      candidates.push({ node, relevance: 0.5 });
    }
  }
  
  // Sort by relevance
  candidates.sort((a, b) => b.relevance - a.relevance);
  
  // Limit results
  if (query.limit) {
    candidates = candidates.slice(0, query.limit);
  }
  
  // Record access
  for (const { node } of candidates) {
    recordAccess(node.id);
  }
  
  return candidates.map(c => ({ node: c.node, relevance: c.relevance }));
}

export function findRelatedMemories(nodeId: string, depth: number = 1): RetrievedMemory[] {
  const nodes = loadNodes();
  const edges = loadEdges();
  
  if (!nodes.has(nodeId)) return [];
  
  const related = new Map<string, { node: MemoryNode; relevance: number; path: MemoryEdge[] }>();
  const visited = new Set<string>();
  const queue: Array<{ id: string; path: MemoryEdge[] }> = [{ id: nodeId, path: [] }];
  
  while (queue.length > 0 && depth > 0) {
    const levelSize = queue.length;
    
    for (let i = 0; i < levelSize; i++) {
      const { id, path } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      
      // Find all edges connected to this node
      for (const [, edge] of edges) {
        if (edge.fromId === id || edge.toId === id) {
          const otherId = edge.fromId === id ? edge.toId : edge.fromId;
          const otherNode = nodes.get(otherId);
          
          if (otherNode && !visited.has(otherId)) {
            const newPath = [...path, edge];
            related.set(otherId, {
              node: otherNode,
              relevance: edge.strength * (1 / newPath.length), // Decay with distance
              path: newPath,
            });
            
            if (newPath.length < depth) {
              queue.push({ id: otherId, path: newPath });
            }
          }
        }
      }
    }
    
    depth--;
  }
  
  return Array.from(related.values())
    .sort((a, b) => b.relevance - a.relevance)
    .map(r => ({ node: r.node, relevance: r.relevance, path: r.path }));
}

export function recordAccess(nodeId: string): void {
  const nodes = loadNodes();
  const node = nodes.get(nodeId);
  if (node) {
    node.accessCount++;
    node.lastAccessedAt = new Date().toISOString();
    nodes.set(nodeId, node);
    saveNodes(nodes);
  }
}

// ── Manage Module ──────────────────────────────────────────────────

export function consolidateMemories(threshold: number = 0.85): number {
  const nodes = loadNodes();
  const vectors = loadVectors();
  const edges = loadEdges();
  
  let consolidatedCount = 0;
  const toDelete: string[] = [];
  
  // Find similar memories
  for (const [id1, node1] of nodes) {
    if (toDelete.includes(id1)) continue;
    
    const vec1 = vectors.get(id1)?.embedding;
    if (!vec1) continue;
    
    for (const [id2, node2] of nodes) {
      if (id1 >= id2 || toDelete.includes(id2)) continue;
      
      const vec2 = vectors.get(id2)?.embedding;
      if (!vec2) continue;
      
      const similarity = cosineSimilarity(vec1, vec2);
      
      if (similarity > threshold) {
        // Merge node2 into node1
        node1.content += `\n\n[Consolidated from ${id2}]: ${node2.content}`;
        node1.importance = Math.max(node1.importance, node2.importance);
        node1.tags = [...new Set([...node1.tags, ...node2.tags])];
        node1.updatedAt = new Date().toISOString();
        
        // Transfer relationships
        for (const [, edge] of edges) {
          if (edge.fromId === id2) {
            createRelationship(id1, edge.toId, edge.type, edge.strength);
          }
          if (edge.toId === id2) {
            createRelationship(edge.fromId, id1, edge.type, edge.strength);
          }
        }
        
        nodes.set(id1, node1);
        toDelete.push(id2);
        consolidatedCount++;
      }
    }
  }
  
  // Delete consolidated nodes
  for (const id of toDelete) {
    nodes.delete(id);
    vectors.delete(id);
    // Remove related edges
    for (const [edgeId, edge] of edges) {
      if (edge.fromId === id || edge.toId === id) {
        edges.delete(edgeId);
      }
    }
  }
  
  if (consolidatedCount > 0) {
    saveNodes(nodes);
    saveVectors(vectors);
    saveEdges(edges);
    log.info("Memories consolidated", { count: consolidatedCount });
  }
  
  return consolidatedCount;
}

export function pruneMemories(maxAgeDays: number = 30, minImportance: number = 0.3): number {
  const nodes = loadNodes();
  const vectors = loadVectors();
  const edges = loadEdges();
  
  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  
  let prunedCount = 0;
  const toDelete: string[] = [];
  
  for (const [id, node] of nodes) {
    const age = now - new Date(node.createdAt).getTime();
    const isOld = age > maxAgeMs;
    const isLowImportance = node.importance < minImportance;
    const isUnused = node.accessCount === 0 && isOld;
    
    if ((isOld && isLowImportance) || isUnused) {
      toDelete.push(id);
    }
  }
  
  for (const id of toDelete) {
    nodes.delete(id);
    vectors.delete(id);
    for (const [edgeId, edge] of edges) {
      if (edge.fromId === id || edge.toId === id) {
        edges.delete(edgeId);
      }
    }
    prunedCount++;
  }
  
  if (prunedCount > 0) {
    saveNodes(nodes);
    saveVectors(vectors);
    saveEdges(edges);
    log.info("Memories pruned", { count: prunedCount });
  }
  
  return prunedCount;
}

// ── Stats and Reporting ────────────────────────────────────────────

export function getMemoryStats(): MemoryGraphStats {
  const nodes = loadNodes();
  const edges = loadEdges();
  
  const byType: Record<MemoryNodeType, number> = {
    concept: 0,
    fact: 0,
    experience: 0,
    entity: 0,
    skill: 0,
    goal: 0,
  };
  
  let totalImportance = 0;
  let oldest = new Date().toISOString();
  let newest = new Date(0).toISOString();
  
  for (const [, node] of nodes) {
    byType[node.type]++;
    totalImportance += node.importance;
    
    if (node.createdAt < oldest) oldest = node.createdAt;
    if (node.createdAt > newest) newest = node.createdAt;
  }
  
  return {
    totalNodes: nodes.size,
    totalEdges: edges.size,
    byType,
    avgImportance: nodes.size > 0 ? totalImportance / nodes.size : 0,
    oldestMemory: oldest,
    newestMemory: newest,
  };
}

export function formatMemoryStats(): string {
  const stats = getMemoryStats();

  const lines: string[] = [
    "🧠 Memory Graph Statistics",
    "",
    `Total Nodes: ${stats.totalNodes}`,
    `Total Edges: ${stats.totalEdges}`,
    `Average Importance: ${(stats.avgImportance * 100).toFixed(1)}%`,
    "",
    "By Type:",
    ...Object.entries(stats.byType)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => `  ${type}: ${count}`),
    "",
    `Oldest: ${new Date(stats.oldestMemory).toLocaleDateString()}`,
    `Newest: ${new Date(stats.newestMemory).toLocaleDateString()}`,
  ];

  return lines.join("\n");
}

// ── Enhanced Exports ───────────────────────────────────────────────

export interface GraphExport {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  exportedAt: string;
  stats: MemoryGraphStats;
}

export interface GraphVisualization {
  nodes: Array<{
    id: string;
    label: string;
    type: MemoryNodeType;
    importance: number;
  }>;
  edges: Array<{
    from: string;
    to: string;
    label: string;
    strength: number;
  }>;
}

/**
 * Export the entire memory graph for backup or analysis
 */
export function exportGraph(): GraphExport {
  const nodes = loadNodes();
  const edges = loadEdges();

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
    exportedAt: new Date().toISOString(),
    stats: getMemoryStats(),
  };
}

/**
 * Export graph in visualization-friendly format
 */
export function exportForVisualization(): GraphVisualization {
  const nodes = loadNodes();
  const edges = loadEdges();

  return {
    nodes: Array.from(nodes.values()).map((n) => ({
      id: n.id,
      label: n.summary.slice(0, 50),
      type: n.type,
      importance: n.importance,
    })),
    edges: Array.from(edges.values()).map((e) => ({
      from: e.fromId,
      to: e.toId,
      label: e.type,
      strength: e.strength,
    })),
  };
}

/**
 * Import a graph (for restore or migration)
 */
export function importGraph(data: GraphExport): { nodes: number; edges: number } {
  const nodes = new Map<string, MemoryNode>();
  const edges = new Map<string, MemoryEdge>();
  const vectors = new Map<string, MemoryVector>();

  // Import nodes
  for (const node of data.nodes) {
    nodes.set(node.id, node);

    // Re-create embedding
    const { vector, keywords } = createEmbedding(node.content);
    vectors.set(node.id, {
      nodeId: node.id,
      embedding: vector,
      keywords,
      lastUpdated: node.updatedAt,
    });
  }

  // Import edges
  for (const edge of data.edges) {
    edges.set(edge.id, edge);
  }

  saveNodes(nodes);
  saveVectors(vectors);
  saveEdges(edges);

  log.info("Graph imported", { nodes: nodes.size, edges: edges.size });

  return { nodes: nodes.size, edges: edges.size };
}

/**
 * Enhanced semantic search using TF-IDF weighting
 */
export function advancedSemanticSearch(
  query: string,
  options: {
    limit?: number;
    minRelevance?: number;
    boostRecent?: boolean;
    boostAccessed?: boolean;
  } = {}
): Array<{ node: MemoryNode; relevance: number; matchedKeywords: string[] }> {
  const nodes = loadNodes();
  const vectors = loadVectors();

  const { limit = 10, minRelevance = 0.1, boostRecent = false, boostAccessed = false } = options;

  // Extract query keywords
  const stopWords = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her", "was",
    "one", "our", "out", "day", "get", "has", "him", "his", "how", "man", "new", "now",
    "old", "see", "two", "way", "who", "boy", "did", "its", "let", "put", "say", "she",
    "too", "use", "with", "have", "this", "will", "your", "from", "they", "know", "want",
    "been", "good", "much", "some", "time", "very", "when", "come", "here", "just", "like",
    "long", "make", "many", "over", "such", "take", "than", "them", "well", "were",
  ]);

  const queryWords = query
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  const results: Array<{ node: MemoryNode; relevance: number; matchedKeywords: string[] }> = [];
  const now = Date.now();

  for (const [nodeId, node] of nodes) {
    const vector = vectors.get(nodeId);
    if (!vector) continue;

    // Calculate keyword overlap with TF-IDF-like weighting
    let score = 0;
    const matchedKeywords: string[] = [];

    for (const word of queryWords) {
      const keywordIndex = vector.keywords.indexOf(word);
      if (keywordIndex !== -1) {
        // Higher score for earlier (more frequent) keywords
        const weight = 1 / (keywordIndex + 1);
        score += weight;
        matchedKeywords.push(word);
      }
    }

    // Normalize by query length
    score = score / queryWords.length;

    // Apply boost factors
    if (boostRecent && node.createdAt) {
      const age = now - new Date(node.createdAt).getTime();
      const ageInDays = age / (24 * 60 * 60 * 1000);
      const recencyBoost = Math.exp(-ageInDays / 30); // Decay over 30 days
      score *= (1 + recencyBoost);
    }

    if (boostAccessed && node.accessCount > 0) {
      const accessBoost = Math.log(node.accessCount + 1) * 0.1;
      score *= (1 + accessBoost);
    }

    // Boost by importance
    score *= (0.5 + node.importance);

    if (score >= minRelevance) {
      results.push({ node, relevance: score, matchedKeywords });
    }
  }

  // Sort by relevance
  results.sort((a, b) => b.relevance - a.relevance);

  // Limit results
  return results.slice(0, limit);
}

/**
 * Auto-consolidation: Find and merge highly similar memories
 */
export function autoConsolidate(options: {
  similarityThreshold?: number;
  dryRun?: boolean;
} = {}): Array<{ kept: MemoryNode; merged: MemoryNode[] }> {
  const { similarityThreshold = 0.85, dryRun = false } = options;

  const nodes = loadNodes();
  const vectors = loadVectors();

  const toMerge = new Map<string, string[]>(); // targetId -> sourceIds[]
  const processed = new Set<string>();

  // Find similar pairs
  for (const [id1, node1] of nodes) {
    if (processed.has(id1)) continue;

    const vec1 = vectors.get(id1)?.embedding;
    if (!vec1) continue;

    const similar: string[] = [];

    for (const [id2, node2] of nodes) {
      if (id1 >= id2 || processed.has(id2)) continue;

      const vec2 = vectors.get(id2)?.embedding;
      if (!vec2) continue;

      const similarity = cosineSimilarity(vec1, vec2);

      if (similarity > similarityThreshold) {
        similar.push(id2);
        processed.add(id2);
      }
    }

    if (similar.length > 0) {
      toMerge.set(id1, similar);
      processed.add(id1);
    }
  }

  const results: Array<{ kept: MemoryNode; merged: MemoryNode[] }> = [];

  if (!dryRun) {
    for (const [keptId, mergedIds] of toMerge) {
      const kept = nodes.get(keptId)!;
      const merged = mergedIds.map((id) => nodes.get(id)!).filter(Boolean);

      // Merge content
      for (const m of merged) {
        kept.content += `\n\n[Consolidated]: ${m.content}`;
        kept.tags = [...new Set([...kept.tags, ...m.tags])];
        kept.importance = Math.max(kept.importance, m.importance);
      }

      kept.updatedAt = new Date().toISOString();
      nodes.set(keptId, kept);

      // Delete merged nodes
      for (const id of mergedIds) {
        nodes.delete(id);
        vectors.delete(id);
      }

      results.push({ kept, merged });
    }

    if (results.length > 0) {
      saveNodes(nodes);
      saveVectors(vectors);
    }
  } else {
    // Dry run: just report what would be merged
    for (const [keptId, mergedIds] of toMerge) {
      const kept = nodes.get(keptId)!;
      const merged = mergedIds.map((id) => nodes.get(id)!).filter(Boolean);
      results.push({ kept, merged });
    }
  }

  log.info("Auto-consolidation complete", {
    groups: results.length,
    totalMerged: results.reduce((sum, r) => sum + r.merged.length, 0),
    dryRun,
  });

  return results;
}

/**
 * Find memory clusters using connected components
 */
export function findMemoryClusters(): Array<{ topic: string; memories: MemoryNode[]; size: number }> {
  const nodes = loadNodes();
  const edges = loadEdges();

  const clusters: Array<{ topic: string; memories: MemoryNode[]; size: number }> = [];
  const visited = new Set<string>();

  // Build adjacency list
  const adjacency = new Map<string, Set<string>>();
  for (const [, edge] of edges) {
    if (!adjacency.has(edge.fromId)) adjacency.set(edge.fromId, new Set());
    if (!adjacency.has(edge.toId)) adjacency.set(edge.toId, new Set());
    adjacency.get(edge.fromId)!.add(edge.toId);
    adjacency.get(edge.toId)!.add(edge.fromId);
  }

  // Find connected components
  for (const [nodeId, node] of nodes) {
    if (visited.has(nodeId)) continue;

    const cluster: MemoryNode[] = [];
    const queue: string[] = [nodeId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const current = nodes.get(currentId);
      if (current) {
        cluster.push(current);
      }

      const neighbors = adjacency.get(currentId);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
        }
      }
    }

    if (cluster.length > 1) {
      // Generate topic from most common keywords
      const keywordCounts = new Map<string, number>();
      for (const n of cluster) {
        for (const tag of n.tags) {
          keywordCounts.set(tag, (keywordCounts.get(tag) || 0) + 1);
        }
      }

      const topKeywords = Array.from(keywordCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k]) => k);

      clusters.push({
        topic: topKeywords.join(", ") || "mixed",
        memories: cluster,
        size: cluster.length,
      });
    }
  }

  // Sort by size
  clusters.sort((a, b) => b.size - a.size);

  return clusters;
}
