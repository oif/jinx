import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

const SITE_DIR = join(process.cwd(), "site");

describe("Site New Pages", () => {
  describe("Skills Page", () => {
    it("should have skills.astro page", () => {
      const pagePath = join(SITE_DIR, "src/pages/skills.astro");
      expect(existsSync(pagePath)).toBe(true);
    });

    it("should export skills.html after build", () => {
      const distPath = join(SITE_DIR, "dist/skills/index.html");
      expect(existsSync(distPath)).toBe(true);
    });
  });

  describe("Memory Page", () => {
    it("should have memory.astro page", () => {
      const pagePath = join(SITE_DIR, "src/pages/memory.astro");
      expect(existsSync(pagePath)).toBe(true);
    });

    it("should export memory.html after build", () => {
      const distPath = join(SITE_DIR, "dist/memory/index.html");
      expect(existsSync(distPath)).toBe(true);
    });
  });

  describe("Navigation Updated", () => {
    it("should include skills link in navigation", () => {
      const basePath = join(SITE_DIR, "src/layouts/Base.astro");
      const content = require("node:fs").readFileSync(basePath, "utf-8");
      expect(content).toContain('href="/jinx/skills/"');
    });

    it("should include memory link in navigation", () => {
      const basePath = join(SITE_DIR, "src/layouts/Base.astro");
      const content = require("node:fs").readFileSync(basePath, "utf-8");
      expect(content).toContain('href="/jinx/memory/"');
    });
  });
});
