/**
 * Swarm Orchestrator
 *
 * Core engine of the agent swarm system. Given a task, the orchestrator:
 * 1. Uses an LLM worker to decide which roles are needed and craft per-role prompts
 * 2. Spawns all workers in parallel (Promise.all)
 * 3. Collects individual agent conclusions
 * 4. Runs a synthesis worker to produce a final unified answer
 *
 * Fully self-contained — no claude_code, no external CLI. Pure Pi SessionPool.
 */

import { SessionPool } from "../agent/session.js";
import { log } from "../util/log.js";
import { listRoles, getRole } from "./roles.js";
import { createAgentSession, SessionManager, codingTools, DefaultResourceLoader, ModelRegistry, AuthStorage } from "@mariozechner/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";


// ── Types ───────────────────────────────────────────────────────────────────

export interface AgentAssignment {
  role: string;
  prompt: string;
}

export interface AgentResult {
  role: string;
  label: string;
  conclusion: string;
  durationMs: number;
  error?: string;
}

export interface SwarmResult {
  task: string;
  agents: AgentResult[];
  synthesis: string;
  totalDurationMs: number;
}

export interface SwarmOptions {
  /** The task/question to tackle */
  task: string;
  /** Explicitly request specific roles (optional — orchestrator decides if omitted) */
  roles?: string[];
  /** Max parallel workers (default: 5) */
  maxWorkers?: number;
  /** Timeout per worker in ms (default: 5 minutes) */
  workerTimeoutMs?: number;
}

// ── Model setup helper (mirrors session.ts) ─────────────────────────────────

async function buildModelSetup() {
  const agentDir = join(homedir(), ".pi", "agent");
  const authStorage = new AuthStorage(join(agentDir, "auth.json"));
  const modelRegistry = new ModelRegistry(authStorage, join(agentDir, "models.json"));
  const defaultModel = process.env.DEFAULT_MODEL;
  let selectedModel = undefined;
  if (defaultModel) {
    const [provider, modelId] = defaultModel.includes("/")
      ? defaultModel.split("/")
      : [undefined, defaultModel];
    selectedModel = provider
      ? modelRegistry.find(provider, modelId)
      : modelRegistry.getAll().find((m) => m.id === modelId || m.name === modelId);
  }
  return { modelRegistry, selectedModel };
}

// ── Orchestrator decision: which roles + what prompts ───────────────────────

/**
 * Ask an LLM worker to decide which roles are needed and craft per-role prompts.
 * Returns a list of AgentAssignment objects.
 */
async function planSwarm(
  task: string,
  requestedRoles: string[] | undefined,
  timeoutMs: number,
): Promise<AgentAssignment[]> {
  const rolesSection = requestedRoles
    ? `The user has requested these specific roles: ${requestedRoles.join(", ")}`
    : `Available roles:\n${listRoles()}`;

  const planningPrompt = `You are a task orchestration planner. Your job is to decompose a task into parallel workstreams and assign them to specialized agents.

## Task
${task}

## ${rolesSection}

## Instructions
Decide which agents to deploy for this task. For each agent:
1. Select the most appropriate role from the available list
2. Write a specific, focused prompt for that agent (what exactly should they research/analyze?)
3. Keep prompts targeted — each agent has ONE job

Rules:
- Deploy 2-5 agents (no more — quality over quantity)
- Each agent must have a distinct, non-overlapping focus
- If the user specified roles, use exactly those roles
- Always include at least one role directly addressing the main question

Respond with ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "assignments": [
    { "role": "role_name", "prompt": "specific task for this agent" },
    { "role": "role_name", "prompt": "specific task for this agent" }
  ]
}`;

  const worker = await SessionPool.spawn({
    label: "swarm-planner",
    thinkingLevel: "medium",
    timeoutMs,
    slim: true,
  });

  try {
    const raw = await worker.prompt(planningPrompt);

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = raw.match(/\{[\s\S]*"assignments"[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Planner returned no valid JSON. Raw: ${raw.slice(0, 200)}`);
    }

    const parsed = JSON.parse(jsonMatch[0]) as { assignments: AgentAssignment[] };
    if (!Array.isArray(parsed.assignments) || parsed.assignments.length === 0) {
      throw new Error("Planner returned empty assignments array");
    }

    log.info("Swarm planner decided", {
      task: task.slice(0, 60),
      roles: parsed.assignments.map((a) => a.role),
    });

    return parsed.assignments;
  } finally {
    worker.dispose();
  }
}

// ── Individual agent execution ───────────────────────────────────────────────

/**
 * Spawn a worker for a given role assignment and collect its conclusion.
 */
async function runAgent(
  assignment: AgentAssignment,
  timeoutMs: number,
): Promise<AgentResult> {
  const role = getRole(assignment.role);
  const label = role?.label ?? assignment.role;
  const startTime = Date.now();

  // Build system prompt: role's specialized prompt + Pi base
  const roleSystemPrompt = role?.systemPrompt ?? `You are a specialized agent. Role: ${assignment.role}. Do your job well and return a clear, concise conclusion.`;

  const { modelRegistry, selectedModel } = await buildModelSetup();
  const extensionsDir = join(process.cwd(), "extensions");

  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    resourceLoader: new DefaultResourceLoader({
      systemPromptOverride: (_base) => roleSystemPrompt,
      additionalExtensionPaths: [extensionsDir],
    }),
    modelRegistry,
    model: selectedModel,
    thinkingLevel: role?.thinkingLevel ?? "medium",
    tools: codingTools,
  });

  try {
    log.info(`Swarm agent starting`, { role: assignment.role, label });

    // Collect response
    const conclusion = await new Promise<string>((resolve, reject) => {
      let text = "";
      const timer = setTimeout(() => {
        reject(new Error(`Agent [${label}] timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const unsub = session.subscribe((event: unknown) => {
        const e = event as { type: string; message?: { role?: string; content?: Array<{ type: string; text?: string }>; errorMessage?: string } };
        if (e.type === "message_end" && e.message?.role === "assistant") {
          for (const block of e.message.content ?? []) {
            if (block.type === "text" && block.text) text += block.text;
          }
          if (e.message.errorMessage) {
            clearTimeout(timer);
            unsub();
            reject(new Error(e.message.errorMessage));
          }
        }
        if (e.type === "agent_end") {
          clearTimeout(timer);
          unsub();
          resolve(text || "(No response)");
        }
      });

      session.prompt(assignment.prompt).catch((err: Error) => {
        clearTimeout(timer);
        unsub();
        reject(err);
      });
    });

    const durationMs = Date.now() - startTime;
    log.info(`Swarm agent completed`, { role: assignment.role, durationMs });

    return { role: assignment.role, label, conclusion, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const error = (err as Error).message;
    log.error(`Swarm agent failed`, { role: assignment.role, error, durationMs });
    return { role: assignment.role, label, conclusion: `[Failed: ${error}]`, durationMs, error };
  } finally {
    try {
      await session.abort().catch(() => {});
      session.dispose();
    } catch {
      // ignore cleanup errors
    }
  }
}

// ── Synthesis ───────────────────────────────────────────────────────────────

/**
 * Synthesize all agent results into a final unified conclusion.
 */
async function synthesize(
  task: string,
  results: AgentResult[],
  timeoutMs: number,
): Promise<string> {
  const agentSummaries = results
    .map((r) => `### ${r.label} (${r.role})\n${r.conclusion}`)
    .join("\n\n---\n\n");

  const synthesisPrompt = `You are a senior analyst tasked with synthesizing multiple expert perspectives into a single, actionable conclusion.

## Original Task
${task}

## Expert Agent Reports
${agentSummaries}

## Your Job
1. Identify areas of consensus across agents
2. Note significant disagreements or conflicting signals
3. Weigh the evidence and reach a clear conclusion
4. Give a specific, actionable recommendation (don't hedge everything — commit to a view)
5. List the top 2-3 risks to your conclusion

Format your response as:
**Consensus Points**: [what agents agree on]
**Key Tensions**: [where agents disagree]
**Conclusion**: [your synthesized view — be specific and decisive]
**Recommendation**: [concrete action/answer]
**Key Risks**: [top 2-3 risks to watch]`;

  const worker = await SessionPool.spawn({
    label: "swarm-synthesizer",
    thinkingLevel: "high",
    timeoutMs,
    slim: true,
  });

  try {
    return await worker.prompt(synthesisPrompt);
  } finally {
    worker.dispose();
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run a full agent swarm for the given task.
 *
 * Flow:
 * 1. Planner LLM decides which roles to deploy and crafts per-role prompts
 * 2. All agents run in parallel (Promise.allSettled)
 * 3. Synthesizer LLM produces a unified conclusion
 */
export async function runSwarm(opts: SwarmOptions): Promise<SwarmResult> {
  const {
    task,
    roles,
    maxWorkers = 5,
    workerTimeoutMs = 5 * 60 * 1000, // 5 minutes per agent
  } = opts;

  const totalStart = Date.now();
  log.info("Swarm starting", { task: task.slice(0, 80), requestedRoles: roles });

  // Step 1: Plan — LLM decides roles and prompts
  const assignments = await planSwarm(task, roles, workerTimeoutMs);

  // Cap parallel workers
  const capped = assignments.slice(0, maxWorkers);
  if (capped.length < assignments.length) {
    log.warn(`Swarm capped from ${assignments.length} to ${maxWorkers} workers`);
  }

  // Step 2: Run all agents in parallel
  log.info(`Swarm spawning ${capped.length} agents in parallel`, {
    roles: capped.map((a) => a.role),
  });

  const settledResults = await Promise.allSettled(
    capped.map((assignment) => runAgent(assignment, workerTimeoutMs)),
  );

  const agentResults: AgentResult[] = settledResults.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    const assignment = capped[i];
    return {
      role: assignment.role,
      label: getRole(assignment.role)?.label ?? assignment.role,
      conclusion: `[Crashed: ${result.reason}]`,
      durationMs: 0,
      error: String(result.reason),
    };
  });

  // Step 3: Synthesize
  log.info("Swarm synthesizing results", { agentCount: agentResults.length });
  const synthesis = await synthesize(task, agentResults, workerTimeoutMs);

  const totalDurationMs = Date.now() - totalStart;
  log.info("Swarm completed", { totalDurationMs, agentCount: agentResults.length });

  return {
    task,
    agents: agentResults,
    synthesis,
    totalDurationMs,
  };
}

/**
 * Format a SwarmResult into a readable Telegram/chat message.
 */
export function formatSwarmResult(result: SwarmResult): string {
  const durationSec = Math.round(result.totalDurationMs / 1000);
  const lines: string[] = [];

  lines.push(`🐝 **Swarm Analysis Complete** (${durationSec}s)\n`);
  lines.push(`**Task**: ${result.task}\n`);

  lines.push(`---\n`);
  lines.push(`## Agent Reports\n`);
  for (const agent of result.agents) {
    const statusIcon = agent.error ? "❌" : "✅";
    const agentDuration = Math.round(agent.durationMs / 1000);
    lines.push(`### ${statusIcon} ${agent.label} (${agentDuration}s)\n`);
    lines.push(`${agent.conclusion}\n`);
  }

  lines.push(`---\n`);
  lines.push(`## 🎯 Synthesis\n`);
  lines.push(result.synthesis);

  return lines.join("\n");
}
