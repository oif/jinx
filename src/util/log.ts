/**
 * Minimal structured logger.
 * Jinx can replace this with something fancier via evolution.
 */

function ts(): string {
  return new Date().toISOString();
}

export const log = {
  info(msg: string, data?: Record<string, unknown>): void {
    console.log(JSON.stringify({ level: "info", ts: ts(), msg, ...data }));
  },
  warn(msg: string, data?: Record<string, unknown>): void {
    console.warn(JSON.stringify({ level: "warn", ts: ts(), msg, ...data }));
  },
  error(msg: string, data?: Record<string, unknown>): void {
    console.error(JSON.stringify({ level: "error", ts: ts(), msg, ...data }));
  },
};
