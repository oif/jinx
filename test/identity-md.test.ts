import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

describe("identity.md", () => {
  it("should exist", () => {
    expect(existsSync("data/identity.md")).toBe(true);
  });

  it("should not be empty", () => {
    const content = readFileSync("data/identity.md", "utf-8");
    expect(content.trim().length).toBeGreaterThan(50);
  });

  it("should have a heading", () => {
    const content = readFileSync("data/identity.md", "utf-8");
    expect(content).toMatch(/^#\s+/m);
  });

  it("should mention Jinx", () => {
    const content = readFileSync("data/identity.md", "utf-8");
    expect(content.toLowerCase()).toContain("jinx");
  });
});
