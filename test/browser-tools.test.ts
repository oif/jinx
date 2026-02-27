import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  takeScreenshotTool,
  analyzeWebpageTool,
  testPageInteractionTool,
} from "../src/agent/tools.js";

// Mock browser automation module
vi.mock("../src/browser/automation.js", () => ({
  takeScreenshot: vi.fn(),
  analyzePage: vi.fn(),
  testPageInteraction: vi.fn(),
  formatPageInfo: vi.fn((info) => `Mock formatted: ${info.title}`),
}));

import {
  takeScreenshot,
  analyzePage,
  testPageInteraction,
} from "../src/browser/automation.js";

describe("Browser Automation Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("takeScreenshotTool", () => {
    it("should take a screenshot with default options", async () => {
      const mockBuffer = Buffer.from("fake-image-data");
      vi.mocked(takeScreenshot).mockResolvedValue({
        path: "/tmp/screenshot-123.png",
        data: mockBuffer,
        message: "Screenshot captured: viewport",
      });

      const result = await takeScreenshotTool.execute(
        "test-call-id",
        { url: "https://example.com" },
        undefined,
        undefined as any,
        undefined as any
      );

      expect(takeScreenshot).toHaveBeenCalledWith({
        url: "https://example.com",
        fullPage: undefined,
        width: undefined,
        height: undefined,
        selector: undefined,
        waitFor: undefined,
      });

      const text = result.content.find((c) => c.type === "text")?.text as string;
      expect(text).toContain("Screenshot captured");
      expect(text).toContain("https://example.com");
      expect(text).toContain("viewport");
    });

    it("should take a screenshot with full page option", async () => {
      const mockBuffer = Buffer.from("fake-image-data");
      vi.mocked(takeScreenshot).mockResolvedValue({
        path: "/tmp/screenshot-456.png",
        data: mockBuffer,
        message: "Screenshot captured: full page",
      });

      const result = await takeScreenshotTool.execute(
        "test-call-id",
        { url: "https://example.com", fullPage: true },
        undefined,
        undefined as any,
        undefined as any
      );

      expect(takeScreenshot).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://example.com",
          fullPage: true,
        })
      );

      const text = result.content.find((c) => c.type === "text")?.text as string;
      expect(text).toContain("full page");
    });

    it("should take a screenshot of specific element", async () => {
      const mockBuffer = Buffer.from("fake-image-data");
      vi.mocked(takeScreenshot).mockResolvedValue({
        path: "/tmp/screenshot-element-789.png",
        data: mockBuffer,
        message: "Screenshot captured: #header",
      });

      const result = await takeScreenshotTool.execute(
        "test-call-id",
        { url: "https://example.com", selector: "#header" },
        undefined,
        undefined as any,
        undefined as any
      );

      expect(takeScreenshot).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://example.com",
          selector: "#header",
        })
      );

      const text = result.content.find((c) => c.type === "text")?.text as string;
      expect(text).toContain("element");
    });

    it("should handle screenshot errors", async () => {
      vi.mocked(takeScreenshot).mockRejectedValue(new Error("Navigation timeout"));

      const result = await takeScreenshotTool.execute(
        "test-call-id",
        { url: "https://invalid-url" },
        undefined,
        undefined as any,
        undefined as any
      );

      const text = result.content.find((c) => c.type === "text")?.text as string;
      expect(text).toContain("Screenshot failed");
      expect(text).toContain("Navigation timeout");
    });
  });

  describe("analyzeWebpageTool", () => {
    it("should analyze a webpage successfully", async () => {
      const mockPageInfo = {
        title: "Test Page",
        url: "https://example.com",
        description: "A test page",
        headings: ["Heading 1", "Heading 2"],
        links: [{ text: "Link 1", href: "/page1" }],
        images: [{ alt: "Image 1", src: "/img1.png" }],
      };
      vi.mocked(analyzePage).mockResolvedValue(mockPageInfo);

      const result = await analyzeWebpageTool.execute(
        "test-call-id",
        { url: "https://example.com" },
        undefined,
        undefined as any,
        undefined as any
      );

      expect(analyzePage).toHaveBeenCalledWith("https://example.com");

      const text = result.content.find((c) => c.type === "text")?.text as string;
      expect(text).toContain("Mock formatted: Test Page");
    });

    it("should handle analysis errors", async () => {
      vi.mocked(analyzePage).mockRejectedValue(new Error("Connection refused"));

      const result = await analyzeWebpageTool.execute(
        "test-call-id",
        { url: "https://invalid-url" },
        undefined,
        undefined as any,
        undefined as any
      );

      const text = result.content.find((c) => c.type === "text")?.text as string;
      expect(text).toContain("Page analysis failed");
      expect(text).toContain("Connection refused");
    });
  });

  describe("testPageInteractionTool", () => {
    it("should execute interactions successfully", async () => {
      vi.mocked(testPageInteraction).mockResolvedValue({
        success: true,
        finalUrl: "https://example.com/success",
        message: "Successfully executed 2 interactions",
      });

      const actions = JSON.stringify([
        { type: "click", selector: "#btn" },
        { type: "fill", selector: "#input", value: "test" },
      ]);

      const result = await testPageInteractionTool.execute(
        "test-call-id",
        { url: "https://example.com", actions },
        undefined,
        undefined as any,
        undefined as any
      );

      expect(testPageInteraction).toHaveBeenCalledWith("https://example.com", [
        { type: "click", selector: "#btn" },
        { type: "fill", selector: "#input", value: "test" },
      ]);

      const text = result.content.find((c) => c.type === "text")?.text as string;
      expect(text).toContain("✅ Interaction test successful");
      expect(text).toContain("Actions executed: 2");
    });

    it("should handle interaction failures", async () => {
      vi.mocked(testPageInteraction).mockResolvedValue({
        success: false,
        finalUrl: "https://example.com",
        message: "Interaction failed: Element not found",
      });

      const actions = JSON.stringify([{ type: "click", selector: "#missing" }]);

      const result = await testPageInteractionTool.execute(
        "test-call-id",
        { url: "https://example.com", actions },
        undefined,
        undefined as any,
        undefined as any
      );

      const text = result.content.find((c) => c.type === "text")?.text as string;
      expect(text).toContain("❌ Interaction test failed");
      expect(text).toContain("Element not found");
    });

    it("should handle invalid JSON in actions", async () => {
      const result = await testPageInteractionTool.execute(
        "test-call-id",
        { url: "https://example.com", actions: "invalid json" },
        undefined,
        undefined as any,
        undefined as any
      );

      const text = result.content.find((c) => c.type === "text")?.text as string;
      expect(text).toContain("Invalid actions JSON");
    });

    it("should handle non-array actions", async () => {
      const result = await testPageInteractionTool.execute(
        "test-call-id",
        { url: "https://example.com", actions: "{\"not\": \"array\"}" },
        undefined,
        undefined as any,
        undefined as any
      );

      const text = result.content.find((c) => c.type === "text")?.text as string;
      expect(text).toContain("Invalid actions JSON");
    });
  });
});
