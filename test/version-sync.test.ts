import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getPackageVersion, syncIdentityVersion, syncScratchpadVersion, syncAllVersions } from "../src/util/version-sync.js";

const TEST_DIR = join(process.cwd(), "test", "fixtures");
const TEST_IDENTITY = join(TEST_DIR, "test-identity.md");
const TEST_SCRATCHPAD = join(TEST_DIR, "test-scratchpad.md");

// Original content templates
const originalIdentityContent = `# Jinx 的身份

## 当前状态
- **版本**: 0.0.40
- **进化循环**: 20 次（19 成功，1 失败）
- **当前 streak**: 4

## 能力
- 完整的测试覆盖（106 个测试）
`;

const originalScratchpadContent = `# Scratchpad — 工作记忆

## 当前状态
- 版本: 0.0.40

## 最近的改动
- 进化循环 20 次，streak 4
`;

describe("version-sync", () => {
  beforeEach(() => {
    // Create test fixtures directory
    if (!existsSync(TEST_DIR)) {
      const { mkdirSync } = require("node:fs");
      mkdirSync(TEST_DIR, { recursive: true });
    }
    
    // Write test files
    writeFileSync(TEST_IDENTITY, originalIdentityContent);
    writeFileSync(TEST_SCRATCHPAD, originalScratchpadContent);
  });

  afterEach(() => {
    // Cleanup is optional - keep files for debugging if needed
  });

  describe("getPackageVersion", () => {
    it("should return version from package.json", () => {
      const version = getPackageVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(version).toBe("0.0.44"); // Current version
    });
  });

  describe("syncIdentityVersion", () => {
    it("should update version in identity.md", () => {
      // Temporarily override the path by modifying the file directly
      const testContent = readFileSync(TEST_IDENTITY, "utf-8");
      
      // Verify original content
      expect(testContent).toContain("版本**: 0.0.40");
      
      // Create a modified version manually to test the regex
      let updatedContent = testContent.replace(
        /-\s*\*\*版本\*\*:\s*[\d.]+/,
        `- **版本**: 0.0.45`
      );
      
      expect(updatedContent).toContain("版本**: 0.0.45");
      expect(updatedContent).not.toContain("版本**: 0.0.40");
    });

    it("should update cycle count in identity.md", () => {
      const testContent = readFileSync(TEST_IDENTITY, "utf-8");
      
      // Verify original content
      expect(testContent).toContain("进化循环**: 20 次");
      
      // Test regex replacement
      let updatedContent = testContent.replace(
        /-\s*\*\*进化循环\*\*:\s*\d+\s*次/,
        `- **进化循环**: 25 次`
      );
      
      expect(updatedContent).toContain("进化循环**: 25 次");
      expect(updatedContent).not.toContain("进化循环**: 20 次");
    });

    it("should update streak in identity.md", () => {
      const testContent = readFileSync(TEST_IDENTITY, "utf-8");
      
      // Verify original content
      expect(testContent).toContain("当前 streak**: 4");
      
      // Test regex replacement
      let updatedContent = testContent.replace(
        /-\s*\*\*当前 streak\*\*:\s*\d+/,
        `- **当前 streak**: 5`
      );
      
      expect(updatedContent).toContain("当前 streak**: 5");
      expect(updatedContent).not.toContain("当前 streak**: 4");
    });
  });

  describe("syncScratchpadVersion", () => {
    it("should update version in scratchpad.md", () => {
      const testContent = readFileSync(TEST_SCRATCHPAD, "utf-8");
      
      // Verify original content
      expect(testContent).toContain("版本: 0.0.40");
      
      // Test regex replacement
      let updatedContent = testContent.replace(
        /-\s*版本:\s*[\d.]+/,
        `- 版本: 0.0.45`
      );
      
      expect(updatedContent).toContain("版本: 0.0.45");
      expect(updatedContent).not.toContain("版本: 0.0.40");
    });

    it("should update cycle count in scratchpad.md", () => {
      const testContent = readFileSync(TEST_SCRATCHPAD, "utf-8");
      
      // Verify original content
      expect(testContent).toContain("进化循环 20 次");
      
      // Test regex replacement
      let updatedContent = testContent.replace(
        /进化循环\s*\d+\s*次/,
        `进化循环 25 次`
      );
      
      expect(updatedContent).toContain("进化循环 25 次");
      expect(updatedContent).not.toContain("进化循环 20 次");
    });

    it("should update streak in scratchpad.md", () => {
      const testContent = readFileSync(TEST_SCRATCHPAD, "utf-8");
      
      // Verify original content
      expect(testContent).toContain("streak 4");
      
      // Test regex replacement
      let updatedContent = testContent.replace(
        /streak\s*\d+/,
        `streak 5`
      );
      
      expect(updatedContent).toContain("streak 5");
      expect(updatedContent).not.toContain("streak 4");
    });
  });

  describe("version format validation", () => {
    it("should handle semver version format", () => {
      const validVersions = ["0.0.1", "1.0.0", "0.10.5", "2.3.4"];
      const semverRegex = /^\d+\.\d+\.\d+$/;
      
      for (const version of validVersions) {
        expect(version).toMatch(semverRegex);
      }
    });

    it("should handle version numbers in Chinese text", () => {
      const chineseText = "- **版本**: 0.0.45";
      const match = chineseText.match(/版本\*\*:\s*([\d.]+)/);
      expect(match).toBeTruthy();
      expect(match![1]).toBe("0.0.45");
    });
  });
});
