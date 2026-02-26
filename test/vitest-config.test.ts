import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

describe("vitest configuration", () => {
  it("should have vitest.config.ts file", () => {
    expect(existsSync("vitest.config.ts")).toBe(true);
  });

  it("should use forks pool for stability", () => {
    const configContent = readFileSync("vitest.config.ts", "utf-8");
    expect(configContent).toContain('pool: "forks"');
  });

  it("should disable file parallelism to avoid race conditions", () => {
    const configContent = readFileSync("vitest.config.ts", "utf-8");
    expect(configContent).toContain("fileParallelism: false");
  });

  it("should have proper TypeScript extension resolution", () => {
    const configContent = readFileSync("vitest.config.ts", "utf-8");
    expect(configContent).toContain('.ts"');
    expect(configContent).toContain('.js"');
  });
});
