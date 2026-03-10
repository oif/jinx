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
 * 
 * Enhanced with industry best practices from:
 * - Mem0.ai: Memory hierarchy, multimodal support, adaptive forgetting
 * - Graphiti: Graph-based consolidation, time-aware edges
 * 
 * Key features:
 * - Ebbinghaus forgetting curve for memory strength calculation
 * - Memory hierarchy (working, short-term, long-term)
 * - Dynamic importance decay based on access patterns
 * - Multimodal content metadata support
 * - Enhanced consolidation considering multiple factors
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../supervisor/paths.js";
import { log } from "../util/log.js";

const MEMORY_DIR = join(DATA_DIR, "memory");
const NODES_PATH = join(MEMORY_DIR, "nodes.json");
const EDGES_PATH = join(MEMORY_DIR, "edges.json");
const VECTORS_PATH = join(MEMORY_DIR, "vectors.json");


// ── Types ──────────────────────────────────────────────────────────

/**
 * Memory hierarchy levels based on cognitive science and Mem0.ai
 * - working: Active processing, limited capacity (~7 items), short duration
 * - short_term: Recent memories, minutes to hours, moderate decay
 * - long_term: Consolidated memories, days to years, slow decay
 */
export type MemoryLevel = "working" | "short_term" | "long_term";

export type MemoryNodeType = "concept" | "fact" | "experience" | "entity" | "skill" | "goal";

/**
 * Multimodal content types for rich memory representation
 */
export type ModalityType = "text" | "image" | "audio" | "code" | "structured";

/**
 * Multimodal content attachment
 */
export interface MultimodalContent {
  type: ModalityType;
  content: string; // Text content or URI/path to content
  metadata?: {
    mimeType?: string;
    size?: number;
    dimensions?: { width: number; height: number };
    duration?: number; // For audio/video in seconds
    thumbnail?: string; // Thumbnail URI for preview
  };
}

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
  
  // Enhanced memory lifecycle tracking (from Mem0.ai/Graphiti best practices)
  level: MemoryLevel; // Memory hierarchy level
  memoryStrength: number; // 0-1, current strength based on Ebbinghaus curve
  consolidationScore: number; // 0-1, how well consolidated this memory is
  
  // Multimodal support
  attachments?: MultimodalContent[];
  primaryModality?: ModalityType;
  
  // Tracking for forgetting curve
  reviewCount: number; // Number of times this memory has been reinforced
  lastReviewAt?: string;
  nextReviewAt?: string; // Optimal review time based on spaced repetition
}

export type EdgeType = "relates_to" | "part_of" | "leads_to" | "contradicts" | "supports" | "similar_to" | "prerequisite_for" | "derived_from" | "causes" | "excludes";

export interface MemoryEdge {
  id: string;
  fromId: string;
  toId: string;
  type: EdgeType;
  strength: number; // 0-1, relationship strength
  createdAt: string;
  evidence?: string; // Why this relationship exists
  
  // Enhanced edge tracking (Graphiti-inspired)
  lastActivated?: string; // When this edge was last traversed/used
  activationCount: number; // How many times this relationship was used
  decayRate: number; // 0-1, how fast this edge weakens over time
  isTemporary?: boolean; // For working memory edges that should decay quickly
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

// ── Forgetting Curve Constants (Ebbinghaus) ────────────────────────

/**
 * Ebbinghaus forgetting curve parameters
 * R = e^(-t/S) where R = retention, t = time, S = memory strength
 * 
 * Memory levels have different decay rates:
 * - Working memory: Very fast decay (seconds to minutes)
 * - Short-term: Moderate decay (hours to days)
 * - Long-term: Slow decay (weeks to months)
 */
const FORGETTING_CURVE = {
  working: {
    halfLife: 0.02, // ~30 minutes (in days)
    initialStrength: 1.0,
    minStrength: 0.1,
  },
  short_term: {
    halfLife: 1, // 1 day
    initialStrength: 1.0,
    minStrength: 0.15,
  },
  long_term: {
    halfLife: 30, // 30 days
    initialStrength: 1.0,
    minStrength: 0.2,
  },
};

/**
 * Spaced repetition intervals (based on SuperMemo SM-2)
 * Used to calculate optimal next review time
 */
const SPACED_REPETITION = {
  intervals: [0, 1, 3, 7, 14, 30, 60, 120, 240], // days
  easeFactor: 2.5, // Multiplier for successful recalls
  minEaseFactor: 1.3,
};

/**
 * Memory consolidation thresholds
 */
const CONSOLIDATION = {
  workingToShortTerm: {
    minAccessCount: 3,
    minAge: 0.04, // ~1 hour in days
    minImportance: 0.3,
  },
  shortTermToLongTerm: {
    minAccessCount: 5,
    minAge: 1, // 1 day
    minImportance: 0.5,
    minConsolidationScore: 0.6,
  },
  similarityThreshold: 0.85, // For merging similar memories
};

// ── Forgetting Curve Functions ─────────────────────────────────────

/**
 * Calculate memory retention using Ebbinghaus forgetting curve
 * R(t) = e^(-t/S) where S is memory strength adjusted by level
 */
export function calculateRetention(
  createdAt: string,
  lastAccessedAt: string | undefined,
  level: MemoryLevel,
  reviewCount: number,
): number {
  const now = Date.now();
  const createdTime = new Date(createdAt).getTime();
  const accessTime = lastAccessedAt ? new Date(lastAccessedAt).getTime() : createdTime;
  
  // Time since last access in days
  const timeSinceAccess = (now - accessTime) / (1000 * 60 * 60 * 24);
  
  // Get level-specific parameters
  const params = FORGETTING_CURVE[level];
  
  // Calculate base retention using exponential decay
  const baseRetention = Math.exp(-timeSinceAccess / params.halfLife);
  
  // Boost retention based on review count (spaced repetition effect)
  const reviewBoost = Math.min(1 + reviewCount * 0.1, 1.5);
  
  // Calculate final retention
  const retention = baseRetention * reviewBoost;
  
  // Clamp to valid range
  return Math.max(params.minStrength, Math.min(1, retention));
}

/**
 * Calculate current memory strength considering multiple factors
 */
export function calculateMemoryStrength(node: MemoryNode): number {
  // Base strength from retention
  const retention = calculateRetention(
    node.createdAt,
    node.lastAccessedAt,
    node.level,
    node.reviewCount,
  );
  
  // Factor in importance (important memories persist longer)
  const importanceFactor = 0.5 + (node.importance * 0.5);
  
  // Factor in confidence (certain memories are more stable)
  const confidenceFactor = 0.7 + (node.confidence * 0.3);
  
  // Factor in consolidation score
  const consolidationFactor = node.level === "long_term" 
    ? 0.8 + (node.consolidationScore * 0.2)
    : 0.9;
  
  return retention * importanceFactor * confidenceFactor * consolidationFactor;
}

/**
 * Calculate optimal next review time using spaced repetition
 */
export function calculateNextReview(
  createdAt: string,
  reviewCount: number,
  level: MemoryLevel,
  lastQuality: number = 0.5, // 0-1, quality of last recall
): Date {
  const now = new Date();
  
  // Determine interval index (clamped to available intervals)
  const intervalIndex = Math.min(reviewCount, SPACED_REPETITION.intervals.length - 1);
  let intervalDays = SPACED_REPETITION.intervals[intervalIndex];
  
  // Adjust interval based on level
  const levelMultiplier = level === "working" ? 0.1 : level === "short_term" ? 0.5 : 1;
  intervalDays *= levelMultiplier;
  
  // Adjust based on recall quality
  const qualityAdjustment = 0.5 + lastQuality;
  intervalDays *= qualityAdjustment;
  
  // Apply ease factor for repeated successes
  const easeFactor = SPACED_REPETITION.easeFactor;
  if (reviewCount > 0) {
    intervalDays *= Math.pow(easeFactor, Math.min(reviewCount, 5));
  }
  
  return new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
}

/**
 * Determine appropriate memory level based on access patterns and time
 */
export function determineMemoryLevel(node: MemoryNode): MemoryLevel {
  const age = (Date.now() - new Date(node.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  
  // Check if eligible for long-term
  if (
    node.level === "long_term" ||
    (node.accessCount >= CONSOLIDATION.shortTermToLongTerm.minAccessCount &&
     age >= CONSOLIDATION.shortTermToLongTerm.minAge &&
     node.importance >= CONSOLIDATION.shortTermToLongTerm.minImportance)
  ) {
    return "long_term";
  }
  
  // Check if eligible for short-term
  if (
    node.level === "short_term" ||
    (node.accessCount >= CONSOLIDATION.workingToShortTerm.minAccessCount &&
     age >= CONSOLIDATION.workingToShortTerm.minAge &&
     node.importance >= CONSOLIDATION.workingToShortTerm.minImportance)
  ) {
    return "short_term";
  }
  
  return "working";
}

/**
 * Calculate consolidation score based on multiple factors
 */
export function calculateConsolidationScore(node: MemoryNode): number {
  let score = 0;
  
  // Factor 1: Access count (normalized, logarithmic scale)
  const accessScore = Math.min(1, Math.log(node.accessCount + 1) / 3);
  score += accessScore * 0.3;
  
  // Factor 2: Age stability (older stable memories are more consolidated)
  const age = (Date.now() - new Date(node.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  const ageScore = Math.min(1, age / 30); // Normalize to 30 days
  score += ageScore * 0.2;
  
  // Factor 3: Relationship density (more connections = more consolidated)
  const edges = loadEdges();
  let connectionCount = 0;
  for (const [, edge] of edges) {
    if (edge.fromId === node.id || edge.toId === node.id) {
      connectionCount++;
    }
  }
  const connectionScore = Math.min(1, connectionCount / 5); // Normalize to 5 connections
  score += connectionScore * 0.25;
  
  // Factor 4: Importance and confidence
  score += node.importance * 0.15;
  score += node.confidence * 0.1;
  
  return Math.min(1, score);
}

/**
 * Decay edge strength over time (Graphiti-inspired)
 */
export function decayEdgeStrength(edge: MemoryEdge): number {
  if (!edge.lastActivated) {
    return edge.strength;
  }
  
  const daysSinceActivation = (Date.now() - new Date(edge.lastActivated).getTime()) 
    / (1000 * 60 * 60 * 24);
  
  // Exponential decay
  const decayFactor = Math.exp(-daysSinceActivation * edge.decayRate);
  
  // Temporary edges decay faster
  const tempMultiplier = edge.isTemporary ? 0.5 : 1;
  
  return edge.strength * decayFactor * tempMultiplier;
}

// ── Memory Statistics Interface ─────────────────────────────────────

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
      return new Map(data.map((n: MemoryNode) => {
        // Migration: Ensure all nodes have new fields (backward compatibility)
        if (n.level === undefined) {
          n.level = determineMemoryLevel(n);
        }
        if (n.memoryStrength === undefined) {
          n.memoryStrength = calculateMemoryStrength(n);
        }
        if (n.consolidationScore === undefined) {
          n.consolidationScore = calculateConsolidationScore(n);
        }
        if (n.reviewCount === undefined) {
          n.reviewCount = n.accessCount; // Use accessCount as initial reviewCount
        }
        if (n.primaryModality === undefined) {
          n.primaryModality = "text";
        }
        return [n.id, n];
      }));
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
      return new Map(data.map((e: MemoryEdge) => {
        // Migration: Ensure all edges have new fields (backward compatibility)
        if (e.activationCount === undefined) {
          e.activationCount = 0;
        }
        if (e.decayRate === undefined) {
          e.decayRate = 0.01; // Default decay rate
        }
        if (e.isTemporary === undefined) {
          e.isTemporary = false;
        }
        return [e.id, e];
      }));
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
  
  // Enhanced encoding options
  level?: MemoryLevel; // Initial memory level (defaults based on importance)
  attachments?: MultimodalContent[]; // Multimodal content attachments
  primaryModality?: ModalityType; // Primary modality type
}

export function encodeMemory(input: EncodeInput): MemoryNode {
  const now = new Date().toISOString();
  const nodeId = generateNodeId();
  
  // Determine initial level based on importance if not specified
  const initialLevel = input.level ?? (
    (input.importance ?? 0.5) >= 0.7 ? "short_term" : "working"
  );
  
  // Calculate initial memory strength
  const initialStrength = FORGETTING_CURVE[initialLevel].initialStrength;
  
  // Calculate next review time
  const nextReview = calculateNextReview(now, 0, initialLevel);
  
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
    
    // Enhanced memory lifecycle
    level: initialLevel,
    memoryStrength: initialStrength,
    consolidationScore: 0,
    
    // Multimodal support
    attachments: input.attachments,
    primaryModality: input.primaryModality ?? "text",
    
    // Tracking for forgetting curve
    reviewCount: 0,
    lastReviewAt: undefined,
    nextReviewAt: nextReview.toISOString(),
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
        // Enhanced edge tracking
        lastActivated: now,
        activationCount: 0,
        decayRate: 0.01,
        isTemporary: false,
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
  evidence?: string,
  options?: {
    isTemporary?: boolean;
    decayRate?: number;
  }
): MemoryEdge | null {
  const nodes = loadNodes();
  if (!nodes.has(fromId) || !nodes.has(toId)) {
    log.warn("Cannot create relationship - node not found", { fromId, toId });
    return null;
  }
  
  const now = new Date().toISOString();
  const edges = loadEdges();
  const edge: MemoryEdge = {
    id: generateEdgeId(fromId, toId),
    fromId,
    toId,
    type,
    strength,
    createdAt: now,
    evidence,
    // Enhanced edge tracking
    lastActivated: now,
    activationCount: 0,
    decayRate: options?.decayRate ?? 0.01, // Default decay rate
    isTemporary: options?.isTemporary ?? false,
  };
  
  edges.set(edge.id, edge);
  saveEdges(edges);
  
  log.info("Relationship created", { fromId, toId, type, isTemporary: edge.isTemporary });
  return edge;
}

// ── Retrieve Module ────────────────────────────────────────────────

function searchByText(
  query: MemoryQuery,
  nodes: Map<string, MemoryNode>,
  vectors: Map<string, MemoryVector>,
): Array<{ node: MemoryNode; relevance: number }> {
  const { vector: queryVector } = createEmbedding(query.text!);
  const candidates: Array<{ node: MemoryNode; relevance: number }> = [];
  for (const [nodeId, node] of nodes) {
    if (query.type && node.type !== query.type) continue;
    if (query.minImportance && node.importance < query.minImportance) continue;
    if (query.tags && query.tags.length > 0) {
      if (!query.tags.some(tag => node.tags.includes(tag))) continue;
    }
    const nodeVector = vectors.get(nodeId)?.embedding;
    if (nodeVector) {
      const similarity = cosineSimilarity(queryVector, nodeVector);
      if (similarity > 0.1) candidates.push({ node, relevance: similarity });
    }
  }
  return candidates;
}

function searchByTagsOrType(
  query: MemoryQuery,
  nodes: Map<string, MemoryNode>,
): Array<{ node: MemoryNode; relevance: number }> {
  const candidates: Array<{ node: MemoryNode; relevance: number }> = [];
  for (const [, node] of nodes) {
    if (query.type && node.type !== query.type) continue;
    if (query.tags && query.tags.length > 0) {
      if (!query.tags.some(tag => node.tags.includes(tag))) continue;
    }
    if (query.minImportance && node.importance < query.minImportance) continue;
    candidates.push({ node, relevance: 0.5 });
  }
  return candidates;
}

export function retrieveMemories(query: MemoryQuery): RetrievedMemory[] {
  const nodes = loadNodes();
  const vectors = loadVectors();

  let candidates: Array<{ node: MemoryNode; relevance: number }> = [];

  if (query.nodeIds && query.nodeIds.length > 0) {
    for (const id of query.nodeIds) {
      const node = nodes.get(id);
      if (node) candidates.push({ node, relevance: 1.0 });
    }
  } else if (query.text) {
    candidates = searchByText(query, nodes, vectors);
  } else {
    candidates = searchByTagsOrType(query, nodes);
  }

  candidates.sort((a, b) => b.relevance - a.relevance);

  if (query.limit) {
    candidates = candidates.slice(0, query.limit);
  }

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

export function recordAccess(nodeId: string, quality: number = 0.5): void {
  const nodes = loadNodes();
  const node = nodes.get(nodeId);
  if (node) {
    const now = new Date().toISOString();
    node.accessCount++;
    node.lastAccessedAt = now;
    node.reviewCount++;
    node.lastReviewAt = now;
    
    // Update memory strength based on forgetting curve
    node.memoryStrength = calculateMemoryStrength(node);
    
    // Calculate next review time using spaced repetition
    const nextReview = calculateNextReview(
      node.createdAt,
      node.reviewCount,
      node.level,
      quality,
    );
    node.nextReviewAt = nextReview.toISOString();
    
    // Update consolidation score
    node.consolidationScore = calculateConsolidationScore(node);
    
    // Check if memory should be promoted to a higher level
    const newLevel = determineMemoryLevel(node);
    if (newLevel !== node.level) {
      log.info("Memory promoted", { 
        nodeId, 
        oldLevel: node.level, 
        newLevel,
        consolidationScore: node.consolidationScore 
      });
      node.level = newLevel;
    }
    
    nodes.set(nodeId, node);
    saveNodes(nodes);
  }
}

function transferEdges(
  edges: Map<string, MemoryEdge>,
  fromId: string,
  toId: string,
): void {
  for (const [, edge] of edges) {
    if (edge.fromId === fromId) createRelationship(toId, edge.toId, edge.type, edge.strength);
    if (edge.toId === fromId) createRelationship(edge.fromId, toId, edge.type, edge.strength);
  }
}

function deleteNodeAndEdges(
  id: string,
  nodes: Map<string, MemoryNode>,
  vectors: Map<string, MemoryVector>,
  edges: Map<string, MemoryEdge>,
): void {
  nodes.delete(id);
  vectors.delete(id);
  for (const [edgeId, edge] of edges) {
    if (edge.fromId === id || edge.toId === id) edges.delete(edgeId);
  }
}

// ── Manage Module ──────────────────────────────────────────────────

/**
 * Enhanced memory consolidation based on Mem0.ai and Graphiti best practices
 * 
 * Consolidation strategies:
 * 1. Similar content merge: Merge highly similar memories
 * 2. Level promotion: Promote eligible memories to higher levels
 * 3. Memory reinforcement: Strengthen frequently accessed memories
 * 4. Edge consolidation: Strengthen frequently traversed relationships
 */
// eslint-disable-next-line complexity
export function consolidateMemories(threshold: number = CONSOLIDATION.similarityThreshold): number {
  const nodes = loadNodes();
  const vectors = loadVectors();
  const edges = loadEdges();
  
  let consolidatedCount = 0;
  const toDelete: string[] = [];
  const now = new Date();
  
  // Step 1: Promote eligible memories
  for (const [id, node] of nodes) {
    const newLevel = determineMemoryLevel(node);
    if (newLevel !== node.level) {
      node.level = newLevel;
      node.memoryStrength = calculateMemoryStrength(node);
      node.consolidationScore = calculateConsolidationScore(node);
      node.updatedAt = now.toISOString();
      nodes.set(id, node);
      log.info("Memory promoted during consolidation", { 
        nodeId: id, 
        level: newLevel,
        consolidationScore: node.consolidationScore 
      });
    }
  }
  
  // Step 2: Find and merge similar memories
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
        // Multi-factor consolidation decision
        const shouldMerge = evaluateConsolidationFactors(node1, node2, similarity);
        
        if (shouldMerge) {
          // Merge into the stronger/higher-level memory
          const [keepNode, mergeNode] = node1.level === "long_term" 
            || (node1.memoryStrength >= node2.memoryStrength && node1.level !== "working")
            ? [node1, node2]
            : [node2, node1];
          
          const keepId = keepNode.id;
          const mergeId = mergeNode.id;
          
          // Merge content
          keepNode.content += `\n\n[Consolidated from ${mergeId}]: ${mergeNode.content}`;
          
          // Merge metadata intelligently
          keepNode.importance = Math.max(keepNode.importance, mergeNode.importance);
          keepNode.confidence = Math.max(keepNode.confidence, mergeNode.confidence);
          keepNode.tags = [...new Set([...keepNode.tags, ...mergeNode.tags])];
          keepNode.accessCount += mergeNode.accessCount;
          keepNode.reviewCount += mergeNode.reviewCount;
          
          // Update consolidation metrics
          keepNode.consolidationScore = Math.max(
            keepNode.consolidationScore,
            mergeNode.consolidationScore,
          );
          
          // Merge attachments if present
          if (mergeNode.attachments && mergeNode.attachments.length > 0) {
            keepNode.attachments = [
              ...(keepNode.attachments || []),
              ...mergeNode.attachments,
            ];
          }
          
          keepNode.updatedAt = now.toISOString();
          keepNode.memoryStrength = calculateMemoryStrength(keepNode);
          
          transferEdges(edges, mergeId, keepId);
          nodes.set(keepId, keepNode);
          toDelete.push(mergeId);
          consolidatedCount++;
        }
      }
    }
  }
  
  // Step 3: Strengthen frequently traversed edges
  for (const [, edge] of edges) {
    if (edge.activationCount > 5) {
      const decayedStrength = decayEdgeStrength(edge);
      // Boost strength based on activation frequency
      edge.strength = Math.min(1, decayedStrength + edge.activationCount * 0.01);
    }
  }
  
  // Delete consolidated nodes
  for (const id of toDelete) {
    deleteNodeAndEdges(id, nodes, vectors, edges);
  }
  
  if (consolidatedCount > 0) {
    saveNodes(nodes);
    saveVectors(vectors);
    saveEdges(edges);
    log.info("Memories consolidated", { count: consolidatedCount });
  }
  
  return consolidatedCount;
}

/**
 * Evaluate if two memories should be consolidated based on multiple factors
 */
function evaluateConsolidationFactors(
  node1: MemoryNode,
  node2: MemoryNode,
  similarity: number,
): boolean {
  // Never merge if they contradict each other (explicit contradiction edge)
  // This is checked separately in edges
  
  // High similarity always qualifies
  if (similarity > 0.95) return true;
  
  // Medium similarity with same type and high importance
  if (similarity > 0.85 && node1.type === node2.type) {
    const avgImportance = (node1.importance + node2.importance) / 2;
    if (avgImportance > 0.7) return true;
  }
  
  // Same type, similar tags, both in working memory
  if (node1.level === "working" && node2.level === "working" && node1.type === node2.type) {
    const commonTags = node1.tags.filter(t => node2.tags.includes(t));
    if (commonTags.length > 0 && similarity > 0.75) return true;
  }
  
  // Same source, high similarity
  if (node1.source && node1.source === node2.source && similarity > 0.8) return true;
  
  return false;
}

/**
 * Enhanced memory pruning using Ebbinghaus forgetting curve
 * 
 * Pruning strategies:
 * 1. Working memory: Prune aggressively after short periods
 * 2. Short-term memory: Moderate pruning based on strength decay
 * 3. Long-term memory: Conservative pruning, only very weak/unimportant
 */
// eslint-disable-next-line complexity
export function pruneMemories(
  options: {
    maxAgeDays?: number;
    minImportance?: number;
    minStrength?: number;
    dryRun?: boolean;
  } = {}
): { pruned: number; byLevel: Record<MemoryLevel, number>; candidates: string[] } {
  const { maxAgeDays = 30, minImportance = 0.3, minStrength = 0.15, dryRun = false } = options;
  
  const nodes = loadNodes();
  const vectors = loadVectors();
  const edges = loadEdges();
  
  const now = Date.now();
  
  const toDelete: string[] = [];
  const byLevel: Record<MemoryLevel, number> = { working: 0, short_term: 0, long_term: 0 };
  
  for (const [id, node] of nodes) {
    const age = now - new Date(node.createdAt).getTime();
    const ageInDays = age / (1000 * 60 * 60 * 24);
    
    // Calculate current memory strength
    const currentStrength = calculateMemoryStrength(node);
    
    // Level-specific pruning criteria
    let shouldPrune = false;
    
    switch (node.level) {
      case "working":
        // Working memory: prune if old, low importance, and weak
        // Half-life is ~30 minutes, so prune after a few hours if not reinforced
        if (ageInDays > 0.125 && // 3 hours
            currentStrength < minStrength &&
            node.importance < minImportance &&
            node.accessCount === 0) {
          shouldPrune = true;
        }
        break;
        
      case "short_term":
        // Short-term memory: prune if old, never accessed, and weak
        if (ageInDays > 7 && // 1 week
            currentStrength < minStrength * 1.5 &&
            node.importance < minImportance * 1.2 &&
            node.accessCount < 2) {
          shouldPrune = true;
        }
        break;
        
      case "long_term":
        // Long-term memory: very conservative, only prune if extremely weak
        // and unimportant
        if (ageInDays > maxAgeDays &&
            currentStrength < minStrength * 0.5 &&
            node.importance < minImportance * 0.5 &&
            node.accessCount === 0 &&
            node.consolidationScore < 0.2) {
          shouldPrune = true;
        }
        break;
    }
    
    // Additional heuristics
    // Never prune memories with many connections (important for graph structure)
    let connectionCount = 0;
    for (const [, edge] of edges) {
      if (edge.fromId === id || edge.toId === id) {
        connectionCount++;
      }
    }
    if (connectionCount >= 3) {
      shouldPrune = false; // Preserve well-connected memories
    }
    
    // Never prune high-confidence memories unless very weak
    if (node.confidence > 0.9 && currentStrength > minStrength * 0.8) {
      shouldPrune = false;
    }
    
    if (shouldPrune) {
      toDelete.push(id);
      byLevel[node.level]++;
    }
  }
  
  // Perform deletion if not dry run
  if (!dryRun) {
    for (const id of toDelete) {
      nodes.delete(id);
      vectors.delete(id);
      for (const [edgeId, edge] of edges) {
        if (edge.fromId === id || edge.toId === id) {
          edges.delete(edgeId);
        }
      }
    }
    
    if (toDelete.length > 0) {
      saveNodes(nodes);
      saveVectors(vectors);
      saveEdges(edges);
      log.info("Memories pruned", { 
        count: toDelete.length, 
        byLevel,
        minStrength,
        minImportance 
      });
    }
  }
  
  return { 
    pruned: toDelete.length, 
    byLevel,
    candidates: toDelete 
  };
}

// ── Stats and Reporting ────────────────────────────────────────────

/**
 * Memory graph statistics including enhanced metrics
 */
export interface MemoryGraphStats {
  totalNodes: number;
  totalEdges: number;
  byType: Record<MemoryNodeType, number>;
  byLevel: Record<MemoryLevel, number>;
  avgImportance: number;
  avgStrength: number;
  avgConsolidationScore: number;
  oldestMemory: string;
  newestMemory: string;
  pendingReview: number; // Memories due for review
}

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
  
  const byLevel: Record<MemoryLevel, number> = {
    working: 0,
    short_term: 0,
    long_term: 0,
  };
  
  let totalImportance = 0;
  let totalStrength = 0;
  let totalConsolidation = 0;
  let pendingReview = 0;
  let oldest = new Date().toISOString();
  let newest = new Date(0).toISOString();
  const now = Date.now();
  
  for (const [, node] of nodes) {
    byType[node.type]++;
    byLevel[node.level]++;
    totalImportance += node.importance;
    totalStrength += node.memoryStrength ?? calculateMemoryStrength(node);
    totalConsolidation += node.consolidationScore ?? calculateConsolidationScore(node);
    
    // Check if memory is due for review
    if (node.nextReviewAt && new Date(node.nextReviewAt).getTime() <= now) {
      pendingReview++;
    }
    
    if (node.createdAt < oldest) oldest = node.createdAt;
    if (node.createdAt > newest) newest = node.createdAt;
  }
  
  return {
    totalNodes: nodes.size,
    totalEdges: edges.size,
    byType,
    byLevel,
    avgImportance: nodes.size > 0 ? totalImportance / nodes.size : 0,
    avgStrength: nodes.size > 0 ? totalStrength / nodes.size : 0,
    avgConsolidationScore: nodes.size > 0 ? totalConsolidation / nodes.size : 0,
    oldestMemory: oldest,
    newestMemory: newest,
    pendingReview,
  };
}

export function formatMemoryStats(): string {
  const stats = getMemoryStats();

  const lines: string[] = [
    "🧠 Memory Graph Statistics",
    "",
    `Total Nodes: ${stats.totalNodes}`,
    `Total Edges: ${stats.totalEdges}`,
    "",
    "By Level:",
    `  Working Memory: ${stats.byLevel.working}`,
    `  Short-Term Memory: ${stats.byLevel.short_term}`,
    `  Long-Term Memory: ${stats.byLevel.long_term}`,
    "",
    "By Type:",
    ...Object.entries(stats.byType)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => `  ${type}: ${count}`),
    "",
    "Metrics:",
    `  Average Importance: ${(stats.avgImportance * 100).toFixed(1)}%`,
    `  Average Strength: ${(stats.avgStrength * 100).toFixed(1)}%`,
    `  Average Consolidation: ${(stats.avgConsolidationScore * 100).toFixed(1)}%`,
    `  Pending Review: ${stats.pendingReview}`,
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
function findSimilarPairs(
  nodes: Map<string, MemoryNode>,
  vectors: Map<string, MemoryVector>,
  threshold: number,
): Map<string, string[]> {
  const toMerge = new Map<string, string[]>();
  const processed = new Set<string>();
  for (const [id1] of nodes) {
    if (processed.has(id1)) continue;
    const vec1 = vectors.get(id1)?.embedding;
    if (!vec1) continue;
    const similar: string[] = [];
    for (const [id2] of nodes) {
      if (id1 >= id2 || processed.has(id2)) continue;
      const vec2 = vectors.get(id2)?.embedding;
      if (!vec2) continue;
      if (cosineSimilarity(vec1, vec2) > threshold) {
        similar.push(id2);
        processed.add(id2);
      }
    }
    if (similar.length > 0) {
      toMerge.set(id1, similar);
      processed.add(id1);
    }
  }
  return toMerge;
}

function executeMerge(
  toMerge: Map<string, string[]>,
  nodes: Map<string, MemoryNode>,
  vectors: Map<string, MemoryVector>,
): Array<{ kept: MemoryNode; merged: MemoryNode[] }> {
  const results: Array<{ kept: MemoryNode; merged: MemoryNode[] }> = [];
  for (const [keptId, mergedIds] of toMerge) {
    const kept = nodes.get(keptId)!;
    const merged = mergedIds.map((id) => nodes.get(id)!).filter(Boolean);
    for (const m of merged) {
      kept.content += `\n\n[Consolidated]: ${m.content}`;
      kept.tags = [...new Set([...kept.tags, ...m.tags])];
      kept.importance = Math.max(kept.importance, m.importance);
    }
    kept.updatedAt = new Date().toISOString();
    nodes.set(keptId, kept);
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
  return results;
}

export function autoConsolidate(options: {
  similarityThreshold?: number;
  dryRun?: boolean;
} = {}): Array<{ kept: MemoryNode; merged: MemoryNode[] }> {
  const { similarityThreshold = 0.85, dryRun = false } = options;
  const nodes = loadNodes();
  const vectors = loadVectors();
  const toMerge = findSimilarPairs(nodes, vectors, similarityThreshold);
  let results: Array<{ kept: MemoryNode; merged: MemoryNode[] }>;
 
  if (!dryRun) {
    results = executeMerge(toMerge, nodes, vectors);
  } else {
    results = [];
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

function buildAdjacency(edges: Map<string, MemoryEdge>): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const [, edge] of edges) {
    if (!adjacency.has(edge.fromId)) adjacency.set(edge.fromId, new Set());
    if (!adjacency.has(edge.toId)) adjacency.set(edge.toId, new Set());
    adjacency.get(edge.fromId)!.add(edge.toId);
    adjacency.get(edge.toId)!.add(edge.fromId);
  }
  return adjacency;
}

function clusterTopic(cluster: MemoryNode[]): string {
  const keywordCounts = new Map<string, number>();
  for (const n of cluster) {
    for (const tag of n.tags) {
      keywordCounts.set(tag, (keywordCounts.get(tag) || 0) + 1);
    }
  }
  return Array.from(keywordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k)
    .join(", ") || "mixed";
}

/**
 * Find memory clusters using connected components
 */
export function findMemoryClusters(): Array<{ topic: string; memories: MemoryNode[]; size: number }> {
  const nodes = loadNodes();
  const edges = loadEdges();
  const adjacency = buildAdjacency(edges);
  const clusters: Array<{ topic: string; memories: MemoryNode[]; size: number }> = [];
  const visited = new Set<string>();

  for (const [nodeId] of nodes) {
    if (visited.has(nodeId)) continue;
    const cluster: MemoryNode[] = [];
    const queue: string[] = [nodeId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      const current = nodes.get(currentId);
      if (current) cluster.push(current);
      const neighbors = adjacency.get(currentId);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) queue.push(neighbor);
        }
      }
    }
    if (cluster.length > 1) {
      clusters.push({ topic: clusterTopic(cluster), memories: cluster, size: cluster.length });
    }
  }

  clusters.sort((a, b) => b.size - a.size);
  return clusters;
}
