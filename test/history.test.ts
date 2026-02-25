import { describe, it, expect } from "vitest";
import { generateSparkline } from "../src/health/history.js";

describe("health-history", () => {
  it("should generate empty sparkline for empty data", () => {
    expect(generateSparkline([])).toBe("");
  });

  it("should generate accurate sparkline", () => {
    // 0 is space, 100 is solid block
    const line = generateSparkline([0, 50, 100]);
    expect(line.length).toBe(3);
    expect(line[0]).toBe(" ");
    expect(line[1]).toBe("▅"); // approx middle
    expect(line[2]).toBe("█"); // full block
  });
});
