import { describe, it, expect, vi, beforeEach } from "vitest";
import { splitMessage } from "../src/telegram/bot.js";

// We can't easily test the full bot creation without mocking Grammy extensively,
// but we can test the message splitting utility which is critical for reliability.

describe("splitMessage", () => {
  it("should return single chunk for short messages", () => {
    const text = "Hello, world!";
    const result = splitMessage(text, 100);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text);
  });

  it("should split at newlines when possible", () => {
    const lines = ["Line 1", "Line 2", "Line 3", "Line 4"];
    const text = lines.join("\n");
    const result = splitMessage(text, 20);
    // Should split at newlines to stay under 20 chars per chunk
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every(chunk => chunk.length <= 20)).toBe(true);
  });

  it("should hard-split long lines that exceed max length", () => {
    const longLine = "a".repeat(100);
    const text = `header\n${longLine}\nfooter`;
    const result = splitMessage(text, 50);
    expect(result.length).toBeGreaterThan(1);
    expect(result.every(chunk => chunk.length <= 50)).toBe(true);
  });

  it("should handle empty string", () => {
    const result = splitMessage("", 100);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("");
  });

  it("should respect Telegram's 4096 char limit default", () => {
    const text = "x".repeat(5000);
    const result = splitMessage(text); // default maxLength = 4096
    expect(result.length).toBeGreaterThan(1);
    expect(result.every(chunk => chunk.length <= 4096)).toBe(true);
  });
});
