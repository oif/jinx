import { describe, it, expect, vi } from "vitest";
import { getCurrentBranch, getCurrentSha } from "../src/supervisor/git-ops.js";

describe("git-ops", () => {
  it("should return valid branch name", () => {
    const branch = getCurrentBranch();
    expect(typeof branch).toBe("string");
    expect(branch.length).toBeGreaterThan(0);
  });

  it("should return valid sha", () => {
    const sha = getCurrentSha();
    expect(typeof sha).toBe("string");
    expect(sha.length).toBeGreaterThanOrEqual(7);
  });
});
