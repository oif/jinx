import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { webSearch, formatSearchResults } from "../src/search/web-search.js";

describe("search/web-search", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.EXA_API_KEY;
    delete process.env.BRAVE_API_KEY;
    delete process.env.SERPER_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("webSearch", () => {
    it("should throw error when no API keys are configured", async () => {
      await expect(webSearch({ query: "test" })).rejects.toThrow(
        "No search provider configured"
      );
    });

    it("should use Exa when EXA_API_KEY is set", async () => {
      process.env.EXA_API_KEY = "test-exa-key";

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { 
              title: "Exa Result", 
              url: "https://example.com", 
              text: "Test description",
              summary: "AI-generated summary",
              publishedDate: "2024-01-15T00:00:00Z",
              author: "John Doe"
            },
          ],
        }),
      });

      const result = await webSearch({ query: "test query", count: 5 });

      expect(result.provider).toBe("exa");
      expect(result.results).toHaveLength(1);
      expect(result.results[0].title).toBe("Exa Result");
      expect(result.results[0].summary).toBe("AI-generated summary");
      expect(result.results[0].author).toBe("John Doe");

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.exa.ai/search",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-api-key": "test-exa-key",
          }),
        })
      );
    });

    it("should use Brave Search when BRAVE_API_KEY is set and Exa fails", async () => {
      process.env.EXA_API_KEY = "test-exa-key";
      process.env.BRAVE_API_KEY = "test-brave-key";

      // Mock Exa to fail
      global.fetch = vi.fn()
        .mockRejectedValueOnce(new Error("Exa API error"))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            web: {
              results: [
                { title: "Brave Result", url: "https://brave.com", description: "Brave description" },
              ],
            },
            query: { original: "test query" },
          }),
        });

      const result = await webSearch({ query: "test query" });

      expect(result.provider).toBe("brave");
      expect(result.results).toHaveLength(1);
      expect(result.results[0].title).toBe("Brave Result");
    });

    it("should use Brave Search when only BRAVE_API_KEY is set", async () => {
      process.env.BRAVE_API_KEY = "test-brave-key";

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          web: {
            results: [
              { title: "Brave Only", url: "https://test.com", description: "Description" },
            ],
            total: 100,
          },
          query: { original: "test" },
        }),
      });

      const result = await webSearch({ query: "test" });

      expect(result.provider).toBe("brave");
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("api.search.brave.com"),
        expect.any(Object)
      );
    });

    it("should use Serper when only SERPER_API_KEY is set", async () => {
      process.env.SERPER_API_KEY = "test-serper-key";

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          searchParameters: { q: "test" },
          organic: [
            { title: "Result", link: "https://test.com", snippet: "Description" },
          ],
        }),
      });

      const result = await webSearch({ query: "test" });

      expect(result.provider).toBe("serper");
    });

    it("should handle empty results", async () => {
      process.env.EXA_API_KEY = "test-key";

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [],
        }),
      });

      const result = await webSearch({ query: "unknown" });

      expect(result.results).toHaveLength(0);
    });

    it("should throw error on API failure", async () => {
      process.env.EXA_API_KEY = "test-key";

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "Rate limit exceeded",
      });

      await expect(webSearch({ query: "test" })).rejects.toThrow("Exa API error");
    });

    it("should fallback through all providers", async () => {
      process.env.EXA_API_KEY = "test-exa";
      process.env.BRAVE_API_KEY = "test-brave";
      process.env.SERPER_API_KEY = "test-serper";

      // All providers fail
      global.fetch = vi.fn()
        .mockRejectedValueOnce(new Error("Exa failed"))
        .mockRejectedValueOnce(new Error("Brave failed"))
        .mockRejectedValueOnce(new Error("Serper failed"));

      await expect(webSearch({ query: "test" })).rejects.toThrow("All search providers failed");
    });
  });

  describe("formatSearchResults", () => {
    it("should format Exa search results nicely", () => {
      const response = {
        query: "test query",
        provider: "exa" as const,
        results: [
          {
            title: "First Result",
            url: "https://first.com",
            description: "First description",
            summary: "AI summary of first result",
            author: "Jane Smith",
            publishedDate: "2024-01-15T00:00:00Z",
            source: "exa",
          },
          {
            title: "Second Result",
            url: "https://second.com",
            description: "Second description",
            source: "exa",
          },
        ],
      };

      const formatted = formatSearchResults(response);

      expect(formatted).toContain("🔍 Search Results for \"test query\"");
      expect(formatted).toContain("Provider: exa");
      expect(formatted).toContain("1. **First Result**");
      expect(formatted).toContain("https://first.com");
      expect(formatted).toContain("Author: Jane Smith");
      expect(formatted).toContain("Published: 1/15/2024");
      expect(formatted).toContain("AI summary of first result");
      expect(formatted).toContain("2. **Second Result**");
    });

    it("should format Brave search results", () => {
      const response = {
        query: "test",
        provider: "brave" as const,
        results: [
          { title: "Result", url: "https://test.com", description: "Desc", source: "brave" },
        ],
        totalResults: 100,
      };

      const formatted = formatSearchResults(response);

      expect(formatted).toContain("Provider: brave");
      expect(formatted).toContain("Total results: 100");
    });

    it("should handle empty results", () => {
      const response = {
        query: "unknown",
        provider: "exa" as const,
        results: [],
      };

      const formatted = formatSearchResults(response);

      expect(formatted).toContain("🔍 Search Results for \"unknown\"");
      expect(formatted).toContain("No results found");
    });
  });
});
