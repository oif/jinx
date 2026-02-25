import { describe, it, expect, vi } from "vitest";
import { fetchWebpageTool } from "../src/agent/tools.js";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("fetch_webpage_tool", () => {
  it("should extract markdown from simple html", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `
        <html>
          <body>
            <header><h1>Header Noise</h1></header>
            <main>
              <h1>Title</h1>
              <p>This is some content.</p>
              <a href="/link">A link</a>
            </main>
            <footer><p>Footer Noise</p></footer>
          </body>
        </html>
      `
    });

    const result = await fetchWebpageTool.execute(
      "test_call_id",
      { url: "https://example.com" }
    );

    const content = result.content[0];
    if (content.type === "text") {
      expect(content.text).toContain("# Title");
      expect(content.text).toContain("This is some content.");
      expect(content.text).toContain("[A link](/link)");
      expect(content.text).not.toContain("Header Noise");
      expect(content.text).not.toContain("Footer Noise");
    } else {
      expect.fail("Result content is not text");
    }
  });

  it("should handle HTTP errors gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const result = await fetchWebpageTool.execute(
      "test_call_id",
      { url: "https://example.com/missing" }
    );

    const content = result.content[0];
    if (content.type === "text") {
      expect(content.text).toContain("Failed to fetch https://example.com/missing: HTTP 404 Not Found");
    } else {
      expect.fail("Result content is not text");
    }
  });
});
