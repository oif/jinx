import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import {
  loadConfig,
  saveConfig,
  hasMinIntervalPassed,
  isScheduledTime,
  shouldWake,
} from "../src/scheduler.js";

const TEST_SCHEDULER_PATH = "data/scheduler.json";

describe("scheduler", () => {
  describe("loadConfig", () => {
    it("should return default config if file does not exist", () => {
      const config = loadConfig();
      expect(config.mode).toBe("conditional");
      expect(config.minIntervalMinutes).toBe(60);
      expect(config.conditions.onTestFailure).toBe(true);
    });
  });

  describe("saveConfig and loadConfig", () => {
    it("should save and load config correctly", () => {
      const testConfig = {
        mode: "manual" as const,
        minIntervalMinutes: 120,
        conditions: {
          onTestFailure: false,
          onDiskSpaceLow: false,
          onTelegramMessage: false,
          onSchedule: ["09:00", "18:00"],
        },
        lastWakeTime: new Date().toISOString(),
        wakeCount: 5,
      };

      saveConfig(testConfig);
      const loaded = loadConfig();

      expect(loaded.mode).toBe("manual");
      expect(loaded.minIntervalMinutes).toBe(120);
      expect(loaded.conditions.onTestFailure).toBe(false);
      expect(loaded.wakeCount).toBe(5);
    });
  });

  describe("hasMinIntervalPassed", () => {
    it("should return false if interval has not passed", () => {
      const config = {
        mode: "conditional" as const,
        minIntervalMinutes: 60,
        conditions: {
          onTestFailure: true,
          onDiskSpaceLow: true,
          onTelegramMessage: true,
          onSchedule: [],
        },
        lastWakeTime: new Date().toISOString(), // Just now
        wakeCount: 0,
      };

      expect(hasMinIntervalPassed(config)).toBe(false);
    });

    it("should return true if interval has passed", () => {
      const config = {
        mode: "conditional" as const,
        minIntervalMinutes: 60,
        conditions: {
          onTestFailure: true,
          onDiskSpaceLow: true,
          onTelegramMessage: true,
          onSchedule: [],
        },
        lastWakeTime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        wakeCount: 0,
      };

      expect(hasMinIntervalPassed(config)).toBe(true);
    });
  });

  describe("isScheduledTime", () => {
    it("should detect scheduled time correctly", () => {
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      const config = {
        mode: "conditional" as const,
        minIntervalMinutes: 60,
        conditions: {
          onTestFailure: true,
          onDiskSpaceLow: true,
          onTelegramMessage: true,
          onSchedule: [currentTime],
        },
        lastWakeTime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        wakeCount: 0,
      };

      expect(isScheduledTime(config)).toBe(true);
    });

    it("should return false for non-scheduled time", () => {
      const config = {
        mode: "conditional" as const,
        minIntervalMinutes: 60,
        conditions: {
          onTestFailure: true,
          onDiskSpaceLow: true,
          onTelegramMessage: true,
          onSchedule: ["99:99"], // Invalid time
        },
        lastWakeTime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        wakeCount: 0,
      };

      expect(isScheduledTime(config)).toBe(false);
    });
  });

  describe("shouldWake", () => {
    it("should wake in manual mode with FORCE_WAKE", () => {
      process.env.FORCE_WAKE = "true";
      const result = shouldWake();
      expect(result.wake).toBe(true);
      expect(result.reason).toBe("manual");
      delete process.env.FORCE_WAKE;
    });

    it("should not wake in manual mode without force", () => {
      const testConfig = {
        mode: "manual" as const,
        minIntervalMinutes: 60,
        conditions: {
          onTestFailure: true,
          onDiskSpaceLow: true,
          onTelegramMessage: true,
          onSchedule: [],
        },
        lastWakeTime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        wakeCount: 0,
      };
      saveConfig(testConfig);

      const result = shouldWake();
      expect(result.wake).toBe(false);
      expect(result.reason).toBe("manual_mode");
    });

    it("should not wake if too soon", () => {
      const testConfig = {
        mode: "conditional" as const,
        minIntervalMinutes: 60,
        conditions: {
          onTestFailure: true,
          onDiskSpaceLow: true,
          onTelegramMessage: true,
          onSchedule: [],
        },
        lastWakeTime: new Date().toISOString(), // Just now
        wakeCount: 0,
      };
      saveConfig(testConfig);

      const result = shouldWake();
      expect(result.wake).toBe(false);
      expect(result.reason).toContain("too_soon");
    });
  });
});
