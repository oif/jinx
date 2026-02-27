import { Bot, InlineKeyboard, InputFile } from "grammy";
import { log } from "../util/log.js";

// ── Types ──────────────────────────────────────────────────────────

export interface TelegramBot {
  bot: Bot;
  sendToOwner: (text: string, options?: SendOptions) => Promise<void>;
  sendFileToOwner: (content: string, filename: string, caption?: string) => Promise<void>;
  editMessage: (messageId: number, text: string) => Promise<void>;
  start: () => void;
  stop: () => Promise<void>;
}

export interface SendOptions {
  replyTo?: number;
  keyboard?: InlineKeyboard;
}

export interface ImageAttachment {
  data: string;
  mimeType: string;
}

export type MessageHandler = (text: string, images?: ImageAttachment[]) => Promise<string | void>;
export type CallbackHandler = (data: string) => Promise<string | void>;

// ── Constants ──────────────────────────────────────────────────────

const TG_MAX_LENGTH = 4096;
const TYPING_INTERVAL_MS = 4000;
const FILE_THRESHOLD = 3500;

// ── Message splitting ──────────────────────────────────────────────

export function splitMessage(text: string, maxLength = TG_MAX_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxLength) {
      if (current) chunks.push(current);
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

// ── Typing indicator ───────────────────────────────────────────────

function startTypingLoop(bot: Bot, chatId: number): () => void {
  let stopped = false;

  const loop = async () => {
    while (!stopped) {
      try {
        await bot.api.sendChatAction(chatId, "typing");
      } catch {
        // ignore
      }
      await new Promise(r => setTimeout(r, TYPING_INTERVAL_MS));
    }
  };
  loop();

  return () => { stopped = true; };
}

// ── HTML formatting ────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Convert basic markdown to Telegram HTML.
 * Handles: code blocks, inline code, bold, italic.
 * Falls back to plain text for anything that might break HTML parsing.
 */
function markdownToHtml(text: string): string {
  let result = "";
  const lines = text.split("\n");
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeContent = "";

  for (const line of lines) {
    if (!inCodeBlock && line.startsWith("```")) {
      inCodeBlock = true;
      codeBlockLang = line.slice(3).trim();
      codeContent = "";
      continue;
    }
    if (inCodeBlock && line.startsWith("```")) {
      inCodeBlock = false;
      const langLabel = codeBlockLang ? `<b>${escapeHtml(codeBlockLang)}</b>\n` : "";
      result += `${langLabel}<pre><code>${escapeHtml(codeContent)}</code></pre>\n`;
      continue;
    }
    if (inCodeBlock) {
      codeContent += (codeContent ? "\n" : "") + line;
      continue;
    }

    let processed = escapeHtml(line);
    // inline code
    processed = processed.replace(/`([^`]+)`/g, "<code>$1</code>");
    // bold
    processed = processed.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    // italic
    processed = processed.replace(/\*(.+?)\*/g, "<i>$1</i>");
    result += processed + "\n";
  }

  if (inCodeBlock) {
    result += `<pre><code>${escapeHtml(codeContent)}</code></pre>\n`;
  }

  return result.trimEnd();
}

// ── Quick action keyboard ──────────────────────────────────────────

function buildQuickActionsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📊 Status", "cmd:status")
    .text("🧬 Evolve", "cmd:evolve")
    .text("⏹ Stop", "cmd:stop_evolve")
    .row()
    .text("📜 History", "cmd:history")
    .text("🔄 Restart", "cmd:restart")
    .text("🏓 Ping", "cmd:ping");
}

// ── Create bot ─────────────────────────────────────────────────────

export function createTelegramBot(
  onMessage: MessageHandler,
  onCommand?: Record<string, MessageHandler>,
  onCallback?: CallbackHandler,
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

  // ── Callback queries (inline keyboard button presses) ──
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;

    if (data.startsWith("cmd:") && onCommand) {
      const cmd = data.slice(4);
      const handler = onCommand[cmd];
      if (handler) {
        try {
          await ctx.answerCallbackQuery({ text: `Running /${cmd}...` });
          const reply = await handler("");
          if (reply) {
            await sendLong(bot, ownerId, reply);
          }
        } catch (e) {
          const err = e as Error;
          await ctx.answerCallbackQuery({ text: `Error: ${err.message}`.slice(0, 200) });
        }
        return;
      }
    }

    if (onCallback) {
      try {
        const reply = await onCallback(data);
        await ctx.answerCallbackQuery();
        if (reply) {
          await sendLong(bot, ownerId, reply);
        }
      } catch {
        await ctx.answerCallbackQuery({ text: "Error processing action" });
      }
      return;
    }

    await ctx.answerCallbackQuery({ text: "Unknown action" });
  });

  // ── Register /commands ──
  if (onCommand) {
    bot.command("menu", async (ctx) => {
      await ctx.reply("Quick Actions:", {
        reply_markup: buildQuickActionsKeyboard(),
      });
    });

    for (const [cmd, handler] of Object.entries(onCommand)) {
      bot.command(cmd, async (ctx) => {
        const text = ctx.message?.text || "";
        const args = text.split(/\s+/).slice(1).join(" ");
        try {
          const reply = await handler(args);
          if (reply) {
            await sendLong(bot, ownerId, reply, ctx.message?.message_id);
          }
        } catch (e) {
          const err = e as Error;
          log.error(`Command /${cmd} failed`, { error: err.message });
          await ctx.reply(`Error: ${err.message}`);
        }
      });
    }
  }

  // ── Text messages → agent with enhanced UX ──
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const messageId = ctx.message.message_id;
    log.info("TG message received", { length: text.length });

    const stopTyping = startTypingLoop(bot, ownerId);

    try {
      const reply = await onMessage(text);
      stopTyping();

      if (reply) {
        await sendReply(bot, ownerId, reply, messageId);
      }
    } catch (e) {
      stopTyping();
      const err = e as Error;
      log.error("Message handler failed", { error: err.message });
      await ctx.reply(`❌ ${err.message}`, {
        reply_parameters: { message_id: messageId },
      });
    }
  });

  // ── Photo messages ──
  bot.on("message:photo", async (ctx) => {
    const stopTyping = startTypingLoop(bot, ownerId);
    try {
      const photo = ctx.message.photo;
      const fileId = photo[photo.length - 1].file_id;
      const file = await ctx.api.getFile(fileId);

      if (!file.file_path) {
        stopTyping();
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
      const mimeType = file.file_path.toLowerCase().endsWith("png") ? "image/png" : "image/jpeg";
      const images: ImageAttachment[] = [{ data: base64Data, mimeType }];
      const text = ctx.message.caption || "Please analyze this image.";
      log.info("TG photo received", { caption: text, size: buffer.byteLength });

      const reply = await onMessage(text, images);
      stopTyping();

      if (reply) {
        await sendReply(bot, ownerId, reply, ctx.message.message_id);
      }
    } catch (e) {
      stopTyping();
      const err = e as Error;
      log.error("Photo handler failed", { error: err.message });
      await ctx.reply(`Error processing photo: ${err.message}`);
    }
  });

  // ── Document/File messages ──
  bot.on("message:document", async (ctx) => {
    const stopTyping = startTypingLoop(bot, ownerId);
    try {
      const doc = ctx.message.document;
      if (!doc) {
        stopTyping();
        await ctx.reply("Error: No document data received.");
        return;
      }

      const MAX_FILE_SIZE = 10 * 1024 * 1024;
      if (doc.file_size && doc.file_size > MAX_FILE_SIZE) {
        stopTyping();
        await ctx.reply(`File too large (${(doc.file_size / 1024 / 1024).toFixed(1)}MB). Max size: 10MB.`);
        return;
      }

      const file = await ctx.api.getFile(doc.file_id);
      if (!file.file_path) {
        stopTyping();
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
        stopTyping();
        await ctx.reply(`Received: ${fileName} (${(content.length / 1024).toFixed(1)}KB)\n\nThis file type is not text-based. I can only process text files.`);
        return;
      }

      let textContent: string;
      try {
        textContent = content.toString("utf-8");
      } catch {
        stopTyping();
        await ctx.reply(`Received: ${fileName}\n\nCould not decode file as text.`);
        return;
      }

      const MAX_TEXT_LENGTH = 50000;
      const isTruncated = textContent.length > MAX_TEXT_LENGTH;
      if (isTruncated) {
        textContent = textContent.slice(0, MAX_TEXT_LENGTH) + "\n\n[... File truncated due to length ...]";
      }

      log.info("TG document received", { fileName, size: content.length, mimeType });

      const caption = ctx.message.caption || "Please analyze this file.";
      const promptText = `File: ${fileName}\n\n${caption}\n\n---\n\n${textContent}`;

      const reply = await onMessage(promptText);
      stopTyping();

      if (reply) {
        await sendReply(bot, ownerId, reply, ctx.message.message_id);
      }
    } catch (e) {
      stopTyping();
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

  async function sendToOwner(text: string, options?: SendOptions): Promise<void> {
    await sendLong(bot, ownerId, text, options?.replyTo, options?.keyboard);
  }

  async function sendFileToOwner(content: string, filename: string, caption?: string): Promise<void> {
    const buf = Buffer.from(content, "utf-8");
    await bot.api.sendDocument(ownerId, new InputFile(buf, filename), {
      caption: caption?.slice(0, 1024),
    });
  }

  async function editMessage(messageId: number, text: string): Promise<void> {
    const html = markdownToHtml(text);
    try {
      await bot.api.editMessageText(ownerId, messageId, html, { parse_mode: "HTML" });
    } catch {
      try {
        await bot.api.editMessageText(ownerId, messageId, text);
      } catch (e2) {
        log.warn("editMessage failed", { error: (e2 as Error).message });
      }
    }
  }

  function start(): void {
    registerBotCommands(bot);
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

  return { bot, sendToOwner, sendFileToOwner, editMessage, start, stop };
}

// ── Internal helpers ───────────────────────────────────────────────

async function registerBotCommands(bot: Bot): Promise<void> {
  try {
    await bot.api.setMyCommands([
      { command: "status", description: "Show system status" },
      { command: "evolve", description: "Start evolution mode" },
      { command: "stop_evolve", description: "Stop evolution mode" },
      { command: "history", description: "Show health history" },
      { command: "evolution", description: "Show evolution history" },
      { command: "perf", description: "Show performance metrics" },
      { command: "quality", description: "Run code quality checks" },
      { command: "search", description: "Search the web" },
      { command: "restart", description: "Restart Jinx" },
      { command: "menu", description: "Show quick actions" },
      { command: "ping", description: "Ping Jinx" },
    ]);
  } catch (e) {
    log.warn("Failed to register bot commands", { error: (e as Error).message });
  }
}

/**
 * Smart reply: short replies as message, long replies as file attachment.
 * Uses HTML formatting and reply threading.
 */
async function sendReply(bot: Bot, chatId: number, text: string, replyToId?: number): Promise<void> {
  if (text.length > FILE_THRESHOLD) {
    const preview = text.slice(0, 300) + (text.length > 300 ? "..." : "");
    const html = markdownToHtml(preview);
    try {
      await bot.api.sendMessage(chatId, html, {
        parse_mode: "HTML",
        ...(replyToId ? { reply_parameters: { message_id: replyToId } } : {}),
      });
    } catch {
      await bot.api.sendMessage(chatId, preview, {
        ...(replyToId ? { reply_parameters: { message_id: replyToId } } : {}),
      });
    }
    const buf = Buffer.from(text, "utf-8");
    await bot.api.sendDocument(chatId, new InputFile(buf, "response.md"), {
      caption: "Full response attached",
    });
    return;
  }

  await sendLong(bot, chatId, text, replyToId);
}

async function sendLong(bot: Bot, chatId: number, text: string, replyToId?: number, keyboard?: InlineKeyboard): Promise<void> {
  const chunks = splitMessage(text);
  for (let i = 0; i < chunks.length; i++) {
    const isFirst = i === 0;
    const isLast = i === chunks.length - 1;
    const html = markdownToHtml(chunks[i]);

    const extra: Record<string, unknown> = {
      parse_mode: "HTML" as const,
    };
    if (isFirst && replyToId) {
      extra.reply_parameters = { message_id: replyToId };
    }
    if (isLast && keyboard) {
      extra.reply_markup = keyboard;
    }

    try {
      await bot.api.sendMessage(chatId, html, extra);
    } catch {
      try {
        log.warn("sendMessage with HTML failed, retrying as plain text");
        delete extra.parse_mode;
        await bot.api.sendMessage(chatId, chunks[i], extra);
      } catch (e2) {
        log.error("sendMessage failed completely", { error: (e2 as Error).message });
        throw e2;
      }
    }
  }
}
