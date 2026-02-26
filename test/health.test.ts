import { describe, it, expect, vi } from "vitest";
import { checkHealth } from "../src/health/check.js";
import si from "systeminformation";

vi.mock("systeminformation", () => {
  return {
    default: {
      mem: vi.fn().mockResolvedValue({
        total: 16000000000,
        free: 8000000000,
        active: 8000000000,
      }),
      currentLoad: vi.fn().mockResolvedValue({
        currentLoad: 45.5,
      }),
      fsSize: vi.fn().mockResolvedValue([
        {
          mount: "/",
          size: 500000000000,
          used: 250000000000,
          use: 50,
        }
      ])
    }
  };
});

describe("health-check", () => {
  it("should return healthy status when metrics are normal", async () => {
    const health = await checkHealth();
    expect(health.status).toBe("healthy");
    expect(health.memory.usedPercent).toBe(50);
    expect(health.cpu.loadPercent).toBe(45.5);
    expect(health.disk.usedPercent).toBe(50);
  });
});
