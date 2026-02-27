import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readVersion, readState, type State } from "../src/util/state.js";
import { existsSync, unlinkSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TEST_STATE_PATH = join(process.cwd(), "data", "state.json");
const PACKAGE_PATH = join(process.cwd(), "package.json");
const HISTORY_PATH = join(process.cwd(), "data", "evolution-history.json");

describe("state utilities", () => {
  // Store original files content
  let originalPackageContent: string;
  let originalHistoryContent: string | null = null;

  beforeEach(() => {
    // Ensure data directory exists
    try {
      mkdirSync(join(process.cwd(), "data"), { recursive: true });
    } catch {
      // Directory may already exist
    }

    // Clean up test state file
    if (existsSync(TEST_STATE_PATH)) {
      unlinkSync(TEST_STATE_PATH);
    }

    // Store original content
    originalPackageContent = readFileSync(PACKAGE_PATH, "utf-8");
    originalHistoryContent = existsSync(HISTORY_PATH) ? readFileSync(HISTORY_PATH, "utf-8") : null;
  });

  afterEach(() => {
    // Restore original content
    writeFileSync(PACKAGE_PATH, originalPackageContent);
    if (originalHistoryContent !== null) {
      writeFileSync(HISTORY_PATH, originalHistoryContent);
    } else if (existsSync(HISTORY_PATH)) {
      unlinkSync(HISTORY_PATH);
    }
  });

  describe("readVersion", () => {
    it("should return version from package.json", () => {
      // Read actual package.json version
      const pkg = JSON.parse(originalPackageContent);
      const version = readVersion();
      expect(version).toBe(pkg.version);
    });

    it("should return default version when package.json is missing version field", () => {
      // Temporarily modify package.json to remove version
      const pkg = JSON.parse(originalPackageContent);
      delete pkg.version;
      writeFileSync(PACKAGE_PATH, JSON.stringify(pkg, null, 2));

      const version = readVersion();
      expect(version).toBe("0.0.1");
    });

    it("should return default version when package.json is malformed", () => {
      writeFileSync(PACKAGE_PATH, "not valid json");

      const version = readVersion();
      expect(version).toBe("0.0.1");
    });
  });

  describe("readState", () => {
    it("should return state with version from package.json and cycle from history", () => {
      const state = readState();
      const pkg = JSON.parse(originalPackageContent);

      // Version should come from package.json
      expect(state.version).toBe(pkg.version);
      // Cycle should come from evolution-history.json
      expect(typeof state.cycle).toBe("number");
      expect(state.cycle).toBeGreaterThanOrEqual(0);
    });

    it("should merge runtime state from state.json with git-tracked values", () => {
      const runtimeState = {
        evolutionEnabled: true,
        lastRestart: "2026-02-25T12:00:00Z",
        lastEvolution: "2026-02-25T13:00:00Z",
        customField: "custom value",
      };
      writeFileSync(TEST_STATE_PATH, JSON.stringify(runtimeState, null, 2));

      const state = readState();
      const pkg = JSON.parse(originalPackageContent);

      // Git-tracked values override runtime state
      expect(state.version).toBe(pkg.version);
      expect(typeof state.cycle).toBe("number");

      // Runtime state is preserved
      expect(state.evolutionEnabled).toBe(true);
      expect(state.lastRestart).toBe("2026-02-25T12:00:00Z");
      expect(state.lastEvolution).toBe("2026-02-25T13:00:00Z");
      expect(state.customField).toBe("custom value");
    });

    it("should return default runtime values when state.json does not exist", () => {
      const state = readState();

      expect(state.evolutionEnabled).toBe(false);
      expect(state.lastRestart).toBeNull();
      expect(state.lastEvolution).toBeNull();
    });

    it("should read max cycle from evolution-history.json", () => {
      // Create evolution-history.json with specific records
      const history = [
        { cycle: 10, timestamp: "2026-02-26T00:00:00Z", version: "0.0.10", status: "success", summary: "Test 10" },
        { cycle: 25, timestamp: "2026-02-26T01:00:00Z", version: "0.0.25", status: "success", summary: "Test 25" },
        { cycle: 42, timestamp: "2026-02-26T02:00:00Z", version: "0.0.42", status: "success", summary: "Test 42" },
      ];
      writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));

      const state = readState();
      expect(state.cycle).toBe(42);
    });

    it("should handle evolution-history.json with single record", () => {
      const history = [
        { cycle: 5, timestamp: "2026-02-26T00:00:00Z", version: "0.0.5", status: "success", summary: "Test 5" },
      ];
      writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));

      const state = readState();
      expect(state.cycle).toBe(5);
    });

    it("should return cycle 0 when evolution-history.json does not exist", () => {
      // Remove evolution-history.json
      if (existsSync(HISTORY_PATH)) {
        unlinkSync(HISTORY_PATH);
      }

      const state = readState();
      expect(state.cycle).toBe(0);
    });

    it("should return cycle 0 when evolution-history.json is empty", () => {
      writeFileSync(HISTORY_PATH, "[]");

      const state = readState();
      expect(state.cycle).toBe(0);
    });

    it("should handle evolution-history.json with non-sequential cycles", () => {
      const history = [
        { cycle: 100, timestamp: "2026-02-26T00:00:00Z", version: "0.1.0", status: "success", summary: "Test 100" },
        { cycle: 50, timestamp: "2026-02-26T01:00:00Z", version: "0.0.50", status: "success", summary: "Test 50" },
        { cycle: 200, timestamp: "2026-02-26T02:00:00Z", version: "0.2.0", status: "success", summary: "Test 200" },
      ];
      writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));

      const state = readState();
      expect(state.cycle).toBe(200);
    });
  });
});
