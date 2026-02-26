import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Site file paths", () => {
  const evolutionAstroPath = join(process.cwd(), "site", "src", "pages", "evolution.astro");
  const indexAstroPath = join(process.cwd(), "site", "src", "pages", "index.astro");
  
  let evolutionContent: string;
  let indexContent: string;

  try {
    evolutionContent = readFileSync(evolutionAstroPath, "utf-8");
  } catch {
    evolutionContent = "";
  }

  try {
    indexContent = readFileSync(indexAstroPath, "utf-8");
  } catch {
    indexContent = "";
  }

  it("should read evolution-history.json from root directory", () => {
    // Should reference ../evolution-history.json, not ../data/evolution-history.json
    expect(evolutionContent).toContain("../evolution-history.json");
    expect(evolutionContent).not.toContain("../data/evolution-history.json");
  });

  it("should read health-history.json from root directory", () => {
    // Should not use DATA_DIR for health-history.json (should use root directory)
    expect(indexContent).not.toContain("DATA_DIR, 'health-history.json'");
    expect(indexContent).not.toContain('join(DATA_DIR, "health-history.json")');
    // Should use process.cwd() to construct the path
    expect(indexContent).toContain("process.cwd()");
  });
});
