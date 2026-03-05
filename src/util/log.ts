import pino from "pino";

const pinoLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
          },
        }
      : undefined,
});

/**
 * Structured logger using Pino, maintaining the (msg, data) signature.
 */
export const log = {
  debug(msg: string, data?: Record<string, unknown>): void {
    if (data) {
      pinoLogger.debug(data, msg);
    } else {
      pinoLogger.debug(msg);
    }
  },
  info(msg: string, data?: Record<string, unknown>): void {
    if (data) {
      pinoLogger.info(data, msg);
    } else {
      pinoLogger.info(msg);
    }
  },
  warn(msg: string, data?: Record<string, unknown>): void {
    if (data) {
      pinoLogger.warn(data, msg);
    } else {
      pinoLogger.warn(msg);
    }
  },
  error(msg: string, data?: Record<string, unknown>): void {
    if (data) {
      pinoLogger.error(data, msg);
    } else {
      pinoLogger.error(msg);
    }
  },
};
