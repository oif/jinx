import { Bot } from "grammy";
import { log } from "../util/log.js";

// ── Types ──────────────────────────────────────────────────────────

export interface TelegramBot {
  /** The underlying Grammy bot instance */
  bot: Bot;
  /** Send a message to the owner, auto-splitting if > 4096 chars */
  sendToOwner: (text: string) => Promise<void>;
  /** Start long polling (non-blocking — runs in background) */
  start: () => void;
  /** Graceful stop */
  stop: () => Promise<void>;
}

export type MessageHandler = (text: string) => Promise<string | void>;

// ── Helpers ────────────────────────────────────────────────────────

const TG_MAX_LENGTH = 4096;

/**
 * Split a long message at newline boundaries to fit Telegram's limit.
 */
function splitMessage(text: string, maxLength = TG_MAX_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxLength) {
      if (current) chunks.push(current);
      // If a single line exceeds the limit, hard-split it
      if (line.length > maxLength) {
        for (let i = 0; i < line.length; i += maxLength) {
          chunks.push(line.slice(i, i + maxLength));
        }
        current = "";
      } else {
        current = line;
      }
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ── Create bot ─────────────────────────────────────────────────────

/**
 * Create and configure the Telegram bot.
 *
 * @param onMessage - Handler called when owner sends a text message.
 *                    Return value (if string) is sent back as reply.
 * @param onCommand - Map of /command → handler
 */
export function createTelegramBot(
  onMessage: MessageHandler,
  onCommand?: Record<string, MessageHandler>
): TelegramBot {
  const token = process.env.TG_BOT_TOKEN;
  if (!token) {
    throw new Error("TG_BOT_TOKEN environment variable is required");
  }

  const ownerId = Number(process.env.OWNER_ID);
  if (!ownerId || isNaN(ownerId)) {
    throw new Error("OWNER_ID environment variable is required (numeric Telegram user ID)");
  }

  const bot = new Bot(token);

  // ── Middleware: owner only ──
  bot.use(async (ctx, next) => {
    if (ctx.from?.id !== ownerId) {
      log.info("Ignored message from non-owner", { userId: ctx.from?.id });
      return;
    }
    await next();
  });

  // ── Register /commands ──
  if (onCommand) {
    for (const [cmd, handler] of Object.entries(onCommand)) {
      bot.command(cmd, async (ctx) => {
        const text = ctx.message?.text || "";
        const args = text.split(/\s+/).slice(1).join(" ");
        try {
          const reply = await handler(args);
          if (reply) {
            await sendLong(bot, ownerId, reply);
          }
        } catch (e) {
          const err = e as Error;
          log.error(`Command /${cmd} failed`, { error: err.message });
          await ctx.reply(`Error: ${err.message}`);
        }
      });
    }
  }

  // ── Text messages → agent ──
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    log.info("TG message received", { length: text.length });

    try {
      // Send "typing..." indicator
      await ctx.replyWithChatAction("typing");

      const reply = await onMessage(text);
      if (reply) {
        await sendLong(bot, ownerId, reply);
      }
    } catch (e) {
      const err = e as Error;
      log.error("Message handler failed", { error: err.message });
      await ctx.reply(`Error processing message: ${err.message}`);
    }
  });

  // ── Photo/document messages ──
  bot.on("message:photo", async (ctx) => {
    await ctx.reply("Photo received. (Image processing not yet implemented — I'll add this via evolution.)");
  });

  bot.on("message:document", async (ctx) => {
    await ctx.reply("Document received. (File processing not yet implemented — I'll add this via evolution.)");
  });

  // ── Error handler ──
  bot.catch((err) => {
    log.error("Grammy error", { error: err.message });
  });

  // ── Public interface ──
  async function sendToOwner(text: string): Promise<void> {
    await sendLong(bot, ownerId, text);
  }

  function start(): void {
    bot.start({
      onStart: (botInfo) => {
        log.info(`Telegram bot @${botInfo.username} started`);
      },
    });
  }

  async function stop(): Promise<void> {
    await bot.stop();
    log.info("Telegram bot stopped");
  }

  return { bot, sendToOwner, start, stop };
}

// ── Internal helpers ───────────────────────────────────────────────

async function sendLong(bot: Bot, chatId: number, text: string): Promise<void> {
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    try {
      await bot.api.sendMessage(chatId, chunk);
    } catch (e) {
      // If markdown fails, retry without parse_mode
      log.warn("sendMessage failed, retrying as plain text");
      await bot.api.sendMessage(chatId, chunk);
    }
  }
}
