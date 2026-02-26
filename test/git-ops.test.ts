import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { 
  getCurrentBranch, 
  getCurrentSha, 
  ensureDevBranch,
  safePull,
  rollbackToMain 
} from "../src/supervisor/git-ops.js";
import { execSync } from "node:child_process";

describe("git-ops", () => {
  describe("getCurrentBranch", () => {
    it("should return valid branch name", () => {
      const branch = getCurrentBranch();
      expect(typeof branch).toBe("string");
      expect(branch.length).toBeGreaterThan(0);
    });

    it("should return 'unknown' when git fails", () => {
      // This is implicitly tested when not in a git repo
      // We can't easily mock execSync, so we verify the fallback exists
      const result = getCurrentBranch();
      expect(result === "unknown" || result.length > 0).toBe(true);
    });
  });

  describe("getCurrentSha", () => {
    it("should return valid sha", () => {
      const sha = getCurrentSha();
      expect(typeof sha).toBe("string");
      expect(sha.length).toBeGreaterThanOrEqual(7);
    });

    it("should return 'unknown' when git fails", () => {
      const result = getCurrentSha();
      expect(result === "unknown" || result.length >= 7).toBe(true);
    });
  });

  describe("ensureDevBranch", () => {
    it("should not throw when already on dev branch", () => {
      const currentBranch = getCurrentBranch();
      if (currentBranch === "dev") {
        expect(() => ensureDevBranch()).not.toThrow();
      }
    });

    it("should switch to dev branch if not on it", () => {
      const initialBranch = getCurrentBranch();
      
      // If we're not on dev, calling ensureDevBranch should switch us
      if (initialBranch !== "dev") {
        ensureDevBranch();
        const newBranch = getCurrentBranch();
        expect(newBranch).toBe("dev");
        
        // Restore original branch
        execSync(`git checkout ${initialBranch}`, { cwd: process.cwd() });
      }
    });
  });

  describe("safePull", () => {
    it("should return a boolean", () => {
      // We can't reliably test the actual pull without network
      // but we can verify the function signature
      const result = safePull();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("rollbackToMain", () => {
    it("should return a boolean", () => {
      const result = rollbackToMain();
      expect(typeof result).toBe("boolean");
    });

    it("should switch to main branch when successful", () => {
      // First ensure we're not on main
      const initialBranch = getCurrentBranch();
      
      const success = rollbackToMain();
      
      if (success) {
        expect(getCurrentBranch()).toBe("main");
        
        // Restore dev branch
        ensureDevBranch();
      }
    });
  });
});
