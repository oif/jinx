import { execSync } from "node:child_process";
import { log } from "../util/log.js";
import { PROJECT_ROOT } from "./paths.js";

const DEV_BRANCH = "dev";
const MAIN_BRANCH = "main";

function git(cmd: string): string {
  return execSync(`git ${cmd}`, {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
    timeout: 60_000,
  }).trim();
}

/**
 * Get current HEAD SHA.
 */
export function getCurrentSha(): string {
  try {
    return git("rev-parse HEAD");
  } catch {
    return "unknown";
  }
}

/**
 * Get current branch name.
 */
export function getCurrentBranch(): string {
  try {
    return git("rev-parse --abbrev-ref HEAD");
  } catch {
    return "unknown";
  }
}

/**
 * Ensure we're on the dev branch. Create it from main if it doesn't exist.
 */
export function ensureDevBranch(): void {
  const current = getCurrentBranch();
  if (current === DEV_BRANCH) return;

  try {
    // Try to switch to dev
    git(`checkout ${DEV_BRANCH}`);
  } catch {
    // dev doesn't exist — create from current branch
    log.info(`Creating ${DEV_BRANCH} branch`);
    git(`checkout -b ${DEV_BRANCH}`);
  }
}

/**
 * Pull latest code from origin/dev.
 * Returns true if successful, false if failed.
 *
 * On stash pop conflict: keeps the stash (doesn't drop it) and logs a warning.
 * The stash can be recovered manually via `git stash list`.
 */
export function safePull(): boolean {
  try {
    // Stash any uncommitted changes
    const hasChanges = git("status --porcelain").length > 0;
    if (hasChanges) {
      git("stash");
    }

    git(`pull --rebase origin ${DEV_BRANCH}`);

    if (hasChanges) {
      try {
        git("stash pop");
      } catch {
        // Do NOT drop the stash — it contains Jinx's uncommitted work.
        // The stash is preserved and can be recovered via `git stash list`.
        const stashList = safeGit("stash list --oneline -1") || "(unknown)";
        log.error("Stash pop failed — stash preserved for manual recovery", { stash: stashList });
        // Notify will happen at a higher level via handleRollback or similar.
        // We still return true because the pull itself succeeded.
      }
    }

    log.info("Pull successful", { sha: getCurrentSha() });
    return true;
  } catch (e) {
    const err = e as Error;
    log.error("Pull failed", { error: err.message });
    return false;
  }
}

/**
 * Non-throwing git helper for informational commands.
 */
function safeGit(cmd: string): string | null {
  try {
    return git(cmd);
  } catch {
    return null;
  }
}

/**
 * Rollback to main branch. Used when dev is broken.
 */
export function rollbackToMain(): boolean {
  try {
    git("checkout -- ."); // Discard uncommitted changes
    git(`checkout ${MAIN_BRANCH}`);
    git(`pull origin ${MAIN_BRANCH}`);
    log.warn("Rolled back to main branch", { sha: getCurrentSha() });
    return true;
  } catch (e) {
    const err = e as Error;
    log.error("Rollback to main failed", { error: err.message });
    return false;
  }
}

/**
 * Verify that import works after pulling new code.
 * This is the "import test" — if it fails, we know the code is broken.
 */
export function verifyImport(): boolean {
  try {
    execSync("node -e \"import('./dist/main.js')\"", {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Rebuild the project (pnpm install + tsc).
 * If first attempt fails, wipes dist + node_modules and retries.
 */
export function rebuild(): boolean {
  try {
    execSync("pnpm install && pnpm run build", {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      timeout: 120_000,
      stdio: "pipe",
    });
    log.info("Rebuild successful");
    return true;
  } catch (e) {
    const err = e as Error;
    log.warn("Rebuild failed, retrying with clean slate", { error: err.message });
    try {
      // Clean both dist (stale compilation artifacts) and node_modules (corrupted deps)
      execSync("rm -rf dist node_modules && pnpm install && pnpm run build", {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
        timeout: 180_000,
        stdio: "pipe",
      });
      log.info("Rebuild successful after clean retry");
      return true;
    } catch (e2) {
      const err2 = e2 as Error;
      log.error("Rebuild failed after clean retry", { error: err2.message });
      return false;
    }
  }
}
