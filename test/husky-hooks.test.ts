import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

describe("husky hooks", () => {
  it("should have pre-commit hook", () => {
    expect(existsSync(".husky/pre-commit")).toBe(true);
  });

  it("should have pre-push hook", () => {
    expect(existsSync(".husky/pre-push")).toBe(true);
  });

  it("should use npm in pre-commit (not pnpm)", () => {
    const content = readFileSync(".husky/pre-commit", "utf-8");
    expect(content).toContain("npm");
    expect(content).not.toContain("pnpm");
  });

  it("should use npm in pre-push (not pnpm)", () => {
    const content = readFileSync(".husky/pre-push", "utf-8");
    expect(content).toContain("npm");
    expect(content).not.toContain("pnpm");
  });

  it("should run build and typecheck in pre-commit", () => {
    const content = readFileSync(".husky/pre-commit", "utf-8");
    expect(content).toContain("npm run build");
    expect(content).toContain("npm run typecheck");
  });

  it("should run test in pre-push", () => {
    const content = readFileSync(".husky/pre-push", "utf-8");
    expect(content).toContain("npm test");
  });
});
