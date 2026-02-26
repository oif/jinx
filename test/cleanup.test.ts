import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanupOldSessions } from "../src/supervisor/cleanup.js";
import * as fs from "node:fs";
import * as path from "node:path";

vi.mock("node:fs", () => {
  return {
    existsSync: vi.fn().mockReturnValue(true),
    readdirSync: vi.fn().mockReturnValue([
      "session1.jsonl", "session2.jsonl", "session3.jsonl", 
      "session4.jsonl", "session5.jsonl", "session6.jsonl"
    ]),
    statSync: vi.fn((file) => {
      // Create artificial timestamps: file6 is newest, file1 is oldest
      const num = parseInt(file.match(/\d/)[0]);
      return { mtime: { getTime: () => num * 1000 } };
    }),
    unlinkSync: vi.fn(),
  };
});

vi.mock("../src/util/log.js", () => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
  }
}));

describe("cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should delete only the oldest files beyond MAX_SESSIONS_TO_KEEP", () => {
    cleanupOldSessions();
    // Max is 5, we have 6 files. So exactly 1 should be deleted.
    expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
    
    // The oldest file should be deleted, which is session1 based on our statSync mock
    const deletedPath = vi.mocked(fs.unlinkSync).mock.calls[0][0];
    expect(deletedPath).toMatch(/session1\.jsonl$/);
  });
});
