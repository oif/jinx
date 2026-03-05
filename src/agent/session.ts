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
import { log } from "../util/log.js";
import { recordAgentPrompt } from "../observability/metrics.js";
import { Type } from "@sinclair/typebox";
import { homedir } from "node:os";
import { join } from "node:path";

export type { AgentSession };

export type TelegramSendFn = (text: string) => Promise<void>;

// ── Timeout configuration ──────────────────────────────────────────

/** Conversation session: Neo's interactive messages — shorter timeout */
const DEFAULT_CONVERSATION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/** Worker sessions: background tasks — longer timeout */
const DEFAULT_WORKER_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

function getConversationTimeoutMs(): number {
  const env = process.env.AGENT_CONVERSATION_TIMEOUT_MS ?? process.env.AGENT_PROMPT_TIMEOUT_MS;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_CONVERSATION_TIMEOUT_MS;
}

function getWorkerTimeoutMs(): number {
  const env = process.env.AGENT_WORKER_TIMEOUT_MS ?? process.env.AGENT_PROMPT_TIMEOUT_MS;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_WORKER_TIMEOUT_MS;
}

// ── Telegram send tool ─────────────────────────────────────────────

let tgSend: TelegramSendFn | null = null;

export function registerTelegramSend(fn: TelegramSendFn): void {
  tgSend = fn;
}

function buildTgSendTool(sendFn: TelegramSendFn | null): ToolDefinition {
  return {
    name: "send_owner_message",
    label: "Send Message to Creator",
    description:
      "Send a message to the creator (Neo) via Telegram. " +
      "Use for important notifications, evolution reports, error alerts. " +
      "Do not spam — batch non-urgent updates.",
    parameters: Type.Object({
      text: Type.String({ description: "Message text (supports Markdown)" }),
    }),
    execute: async (_toolCallId, args: Record<string, unknown>) => {
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

// ── Shared model setup ─────────────────────────────────────────────

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
    if (!selectedModel) {
      log.warn(`Model "${defaultModel}" not found, using first available`);
    }
  }

  return { modelRegistry, selectedModel };
}

// ── Response collection helpers ────────────────────────────────────

function collectResponse(
  session: AgentSession,
  timeoutMs: number,
  label: string,
  images?: any[],
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let text = "";
    let errorMsg = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startTime = Date.now();
    const wasStreaming = session.isStreaming;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      unsub();
    };

    const unsub = session.subscribe((event) => {
      if (event.type === "message_end") {
        const msg = (event as any).message;
        if (msg?.role === "assistant" && msg?.content) {
          for (const block of msg.content) {
            if (block.type === "text") text += block.text;
          }
        }
        if (msg?.errorMessage) errorMsg = msg.errorMessage;
      }
      if (event.type === "agent_end") {
        cleanup();
        recordAgentPrompt({
          durationMs: Date.now() - startTime,
          hasImages: !!images?.length,
          wasStreaming,
          success: !errorMsg,
          errorType: errorMsg ? "agent_error" : undefined,
        });
        if (errorMsg) {
          reject(new Error(errorMsg));
        } else {
          resolve(text || "(No response)");
        }
      }
    });

    timer = setTimeout(() => {
      cleanup();
      recordAgentPrompt({
        durationMs: Date.now() - startTime,
        hasImages: !!images?.length,
        wasStreaming,
        success: false,
        errorType: "timeout",
      });
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

/** Extract text from message_end event, returns [text, errorMsg] */
function extractMessageText(event: unknown): [string, string] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msg = (event as any).message;
  let text = "";
  let errorMsg = "";
  if (msg?.role === "assistant" && msg?.content) {
    for (const block of msg.content) {
      if (block.type === "text") text += block.text;
    }
  }
  if (msg?.errorMessage) errorMsg = msg.errorMessage;
  return [text, errorMsg];
}

/** Wait for the NEXT agent_end after current turn finishes (followUp pattern) */
function collectFollowUpResponse(
  session: AgentSession,
  timeoutMs: number,
  label: string,
  images?: any[],
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let waitingForCurrent = session.isStreaming;
    let text = "";
    let errorMsg = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startTime = Date.now();

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      unsub();
    };

    const handleFollowUpEvent = (event: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (waitingForCurrent && (event as any).type === "agent_end") {
        waitingForCurrent = false;
        return;
      }
      if (waitingForCurrent) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((event as any).type === "message_end") {
        const [t, e] = extractMessageText(event);
        text += t;
        if (e) errorMsg = e;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((event as any).type === "agent_end") {
        cleanup();
        recordAgentPrompt({
          durationMs: Date.now() - startTime,
          hasImages: !!images?.length,
          wasStreaming: true,
          success: !errorMsg,
          errorType: errorMsg ? "agent_error" : undefined,
        });
        if (errorMsg) {
          reject(new Error(errorMsg));
        } else {
          resolve(text || "(No response)");
        }
      }
    };

    const unsub = session.subscribe(handleFollowUpEvent);

    timer = setTimeout(() => {
      cleanup();
      recordAgentPrompt({
        durationMs: Date.now() - startTime,
        hasImages: !!images?.length,
        wasStreaming: true,
        success: false,
        errorType: "timeout",
      });
      reject(new Error(`${label} followUp timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

// ── Session Pool ───────────────────────────────────────────────────

export interface WorkerOptions {
  /** Human-readable label for logging */
  label: string;
  /** Thinking level. Default: "medium" */
  thinkingLevel?: "low" | "medium" | "high" | "xhigh";
  /** Custom timeout override in ms */
  timeoutMs?: number;
  /**
   * If true, skip loading knowledge base from system prompt.
   * Default: true (workers do focused tasks, don't need full knowledge base).
   */
  slim?: boolean;
}

export interface WorkerSession {
  readonly id: string;
  readonly label: string;
  readonly session: AgentSession;
  /** Whether this worker is currently processing */
  readonly busy: boolean;
  /** Send a prompt and wait for the response */
  prompt(message: string): Promise<string>;
  /** Release resources and remove from pool */
  dispose(): void;
}

/**
 * SessionPool manages dynamically-created worker sessions.
 *
 * Jinx uses this for evolution cycles, sub-tasks, and any background work
 * that must not block the conversation session.
 *
 * Usage:
 *   const worker = await SessionPool.spawn({ label: "evolution-#42" });
 *   const result = await worker.prompt("implement feature X");
 *   worker.dispose();
 */
export class SessionPool {
  private static _workers = new Map<string, WorkerSession>();
  private static _counter = 0;

  static get size(): number {
    return this._workers.size;
  }

  static getAll(): WorkerSession[] {
    return Array.from(this._workers.values());
  }

  static get(id: string): WorkerSession | undefined {
    return this._workers.get(id);
  }

  /**
   * Spawn a new in-memory worker session.
   * Fully isolated — no shared context with conversation or other workers.
   */
  static async spawn(opts: WorkerOptions): Promise<WorkerSession> {
    const { modelRegistry, selectedModel } = await buildModelSetup();
    const timeoutMs = opts.timeoutMs ?? getWorkerTimeoutMs();
    const id = `worker-${++this._counter}`;
    const extensionsDir = join(process.cwd(), "extensions");
    // Workers use slim mode by default (skip knowledge base) — they do focused tasks
    const slim = opts.slim ?? true;

    const { session, modelFallbackMessage } = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      resourceLoader: new DefaultResourceLoader({
        systemPromptOverride: (base) => buildJinxSystemPrompt(base || "", slim),
        // Workers get the same jinx-tools extension as the conversation session
        additionalExtensionPaths: [extensionsDir],
      }),
      modelRegistry,
      model: selectedModel,
      thinkingLevel: opts.thinkingLevel ?? "medium",
      tools: codingTools,
      customTools: [buildTgSendTool(tgSend)],
    } satisfies CreateAgentSessionOptions);

    if (modelFallbackMessage) {
      log.warn(`Worker model fallback: ${modelFallbackMessage}`, { id });
    }
    log.info("Worker session spawned", { id, label: opts.label });

    const worker: WorkerSession = {
      id,
      label: opts.label,
      session,

      get busy() {
        return session.isStreaming;
      },

      async prompt(message: string): Promise<string> {
        log.info(`Worker [${opts.label}]: ${message.slice(0, 80)}${message.length > 80 ? "..." : ""}`);
        if (session.isStreaming) {
          const p = collectFollowUpResponse(session, timeoutMs, opts.label);
          session.followUp(message).catch((e) =>
            log.error(`Worker followUp failed [${opts.label}]`, { error: (e as Error).message }),
          );
          return p;
        }
        const p = collectResponse(session, timeoutMs, opts.label);
        session.prompt(message).catch((e) =>
          log.error(`Worker prompt failed [${opts.label}]`, { error: (e as Error).message }),
        );
        return p;
      },

      dispose() {
        try {
          session.abort().catch(() => {});
          session.dispose();
        } catch {
          // ignore
        }
        SessionPool._workers.delete(id);
        log.info("Worker session disposed", { id, label: opts.label });
      },
    };

    this._workers.set(id, worker);
    return worker;
  }

  static disposeAll(): void {
    for (const worker of this._workers.values()) {
      worker.dispose();
    }
    this._workers.clear();
  }
}

// ── Conversation session ────────────────────────────────────────────────

let conversationSession: AgentSession | null = null;

/**
 * Start the conversation session — permanent, persistent, always-on.
 * History stored in ./data/sessions, survives restarts.
 */
export async function startConversationSession(): Promise<AgentSession> {
  const { modelRegistry, selectedModel } = await buildModelSetup();
  const extensionsDir = join(process.cwd(), "extensions");

  const { session, modelFallbackMessage } = await createAgentSession({
    sessionManager: SessionManager.create(process.cwd(), "./data/sessions"),
    resourceLoader: new DefaultResourceLoader({
      systemPromptOverride: (base) => buildJinxSystemPrompt(base || ""),
      // Load jinx-tools extension so the agent has all custom tools
      additionalExtensionPaths: [extensionsDir],
    }),
    modelRegistry,
    model: selectedModel,
    thinkingLevel: "high",
    tools: codingTools,
    customTools: [buildTgSendTool(tgSend)],
  } satisfies CreateAgentSessionOptions);

  if (modelFallbackMessage) {
    log.warn(`Conversation session model fallback: ${modelFallbackMessage}`);
  }
  conversationSession = session;
  log.info("Conversation session started", { model: selectedModel?.name || "fallback" });
  return session;
}

export function getConversationSession(): AgentSession | null {
  return conversationSession;
}

export function isConversationBusy(): boolean {
  return conversationSession?.isStreaming ?? false;
}

export async function promptConversation(message: string, images?: any[]): Promise<string> {
  if (!conversationSession) throw new Error("Conversation session not started");
  const session = conversationSession;
  const timeoutMs = getConversationTimeoutMs();

  log.info(`Conversation: ${message.slice(0, 100)}${message.length > 100 ? "..." : ""}`, {
    hasImages: !!images?.length,
    streaming: session.isStreaming,
  });

  if (session.isStreaming) {
    const p = collectFollowUpResponse(session, timeoutMs, "Conversation", images);
    session.followUp(message, images).catch((e) =>
      log.error("Conversation followUp failed", { error: (e as Error).message }),
    );
    return p;
  }

  const p = collectResponse(session, timeoutMs, "Conversation", images);
  session.prompt(message, { images }).catch((e) =>
    log.error("Conversation prompt failed", { error: (e as Error).message }),
  );
  return p;
}

// ── Startup / Shutdown ─────────────────────────────────────────────

export async function startAgent(): Promise<AgentSession> {
  return startConversationSession();
}

export async function abortAgent(): Promise<void> {
  if (conversationSession) {
    try { await conversationSession.abort(); } catch { /* ignore */ }
  }
  SessionPool.disposeAll();
}

