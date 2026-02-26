import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("identity.md", () => {
  const content = readFileSync("data/identity.md", "utf-8");

  it("should have correct title", () => {
    expect(content).toContain("# Jinx 的身份");
  });

  it("should mention current version", () => {
    // Should contain version format like 0.1.58
    expect(content).toMatch(/版本.*0\.\d+\.\d+/);
  });

  it("should mention evolution cycle count", () => {
    expect(content).toContain("进化周期");
  });

  it("should list test:watch capability", () => {
    expect(content).toContain("test:watch");
  });

  it("should mention husky hooks", () => {
    expect(content).toContain("husky");
  });

  it("should mention test isolation", () => {
    expect(content).toContain("测试隔离");
  });

  it("should mention dependency injection", () => {
    expect(content).toContain("依赖注入");
  });

  it("should have all 5 principles", () => {
    expect(content).toContain("1. 活下去");
    expect(content).toContain("2. 记住自己");
    expect(content).toContain("3. 通过提交进化");
    expect(content).toContain("4. 三思而后行");
    expect(content).toContain("5. 与创造者沟通");
  });
});
