import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { webSearch, formatSearchResults } from "../src/search/web-search.js";

describe("search/web-search", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
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

    it("should use Brave Search when BRAVE_API_KEY is set", async () => {
      process.env.BRAVE_API_KEY = "test-brave-key";

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          web: {
            results: [
              { title: "Test Result", url: "https://example.com", description: "Test description" },
            ],
            total: 1,
          },
          query: { original: "test query" },
        }),
      });

      const result = await webSearch({ query: "test query", count: 5 });

      expect(result.provider).toBe("brave");
      expect(result.results).toHaveLength(1);
      expect(result.results[0].title).toBe("Test Result");
      expect(result.query).toBe("test query");

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("api.search.brave.com"),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Subscription-Token": "test-brave-key",
          }),
        })
      );
    });

    it("should fallback to Serper when Brave fails", async () => {
      process.env.BRAVE_API_KEY = "test-brave-key";
      process.env.SERPER_API_KEY = "test-serper-key";

      // Mock Brave to fail
      global.fetch = vi.fn()
        .mockRejectedValueOnce(new Error("Brave API error"))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            searchParameters: { q: "test query" },
            organic: [
              { title: "Serper Result", link: "https://serper.com", snippet: "Serper description" },
            ],
          }),
        });

      const result = await webSearch({ query: "test query" });

      expect(result.provider).toBe("serper");
      expect(result.results).toHaveLength(1);
      expect(result.results[0].title).toBe("Serper Result");
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
      expect(global.fetch).toHaveBeenCalledWith(
        "https://google.serper.dev/search",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-API-KEY": "test-serper-key",
          }),
        })
      );
    });

    it("should handle empty results", async () => {
      process.env.BRAVE_API_KEY = "test-key";

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          web: { results: [], total: 0 },
          query: { original: "unknown" },
        }),
      });

      const result = await webSearch({ query: "unknown" });

      expect(result.results).toHaveLength(0);
      expect(result.totalResults).toBe(0);
    });

    it("should throw error on API failure", async () => {
      process.env.BRAVE_API_KEY = "test-key";

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "Rate limit exceeded",
      });

      await expect(webSearch({ query: "test" })).rejects.toThrow("Brave Search API error");
    });
  });

  describe("formatSearchResults", () => {
    it("should format search results nicely", () => {
      const response = {
        query: "test query",
        provider: "brave" as const,
        results: [
          {
            title: "First Result",
            url: "https://first.com",
            description: "First description",
            source: "brave",
          },
          {
            title: "Second Result",
            url: "https://second.com",
            description: "Second description",
            source: "brave",
          },
        ],
        totalResults: 100,
      };

      const formatted = formatSearchResults(response);

      expect(formatted).toContain("🔍 Search Results for \"test query\"");
      expect(formatted).toContain("Provider: brave");
      expect(formatted).toContain("1. **First Result**");
      expect(formatted).toContain("https://first.com");
      expect(formatted).toContain("First description");
      expect(formatted).toContain("2. **Second Result**");
      expect(formatted).toContain("Total results: 100");
    });

    it("should handle empty results", () => {
      const response = {
        query: "unknown",
        provider: "brave" as const,
        results: [],
      };

      const formatted = formatSearchResults(response);

      expect(formatted).toContain("🔍 Search Results for \"unknown\"");
      expect(formatted).toContain("No results found");
    });

    it("should not show total when undefined", () => {
      const response = {
        query: "test",
        provider: "serper" as const,
        results: [{ title: "Result", url: "https://test.com", description: "Desc", source: "serper" }],
      };

      const formatted = formatSearchResults(response);

      expect(formatted).not.toContain("Total results:");
    });
  });
});
