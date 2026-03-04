/**
 * Jinx Tools Extension for Pi
 *
 * Re-exports all tools from src/agent/tools.ts via the Pi Extension API.
 * This is the single source of truth — do NOT re-implement tools here.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { jinxTools } from "../src/agent/tools.js";

/**
 * Jinx Tools Extension
 * Registers all Jinx custom tools via Pi Extension API.
 */
export default function jinxToolsExtension(pi: ExtensionAPI) {
  for (const tool of jinxTools) {
    pi.registerTool(tool);
  }
  console.log(`[Jinx Tools Extension] Registered ${jinxTools.length} tools`);
}
