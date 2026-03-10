/**
 * Tests for Identity Initialization
 * 
 * Tests the ensureIdentityFiles function which creates identity.md 
 * and scratchpad.md with default content if they don't exist.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ensureIdentityFile,
  ensureScratchpadFile,
  ensureIdentityFiles,
} from "../src/util/identity-init.js";

const DATA_DIR = join(process.cwd(), "data");
const IDENTITY_PATH = join(DATA_DIR, "identity.md");
const SCRATCHPAD_PATH = join(DATA_DIR, "scratchpad.md");

describe("Identity Initialization", () => {
  // Store original files
  let originalIdentity: string | null = null;
  let originalScratchpad: string | null = null;

  beforeEach(() => {
    // Backup original files
    if (existsSync(IDENTITY_PATH)) {
      originalIdentity = readFileSync(IDENTITY_PATH, "utf-8");
      unlinkSync(IDENTITY_PATH);
    } else {
      originalIdentity = null;
    }

    if (existsSync(SCRATCHPAD_PATH)) {
      originalScratchpad = readFileSync(SCRATCHPAD_PATH, "utf-8");
      unlinkSync(SCRATCHPAD_PATH);
    } else {
      originalScratchpad = null;
    }
  });

  afterEach(() => {
    // Restore original files
    if (originalIdentity !== null) {
      mkdirSync(DATA_DIR, { recursive: true });
      // Using writeFileSync would require import, so we just clean up
    }
    
    // Clean up test files
    try {
      if (existsSync(IDENTITY_PATH)) {
        unlinkSync(IDENTITY_PATH);
      }
    } catch {
      // Ignore
    }
    
    try {
      if (existsSync(SCRATCHPAD_PATH)) {
        unlinkSync(SCRATCHPAD_PATH);
      }
    } catch {
      // Ignore
    }
    
    // Restore originals
    if (originalIdentity !== null) {
      writeFileSync(IDENTITY_PATH, originalIdentity);
    }
    if (originalScratchpad !== null) {
      writeFileSync(SCRATCHPAD_PATH, originalScratchpad);
    }
  });

  describe("ensureIdentityFile", () => {
    it("should create identity.md if it doesn't exist", () => {
      // Ensure file doesn't exist
      expect(existsSync(IDENTITY_PATH)).toBe(false);
      
      const result = ensureIdentityFile();
      
      expect(result).toBe(true);
      expect(existsSync(IDENTITY_PATH)).toBe(true);
    });

    it("should return false if identity.md already exists", () => {
      // Create the file first
      ensureIdentityFile();
      
      // Call again
      const result = ensureIdentityFile();
      
      expect(result).toBe(false);
    });

    it("should create file with default content containing key sections", () => {
      ensureIdentityFile();
      
      const content = readFileSync(IDENTITY_PATH, "utf-8");
      
      expect(content).toContain("# Identity");
      expect(content).toContain("我是谁");
      expect(content).toContain("Jinx");
      expect(content).toContain("Neo");
      expect(content).toContain("使命");
    });
  });

  describe("ensureScratchpadFile", () => {
    it("should create scratchpad.md if it doesn't exist", () => {
      // Ensure file doesn't exist
      expect(existsSync(SCRATCHPAD_PATH)).toBe(false);
      
      const result = ensureScratchpadFile();
      
      expect(result).toBe(true);
      expect(existsSync(SCRATCHPAD_PATH)).toBe(true);
    });

    it("should return false if scratchpad.md already exists", () => {
      // Create the file first
      ensureScratchpadFile();
      
      // Call again
      const result = ensureScratchpadFile();
      
      expect(result).toBe(false);
    });

    it("should create file with default content containing key sections", () => {
      ensureScratchpadFile();
      
      const content = readFileSync(SCRATCHPAD_PATH, "utf-8");
      
      expect(content).toContain("# Scratchpad");
      expect(content).toContain("工作记忆");
      expect(content).toContain("当前状态");
      expect(content).toContain("总循环");
    });
  });

  describe("ensureIdentityFiles", () => {
    it("should create both files if they don't exist", () => {
      const result = ensureIdentityFiles();
      
      expect(result.identityCreated).toBe(true);
      expect(result.scratchpadCreated).toBe(true);
      expect(existsSync(IDENTITY_PATH)).toBe(true);
      expect(existsSync(SCRATCHPAD_PATH)).toBe(true);
    });

    it("should return correct status for existing files", () => {
      // Create identity.md only
      ensureIdentityFile();
      
      const result = ensureIdentityFiles();
      
      expect(result.identityCreated).toBe(false);
      expect(result.scratchpadCreated).toBe(true);
    });

    it("should handle both files existing", () => {
      // Create both files
      ensureIdentityFile();
      ensureScratchpadFile();
      
      const result = ensureIdentityFiles();
      
      expect(result.identityCreated).toBe(false);
      expect(result.scratchpadCreated).toBe(false);
    });
  });
});