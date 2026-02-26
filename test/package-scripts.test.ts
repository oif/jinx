import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("package.json scripts", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

  it("should have build script", () => {
    expect(pkg.scripts.build).toBe("tsc");
  });

  it("should have test script", () => {
    expect(pkg.scripts.test).toBe("vitest run");
  });

  it("should have test:watch script", () => {
    expect(pkg.scripts["test:watch"]).toBe("vitest");
  });

  it("should have typecheck script", () => {
    expect(pkg.scripts.typecheck).toBe("tsc --noEmit");
  });

  it("should have dev script", () => {
    expect(pkg.scripts.dev).toBe("tsx src/main.ts");
  });

  it("should have start script", () => {
    expect(pkg.scripts.start).toBe("node --env-file=.env dist/main.js");
  });
});
