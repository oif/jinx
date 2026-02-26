import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Telegram commands", () => {
  const mainPath = join(process.cwd(), "src", "main.ts");
  let mainContent: string;

  try {
    mainContent = readFileSync(mainPath, "utf-8");
  } catch {
    mainContent = "";
  }

  it("should have /help command", () => {
    expect(mainContent).toContain('help:');
    expect(mainContent).toContain('/help');
  });

  it("should have /recent command", () => {
    expect(mainContent).toContain('recent:');
    expect(mainContent).toContain('/recent');
  });

  it("should have /status command", () => {
    expect(mainContent).toContain('status:');
  });

  it("should have /evolution command", () => {
    expect(mainContent).toContain('evolution:');
  });

  it("should have /history command", () => {
    expect(mainContent).toContain('history:');
  });

  it("should have /evolve command", () => {
    expect(mainContent).toContain('evolve:');
  });

  it("should have /stop_evolve command", () => {
    expect(mainContent).toContain('stop_evolve:');
  });

  it("should have /restart command", () => {
    expect(mainContent).toContain('restart:');
  });

  it("should have /ping command", () => {
    expect(mainContent).toContain('ping:');
  });

  it("should have /start command", () => {
    expect(mainContent).toContain('start:');
  });
});
