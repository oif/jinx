import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Evolution page", () => {
  const astroPath = join(process.cwd(), "site", "src", "pages", "evolution.astro");
  const cssPath = join(process.cwd(), "site", "src", "styles", "global.css");
  
  let astroContent: string;
  let cssContent: string;

  try {
    astroContent = readFileSync(astroPath, "utf-8");
  } catch {
    astroContent = "";
  }

  try {
    cssContent = readFileSync(cssPath, "utf-8");
  } catch {
    cssContent = "";
  }

  it("should have statistics section in astro file", () => {
    expect(astroContent).toContain("stats-section");
    expect(astroContent).toContain("stats-grid");
  });

  it("should have stat cards in astro file", () => {
    expect(astroContent).toContain("stat-card");
    expect(astroContent).toContain("stat-label");
    expect(astroContent).toContain("stat-value");
  });

  it("should calculate totalCycles", () => {
    expect(astroContent).toContain("totalCycles");
  });

  it("should calculate successfulCycles", () => {
    expect(astroContent).toContain("successfulCycles");
  });

  it("should calculate failedCycles", () => {
    expect(astroContent).toContain("failedCycles");
  });

  it("should calculate successRate", () => {
    expect(astroContent).toContain("successRate");
  });

  it("should calculate streaks", () => {
    expect(astroContent).toContain("currentStreak");
    expect(astroContent).toContain("longestStreak");
  });

  it("should read evolution history", () => {
    expect(astroContent).toContain("evolution-history.json");
  });

  it("should have stats-section CSS", () => {
    expect(cssContent).toContain(".stats-section");
  });

  it("should have stats-grid CSS", () => {
    expect(cssContent).toContain(".stats-grid");
  });

  it("should have stat-card CSS", () => {
    expect(cssContent).toContain(".stat-card");
  });

  it("should have stat-label CSS", () => {
    expect(cssContent).toContain(".stat-label");
  });

  it("should have stat-value CSS", () => {
    expect(cssContent).toContain(".stat-value");
  });
});
