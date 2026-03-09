/**
 * Tests for version-sync utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getPackageVersion, syncIdentityVersion, syncScratchpadVersion, syncAllVersions } from "../src/util/version-sync.js";

// Mock fs module
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

// Mock log module
vi.mock("../src/util/log.js", () => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe("version-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("getPackageVersion", () => {
    it("should return version from package.json", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: "1.2.3" }));
      
      const version = getPackageVersion();
      
      expect(version).toBe("1.2.3");
    });

    it("should return 0.0.0 when version is missing", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({}));
      
      const version = getPackageVersion();
      
      expect(version).toBe("0.0.0");
    });

    it("should return 0.0.0 when package.json cannot be read", () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error("File not found");
      });
      
      const version = getPackageVersion();
      
      expect(version).toBe("0.0.0");
    });
  });

  describe("syncIdentityVersion", () => {
    it("should update version, cycle, and streak in identity.md", () => {
      const mockContent = `
# Identity

- **版本**: 0.1.0
- **进化循环**: 10 次
- **当前 streak**: 5
`;
      vi.mocked(readFileSync).mockReturnValue(mockContent);
      
      syncIdentityVersion("0.2.0", 20, 10);
      
      expect(writeFileSync).toHaveBeenCalled();
      const writtenContent = vi.mocked(writeFileSync).mock.calls[0][1] as string;
      expect(writtenContent).toContain("**版本**: 0.2.0");
      expect(writtenContent).toContain("**进化循环**: 20 次");
      expect(writtenContent).toContain("**当前 streak**: 10");
    });

    it("should handle missing fields gracefully", () => {
      vi.mocked(readFileSync).mockReturnValue("# Identity\n\nNo version fields");
      
      syncIdentityVersion("1.0.0", 1, 1);
      
      expect(writeFileSync).toHaveBeenCalled();
    });
  });

  describe("syncScratchpadVersion", () => {
    it("should update version, cycle, and streak in scratchpad.md", () => {
      const mockContent = `
# Scratchpad

- 版本: 0.1.0
- 进化循环 10 次
- streak 5
`;
      vi.mocked(readFileSync).mockReturnValue(mockContent);
      
      syncScratchpadVersion("0.2.0", 20, 10);
      
      expect(writeFileSync).toHaveBeenCalled();
      const writtenContent = vi.mocked(writeFileSync).mock.calls[0][1] as string;
      expect(writtenContent).toContain("版本: 0.2.0");
      expect(writtenContent).toContain("进化循环 20 次");
      expect(writtenContent).toContain("streak 10");
    });
  });

  describe("syncAllVersions", () => {
    it("should sync all documentation files", () => {
      vi.mocked(readFileSync)
        .mockReturnValueOnce(JSON.stringify({ version: "1.0.0" }))
        .mockReturnValue("# Identity\n- **版本**: 0.0.0")
        .mockReturnValue("# Scratchpad\n- 版本: 0.0.0");
      
      syncAllVersions(50, 25);
      
      // Called for identity.md and scratchpad.md
      expect(writeFileSync).toHaveBeenCalledTimes(2);
    });

    it("should use default values when not provided", () => {
      vi.mocked(readFileSync)
        .mockReturnValueOnce(JSON.stringify({ version: "1.0.0" }))
        .mockReturnValue("# Identity\n- **版本**: 0.0.0")
        .mockReturnValue("# Scratchpad\n- 版本: 0.0.0");
      
      syncAllVersions();
      
      expect(writeFileSync).toHaveBeenCalledTimes(2);
    });
  });
});