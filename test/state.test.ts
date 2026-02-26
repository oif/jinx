import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readVersion, readState, type State } from "../src/util/state.js";
import { existsSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TEST_STATE_PATH = join(process.cwd(), "data", "state.json");
const PACKAGE_PATH = join(process.cwd(), "package.json");
const EVOLOG_PATH = join(process.cwd(), "EVOLOG.md");

describe("state utilities", () => {
  // Store original files content
  let originalPackageContent: string;
  let originalEvologContent: string;

  beforeEach(() => {
    // Clean up test state file
    if (existsSync(TEST_STATE_PATH)) {
      unlinkSync(TEST_STATE_PATH);
    }

    // Store original content
    originalPackageContent = readFileSync(PACKAGE_PATH, "utf-8");
    originalEvologContent = existsSync(EVOLOG_PATH) ? readFileSync(EVOLOG_PATH, "utf-8") : "";
  });

  afterEach(() => {
    // Restore original content
    writeFileSync(PACKAGE_PATH, originalPackageContent);
    if (originalEvologContent) {
      writeFileSync(EVOLOG_PATH, originalEvologContent);
    } else if (existsSync(EVOLOG_PATH)) {
      unlinkSync(EVOLOG_PATH);
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
    it("should return state with version from package.json and cycle from EVOLOG.md", () => {
      const state = readState();
      const pkg = JSON.parse(originalPackageContent);

      // Version should come from package.json
      expect(state.version).toBe(pkg.version);
      // Cycle should come from EVOLOG.md
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

    it("should read cycle from EVOLOG.md Total Cycles table", () => {
      // Create EVOLOG.md with specific cycle count
      const evologContent = `# Evolution Log

## 📊 Statistics

| Metric | Value |
|--------|-------|
| Total Cycles | 42 |

## 📜 Evolution History
`;
      writeFileSync(EVOLOG_PATH, evologContent);

      const state = readState();
      expect(state.cycle).toBe(42);
    });

    it("should fallback to counting Cycle headers in EVOLOG.md", () => {
      // Create EVOLOG.md without Total Cycles table
      const evologContent = `# Evolution Log

### ✅ Cycle #1 — 0.0.1
Some content

### ✅ Cycle #2 — 0.0.2
More content

### ✅ Cycle #3 — 0.0.3
Final content
`;
      writeFileSync(EVOLOG_PATH, evologContent);

      const state = readState();
      expect(state.cycle).toBe(3);
    });

    it("should return cycle 0 when EVOLOG.md does not exist", () => {
      // Remove EVOLOG.md
      if (existsSync(EVOLOG_PATH)) {
        unlinkSync(EVOLOG_PATH);
      }

      const state = readState();
      expect(state.cycle).toBe(0);
    });
  });
});
