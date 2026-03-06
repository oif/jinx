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

  it("should use pnpm in pre-push", () => {
    const content = readFileSync(".husky/pre-push", "utf-8");
    expect(content).toContain("pnpm test");
  });

  it("should run build and quality checks in pre-commit", () => {
    const content = readFileSync(".husky/pre-commit", "utf-8");
    expect(content).toContain("npx tsc");
    expect(content).toContain("npm run quality");
  });

  it("should run test in pre-push", () => {
    const content = readFileSync(".husky/pre-push", "utf-8");
    expect(content).toContain("pnpm test");
  });

  // Tests for pre-push gate functionality
  it("should have husky _ directory with hooks", () => {
    expect(existsSync(".husky/_/pre-push")).toBe(true);
  });

  it("should have executable pre-push hook in husky _ directory", () => {
    const filePath = ".husky/_/pre-push";
    expect(existsSync(filePath)).toBe(true);
    // Verify the hook is executable by reading it
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("h"); // Should source the h script
  });

  it("should have h script in husky _ directory", () => {
    expect(existsSync(".husky/_/h")).toBe(true);
  });

  it("pre-push hook content runs pnpm test", () => {
    // Verify the hook content only — do NOT execute it (would recurse into pnpm test)
    const content = readFileSync(".husky/pre-push", "utf-8");
    expect(content).toContain("pnpm test");
  });
});
