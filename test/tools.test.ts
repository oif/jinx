import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchWebpageTool, createPrTool } from "../src/agent/tools.js";
import * as child_process from "node:child_process";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

describe("fetch_webpage_tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

describe("github_create_pr_tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = "fake_token";
  });

  it("should return error if GITHUB_TOKEN is missing", async () => {
    delete process.env.GITHUB_TOKEN;
    const result = await createPrTool.execute("id", { title: "Test", body: "Test body" });
    expect((result.content[0] as any).text).toContain("Error: GITHUB_TOKEN environment variable is not set.");
  });

  it("should successfully create PR", async () => {
    vi.mocked(child_process.execSync).mockReturnValue("origin\tgit@github.com:oif/jinx.git (fetch)\n" as any);
    
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        number: 42,
        html_url: "https://github.com/oif/jinx/pull/42",
      })
    });

    const result = await createPrTool.execute("id", { title: "Test PR", body: "A great feature" });
    const content = (result.content[0] as any).text;
    
    expect(content).toContain("Successfully created Pull Request #42");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/oif/jinx/pulls",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: "Test PR",
          body: "A great feature",
          head: "dev",
          base: "main"
        })
      })
    );
  });
});
