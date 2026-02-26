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

export interface ImageAttachment {
  data: string; // base64
  mimeType: string;
}

export type MessageHandler = (text: string, images?: ImageAttachment[]) => Promise<string | void>;

// ── Helpers ────────────────────────────────────────────────────────

const TG_MAX_LENGTH = 4096;

/**
 * Split a long message at newline boundaries to fit Telegram's limit.
 * Exported for testing.
 */
export function splitMessage(text: string, maxLength = TG_MAX_LENGTH): string[] {
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

  // ── Photo messages ──
  bot.on("message:photo", async (ctx) => {
    try {
      await ctx.replyWithChatAction("typing");

      const photo = ctx.message.photo;
      // Get the highest resolution version
      const fileId = photo[photo.length - 1].file_id;
      const file = await ctx.api.getFile(fileId);
      
      if (!file.file_path) {
        await ctx.reply("Error: Cannot get file path from Telegram.");
        return;
      }

      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const base64Data = Buffer.from(buffer).toString("base64");
      
      // Determine basic MIME from extension
      const mimeType = file.file_path.toLowerCase().endsWith("png") ? "image/png" : "image/jpeg";
      
      const images: ImageAttachment[] = [{ data: base64Data, mimeType }];
      
      const text = ctx.message.caption || "Please analyze this image.";
      log.info("TG photo received", { caption: text, size: buffer.byteLength });

      const reply = await onMessage(text, images);
      if (reply) {
        await sendLong(bot, ownerId, reply);
      }
    } catch (e) {
      const err = e as Error;
      log.error("Photo handler failed", { error: err.message });
      await ctx.reply(`Error processing photo: ${err.message}`);
    }
  });

  // ── Document/File messages ──
  bot.on("message:document", async (ctx) => {
    try {
      await ctx.replyWithChatAction("typing");

      const doc = ctx.message.document;
      if (!doc) {
        await ctx.reply("Error: No document data received.");
        return;
      }

      // File size limit: 10MB (Telegram's limit for bot downloads is 20MB, but we stay conservative)
      const MAX_FILE_SIZE = 10 * 1024 * 1024;
      if (doc.file_size && doc.file_size > MAX_FILE_SIZE) {
        await ctx.reply(`File too large (${(doc.file_size / 1024 / 1024).toFixed(1)}MB). Max size: 10MB.`);
        return;
      }

      // Get file from Telegram
      const file = await ctx.api.getFile(doc.file_id);
      if (!file.file_path) {
        await ctx.reply("Error: Cannot get file path from Telegram.");
        return;
      }

      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const content = Buffer.from(buffer);

      // Check if it's a text file we can process
      const textMimeTypes = [
        "text/",
        "application/json",
        "application/javascript",
        "application/typescript",
        "application/xml",
        "application/yaml",
        "application/toml",
      ];
      const textExtensions = [".txt", ".md", ".js", ".ts", ".json", ".xml", ".yaml", ".yml", ".toml", ".css", ".html", ".sh", ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".sql", ".log", ".conf", ".config", ".env", ".gitignore", ".dockerfile"];

      const mimeType = doc.mime_type || "";
      const fileName = doc.file_name || "";
      const isTextFile = textMimeTypes.some(t => mimeType.startsWith(t)) ||
                         textExtensions.some(ext => fileName.toLowerCase().endsWith(ext));

      if (!isTextFile) {
        await ctx.reply(`Received: ${fileName} (${(content.length / 1024).toFixed(1)}KB)\n\nThis file type is not text-based. I can only process text files (code, configs, markdown, etc.).`);
        return;
      }

      // Decode as UTF-8 text
      let textContent: string;
      try {
        textContent = content.toString("utf-8");
      } catch {
        await ctx.reply(`Received: ${fileName}\n\nCould not decode file as text. It may be a binary file.`);
        return;
      }

      // Size check for text content (to avoid context window overflow)
      const MAX_TEXT_LENGTH = 50000; // ~50KB of text
      const isTruncated = textContent.length > MAX_TEXT_LENGTH;
      if (isTruncated) {
        textContent = textContent.slice(0, MAX_TEXT_LENGTH) + "\n\n[... File truncated due to length ...]";
      }

      log.info("TG document received", { fileName, size: content.length, mimeType });

      // Build prompt with file content
      const caption = ctx.message.caption || "Please analyze this file.";
      const promptText = `File: ${fileName}\n\n${caption}\n\n---\n\n${textContent}`;

      const reply = await onMessage(promptText);
      if (reply) {
        await sendLong(bot, ownerId, reply);
      }
    } catch (e) {
      const err = e as Error;
      log.error("Document handler failed", { error: err.message });
      await ctx.reply(`Error processing document: ${err.message}`);
    }
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
      await bot.api.sendMessage(chatId, chunk, { parse_mode: "Markdown" });
    } catch (e) {
      // If markdown fails, retry without parse_mode
      try {
        log.warn("sendMessage with Markdown failed, retrying as plain text");
        await bot.api.sendMessage(chatId, chunk);
      } catch (e2) {
        log.error("sendMessage failed completely", { error: (e2 as Error).message });
        throw e2;
      }
    }
  }
}
