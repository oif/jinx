import {
  createAgentSession,
  SessionManager,
  codingTools,
  type AgentSession,
  type CreateAgentSessionOptions,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { buildJinxSystemPrompt } from "./system-prompt.js";
import { jinxTools } from "./tools.js";
import { log } from "../util/log.js";
import { Type } from "@sinclair/typebox";

export type { AgentSession };

/**
 * Telegram send function signature — injected to avoid circular deps.
 */
export type TelegramSendFn = (text: string) => Promise<void>;

// ── Agent session state ────────────────────────────────────────────

let currentSession: AgentSession | null = null;
let tgSend: TelegramSendFn | null = null;

/**
 * Register the Telegram send function.
 * Called once during bootstrap, before the first prompt.
 */
export function registerTelegramSend(fn: TelegramSendFn): void {
  tgSend = fn;
}

/**
 * Build the Telegram send tool (needs the send function injected at runtime).
 */
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

  const options: CreateAgentSessionOptions = {
    sessionManager,
    thinkingLevel: "high",
    tools: codingTools,
    customTools: allCustomTools,
  };

  const { session, modelFallbackMessage } = await createAgentSession(options);

  if (modelFallbackMessage) {
    log.warn(`Model fallback: ${modelFallbackMessage}`);
  }

  currentSession = session;
  log.info("Agent session started");
  return session;
}

/**
 * Get the current active session.
 */
export function getSession(): AgentSession | null {
  return currentSession;
}

/**
 * Send a prompt to the agent and return the response text.
 *
 * `session.prompt()` returns `Promise<void>`. We capture the assistant's
 * response by subscribing to events and collecting text from message_end.
 */
export async function prompt(message: string): Promise<string> {
  if (!currentSession) {
    throw new Error("Agent session not started");
  }

  log.info(`Prompt: ${message.slice(0, 100)}${message.length > 100 ? "..." : ""}`);

  return new Promise<string>((resolve, reject) => {
    const session = currentSession!;
    let responseText = "";

    const unsubscribe = session.subscribe((event) => {
      // Collect text from assistant message_end events
      if (event.type === "message_end") {
        const msg = (event as any).message;
        if (msg?.role === "assistant" && msg?.content) {
          for (const block of msg.content) {
            if (block.type === "text") {
              responseText += block.text;
            }
          }
        }
      }

      // Agent finished processing
      if (event.type === "agent_end") {
        unsubscribe();
        resolve(responseText || "(No response)");
      }
    });

    session.prompt(message).catch((e) => {
      unsubscribe();
      const err = e as Error;
      log.error(`Prompt failed: ${err.message}`);
      reject(err);
    });
  });
}

/**
 * Abort the current agent operation.
 */
export async function abortAgent(): Promise<void> {
  if (currentSession) {
    try {
      await currentSession.abort();
    } catch {
      // Abort can fail if nothing is running — that's fine
    }
  }
}
