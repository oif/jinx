import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getEvolutionCyclePrompt,
  getConsciousnessCheckPrompt,
  getPrompt,
  validatePromptTemplate,
  getAvailablePromptNames,
  getDefaultTemplates,
} from "../src/config/evolution-prompt.js";

describe("config/evolution-prompt", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getEvolutionCyclePrompt", () => {
    it("should return default prompt with cycle number substituted", () => {
      const prompt = getEvolutionCyclePrompt(15);
      expect(prompt).toContain("15");
      expect(prompt).toContain("进化循环");
      expect(prompt).toContain("评估 —— 查看 codebase");
      expect(prompt).toContain("BORN.md");
    });

    it("should substitute cycle variable multiple times", () => {
      const prompt = getEvolutionCyclePrompt(42);
      const matches = prompt.match(/42/g);
      expect(matches?.length).toBeGreaterThan(1);
    });

    it("should use custom prompt from environment variable", () => {
      process.env.EVOLUTION_CYCLE_PROMPT = "Custom prompt for cycle {cycle}";
      const prompt = getEvolutionCyclePrompt(5);
      expect(prompt).toBe("Custom prompt for cycle 5");
    });

    it("should handle large cycle numbers", () => {
      const prompt = getEvolutionCyclePrompt(999999);
      expect(prompt).toContain("999999");
    });
  });

  describe("getConsciousnessCheckPrompt", () => {
    it("should return default consciousness check prompt", () => {
      const prompt = getConsciousnessCheckPrompt();
      expect(prompt).toContain("Wake up");
      expect(prompt).toContain("identity.md");
      expect(prompt).toContain("scratchpad.md");
    });

    it("should use custom prompt from environment variable", () => {
      process.env.CONSCIOUSNESS_CHECK_PROMPT = "Custom check prompt";
      const prompt = getConsciousnessCheckPrompt();
      expect(prompt).toBe("Custom check prompt");
    });
  });

  describe("getPrompt", () => {
    it("should return EVOLUTION_CYCLE template", () => {
      const prompt = getPrompt("EVOLUTION_CYCLE");
      expect(prompt).toContain("进化循环");
    });

    it("should return CONSCIOUSNESS_CHECK template", () => {
      const prompt = getPrompt("CONSCIOUSNESS_CHECK");
      expect(prompt).toContain("Wake up");
    });
  });

  describe("validatePromptTemplate", () => {
    it("should return true when all required variables are present", () => {
      const result = validatePromptTemplate("Hello {name}, you are {age}", ["name", "age"]);
      expect(result).toBe(true);
    });

    it("should return false when a required variable is missing", () => {
      const result = validatePromptTemplate("Hello {name}", ["name", "age"]);
      expect(result).toBe(false);
    });

    it("should return true for empty required vars list", () => {
      const result = validatePromptTemplate("Any prompt", []);
      expect(result).toBe(true);
    });
  });

  describe("getAvailablePromptNames", () => {
    it("should return array of prompt names", () => {
      const names = getAvailablePromptNames();
      expect(names).toContain("EVOLUTION_CYCLE");
      expect(names).toContain("CONSCIOUSNESS_CHECK");
      expect(names.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("getDefaultTemplates", () => {
    it("should return copy of default templates", () => {
      const templates = getDefaultTemplates();
      expect(templates.EVOLUTION_CYCLE).toContain("进化循环");
      expect(templates.CONSCIOUSNESS_CHECK).toContain("Wake up");
    });

    it("should return a copy (modification doesn't affect original)", () => {
      const templates = getDefaultTemplates();
      templates.EVOLUTION_CYCLE = "modified";
      const templates2 = getDefaultTemplates();
      expect(templates2.EVOLUTION_CYCLE).not.toBe("modified");
    });
  });
});
