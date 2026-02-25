import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkCrashLoopAndRecover, markIntentionalRestart } from "../src/supervisor/recovery.js";
import { rollbackToMain, rebuild } from "../src/supervisor/git-ops.js";
import * as fs from "node:fs";

vi.mock("node:fs", () => {
  return {
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

vi.mock("../src/supervisor/git-ops.js", () => ({
  rollbackToMain: vi.fn().mockReturnValue(true),
  rebuild: vi.fn(),
  getCurrentSha: vi.fn().mockReturnValue("abcdef"),
}));

vi.mock("../src/util/log.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

describe("crash-recovery", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
  });

  it("should detect stable boot and reset crash count", () => {
    const twoMinutesAgo = new Date(Date.now() - 120_000).toISOString();
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      lastBoot: twoMinutesAgo,
      crashCount: 2
    }));

    checkCrashLoopAndRecover();

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    const writtenState = JSON.parse(writeCall);
    expect(writtenState.crashCount).toBe(0);
    expect(rollbackToMain).not.toHaveBeenCalled();
  });

  it("should increment crash count on rapid boot", () => {
    const twoSecondsAgo = new Date(Date.now() - 2000).toISOString();
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      lastBoot: twoSecondsAgo,
      crashCount: 1
    }));

    checkCrashLoopAndRecover();

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    const writtenState = JSON.parse(writeCall);
    expect(writtenState.crashCount).toBe(2);
    expect(rollbackToMain).not.toHaveBeenCalled();
  });

  it("should execute rollback when max crashes reached", () => {
    const twoSecondsAgo = new Date(Date.now() - 2000).toISOString();
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      lastBoot: twoSecondsAgo,
      crashCount: 2 // Next crash will be 3
    }));

    checkCrashLoopAndRecover();

    const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
    
    expect(rollbackToMain).toHaveBeenCalled();
    expect(rebuild).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);

    // Should have reset the crash count in the final write
    const finalWriteCall = writeCalls[writeCalls.length - 1][1] as string;
    const writtenState = JSON.parse(finalWriteCall);
    expect(writtenState.crashCount).toBe(0);
  });

  it("markIntentionalRestart should clear crash counter and lastBoot", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      lastBoot: new Date().toISOString(),
      crashCount: 2
    }));

    markIntentionalRestart();
    
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    const writtenState = JSON.parse(writeCall);
    expect(writtenState.crashCount).toBe(0);
    expect(new Date(writtenState.lastBoot).getTime()).toBe(0); // 1970
  });
});
