import {
  createAgentSession,
  SessionManager,
  codingTools,
  DefaultResourceLoader,
  ModelRegistry,
  AuthStorage,
  type AgentSession,
  type CreateAgentSessionOptions,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { buildJinxSystemPrompt } from "./system-prompt.js";
import { jinxTools } from "./tools.js";
import { log } from "../util/log.js";
import { Type } from "@sinclair/typebox";
import { homedir } from "node:os";
import { join } from "node:path";

export type { AgentSession };

export type TelegramSendFn = (text: string) => Promise<void>;

// ── Agent session state ────────────────────────────────────────────

let currentSession: AgentSession | null = null;
let tgSend: TelegramSendFn | null = null;

export function registerTelegramSend(fn: TelegramSendFn): void {
  tgSend = fn;
}

function buildTgSendTool(sendFn: TelegramSendFn | null): ToolDefinition {
  const params = Type.Object({
    text: Type.String({ description: "Message text (supports Markdown)" }),
  });

  return {
    name: "send_owner_message",
    label: "Send Message to Creator",
    description:
      "Send a message to the creator (Neo) via Telegram. " +
      "Use for important notifications, evolution reports, error alerts. " +
      "Do not spam — batch non-urgent updates.",
    parameters: params,
    execute: async (_toolCallId, args: Record<string, unknown>, _signal, _onUpdate, _ctx) => {
      if (!sendFn) {
        return {
          content: [{ type: "text", text: "Telegram not connected yet. Message not sent." }],
          details: undefined,
        };
      }
      await sendFn(args.text as string);
      return {
        content: [{ type: "text", text: "Message sent to creator." }],
        details: undefined,
      };
    },
  };
}

// ── Create / get session ───────────────────────────────────────────

export async function startAgent(): Promise<AgentSession> {
  const sessionDir = "./data/sessions";
  const sessionManager = SessionManager.create(process.cwd(), sessionDir);

  const tgSendTool = buildTgSendTool(tgSend);
  const allCustomTools: ToolDefinition[] = [...jinxTools, tgSendTool];

  const resourceLoader = new DefaultResourceLoader({
    systemPromptOverride: (base) => buildJinxSystemPrompt(base || ""),
  });

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
      : modelRegistry.getAll().find(m => m.id === modelId || m.name === modelId);
    if (!selectedModel) {
      log.warn(`Model "${defaultModel}" not found in registry, falling back to first available model`);
    }
  }

  const options: CreateAgentSessionOptions = {
    sessionManager,
    resourceLoader,
    modelRegistry,
    model: selectedModel,
    thinkingLevel: "high",
    tools: codingTools,
    customTools: allCustomTools,
  };

  const { session, modelFallbackMessage } = await createAgentSession(options);

  if (modelFallbackMessage) {
    log.warn(`Model fallback: ${modelFallbackMessage}`);
  }

  currentSession = session;
  log.info("Agent session started", { model: selectedModel?.name || "fallback" });
  return session;
}

export function getSession(): AgentSession | null {
  return currentSession;
}

/**
 * Check if agent is streaming. Uses Pi's native isStreaming — no race conditions.
 */
export function isAgentBusy(): boolean {
  return currentSession?.isStreaming ?? false;
}

/**
 * Send a prompt to the agent and return the response text.
 *
 * Handles concurrency via Pi's native steer/followUp API:
 * - Agent idle: sends prompt normally
 * - Agent streaming: queues as followUp (waits for current work to finish)
 */
export async function prompt(message: string, images?: any[]): Promise<string> {
  if (!currentSession) {
    throw new Error("Agent session not started");
  }

  const session = currentSession;
  const streaming = session.isStreaming;

  log.info(`Prompt: ${message.slice(0, 100)}${message.length > 100 ? "..." : ""}`, {
    hasImages: !!images?.length,
    streaming,
  });

  if (streaming) {
    log.info("Agent is streaming, queuing as followUp");
    return queueFollowUpAndWait(session, message, images);
  }

  return sendPromptAndWait(session, message, images);
}

function sendPromptAndWait(session: AgentSession, message: string, images?: any[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let text = "";
    let errorMsg = "";
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      unsubscribe();
    };

    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_end") {
        const msg = (event as any).message;
        if (msg?.role === "assistant" && msg?.content) {
          for (const block of msg.content) {
            if (block.type === "text") {
              text += block.text;
            }
          }
        }
        if (msg?.errorMessage) {
          errorMsg = msg.errorMessage;
        }
      }

      if (event.type === "agent_end") {
        cleanup();
        resolve(errorMsg || text || "(No response)");
      }
    });

    // Safety timeout: 10 minutes max wait for normal prompts
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Prompt timed out after 10 minutes"));
    }, 10 * 60 * 1000);

    session.prompt(message, { images }).catch((e) => {
      cleanup();
      reject(e);
    });
  });
}

/**
 * Queue a followUp when agent is streaming. Waits for current work to end,
 * then collects the response from the followUp's agent cycle.
 *
 * Fixes race condition: checks if agent already finished (isStreaming=false)
 * immediately after subscribing, to handle the case where agent_end fired
 * before our subscription was active.
 */
function queueFollowUpAndWait(session: AgentSession, message: string, images?: any[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let waitingForOurTurn = true;
    let text = "";
    let errorMsg = "";
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      unsubscribe();
    };

    const unsubscribe = session.subscribe((event) => {
      if (waitingForOurTurn && event.type === "agent_end") {
        waitingForOurTurn = false;
        return;
      }

      if (!waitingForOurTurn) {
        if (event.type === "message_end") {
          const msg = (event as any).message;
          if (msg?.role === "assistant" && msg?.content) {
            for (const block of msg.content) {
              if (block.type === "text") {
                text += block.text;
              }
            }
          }
          if (msg?.errorMessage) {
            errorMsg = msg.errorMessage;
          }
        }

        if (event.type === "agent_end") {
          cleanup();
          resolve(errorMsg || text || "(No response)");
        }
      }
    });

    // Race condition fix: if agent already finished (isStreaming=false), we're next
    if (!session.isStreaming) {
      waitingForOurTurn = false;
    }

    // Safety timeout: 5 minutes max wait
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Follow-up timed out after 5 minutes"));
    }, 5 * 60 * 1000);

    session.followUp(message, images).catch((e) => {
      cleanup();
      reject(e);
    });
  });
}

export async function abortAgent(): Promise<void> {
  if (currentSession) {
    try {
      await currentSession.abort();
    } catch {
      // Abort can fail if nothing is running
    }
  }
}
