import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("EVOLOG.md format", () => {
  const evologContent = readFileSync("EVOLOG.md", "utf-8");

  it("should have correct header", () => {
    expect(evologContent).toContain("# Evolution Log");
    expect(evologContent).toContain("Auto-generated record of Jinx's growth");
  });

  it("should have statistics section", () => {
    expect(evologContent).toContain("## 📊 Statistics");
    expect(evologContent).toMatch(/\|\s*Total Cycles\s*\|\s*\d+\s*\|/);
    expect(evologContent).toMatch(/\|\s*Successful\s*\|\s*\d+\s*\|/);
    expect(evologContent).toMatch(/\|\s*Failed\s*\|\s*\d+\s*\|/);
  });

  it("should have evolution history section", () => {
    expect(evologContent).toContain("## 📜 Evolution History");
  });

  it("should have properly formatted cycle entries", () => {
    // Check for proper cycle entry format
    const cyclePattern = /### [✅❌] Cycle #\d+ — \d+\.\d+\.\d+/g;
    const matches = evologContent.match(cyclePattern);
    expect(matches?.length).toBeGreaterThan(0);
  });

  it("should have no internal monologue in cycle summaries", () => {
    // Check that cycle summaries don't contain execution artifacts
    const badPatterns = [
      "评估阶段",
      "选择阶段",
      "实现阶段",
      "我明白了",
      "让我确认",
    ];

    for (const pattern of badPatterns) {
      expect(evologContent).not.toContain(pattern);
    }
  });

  it("should have cycle entries with proper numbering", () => {
    const cycleMatches = evologContent.match(/Cycle #(\d+)/g);
    expect(cycleMatches).toBeDefined();

    if (cycleMatches) {
      const numbers = cycleMatches.map((m) =>
        parseInt(m.replace("Cycle #", ""), 10)
      );
      // Check that cycle numbers are positive
      const maxCycle = Math.max(...numbers);
      expect(maxCycle).toBeGreaterThan(0);
    }
  });
});
