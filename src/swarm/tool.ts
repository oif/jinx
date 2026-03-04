/**
 * run_swarm Tool
 *
 * Exposes the swarm orchestrator as a Pi ToolDefinition.
 * Jinx (or any Pi session) can call this tool to spin up a multi-agent swarm
 * for any task — research, analysis, code review, market analysis, etc.
 */

import { Type } from "@sinclair/typebox";
import type {
  ToolDefinition,
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { runSwarm, formatSwarmResult } from "./orchestrator.js";
import { listRoles } from "./roles.js";
import { log } from "../util/log.js";

// ── Parameter Schema ─────────────────────────────────────────────────────────

const runSwarmParams = Type.Object({
  task: Type.String({
    description:
      "The task or question for the swarm to tackle. Be specific — the more context you provide, " +
      "the better each agent can focus its research. " +
      "Example: 'Analyze BTC today — should I open a long position? Consider technical analysis, " +
      "recent news, and on-chain data.'",
  }),
  roles: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Optional: explicitly specify which agent roles to deploy. " +
        "If omitted, the orchestrator LLM will decide based on the task. " +
        `Available roles: ${Object.keys({
          market_analyst: 1, news_researcher: 1, onchain_analyst: 1,
          macro_analyst: 1, code_reviewer: 1, researcher: 1,
          data_analyst: 1, devils_advocate: 1,
        }).join(", ")}`,
    }),
  ),
  max_workers: Type.Optional(
    Type.Number({
      description: "Maximum number of parallel agents (default: 5, max: 8)",
      minimum: 1,
      maximum: 8,
    }),
  ),
  timeout_minutes: Type.Optional(
    Type.Number({
      description: "Timeout per agent in minutes (default: 5)",
      minimum: 1,
      maximum: 15,
    }),
  ),
});

// ── Tool Definition ──────────────────────────────────────────────────────────

/**
 * Helper: create a text-only AgentToolResult from a string.
 */
function textResult(text: string): AgentToolResult<undefined> {
  return {
    content: [{ type: "text", text }],
    details: undefined,
  };
}

export const runSwarmTool: ToolDefinition = {
  name: "run_swarm",
  label: "Run Agent Swarm",
  description:
    "Spawn a coordinated swarm of specialized AI agents to tackle a complex task in parallel. " +
    "The orchestrator LLM decides which agents to deploy, each agent independently researches " +
    "their domain, then a synthesizer produces a unified conclusion. " +
    "Use this for: market analysis (BTC open plan, macro outlook), deep research, " +
    "code audits, competitive analysis, or any task benefiting from multiple expert perspectives. " +
    "Returns a comprehensive report with individual agent findings + synthesized conclusion. " +
    `\nAvailable roles:\n${listRoles()}`,
  parameters: runSwarmParams,
  execute: async (
    _toolCallId: string,
    params: Record<string, unknown>,
    _signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback,
    _ctx?: ExtensionContext,
  ): Promise<AgentToolResult<undefined>> => {
    const task = params.task as string;
    const roles = params.roles as string[] | undefined;
    const maxWorkers = Math.min((params.max_workers as number | undefined) ?? 5, 8);
    const timeoutMinutes = Math.min((params.timeout_minutes as number | undefined) ?? 5, 15);
    const workerTimeoutMs = timeoutMinutes * 60 * 1000;

    log.info("run_swarm tool invoked", { task: task.slice(0, 80), roles, maxWorkers, timeoutMinutes });

    // Send initial status update
    if (onUpdate) {
      onUpdate(textResult(`🐝 Swarm starting — deploying agents for: "${task.slice(0, 100)}${task.length > 100 ? "..." : ""}"`));
    }

    try {
      const result = await runSwarm({ task, roles, maxWorkers, workerTimeoutMs });

      // Send progress update
    if (onUpdate) {
      const roleNames = result.agents.map((a) => a.label).join(", ");
      onUpdate(textResult(`✅ All agents complete (${roleNames}) — synthesizing...`));
      }

      const formatted = formatSwarmResult(result);
      return textResult(formatted);
    } catch (err) {
      const error = (err as Error).message;
      log.error("run_swarm tool failed", { error });
      return textResult(`❌ Swarm failed: ${error}`);
    }
  },
};
