import { describe, it, expect, beforeEach } from "vitest";
import { readVersion, readState, type State } from "../src/util/state.js";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TEST_STATE_PATH = join(process.cwd(), "data", "state.json");

describe("state utilities", () => {
  beforeEach(() => {
    // Clean up test file
    if (existsSync(TEST_STATE_PATH)) {
      unlinkSync(TEST_STATE_PATH);
    }
  });

  describe("readVersion", () => {
    it("should return default version when state.json does not exist", () => {
      const version = readVersion();
      expect(version).toBe("0.0.1");
    });

    it("should read version from state.json", () => {
      const state = {
        version: "1.2.3",
        cycle: 10,
        evolutionEnabled: true,
        lastRestart: null,
        lastEvolution: null,
      };
      writeFileSync(TEST_STATE_PATH, JSON.stringify(state, null, 2));

      const version = readVersion();
      expect(version).toBe("1.2.3");
    });

    it("should return default version when version field is missing", () => {
      const state = {
        cycle: 5,
        evolutionEnabled: false,
      };
      writeFileSync(TEST_STATE_PATH, JSON.stringify(state, null, 2));

      const version = readVersion();
      expect(version).toBe("0.0.1");
    });

    it("should return default version when state.json is malformed", () => {
      writeFileSync(TEST_STATE_PATH, "not valid json");

      const version = readVersion();
      expect(version).toBe("0.0.1");
    });
  });

  describe("readState", () => {
    it("should return default state when state.json does not exist", () => {
      const state = readState();
      expect(state).toEqual({
        version: "0.0.1",
        cycle: 0,
        evolutionEnabled: false,
        lastRestart: null,
        lastEvolution: null,
      });
    });

    it("should read full state from state.json", () => {
      const expectedState: State = {
        version: "0.5.0",
        cycle: 42,
        evolutionEnabled: true,
        lastRestart: "2026-02-25T12:00:00Z",
        lastEvolution: "2026-02-25T13:00:00Z",
      };
      writeFileSync(TEST_STATE_PATH, JSON.stringify(expectedState, null, 2));

      const state = readState();
      expect(state).toEqual(expectedState);
    });

    it("should return default state when state.json is malformed", () => {
      writeFileSync(TEST_STATE_PATH, "invalid json {[");

      const state = readState();
      expect(state).toEqual({
        version: "0.0.1",
        cycle: 0,
        evolutionEnabled: false,
        lastRestart: null,
        lastEvolution: null,
      });
    });

    it("should preserve additional fields in state", () => {
      const stateWithExtras = {
        version: "0.1.0",
        cycle: 5,
        evolutionEnabled: true,
        lastRestart: null,
        lastEvolution: null,
        customField: "custom value",
        crashCount: 3,
      };
      writeFileSync(TEST_STATE_PATH, JSON.stringify(stateWithExtras, null, 2));

      const state = readState();
      expect(state.customField).toBe("custom value");
      expect(state.crashCount).toBe(3);
    });
  });
});
